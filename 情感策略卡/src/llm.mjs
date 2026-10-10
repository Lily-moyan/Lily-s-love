// 模型访问层：OpenAI 兼容 /chat/completions，只依赖内置 fetch。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LLM, DSH_HOME } from './config.mjs'

let cachedKey = null

// 优先环境变量；没有则回落到 DSH 凭据库（本地开发用）。
export function apiKey() {
  if (cachedKey) return cachedKey
  const fromEnv = process.env[LLM.apiKeyEnv]
  if (fromEnv) {
    cachedKey = fromEnv.trim()
    return cachedKey
  }
  try {
    const yaml = readFileSync(join(DSH_HOME, '.credentials.yaml'), 'utf8')
    const hit = yaml.match(new RegExp(`${LLM.apiKeyEnv}:\\s*(\\S+)`))
    if (hit) {
      cachedKey = hit[1].trim()
      return cachedKey
    }
  } catch {
    // 忽略：下面统一报错
  }
  throw new Error(
    `没有可用的模型 key。请设置环境变量 ${LLM.apiKeyEnv}，或让 ${join(DSH_HOME, '.credentials.yaml')} 里存在同名条目。`,
  )
}

export function hasKey() {
  try {
    apiKey()
    return true
  } catch {
    return false
  }
}

async function once({ system, messages, model, maxTokens, temperature }) {
  // 注意：这里刻意不使用 response_format: json_object。
  // 实测 DeepSeek 在「长 system prompt + json_object」组合下会确定性地返回
  // finish_reason=stop 但 content 全是空白（30~60 token 全吐空格），重试无法恢复。
  // prompt 里已经写死了 JSON 结构，改由 parseJson 解析 + 失败时追加指令重试，更稳且可移植。
  const payload = {
    model: model || LLM.model,
    messages: [{ role: 'system', content: system }, ...messages],
    max_tokens: maxTokens ?? 2000,
    temperature: temperature ?? 0.7,
    stream: false,
  }

  const res = await fetch(`${LLM.baseURL.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`模型返回 HTTP ${res.status}: ${text.slice(0, 400)}`)
  const data = JSON.parse(text)
  const choice = data.choices?.[0]
  const content = choice?.message?.content
  // "HTTP 200 但 content 只有空白"必须在这里抛，否则会逃出重试循环。
  if (!content || !String(content).trim()) {
    throw new Error(`模型返回空内容 (model=${data.model} finish_reason=${choice?.finish_reason})`)
  }
  return { content, usage: data.usage || {}, model: data.model }
}

const JSON_NUDGE = '你上一条回复不是合法 JSON。只输出一个 JSON 对象，不要复述对话，不要输出任何解释文字，不要用 ``` 代码块包裹。'

// 取 JSON 的调用：不用 json_object，靠解析 + 不合格就追加指令重试。
export async function chat(opts, validate) {
  const { validate: _omit, ...rest } = opts
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let content = ''
    try {
      const messages =
        attempt === 1 ? rest.messages : [...rest.messages, { role: 'user', content: JSON_NUDGE }]
      const out = await once({ ...rest, messages })
      content = out.content
      if (validate) {
        const parsed = parseJson(content)
        const problem = validate(parsed)
        if (problem) throw new Error(`模型输出不符合要求：${problem}`)
        return { ...out, data: parsed }
      }
      return out
    } catch (error) {
      // 挂上原始文本，调用方可以用它做格式修复兜底，而不是丢掉这一轮。
      error.raw = content
      lastError = error
      if (attempt < 3) {
        console.warn(`[llm] 第 ${attempt} 次不合格，重试：${error.message.slice(0, 120)}`)
        await new Promise((r) => setTimeout(r, 500 * attempt))
      }
    }
  }
  throw lastError
}

// 模型有时会包一层 ```json 或前后加解释，这里尽量把 JSON 抠出来。
export function parseJson(content) {
  const trimmed = String(content ?? '').trim()
  if (!trimmed) throw new Error('模型返回了空内容')
  try {
    return JSON.parse(trimmed)
  } catch {
    // 继续尝试
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      // 继续尝试
    }
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      // 落到下面抛错
    }
  }
  throw new Error(`无法解析模型返回的 JSON: ${trimmed.slice(0, 200)}`)
}

// 校验器：返回字符串表示"不合格，需要重试"，返回空表示通过。
export const requireKeys = (...keys) => (data) => {
  if (!data || typeof data !== 'object') return '不是一个 JSON 对象'
  const missing = keys.filter((k) => !(k in data))
  return missing.length ? `缺少字段 ${missing.join('/')}` : ''
}

export async function chatJson(opts) {
  const { validate, ...rest } = opts
  // 不传 json 标志（不使用 response_format），只靠解析 + 不合格重试。
  const { content, usage, data, model } = await chat({ ...rest, validate })
  return { data: data ?? parseJson(content), usage, model }
}

export async function moderate(system, userText, model, maxTokens = 200) {
  return chatJson({
    system,
    messages: [{ role: 'user', content: userText }],
    model,
    maxTokens,
    temperature: 0,
  })
}
