// 业务流程：会话推进 → 硬闸 → 出卡 → 质检 → 返修。
import * as db from './db.mjs'
import * as llm from './llm.mjs'
import * as P from './prompts.mjs'
import { MAX_ROUNDS, MIN_ROUNDS, COPY } from './config.mjs'

const asArray = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && String(x).trim()) : [])

/** 把模型输出规整成 UI 一定能渲染的结构，字段缺失也不会白屏。 */
function normalizeCard(raw, extra = {}) {
  const options = asArray(raw?.options)
    .map((o) => ({
      name: String(o?.name || '').trim() || '未命名选项',
      action: String(o?.action || '').trim(),
      cost: String(o?.cost || '').trim() || '这个选项的代价模型没写出来，请向顾问确认。',
    }))
    .slice(0, 4)

  const scripts = asArray(raw?.scripts)
    .map((s) => ({ tone: String(s?.tone || '话术').trim(), text: String(s?.text || '').trim() }))
    .filter((s) => s.text)

  const rec = raw?.recommendation || {}
  const pick = String(rec.pick || '').trim()
  const matched = options.find((o) => o.name === pick)?.name || options[0]?.name || pick

  return {
    headline: String(raw?.headline || '这个局面的关键在哪里').trim(),
    situation: {
      facts: asArray(raw?.situation?.facts),
      wants: String(raw?.situation?.wants || '').trim(),
      leverage: asArray(raw?.situation?.leverage),
    },
    options,
    recommendation: { pick: matched, why: String(rec.why || '').trim() },
    scripts,
    consultantNote: String(raw?.consultantNote || '').trim(),
    consultantEdited: false,
    nextStep: String(raw?.nextStep || '').trim(),
    riskNote: String(raw?.riskNote || '').trim(),
    disclaimer: P.DISCLAIMER,
    meta: {
      product: COPY.productName,
      consultant: COPY.consultant,
      generatedAt: new Date().toISOString(),
      ...extra,
    },
  }
}

function transcript(messages) {
  return messages
    .map((m) => `${m.role === 'user' ? '客户' : '助手'}：${String(m.content).trim()}`)
    .join('\n\n')
}

/** 客户提交的原始困扰，用于分诊和后续记录。 */
function clientText(messages) {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) => String(m.content))
    .join('\n')
}

/** 第 1 轮：创建会话，返回开场提问。 */
export async function start(rawText, label = '') {
  const text = String(rawText || '').trim()
  if (text.length < 4) throw new Error('说得太短了，多写一点才能帮你判断。')

  const session = db.createSession(label)
  const messages = [{ role: 'user', content: text }]
  db.updateSession(session.id, { messages })

  // 第一句就命中硬闸，直接转介，连追问都不做。
  const risk = await P.triage(llm, text)
  if (risk.risk) {
    const card = P.referralCard(risk.category, risk.reason, text)
    db.updateSession(session.id, { stage: 'blocked', risk_category: risk.category, card })
    return { sessionId: session.id, kind: 'blocked', card }
  }

  const { say, question } = await nextQuestion(messages, 1)
  const withAssistant = [...messages, { role: 'assistant', content: joinSay(say, question) }]
  db.updateSession(session.id, { messages: withAssistant })
  return { sessionId: session.id, kind: 'ask', round: 1, maxRounds: MAX_ROUNDS, say, question }
}

function joinSay(say, question) {
  return [say, question].filter((x) => x && String(x).trim()).join('\n\n')
}

async function nextQuestion(messages, round) {
  const system = P.interviewSystem({ round, maxRounds: MAX_ROUNDS })
  // 不再往末尾塞"（系统提示：…）"这类假 user 消息：实测它会覆盖前面的格式约束，
  // 让模型改成直接回人话，导致整轮解析失败。
  const opts = { system, messages, maxTokens: 600, temperature: 0.8 }

  try {
    const { data } = await llm.chatJson({
      ...opts,
      validate: (d) => {
        if (!d || typeof d !== 'object') return '不是 JSON 对象'
        if (d.done) return ''
        if (!String(d.question || '').trim()) return 'question 为空且未标记 done'
        return ''
      },
    })
    return {
      say: String(data?.say || '').trim(),
      question: String(data?.question || '').trim(),
      done: Boolean(data?.done),
    }
  } catch (error) {
    // 兜底：把这一轮的人话回复转成 JSON，而不是把客户的问题丢掉。
    const { data } = await llm.chatJson({
      system: P.REPAIR_SYSTEM,
      messages: [{ role: 'user', content: `上一次的原始回复（解析失败原因：${error.message.slice(0, 60)}）：\n\n${String(error.raw || '').slice(0, 1500)}` }],
      maxTokens: 500,
      temperature: 0,
    })
    return {
      say: String(data?.say || '').trim(),
      question: String(data?.question || '').trim(),
      done: Boolean(data?.done),
    }
  }
}

