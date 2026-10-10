# -*- coding: utf-8 -*-
"""生成《AI 质检记录表》xlsx"""
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

OUT = r"G:\dsh\AI质检记录表.xlsx"

wb = openpyxl.Workbook()

# ---------- 样式 ----------
thin = Side(style="thin", color="BFBFBF")
border = Border(left=thin, right=thin, top=thin, bottom=thin)

title_font = Font(name="微软雅黑", size=14, bold=True, color="1A1A1A")
label_font = Font(name="微软雅黑", size=10, color="595959")
head_font = Font(name="微软雅黑", size=11, bold=True, color="FFFFFF")
head_fill = PatternFill("solid", fgColor="2F5597")
body_font = Font(name="微软雅黑", size=10, color="262626")
ex_font = Font(name="微软雅黑", size=10, color="808080", italic=True)

wrap_top = Alignment(wrap_text=True, vertical="top", horizontal="left")
center = Alignment(vertical="center", horizontal="left")

# ================= Sheet1: 记录表 =================
ws = wb.active
ws.title = "AI质检记录表"
ws.sheet_view.showGridLines = False

ws.merge_cells("A1:D1")
ws["A1"] = "AI 质检记录表"
ws["A1"].font = title_font
ws["A1"].alignment = Alignment(vertical="center")
ws.row_dimensions[1].height = 30

ws["A2"] = "模型："
ws["A2"].font = label_font
ws["C2"] = "版本："
ws["C2"].font = label_font
ws["A3"] = "记录周期："
ws["A3"].font = label_font
for c in ("B2", "D2", "B3", "D3"):
    ws[c].border = Border(bottom=Side(style="thin", color="BFBFBF"))
ws.row_dimensions[2].height = 22
ws.row_dimensions[3].height = 22

HEAD = ["什么任务", "什么问法", "从哪儿开始崩", "怎么救回来"]
HEAD_ROW = 5
for i, h in enumerate(HEAD, start=1):
    c = ws.cell(row=HEAD_ROW, column=i, value=h)
    c.font = head_font
    c.fill = head_fill
    c.alignment = Alignment(vertical="center", horizontal="center")
    c.border = border
ws.row_dimensions[HEAD_ROW].height = 26

EXAMPLES = [
    ("示例｜写一篇 3000 字的方案",
     "「帮我写一份 XX 方案，含背景、目标、执行、预算」",
     "大约第 3 段起：出现重复句和空话，越往后越水",
     "拆成 4 段，每段单独开一个对话，最后自己拼"),
    ("示例｜让模型补全代码 T.Cast(FP…（来自论文 arXiv 2609.36322）",
     "前面加一段无关 docstring，长度每次只加 1 个字符",
     "前置文本一变长，答案就在 8 / 32 之间跳，周期为 4",
     "论文没给解法 —— 关键输出换一种位置或问法再验一次"),
    ("示例｜20 行数据算总和和均值",
     "「这是数据，帮我算总和、均值、最大值」",
     "行数一多数字开始算错，而且它答得很自信",
     "别让它直接算 —— 让它写出公式，自己算；或分批喂"),
]

r = HEAD_ROW + 1
for row in EXAMPLES:
    for i, v in enumerate(row, start=1):
        c = ws.cell(row=r, column=i, value=v)
        c.font = ex_font
        c.alignment = wrap_top
        c.border = border
    ws.row_dimensions[r].height = 44
    r += 1

# 空行
LAST = HEAD_ROW + 60
for rr in range(r, LAST + 1):
    for i in range(1, 5):
        c = ws.cell(row=rr, column=i)
        c.font = body_font
        c.alignment = wrap_top
        c.border = border
    ws.row_dimensions[rr].height = 34

for col, w in zip("ABCD", (26, 34, 30, 34)):
    ws.column_dimensions[col].width = w

ws.freeze_panes = "A6"

# ================= Sheet2: 怎么用 =================
ws2 = wb.create_sheet("怎么用")
ws2.sheet_view.showGridLines = False
ws2.column_dimensions["A"].width = 78

LINES = [
    ("h", "这张表是干什么的"),
    ("b", "它不是笔记，是证据。"),
    ("b", "攒到几十条，你就是这个场景里最懂模型边界的人。"),
    ("", ""),
    ("h", "为什么只记四列"),
    ("b", "列多了你坚持不下去。"),
    ("b", "四列 = 一次记录不超过 1 分钟。"),
    ("", ""),
    ("h", "怎么用"),
    ("b", "1. 每次 AI 崩了，立刻记一行（趁记忆新鲜）。"),
    ("b", "2. 「从哪儿开始崩」要写具体位置或数量，别写「后面就不行了」。"),
    ("b", "3. 「怎么救回来」如果没救回来，就写「没救回来」——那也是信息。"),
    ("b", "4. 每攒够 20 条，回头翻一遍，找重复出现的模式。"),
    ("", ""),
    ("h", "表头那三个空（模型 / 版本 / 记录周期）"),
    ("b", "模型更新很快，换一个版本就换一张表。"),
    ("b", "不然数据混在一起，得不出结论。"),
    ("b", "这一栏常常被人嫌麻烦跳过，但它是这张表能不能得出结论的关键。"),
    ("", ""),
    ("h", "关于前 3 行示例"),
    ("b", "它们是格式示范，用来看「一行该写成什么样」。"),
    ("b", "其中「补全代码」那一行来自字节 Seed 团队的论文（arXiv 2609.36322），不是我的记录。"),
    ("b", ""),
    ("b", "⚠ 请用你自己真实的记录替换它们。"),
    ("b", "这张表的全部价值，来自「是你自己测出来的」。"),
    ("b", "别人抄得走格式，抄不走你的数据。"),
    ("", ""),
    ("h", "一个进阶（等你攒够 50 条再说）"),
    ("b", "可以再加一列「崩的类型」：长度型 / 数值型 / 风格型 / 位置型。"),
    ("b", "加了才能横向统计。但先别加，先攒量。"),
]

rr = 1
for kind, text in LINES:
    c = ws2.cell(row=rr, column=1, value=text)
    if kind == "h":
        c.font = Font(name="微软雅黑", size=12, bold=True, color="2F5597")
        ws2.row_dimensions[rr].height = 26
    else:
        c.font = Font(name="微软雅黑", size=10, color="262626")
        ws2.row_dimensions[rr].height = 19
    c.alignment = Alignment(wrap_text=True, vertical="center")
    rr += 1

wb.save(OUT)
print("OK ->", OUT)
print("sheets:", wb.sheetnames)
