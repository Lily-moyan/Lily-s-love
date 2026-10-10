/* 管理后台：独立入口、独立账号，和业务前台不共享会话 */

const $ = (id) => document.getElementById(id);
const el = {
  gate: $('gate'), gateForm: $('gateForm'), gateError: $('gateError'),
  gateSubmit: $('gateSubmit'), gateSub: $('gateSub'),
  panel: $('panel'), adminName: $('adminName'), logoutBtn: $('logoutBtn'), llmChip: $('llmChip'),
  days: $('days'), refreshBtn: $('refreshBtn'), stats: $('stats'), spark: $('spark'),
  costTable: $('costTable'), costNote: $('costNote'), adminNav: $('adminNav'),
  setWarn: $('setWarn'), setFields: $('setFields'), setCheck: $('setCheck'),
  setChecks: $('setChecks'), setChecked: $('setChecked'),
  abFeature: $('abFeature'), abNewBtn: $('abNewBtn'), abHint: $('abHint'), abList: $('abList'),
  abEdit: $('abEdit'), abName: $('abName'), abWeight: $('abWeight'), abActive: $('abActive'),
  abNote: $('abNote'), abSystem: $('abSystem'), abSave: $('abSave'), abCancel: $('abCancel'),
  abFromBuiltin: $('abFromBuiltin'), abError: $('abError'),
  evFeature: $('evFeature'), evCaseAdd: $('evCaseAdd'), evRun: $('evRun'), evBatch: $('evBatch'),
  evCases: $('evCases'), evResult: $('evResult'),
  usersTable: $('usersTable'), featuresTable: $('featuresTable'), errors: $('errors'),
  prompts: $('prompts'), promptNote: $('promptNote'), adminsTable: $('adminsTable'),
  toast: $('toast'),
};

let setupMode = false;

/* 按钮忙碌态。app.js 里有同名的，后台之前没有——
   加它而不是改调用处，是为了两个页面的写法保持一致。 */
async function busy(btn, fn) {
  if (!btn || btn.disabled) return undefined;
  const text = btn.textContent;
  btn.disabled = true;
  btn.textContent = '处理中…';
  try { return await fn(); } finally {
    btn.disabled = false;
    btn.textContent = text;
  }
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
const fmtTokens = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : fmt(n));
const fmtTime = (iso) => (iso
  ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—');

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2600);
}

/* ---------------- 入口判定 ---------------- */
(async function boot() {
  try {
    const { admin, needsSetup } = await api('/admin/session');
    if (admin) return enter(admin);
    setupMode = needsSetup;
    if (needsSetup) {
      el.gateSub.textContent = '还没有管理员。第一次进来请设置一个——设置完这个入口就关闭了。';
      el.gateSubmit.textContent = '创建管理员';
      el.gateForm.password.autocomplete = 'new-password';
      el.gateForm.password.placeholder = '至少 8 位';
    }
    el.gate.classList.remove('hidden');
  } catch (err) {
    el.gate.classList.remove('hidden');
    el.gateError.textContent = err.message;
  }
})();

el.gateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  el.gateError.textContent = '';
  const fd = new FormData(el.gateForm);
  el.gateSubmit.disabled = true;
  try {
    const { admin } = await api(setupMode ? '/admin/setup' : '/admin/login', {
      method: 'POST',
      body: { username: fd.get('username'), password: fd.get('password') },
    });
    el.gate.classList.add('hidden');
    enter(admin);
  } catch (err) {
    el.gateError.textContent = err.message;
  } finally {
    el.gateSubmit.disabled = false;
  }
});

el.logoutBtn.addEventListener('click', async () => {
  await api('/admin/logout', { method: 'POST' });
  location.reload();
});

function enter(admin) {
  el.adminName.textContent = admin.username;
  el.panel.classList.remove('hidden');
  loadOverview();
  loadPrompts();
}

/* ---------------- 概览 ---------------- */
el.refreshBtn.addEventListener('click', loadOverview);
el.days.addEventListener('change', loadOverview);

