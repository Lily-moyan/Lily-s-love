"""从 Weixin.exe 进程内存中提取 SQLCipher 密钥候选（只读，不修改目标进程）。

原理：微信 4.x 把数据库密钥以 SQLCipher 字面量形式 x'<64位十六进制>' 常驻在进程内存里。
本脚本独立实现该扫描，不依赖 pymem 等第三方包，也不需要管理员权限（同用户进程即可）。

为了保证可审计性，这里只做三件事：
  1) OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION)
  2) VirtualQueryEx 枚举已提交且可读的内存区间
  3) ReadProcessMemory 分块读取并在内存中匹配 x'<64hex>'

用法：
  python scan_keys.py <pid> [<pid> ...] [--json 输出路径]
"""
from __future__ import annotations

import ctypes
import json
import re
import sys
from collections import Counter
from ctypes import wintypes

PROCESS_VM_READ = 0x0010
PROCESS_QUERY_INFORMATION = 0x0400

MEM_COMMIT = 0x1000
MEM_IMAGE = 0x1000000
PAGE_NOACCESS = 0x01
PAGE_GUARD = 0x100
READABLE_PROTECT = {0x02, 0x04, 0x20, 0x40, 0x80}

CHUNK = 8 * 1024 * 1024
OVERLAP = 128

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.VirtualQueryEx.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
kernel32.VirtualQueryEx.restype = ctypes.c_size_t
kernel32.ReadProcessMemory.argtypes = [
    wintypes.HANDLE,
    ctypes.c_void_p,
    ctypes.c_void_p,
    ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_size_t),
]
kernel32.ReadProcessMemory.restype = wintypes.BOOL

# x'<64 hex>' —— SQLCipher 把密钥字面量格式的字符串留在内存里
KEY_RE = re.compile(rb"x'([0-9a-fA-F]{64})'")


class MEMORY_BASIC_INFORMATION64(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_ulonglong),
        ("AllocationBase", ctypes.c_ulonglong),
        ("AllocationProtect", wintypes.DWORD),
        ("__alignment1", wintypes.DWORD),
        ("RegionSize", ctypes.c_ulonglong),
        ("State", wintypes.DWORD),
        ("Protect", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("__alignment2", wintypes.DWORD),
    ]


def readable_regions(handle):
    mbi = MEMORY_BASIC_INFORMATION64()
    addr = 0
    max_addr = 0x7FFFFFFF0000
    while addr < max_addr:
        if not kernel32.VirtualQueryEx(
            handle, ctypes.c_void_p(addr), ctypes.byref(mbi), ctypes.sizeof(mbi)
        ):
            break
        base, size = mbi.BaseAddress, mbi.RegionSize
        if size == 0:
            break
        if (
            mbi.State == MEM_COMMIT
            and not (mbi.Protect & PAGE_GUARD)
            and mbi.Protect != PAGE_NOACCESS
            and (mbi.Protect & 0xFF) in READABLE_PROTECT
        ):
            yield base, size
        addr = base + size


def scan_pid(pid: int, hits: Counter, stats: dict) -> None:
    handle = kernel32.OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, False, pid)
    if not handle:
        err = ctypes.get_last_error()
        print(f"[PID {pid}] OpenProcess 失败 error={err} ({ctypes.FormatError(err)})")
        return
    buf = ctypes.create_string_buffer(CHUNK + OVERLAP)
    bytes_read_total = 0
    regions_scanned = 0
    try:
        for base, size in readable_regions(handle):
            regions_scanned += 1
            offset = 0
            while offset < size:
                want = min(CHUNK + OVERLAP, size - offset)
                got = ctypes.c_size_t(0)
                ok = kernel32.ReadProcessMemory(
                    handle,
                    ctypes.c_void_p(base + offset),
                    buf,
                    want,
                    ctypes.byref(got),
                )
                n = got.value
                if ok and n:
                    data = buf.raw[:n]
                    for m in KEY_RE.finditer(data):
                        hits[m.group(1).decode("ascii").lower()] += 1
                    bytes_read_total += n
                # 无论成功与否都前进，避免在不可读页上死循环
                offset += want if want > 0 else CHUNK
    finally:
        kernel32.CloseHandle(handle)
    stats[pid] = {"regions": regions_scanned, "mb_read": round(bytes_read_total / 1024 / 1024, 1)}
    print(f"[PID {pid}] 扫描区间 {regions_scanned} 个，读取 {stats[pid]['mb_read']} MB")


def main(argv: list[str]) -> int:
    pids, out_path = [], None
    it = iter(range(len(argv)))
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--json":
            i += 1
            out_path = argv[i]
        else:
            pids.append(int(a))
        i += 1

    if not pids:
        print(__doc__)
        return 2

    hits: Counter = Counter()
    stats: dict = {}
    for pid in pids:
        scan_pid(pid, hits, stats)

    print(f"\n发现 {len(hits)} 个唯一候选密钥（按出现次数排序）：")
    print(f"{'#':<4}{'次数':<10}{'密钥 (hex)'}")
    print("-" * 84)
    ranked = hits.most_common()
    for idx, (key, count) in enumerate(ranked):
        print(f"{idx:<4}{count:<10}{key}")

    if out_path and ranked:
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(
                {"stats": stats, "candidates": [{"key": k, "count": c} for k, c in ranked]},
                fh,
                ensure_ascii=False,
                indent=2,
            )
        print(f"\n已写入 {out_path}")
    if not ranked:
        print("\n未找到候选密钥：确认微信已登录，或该版本不再使用该内存格式。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
