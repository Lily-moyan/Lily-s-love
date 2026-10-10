# -*- coding: utf-8 -*-
"""
B 方案：把投标工作台并进公开的第一个站，做成子目录
源：G:\\industry-analysis-workbench\\demo  （行业分析 + PWA，已上线且公开）
    G:\\dsh\\投标工作台-部署包             （投标工作台构建产物）
产出：G:\\dsh\\作品集-完整部署包\\  +  .zip
结构：
  /                            行业分析工作台
  /bidding/                    投标工作台（React，base:'./'）
  /bidding/bidding-sample.html 样例页副本（让工作台内 ./bidding-sample.html 可解析）
  /bidding-sample.html         样例页（根目录）
"""
import io, os, re, shutil, zipfile

DEMO = r'G:\industry-analysis-workbench\demo'
BID  = r'G:\dsh\投标工作台-部署包'
OUT  = r'G:\dsh\作品集-完整部署包'
ZIP  = r'G:\dsh\作品集-完整部署包.zip'

# 根目录只放网站运行需要的文件（README 是给作者看的，不部署）
ROOT_FILES = ['index.html', 'bidding-sample.html', 'manifest.json', 'sw.js',
              'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']

print('=== 1. 前置检查 ===')
for label, p in [('行业分析 demo', DEMO), ('投标工作台构建产物', BID)]:
    print('  %s %s' % ('✅' if os.path.isdir(p) else '❌', label))
    if not os.path.isdir(p):
        raise SystemExit('缺少 %s' % p)
miss = [f for f in ROOT_FILES if not os.path.isfile(os.path.join(DEMO, f))]
if miss:
    raise SystemExit('demo 缺少: %s' % miss)

# ---------- 2. 组装 ----------
if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

for f in ROOT_FILES:
    shutil.copy2(os.path.join(DEMO, f), os.path.join(OUT, f))

# 投标工作台 → /bidding/
bd = os.path.join(OUT, 'bidding')
shutil.copytree(BID, bd)
# 样例页副本，让工作台里 './bidding-sample.html' 在子目录下也能解析
shutil.copy2(os.path.join(DEMO, 'bidding-sample.html'), os.path.join(bd, 'bidding-sample.html'))

# ---------- 3. 行业分析页加「投标工作台」入口 ----------
idx = os.path.join(OUT, 'index.html')
t = io.open(idx, encoding='utf-8').read()
if 'href="./bidding/"' not in t:
    # 找到 intro-note 里那条「另一个作品」，在它前面插入工作台入口
    m = re.search(r'<b>另一个作品：</b>', t)
    if m:
        ins = ('<b>作品集：</b><a href="./bidding/">AI 投标技术方案生成工作台</a>'
               '（toB 投标场景 · 含交付样例）&nbsp;&nbsp;|&nbsp;&nbsp;'
               '<a href="./bidding-sample.html">交付样例</a><br>\n                ')
        t = t[:m.start()] + ins + t[m.start():]
        io.open(idx, 'w', encoding='utf-8').write(t)
        print()
        print('✅ 行业分析页已加「投标工作台 + 交付样例」入口')
    else:
        print()
        print('⚠️ 未找到 intro-note 锚点，跳过入口注入')
else:
    print()
    print('· 入口已存在')

# ---------- 4. 缓存版本 bump ----------
sw = os.path.join(OUT, 'sw.js')
s = io.open(sw, encoding='utf-8').read()
s = re.sub(r"const CACHE = '[^']+';", "const CACHE = 'portfolio-v1';", s)
io.open(sw, 'w', encoding='utf-8').write(s)
print('✅ sw.js 缓存名 -> portfolio-v1')

# ---------- 5. 打包 ----------
if os.path.exists(ZIP):
    os.remove(ZIP)
with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(OUT):
        for fn in files:
            full = os.path.join(root, fn)
            arc = os.path.relpath(full, OUT).replace('\\', '/')
            z.write(full, arcname=arc)

print()
print('=== 2. 完整部署包内容 ===')
for root, _, files in os.walk(OUT):
    for fn in sorted(files):
        p = os.path.join(root, fn)
        print('  %-48s %8d B' % (p.replace(OUT, '') , os.path.getsize(p)))
print()
print('=== 3. ZIP ===')
print('  %s  (%.1f KB, %d 个文件)' % (ZIP, os.path.getsize(ZIP)/1024, len(zipfile.ZipFile(ZIP).infolist())))

print()
print('=== 4. 关键校验 ===')
h = io.open(idx, encoding='utf-8').read()
print('  %s 行业分析页含 /bidding/ 入口' % ('✅' if 'href="./bidding/"' in h else '❌'))
b = io.open(os.path.join(bd, 'index.html'), encoding='utf-8').read()
print('  %s 投标工作台用相对路径资源' % ('✅' if './assets/' in b else '❌'))
print('  %s 投标工作台含作品集说明层' % ('✅' if 'portfolio-intro' in b else '❌'))
# 密钥扫描
TOKEN = 'pat_pAXelAnPYTwZenu7IUvOKjG1h8ly93WWOfHlW4N0SZqyvGoWhusKKsB17O4T054X'
leak = False
for root, _, files in os.walk(OUT):
    for fn in files:
        c = io.open(os.path.join(root, fn), encoding='utf-8', errors='replace').read()
        if TOKEN in c or re.search(r'pat_[A-Za-z0-9]{20,}', c):
            leak = True; print('  ❌ token 泄漏: %s' % fn)
print('  %s 全域无 token' % ('❌' if leak else '✅'))
