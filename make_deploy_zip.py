# -*- coding: utf-8 -*-
"""
把当前 demo 目录打成可直接拖到 Netlify Drop 的 ZIP。
关键：文件放在 ZIP 根目录（不套一层文件夹），避免又一次"只传了一个文件"。
"""
import os, zipfile, io, hashlib

SRC = r'G:\industry-analysis-workbench\demo'
OUT = r'G:\dsh\行业分析工作台-PWA-部署包.zip'

# 只打包网站需要的文件（README 不参与运行，但保留无害；这里排除以免干扰）
INCLUDE = ['index.html', 'manifest.json', 'sw.js',
           'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
           'apple-touch-icon.png']

missing = [f for f in INCLUDE if not os.path.isfile(os.path.join(SRC, f))]
if missing:
    raise SystemExit('缺失文件，拒绝打包: %s' % missing)

if os.path.exists(OUT):
    os.remove(OUT)

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in INCLUDE:
        z.write(os.path.join(SRC, f), arcname=f)   # arcname=f → 根目录

print('已生成:', OUT)
print('原始总大小: %.1f KB' % (sum(os.path.getsize(os.path.join(SRC, f)) for f in INCLUDE) / 1024))
print('ZIP 大小  : %.1f KB' % (os.path.getsize(OUT) / 1024))
print()
print('=== ZIP 内容（应在根目录，无嵌套文件夹）===')
with zipfile.ZipFile(OUT) as z:
    for i in z.infolist():
        print('  %-26s %7d B' % (i.filename, i.file_size))
    bad = [i.filename for i in z.infolist() if '/' in i.filename]
    print()
    print('  嵌套路径检查:', '✅ 全部在根目录' if not bad else '❌ 有嵌套: %s' % bad)
    print('  文件数:', len(z.infolist()), '（应为 7）')

# 顺带给出每个文件的哈希，部署后可以比对确认上传的是这一版
print()
print('=== 文件哈希（部署后可用于比对）===')
for f in INCLUDE:
    p = os.path.join(SRC, f)
    h = hashlib.sha256(open(p, 'rb').read()).hexdigest()[:16]
    print('  %-26s %s  %d B' % (f, h, os.path.getsize(p)))
