# -*- coding: utf-8 -*-
"""按用户确认的口径修正简历两份文件，并校验没有遗漏"""
import io, re, os

MD  = r'G:\dsh\简历_李雪蓉.md'
HTML= r'G:\dsh\简历_李雪蓉.html'

REPL = [
    # (旧, 新, 说明)
    (u'12 年 B2B 一线销售，累计推动 **50+ 项目**成交闭环（单项目 10 万–100 万元）',
     u'8 年 B2B 一线销售（2018 年至今，覆盖建筑工程与工业测控两个行业），累计推动 **30+ 项目**成交闭环（单项目 5 万–50 万元）',
     u'MD 摘要'),
    (u'- 月均完成 4 单、高峰期可达 10 单，累计推动 50+ 项目成交，单项目合同金额 10 万–100 万元区间。',
     u'- 月均完成 1–2 单、高峰月最高 4 单，累计推动 30+ 项目成交，单项目合同金额 5 万–50 万元区间。',
     u'MD 工作经历'),
    (u'12 年 B2B 一线销售，累计推动 <strong>50+ 项目</strong>成交闭环（单项目 10 万–100 万元）',
     u'8 年 B2B 一线销售（2018 年至今，覆盖建筑工程与工业测控两个行业），累计推动 <strong>30+ 项目</strong>成交闭环（单项目 5 万–50 万元）',
     u'HTML 摘要'),
    (u'<li>月均完成 4 单、高峰期可达 10 单，累计推动 50+ 项目成交，单项目合同金额 10 万–100 万元区间。</li>',
     u'<li>月均完成 1–2 单、高峰月最高 4 单，累计推动 30+ 项目成交，单项目合同金额 5 万–50 万元区间。</li>',
     u'HTML 工作经历'),
]

for path in (MD, HTML):
    t = io.open(path, encoding='utf-8').read()
    before = t
    hits = []
    for old, new, label in REPL:
        if old in t:
            t = t.replace(old, new)
            hits.append(label)
    if t != before:
        io.open(path, 'w', encoding='utf-8').write(t)
    print('%s  替换: %s' % (os.path.basename(path), ', '.join(hits) if hits else '无命中'))

print()
print('=== 校验：错误的旧数字是否已清除 ===')
bad = {
    u'12 年 B2B': '错误年限',
    u'50+ 项目成交': '错误累计数（应为 30+）',
    u'10 万–100 万': '错误金额区间',
    u'高峰期可达 10 单': '错误高峰值',
    u'月均完成 4 单': '错误月均值',
}
for path in (MD, HTML):
    t = io.open(path, encoding='utf-8').read()
    print(' ', os.path.basename(path))
    for pat, desc in bad.items():
        n = t.count(pat)
        print('    %-22s %s' % (desc, ('❌ 仍存在 %d 处' % n) if n else '✅ 已清除'))

print()
print('=== 校验：确认采用的新数字是否都在 ===')
good = [u'8 年 B2B', u'30+ 项目', u'5 万–50 万', u'最高 4 单', u'1–2 单']
for path in (MD, HTML):
    t = io.open(path, encoding='utf-8').read()
    print(' ', os.path.basename(path))
    for g in good:
        print('    %-16s %s' % (g, '✅' if g in t else '❌ 缺失'))
