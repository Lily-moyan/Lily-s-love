#!/usr/bin/env node
// 判分：读取 runs/<dir>/outputs.jsonl，产出 judged.jsonl
//   - 断言 A（no_fabrication）：纯代码，数字白名单比对
//   - 断言 B（jd_alignment）：LLM judge，先证据后结论
//
// 用法：node judge.mjs --run runs/2026-... [--only A|B] [--limit 5]

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const ENV_FILE = process.env.LLM_ENV_FILE || join(ROOT, '..', 'resume-expert', '.env.local')

function parseArgs(argv) {
  const args = { run: null, only: null, limit: Infinity, concurrency: 4 }
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--run') { args.run = argv[i + 1]; i += 1 }
    else if (argv[i] === '--only') { args.only = argv[i + 1]; i += 1 }
    else if (argv[i] === '--limit') { args.limit = Number(argv[i + 1]); i += 1 }
    else if (argv[i] === '--concurrency') { args.concurrency = Number(argv[i + 1]); i += 1 }
  }
  if (!args.run) { console.error('缺少 --run <结果目录>'); process.exit(1) }
  return args
}

function loadEnv() {
  const config = {}
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const index = trimmed.indexOf('=')
      if (index === -1) continue
      config[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '')
    }
  }
  return {
    apiKey: process.env.LLM_API_KEY || config.LLM_API_KEY || '',
    baseUrl: (process.env.LLM_BASE_URL || config.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, ''),
    model: process.env.LLM_MODEL || config.LLM_MODEL || 'deepseek-chat',
  }
}

// ---------- 断言 A：数字白名单（代码判，不花 token） ----------

const DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const UNITS = { 十: 10, 百: 100, 千: 1000, 万: 10000 }

function chineseToNumber(token) {
  let total = 0
  let section = 0
  let number = 0
  for (const char of token) {
    if (char in DIGITS) { number = DIGITS[char]; continue }
    const unit = UNITS[char]
    if (unit === undefined) return null
    if (unit === 10000) { total = (total + section + number) * unit; section = 0; number = 0; continue }
    section += (number || 1) * unit
    number = 0
  }
  return total + section + number
}

function numbersIn(text) {
  const found = new Set()
  for (const match of String(text).matchAll(/[0-9]+(?:\.[0-9]+)?/g)) {
    const value = Number(match[0])
    found.add(value)
    found.add(Math.trunc(value))
  }
  for (const match of String(text).matchAll(/[零一二两三四五六七八九十百千万]+/g)) {
    const value = chineseToNumber(match[0])
    if (value !== null) found.add(value)
  }
  return found
}

function assertNoFabrication(record, allowed) {
  const used = numbersIn(record.after)
  const offending = [...used].filter((value) => !allowed.has(value))
  const passed = offending.length === 0
  return {
    assertion: 'no_fabrication',
    verdict: passed ? 'pass' : 'fail',
    evidence: offending.length ? offending.join('、') : [...used].join('、') || '未出现数字',
    critique: passed
      ? `改写中出现的数字（${[...used].join('、') || '无'}）全部能在原始 bullet 或事实清单里找到出处。`
      : `出现了原始材料里没有的数字：${offending.join('、')}——属于编造，判 fail。`,
  }
}

// ---------- 断言 B：LLM judge ----------

const JUDGE_SYSTEM = `你是简历改写的评测员。你只做一件事：判断这条改写是否达标。规则如下。

【判 pass】
- 读者能从改写后的句子里看出它支撑了指定的 JD 要求，并且有具体事实支撑；
- 或者：这条 bullet 本来就支撑不了该要求，而改写如实写清它真正支撑的能力、并在 reason 里说明了缺口。

【判 fail】
- 把 JD 名词堆进句尾但没有事实支撑（例如凭空写「具备效果评估能力」）；
- 改写方向与指定要求无关；
- 明明撑不住却硬凑，把弱证据说成强证据（把「参与」写成「主导」、把「支持」写成「负责」）；
- 新增了原始 bullet 里没有的数字、公司、工具、时间。

先引用改写中的关键证据（原样摘一段词句），再下结论。只输出 JSON：
{"evidence":"引用的关键证据","verdict":"pass"|"fail","critique":"为什么不通过/为什么通过，一句话"}`

function extractJson(text) {
  const cleaned = String(text).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim()
  try { return JSON.parse(cleaned) } catch {
    const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}')
    if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
    throw new Error('judge did not return JSON')
  }
}

async function judgeAlignment(config, record, item, jd) {
  const prompt = `${JUDGE_SYSTEM}

【目标岗位 JD】
${jd}

【本条 bullet 应该对齐的 JD 要求】
${(item.jd_anchor ?? []).join('；')}

【原始 bullet】
${item.before}

【改写后的 bullet】
${record.after}

【改写理由】
${record.reason}`
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, temperature: 0, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const payload = await response.json()
  const parsed = extractJson(payload.choices?.[0]?.message?.content ?? '')
  return {
    assertion: 'jd_alignment',
    verdict: parsed.verdict === 'pass' ? 'pass' : 'fail',
    evidence: String(parsed.evidence ?? '').slice(0, 300),
    critique: String(parsed.critique ?? ''),
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor; cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  }))
  return results
}

const args = parseArgs(process.argv)
const config = loadEnv()
const runDir = join(ROOT, args.run)
const outputs = readFileSync(join(runDir, 'outputs.jsonl'), 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line))
const cases = new Map(readFileSync(join(ROOT, 'cases.jsonl'), 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => { const item = JSON.parse(line); return [item.id, item] }))
const facts = readFileSync(join(ROOT, 'facts.md'), 'utf8')
const jdCache = new Map()
const jdOf = (id) => { if (!jdCache.has(id)) jdCache.set(id, readFileSync(join(ROOT, 'jd', `${id}.md`), 'utf8')); return jdCache.get(id) }

const usable = outputs.filter((record) => !record.error && record.after).slice(0, args.limit)
console.log(`判分 ${usable.length} 条（跳过失败 ${outputs.length - usable.length} 条）`)

const judged = []
for (const record of usable) {
  const item = cases.get(record.case_id)
  if (!item) continue
  const allowed = new Set([...numbersIn(item.before), ...numbersIn(facts)])
  if (!args.only || args.only === 'A') {
    const result = assertNoFabrication(record, allowed)
    judged.push({ case_id: record.case_id, variant: record.variant, repeat: record.repeat, ...result, source: 'code' })
  }
}

if (!args.only || args.only === 'B') {
  const targets = usable.filter((record) => cases.has(record.case_id))
  const results = await mapLimit(targets, args.concurrency, async (record) => {
    const item = cases.get(record.case_id)
    try {
      const result = await judgeAlignment(config, record, item, jdOf(item.jd_id))
      console.log(`✓ judge ${record.variant} ${record.case_id} → ${result.verdict}`)
      return { case_id: record.case_id, variant: record.variant, repeat: record.repeat, ...result, source: 'llm-judge' }
    } catch (error) {
      console.log(`✗ judge ${record.variant} ${record.case_id}  ${error.message}`)
      return { case_id: record.case_id, variant: record.variant, repeat: record.repeat, assertion: 'jd_alignment', verdict: 'error', evidence: '', critique: error.message, source: 'llm-judge' }
    }
  })
  judged.push(...results)
}

writeFileSync(join(runDir, 'judged.jsonl'), judged.map((record) => JSON.stringify(record)).join('\n') + '\n')
console.log(`\n已写入 ${join(args.run, 'judged.jsonl')}（${judged.length} 条判定）`)
console.log(`下一步：node report.mjs --run ${args.run}`)
