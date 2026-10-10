// 抓取公开的高考 3500 词表（只用于本地整理）
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;

function get(url, redirects) {
  redirects = redirects === undefined ? 5 : redirects;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects > 0) {
        r.resume();
        return resolve(get(new URL(r.headers.location, url).href, redirects - 1));
      }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, buf: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

(async () => {
  // 1) qwerty-learner 词典目录
  try {
    const r = await get('https://api.github.com/repos/Kaiyiwing/qwerty-learner/contents/public/dicts');
    console.log('API status', r.status);
    if (r.status === 200) {
      const list = JSON.parse(r.buf.toString('utf8'));
      fs.writeFileSync(path.join(OUT, 'qwerty-dicts.json'), JSON.stringify(list, null, 2));
      console.log('词典数:', list.length);
      list.forEach((it) => console.log('  -', it.name, it.size));
    } else {
      console.log(r.buf.toString('utf8').slice(0, 300));
    }
  } catch (e) {
    console.log('API 失败:', e.message);
  }

  // 2) maimemo 导出的高考 3500 CSV
  const csvUrl = 'https://raw.githubusercontent.com/busiyiworld/maimemo-export/main/exported/translation/' +
    encodeURIComponent('星火抗遗忘高考英语3500词.csv');
  try {
    const r = await get(csvUrl);
    console.log('CSV status', r.status, r.buf.length, 'bytes');
    if (r.status === 200) fs.writeFileSync(path.join(OUT, 'maimemo-gaokao3500.csv'), r.buf);
  } catch (e) {
    console.log('CSV 失败:', e.message);
  }
})();
