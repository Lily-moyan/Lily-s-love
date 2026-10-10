// 前端交互。刻意不用框架：三个页面、零构建、改一句刷新就见效。
import './app.css'

const $ = (sel, root = document) => root.querySelector(sel)

function h(tag, cls, text) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text !== undefined && text !== null) el.textContent = String(text)
  return el
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

// 卡片 HTML 是字符串拼接（方便整块复制到剪贴板后仍保持结构）。
function listHTML(items) {
  const arr = (items || []).filter((x) => String(x || '').trim())
  if (!arr.length) return '<p class="muted">（未填写）</p>'
  return `<ul class="clean">${arr.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
}

export function cardHTML(card, { admin = false } = {}) {
  if (!card) return '<p class="muted">卡片不存在。</p>'
  if (card.blocked) return blockedHTML(card)

  const sit = card.situation || {}
  const opts = card.options || []
  const pick = card.recommendation?.pick

  return `
<article class="sheet">
  <header class="sheet-head">
    <div class="kicker">${esc(card.meta?.product || '情感策略卡')}</div>
    <div class="headline">${esc(card.headline)}</div>
  </header>
  <div class="sheet-body">
    <section class="section">
      <div class="label">局面拆解</div>
      <div class="kv"><div class="k">事实层（他做了什么、说了什么）</div><div class="v">${listHTML(sit.facts)}</div></div>
      <div class="kv"><div class="k">他真实的诉求</div><div class="v">${esc(sit.wants) || '<span class="muted">（未填写）</span>'}</div></div>
      <div class="kv"><div class="k">你手里能用的筹码</div><div class="v">${listHTML(sit.leverage)}</div></div>
    </section>

    <section class="section">
      <div class="label">三个选项</div>
      ${opts
        .map(
          (o) => `
      <div class="opt${o.name === pick ? ' pick' : ''}">
        <div class="name"><span>${esc(o.name)}</span>${o.name === pick ? '<span class="badge">推荐</span>' : ''}</div>
        <div class="line">${esc(o.action)}</div>
        <div class="cost"><b>代价：</b>${esc(o.cost)}</div>
      </div>`,
        )
        .join('')}
    </section>

    <section class="section">
      <div class="label">我推荐这一个</div>
      <p><b>${esc(card.recommendation?.pick)}</b></p>
      <p>${esc(card.recommendation?.why)}</p>
    </section>

    <section class="section">
      <div class="label">可以直接复制的话术</div>
      ${(card.scripts || [])
        .map(
          (s, i) => `
      <div class="script">
        <div class="tone">${esc(s.tone)}</div>
        <div class="text">${esc(s.text)}</div>
        <button class="copy" data-copy="${i}">复制这条</button>
      </div>`,
        )
        .join('') || '<p class="muted">（未生成话术）</p>'}
    </section>

    <section class="section">
      <div class="label">我的判断</div>
      <div class="note">
        <div class="who">${esc(card.meta?.consultant || '我')} · 亲手批注</div>
        <div class="body">${esc(card.consultantNote) || '（顾问尚未批注）'}</div>
        <div class="sign">${card.consultantEdited ? '已人工确认' : ''}</div>
      </div>
    </section>

    <section class="section">
      <div class="nextstep">
        <div class="label">接下来 48 小时，你只需要做这一件事</div>
        <div class="body">${esc(card.nextStep) || '（未填写）'}</div>
      </div>
    </section>

    ${card.riskNote ? `<section class="section"><div class="risk">⚠️ ${esc(card.riskNote)}</div></section>` : ''}
  </div>
</article>

<script type="application/json" id="cardData">${esc(JSON.stringify(card))}</script>
<div class="foot">${esc(card.disclaimer || '')}</div>`
}

export function blockedHTML(card) {
  return `
<article class="sheet blocked">
  <header class="sheet-head">
    <div class="kicker">${esc(card.label || '需要专业介入')}</div>
    <div class="headline">${esc(card.headline)}</div>
  </header>
  <div class="sheet-body">
    <section class="section">
      <div class="label">我的判断</div>
      <p>${esc(card.why)}</p>
    </section>
    <section class="section">
      <div class="label">现在请先做这些</div>
      <ul class="res-list">${(card.actions || []).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
    </section>
    <section class="section">
      <div class="label">之后</div>
      <p>${esc(card.handoff)}</p>
    </section>
  </div>
</article>
<div class="foot">${esc(card.disclaimer || '')}</div>`
}

function bindCopyButtons(root = document) {
  root.querySelectorAll('.copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = JSON.parse($('#cardData')?.textContent || '{}')
      const script = (card.scripts || [])[Number(btn.dataset.copy)]
      if (!script) return
      try {
        await navigator.clipboard.writeText(script.text)
      } catch {
        const ta = document.createElement('textarea')
        ta.value = script.text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      }
      const old = btn.textContent
      btn.textContent = '已复制 ✓'
      setTimeout(() => { btn.textContent = old }, 1600)
    })
  })
}

/* ------------------------------------------------------------ 首页：只有一个输入框 */
function mountIntake() {
  const form = $('#intakeForm')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = $('#startBtn')
    const err = $('#intakeErr')
    const text = $('#intakeText').value.trim()
    err.hidden = true
    if (text.length < 4) {
      err.textContent = '多写一点吧，至少说清楚发生了什么。'
      err.hidden = false
      return
    }
    btn.disabled = true
    btn.textContent = '正在读你的情况…'
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '出错了')
      // 把首问也存下来，否则刷新后客户看不到第一个问题。
      const opening = [data.say, data.question].filter(Boolean).join('\n\n')
      const messages = [{ role: 'user', content: text }]
      if (opening) messages.push({ role: 'assistant', content: opening })
      sessionStorage.setItem(`s:${data.sessionId}`, JSON.stringify({ messages }))
      location.href = `/chat/${data.sessionId}`
    } catch (error) {
      err.textContent = error.message || '网络出错了，再试一次。'
      err.hidden = false
      btn.disabled = false
      btn.textContent = '开始'
    }
  })
}

/* ------------------------------------------------------------ 聊天页 */
function mountChat() {
  const root = $('#chatApp')
  const sessionId = root.dataset.sessionId
  const log = $('#chatLog')
  const form = $('#chatForm')
  const input = $('#chatInput')
  const sendBtn = $('#sendBtn')
  const finishBtn = $('#finishBtn')
  const note = $('#roundNote')
  const errBox = $('#chatErr')
  const storeKey = `s:${sessionId}`

  let messages = []
  try {
    messages = JSON.parse(sessionStorage.getItem(storeKey) || '{}').messages || []
  } catch { messages = [] }

  function persist() {
    sessionStorage.setItem(storeKey, JSON.stringify({ messages }))
  }

  function bubble(text, who) {
    const el = h('div', `msg ${who}`)
    el.textContent = text
    log.appendChild(el)
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
    return el
  }

  function typing() {
    const el = h('div', 'msg bot')
    const dots = h('div', 'dots')
    dots.innerHTML = '<span></span><span></span><span></span>'
    el.appendChild(dots)
    log.appendChild(el)
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
    return el
  }

  function showError(msg) {
    errBox.textContent = msg
    errBox.hidden = false
  }

  function renderAll() {
    log.innerHTML = ''
    messages.forEach((m) => bubble(m.content, m.role === 'user' ? 'me' : 'bot'))
  }

  function showCard(card, ids = {}) {
    sessionStorage.removeItem(storeKey)
    // 出卡时把两个链接存下来：批注链接给你，客户链接发出去。
    if (ids.adminToken) {
      sessionStorage.setItem('lastCard', JSON.stringify({ cardId: ids.cardId, adminToken: ids.adminToken }))
    }
    const box = h('div')
    box.innerHTML = cardHTML(card)
    log.appendChild(box)
    bindCopyButtons(box)
    form.hidden = true
    note.hidden = true
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }

  function lock() {
    input.disabled = true
    sendBtn.disabled = true
    finishBtn.disabled = true
  }

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '出错了')
    return data
  }

  renderAll()
  if (!messages.length) {
    // 直接打开链接（无 sessionStorage）时，回到首页重新开始，避免空对话。
    location.href = '/'
    return
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = input.value.trim()
    if (!text) return
    errBox.hidden = true
    input.value = ''
    input.style.height = 'auto'
    messages.push({ role: 'user', content: text })
    persist()
    bubble(text, 'me')
    const pending = typing()
    lock()
    try {
      const data = await post(`/api/sessions/${sessionId}/answer`, { text })
      pending.remove()
      if (data.kind === 'card' || data.kind === 'blocked') {
        showCard(data.card, data)
        return
      }
      const content = [data.say, data.question].filter(Boolean).join('\n\n')
      messages.push({ role: 'assistant', content })
      persist()
      bubble(content, 'bot')
      note.textContent = `第 ${data.round} / ${data.maxRounds} 轮 · 说完了可以直接出卡`
      input.disabled = false
      sendBtn.disabled = false
      finishBtn.disabled = false
      input.focus()
    } catch (error) {
      pending.remove()
      showError(error.message || '网络出错了，再试一次。')
      input.disabled = false
      sendBtn.disabled = false
      finishBtn.disabled = false
    }
  })

  finishBtn.addEventListener('click', async () => {
    errBox.hidden = true
    lock()
    const pending = typing()
    try {
      const data = await post(`/api/sessions/${sessionId}/finish`, {})
      pending.remove()
      showCard(data.card, data)
    } catch (error) {
      pending.remove()
      showError(error.message || '出错了，再试一次。')
      input.disabled = false
      sendBtn.disabled = false
      finishBtn.disabled = false
    }
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit()
  })
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`
  })
  input.focus()
}