async function loadOverview() {
  el.stats.innerHTML = '<div class="idea-skeleton"></div>'.repeat(4);
  try {
    const d = await api(`/admin/overview?days=${el.days.value}`);
    el.llmChip.textContent = d.llm.live ? `${d.llm.label} · ${d.llm.model}` : d.llm.label;
    el.llmChip.classList.toggle('warn', !d.llm.live);
    renderStats(d);
    renderUsers(d.users);
    renderFeatures(d.byFeature, d.errors);
    renderCost(d.cost);
    loadAB();
    loadEval();
    if (!el.adminNav.children.length) renderAdminNav();
    loadSettings();
    renderAdmins(d.admins);
  } catch (err) {
    el.stats.innerHTML = `<div class="ideas-state error">${esc(err.message)}</div>`;
    if (/登录/.test(err.message)) setTimeout(() => location.reload(), 1200);
  }
}

function renderStats(d) {
  const t = d.totals;
  const fail = t.calls - t.okCalls;
  el.stats.innerHTML = [
    ['用户数', fmt(d.users.length), `${d.users.filter((u) => u.drafts > 0).length} 人有创作`],
    ['创作总数', fmt(d.users.reduce((a, u) => a + u.drafts, 0)),
      `${fmt(d.users.reduce((a, u) => a + u.done_drafts, 0))} 篇已完成`],
    ['模型调用', fmt(t.calls), fail ? `${fail} 次失败` : '全部成功'],
    ['Token 合计', fmtTokens(t.inputTokens + t.outputTokens),
      `入 ${fmtTokens(t.inputTokens)} / 出 ${fmtTokens(t.outputTokens)}`],
    ['平均耗时', `${(t.avgMs / 1000).toFixed(1)}s`, `近 ${d.days} 天`],
  ].map(([k, v, sub]) =>
    `<div class="stat"><b>${esc(String(v))}</b><span>${esc(k)}</span><br><em>${esc(sub)}</em></div>`).join('');

  const max = Math.max(1, ...d.byDay.map((x) => x.calls));
  el.spark.innerHTML = d.byDay.map((x) => `
    <div class="bar" style="height:${Math.max(4, (x.calls / max) * 100)}%"
      title="${x.day}：${x.calls} 次调用 / ${fmtTokens(x.tokens)} tokens">
      <span>${x.day.slice(5)}</span>
    </div>`).join('');
}

/* 成本表。每行都标出用的哪个单价、是不是精确匹配到型号——
   估算就说是估算，别让人把这个数字当账单。 */
function renderCost(c) {
  if (!c) return;
  el.costNote.textContent = `${c.note}${c.unpriced ? ` · ${c.unpriced} 项未计价` : ''}`;
  el.costTable.innerHTML = `
    <thead><tr>
      <th>功能</th><th>模型</th><th class="num">次数</th><th class="num">计费量</th>
      <th>单价</th><th>免费额度</th><th class="num">估算</th>
    </tr></thead>
    <tbody>${c.rows.map((r) => `
      <tr>
        <td>${esc(r.feature)}</td>
        <td class="mono">${esc(r.model)}${r.exact ? '' : '<em title="没有这个型号的价，按同族估的">≈</em>'}</td>
        <td class="num">${fmt(r.calls)}</td>
        <td class="num">${r.units ? `${fmt(Math.round(r.units))} ${esc(r.unit || '')}`
    : fmtTokens((r.input_tokens || 0) + (r.output_tokens || 0))}</td>
        <td>${esc(r.price) || '—'}</td>
        <td>${esc(r.free) || '—'}</td>
        <td class="num">${r.yuan === null
    ? `<span class="dim">${r.demo ? '演示模式' : '未计价'}</span>` : `¥${r.yuan.toFixed(2)}`}</td>
      </tr>`).join('')}
      <tr class="total">
        <td colspan="6">合计（未扣免费额度）</td>
        <td class="num">¥${c.total.toFixed(2)}</td>
      </tr>
    </tbody>`;
}

