const fs = require('fs');
const SRC = 'G:/dsh/gaokao-3500/_source/';

// 1) qwerty 表里到底有没有这些词
const gk = JSON.parse(fs.readFileSync(SRC + 'GaoKao_3500.json', 'utf8'));
const names = gk.map((x) => x.name.trim().toLowerCase());
console.log('qwerty GaoKao_3500 前 20:', names.slice(0, 20).join(' '));
for (const w of ['meet', 'assign', 'resent', 'indifferent', 'book', 'water']) {
  console.log('  含', w, '?', names.indexOf(w) >= 0);
}
console.log('qwerty 含空格的条目数:', gk.filter((x) => /\s/.test(x.name.trim())).length);
const head = {};
for (const n of names) head[n] = (head[n] || 0) + 1;
const dup = Object.entries(head).filter(([, c]) => c > 1);
console.log('重复条目:', dup.length, dup.slice(0, 5).map(([k, c]) => k + 'x' + c).join(' '));

// 2) maimemo CSV 解析（字段里有换行，需要状态机）
const raw = fs.readFileSync(SRC + 'maimemo-gaokao3500.csv', 'utf8').replace(/^\uFEFF/, '');
const recs = [];
let field = '', row = [], inQ = false;
for (let i = 0; i < raw.length; i++) {
  const c = raw[i];
  if (inQ) {
    if (c === '"') {
      if (raw[i + 1] === '"') { field += '"'; i++; } else inQ = false;
    } else field += c;
  } else if (c === '"') inQ = true;
  else if (c === ',') { row.push(field); field = ''; }
  else if (c === '\n') { row.push(field); recs.push(row); row = []; field = ''; }
  else if (c !== '\r') field += c;
}
if (field || row.length) { row.push(field); recs.push(row); }
console.log('maimemo 记录数:', recs.length, '| 字段数:', recs[0] && recs[0].length);
console.log('示例:', JSON.stringify(recs.slice(1, 3), null, 1));
const mNames = recs.slice(1).map((r) => (r[0] || '').trim().toLowerCase()).filter(Boolean);
console.log('maimemo 词条数:', mNames.length);
for (const w of ['meet', 'assign', 'resent', 'indifferent', 'abandon', 'thorough']) {
  console.log('  含', w, '?', mNames.indexOf(w) >= 0);
}
const mSet = new Set(mNames);
const gSet = new Set(names);
const onlyM = [...mSet].filter((w) => !gSet.has(w));
const onlyG = [...gSet].filter((w) => !mSet.has(w));
console.log('只在 maimemo 里的:', onlyM.length, '| 只在 qwerty 里的:', onlyG.length);
console.log('并集:', new Set([...mSet, ...gSet]).size);
