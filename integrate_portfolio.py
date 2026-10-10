# -*- coding: utf-8 -*-
"""
1) 校验 bidding-sample.html 结构
2) 在 index.html 的说明卡里加一条「另一个作品」互链
3) 把两个页面 + PWA 资源同步到 demo 部署目录
4) 重建部署 ZIP
"""
import io, os, re, zipfile, shutil, json

SRC_SAMPLE = r'G:\dsh\bidding-sample.html'
DEMO       = r'G:\industry-analysis-workbench\demo'
INDEX      = os.path.join(DEMO, 'index.html')
ZIP        = r'G:\dsh\行业分析工作台-PWA-部署包.zip'

# ---------- 1. 校验样例页 ----------
s = io.open(SRC_SAMPLE, encoding='utf-8').read()
print('=== 1. bidding-sample.html 校验 ===')
print('  大小: %.1f KB, %d 字符' % (len(s.encode('utf-8'))/1024, len(s)))
for k, desc in [('<html', 'HTML 开头'), ('</html>', 'HTML 闭合'), ('<style>', '样式'),
                ('viewport', '移动端 viewport'), ('@media print', '打印样式'),
                ('脱敏说明', '脱敏声明'), ('履约' if False else '口播脚本', '样例1'),
                ('封面设计方案', '样例2'), ('拍摄指导手册', '样例3'),
                ('./index.html', '回链到行业分析工作台')]:
    print('  %s %-24s' % ('✅' if k in s else '❌', desc))

# ---------- 2. index.html 注入互链 ----------
t = io.open(INDEX, encoding='utf-8').read()
print()
print('=== 2. index.html 互链注入 ===')

MARK = '另一个作品'
if MARK in t:
    print('  已存在互链，跳过')
else:
    anchor = ('                <b>说明：</b>本页为静态托管页面，真实调用由浏览器直连模型服务商完成。\n'
              '            </div>')
    if anchor not in t:
        # 退一步用更宽松的锚点
        m = re.search(r'(<div class="intro-note">.*?</div>)', t, re.S)
        if not m:
            raise SystemExit('找不到 intro-note 锚点')
        old = m.group(1)
        new = old[:-len('</div>')] + ('                <b>另一个作品：</b>'
              '<a href="./bidding-sample.html">AI 投标技术方案生成工作台 · 交付样例</a>'
              '（含 12 项产出清单与脱敏样例片段）<br>\n            </div>')
    else:
        new = anchor.replace('</div>',
              ('                <b>另一个作品：</b>'
               '<a href="./bidding-sample.html">AI 投标技术方案生成工作台 · 交付样例</a>'
               '（含 12 项产出清单与脱敏样例片段）<br>\n            </div>'))
        old = anchor
    t = t.replace(old, new, 1)
    io.open(INDEX, 'w', encoding='utf-8').write(t)
    print('  ✅ 已注入「另一个作品」链接')

# 校验
t2 = io.open(INDEX, encoding='utf-8').read()
print('  %s 链接指向 bidding-sample.html' % ('✅' if 'bidding-sample.html' in t2 else '❌'))

# ---------- 3. 同步样例页进部署目录 ----------
shutil.copy2(SRC_SAMPLE, os.path.join(DEMO, 'bidding-sample.html'))
print()
print('=== 3. 部署目录内容 ===')
for f in sorted(os.listdir(DEMO)):
    p = os.path.join(DEMO, f)
    if os.path.isfile(p):
        print('  %-28s %8d B' % (f, os.path.getsize(p)))

# ---------- 4. 重建 ZIP ----------
INCLUDE = ['index.html', 'bidding-sample.html', 'manifest.json', 'sw.js',
           'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']
miss = [f for f in INCLUDE if not os.path.isfile(os.path.join(DEMO, f))]
if miss:
    raise SystemExit('缺失文件: %s' % miss)
if os.path.exists(ZIP):
    os.remove(ZIP)
with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in INCLUDE:
        z.write(os.path.join(DEMO, f), arcname=f)

print()
print('=== 4. 新部署 ZIP ===')
print('  %s  (%.1f KB)' % (ZIP, os.path.getsize(ZIP)/1024))
with zipfile.ZipFile(ZIP) as z:
    for i in z.infolist():
        print('    %-28s %8d B' % (i.filename, i.file_size))
    nested = [i.filename for i in z.infolist() if '/' in i.filename]
    print('  根目录检查:', '✅ 无嵌套' if not nested else '❌ %s' % nested)
