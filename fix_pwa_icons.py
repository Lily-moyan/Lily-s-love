# -*- coding: utf-8 -*-
"""
修复 PWA 图标规格问题：
  - maskable 图标：必须满幅背景（无透明角），内容落在中心 80% 安全区内
  - apple-touch-icon：iOS 自己会切圆角，也必须满幅（透明会渲染成黑底）
  - 普通 any 图标：保留圆角透明，Android 会自己加形状
产出：
  icon-192.png / icon-512.png        圆角透明（purpose: any）
  icon-maskable-512.png              满幅（purpose: maskable）
  apple-touch-icon.png               满幅 180
"""
import io, os, json
from PIL import Image, ImageDraw

DIR = r'G:\dsh\行业分析工作台-演示版'

BG    = (20, 24, 31)
BARS  = [((81, 207, 102), 0.62),   # A 档 绿
         ((92, 124, 250), 0.46),   # B 档 蓝
         ((107, 114, 128), 0.30)]  # C 档 灰


def draw(size, full_bleed):
    """full_bleed=True → 满幅背景（maskable / iOS 用）"""
    S = size
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if full_bleed:
        # 满幅纯色底，不留透明角
        d.rectangle([0, 0, S - 1, S - 1], fill=BG)
    else:
        # 圆角底（透明角）
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)

    bar_h = int(S * 0.085)
    gap   = int(S * 0.075)
    total = bar_h * 3 + gap * 2
    top   = (S - total) // 2
    left  = int(S * 0.19)
    for i, (color, _) in enumerate(BARS):
        w = int(S * BARS[i][1] * 0.78)
        y = top + i * (bar_h + gap)
        d.rounded_rectangle([left, y, left + w, y + bar_h], radius=bar_h // 2, fill=color)
    return img


made = []
# 普通 any 图标：保留圆角
for size in (192, 512):
    name = 'icon-%d.png' % size
    draw(size, full_bleed=False).save(os.path.join(DIR, name))
    made.append((name, size, '圆角透明 / any'))

# maskable：满幅
draw(512, full_bleed=True).save(os.path.join(DIR, 'icon-maskable-512.png'))
made.append(('icon-maskable-512.png', 512, '满幅 / maskable'))

# iOS：满幅 180
draw(180, full_bleed=True).save(os.path.join(DIR, 'apple-touch-icon.png'))
made.append(('apple-touch-icon.png', 180, '满幅 / iOS'))

# ---- 更新 manifest：把 maskable 指向专用文件 ----
mf_path = os.path.join(DIR, 'manifest.json')
mf = json.load(io.open(mf_path, encoding='utf-8'))
mf['icons'] = [
    {"src": "./icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    {"src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
    {"src": "./icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
]
io.open(mf_path, 'w', encoding='utf-8').write(
    json.dumps(mf, ensure_ascii=False, indent=2) + '\n'
)

# ---- 更新 sw.js 的预缓存清单 ----
sw_path = os.path.join(DIR, 'sw.js')
sw = io.open(sw_path, encoding='utf-8').read()
if 'icon-maskable-512.png' not in sw:
    sw = sw.replace(
        "  './icon-512.png',",
        "  './icon-512.png',\n  './icon-maskable-512.png',"
    )
    io.open(sw_path, 'w', encoding='utf-8').write(sw)

print('图标已重新生成：')
for n, s, how in made:
    print('  %-26s %dx%d  %s' % (n, s, s, how))
print()
print('manifest.icons 现在指向:')
for i in mf['icons']:
    print('  %-26s %s  purpose=%s' % (i['src'], i['sizes'], i['purpose']))

# ---- 校验安全区：maskable 内容必须落在中心 80% 的圆内 ----
S = 512
bar_h = S * 0.085; gap = S * 0.075
total = bar_h * 3 + gap * 2
top = (S - total) / 2
left = S * 0.19
maxw = S * BARS[0][1] * 0.78
right = left + maxw
bottom = top + total
cx = cy = S / 2
import math
corners = [(left, top), (right, top), (left, bottom), (right, bottom)]
worst = max(math.hypot(x - cx, y - cy) for x, y in corners)
print()
print('maskable 安全区校验（中心半径 40%% = %.1fpx）：' % (S * 0.4))
print('  内容包围盒最远角距中心 = %.1fpx' % worst)
print('  ' + ('✅ 在安全区内' if worst <= S * 0.4 else '❌ 超出安全区，会被裁切'))
