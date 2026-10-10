// HTTP 层：API + 六个页面。零第三方依赖（esbuild 只在打包前端时按需加载）。
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { ROOT, PORT, HOST, MAX_ROUNDS, MIN_ROUNDS, COPY, PUBLIC_BASE_URL, DB_PATH, LLM } from './config.mjs'
import * as db from './db.mjs'
import * as core from './core.mjs'
import { hasKey, apiKey } from './llm.mjs'
import { persona, cases } from './prompts.mjs'

const PUBLIC_DIR = join(ROOT, 'public')
const BUILD_DIR = join(PUBLIC_DIR, 'build')

/* ------------------------------------------------------------ 前端产物 */
let clientBuildDir = BUILD_DIR
let pendingClientJs = null

async function bundleClient() {
  try {
    const esbuild = await import('esbuild')
    await esbuild.build({
      entryPoints: [join(PUBLIC_DIR, 'app.mjs')],
      bundle: true,
      format: 'esm',
      target: 'es2020',
      outfile: join(BUILD_DIR, 'app.js'),
      logLevel: 'silent',
    })
    clientBuildDir = BUILD_DIR
    return { ok: true, via: 'esbuild' }
  } catch (error) {
    // 没装 esbuild：退回到在内存里剥掉 CSS import 后直服浏览器原生 ESM。
    // （CSS 由 HTML 里的 <link> 单独加载，这里只需要把裸模块说明符去掉。）
    const source = await readFile(join(PUBLIC_DIR, 'app.mjs'), 'utf8').catch(() => {
      throw new Error('public/app.mjs 不存在，前端无法加载')
    })
    pendingClientJs = source.replace(/^\s*import\s+['"][^'"]+\.css['"];?\s*$/gm, '')
    clientBuildDir = null
    return { ok: true, via: 'raw', note: error.message.split('\n')[0] }
  }
}