/* ------------------------------------------------------------ 卡片页（客户看） */
async function mountCard() {
  const box = $('#cardBox')
  const id = box.dataset.cardId
  try {
    const res = await fetch(`/api/cards/${id}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '这张卡不存在或已被删除。')
    box.innerHTML = cardHTML(data.card)
    bindCopyButtons(box)
    document.title = `${data.card.headline || '策略卡'} · 情感策略卡`

    // 如果这张卡正是在你这台设备上刚生成的，就把批注入口一起给你。
    try {
      const mine = JSON.parse(sessionStorage.getItem('lastCard') || '{}')
      if (mine.cardId === id && mine.adminToken) {
        const bar = h('div', 'card flat')
        bar.style.marginTop = '14px'
        bar.innerHTML = `
          <p class="tiny" style="margin:0 0 10px">这张卡是你自己生成的。客户看的是当前页面，下面这个链接只有你能打开。</p>
          <div class="row wrap">
            <a class="btn accent sm" href="/admin/${esc(mine.adminToken)}">去批注（改关键两句 + 写我的判断）</a>
            <button class="btn ghost sm" id="copyClientLink">复制客户链接</button>
          </div>`
        box.appendChild(bar)
        $('#copyClientLink').addEventListener('click', async () => {
          await navigator.clipboard.writeText(`${location.origin}/c/${id}`)
          $('#copyClientLink').textContent = '已复制 ✓'
          setTimeout(() => { $('#copyClientLink').textContent = '复制客户链接' }, 1600)
        })
      }
    } catch {
      // sessionStorage 不可用时静默跳过，不影响看卡。
    }
  } catch (error) {
    box.innerHTML = `<div class="card"><p>${esc(error.message)}</p><p class="muted">请向发给你链接的人确认一下。</p></div>`
  }
}

/* ------------------------------------------------------------ 批注页（只有你能进） */
function mountAdmin() {
  const root = $('#adminApp')
  const token = root.dataset.adminToken
  const form = $('#adminForm')
  const preview = $('#preview')
  const statusPill = $('#statusPill')
  const saveBtn = $('#saveBtn')
  const msg = $('#adminMsg')
  let card = null

  const fields = {
    headline: $('#f_headline'),
    facts: $('#f_facts'),
    wants: $('#f_wants'),
    leverage: $('#f_leverage'),
    pick: $('#f_pick'),
    why: $('#f_why'),
    nextStep: $('#f_nextStep'),
    riskNote: $('#f_riskNote'),
    consultantNote: $('#f_consultantNote'),
    scripts: $('#f_scripts'),
  }

  const linesToText = (arr) => (arr || []).join('\n')
  const textToLines = (v) => String(v || '').split('\n').map((s) => s.trim()).filter(Boolean)

  function renderPreview() {
    preview.innerHTML = cardHTML(collect())
    bindCopyButtons(preview)
  }

  function collect() {
    const options = (card.options || []).map((o) => {
      const name = ($(`[data-opt-name="${o.name}"]`)?.value || o.name).trim()
      const action = ($(`[data-opt-action="${o.name}"]`)?.value || o.action).trim()
      const cost = ($(`[data-opt-cost="${o.name}"]`)?.value || o.cost).trim()
      return { name, action, cost }
    })
    const scripts = (card.scripts || []).map((s, i) => ({
      tone: s.tone,
      text: ($(`[data-script="${i}"]`)?.value || s.text).trim(),
    }))
    return {
      ...card,
      headline: fields.headline.value.trim(),
      situation: {
        facts: textToLines(fields.facts.value),
        wants: fields.wants.value.trim(),
        leverage: textToLines(fields.leverage.value),
      },
      options,
      recommendation: { pick: fields.pick.value, why: fields.why.value.trim() },
      nextStep: fields.nextStep.value.trim(),
      riskNote: fields.riskNote.value.trim(),
      consultantNote: fields.consultantNote.value.trim(),
      scripts,
      consultantEdited: true,
    }
  }

  function fill(c) {
    card = c
    fields.headline.value = c.headline || ''
    fields.facts.value = linesToText(c.situation?.facts)
    fields.wants.value = c.situation?.wants || ''
    fields.leverage.value = linesToText(c.situation?.leverage)
    fields.why.value = c.recommendation?.why || ''
    fields.nextStep.value = c.nextStep || ''
    fields.riskNote.value = c.riskNote || ''
    fields.consultantNote.value = c.consultantNote || ''

    const optBox = $('#optBox')
    optBox.innerHTML = (c.options || [])
      .map(
        (o) => `
      <div class="card flat">
        <div class="field"><label>选项名</label><input type="text" data-opt-name="${esc(o.name)}" value="${esc(o.name)}"></div>
        <div class="field"><label>具体做法</label><textarea data-opt-action="${esc(o.name)}">${esc(o.action)}</textarea></div>
        <div class="field"><label>代价（必填，不写代价的选项是骗人）</label><textarea data-opt-cost="${esc(o.name)}">${esc(o.cost)}</textarea></div>
      </div>`,
      )
      .join('')

    fields.pick.innerHTML = (c.options || [])
      .map((o) => `<option value="${esc(o.name)}"${o.name === c.recommendation?.pick ? ' selected' : ''}>${esc(o.name)}</option>`)
      .join('')

    fields.scripts.value = (c.scripts || []).map((s) => `【${s.tone}】${s.text}`).join('\n\n')
    renderPreview()
  }

  function collectScriptsFromTextarea() {
    const raw = fields.scripts.value
    const parts = raw
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    const parsed = parts.map((p) => {
      const m = p.match(/^【(.+?)】([\s\S]*)$/)
      return m ? { tone: m[1].trim(), text: m[2].trim() } : { tone: '话术', text: p }
    })
    if (parsed.length) card.scripts = parsed
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    msg.hidden = true
    collectScriptsFromTextarea()
    saveBtn.disabled = true
    saveBtn.textContent = '保存中…'
    try {
      const res = await fetch(`/api/admin/cards/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card: collect(), status: 'ready', consentArchive: $('#f_consent').checked }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')
      card = data.card
      fill(card)
      statusPill.textContent = '已交付'
      statusPill.className = 'status-pill ready'
      msg.textContent = `已保存。客户链接：${location.origin}/c/${data.id}`
      msg.hidden = false
    } catch (error) {
      msg.className = 'alert err'
      msg.textContent = error.message
      msg.hidden = false
    } finally {
      saveBtn.disabled = false
      saveBtn.textContent = '保存并标记为已交付'
    }
  })

  ;['input', 'change'].forEach((evt) => form.addEventListener(evt, renderPreview))
  $('#regenerate').addEventListener('click', renderPreview)
  $('#copyLink').addEventListener('click', async () => {
    await navigator.clipboard.writeText(`${location.origin}/c/${root.dataset.cardId}`)
    $('#copyLink').textContent = '已复制 ✓'
    setTimeout(() => { $('#copyLink').textContent = '复制客户链接' }, 1600)
  })

  fetch(`/api/admin/cards/${token}`)
    .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
    .then(({ ok, d }) => {
      if (!ok) throw new Error(d.error || '链接无效')
      fill(d.card)
      $('#f_consent').checked = Boolean(d.consentArchive)
      statusPill.textContent = d.status === 'ready' ? '已交付' : '待批注'
      statusPill.className = `status-pill ${d.status === 'ready' ? 'ready' : 'draft'}`
      $('#clientLink').href = `/c/${d.id}`
      $('#clientLink').textContent = `/c/${d.id}`
      $('#archiveBox').hidden = false
      $('#archiveBox').dataset.cardId = d.id
    })
    .catch((error) => {
      root.innerHTML = `<div class="card"><h2>打不开这个批注页</h2><p>${esc(error.message)}</p></div>`
    })

  $('#addArchive').addEventListener('click', async () => {
    const summary = $('#arc_summary').value.trim()
    const tags = {
      stage: $('#arc_stage').value.trim(),
      conflict: $('#arc_conflict').value.trim(),
      behavior: $('#arc_behavior').value.trim(),
      move: $('#arc_move').value.trim(),
    }
    const out = $('#archiveMsg')
    if (!summary) {
      out.textContent = '摘要不能为空。'
      out.hidden = false
      return
    }
    try {
      const res = await fetch(`/api/admin/cards/${token}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary, tags, result: $('#arc_result').value.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '入库失败')
      out.className = 'alert info'
      out.textContent = '已入库。往后的卡片会参考这条打法。'
      out.hidden = false
    } catch (error) {
      out.className = 'alert err'
      out.textContent = error.message
      out.hidden = false
    }
  })
}

const page = document.body.dataset.page
if (page === 'intake') mountIntake()
if (page === 'chat') mountChat()
if (page === 'card') mountCard()
if (page === 'admin') mountAdmin()
