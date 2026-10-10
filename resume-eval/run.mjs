#!/usr/bin/env node
// 批量生成：把每条 case 跑一遍选定的 prompt 变体，落盘到 runs/<时间戳>/outputs.jsonl
//
// 用法：
//   node run.mjs                                  # 全部 case × 全部 variant
//   node run.mjs --limit 3                        # 先跑 3 条探路
//   node run.mjs --variants v1-baseline           # 只跑一个变体
//   node run.mjs --repeats 3 --temperature 0.8    # 看稳定性（pass@k）
//
// 密钥只从 resume-expert/.env.local 或环境变量读取，不打印、不写进结果文件。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const ENV_FILE = process.env.LLM_ENV_FILE || join(ROOT, '..', 'resume-expert', '.env.local')

function parseArgs(argv) {
  const args = { variants: null, limit: Infinity, temperature: 0, repeats: 1, concurrency: 4, out: null }
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === '--variants') { args.variants = value.split(',').map((s) => s.trim()).filter(Boolean); i += 1 }
    else if (key === '--limit') { args.limit = Number(value); i += 1 }
    else if (key === '--temperature') { args.temperature = Number(value); i += 1 }
    else if (key === '--repeats') { args.repeats = Number(value); i += 1 }
    else if (key === '--concurrency') { args.concurrency = Number(value); i += 1 }
    else if (key === '--out') { args.out = value; i += 1 }
  }
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
      const key = trimmed.slice(0, index).trim()
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '')
      config[key] = value
    }
  }
  return {
    apiKey: process.env.LLM_API_KEY || config.LLM_API_KEY || '',
    baseUrl: (process.env.LLM_BASE_URL || config.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, ''),
    model: process.env.LLM_MODEL || config.LLM_MODEL || 'deepseek-chat',
  }
}

function readJsonl(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line))
}

function extractJson(text) {
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
    throw new Error('model did not return JSON')
  }
}

async function callModel(config, prompt, temperature, attempt = 1) {
  const started = Date.now()
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    if (attempt < 3) return callModel(config, prompt, temperature, attempt + 1)
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`)
  }
  const payload = await response.json()
  const text = payload.choices?.[0]?.message?.content ?? ''
  return { text, latencyMs: Date.now() - started, usage: payload.usage ?? null }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

const args = parseArgs(process.argv)
const config = loadEnv()
if (!config.apiKey) {
  console.error(`没有找到 API key。请在 ${ENV_FILE} 里配置 LLM_API_KEY，或设置环境变量。`)
  process.exit(1)
}

const cases = readJsonl(join(ROOT, 'cases.jsonl'))
const facts = readFileSync(join(ROOT, 'facts.md'), 'utf8')
const variantIds = args.variants ?? ['v1-baseline', 'v2-evidence']
const variants = variantIds.map((id) => ({
  id,
  template: readFileSync(join(ROOT, 'prompts', `${id}.md`), 'utf8'),
}))
const jdCache = new Map()
function jdOf(jdId) {
  if (!jdCache.has(jdId)) jdCache.set(jdId, readFileSync(join(ROOT, 'jd', `${jdId}.md`), 'utf8'))
  return jdCache.get(jdId)
}

const selected = cases.slice(0, args.limit)
const jobs = []
for (const variant of variants) {
  for (const item of selected) {
    for (let repeat = 0; repeat < args.repeats; repeat += 1) jobs.push({ variant, item, repeat })
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = args.out ? join(ROOT, args.out) : join(ROOT, 'runs', stamp)
mkdirSync(outDir, { recursive: true })

console.log(`模型 ${config.model} ｜ case ${selected.length} 条 × 变体 ${variants.length} 个 × ${args.repeats} 次 = ${jobs.length} 次调用`)
console.log(`结果目录 ${outDir}`)

const records = await mapLimit(jobs, args.concurrency, async (job) => {
  const { variant, item, repeat } = job
  const prompt = variant.template
    .replaceAll('{{JD}}', jdOf(item.jd_id))
    .replaceAll('{{BEFORE}}', item.before)
    .replaceAll('{{ANCHOR}}', (item.jd_anchor ?? []).join('；'))
    .replaceAll('{{FACTS}}', facts)
  const base = {
    case_id: item.id,
    jd_id: item.jd_id,
    section: item.section,
    variant: variant.id,
    repeat,
    model: config.model,
    temperature: args.temperature,
    prompt_sha256: createHash('sha256').update(prompt).digest('hex').slice(0, 16),
  }
  try {
    const { text, latencyMs, usage } = await callModel(config, prompt, args.temperature)
    const parsed = extractJson(text)
    const record = {
      ...base,
      after: String(parsed.after ?? '').trim(),
      reason: String(parsed.reason ?? '').trim(),
      riskWarning: String(parsed.riskWarning ?? '').trim(),
      raw: text,
      latency_ms: latencyMs,
      usage,
      error: null,
    }
    console.log(`✓ ${variant.id} ${item.id}${repeat ? `#${repeat}` : ''} (${latencyMs}ms)`)
    return record
  } catch (error) {
    console.log(`✗ ${variant.id} ${item.id}  ${error.message}`)
    return { ...base, after: '', reason: '', riskWarning: '', raw: '', latency_ms: null, usage: null, error: error.message }
  }
})

writeFileSync(join(outDir, 'outputs.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n')
writeFileSync(
  join(outDir, 'meta.json'),
  JSON.stringify(
    {
      created_at: new Date().toISOString(),
      model: config.model,
      base_url: config.baseUrl,
      temperature: args.temperature,
      repeats: args.repeats,
      variants: variantIds,
      cases: selected.map((item) => item.id),
      calls: jobs.length,
      failures: records.filter((record) => record.error).length,
    },
    null,
    2
  )
)
console.log(`\n完成：${records.filter((r) => !r.error).length}/${records.length} 成功`)
console.log(`下一步：node judge.mjs --run ${outDir.replace(ROOT + '\\', '')}`)
