"""内存特征诊断：找到 SQLCipher 密钥到底以什么形式存在。

第一轮扫描（x'<64hex>' 字面量）零命中，因此这里扩大特征面：
  A) 统计锚点字符串出现次数（x' / SQLCipher / PRAGMA key / sqlite3_key / WCDB / <wxid>）
  B) 全内存提取任意 64 位 hex token（不要求 x'' 包裹），按频次排序
  C) 在账号 wxid 附近 ±512B 内探测"疑似 32 字节原始密钥"的位置（只报告偏移与长度，不打印内容）

只读访问，不修改目标进程。用法： python diag_mem.py <pid> [<pid> ...] --wxid <wxid> --json out.json
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
OVERLAP = 256

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

HEX64_RE = re.compile(rb"(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])")


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


def diag(pid: int, anchors: list[bytes], hits: Counter, anchor_counts: Counter, near_wxid: list) -> dict:
    handle = kernel32.OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, False, pid)
    if not handle:
        return {"error": ctypes.get_last_error()}
    buf = ctypes.create_string_buffer(CHUNK + OVERLAP)
    read_mb = 0.0
    regions = 0
    try:
        for base, size in readable_regions(handle):
            regions += 1
            offset = 0
            while offset < size:
                want = min(CHUNK + OVERLAP, size - offset)
                if want <= 0:
                    break
                got = ctypes.c_size_t(0)
                if kernel32.ReadProcessMemory(handle, ctypes.c_void_p(base + offset), buf, want, ctypes.byref(got)) and got.value:
                    data = buf.raw[: got.value]
                    read_mb += got.value / 1024 / 1024
                    for m in HEX64_RE.finditer(data):
                        hits[m.group(0).decode("ascii").lower()] += 1
                    for a in anchors:
                        n = data.count(a)
                        if n:
                            anchor_counts[a.decode("ascii", "replace")] += n
                            if a.startswith(b"wxid_"):
                                # 只记录 wxid 附近的疑似原始密钥存在性，不打印内容
                                for mm in re.finditer(re.escape(a), data):
                                    seg = data[max(0, mm.start() - 512) : mm.end() + 512]
                                    near_wxid.append(
                                        {"pid": pid, "win_len": len(seg), "has_hex64": bool(HEX64_RE.search(seg))}
                                    )
                offset += want
    finally:
        kernel32.CloseHandle(handle)
    return {"regions": regions, "mb_read": round(read_mb, 1)}


def main(argv: list[str]) -> int:
    pids, wxid, out_path = [], None, None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--wxid":
            i += 1
            wxid = argv[i]
        elif a == "--json":
            i += 1
            out_path = argv[i]
        else:
            pids.append(int(a))
        i += 1

    anchors = [b"x'", b"SQLCipher", b"PRAGMA key", b"sqlite3_key", b"WCDB", b"cipher_", b"kdf_iter"]
    if wxid:
        anchors.append(wxid.encode())

    hits: Counter = Counter()
    anchor_counts: Counter = Counter()
    near_wxid: list = []
    stats = {}
    for pid in pids:
        stats[pid] = diag(pid, anchors, hits, anchor_counts, near_wxid)
        print(f"[PID {pid}] {stats[pid]}")

    print("\n=== 锚点出现次数 ===")
    for k, v in anchor_counts.most_common():
        print(f"  {k:<14} {v}")

    print(f"\n=== 任意 64 位 hex token：{len(hits)} 个唯一值（前 40） ===")
    ranked = hits.most_common(40)
    for idx, (val, cnt) in enumerate(ranked):
        print(f"  {idx:<3} x{cnt:<6} {val}")

    print(f"\n=== wxid 附近窗口：{len(near_wxid)} 个，其中含 64hex 的 {sum(1 for w in near_wxid if w['has_hex64'])} 个 ===")

    if out_path:
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "stats": stats,
                    "anchor_counts": dict(anchor_counts),
                    "hex64": [{"key": k, "count": c} for k, c in hits.most_common()],
                    "near_wxid_windows": len(near_wxid),
                },
                fh,
                ensure_ascii=False,
                indent=2,
            )
        print(f"\n已写入 {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
