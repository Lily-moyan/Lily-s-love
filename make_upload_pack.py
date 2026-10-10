# -*- coding: utf-8 -*-
"""
准备 GitHub 网页上传包：只复制 git 跟踪的 18 个文件（保留目录结构）
这样即使你直接拖文件夹到 GitHub 网页上传，也不会把 node_modules / .next 带上去。
"""
import os, shutil, subprocess, io

SRC = r'G:\coze-customer-service'
OUT = r'G:\dsh\coze-customer-service-上传包'

# 取 git 跟踪的文件列表（等价于"该公开的文件"）
r = subprocess.run(['git', '-C', SRC, 'ls-files'], capture_output=True, text=True, encoding='utf-8')
if r.returncode != 0:
    raise SystemExit('git ls-files 失败: %s' % r.stderr)
files = [f for f in r.stdout.splitlines() if f.strip()]
if not files:
    raise SystemExit('跟踪文件列表为空')

if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

copied = []
for rel in files:
    src = os.path.join(SRC, rel.replace('/', os.sep))
    dst = os.path.join(OUT, rel.replace('/', os.sep))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    copied.append((rel, os.path.getsize(dst)))

print('=== 上传包内容（%d 个文件）===' % len(copied))
for rel, size in sorted(copied):
    hidden = '  ← 隐藏文件' if os.path.basename(rel).startswith('.') else ''
    print('  %-40s %7d B%s' % (rel, size, hidden))

# 安全复核
bad = [r for r, _ in copied if 'node_modules' in r or r.startswith('.next') or '.env.local' in r or r == '.env']
print()
if bad:
    print('❌ 危险文件混入: %s' % bad)
else:
    print('✅ 安全复核：无 node_modules / .next / .env.local / .env')

dot = [r for r, _ in copied if os.path.basename(r).startswith('.')]
print('✅ 隐藏文件 %d 个（%s）' % (len(dot), ', '.join(dot)))
print()
print('上传包路径: %s' % OUT)
print('总大小: %.1f KB' % (sum(s for _, s in copied) / 1024))