function renderUsers(users) {
  el.usersTable.innerHTML = `
    <thead><tr>
      <th>用户</th><th>注册</th><th class="num">账号</th><th class="num">栏目</th>
      <th class="num">创作</th><th class="num">已完成</th><th class="num">语气样本</th>
      <th class="num">调用</th><th class="num">Tokens</th><th>最近活动</th>
    </tr></thead>
    <tbody>${users.map((u) => `
      <tr>
        <td>${esc(u.username)}</td>
        <td>${fmtTime(u.created_at)}</td>
        <td class="num">${u.personas}</td>
        <td class="num">${u.sections}</td>
        <td class="num">${u.drafts}</td>
        <td class="num">${u.done_drafts}</td>
        <td class="num">${u.samples}</td>
        <td class="num">${fmt(u.calls)}</td>
        <td class="num">${fmtTokens(u.tokens)}</td>
        <td>${fmtTime(u.last_call_at || u.last_draft_at)}</td>
      </tr>`).join('')}</tbody>`;
}

function renderFeatures(features, errors) {
  el.featuresTable.innerHTML = features.length ? `
    <thead><tr>
      <th>功能</th><th class="num">调用</th><th class="num">成功率</th>
      <th class="num">入 tokens</th><th class="num">出 tokens</th><th class="num">平均耗时</th>
    </tr></thead>
    <tbody>${features.map((f) => `
      <tr>
        <td>${esc(f.feature)}</td>
        <td class="num">${fmt(f.calls)}</td>
        <td class="num">${Math.round((f.ok_calls / f.calls) * 100)}%</td>
        <td class="num">${fmtTokens(f.input_tokens)}</td>
        <td class="num">${fmtTokens(f.output_tokens)}</td>
        <td class="num">${(f.avg_ms / 1000).toFixed(1)}s</td>
      </tr>`).join('')}</tbody>`
    : '<tbody><tr><td>这段时间还没有调用记录</td></tr></tbody>';

  el.errors.innerHTML = errors.map((e) => `
    <div class="err-row"><b>${esc(e.feature)}</b><span>${fmtTime(e.created_at)}</span><span>${esc(e.error)}</span></div>`).join('');
}

function renderAdmins(admins) {
  el.adminsTable.innerHTML = `
    <thead><tr><th>管理员</th><th>创建时间</th><th>最近登录</th></tr></thead>
    <tbody>${(admins || []).map((a) => `
      <tr><td>${esc(a.username)}</td><td>${fmtTime(a.created_at)}</td><td>${fmtTime(a.last_login)}</td></tr>`).join('')}</tbody>`;
}

/* ---------------- 提示词 ---------------- */
async function loadPrompts() {
  try {
    const { prompts, note } = await api('/admin/prompts');
    el.promptNote.textContent = note;
    el.prompts.innerHTML = prompts.map((p) => `
      <details class="prompt-item">
        <summary><b>${esc(p.label)}</b><span>${esc(p.where)}</span></summary>
        <div class="prompt-body">
          <h4>system 提示词</h4>
          <pre>${esc(p.system)}</pre>
          ${p.extra ? `<h4>逐个动作的指令</h4><pre>${esc(JSON.stringify(p.extra, null, 2))}</pre>` : ''}
          ${p.schema ? `<h4>输出结构（JSON Schema）</h4><pre>${esc(JSON.stringify(p.schema, null, 2))}</pre>` : ''}
        </div>
      </details>`).join('');
  } catch (err) {
    el.prompts.innerHTML = `<div class="ideas-state error">${esc(err.message)}</div>`;
  }
}

/* ==================================================================
 * 提示词 A/B 与 eval
 *
 * A/B 的意义全在"记下每次用了哪个变体"上。
 * eval 的打分分两层：确定性指标（客观、可复现、不花钱）+ 盲测人工对比。
 * **不用大模型当裁判**——让它评自己的输出，得到的是和气不是信号。
 * ================================================================== */

const ab = { features: [], variants: [], editing: null };
const ev = { cases: [], batch: '', result: null, voted: new Set() };

async function loadAB() {
  try {
    const f = el.abFeature.value || '';
    const d = await api(`/admin/variants${f ? `?feature=${f}` : ''}`);
    ab.features = d.features;
    ab.variants = d.variants;
    if (!el.abFeature.options.length) {
      const opts = d.features.map((x) => `<option value="${esc(x.key)}">${esc(x.label)}</option>`).join('');
      el.abFeature.innerHTML = opts;
      el.evFeature.innerHTML = opts;
      return loadAB();
    }
    renderAB();
  } catch (err) { el.abHint.textContent = err.message; }
}

