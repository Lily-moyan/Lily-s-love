// 一次性连通性探测：确认 DSH 凭据库里的 DeepSeek key 能直连，并列出可用模型名。
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dshHome = process.env.DSH_HOME || join(homedir(), 'AppData', 'Roaming', 'dsh-desktop', 'harness')
const yaml = readFileSync(join(dshHome, '.credentials.yaml'), 'utf8')
const key = (yaml.match(/DEEPSEEK_API_KEY:\s*(\S+)/) || [])[1]
if (!key) {
  console.log('FAIL: 没在凭据库里找到 DEEPSEEK_API_KEY')
  process.exit(1)
}
console.log('key: 已读取, 前缀', key.slice(0, 6), '长度', key.length)

for (const model of ['deepseek-chat', 'deepseek-reasoner']) {
  const started = Date.now()
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '只回复两个字：通了' }],
        max_tokens: 32,
        stream: false,
      }),
      signal: AbortSignal.timeout(45000),
    })
    const text = await res.text()
    if (!res.ok) {
      console.log(`[${model}] HTTP ${res.status} -> ${text.slice(0, 300)}`)
      continue
    }
    const data = JSON.parse(text)
    console.log(`[${model}] OK ${Date.now() - started}ms | reply=${JSON.stringify(data.choices?.[0]?.message?.content)} | tokens=${data.usage?.prompt_tokens}/${data.usage?.completion_tokens}`)
  } catch (error) {
    console.log(`[${model}] THROW ${Date.now() - started}ms -> ${error.message} ${error.cause?.message || ''}`)
  }
}
