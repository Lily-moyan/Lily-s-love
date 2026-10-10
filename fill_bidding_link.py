# -*- coding: utf-8 -*-
"""把投标工作台的公开链接填进简历（HTML + MD）"""
import io, os

HTML = r'G:\dsh\简历_李雪蓉.html'
MD   = r'G:\dsh\简历_李雪蓉.md'
URL  = 'https://ai-pm-lixuerong-toubiaogongzuotai.netlify.app/'
SAMPLE_URL = 'https://ai-pm-lixuerong-toubiaogongzuotai.netlify.app/bidding-sample.html'

# ---------- HTML ----------
t = io.open(HTML, encoding='utf-8').read()
before = t

# 1) 填链接
t = t.replace(
    '<div class="item-date">2026.08 ｜ <span class="fill">待填：脱敏样例链接</span></div>',
    '<div class="item-date">2026.08 ｜ <a href="%s">ai-pm-lixuerong-toubiaogongzuotai.netlify.app</a></div>' % URL,
    1
)
# 2) 描述里补上「演示模式 + 交付样例」，让链接的价值可被理解
t = t.replace(
    '（React 18 + 工作流编排）。产出已用于本公司营销与投标物料：公司简介、服务承诺书、\n                拍摄脚本、发布物料等。',
    '（React 18 + 工作流编排）。产出已用于本公司营销与投标物料：公司简介、服务承诺书、\n                拍摄脚本、发布物料等。已部署为公开演示版（内置交付样例：12 项物料清单与脱敏片段）。',
    1
)
if t != before:
    io.open(HTML, 'w', encoding='utf-8').write(t)
    print('✅ HTML 已更新')
else:
    print('❌ HTML 未匹配到占位，需人工检查')

# ---------- MD ----------
m = io.open(MD, encoding='utf-8').read()
mb = m
m = m.replace(
    '**AI 投标技术方案生成工作台**　独立设计与实现　｜　2026.08　｜　`待填：脱敏样例链接`',
    '**AI 投标技术方案生成工作台**　独立设计与实现　｜　2026.08　｜　%s' % URL,
    1
)
m = m.replace(
    '产出已用于本公司营销与投标物料：公司简介、服务承诺书、拍摄脚本、发布物料等。',
    '产出已用于本公司营销与投标物料：公司简介、服务承诺书、拍摄脚本、发布物料等。已部署为公开演示版，内置交付样例（12 项物料清单 + 脱敏片段：%s）。' % SAMPLE_URL,
    1
)
# 更新「投前必改」里的链接状态表
m = m.replace(
    '| AI 投标工作台 | ⬜ 待填（文件里黄色高亮 `待填：脱敏样例链接`） | 把物料导出 3–5 页 PDF，传到网盘或同一站点 |',
    '| **AI 投标工作台** | ✅ **已填** | `%s`（交付样例：`%s`） |' % (URL, SAMPLE_URL),
    1
)
if m != mb:
    io.open(MD, 'w', encoding='utf-8').write(m)
    print('✅ MD 已更新')
else:
    print('⚠️ MD 未匹配（可能已更新过）')

# ---------- 校验 ----------
print()
print('=== 校验 ===')
h = io.open(HTML, encoding='utf-8').read()
print('  HTML 含投标工作台链接 :', '✅' if 'ai-pm-lixuerong-toubiaogongzuotai' in h else '❌')
print('  HTML 含行业分析链接   :', '✅' if 'ai-pm-lixuerong-hangyefenxi' in h else '❌')
print('  HTML 剩余黄色占位     : %d 个' % h.count('class="fill"'))
import re
for x in re.finditer(r'<span class="fill">([^<]+)</span>', h):
    print('      · %s' % x.group(1))
mm = io.open(MD, encoding='utf-8').read()
print('  MD 含投标工作台链接   :', '✅' if 'ai-pm-lixuerong-toubiaogongzuotai' in mm else '❌')