/* ------------------------------------------------------------ HTML 视图 */
function html(title, body, { page = '', extra = '', scriptAttrs = '' } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<link rel="stylesheet" href="/app.css">
</head>
<body data-page="${page}">
${body}
<script type="module" src="/app.js"${scriptAttrs}></script>
</body>
</html>`
}

function intakePage() {
  return html(
    `${COPY.productName} · 把关系里的事说清楚`,
    `<div class="topbar"><span class="brand">${COPY.productName}</span><span>${COPY.turnaround}交付</span></div>
<div class="wrap">
  <h1>说说你现在卡在哪</h1>
  <p class="muted">先由助手问清楚情况，再由本人亲笔批注，给你一页能直接照着做的方案。</p>

  <form id="intakeForm">
    <div class="card">
      <textarea id="intakeText" placeholder="例如：我跟我老公结婚五年，他妈每周都来我们家住三天，他从来不表态，我上周终于吵了一次，现在冷战。我不知道该继续忍还是摊牌。"></textarea>
    </div>
    <div class="hint-row">
      <span class="chip">谁和谁的事</span>
      <span class="chip">多久了</span>
      <span class="chip">最近一次发生了什么</span>
      <span class="chip">你最想要的结果</span>
      <span class="chip">你最怕的结果</span>
    </div>
    <div class="alert err" id="intakeErr" hidden></div>
    <button class="btn accent" id="startBtn" type="submit">开始</button>
  </form>

  <div class="card flat" style="margin-top:18px">
    <p class="tiny" style="margin:0">你会拿到：局面拆解 · 3 个选项（含各自代价）· 一个明确推荐 · 可直接复制的话术 · 我的亲笔批注。</p>
  </div>
  <div class="foot">本内容为关系决策参考，不构成心理治疗、法律意见或医疗建议。<br>涉及人身安全、法律程序或情绪危机，请立即联系对应专业机构。</div>
</div>`,
    { page: 'intake' },
  )
}

function chatPage(sessionId) {
  return html(
    `说清楚情况 · ${COPY.productName}`,
    `<div class="topbar"><span class="brand">${COPY.productName}</span><span>助手接待中</span></div>
<div class="wrap" id="chatApp" data-session-id="${sessionId}">
  <div class="chat" id="chatLog"></div>
  <div class="alert err" id="chatErr" hidden></div>
  <div class="composer">
    <div class="round-note" id="roundNote">正在读取你的情况…</div>
    <form id="chatForm">
      <textarea id="chatInput" placeholder="直接回答上面的问题就行。" style="min-height:88px"></textarea>
      <div class="row" style="margin-top:10px">
        <button class="btn" id="sendBtn" type="submit" style="flex:1">发送</button>
        <button class="btn ghost sm" id="finishBtn" type="button">够了，直接出卡</button>
      </div>
    </form>
  </div>
</div>`,
    { page: 'chat' },
  )
}

function cardPage(cardId) {
  return html(
    `你的策略卡 · ${COPY.productName}`,
    `<div class="topbar"><span class="brand">${COPY.productName}</span><span>专属方案</span></div>
<div class="wrap" id="cardBox" data-card-id="${cardId}">
  <div class="card"><p class="muted">正在打开…</p></div>
</div>`,
    { page: 'card' },
  )
}

function adminPage(adminToken, cardId) {
  return html(
    `批注台 · ${COPY.productName}`,
    `<div class="topbar"><span class="brand">批注台（只有你能进）</span><span class="status-pill" id="statusPill">读取中</span></div>
<div class="wrap">
  <div class="alert info" id="adminMsg" hidden></div>
  <div id="adminApp" data-admin-token="${adminToken}" data-card-id="${cardId}">
    <form id="adminForm">
      <div class="admin-grid">
        <div class="admin-col">
          <div class="card">
            <h2>你要动的只有这几处</h2>
            <p class="tiny">AI 出稿只是初稿。客户买单的是<b>你的判断</b>，所以下面两处最重要。</p>

            <div class="field">
              <label>「我的判断」批注（全卡最值钱的一句）</label>
              <textarea class="tall" id="f_consultantNote"></textarea>
            </div>

            <div class="field">
              <label>为什么推荐它（改掉套话，写出你的理由）</label>
              <textarea id="f_why"></textarea>
            </div>

            <div class="field">
              <label>推荐哪一个</label>
              <select id="f_pick" class="btn ghost" style="color:var(--ink);text-align:left"></select>
            </div>

            <div class="field">
              <label>标题（一句话点破局面）</label>
              <input type="text" id="f_headline">
            </div>

            <div class="field">
              <label>48 小时内那一件事</label>
              <textarea id="f_nextStep"></textarea>
            </div>
          </div>

          <div class="card">
            <h2>展开项（通常不用改）</h2>
            <div class="field"><label>事实层（一行一条）</label><textarea id="f_facts"></textarea></div>
            <div class="field"><label>他真实的诉求</label><textarea id="f_wants"></textarea></div>
            <div class="field"><label>筹码（一行一条）</label><textarea id="f_leverage"></textarea></div>
            <div class="field"><label>风险提醒</label><textarea id="f_riskNote"></textarea></div>
            <div id="optBox"></div>
            <div class="field">
              <label>话术（每条用【高姿态】开头，空行分隔）</label>
              <textarea class="tall" id="f_scripts"></textarea>
            </div>
          </div>

          <div class="card">
            <label class="row" style="gap:8px;font-size:14px;color:var(--ink-2)">
              <input type="checkbox" id="f_consent" style="width:auto"> 客户已同意把这条脱敏后作为参考案例
            </label>
            <div class="row wrap" style="margin-top:14px">
              <button class="btn accent" id="saveBtn" type="submit">保存并标记为已交付</button>
              <button class="btn ghost sm" type="button" id="copyLink">复制客户链接</button>
              <button class="btn ghost sm" type="button" id="regenerate">刷新预览</button>
            </div>
            <p class="tiny" style="margin-top:12px">客户链接：<a id="clientLink" href="#" target="_blank" rel="noreferrer">读取中…</a></p>
          </div>

          <div class="card" id="archiveBox" hidden>
            <h2>入库为案例（脱敏，只有你点过才会生效）</h2>
            <p class="tiny">只保留四样东西：阶段、冲突、关键行为、有效打法。不要写姓名、城市、单位、年龄。</p>
            <div class="field"><label>阶段</label><input type="text" id="arc_stage" placeholder="婚后3年 / 恋爱2年谈婚论嫁"></div>
            <div class="field"><label>冲突</label><input type="text" id="arc_conflict" placeholder="婆媳同住 / 彩礼 / 暧昧忽冷忽热"></div>
            <div class="field"><label>关键行为</label><input type="text" id="arc_behavior" placeholder="丈夫口头答应但从不行动"></div>
            <div class="field"><label>有效打法</label><input type="text" id="arc_move" placeholder="把抽象立场换成具体动作"></div>
            <div class="field"><label>脱敏摘要</label><textarea id="arc_summary" placeholder="用第三人称写清楚：什么局面 → 用了什么招 → 结果如何。不含任何可指认信息。"></textarea></div>
            <div class="field"><label>结果（可后补）</label><input type="text" id="arc_result" placeholder="两周后……"></div>
            <div class="alert" id="archiveMsg" hidden></div>
            <button class="btn ghost sm" type="button" id="addArchive">确认入库</button>
          </div>
        </div>

        <div class="admin-col">
          <p class="tiny" style="margin:0 0 8px 2px">客户视角预览（实时）</p>
          <div id="preview"></div>
        </div>
      </div>
    </form>
  </div>
</div>`,
    { page: 'admin' },
  )
}

/* ------------------------------------------------------------ 工具 */
function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

async function readBody(req, limit = 512 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('内容太长了')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求格式不对')
  }
}

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

async function serveFile(res, base, rel) {
  // base 可能是 null（raw 模式没有构建目录），必须先挡住，否则 join(null) 会抛错。
  if (!base) return false
  const safe = rel.replace(/\.\.+/g, '').replace(/^[/\\]+/, '')
  const path = join(base, safe)
  if (!existsSync(path)) return false
  const buf = await readFile(path)
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' })
  res.end(buf)
  return true
}

/* ------------------------------------------------------------ 路由 */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const path = url.pathname
  const method = req.method || 'GET'

  try {
    /* ---- 前端资源 ---- */
    if (method === 'GET' && path === '/app.js') {
      if (clientBuildDir && (await serveFile(res, clientBuildDir, 'app.js'))) return
      if (pendingClientJs) {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(pendingClientJs)
      }
      res.writeHead(404).end('// client not built')
      return
    }
    if (method === 'GET' && path === '/app.css') {
      if (await serveFile(res, clientBuildDir, 'app.css')) return
      if (await serveFile(res, PUBLIC_DIR, 'app.css')) return
      res.writeHead(404).end('')
      return
    }

    /* ---- API ---- */
    if (method === 'POST' && path === '/api/sessions') {
      const body = await readBody(req)
      const out = await core.start(body.text, body.label || '')
      return json(res, 200, out)
    }

    const answerMatch = path.match(/^\/api\/sessions\/([\w-]+)\/answer$/)
    if (method === 'POST' && answerMatch) {
      const body = await readBody(req)
      const out = await core.answer(answerMatch[1], body.text)
      return json(res, 200, out)
    }

    const finishMatch = path.match(/^\/api\/sessions\/([\w-]+)\/finish$/)
    if (method === 'POST' && finishMatch) {
      const out = await core.finish(finishMatch[1])
      return json(res, 200, out)
    }

    const cardApi = path.match(/^\/api\/cards\/([\w-]+)$/)
    if (method === 'GET' && cardApi) {
      const row = db.getCard(cardApi[1])
      if (!row) return json(res, 404, { error: '这张卡不存在或已被删除。' })
      return json(res, 200, { id: row.id, status: row.status, card: row.card })
    }

    const adminApi = path.match(/^\/api\/admin\/cards\/([\w-]+)$/)
    if (adminApi) {
      const row = db.getCardByAdminToken(adminApi[1])
      if (!row) return json(res, 404, { error: '批注链接无效。' })
      if (method === 'GET') {
        const session = db.getSession(row.session_id)
        return json(res, 200, {
          id: row.id,
          status: row.status,
          card: row.card,
          consentArchive: Boolean(session?.consent_archive),
          sessionId: row.session_id,
        })
      }
      if (method === 'POST') {
        const body = await readBody(req)
        const card = body.card || row.card
        if (!card?.options?.length) return json(res, 400, { error: '卡片内容不完整，选项至少要有一个。' })
        const updated = db.updateCard(row.id, card, body.status || 'ready')
        if (body.consentArchive !== undefined) {
          db.updateSession(row.session_id, { consent_archive: body.consentArchive ? 1 : 0 })
        }
        return json(res, 200, { id: updated.id, status: updated.status, card: updated.card })
      }
    }

    const archiveApi = path.match(/^\/api\/admin\/cards\/([\w-]+)\/archive$/)
    if (method === 'POST' && archiveApi) {
      const row = db.getCardByAdminToken(archiveApi[1])
      if (!row) return json(res, 404, { error: '批注链接无效。' })
      const body = await readBody(req)
      const session = db.getSession(row.session_id)
      // 入库这一下必须由本人确认：没有客户同意、或没有摘要，都不落库。
      if (!session?.consent_archive && !body.force) {
        return json(res, 400, { error: '客户还没同意把这条作为参考案例，请先在左侧勾选并保存。' })
      }
      if (!String(body.summary || '').trim()) return json(res, 400, { error: '脱敏摘要不能为空。' })
      const id = db.addArchive({
        sourceCardId: row.id,
        summary: String(body.summary).trim(),
        tags: body.tags || {},
        result: body.result ? String(body.result).trim() : null,
      })
      return json(res, 200, { id })
    }

    if (method === 'GET' && path === '/api/health') {
      let keyOk = false
      let keyHint = ''
      try {
        apiKey()
        keyOk = true
        keyHint = LLM.model
      } catch (error) {
        keyHint = error.message
      }
      return json(res, 200, {
        ok: true,
        model: LLM.model,
        baseURL: LLM.baseURL,
        keyOk,
        keyHint,
        publicBaseURL: PUBLIC_BASE_URL,
        db: DB_PATH,
        personaChars: persona().length,
        caseChars: cases().length,
        rounds: [MIN_ROUNDS, MAX_ROUNDS],
        stats: db.stats(),
      })
    }

    /* ---- 页面 ---- */
    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      const res2 = intakePage()
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(res2)
    }

    const chatP = path.match(/^\/chat\/([\w-]+)$/)
    if (method === 'GET' && chatP) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(chatPage(chatP[1]))
    }

    const cardP = path.match(/^\/c\/([\w-]+)$/)
    if (method === 'GET' && cardP) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(cardPage(cardP[1]))
    }

    const adminP = path.match(/^\/admin\/([\w-]+)$/)
    if (method === 'GET' && adminP) {
      const row = db.getCardByAdminToken(adminP[1])
      if (!row) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
        return res.end(html('链接无效', '<div class="wrap"><div class="card"><h2>这个批注链接无效</h2><p class="muted">可能是复制不全，或卡片已被删除。</p></div></div>'))
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(adminPage(adminP[1], row.id))
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404')
  } catch (error) {
    const status = /不存在|无效|太短|还没写|太长|格式不对/.test(error.message) ? 400 : 500
    if (status === 500) console.error('[error]', error)
    return json(res, status, { error: error.message || '服务器出错了' })
  }
})

/* ------------------------------------------------------------ 启动 */
const build = await bundleClient()
if (!hasKey()) {
  console.error('\n⚠️  没有可用的模型 key。请设置 DEEPSEEK_API_KEY（或 LLM_API_KEY_ENV 指定的变量）后重启。\n')
}

server.listen(PORT, HOST, () => {
  const where = `http://127.0.0.1:${PORT}`
  console.log(`\n  ${COPY.productName} 已启动`)
  console.log(`  本机打开      ${where}`)
  console.log(`  局域网/公网   ${PUBLIC_BASE_URL}`)
  console.log(`  模型          ${LLM.model} @ ${LLM.baseURL}`)
  console.log(`  前端产物      ${build.via}${build.note ? `（esbuild 不可用：${build.note}）` : ''}`)
  console.log(`  数据          ${DB_PATH}`)
  console.log(`  角色卡        ${persona().length} 字 · 案例库 ${cases().length} 字`)
  console.log(`  访谈轮数      ${MIN_ROUNDS}–${MAX_ROUNDS} 轮\n`)
})
