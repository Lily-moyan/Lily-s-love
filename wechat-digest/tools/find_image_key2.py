"""提取微信 4.x V2 图片的 AES 密钥（内存扫描 + 密码学验证）。

为什么需要内存密钥：本地 .dat 用的不是消息 XML 里那个 <img aeskey>（那是 CDN 下载密钥，
实测无法解密本地文件），而是微信进程里的一个 16 字节密钥。

判据（强验证，不是"猜"）：拿一个 .dat 的 16 字节密文块，用候选密钥做 AES-128-ECB 解密，
结果必须是 JPEG/PNG 魔数。命中即证明密钥正确。

两条扫描路线：
  A 相位窗口扫描：先找内存里的 V2 魔数 `07 08 56 32 08 07`（微信读图片时会留在缓冲区），
    在命中点 ±512 字节内收集可打印 ASCII 的 16 字节窗口。命中数少、极快。
  B 全量 ASCII token 扫描（A 失败时启用）：在可读写内存里找独立的 [A-Za-z0-9]{16} 与 {32}。

只读访问目标进程，不修改微信任何行为。

用法：
  python find_image_key2.py --conv 炒饭会交流群            # 从该会话取探针文件
  python find_image_key2.py --probe-file <某个_t.dat路径>  # 指定探针
"""
from __future__ import annotations

import ctypes
import glob
import json
import os
import re
import struct
import sys
from collections import Counter
from ctypes import wintypes

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

BASE = r"G:\dsh\wechat-digest"
ROOT = r"G:\weixin\xwechat_files\wxid_pysr0b0aplrs21_986b"
ATTACH = os.path.join(ROOT, "msg", "attach")
V2 = b"\x07\x08\x56\x32\x08\x07"
OUT_KEY = os.path.join(BASE, "keys", "image_key.json")

PROCESS_VM_READ = 0x0010
PROCESS_QUERY_INFORMATION = 0x0400
MEM_COMMIT = 0x1000
PAGE_NOACCESS = 0x01
PAGE_GUARD = 0x100
READABLE = {0x02, 0x04, 0x08, 0x20, 0x40, 0x80}
CHUNK = 8 * 1024 * 1024
OVERLAP = 1024

MAGICS = (b"\xff\xd8\xff", b"\x89PNG", b"GIF8", b"RIFF", b"BM", b"wxgf", b"II*\x00")

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


class MBI(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_ulonglong),
        ("AllocationBase", ctypes.c_ulonglong),
        ("AllocationProtect", wintypes.DWORD),
        ("__pad1", wintypes.DWORD),
        ("RegionSize", ctypes.c_ulonglong),
        ("State", wintypes.DWORD),
        ("Protect", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("__pad2", wintypes.DWORD),
    ]


def regions(handle):
    mbi = MBI()
    addr = 0
    while addr < 0x7FFFFFFF0000:
        if not kernel32.VirtualQueryEx(handle, ctypes.c_void_p(addr), ctypes.byref(mbi), ctypes.sizeof(mbi)):
            break
        base, size = mbi.BaseAddress, mbi.RegionSize
        if size == 0:
            break
        if (
            mbi.State == MEM_COMMIT
            and not (mbi.Protect & PAGE_GUARD)
            and mbi.Protect != PAGE_NOACCESS
            and (mbi.Protect & 0xFF) in READABLE
        ):
            yield base, size, bool(mbi.Protect & (0x04 | 0x08 | 0x40 | 0x80))
        addr = base + size


def iter_chunks(handle, rw_only=False):
    buf = ctypes.create_string_buffer(CHUNK + OVERLAP)
    for base, size, is_rw in regions(handle):
        if rw_only and not is_rw:
            continue
        off = 0
        while off < size:
            want = min(CHUNK + OVERLAP, size - off)
            if want <= 0:
                break
            got = ctypes.c_size_t(0)
            if kernel32.ReadProcessMemory(
                handle, ctypes.c_void_p(base + off), buf, want, ctypes.byref(got)
            ) and got.value:
                yield buf.raw[: got.value]
            off += want


def test_key(key: bytes, cipher: bytes) -> str | None:
    if len(key) != 16:
        return None
    try:
        dec = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
        out = dec.update(cipher) + dec.finalize()
    except Exception:
        return None
    for m in MAGICS:
        if out.startswith(m):
            return m.hex()
    return None


def is_printable(b: bytes) -> bool:
    return all(0x20 <= c < 0x7F for c in b)


TOK16 = re.compile(rb"(?<![A-Za-z0-9])[A-Za-z0-9]{16}(?![A-Za-z0-9])")
TOK32 = re.compile(rb"(?<![A-Za-z0-9])[A-Za-z0-9]{32}(?![A-Za-z0-9])")


