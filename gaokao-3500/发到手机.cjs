// 把工作台 + 3500 词文档一起发到手机
// 用法：node "gaokao-3500/发到手机.cjs"
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);

const ROUTES = {
  '/': { index: true },
  '/workbench': { file: path.join(ROOT, '轻松版', '工作台.html'), type: 'text/html; charset=utf-8' },
  '/lookup': { file: path.join(ROOT, '文档', '高考3500词-速查表.html'), type: 'text/html; charset=utf-8' },
  '/docx': { file: path.join(ROOT, '文档', '高考3500词-完整文档.docx'), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', download: '高考3500词-完整文档.docx' },
  '/csv': { file: path.join(ROOT, '文档', '高考3500词-完整表.csv'), type: 'text/csv; charset=utf-8', download: '高考3500词-完整表.csv' },
  '/md': { file: path.join(ROOT, '文档', '高考3500词-完整表.md'), type: 'text/plain; charset=utf-8', download: '高考3500词-完整表.md' },
  '/cuoci': { file: path.join(ROOT, '错词本.md'), type: 'text/plain; charset=utf-8' },
  '/plan': { file: path.join(ROOT, '备考方案.md'), type: 'text/plain; charset=utf-8' },
};

const LINKS = [
  ['/workbench', '🌞 每日一个小故事（工作台）', '一天 1 个词，点句子能听读，学完贴星星'],
  ['/lookup', '🔎 3500 词速查表', '手机最好用：可搜英文/中文，能按 ★真题高频、●阅读高频、✎我的错词筛选'],
  ['/docx', '📄 完整文档 Word（.docx）', '点一下下载到手机，用 WPS / Word 打开'],
  ['/csv', '📊 完整表 CSV', 'Excel / WPS 表格打开，或导入 Anki'],
  ['/md', '📝 完整表 Markdown', '纯文本，任何地方都能看'],
  ['/cuoci', '✎ 我的错词本', '实测写错的词 + 复习打勾表'],
  ['/plan', '📘 科学记忆方案', '原理、每日流程、时间表、工具设置'],
];

function indexPage() {
  let items = '';
  for (const [href, title, desc] of LINKS) {
    const exists = ROUTES[href] && fs.existsSync(ROUTES[href].file);
    items += '<a class="card' + (exists ? '' : ' off') + '" href="' + href + '">' +
      '<div class="t">' + title + (exists ? '' : '（文件还没生成）') + '</div>' +
      '<div class="d">' + desc + '</div></a>';
  }
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>高考英语 3500 词 · 手机端</title>
<style>
 *{box-sizing:border-box}
 body{margin:0;background:#fdf6e8;color:#2d3142;font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;padding:18px 14px 40px;-webkit-text-size-adjust:100%}
 h1{font-size:1.3rem;margin:0 0 4px}
 .sub{color:#8a8f9e;font-size:.9rem;margin-bottom:16px}
 a.card{display:block;text-decoration:none;color:inherit;background:#fff;border:2px solid #eae2d4;border-radius:18px;padding:14px 16px;margin-bottom:10px}
 a.card:active{background:#f7f2e6}
 a.card .t{font-weight:700;font-size:1.05rem;margin-bottom:3px}
 a.card .d{color:#8a8f9e;font-size:.86rem;line-height:1.5}
 a.card.off{opacity:.45}
 .foot{margin-top:18px;color:#a9adb8;font-size:.8rem;line-height:1.6}
</style></head>
<body>
<h1>高考英语 3500 词</h1>
<div class="sub">手机端入口 · 跟电脑连同一个 Wi-Fi 就能用</div>
${items}
<div class="foot">这些页面只在电脑开着、这个分享运行时可用；关掉分享就停了。<br>Word 文档点开是下载，下到手机后用 WPS 打开。</div>
</body></html>`;
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }

  const route = ROUTES[url];
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<meta charset="utf-8"><p>404 · 没这个页面，回 <a href="/">首页</a></p>');
    return;
  }

  if (route.index) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(indexPage());
    return;
  }

  fs.readFile(route.file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<meta charset="utf-8"><p>文件还没生成：' + path.basename(route.file) + '，回 <a href="/">首页</a></p>');
      return;
    }
    const headers = { 'Content-Type': route.type, 'Cache-Control': 'no-store', 'Content-Length': buf.length };
    if (route.download) {
      headers['Content-Disposition'] = 'attachment; filename="gaokao3500' + path.extname(route.download) +
        '"; filename*=UTF-8\'\'' + encodeURIComponent(route.download);
    }
    res.writeHead(200, headers);
    res.end(buf);
  });
});

function lanAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const info of ifs[name] || []) {
      if (info.family === 'IPv4' && !info.internal) out.push({ name, ip: info.address });
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  手机端已就绪 · 手机跟电脑连同一个 Wi-Fi');
  console.log('  ------------------------------------------------');
  for (const it of lanAddresses()) {
    console.log('  手机浏览器打开:  http://' + it.ip + ':' + PORT + '/     [' + it.name + ']');
  }
  console.log('  电脑自测:        http://127.0.0.1:' + PORT + '/');
  console.log('  ------------------------------------------------');
  console.log('  首页列出全部内容：工作台 / 速查表 / Word 文档 / CSV / 错词本 / 方案');
  console.log('  打不开先确认同一个 Wi-Fi；被防火墙拦了就允许 node 的"专用网络"。');
  console.log('');
});

server.on('error', (e) => {
  console.log('启动失败：' + e.message);
  if (e.code === 'EADDRINUSE') console.log('端口被占用，换一个：set PORT=8899 && node "gaokao-3500\\发到手机.cjs"');
});
