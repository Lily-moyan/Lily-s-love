// 打靶：定位"HTTP 200 + finish_reason=stop + content 全空白"的触发条件。
import { interviewSystem } from '../src/prompts.mjs'
import { apiKey } from '../src/llm.mjs'

const convo = [
  { role: 'user', content: '我跟我老公结婚五年，他妈每周都来我们家住三天，他从来不表态。上周我吵了一次，现在冷战。我不知道该继续忍还是摊牌。' },
  { role: 'assistant', content: '每周三天，等于一周里有小一半时间家里多一个人，他还一句话不接。\n\n上周吵的那次，你俩具体说了什么？他回了你哪句话？' },
  { role: 'user', content: '他妈每次来都直接进我们房间收拾东西，我跟他说过三次，他每次都说明天跟我妈说，但从来没说过。最近一次是上周三，我当着他面说了，他说我小题大做。' },
]

const TAIL = { role: 'user', content: '（系统提示：现在是第 2 轮，请按格式输出你的下一步问题。）' }

async function call(label, { system, messages, json, temperature, maxTokens, model }) {
  const payload = { model, messages: [{ role: 'system', content: system }, ...messages], max_tokens: maxTokens, temperature, stream: false }
  if (json) payload.response_format = { type: 'json_object' }
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content ?? ''
  const blank = !content.trim()
  console.log(
    `${blank ? '✗ 空' : '✓ 有'} [${label}] model=${data.model} finish=${data.choices?.[0]?.finish_reason} len=${content.trim().length} tok=${data.usage?.prompt_tokens}/${data.usage?.completion_tokens}`,
  )
  if (blank) {
    console.log(`     原始 message: ${JSON.stringify(data.choices?.[0]?.message).slice(0, 200)}`)
    console.log(`     完整 body: ${JSON.stringify(data).slice(0, 400)}`)
  } else {
    console.log(`     内容: ${JSON.stringify(content.slice(0, 120))}`)
  }
  return blank
}

const full = interviewSystem({ round: 2, maxRounds: 5 })
const short = `你是接待助手。一次只问一个问题。只输出 JSON：{"say":"回应","question":"下一个问题","done":false}`
const compactCodeFence = full.replace(/```/g, '')

console.log('=== 触发条件矩阵（每个配置跑 3 次）===\n')
const configs = [
  ['A 原文案 + json + tail + temp0.8', { system: full, messages: [...convo, TAIL], json: true, temperature: 0.8, maxTokens: 600, model: 'deepseek-chat' }],
  ['B 原文案 + 无json + tail + temp0.8', { system: full, messages: [...convo, TAIL], json: false, temperature: 0.8, maxTokens: 600, model: 'deepseek-chat' }],
  ['C 原文案 + json + tail + temp0.3', { system: full, messages: [...convo, TAIL], json: true, temperature: 0.3, maxTokens: 600, model: 'deepseek-chat' }],
  ['D 短文案 + json + tail', { system: short, messages: [...convo, TAIL], json: true, temperature: 0.6, maxTokens: 600, model: 'deepseek-chat' }],
  ['E 去代码围栏 + json + tail', { system: compactCodeFence, messages: [...convo, TAIL], json: true, temperature: 0.6, maxTokens: 600, model: 'deepseek-chat' }],
  ['F 单条拼接 + json（无多轮 assistant）', { system: full, messages: [{ role: 'user', content: `访谈记录：\n${convo.map((m) => `${m.role === 'user' ? '客户' : '助手'}：${m.content}`).join('\n')}\n\n请输出下一步 JSON。` }], json: true, temperature: 0.7, maxTokens: 600, model: 'deepseek-chat' }],
  ['G 原文案 + json + 空 maxTokens 默认', { system: full, messages: [...convo, TAIL], json: true, temperature: 0.8, maxTokens: 2000, model: 'deepseek-chat' }],
  ['H deepseek-reasoner + json + tail', { system: full, messages: [...convo, TAIL], json: true, temperature: 0.6, maxTokens: 800, model: 'deepseek-reasoner' }],
]

for (const [label, cfg] of configs) {
  let blanks = 0
  for (let i = 0; i < 3; i += 1) {
    try {
      if (await call(label, cfg)) blanks += 1
    } catch (error) {
      console.log(`! [${label}] 抛出: ${error.message}`)
    }
  }
  console.log(`   → ${label}: 空 ${blanks}/3\n`)
}