def main(argv: list[str]) -> int:
    conv = probe_file = None
    pids: list[int] = []
    i = 0
    while i < len(argv):
        if argv[i] == "--conv":
            i += 1
            conv = argv[i]
        elif argv[i] == "--probe-file":
            i += 1
            probe_file = argv[i]
        elif argv[i] == "--pid":
            i += 1
            pids.append(int(argv[i]))
        else:
            try:
                pids.append(int(argv[i]))
            except ValueError:
                pass
        i += 1

    if not probe_file:
        if not conv:
            print(__doc__)
            return 2
        with open(os.path.join(BASE, "out", "conversations.json"), encoding="utf-8") as fh:
            recs = json.load(fh)["records"]
        hits = [r for r in recs if conv in r["display_name"]]
        if not hits:
            print(f"未找到会话 {conv}")
            return 2
        attach = os.path.join(ATTACH, hits[0]["table"][len("Msg_") :])
        cands = sorted(
            glob.glob(os.path.join(attach, "**", "*_t.dat"), recursive=True), key=os.path.getmtime, reverse=True
        )
        if not cands:
            print("该会话没有缩略图文件")
            return 2
        probe_file = cands[0]
        print(f"会话 {hits[0]['display_name']}，探针 {os.path.relpath(probe_file, attach)}")

    with open(probe_file, "rb") as fh:
        head = fh.read(32)
    if head[:6] != V2:
        print(f"探针不是 V2 格式: {head[:6].hex()}")
        return 2
    cipher = head[15:31]
    print(f"探针密文块: {cipher.hex()}")

    if not pids:
        import subprocess

        # 注意：中文 Windows 的 tasklist 输出是 GBK，按 UTF-8 解码会抛异常
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq Weixin.exe", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, encoding="gbk", errors="replace",
            creationflags=0x08000000,
        ).stdout
        for line in out.strip().splitlines():
            parts = line.strip('"').split('","')
            if len(parts) >= 2 and parts[0].lower().startswith("weixin.exe"):
                try:
                    pids.append(int(parts[1]))
                except ValueError:
                    pass
    print(f"Weixin.exe PIDs: {pids}")
    if not pids:
        print("没有找到 Weixin.exe 进程（请确认微信正在运行）")
        return 2

    candidates: Counter = Counter()
    found: tuple[str, str] | None = None

    # ---- 路线 A：V2 魔数附近的 ASCII 窗口 ----
    print("\n=== 路线 A：V2 魔数邻域 ASCII 窗口 ===")
    for pid in pids:
        h = kernel32.OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, False, pid)
        if not h:
            print(f"  PID {pid} 打开失败")
            continue
        magic_hits = 0
        try:
            for data in iter_chunks(h):
                start = 0
                while True:
                    idx = data.find(V2, start)
                    if idx < 0:
                        break
                    start = idx + 1
                    magic_hits += 1
                    lo = max(0, idx - 512)
                    hi = min(len(data), idx + 512)
                    win = data[lo:hi]
                    for p in range(len(win) - 16):
                        k = win[p : p + 16]
                        if is_printable(k):
                            candidates[k] += 1
        finally:
            kernel32.CloseHandle(h)
        print(f"  PID {pid}: V2 魔数命中 {magic_hits} 处，累计候选 {len(candidates)} 条")
        for k in list(candidates):
            f = test_key(k, cipher)
            if f:
                found = (k.decode("ascii"), f)
                break
        if found:
            break

    # ---- 路线 B：全量 ASCII token ----
    if not found:
        print("\n=== 路线 B：可读写内存中的 ASCII token ===")
        for pid in pids:
            h = kernel32.OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, False, pid)
            if not h:
                continue
            tested = 0
            try:
                for data in iter_chunks(h, rw_only=True):
                    for m in TOK16.finditer(data):
                        k = m.group()
                        tested += 1
                        f = test_key(k, cipher)
                        if f:
                            found = (k.decode("ascii"), f)
                            break
                    if found:
                        break
                    for m in TOK32.finditer(data):
                        k = m.group()[:16]
                        tested += 1
                        f = test_key(k, cipher)
                        if f:
                            found = (k.decode("ascii"), f)
                            break
                    if found:
                        break
            finally:
                kernel32.CloseHandle(h)
            print(f"  PID {pid}: 测试 {tested} 个 token")
            if found:
                break

    print()
    if not found:
        print("未找到 AES 密钥。")
        print("提示：微信需先打开几张图片（查看原图），密钥才会驻留内存，之后立刻重跑本脚本。")
        return 1
    key, fmt = found
    print(f"*** 找到 AES 密钥: {key}  （解出魔数 {fmt}） ***")
    os.makedirs(os.path.dirname(OUT_KEY), exist_ok=True)
    xor_key = None
    probe_attach = os.path.dirname(os.path.dirname(probe_file))
    tails: Counter = Counter()
    for p in glob.glob(os.path.join(probe_attach, "**", "*.dat"), recursive=True)[:64]:
        try:
            size = os.path.getsize(p)
            with open(p, "rb") as fh:
                if fh.read(6) != V2:
                    continue
                fh.seek(size - 2)
                tail = fh.read(2)
        except OSError:
            continue
        if len(tail) == 2:
            k = tail[0] ^ 0xFF
            if (tail[1] ^ k) == 0xD9:
                tails[k] += 1
    if tails:
        xor_key = tails.most_common(1)[0][0]
    payload = {"aes_key": key, "xor_key": xor_key, "probe": probe_file}
    with open(OUT_KEY, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print(f"XOR 密钥: {hex(xor_key) if xor_key is not None else '未推出'}")
    print(f"已写入 {OUT_KEY}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
