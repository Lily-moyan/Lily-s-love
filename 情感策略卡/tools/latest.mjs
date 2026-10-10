// 今日队列：列出最近的卡片、状态和两个链接，省得你去翻数据库。
// 用法：node tools/latest.mjs [条数]
import { networkInterfaces } from 'node:os'
import * as db from '../src/db.mjs'
import { PORT, PUBLIC_BASE_URL } from '../src/config.mjs'

const limit = Number(process.argv[2] || 10)

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address)

console.log(`\n本机:      http://127.0.0.1:${PORT}`)
console.log(`对外域名:  ${PUBLIC_BASE_URL}`)
if (lan.length) console.log(`局域网:    ${lan.map((ip) => `http://${ip}:${PORT}`).join('  ')}`)

console.log(`\n统计: ${JSON.stringify(db.stats())}\n`)

const rows = db.recentCards(limit)

if (!rows.length) {
  console.log('还没有任何卡片。先把朋友的困扰粘到首页跑一单。\n')
  process.exit(0)
}

const STATUS = { draft: '待批注', ready: '已交付', archived: '已归档' }

for (const r of rows) {
  const headline = r.card?.headline || '(卡片数据缺失)'
  const at = new Date(r.created_at).toLocaleString('zh-CN', { hour12: false })
  console.log(`─ ${at}  [${STATUS[r.status] || r.status}]${r.client_label ? `  ${r.client_label}` : ''}`)
  console.log(`  ${headline}`)
  console.log(`  客户看: ${PUBLIC_BASE_URL}/c/${r.id}`)
  console.log(`  你批注: ${PUBLIC_BASE_URL}/admin/${r.admin_token}`)
  console.log('')
}

const pending = rows.filter((r) => r.status === 'draft').length
if (pending) console.log(`⚠️  有 ${pending} 张卡还没批注，客户在等。\n`)