/** 第 N 轮：客户回答后继续追问，够了就出卡。 */
export async function answer(sessionId, rawText) {
  const session = db.getSession(sessionId)
  if (!session) throw new Error('会话不存在或已过期。')
  if (session.stage === 'blocked') return { kind: 'blocked', card: session.card }

  const text = String(rawText || '').trim()
  if (!text) throw new Error('还没写内容。')

  const messages = [...session.messages, { role: 'user', content: text }]
  const round = messages.filter((m) => m.role === 'user').length
  db.updateSession(sessionId, { messages })

  // 每轮都重新过一遍硬闸（客户可能在后续补充里才提到暴力或法律）。
  const risk = await P.triage(llm, text)
  if (risk.risk) {
    const card = P.referralCard(risk.category, risk.reason, clientText(messages))
    db.updateSession(sessionId, { stage: 'blocked', risk_category: risk.category, card })
    return { kind: 'blocked', card }
  }

  if (round >= MAX_ROUNDS) {
    const { card, cardId, adminToken } = await buildCard(sessionId, messages)
    return { kind: 'card', card, cardId, adminToken }
  }

  const { say, question, done } = await nextQuestion(messages, round)
  if (done && round >= MIN_ROUNDS) {
    const { card, cardId, adminToken } = await buildCard(sessionId, messages)
    return { kind: 'card', card, cardId, adminToken }
  }

  const withAssistant = [...messages, { role: 'assistant', content: joinSay(say, question) }]
  db.updateSession(sessionId, { messages: withAssistant })
  return { kind: 'ask', round, maxRounds: MAX_ROUNDS, say, question }
}

/** 客户主动结束访谈，直接出卡。 */
export async function finish(sessionId) {
  const session = db.getSession(sessionId)
  if (!session) throw new Error('会话不存在或已过期。')
  if (session.stage === 'blocked') return { kind: 'blocked', card: session.card }
  const { card, cardId, adminToken } = await buildCard(sessionId, session.messages)
  return { kind: 'card', card, cardId, adminToken }
}

/** 出卡：写稿 → 安全质检 + 有用性质检（并发）→ 有问题则返修一轮。 */
async function buildCard(sessionId, messages) {
  const archive = db.archiveContext(8)
  const draft = await writeCard(messages, archive)

  const [safety, useful] = await Promise.all([qaSafety(draft), qaUseful(draft)])
  const problems = [...(safety.issues || []), ...(useful.issues || [])]
  let final = draft
  let revised = false

  if (problems.length) {
    final = await writeCard(messages, archive, { draft, problems, fixes: [...(safety.fixes || []), ...(useful.fixes || [])] })
    revised = true
  }

  const card = normalizeCard(final, { revised, qaIssues: problems })
  db.updateSession(sessionId, { stage: 'card', card })
  // 必须落库：批注台和客户链接都是靠这张表的 id / admin_token 打开的。
  const { id: cardId, adminToken } = db.createCard(sessionId, card)
  return { card, cardId, adminToken }
}

async function writeCard(messages, archive, revision = null) {
  const userContent = revision
    ? `以下是客户与助手的完整访谈记录：\n\n${transcript(messages)}\n\n---\n这是上一版草稿，质检发现它有问题，请重写一版（保留正确的部分，改掉问题）：\n\n${JSON.stringify(revision.draft).slice(0, 6000)}\n\n必须修正的问题：\n${revision.problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n建议的改法：\n${(revision.fixes || []).map((f, i) => `${i + 1}. ${f}`).join('\n') || '（无）'}`
    : `这是客户与助手的完整访谈记录：\n\n${transcript(messages)}\n\n请输出策略卡 JSON。`

  const { data } = await llm.chatJson({
    system: P.cardSystem({ archive }),
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 3500,
    temperature: revision ? 0.4 : 0.75,
    // 结构不完整的卡片会在页面上白屏，宁可重试。
    validate: (d) => {
      if (!d || typeof d !== 'object') return '不是 JSON 对象'
      if (!String(d.headline || '').trim()) return 'headline 为空'
      if (!Array.isArray(d.options) || d.options.length < 2) return 'options 少于 2 个'
      if (d.options.some((o) => !String(o?.cost || '').trim())) return '有选项没写代价'
      if (!d.recommendation?.pick) return 'recommendation.pick 为空'
      if (!String(d.nextStep || '').trim()) return 'nextStep 为空'
      return ''
    },
  })
  return data
}

async function qaSafety(draft) {
  try {
    const { data } = await llm.moderate(P.QA_SAFETY_SYSTEM, JSON.stringify(draft).slice(0, 9000), undefined, 700)
    return { issues: asArray(data?.issues), fixes: asArray(data?.fixes) }
  } catch {
    return { issues: [], fixes: [] }
  }
}

async function qaUseful(draft) {
  try {
    const { data } = await llm.moderate(P.QA_USEFULNESS_SYSTEM, JSON.stringify(draft).slice(0, 9000), undefined, 700)
    return { issues: asArray(data?.issues), fixes: asArray(data?.fixes) }
  } catch {
    return { issues: [], fixes: [] }
  }
}

export { normalizeCard, transcript }
