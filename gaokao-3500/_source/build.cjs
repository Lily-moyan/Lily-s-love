// 高考 3500 词整理：底表用「星火抗遗忘高考英语3500词」，音标用 qwerty GaoKao_3500 补齐
// 产出：Markdown / CSV / 速查 HTML / 供 docx 使用的 normalized.json
const fs = require('fs');

const SRC = 'G:/dsh/gaokao-3500/_source/';
const OUT = 'G:/dsh/gaokao-3500/文档/';
fs.mkdirSync(OUT, { recursive: true });

const K = (s) => String(s).trim().toLowerCase();

/* ---------- 1. 音标表（qwerty） ---------- */
const phoneMap = {};
for (const it of JSON.parse(fs.readFileSync(SRC + 'GaoKao_3500.json', 'utf8'))) {
  const k = K(it.name);
  if (!phoneMap[k]) phoneMap[k] = { us: String(it.usphone || '').trim(), uk: String(it.ukphone || '').trim() };
}

/* ---------- 2. 高频标记集 ---------- */
const zhenti = JSON.parse(fs.readFileSync(SRC + 'GaoKaoZhenTiHeXinGaoPin.json', 'utf8'));
const yuedu = JSON.parse(fs.readFileSync(SRC + 'gaokao-yuedu-gaopin.json', 'utf8'));
const zMap = {}, yMap = {};
for (const x of zhenti) zMap[K(x.name)] = (x.trans || []).map((s) => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean);
for (const x of yuedu) yMap[K(x.name)] = (x.trans || []).map((s) => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean);

/* ---------- 3. 个人错词（alias 覆盖变形） ---------- */
const MINE = [
  ['assign', 'assign', '分配、布置（任务）；指派　辨析：assess = 评估'],
  ['resent', 'resent', '怨恨，憎恶　resent doing / resent being done；resend 才是"重发"'],
  ['thorough', 'thorough', '彻底的，缜密的　对比：through = 穿过'],
  ['indifferent', 'indifferent', '漠不关心的　be indifferent to'],
  ['compromise', 'compromise', '妥协，折中　reach a compromise；composition = 作文/构成'],
  ['appreciate', 'appreciate', '感激；欣赏；领会　I would appreciate it if…'],
  ['variety', 'variety', '多样性，种类　vary → variety'],
  ['application', 'application', '申请；应用　apply → application'],
  ['description', 'description', '描述　describe → description'],
  ['embarrass', 'embarrassing / embarrassed', '两 r 两 s；-ing 修饰事（令人尴尬），-ed 修饰人（感到尴尬）'],
  ['independent', 'independent', '独立的　in- + depend + -ent'],
  ['worth', 'worth', '值得　be worth doing（主动形式表被动）'],
  ['meet', 'meet', '遇见；满足　meet the needs；meet with = 遭遇'],
  ['accommodation', 'accommodation', '住宿，膳宿　两 c 两 m'],
  ['recommend', 'recommend', '推荐　两 c 一个 m'],
  ['necessary', 'necessary', '必要的　一个 c 两个 s'],
  ['disappoint', 'disappointed / disappointing', '人用 -ed（感到失望），事用 -ing（令人失望）'],
  ['argument', 'argument', '争论；论点　argue 去掉 e + -ment'],
  ['decision', 'decision', '决定（名词）　decide → decision'],
  ['convenient', 'convenient', '方便的　It is convenient for sb to do sth'],
  ['last', 'last', '最后的；最不可能的　the last person to do sth'],
  ['company', 'company', '公司；陪伴　keep sb company = 陪某人'],
  ['knowledge', 'knowledge', '知识　k 不发音'],
  ['effect', 'effect', '名词：影响，效果　have an effect on'],
  ['affect', 'affect', '动词：影响'],
];
const mineKeys = new Set(MINE.map((m) => m[0]));