function renderAB() {
  const live = ab.variants.filter((v) => v.active && v.weight > 0);
  el.abHint.textContent = live.length
    ? `线上分流中：内置 + ${live.length} 个变体（内置也参与，否则一开 A/B 就是全量换新提示词）`
    : '当前只有内置那份在跑';

  const builtin = ab.features.find((f) => f.key === el.abFeature.value)?.builtin || '';
  el.abList.innerHTML = `
    <div class="ab-row"><b>内置</b><span class="note">代码里的那份，${builtin.length} 字</span><span class="w">权重 1</span></div>`
    + ab.variants.map((v) => `
    <div class="ab-row ${v.active && v.weight > 0 ? 'on' : ''}">
      <b>${esc(v.name)}</b>
      <span class="note">${esc(v.note || `${v.system.length} 字`)}</span>
      <span class="w">权重 ${v.weight}${v.active ? '' : ' · 停用'}</span>
      <button class="mini" data-abedit="${v.id}">改</button>
      <button class="mini" data-abdel="${v.id}">删</button>
    </div>`).join('');
}

el.abFeature.addEventListener('change', loadAB);
el.abList.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.abedit) { openAB(ab.variants.find((v) => v.id === Number(t.dataset.abedit))); return; }
  if (t.dataset.abdel) {
    if (!await ask.confirm({ title: '删掉这个变体？', body: '已经跑过的 eval 结果不受影响。', ok: '删除', danger: true })) return;
    try { await api(`/admin/variants/${t.dataset.abdel}`, { method: 'DELETE' }); await loadAB(); } catch (err) { toast(err.message); }
  }
});

function openAB(v) {
  ab.editing = v?.id ?? null;
  el.abName.value = v?.name || '';
  el.abWeight.value = v?.weight ?? 1;
  el.abActive.checked = Boolean(v?.active);
  el.abNote.value = v?.note || '';
  el.abSystem.value = v?.system || '';
  el.abError.textContent = '';
  el.abEdit.classList.remove('hidden');
}

el.abNewBtn.addEventListener('click', () => openAB(null));
el.abCancel.addEventListener('click', () => el.abEdit.classList.add('hidden'));
el.abFromBuiltin.addEventListener('click', () => {
  el.abSystem.value = ab.features.find((f) => f.key === el.abFeature.value)?.builtin || '';
});

el.abSave.addEventListener('click', () => busy(el.abSave, async () => {
  const body = {
    feature: el.abFeature.value, name: el.abName.value.trim(),
    system: el.abSystem.value, weight: Number(el.abWeight.value),
    active: el.abActive.checked, note: el.abNote.value.trim(),
  };
  try {
    await api(ab.editing ? `/admin/variants/${ab.editing}` : '/admin/variants',
      { method: ab.editing ? 'PUT' : 'POST', body });
    el.abEdit.classList.add('hidden');
    await loadAB();
    toast('已保存');
  } catch (err) { el.abError.textContent = err.message; }
}));

/* ---------------- eval ---------------- */

async function loadEval() {
  try {
    const f = el.evFeature.value;
    ev.cases = (await api(`/admin/eval/cases?feature=${f}`)).cases;
    const { batches } = await api('/admin/eval/batches');
    el.evBatch.innerHTML = '<option value="">选一批结果…</option>'
      + batches.map((b) => `<option value="${esc(b.batch)}">${esc(b.batch)} · ${b.cases}用例×${b.variants}变体</option>`).join('');
    if (ev.batch) el.evBatch.value = ev.batch;
    renderCases();
  } catch (err) { el.evCases.innerHTML = `<p class="hint">${esc(err.message)}</p>`; }
}

