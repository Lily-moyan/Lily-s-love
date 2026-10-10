#!/usr/bin/env node
// 失败模式归因：把 judge 的 critique 按关键词归到几类失败模式上，输出频次表。
// 这是「error analysis」这一步的工具化产物——先看数据，再决定改哪里。
//
// 用法：node analyze.mjs --run runs/2026-...

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
let run = null
for (let i = 2; i < process.argv.length; i += 1) if (process.argv[i] === '--run') run = process.argv[i + 1]
if (!run) { console.error('缺少 --run <结果目录>'); process.exit(1) }

const readJsonl = (file) => readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line))
const judged = readJsonl(join(ROOT, run, 'judged.jsonl'))

const PATTERNS = [
  ['把弱证据说成强证据（负责→主导、设计→首创、参与→牵头）', /拔高|升格|升级为|弱证据|说成强证据|夸大|牵头/],
  ['堆砌 JD 名词，无事实支撑', /堆砌|堆入|硬凑|名词|无(任何)?事实支撑|无依据/],
  ['凭空新增属性（行业/背景/角色定性）', /凭空(新增|加入|添加)|无任何事实支撑|没有事实支撑/],
  ['新增数字或占位符', /新增.{0,6}数字|XX|百分比|数字/],
  ['方向偏离指定要求（该说缺口却硬凑）', /无关|偏离|方向/],
]

for (const variant of [...new Set(judged.map((record) => record.variant))]) {
  const rows = judged.filter((record) => record.variant === variant && record.assertion === 'jd_alignment' && record.verdict === 'fail')
  const total = judged.filter((record) => record.variant === variant && record.assertion === 'jd_alignment').length
  console.log(`\n[${variant}]  jd_alignment 失败 ${rows.length}/${total}`)
  if (!rows.length) continue
  const counted = PATTERNS.map(([label, pattern]) => [label, rows.filter((record) => pattern.test(record.critique)).length])
  for (const [label, count] of counted.sort((left, right) => right[1] - left[1])) {
    const bar = '█'.repeat(Math.round((count / rows.length) * 20))
    console.log(`  ${String(count).padStart(2)} 次 (${String(Math.round((count / rows.length) * 100)).padStart(3)}%) ${bar}  ${label}`)
  }
}
console.log('\n注：一条 critique 可能同时命中多类，所以百分比加起来会超过 100%。')
