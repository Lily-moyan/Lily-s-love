"""按「可变长度 hex 字面量」重扫内存密钥。

第一轮扫描要求 x' 后正好 64 位 hex 再跟 '，零命中。
但 Windows 微信 4.1+ 缓存的形式是 x'<64位hex key><32位hex salt>' —— 共 96 位 hex，
因此 64 位正则永远匹配不上（第 65 个字符是 hex 而非引号）。

本脚本：
  1) 统计 x'<hex>' 中 hex 长度分布（ASCII 与 UTF-16LE 两种编码都扫）
  2) 收集长度 >= 64 的全部候选，按频次排序
  3) 输出 JSON 供 HMAC 校验

只读访问。用法： python scan_keys2.py <pid> ... --json out.json
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
PAGE_NOACCESS = 0x01
PAGE_GUARD = 0x100
READABLE_PROTECT = {0x02, 0x04, 0x08, 0x20, 0x40, 0x80}
CHUNK = 8 * 1024 * 1024
OVERLAP = 512

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.VirtualQueryEx.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
kernel32.VirtualQueryEx.restype = ctypes.c_size_t
kernel32.ReadProcessMemory.argtypes = [
    wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)
]
kernel32.ReadProcessMemory.restype = wintypes.BOOL

# ASCII: x'<hex...>'
ASCII_RE = re.compile(rb"x'([0-9a-fA-F]{32,200})'")
# UTF-16LE: x\0'\0<hex\0 ...>'\0
UTF16_RE = re.compile(rb"x\x00'\x00((?:[0-9a-fA-F]\x00){32,200})'\x00")


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
    addr, max_addr = 0, 0x7FFFFFFF0000
    while addr < max_addr:
        if not kernel32.VirtualQueryEx(handle, ctypes.c_void_p(addr), ctypes.byref(mbi), ctypes.sizeof(mbi)):
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


def main(argv: list[str]) -> int:
    pids, out_path = [], None
    i = 0
    while i < len(argv):
        if argv[i] == "--json":
            i += 1
            out_path = argv[i]
        else:
            pids.append(int(argv[i]))
        i += 1
    if not pids:
        print(__doc__)
        return 2

    ascii_cands: Counter = Counter()
    utf16_cands: Counter = Counter()
    len_hist: Counter = Counter()
    for pid in pids:
        handle = kernel32.OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, False, pid)
        if not handle:
            print(f"[PID {pid}] 打开失败 error={ctypes.get_last_error()}")
            continue
        buf = ctypes.create_string_buffer(CHUNK + OVERLAP)
        total_mb = 0.0
        try:
            for base, size in readable_regions(handle):
                offset = 0
                while offset < size:
                    want = min(CHUNK + OVERLAP, size - offset)
                    if want <= 0:
                        break
                    got = ctypes.c_size_t(0)
                    ok = kernel32.ReadProcessMemory(
                        handle, ctypes.c_void_p(base + offset), buf, want, ctypes.byref(got)
                    )
                    if ok and got.value:
                        data = buf.raw[: got.value]
                        total_mb += got.value / 1024 / 1024
                        for m in ASCII_RE.finditer(data):
                            payload = m.group(1).decode("ascii").lower()
                            len_hist[len(payload)] += 1
                            if len(payload) >= 64:
                                ascii_cands[payload] += 1
                        for m in UTF16_RE.finditer(data):
                            payload = m.group(1).decode("ascii", "ignore").replace("\x00", "").lower()
                            len_hist[len(payload)] += 1
                            if len(payload) >= 64:
                                utf16_cands[payload] += 1
                    offset += want
        finally:
            kernel32.CloseHandle(handle)
        print(f"[PID {pid}] 读取 {total_mb:.0f} MB  累计候选 ASCII={len(ascii_cands)} UTF16={len(utf16_cands)}")

    print("\n=== x'<hex>' 中 hex 长度分布 ===")
    for length, count in sorted(len_hist.items()):
        print(f"  {length:>4} 位 hex  ({length*4:>5} bit)  x{count}")

    print(f"\n=== ASCII 形式候选（>=64 位 hex）：{len(ascii_cands)} 个唯一值，前 20 ===")
    for idx, (val, cnt) in enumerate(ascii_cands.most_common(20)):
        print(f"  {idx:<3} x{cnt:<5} len={len(val):<4} {val}")

    print(f"\n=== UTF-16 形式候选（>=64 位 hex）：{len(utf16_cands)} 个唯一值，前 20 ===")
    for idx, (val, cnt) in enumerate(utf16_cands.most_common(20)):
        print(f"  {idx:<3} x{cnt:<5} len={len(val):<4} {val}")

    if out_path:
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "length_histogram": {str(k): v for k, v in sorted(len_hist.items())},
                    "ascii": [{"payload": k, "count": c} for k, c in ascii_cands.most_common()],
                    "utf16": [{"payload": k, "count": c} for k, c in utf16_cands.most_common()],
                },
                fh,
                ensure_ascii=False,
                indent=2,
            )
        print(f"\n已写入 {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
