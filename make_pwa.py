# -*- coding: utf-8 -*-
"""
把行业分析工作台（演示版）改造成 PWA —— 可「添加到主屏幕」，体验≈原生 App
在 demo 目录内新增/修改：
  manifest.json      应用清单
  sw.js              Service Worker（离线缓存）
  icon-192.png       图标
  icon-512.png       图标
  apple-touch-icon.png  iOS 图标
  index.html         注入 manifest 链接 / iOS meta / SW 注册 / 安装按钮
"""
import io, os, sys, zlib, struct, math

DIR = r'G:\dsh\行业分析工作台-演示版'
HTML = os.path.join(DIR, 'index.html')

# ============================================================
# 1. 生成图标（优先 Pillow；没有则用纯 Python 写 PNG）
# ============================================================
BG      = (20, 24, 31)
BAR_A   = (81, 207, 102)    # 绿 = A 档
BAR_B   = (92, 124, 250)    # 蓝 = B 档
BAR_C   = (107, 114, 128)   # 灰 = C 档
BARS = [(BAR_A, 0.62), (BAR_B, 0.46), (BAR_C, 0.30)]  # (颜色, 宽度占比)

def draw_with_pillow(size):
    from PIL import Image, ImageDraw
    S = size
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(S * 0.22)
    # 圆角底
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=BG)
    # 三条分级横条
    bar_h = int(S * 0.085)
    gap   = int(S * 0.075)
    total = bar_h * 3 + gap * 2
    top   = (S - total) // 2
    left  = int(S * 0.19)
    for i, (color, ratio) in enumerate(BARS):
        w = int(S * 0.62 * ratio / 0.62 * (ratio / 0.62) if False else S * ratio * 0.78)
        y = top + i * (bar_h + gap)
        d.rounded_rectangle([left, y, left + w, y + bar_h], radius=bar_h // 2, fill=color)
    return img

def write_png_raw(path, size):
    """纯 Python 生成 PNG（无依赖兜底）：圆角底 + 三条分级横条，带简单抗锯齿"""
    S = size
    r = S * 0.22
    bar_h = S * 0.085
    gap = S * 0.075
    total = bar_h * 3 + gap * 2
    top = (S - total) / 2.0
    left = S * 0.19
    bands = []
    for color, ratio in BARS:
        w = S * ratio * 0.78
        bands.append((color, left, left + w))
    px = bytearray()
    ss = 3  # 超采样抗锯齿
    for y in range(S):
        px.append(0)
        for x in range(S):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    fx = x + (sx + 0.5) / ss
                    fy = y + (sy + 0.5) / ss
                    # 圆角矩形判定
                    inside = True
                    cx = min(max(fx, r), S - r)
                    cy = min(max(fy, r), S - r)
                    if (fx - cx) ** 2 + (fy - cy) ** 2 > r * r:
                        inside = False
                    if not inside:
                        continue
                    col = BG
                    for (color, x0, x1) in bands:
                        for i, (c2, _) in enumerate(BARS):
                            pass
                    # 逐条判定
                    for i, (color, ratio) in enumerate(BARS):
                        x0, x1 = bands[i][1], bands[i][2]
                        y0 = top + i * (bar_h + gap)
                        y1 = y0 + bar_h
                        rr = bar_h / 2.0
                        if x0 <= fx <= x1 and y0 <= fy <= y1:
                            # 左右圆头
                            if fx < x0 + rr:
                                if (fx - (x0 + rr)) ** 2 + (fy - (y0 + rr)) ** 2 > rr * rr:
                                    continue
                            if fx > x1 - rr:
                                if (fx - (x1 - rr)) ** 2 + (fy - (y0 + rr)) ** 2 > rr * rr:
                                    continue
                            col = color
                            break
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255
            n = ss * ss
            px.extend([int(acc[0] / n), int(acc[1] / n), int(acc[2] / n), int(acc[3] / n)])

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', S, S, 8, 6, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(bytes(px), 9)) + chunk(b'IEND', b'')
    io.open(path, 'wb').write(png)

made = []
try:
    import PIL  # noqa
    for size in (192, 512, 180):
        img = draw_with_pillow(size)
        name = 'apple-touch-icon.png' if size == 180 else ('icon-%d.png' % size)
        img.save(os.path.join(DIR, name))
        made.append((name, size, 'Pillow'))
except ImportError:
    for size in (192, 512, 180):
        name = 'apple-touch-icon.png' if size == 180 else ('icon-%d.png' % size)
        write_png_raw(os.path.join(DIR, name), size)
        made.append((name, size, '纯Python'))

# ============================================================
# 2. manifest.json
# ============================================================
MANIFEST = u'''{
  "name": "行业分析工作台",
  "short_name": "行业分析",
  "description": "把行业调研从「问模型要答案」改造成可验证的结构化流程：三级证据分级 + 对抗式校验。",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#fafafa",
  "theme_color": "#51cf66",
  "lang": "zh-CN",
  "icons": [
    { "src": "./icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "看演示", "url": "./index.html?demo=1" }
  ]
}
'''
io.open(os.path.join(DIR, 'manifest.json'), 'w', encoding='utf-8').write(MANIFEST)

# ============================================================
# 3. Service Worker（网络优先、离线兜底）
# ============================================================
SW = u'''// 行业分析工作台 · Service Worker
// 策略：导航请求网络优先（保证拿到最新版），失败则用缓存兜底；
//       静态资源缓存优先。
const CACHE = 'industry-analysis-v1';
const ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // 模型 API 是 POST，直接放行
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;       // 跨域（模型服务商）不接管

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }))
  );
});
'''
io.open(os.path.join(DIR, 'sw.js'), 'w', encoding='utf-8').write(SW)

# ============================================================
# 4. 注入 index.html
# ============================================================
html = io.open(HTML, encoding='utf-8').read()
before = len(html)

# 4.1 head 注入：manifest + iOS meta + theme-color
anchor_head = u'<title>行业分析工作台</title>'
assert html.count(anchor_head) == 1, 'head 锚点不唯一'
HEAD_ADD = anchor_head + u'''
<meta name="theme-color" content="#51cf66">
<link rel="manifest" href="./manifest.json">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="行业分析">'''
html = html.replace(anchor_head, HEAD_ADD, 1)

# 4.2 CSS：安装按钮 + 移动端适配
anchor_css = u'    /* ===== 作品集演示模式样式 ===== */'
assert html.count(anchor_css) == 1
CSS_ADD = u'''    /* ===== PWA 安装引导 ===== */
    #install-bar {
        display: none;
        align-items: center;
        gap: 12px;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-left: 4px solid var(--accent);
        border-radius: 10px;
        padding: 12px 16px;
        margin-bottom: 16px;
        font-size: 13px;
        flex-wrap: wrap;
    }
    #install-bar button {
        padding: 7px 16px;
        border: none;
        border-radius: 999px;
        background: var(--accent);
        color: #fff;
        font-size: 13px;
        cursor: pointer;
        font-weight: 500;
    }
    #install-bar button.later {
        background: transparent;
        color: var(--text-secondary);
        border: 1px solid var(--border);
    }
    /* 移动端适配 */
    @media (max-width: 640px) {
        .topbar { padding: 12px 14px; gap: 8px; }
        .topbar input { min-width: 100%; order: -1; }
        .topbar button { padding: 8px 14px; font-size: 13px; }
        .token-counter { margin-left: 0; width: 100%; font-size: 12px; }
        .container { padding: 14px; }
        .card { padding: 16px; border-radius: 10px; }
        .intro-card { padding: 18px; }
        .intro-card h1 { font-size: 19px; }
        .intro-card .grid { grid-template-columns: 1fr; gap: 10px; }
        .intro-actions button { width: 100%; }
        .modal-content { padding: 20px; border-radius: 12px; }
        .boundary-btn { padding: 12px 14px; }
    }
'''
html = html.replace(anchor_css, CSS_ADD + anchor_css, 1)

# 4.3 安装引导条（放在 intro-card 之后）
anchor_intro_end = u'        <div id="cards-container"></div>'
assert html.count(anchor_intro_end) == 1
INSTALL_BAR = u'''        <div id="install-bar">
            <span>📱 把「行业分析工作台」加到主屏幕，像 App 一样使用（离线也能看演示）</span>
            <button id="install-btn">添加到主屏幕</button>
            <button id="install-later" class="later">以后再说</button>
        </div>
        <div id="cards-container"></div>'''
html = html.replace(anchor_intro_end, INSTALL_BAR, 1)

# 4.4 JS：SW 注册 + 安装引导 + ?demo=1 自动演示
anchor_js = u'// ===================== 事件绑定 ====================='
assert html.count(anchor_js) == 1
PWA_JS = u'''
// ===================== PWA：Service Worker 注册 =====================
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').catch(function (e) {
            console.log('SW 注册失败（不影响使用）:', e.message);
        });
    });
}

// ===================== PWA：安装引导 =====================
let deferredPrompt = null;
const installBar = document.getElementById('install-bar');

window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (installBar) installBar.style.display = 'flex';
});

// iOS Safari 不支持 beforeinstallprompt，用「是否已安装 + 是否 iOS」判断
function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
}
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
if (installBar && !isStandalone() && isIOS) {
    installBar.style.display = 'flex';
    document.getElementById('install-btn').textContent = '查看安装方法';
}

if (installBar) {
    document.getElementById('install-btn').addEventListener('click', async function () {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            if (choice && choice.outcome === 'accepted') installBar.style.display = 'none';
            deferredPrompt = null;
        } else if (isIOS) {
            alert('在 iPhone / iPad 上安装：\\n\\n1. 点浏览器底部的「分享」按钮\\n2. 选「添加到主屏幕」\\n3. 点「添加」\\n\\n之后从主屏幕图标打开，就是全屏 App 效果。');
        } else {
            alert('在浏览器菜单里选「安装应用」或「添加到主屏幕」即可。');
        }
    });
    document.getElementById('install-later').addEventListener('click', function () {
        installBar.style.display = 'none';
    });
}
'''
html = html.replace(anchor_js, PWA_JS + u'\n' + anchor_js, 1)

# 4.5 ?demo=1 自动进演示（配合 manifest.shortcuts）
anchor_bind = u"document.getElementById('intro-try-btn').addEventListener('click', openSettings);"
assert html.count(anchor_bind) == 1
html = html.replace(
    anchor_bind,
    anchor_bind + u'''
// 支持 ./index.html?demo=1 直接进演示（PWA 快捷方式用）
if (/[?&]demo=1/.test(location.search)) {
    const ic0 = document.getElementById('intro-card');
    if (ic0) ic0.style.display = 'none';
    setTimeout(runDemo, 300);
}''',
    1
)

io.open(HTML, 'w', encoding='utf-8').write(html)

print('图标：')
for n, s, how in made:
    print('  %-24s %dx%d  (%s)' % (n, s, s, how))
print('新增 manifest.json, sw.js')
print('index.html: %d -> %d 字符 (+%d)' % (before, len(html), len(html) - before))