/* ---------- 4. 解析星火 CSV（字段内含换行） ---------- */
const raw = fs.readFileSync(SRC + 'maimemo-gaokao3500.csv', 'utf8').replace(/^\uFEFF/, '');
const recs = [];
let field = '', row = [], inQ = false;
for (let i = 0; i < raw.length; i++) {
  const c = raw[i];
  if (inQ) {
    if (c === '"') { if (raw[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
    else field += c;
  } else if (c === '"') inQ = true;
  else if (c === ',') { row.push(field); field = ''; }
  else if (c === '\n') { row.push(field); recs.push(row); row = []; field = ''; }
  else if (c !== '\r') field += c;
}
if (field || row.length) { row.push(field); recs.push(row); }

const seen = new Set();
const entries = [];
for (const r of recs.slice(1)) {
  const w = (r[0] || '').trim();
  const tr = (r[1] || '').trim();
  if (!w || seen.has(K(w))) continue;
  seen.add(K(w));
  const key = K(w);
  const ph = phoneMap[key] || { us: '', uk: '' };
  const trans = tr.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  entries.push({
    word: w,
    key,
    kind: /[\s\-]/.test(w) ? 'phrase' : 'word',
    us: ph.us,
    uk: ph.uk,
    trans: trans.length ? trans : ['（暂无释义）'],
    zhenti: !!zMap[key],
    yuedu: !!yMap[key],
    mine: mineKeys.has(key),
  });
}

/* ---------- 5. 真题高频里不在本表的补充词 ---------- */
const extra = [];
for (const x of zhenti) {
  const key = K(x.name);
  if (seen.has(key)) continue;
  const ph = phoneMap[key] || { us: '', uk: '' };
  extra.push({
    word: String(x.name).trim(), key, kind: 'word', us: ph.us, uk: ph.uk,
    trans: (x.trans || []).map((s) => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean),
    zhenti: true, yuedu: !!yMap[key], mine: false,
  });
}
extra.sort((a, b) => a.key.localeCompare(b.key));

/* ---------- 6. 分组排序 ---------- */
const LETTER = (w) => {
  const c = w[0].toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
};
const sorter = (a, b) => {
  const la = LETTER(a.word), lb = LETTER(b.word);
  if (la !== lb) return la === '#' ? 1 : lb === '#' ? -1 : la.localeCompare(lb);
  return a.key.localeCompare(b.key);
};
const words = entries.filter((e) => e.kind === 'word').sort(sorter);
const phrases = entries.filter((e) => e.kind === 'phrase').sort(sorter);
const zhead = words.filter((e) => e.zhenti).concat(extra.filter((e) => e.zhenti)).sort(sorter);

const group = (list) => {
  const gs = [];
  for (const e of list) {
    const L = LETTER(e.word);
    let g = gs[gs.length - 1];
    if (!g || g.letter !== L) { g = { letter: L, items: [] }; gs.push(g); }
    g.items.push(e);
  }
  return gs;
};
words.forEach((e, i) => { e.no = i + 1; });
phrases.forEach((e, i) => { e.no = i + 1; });
extra.forEach((e, i) => { e.no = i + 1; });

const stats = {
  words: words.length,
  phrases: phrases.length,
  total: entries.length,
  zhenti: zhead.length,
  yuedu: entries.filter((e) => e.yuedu).length,
  mine: entries.filter((e) => e.mine).length,
  withPhone: entries.filter((e) => e.us).length,
  extraZhenti: extra.length,
};

const t = (e) => e.trans.join('；').replace(/\|/g, '／');
const flags = (e) => [e.zhenti ? '★' : '', e.yuedu ? '●' : '', e.mine ? '✎' : ''].filter(Boolean).join('');

/* ---------- 7. Markdown ---------- */
let md = '# 高考英语 3500 词 · 完整文档\n\n';
md += `> 单词 **${stats.words}** 个　短语/合成词 **${stats.phrases}** 条　合计 **${stats.total}** 条\n`;
md += `> ★ 真题核心高频 **${stats.zhenti}**（含补充 ${stats.extraZhenti}）　● 阅读高频 **${stats.yuedu}**　✎ 个人错词 **${stats.mine}**　带音标 **${stats.withPhone}**\n\n`;
md += '**图例**：★ 高考真题核心高频词（时间紧先背这批）　● 高考阅读高频词　✎ 本人实测错词（见第四部分）\n\n';
md += '**用法**：遮住释义自测；2 秒内答对打勾，犹豫或答错抄进自己的错词本，按 D+1 / D+2 / D+4 / D+7 / D+15 复习。\n\n---\n\n';
md += `## 一、★ 真题核心高频 ${stats.zhenti} 词\n\n| # | 单词 | 音标(美) | 释义 |\n|---|---|---|---|\n`;
zhead.forEach((e, i) => { md += `| ${i + 1} | ${e.word} | ${e.us} | ${t(e)} |\n`; });
md += '\n---\n\n## 二、A–Z 单词表\n\n';
for (const g of group(words)) {
  md += `### ${g.letter}\n\n| # | 单词 | 音标(美) | 释义 | 标记 |\n|---|---|---|---|---|\n`;
  for (const e of g.items) md += `| ${e.no} | ${e.word} | ${e.us} | ${t(e)} | ${flags(e)} |\n`;
  md += '\n';
}
md += '---\n\n## 三、短语与合成词\n\n';
for (const g of group(phrases)) {
  md += `### ${g.letter}\n\n| # | 短语 | 释义 | 标记 |\n|---|---|---|---|\n`;
  for (const e of g.items) md += `| ${e.no} | ${e.word} | ${t(e)} | ${flags(e)} |\n`;
  md += '\n';
}
if (extra.length) {
  md += '---\n\n## 附、真题高频补充词（不在上表内）\n\n| # | 单词 | 音标(美) | 释义 |\n|---|---|---|---|\n';
  extra.forEach((e, i) => { md += `| ${i + 1} | ${e.word} | ${e.us} | ${t(e)} |\n`; });
  md += '\n';
}
md += '---\n\n## 四、我的错词本（本次实测抓取）\n\n| # | 单词 | 中文 / 辨析 |\n|---|---|---|\n';
MINE.forEach((m, i) => { md += `| ${i + 1} | ${m[1]} | ${m[2]} |\n`; });
md += '\n> 带复习打勾表的完整版见 `错词本.md`；Anki 卡见 `错词本-anki.csv`。\n';
fs.writeFileSync(OUT + '高考3500词-完整表.md', md, 'utf8');

/* ---------- 8. CSV ---------- */
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
let csv = '序号,类型,单词,音标(美),音标(英),释义,标记,真题高频,阅读高频,个人错词\n';
const all = words.concat(phrases).sort(sorter);
all.forEach((e, i) => {
  csv += [i + 1, e.kind === 'word' ? '单词' : '短语', q(e.word), q(e.us), q(e.uk), q(t(e)),
    q(flags(e)), e.zhenti ? 'Y' : '', e.yuedu ? 'Y' : '', e.mine ? 'Y' : ''].join(',') + '\n';
});
extra.forEach((e, i) => {
  csv += [all.length + i + 1, '真题补充', q(e.word), q(e.us), q(e.uk), q(t(e)), q('★'), 'Y', e.yuedu ? 'Y' : '', ''].join(',') + '\n';
});
fs.writeFileSync(OUT + '高考3500词-完整表.csv', '\ufeff' + csv, 'utf8');

/* ---------- 9. 速查 HTML ---------- */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mineTip = {};
MINE.forEach((m) => { mineTip[m[0]] = m[2]; });
let rows = '';
const emitRow = (e, idx) => {
  const f = flags(e);
  rows += '<tr data-k="' + esc((e.word + ' ' + e.trans.join(' ')).toLowerCase()) + '" data-f="' + f + '" data-t="' + e.kind + '">' +
    '<td class="no">' + idx + '</td>' +
    '<td class="w">' + esc(e.word) + '</td>' +
    '<td class="ph">' + esc(e.us) + '</td>' +
    '<td class="tr">' + esc(t(e)) + (e.mine && mineTip[e.key] ? ' <b class="mine">✎ ' + esc(mineTip[e.key]) + '</b>' : '') + '</td>' +
    '<td class="fl">' + esc(f) + '</td></tr>';
};
all.forEach((e, i) => emitRow(e, i + 1));
extra.forEach((e, i) => emitRow(e, all.length + i + 1));
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>高考英语 3500 词速查表</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f7f7f2;color:#22262e;font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;padding:14px 12px 40px;-webkit-text-size-adjust:100%}
  h1{font-size:1.25rem;margin:0 0 4px}
  .meta{color:#7b8090;font-size:.86rem;margin-bottom:10px;line-height:1.6}
  .bar{position:sticky;top:0;background:#f7f7f2;padding:8px 0 10px;z-index:5;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  input[type=search]{flex:1 1 220px;padding:11px 14px;border:2px solid #e2e0d6;border-radius:14px;font-size:1rem;font-family:inherit;background:#fff}
  button{padding:11px 14px;border:2px solid #e2e0d6;background:#fff;border-radius:14px;font-size:.95rem;font-family:inherit;cursor:pointer;touch-action:manipulation}
  button.on{background:#2b6cb0;border-color:#2b6cb0;color:#fff}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(60,60,50,.06)}
  th{background:#eef2f7;font-size:.82rem;color:#5a6070;text-align:left;padding:9px 10px}
  td{padding:8px 10px;border-top:1px solid #f0eee6;vertical-align:top;font-size:.95rem}
  td.no{color:#b3b7c2;font-size:.8rem;width:3.4em}
  td.w{font-weight:700}
  td.ph{color:#7b8090;font-size:.85rem;white-space:nowrap}
  td.fl{text-align:center;white-space:nowrap}
  b.mine{color:#c2410c;font-weight:700;display:block;font-size:.85rem}
  #count{color:#7b8090;font-size:.85rem;margin-left:auto}
  @media (max-width:600px){td.ph{display:none}th:nth-child(3){display:none}}
</style>
</head>
<body>
<h1>高考英语 3500 词 · 速查表</h1>
<div class="meta">单词 ${stats.words}　短语 ${stats.phrases}　合计 ${stats.total}　|　★ 真题核心高频 ${stats.zhenti}　● 阅读高频 ${stats.yuedu}　✎ 个人错词 ${stats.mine}</div>
<div class="bar">
  <input type="search" id="q" placeholder="输入英文或中文，例如 abandon / 放弃" autocomplete="off">
  <button class="on" data-f="all">全部</button>
  <button data-f="★">★ 真题高频</button>
  <button data-f="●">● 阅读高频</button>
  <button data-f="✎">✎ 我的错词</button>
  <button data-f="p">仅短语</button>
  <span id="count"></span>
</div>
<table>
<thead><tr><th>#</th><th>单词/短语</th><th>音标(美)</th><th>释义</th><th>标记</th></tr></thead>
<tbody id="tb">
${rows}
</tbody>
</table>
<script>
var q=document.getElementById('q'),tb=document.getElementById('tb'),cnt=document.getElementById('count');
var rows=[].slice.call(tb.rows),filter='all';
function apply(){
  var s=q.value.trim().toLowerCase(),n=0;
  for(var i=0;i<rows.length;i++){
    var r=rows[i],okText=!s||r.getAttribute('data-k').indexOf(s)>=0;
    var f=r.getAttribute('data-f')||'',t=r.getAttribute('data-t');
    var okF=filter==='all'||(filter==='p'?t==='phrase':f.indexOf(filter)>=0);
    var show=okText&&okF;
    r.style.display=show?'':'none';
    if(show)n++;
  }
  cnt.textContent='显示 '+n+' / '+rows.length;
}
q.addEventListener('input',apply);
var bs=document.querySelectorAll('.bar button');
for(var i=0;i<bs.length;i++){bs[i].onclick=function(){
  filter=this.getAttribute('data-f');
  for(var j=0;j<bs.length;j++)bs[j].className='';
  this.className='on';apply();
};}
apply();
</script>
</body>
</html>`;
fs.writeFileSync(OUT + '高考3500词-速查表.html', html, 'utf8');

/* ---------- 10. normalized.json ---------- */
fs.writeFileSync(SRC + 'normalized.json', JSON.stringify({
  stats,
  mine: MINE.map((m) => ({ key: m[0], display: m[1], tip: m[2] })),
  zhead,
  groups: group(words),
  phraseGroups: group(phrases),
  extra,
}, null, 1), 'utf8');

console.log('统计:', JSON.stringify(stats, null, 1));
