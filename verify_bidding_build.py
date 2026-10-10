# -*- coding: utf-8 -*-
"""校验构建产物并组装投标工作台部署包"""
import io, os, re, shutil, json

P   = r'G:\bidding-workstation'
D   = os.path.join(P, 'dist')
OUT = r'G:\dsh\投标工作台-部署包'

def rd(p):
    return io.open(p, encoding='utf-8', errors='replace').read()

print('=== 1. dist/index.html 检查 ===')
h = rd(os.path.join(D, 'index.html'))
checks = [
    ('作品集说明层', 'portfolio-intro' in h),
    ('资源用相对路径', 'src="./assets/' in h or "src='./assets/" in h or './assets/' in h),
    ('viewport', 'viewport' in h),
    ('关闭按钮绑定', 'pi-close' in h),
]
for name, ok in checks:
    print('  %s %s' % ('✅' if ok else '❌', name))
m = re.search(r'src="([^"]+\.js)"', h)
print('  JS 引用: %s' % (m.group(1) if m else '未找到'))

print()
print('=== 2. 密钥终检（最要紧）===')
TOKEN = 'pat_pAXelAnPYTwZenu7IUvOKjG1h8ly93WWOfHlW4N0SZqyvGoWhusKKsB17O4T054X'
leak = False
for root, _, files in os.walk(D):
    for fn in files:
        c = rd(os.path.join(root, fn))
        if TOKEN in c:
            leak = True; print('  ❌ 真实 token 泄漏: %s' % fn)
        for mm in re.finditer(r'pat_[A-Za-z0-9]{20,}', c):
            leak = True; print('  ❌ 疑似 token: %s -> %s...' % (fn, mm.group(0)[:22]))
print('  %s' % ('❌ 存在泄漏，禁止部署' if leak else '✅ 无任何 token —— 可安全公开部署'))

print()
print('=== 3. 演示模式改动是否进了产物 ===')
jsfile = None
adir = os.path.join(D, 'assets')
for fn in os.listdir(adir):
    if fn.endswith('.js'):
        jsfile = os.path.join(adir, fn)
j = rd(jsfile)
print('  产物 JS: %s (%.1f KB)' % (os.path.basename(jsfile), os.path.getsize(jsfile)/1024))
for k, desc in [('bidding-sample.html', '指向真实样例页'),
                ('2600', '三段延迟·第一段'),
                ('3200', '三段延迟·第二段'),
                ('演示模式', '演示模式文案')]:
    print('  %s %-20s' % ('✅' if k in j else '❌', desc))
print('  %s %s' % ('❌ 仍在' if 'example.feishu.cn' in j else '✅ 已清', '旧的假链接'))
print('  %s %s' % ('❌ 仍在' if 'Math.random()>' in j and '0.2' in j else '✅ 已清', '20% 随机失败'))

print()
print('=== 4. 组装部署包 ===')
if os.path.isdir(OUT):
    shutil.rmtree(OUT)
shutil.copytree(D, OUT)
shutil.copy2(r'G:\dsh\bidding-sample.html', os.path.join(OUT, 'bidding-sample.html'))
for root, _, files in os.walk(OUT):
    for fn in sorted(files):
        p = os.path.join(root, fn)
        print('  %-44s %8d B' % (p.replace(OUT, ''), os.path.getsize(p)))

print()
print('=== 5. 起本地服验证（相对路径在子目录部署下是否可用）===')
print('  部署包: %s' % OUT)
