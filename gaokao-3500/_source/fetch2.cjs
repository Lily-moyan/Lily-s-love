// 从 qwerty-learner 词库下载高考相关词表
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const WANT = [
  'GaoKao_3500.json',
  'GaoKaoZhenTiHeXinGaoPin.json',
  'gaokao-yuedu-gaopin.json',
];

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
  const listing = JSON.parse(fs.readFileSync(path.join(OUT, 'qwerty-dicts.json'), 'utf8'));
  for (const name of WANT) {
    const item = listing.find((x) => x.name === name);
    if (!item) { console.log('未找到', name); continue; }
    const r = await get(item.download_url);
    console.log(name, '->', r.status, r.buf.length, 'bytes');
    if (r.status === 200) fs.writeFileSync(path.join(OUT, name), r.buf);
  }
})();
