#!/usr/bin/env node
// 汇总：pass 率（按变体 × 断言）、失败模式清单、judge 与人工的一致率
//
// 用法：node report.mjs --run runs/2026-...

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const args = {}
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--run') { args.run = process.argv[i + 1]; i += 1 }
}
if (!args.run) { console.error('缺少 --run <结果目录>'); process.exit(1) }
const runDir = join(ROOT, args.run)

const readJsonl = (file) => readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line))
const outputs = readJsonl(join(runDir, 'outputs.jsonl'))
const judged = readJsonl(join(runDir, 'judged.jsonl'))
const cases = new Map(readJsonl(join(ROOT, 'cases.jsonl')).map((item) => [item.id, item]))
const outputsByKey = new Map(outputs.map((record) => [`${record.variant}|${record.case_id}|${record.repeat}`, record]))

const variants = [...new Set(judged.map((record) => record.variant))]
const assertions = [...new Set(judged.map((record) => record.assertion))]
const pad = (text, width) => String(text).padEnd(width, ' ')

console.log(`\n结果目录：${args.run}    共 ${outputs.length} 条生成，${judged.length} 条判定\n`)
console.log(pad('变体', 16) + assertions.map((name) => pad(name, 18)).join('') + pad('两条都过', 12))
for (const variant of variants) {
  const cells = assertions.map((assertion) => {
    const rows = judged.filter((record) => record.variant === variant && record.assertion === assertion)
    const passed = rows.filter((record) => record.verdict === 'pass').length
    return pad(`${passed}/${rows.length} = ${rows.length ? Math.round((passed / rows.length) * 100) : 0}%`, 18)
  })
  const okKeys = new Set()
  const total = new Set()
  for (const record of judged.filter((row) => row.variant === variant)) {
    const key = `${record.case_id}|${record.repeat}`
    total.add(key)
    const rows = judged.filter((row) => row.variant === variant && row.case_id === record.case_id && row.repeat === record.repeat)
    if (rows.length === assertions.length && rows.every((row) => row.verdict === 'pass')) okKeys.add(key)
  }
  console.log(pad(variant, 16) + cells.join('') + pad(`${okKeys.size}/${total.size}`, 12))
}

console.log('\n—— 失败清单（按 case） ——')
for (const variant of variants) {
  const failed = judged.filter((record) => record.variant === variant && record.verdict === 'fail')
  if (!failed.length) continue
  console.log(`\n[${variant}]`)
  for (const record of failed) {
    const output = outputsByKey.get(`${record.variant}|${record.case_id}|${record.repeat}`)
    const item = cases.get(record.case_id) ?? { section: '' }
    console.log(`  ${record.case_id} ${item.section} · ${record.assertion}`)
    console.log(`    证据：${record.evidence}`)
    console.log(`    判定：${record.critique}`)
    if (output) console.log(`    改写：${output.after.slice(0, 160)}`)
  }
}

const labelFile = join(runDir, 'labels.jsonl')
if (existsSync(labelFile)) {
  const labels = readJsonl(labelFile)
  const pairs = []
  for (const label of labels) {
    const match = judged.find((record) => record.case_id === label.case_id && record.variant === label.variant && (!label.assertion || record.assertion === label.assertion))
    if (match) pairs.push({ human: label.verdict, judge: match.verdict })
  }
  const agree = pairs.filter((pair) => pair.human === pair.judge).length
  console.log(`\n—— 人机一致率 ——`)
  console.log(`  ${agree}/${pairs.length} = ${pairs.length ? Math.round((agree / pairs.length) * 100) : 0}%（低于 85% 时不要相信 judge 的分数）`)
  for (const pair of pairs.filter((item) => item.human !== item.judge)) {
    console.log(`  分歧：人工 ${pair.human} / judge ${pair.judge}`)
  }
} else {
  console.log('\n（还没有人工标注 labels.jsonl，人机一致率暂缺——用 viewer.html 标 20 条后导出）')
}

writeFileSync(join(runDir, 'summary.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  counts: Object.fromEntries(variants.map((variant) => [variant, Object.fromEntries(assertions.map((assertion) => {
    const rows = judged.filter((record) => record.variant === variant && record.assertion === assertion)
    return [assertion, { pass: rows.filter((row) => row.verdict === 'pass').length, total: rows.length }]
  }))])),
}, null, 2))