function renderCases() {
  el.evCases.innerHTML = ev.cases.length ? ev.cases.map((c) => {
    let inp = {};
    try { inp = JSON.parse(c.input_json); } catch { /* 脏数据当空 */ }
    return `<div class="ev-case">
      <b>${esc(c.title)}</b>
      <span class="subj">${esc(inp.subject || '')}${inp.platform ? ` · ${esc(inp.platform)}` : ''}</span>
      <button class="mini" data-evdel="${c.id}">删</button>
    </div>`;
  }).join('') : '<p class="hint">还没有用例。用例是固定的输入，用来横向比不同变体——没有它，A/B 只能靠线上数据慢慢等。</p>';
}

el.evFeature.addEventListener('change', loadEval);
el.evCases.addEventListener('click', async (e) => {
  if (!e.target.dataset.evdel) return;
  try { await api(`/admin/eval/cases/${e.target.dataset.evdel}`, { method: 'DELETE' }); await loadEval(); } catch (err) { toast(err.message); }
});

el.evCaseAdd.addEventListener('click', async () => {
  // 一个浮层收完所有字段，比连着弹两次 prompt 好——中途取消也不会留下半条
  const v = await ask.form({
    title: '新增 eval 用例',
    body: '用例是固定的输入，用来横向比不同变体。',
    ok: '添加',
    fields: [
      { key: 'title', label: '用例名称', placeholder: '例：AI与组织', required: true },
      { key: 'subject', label: '题材（这一步的输入）', placeholder: '例：AI 用进团队之后，人真的变少了吗', required: true, multiline: true, rows: 2 },
      { key: 'platform', label: '平台', value: 'gongzhonghao' },
      { key: 'tone', label: '风格调性', value: '实用干货' },
    ],
  });
  if (!v) return;
  try {
    await api('/admin/eval/cases', { method: 'POST',
      body: { feature: el.evFeature.value, title: v.title,
        input: { subject: v.subject, platform: v.platform || 'gongzhonghao', tone: v.tone || '实用干货' } } });
    await loadEval();
  } catch (err) { toast(err.message); }
});

el.evRun.addEventListener('click', () => busy(el.evRun, async () => {
  if (!await ask.confirm({
    title: '跑一批 eval？',
    body: '每个用例 × 每个变体各跑一次，会真的调模型、真的花钱。',
    ok: '开跑',
  })) return;
  try {
    const r = await api('/admin/eval/run', { method: 'POST', body: { feature: el.evFeature.value } });
    ev.batch = r.batch;
    toast(`跑完了：${r.done} 次成功${r.failed ? `，${r.failed} 次失败` : ''}`);
    await loadEval();
    await showBatch(r.batch);
  } catch (err) { toast(err.message); }
}));

el.evBatch.addEventListener('change', () => el.evBatch.value && showBatch(el.evBatch.value));

async function showBatch(batch) {
  ev.batch = batch;
  ev.voted = new Set();
  el.evResult.innerHTML = '<div class="idea-skeleton"></div>';
  try {
    ev.result = await api(`/admin/eval/${batch}`);
  } catch (err) { el.evResult.innerHTML = `<p class="hint">${esc(err.message)}</p>`; return; }
  renderBatch();
}

function renderBatch() {
  const d = ev.result;
  const tally = new Map(d.votes.tally);

  el.evResult.innerHTML = `
    <h3 style="margin:18px 0 8px;font-size:14px">确定性指标<em style="font-weight:400;font-size:12px;color:var(--muted);margin-left:9px">
      客观、可复现、不花钱。中位数不是平均数。</em></h3>
    <table class="admin-table">
      <thead><tr><th>变体</th><th class="num">跑了</th><th class="num">失败</th>
        <th class="num">标签唯一</th><th class="num">有对照</th><th class="num">空字段</th>
        <th class="num">字数</th><th class="num">偏离目标</th><th class="num">格式痕迹</th><th class="num">耗时</th>
        <th class="num">盲测胜出</th></tr></thead>
      <tbody>${d.summary.map((s) => `<tr>
        <td>${esc(s.name)}</td>
        <td class="num">${s.runs}</td>
        <td class="num">${s.failed || '—'}</td>
        <td class="num">${s.labelsUnique}/${s.runs}</td>
        <td class="num">${s.contrastive ?? '—'}</td>
        <td class="num">${s.emptyFields ?? '—'}</td>
        <td class="num">${s.chars ?? '—'}</td>
        <td class="num">${s.lengthOff === null || s.lengthOff === undefined ? '—' : `${s.lengthOff > 0 ? '+' : ''}${s.lengthOff}%`}</td>
        <td class="num">${s.traceCount ?? '—'}</td>
        <td class="num">${(s.ms / 1000).toFixed(1)}s</td>
        <td class="num">${tally.get(s.name) || 0}</td>
      </tr>`).join('')}</tbody>
    </table>

    <h3 style="margin:22px 0 8px;font-size:14px">盲测<em style="font-weight:400;font-size:12px;color:var(--muted);margin-left:9px">
      隐去变体名，只看输出选一个。已投 ${d.votes.total} 次（${d.votes.ties} 次平局）</em></h3>
    ${d.cases.map((c) => blindPair(c)).join('')}`;
}

