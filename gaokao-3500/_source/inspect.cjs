const fs = require('fs');
const p = 'G:/dsh/gaokao-3500/_source/';
for (const f of ['GaoKao_3500.json', 'GaoKaoZhenTiHeXinGaoPin.json', 'gaokao-yuedu-gaopin.json']) {
  const j = JSON.parse(fs.readFileSync(p + f, 'utf8'));
  console.log('===', f, '| 条目数:', j.length, '| 字段:', Object.keys(j[0]).join(','));
  console.log(JSON.stringify(j.slice(0, 2), null, 1));
}
const csv = fs.readFileSync(p + 'maimemo-gaokao3500.csv', 'utf8').split(/\r?\n/);
console.log('=== maimemo CSV | 行数:', csv.length);
console.log(csv.slice(0, 4).join('\n'));
const w = {};
for (const j of [JSON.parse(fs.readFileSync(p + 'GaoKao_3500.json', 'utf8'))]) {
  for (const it of j) {
    const k = it.name.length;
    w[k] = (w[k] || 0) + 1;
  }
}
console.log('=== 词长分布(前10):', Object.entries(w).slice(0, 10).map(([a, b]) => a + ':' + b).join(' '));
