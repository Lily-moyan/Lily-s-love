# -*- coding: utf-8 -*-
"""
1) 对公开仓库做全量密钥扫描（逐个文件抓取真实内容）
2) 把仓库链接填进简历最后一个占位
"""
import io, os, re, json, base64, http.client, time

OWNER, REPO = 'Lily-moyan', 'coze-customer-service'
REPO_URL = 'https://github.com/%s/%s' % (OWNER, REPO)

def api(path, retries=3):
    for i in range(retries):
        try:
            c = http.client.HTTPSConnection('api.github.com', 443, timeout=25)
            c.request('GET', path, headers={'User-Agent': 'verify', 'Accept': 'application/vnd.github+json'})
            r = c.getresponse(); b = r.read(); c.close()
            try: return r.status, json.loads(b.decode('utf-8'))
            except Exception: return r.status, b.decode('utf-8', 'replace')
        except Exception:
            if i == retries - 1: raise
            time.sleep(2)

print('=== 1. 公开仓库全量密钥扫描 ===')
st, tree = api('/repos/%s/%s/git/trees/main?recursive=1' % (OWNER, REPO))
if st != 200:
    print('  ❌ 取文件树失败 HTTP %s' % st); raise SystemExit(1)

blobs = [t for t in tree['tree'] if t['type'] == 'blob']
print('  仓库共 %d 个文件，逐个抓取内容扫描…' % len(blobs))

TOKEN = 'pat_pAXelAnPYTwZenu7IUvOKjG1h8ly93WWOfHlW4N0SZqyvGoWhusKKsB17O4T054X'
PATTERNS = {
    '真实 Coze token': re.escape(TOKEN),
    '任意 pat_ 串': r'pat_[A-Za-z0-9]{20,}',
    'OpenAI key': r'sk-[A-Za-z0-9]{20,}',
    'Bearer 长串': r'Bearer\s+[A-Za-z0-9_\-\.]{30,}',
    'env.local 内容': r'COZE_PAT\s*=\s*pat_',
}
leak = False
scanned = 0
for b in blobs:
    st, body = api('/repos/%s/%s/contents/%s' % (OWNER, REPO, b['path']))
    if st != 200 or not isinstance(body, dict): continue
    try:
        txt = base64.b64decode(body['content']).decode('utf-8', 'replace')
    except Exception:
        continue
    scanned += 1
    for name, pat in PATTERNS.items():
        m = re.search(pat, txt)
        if m:
            leak = True
            print('  ❌ %s 命中[%s]: %s' % (b['path'], name, m.group(0)[:30]))

print('  实际扫描 %d 个文本文件' % scanned)
print('  %s' % ('❌ 发现泄漏！需立刻处理' if leak else '✅ 无任何密钥泄漏 —— 可安全公开'))
if leak:
    raise SystemExit(1)

print()
print('=== 2. 填进简历 ===')
HTML = r'G:\dsh\简历_李雪蓉.html'
MD   = r'G:\dsh\简历_李雪蓉.md'

h = io.open(HTML, encoding='utf-8').read()
hb = h
h = h.replace(
    '<div class="item-date">2026.09 ｜ <span class="fill">待填：代码仓库链接</span></div>',
    '<div class="item-date">2026.09 ｜ <a href="%s">github.com/Lily-moyan/coze-customer-service</a></div>' % REPO_URL,
    1
)
if h != hb:
    io.open(HTML, 'w', encoding='utf-8').write(h)
    print('  ✅ HTML 已填')
else:
    print('  ⚠️ HTML 未匹配（可能已填过）')

m = io.open(MD, encoding='utf-8').read()
mb = m
m = m.replace(
    '**智能客服系统**　独立设计与实现　｜　2026.09　｜　`待填：代码仓库链接`',
    '**智能客服系统**　独立设计与实现　｜　2026.09　｜　%s' % REPO_URL,
    1
)
m = m.replace(
    '| 智能客服系统 | ⬜ 待填（文件里黄色高亮 `待填：代码仓库链接`） | 推到 GitHub |',
    '| **智能客服系统** | ✅ **已填** | `%s` |' % REPO_URL,
    1
)
if m != mb:
    io.open(MD, 'w', encoding='utf-8').write(m)
    print('  ✅ MD 已填')
else:
    print('  ⚠️ MD 未匹配（可能已填过）')

print()
print('=== 3. 简历终检 ===')
h2 = io.open(HTML, encoding='utf-8').read()
print('  黄色占位剩余: %d 个' % h2.count('class="fill"'))
for x in re.finditer(r'<span class="fill">([^<]+)</span>', h2):
    print('      · %s' % x.group(1))
for label, url in [('行业分析工作台', 'ai-pm-lixuerong-hangyefenxi'),
                   ('投标工作台', 'ai-pm-lixuerong-toubiaogongzuotai'),
                   ('代码仓库', 'github.com/Lily-moyan')]:
    print('  %s %s' % ('✅' if url in h2 else '❌', label))