/* 盲测：随机左右，隐去变体名——知道哪边是新的，判断就已经偏了 */
function blindPair(c) {
  const ok = c.runs.filter((r) => !r.error);
  if (ok.length < 2) return `<p class="hint">「${esc(c.title)}」可比的输出不足两份。</p>`;
  const [a, b] = Math.random() < 0.5 ? [ok[0], ok[1]] : [ok[1], ok[0]];
  return `
    <div class="ev-block" data-case="${c.id}">
      <b style="font-size:13px">${esc(c.title)}</b>
      <div class="ev-pair">
        <div class="ev-side"><pre>${esc(a.output.slice(0, 2600))}</pre></div>
        <div class="ev-side"><pre>${esc(b.output.slice(0, 2600))}</pre></div>
      </div>
      <div class="ev-vote">
        <button class="btn ghost small" data-vote="${a.id}" data-l="${a.id}" data-r="${b.id}" data-c="${c.id}">左边更好</button>
        <button class="btn ghost small" data-vote="${b.id}" data-l="${a.id}" data-r="${b.id}" data-c="${c.id}">右边更好</button>
        <button class="btn ghost small" data-vote="0" data-l="${a.id}" data-r="${b.id}" data-c="${c.id}">差不多</button>
        <span class="grow"></span>
        <span class="ev-voted hidden">已记下</span>
      </div>
    </div>`;
}

el.evResult.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-vote]');
  if (!b) return;
  const wrap = b.closest('.ev-block');
  try {
    await api(`/admin/eval/${ev.batch}/vote`, { method: 'POST',
      body: { case_id: Number(b.dataset.c), left: Number(b.dataset.l), right: Number(b.dataset.r), winner: Number(b.dataset.vote) } });
    wrap.querySelectorAll('[data-vote]').forEach((x) => { x.disabled = true; });
    wrap.querySelector('.ev-voted').classList.remove('hidden');
  } catch (err) { toast(err.message); }
});

/* ==================================================================
 * 左侧分区导航
 *
 * 八个卡片堆在一列里往下滚，找一个东西要滚半天。
 * 一次只显示一个分区，加分区 = ADMIN_SECTIONS 里加一条 + HTML 上打个 data-sec。
 * ================================================================== */

const ADMIN_SECTIONS = [
  { key: 'overview', label: '概览', hint: '调用量与趋势' },
  { key: 'cost', label: '成本', hint: '按模型估算' },
  { key: 'ab', label: '提示词 A/B', hint: '变体与分流' },
  { key: 'eval', label: 'Eval', hint: '用例与盲测' },
  { key: 'pay', label: '支付接入', hint: '商户凭据与自检' },
  { key: 'usage', label: '功能用量', hint: '各功能与报错' },
  { key: 'prompts', label: '提示词', hint: '实际发出去的' },
  { key: 'users', label: '用户', hint: '注册与创作数' },
  { key: 'admins', label: '管理员', hint: '账号管理' },
];

const SEC_KEY = 'adminSection';

function renderAdminNav() {
  el.adminNav.innerHTML = ADMIN_SECTIONS.map((s) => `
    <button type="button" data-sec="${s.key}">${esc(s.label)}<i>${esc(s.hint)}</i></button>`).join('');
  let saved;
  try { saved = localStorage.getItem(SEC_KEY); } catch { saved = null; }
  showSection(ADMIN_SECTIONS.some((s) => s.key === saved) ? saved : 'overview');
}

