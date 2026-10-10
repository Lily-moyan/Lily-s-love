const fs = require('fs');
const SRC = 'G:/dsh/gaokao-3500/_source/';

// qwerty 里是否真的没有 meet
const gkRaw = fs.readFileSync(SRC + 'GaoKao_3500.json', 'utf8');
for (const w of ['meet', 'assign', 'resent', 'abandon']) {
  const re = new RegExp('"name"\\s*:\\s*"' + w + '"', 'i');
  console.log('raw 搜索', w, ':', re.test(gkRaw));
}

// 解析 maimemo 并分类
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
const pairs = recs.slice(1).filter((r) => r[0] && r[0].trim()).map((r) => ({ w: r[0].trim(), trans: (r[1] || '').trim() }));

const single = pairs.filter((p) => !/[\s\-]/.test(p.w));
const multi = pairs.filter((p) => /[\s\-]/.test(p.w));
console.log('maimemo 总条:', pairs.length, '| 单词:', single.length, '| 含空格/连字符:', multi.length);
console.log('单词示例:', single.slice(0, 8).map((p) => p.w).join(' '));
console.log('多词示例:', multi.slice(0, 12).map((p) => p.w).join(' | '));

// 单词里是否夹了奇怪东西
const weird = single.filter((p) => !/^[a-zA-Z.'()]+$/.test(p.w));
console.log('非常规单词:', weird.length, weird.slice(0, 15).map((p) => p.w).join(' '));

// 常用基础词是否齐
for (const w of ['meet', 'go', 'eat', 'the', 'assign', 'book', 'water', 'thorough']) {
  const hit = pairs.find((p) => p.w.toLowerCase() === w);
  console.log('  ', w, hit ? '有 | ' + hit.trans.slice(0, 28).replace(/\n/g, ' ') : '缺');
}
