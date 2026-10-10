"""微信 4.1+ 密钥提取：对 XOR 混淆的 Config.Cipher 字面量做相位扫描。

背景
----
微信 4.1.11+ 不再明文缓存密钥。密钥以 x'<64位hex key><32位hex salt>'（99 字节）
的形式存放，但整段被一个 32 字节常量掩码循环 XOR 混淆过，因此
  - 直接搜 ASCII "x'" 找不到；
  - 即使解码，长度也是 96 位 hex 而非老版本的 64 位。

公开工具（wcdb-key-tool）靠遍历对象图定位这段 blob，但依赖
`com.Tencent.WCDB.Config.Cipher` 对象内部多个版本相关的结构偏移（0x88/0x28/0x10…），
换个小版本就可能失配。这里改用与版本无关的办法：

    既然 blob 整体按 mask[i % 32] 逐字节 XOR，而 blob 在内存中的起始位置未知，
    就把"blob 起点相对当前位置的相位" 0..31 全部枚举一遍：
    对每个相位 p，构造混淆后的 "x'" 两字节特征并全内存搜索，命中后按同一相位
    向后解码，检查是否得到 x'<>=64位hex>'。

这样不需要知道任何结构偏移，只要那段字符串在内存里就一定能找到。

校验：命中不等于正确。必须用 SQLCipher 的 HMAC-SHA512 校验（每页自带），
      能对上才说明拿到了真正的 enc_key。

只读访问目标进程。用法：
  python find_key_v2.py --db-dir <backup db_storage> --json out/keys.json <pid> ...
"""
from __future__ import annotations

import ctypes
import hashlib
import hmac as hmac_mod
import json
import os
import re
import struct
import sys
from collections import Counter
from ctypes import wintypes

PROCESS_VM_READ = 0x0010
PROCESS_QUERY_INFORMATION = 0x0400
MEM_COMMIT = 0x1000
PAGE_NOACCESS = 0x01
PAGE_GUARD = 0x100
READABLE_PROTECT = {0x02, 0x04, 0x08, 0x20, 0x40, 0x80}
CHUNK = 4 * 1024 * 1024
OVERLAP = 512

PAGE_SZ = 4096
RESERVE_SZ = 80
HMAC_SZ = 64
SALT_SZ = 16
KEY_SZ = 32

# Config.Cipher blob 的循环 XOR 掩码（32 字节）
MASK = bytes.fromhex(
    "d2c7442458020000004889442450488b"
    "450048844c2448488944254048584c24"
)

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


# 预生成 32 个相位下 "x'" 的混淆形态
PHASE_PROBES = []
for _p in range(len(MASK)):
    b0 = ord("x") ^ MASK[_p % 32]
    b1 = ord("'") ^ MASK[(_p + 1) % 32]
    PHASE_PROBES.append((_p, bytes([b0, b1])))

HEX_DIGITS = b"0123456789abcdefABCDEF"


def decode_at(data: bytes, idx: int, phase: int, maxlen: int = 220) -> str | None:
    """从 idx 处按 phase 相位解码，返回形如 x'<hex>' 的字符串（hex 部分 >= 64 位）。"""
    end = min(len(data), idx + maxlen)
    out = bytearray()
    for j in range(idx, end):
        out.append(data[j] ^ MASK[(phase + j - idx) % 32])
    s = bytes(out)
    if not s.startswith(b"x'"):
        return None
    k = 2
    while k < len(s) and s[k] in HEX_DIGITS:
        k += 1
    run = s[2:k]
    if len(run) < 64:
        return None
    if k >= len(s) or s[k : k + 1] != b"'":
        return None
    return "x'" + run.decode("ascii") + "'"


def verify_enc_key(enc_key: bytes, page1: bytes) -> bool:
    """SQLCipher 4 标准 HMAC 校验：mac_key = PBKDF2(enc_key, salt^0x3a, 2, 32)。"""
    salt = page1[:SALT_SZ]
    mac_salt = bytes(b ^ 0x3A for b in salt)
    mac_key = hashlib.pbkdf2_hmac("sha512", enc_key, mac_salt, 2, dklen=KEY_SZ)
    data = page1[SALT_SZ : PAGE_SZ - RESERVE_SZ + 16]
    stored = page1[PAGE_SZ - HMAC_SZ : PAGE_SZ]
    hm = hmac_mod.new(mac_key, data, hashlib.sha512)
    hm.update(struct.pack("<I", 1))
    return hmac_mod.compare_digest(hm.digest(), stored)


def collect_dbs(db_dir: str):
    dbs = []
    for root, _dirs, files in os.walk(db_dir):
        for name in files:
            if not name.endswith(".db"):
                continue
            path = os.path.join(root, name)
            if os.path.getsize(path) < PAGE_SZ:
                continue
            with open(path, "rb") as fh:
                page1 = fh.read(PAGE_SZ)
            dbs.append((os.path.relpath(path, db_dir), path, page1[:SALT_SZ].hex(), page1))
    return dbs