function showSection(key) {
  // 概览那张卡里有走势图，切走再切回来要重画——但数据都在，不用重新请求
  document.querySelectorAll('.admin-main > .card').forEach((c) => {
    c.hidden = c.dataset.sec !== key;
  });
  el.adminNav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.sec === key));
  try { localStorage.setItem(SEC_KEY, key); } catch { /* 隐私模式 */ }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

el.adminNav.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-sec]');
  if (b) showSection(b.dataset.sec);
});

/* ==================================================================
 * 支付配置
 *
 * 私钥只写不读：界面上永远只看得到"已配置 · ****1234"。
 * env 里配了的锁住不给改——生产可以完全锁死在环境变量里。
 * ================================================================== */

async function loadSettings() {
  let d;
  try { d = await api('/admin/settings'); } catch (err) { el.setFields.innerHTML = `<p class="hint">${esc(err.message)}</p>`; return; }

  el.setWarn.textContent = d.warn || '';
  el.setWarn.className = d.warn ? 'hint error' : 'hint';

  const groups = [...new Set(d.fields.map((f) => f.group))];
  el.setFields.innerHTML = groups.map((g) => `
    <div class="set-group">
      <h4>${esc(g)}</h4>
      ${d.fields.filter((f) => f.group === g).map((f) => `
        <div class="set-row ${f.locked ? 'locked' : ''}">
          <span class="lab">${esc(f.label)}</span>
          <span class="val">${f.configured ? esc(f.preview) : `<span style="color:var(--faint)">${esc(f.hint || '未配置')}</span>`}</span>
          <span class="src ${f.source === 'env' ? 'env' : f.source ? '' : 'none'}">${
  f.source === 'env' ? '环境变量' : f.source ? '后台' : '未配置'}</span>
          ${f.locked
    ? '<span class="hint" style="font-size:11px">在服务器上改</span>'
    : `<button class="mini" data-set="${esc(f.key)}">${f.configured ? '更换' : '填写'}</button>`}
          ${f.configured && !f.locked ? `<button class="mini" data-clr="${esc(f.key)}">清空</button>` : ''}
        </div>`).join('')}
    </div>`).join('');
}

el.setFields.addEventListener('click', async (e) => {
  const set = e.target.closest('[data-set]');
  const clr = e.target.closest('[data-clr]');
  if (clr) {
    if (!await ask.confirm({ title: '清空这一项？', body: '清空后这个渠道会不可用。', ok: '清空', danger: true })) return;
    try { await api('/admin/settings', { method: 'POST', body: { key: clr.dataset.clr, value: '' } }); await loadSettings(); } catch (err) { toast(err.message); }
    return;
  }
  if (!set) return;
  const row = set.closest('.set-row');
  const label = row.querySelector('.lab').textContent;
  const multiline = /私钥|公钥/.test(label);
  const v = await ask.form({
    title: `填写${label}`,
    body: multiline ? '粘贴 PEM 全文，包含 BEGIN / END 那两行。' : '',
    ok: '保存',
    fields: [{ key: 'value', label, required: true, multiline, rows: multiline ? 6 : 1 }],
  });
  if (!v) return;
  try {
    await api('/admin/settings', { method: 'POST', body: { key: set.dataset.set, value: v.value } });
    await loadSettings();
    toast('已保存');
  } catch (err) { toast(err.message); }
});

el.setCheck.addEventListener('click', () => busy(el.setCheck, async () => {
  try {
    const d = await api('/admin/settings/check');
    el.setChecked.textContent = `当前通道：${d.provider}${d.live ? '' : '（演示模式，不会真扣款）'}`;
    el.setChecks.innerHTML = d.checks.map((c) => `
      <div class="chk-row">
        <span class="dot ${c.ok ? 'ok' : ''}"></span>
        <span class="n">${esc(c.name)}</span>
        <span class="d">${esc(c.detail)}</span>
        <span class="h">${esc(c.hint || '')}</span>
      </div>`).join('');
  } catch (err) { toast(err.message); }
}));
