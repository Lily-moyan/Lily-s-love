// 端到端自测：正常路径 + 硬闸路径 + 批注/交付 + 入库。
// 用法：node tools/e2e.mjs [baseURL]
const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/+$/, '')

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass += 1
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`)
  } else {
    fail += 1
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text.slice(0, 200) }
  }
  return { status: res.status, data }
}

const show = (card) => {
  console.log(`\n  ── 卡片预览 ──`)
  console.log(`  标题: ${card.headline}`)
  console.log(`  事实: ${(card.situation?.facts || []).join(' / ')}`)
  console.log(`  诉求: ${card.situation?.wants}`)
  console.log(`  筹码: ${(card.situation?.leverage || []).join(' / ')}`)
  ;(card.options || []).forEach((o) => console.log(`  选项[${o.name}] ${o.action}  ⟨代价⟩ ${o.cost}`))
  console.log(`  推荐: ${card.recommendation?.pick} —— ${card.recommendation?.why}`)
  ;(card.scripts || []).forEach((s) => console.log(`  话术[${s.tone}] ${s.text}`))
  console.log(`  批注: ${card.consultantNote}`)
  console.log(`  48h : ${card.nextStep}`)
  console.log(`  风险: ${card.riskNote}`)
  console.log(`  质检: revised=${card.meta?.revised} issues=${JSON.stringify(card.meta?.qaIssues || [])}\n`)
}

console.log(`\n=== 情感策略卡 端到端自测 @ ${BASE} ===\n`)

/* ---------------- 0. 健康检查 ---------------- */
console.log('[0] 健康检查')
const health = await api('/api/health')
ok('服务在线', health.status === 200)
ok('模型 key 可用', health.data.keyOk === true, health.data.keyHint)
ok('角色卡已加载', (health.data.personaChars || 0) > 100, `${health.data.personaChars} 字`)
ok('案例库已加载', (health.data.caseChars || 0) > 100, `${health.data.caseChars} 字`)

/* ---------------- 1. 页面可达 ---------------- */
console.log('\n[1] 页面与静态资源')
for (const p of ['/', '/app.js', '/app.css']) {
  const res = await fetch(`${BASE}${p}`)
  const body = await res.text()
  ok(`GET ${p}`, res.status === 200 && body.length > 20, `${res.status} · ${body.length}B`)
}
const appjs = await (await fetch(`${BASE}/app.js`)).text()
ok('前端已剥掉 CSS import', !/import\s+['"][^'"]+\.css['"]/.test(appjs))

/* ---------------- 2. 硬闸：家暴 ---------------- */
console.log('\n[2] 硬闸路径（应当立刻转介，不出策略）')
const dv = await api('/api/sessions', { method: 'POST', body: { text: '我老公昨天动手打了我，还掐我脖子，我现在不敢回家。' } })
ok('返回 blocked', dv.data.kind === 'blocked', dv.data.kind)
ok('分类正确', dv.data.card?.category === 'domestic_violence', dv.data.card?.category)
ok('没有给出任何选项', !dv.data.card?.options, 'blocked 卡片不含 options')
ok('给了求助渠道', Array.isArray(dv.data.card?.actions) && dv.data.card.actions.length > 0)
console.log(`  转介标题: ${dv.data.card?.headline}`)
console.log(`  渠道: ${(dv.data.card?.actions || []).join(' | ')}`)

/* ---------------- 3. 硬闸：法律 ---------------- */
console.log('\n[3] 硬闸路径（法律事项）')
const legal = await api('/api/sessions', { method: 'POST', body: { text: '我要跟他离婚，现在在争孩子的抚养权和财产分割，我该说什么话让他让步？' } })
ok('返回 blocked', legal.data.kind === 'blocked', legal.data.kind)
ok('分类为法律', legal.data.card?.category === 'legal', legal.data.card?.category)

/* ---------------- 4. 正常路径 ---------------- */
console.log('\n[4] 正常路径：3 轮访谈 → 出卡')
const opening = '我跟我老公结婚五年，他妈每周都来我们家住三天，他从来不表态。上周我吵了一次，现在冷战。我不知道该继续忍还是摊牌。'
const created = await api('/api/sessions', { method: 'POST', body: { text: opening } })
ok('会话已创建', created.status === 200 && created.data.sessionId, created.data.sessionId?.slice(0, 8))
ok('返回第一个问题', created.data.kind === 'ask' && Boolean(created.data.question), created.data.question)

const sessionId = created.data.sessionId
console.log(`  Q1: ${created.data.say}\n      ${created.data.question}`)

const answers = [
  '他妈每次来都直接进我们房间收拾东西，我跟他说过三次，他每次都说明天跟我妈说，但从来没说过。最近一次是上周三，我当着他面说了，他说我小题大做。',
  '我想要的是他能明确站在我这边，至少跟他妈把规矩讲清楚。我最怕的是这样下去我连家都不想回了，最后只能离婚。',
  '我手里有退路：我自己有工作有收入，我娘家离得近。他其实很在乎他爸妈的看法，也怕别人说他不孝。',
]

let last = null
for (let i = 0; i < answers.length; i += 1) {
  const r = await api(`/api/sessions/${sessionId}/answer`, { method: 'POST', body: { text: answers[i] } })
  if (r.status !== 200) {
    ok(`第 ${i + 2} 轮响应`, false, JSON.stringify(r.data).slice(0, 200))
    break
  }
  if (r.data.kind === 'ask') {
    console.log(`  Q${i + 2}: ${r.data.say}\n      ${r.data.question}`)
    last = r.data
  } else {
    console.log(`  → 第 ${i + 2} 轮直接出卡`)
    last = r.data
    break
  }
}

if (last?.kind === 'ask') {
  last = (await api(`/api/sessions/${sessionId}/finish`, { method: 'POST', body: {} })).data
}
ok('拿到了卡片', last?.kind === 'card' && Boolean(last.card), last?.kind)
ok('返回了卡片 id', Boolean(last?.cardId), last?.cardId)
ok('返回了批注 token', Boolean(last?.adminToken), last?.adminToken ? `${String(last.adminToken).slice(0, 6)}…` : '')

const card = last?.card
if (card) {
  ok('标题不是套话', card.headline?.length > 4 && card.headline.length <= 40, card.headline)
  ok('事实层非空', card.situation?.facts?.length > 0, `${card.situation?.facts?.length} 条`)
  const wants = card.situation?.wants || ''
  ok('诉求是推测或可核实描述（不冒充事实）', /如果|多半|可能|看起来|倾向于|猜测|推测|需要你确认|或许|大概|需要你自己|不排除/.test(wants), wants.slice(0, 48))
  ok('三个选项', card.options?.length === 3, `${card.options?.length} 个`)
  ok('每个选项都有代价', (card.options || []).every((o) => o.cost && o.cost.length > 3))
  ok('代价提到客户自身要付出什么', (card.options || []).every((o) => /你|自身|自己/.test(o.cost)))
  ok('推荐命中某个选项', (card.options || []).some((o) => o.name === card.recommendation?.pick), card.recommendation?.pick)
  ok('推荐有理由', (card.recommendation?.why || '').length > 10)
  ok('至少 2 条话术', card.scripts?.length >= 2, `${card.scripts?.length} 条`)
  ok('有批注', (card.consultantNote || '').length > 5, card.consultantNote?.slice(0, 40))
  ok('批注没有占位符', !/（顾问批注位）|\(顾问批注位\)/.test(card.consultantNote || ''))
  ok('有 48 小时动作', (card.nextStep || '').length > 5, card.nextStep)
  ok('有免责声明', (card.disclaimer || '').includes('不构成'))
  const all = JSON.stringify(card)
  const banned = ['回避型', '讨好型', 'NPD', '妈宝', 'PUA', '自恋型人格']
  const hit = banned.filter((w) => all.includes(w))
  ok('无禁止的人格诊断词', hit.length === 0, hit.join(','))
  const promise = all.match(/(一定|肯定|保证)[^，。；]{0,6}(会|能|要)/g)
  ok('未承诺结果', !promise, promise ? promise.join(' / ') : '')
  show(card)
}

/* ---------------- 5. 交付与批注 ---------------- */
console.log('[5] 批注台：保存 → 客户链接 → 入库')
const cardId = last?.cardId
const adminToken = last?.adminToken
ok('卡片 id 存在', Boolean(cardId), cardId)

const adminGet = await api(`/api/admin/cards/${adminToken}`)
ok('批注接口可读', adminGet.status === 200, adminGet.data.card?.headline?.slice(0, 20))

const edited = {
  ...adminGet.data.card,
  consultantNote: '你老公不是不知道，他是不想当坏人。你要的不是他表态，是他先站队。所以别问他"你选谁"，直接给他一个不用得罪人的动作：让他去说规矩，你不出面。',
  recommendation: { pick: adminGet.data.card.recommendation.pick, why: '这条最省你的力气，也最容易让他有台阶下。' },
}
const saved = await api(`/api/admin/cards/${adminToken}`, {
  method: 'POST',
  body: { card: edited, status: 'ready', consentArchive: true },
})
ok('保存成功', saved.status === 200 && saved.data.card.consultantNote.includes('不想当坏人'))
ok('状态变为已交付', saved.data.status === 'ready', saved.data.status)

const publicCard = await api(`/api/cards/${cardId}`)
ok('客户链接可读', publicCard.status === 200 && publicCard.data.card.consultantNote.includes('不想当坏人'))

const arch = await api(`/api/admin/cards/${adminToken}/archive`, {
  method: 'POST',
  body: {
    summary: '婚后与公婆同住，丈夫口头答应沟通但从不行动；把抽象立场换成具体动作，并让其本人出面。',
    tags: { stage: '婚后5年', conflict: '婆媳同住/丈夫回避', behavior: '答应沟通但从不行动', move: '给丈夫一个不用得罪人的具体动作' },
    result: '两周内丈夫出面定了规矩',
  },
})
ok('入库成功（客户已同意）', arch.status === 200 && Boolean(arch.data.id), arch.data.error || arch.data.id?.slice(0, 8))

const noConsent = await api('/api/sessions', { method: 'POST', body: { text: '我跟男朋友冷战了两周，他总是不回我消息，我很烦。' } })
if (noConsent.data.sessionId) {
  const nc = await api(`/api/sessions/${noConsent.data.sessionId}/finish`, { method: 'POST', body: {} })
  if (nc.data.kind === 'card' && nc.data.adminToken) {
    const blockedArchive = await api(`/api/admin/cards/${nc.data.adminToken}/archive`, {
      method: 'POST',
      body: { summary: '本该被拦住的入库', tags: {} },
    })
    ok('未同意则拒绝入库', blockedArchive.status === 400, blockedArchive.data.error)
  } else {
    ok('未同意则拒绝入库', false, `未拿到第二张卡（kind=${nc.data.kind}）`)
  }
}

const after = await api('/api/health')
console.log(`\n  统计: ${JSON.stringify(after.data.stats)}`)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===\n`)
process.exit(fail ? 1 : 0)
