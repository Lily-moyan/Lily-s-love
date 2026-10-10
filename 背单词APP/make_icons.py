# -*- coding: utf-8 -*-
"""
生成「每天一个小故事」App 图标
设计：暖黄底 + 奶油色对话气泡 + 橙色小星星 + abc
输出：icon-192 / icon-512 / icon-maskable-512 / apple-touch-icon(180)
"""
import os
from PIL import Image, ImageDraw, ImageFont

DIR = os.path.dirname(os.path.abspath(__file__))

CREAM = (253, 246, 232)
BUBBLE = (255, 255, 255)
BLUE = (43, 108, 176)
ORANGE = (232, 89, 12)
YELLOW = (250, 200, 60)
YELLOW2 = (240, 160, 30)
INK = (45, 49, 66)


def find_font(size):
    """找一个能画 abc 的粗体字体"""
    cands = [
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\verdanab.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\comicbd.ttf",
        r"C:\Windows\Fonts\Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in cands:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    try:
        return ImageFont.load_default(size)
    except Exception:
        return ImageFont.load_default()


def star_points(cx, cy, r_out, r_in, n=5):
    import math
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = -math.pi / 2 + i * math.pi / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def draw_icon(size, maskable=False):
    S = size * 4                      # 4 倍超采样
    img = Image.new("RGB", (S, S), YELLOW)
    d = ImageDraw.Draw(img)

    # 竖向渐变底
    for y in range(S):
        t = y / max(1, S - 1)
        col = (
            int(YELLOW[0] + (YELLOW2[0] - YELLOW[0]) * t),
            int(YELLOW[1] + (YELLOW2[1] - YELLOW[1]) * t),
            int(YELLOW[2] + (YELLOW2[2] - YELLOW[2]) * t),
        )
        d.line([(0, y), (S, y)], fill=col)

    # 圆角：非 maskable 时裁圆角，maskable 时铺满
    if not maskable:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.23), fill=255)
        bg = Image.new("RGB", (S, S), CREAM)
        bg.paste(img, (0, 0), mask)
        img = bg

    d = ImageDraw.Draw(img)

    # 气泡几何
    if maskable:
        bw, bh = int(S * 0.62), int(S * 0.50)     # 安全区内
        cx, cy = S // 2, int(S * 0.46)
    else:
        bw, bh = int(S * 0.74), int(S * 0.60)
        cx, cy = S // 2, int(S * 0.47)

    x0, y0 = cx - bw // 2, cy - bh // 2
    x1, y1 = cx + bw // 2, cy + bh // 2
    d.rounded_rectangle([x0, y0, x1, y1], radius=int(bh * 0.30), fill=BUBBLE)

    # 气泡小尾巴
    tw = int(bw * 0.24)
    tx = x0 + int(bw * 0.20)
    d.polygon([(tx, y1 - int(bh * 0.06)), (tx + tw, y1 - int(bh * 0.06)),
               (tx + int(tw * 0.30), y1 + int(bh * 0.26))], fill=BUBBLE)

    # abc 文字
    fs = int(bh * 0.46)
    font = find_font(fs)
    text = "abc"
    bb = d.textbbox((0, 0), text, font=font)
    tw2, th2 = bb[2] - bb[0], bb[3] - bb[1]
    d.text((cx - tw2 // 2 - bb[0], cy - int(bh * 0.30) - th2 // 2 - bb[1]),
           text, font=font, fill=BLUE)

    # 气泡内三颗小星星（进度感）
    sr = int(bh * 0.105)
    scy = cy + int(bh * 0.30)
    gap = int(bw * 0.16)
    for i in (-1, 0, 1):
        d.polygon(star_points(cx + i * gap, scy, sr, sr * 0.45), fill=ORANGE)

    return img.resize((size, size), Image.LANCZOS)


made = []
for size in (192, 512):
    draw_icon(size).save(os.path.join(DIR, "icon-%d.png" % size))
    made.append("icon-%d.png" % size)

draw_icon(512, maskable=True).save(os.path.join(DIR, "icon-maskable-512.png"))
made.append("icon-maskable-512.png")

draw_icon(180).save(os.path.join(DIR, "apple-touch-icon.png"))
made.append("apple-touch-icon.png")

for m in made:
    p = os.path.join(DIR, m)
    print("%-26s %8d bytes" % (m, os.path.getsize(p)))
print("OK")