def main(argv: list[str]) -> int:
    pids, db_dir, out_path = [], None, None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--db-dir":
            i += 1
            db_dir = argv[i]
        elif a == "--json":
            i += 1
            out_path = argv[i]
        else:
            pids.append(int(a))
        i += 1
    if not pids or not db_dir:
        print(__doc__)
        return 2

    dbs = collect_dbs(db_dir)
    salt_index = {}
    for rel, path, salt_hex, page1 in dbs:
        salt_index.setdefault(salt_hex, []).append((rel, page1))
    print(f"数据库 {len(dbs)} 个，唯一 salt {len(salt_index)} 个")

    found = {}          # salt_hex -> enc_key_hex
    raw_hits = Counter()  # 解码出的字面量 -> 次数
    decoded_strings = set()

    for pid in pids:
        handle = kernel32.OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, False, pid)
        if not handle:
            print(f"[PID {pid}] 打开失败")
            continue
        buf = ctypes.create_string_buffer(CHUNK + OVERLAP)
        read_mb = 0.0
        try:
            for base, size in readable_regions(handle):
                offset = 0
                while offset < size:
                    want = min(CHUNK + OVERLAP, size - offset)
                    if want <= 0:
                        break
                    got = ctypes.c_size_t(0)
                    if kernel32.ReadProcessMemory(
                        handle, ctypes.c_void_p(base + offset), buf, want, ctypes.byref(got)
                    ) and got.value:
                        data = buf.raw[: got.value]
                        read_mb += got.value / 1024 / 1024
                        for phase, probe in PHASE_PROBES:
                            start = 0
                            while True:
                                idx = data.find(probe, start)
                                if idx < 0:
                                    break
                                start = idx + 1
                                # 快速预筛：2 字节特征在 GB 级内存里会有几十万次随机命中，
                                # 先确认紧随其后的 4 个字节解码后仍是 hex（概率 (1/16)^4），
                                # 通过者才做完整解码。
                                if idx + 6 > len(data):
                                    continue
                                if (
                                    (data[idx + 2] ^ MASK[(phase + 2) % 32]) not in HEX_DIGITS
                                    or (data[idx + 3] ^ MASK[(phase + 3) % 32]) not in HEX_DIGITS
                                    or (data[idx + 4] ^ MASK[(phase + 4) % 32]) not in HEX_DIGITS
                                    or (data[idx + 5] ^ MASK[(phase + 5) % 32]) not in HEX_DIGITS
                                ):
                                    continue
                                lit = decode_at(data, idx, phase)
                                if not lit:
                                    continue
                                raw_hits[lit] += 1
                                payload = lit[2:-1].lower()
                                enc_key_hex = payload[:64]
                                salt_hex = payload[64:96] if len(payload) >= 96 else None
                                # 用 HMAC 判定：优先用内嵌 salt 定位对应库，否则遍历全部库
                                targets = [salt_hex] if salt_hex in salt_index else list(salt_index)
                                for s in targets:
                                    if s in found or s not in salt_index:
                                        continue
                                    try:
                                        enc_key = bytes.fromhex(enc_key_hex)
                                    except ValueError:
                                        break
                                    for _rel, page1 in salt_index[s]:
                                        if verify_enc_key(enc_key, page1):
                                            found[s] = enc_key_hex
                                            print(
                                                f"  [HMAC 通过] pid={pid} salt={s[:12]}... "
                                                f"key={enc_key_hex[:8]}...（完整值见 JSON）"
                                            )
                                            break
                                decoded_strings.add(lit)
                    offset += want
        finally:
            kernel32.CloseHandle(handle)
        print(f"[PID {pid}] 读取 {read_mb:.0f} MB，累计命中 {len(decoded_strings)} 个唯一字面量")

    print(f"\n=== 解码出的候选字面量：{len(decoded_strings)} 个 ===")
    for idx, lit in enumerate(sorted(raw_hits, key=lambda k: -raw_hits[k])[:15]):
        payload = lit[2:-1]
        print(f"  {idx:<3} x{raw_hits[lit]:<5} len={len(payload):<4} {lit[:10]}...{lit[-4:]}")

    print(f"\n=== HMAC 校验结果：{len(found)}/{len(salt_index)} 个 salt 拿到有效密钥 ===")
    if out_path:
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "db_dir": db_dir,
                    "salt_to_key": found,
                    "literal_count": len(decoded_strings),
                    "literal_lengths": dict(Counter(len(l[2:-1]) for l in decoded_strings)),
                },
                fh,
                ensure_ascii=False,
                indent=2,
            )
        print(f"已写入 {out_path}（含完整密钥，注意保密）")
    return 0 if found else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
