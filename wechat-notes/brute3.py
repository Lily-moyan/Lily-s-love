"""
Optimised, layout-agnostic SQLCipher key brute force over WeChat process memory.

Oracle: P = D_K(C) XOR IV, and IV (when page-resident) is one of the 16-byte
windows of page 1. So per candidate key we decrypt page[0:32] with AES-ECB once
and compare against pre-indexed integer sets -- covering every reserve size,
both IV placements and all page sizes at once.

Read-only against the target process.
"""
import binascii
import ctypes
import ctypes.wintypes as wt
import os
import sys
import time

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from recon_key import process_ids  # noqa: E402
from crack import read_page1  # noqa: E402
from brute import (regions, k32, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
                   MEM_PRIVATE, MEM_MAPPED, MEM_IMAGE)  # noqa: E402

MAGIC = b"SQLite format 3\x00"
HDRS = {
    "4096": bytes([0x10, 0x00, 0x01, 0x01, 0x00, 0x40, 0x20, 0x20]),
    "2048": bytes([0x08, 0x00, 0x01, 0x01, 0x00, 0x40, 0x20, 0x20]),
    "1024": bytes([0x04, 0x00, 0x01, 0x01, 0x00, 0x40, 0x20, 0x20]),
    "8192": bytes([0x20, 0x00, 0x01, 0x01, 0x00, 0x40, 0x20, 0x20]),
}

CHUNK = 4 * 1024 * 1024


def build_sets(page):
    s16 = set()
    s8 = set()
    for i in range(0, len(page) - 15):
        w = page[i:i + 16]
        s16.add(int.from_bytes(w, "big"))
        s8.add(int.from_bytes(w[:8], "big"))
    return s16, s8


def make_oracle(page):
    s16, s8 = build_sets(page)
    magic = int.from_bytes(MAGIC, "big")
    hdrs = {k: (int.from_bytes(v, "big"), 0xFFFFFFFFFFFFFFFF) for k, v in HDRS.items()}
    c = page[0:32]

    def hit(dek):
        y0 = int.from_bytes(dek[0:16], "big")
        y1 = int.from_bytes(dek[16:32], "big")
        for tag, y in (("blk0", y0), ("blk1", y1)):
            if (y ^ magic) in s16:
                return f"{tag}/magic"
            for hname, (hi, mask) in hdrs.items():
                # compare the top 8 bytes of the implied 16-byte IV
                if ((y ^ hi) >> 64) in s8:
                    return f"{tag}/hdr{hname}"
        return None

    return c, hit


def verify(page, key):
    out = []
    for page_size in (4096, 2048, 1024, 8192):
        if page_size > len(page):
            continue
        for start in (0, 16):
            for reserve in range(16, page_size // 2, 16):
                plen = page_size - reserve - start
                if plen <= 0 or plen % 16:
                    continue
                iv = page[start + plen:start + plen + 16]
                if len(iv) != 16:
                    continue
                try:
                    d = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
                    pt = d.update(page[start:start + plen]) + d.finalize()
                except Exception:
                    continue
                if start == 0 and pt.startswith(MAGIC):
                    out.append((page_size, reserve, start, pt))
                elif start == 16 and (pt[:8] == HDRS["4096"] or pt[:8] == HDRS["1024"]
                                      or pt[:8] == HDRS["2048"] or pt[:8] == HDRS["8192"]):
                    out.append((page_size, reserve, start, page[:16] + pt))
    return out


def main(db_path, step=8, types="private", max_mb=None, pid_wanted=None):
    page = read_page1(db_path, 8192)
    print(f"DB={db_path}")
    print(f"salt={binascii.hexlify(page[:16]).decode()}")
    c, hit = make_oracle(page)
    print(f"page[0:32]={binascii.hexlify(c).decode()}")

    typef = None
    if types == "private":
        typef = {MEM_PRIVATE}
    elif types == "all":
        typef = None
    print(f"region filter: {types}   step={step}   max_mb={max_mb}")

    AES, ECB = algorithms.AES, modes.ECB
    procs = [(pid, nm) for pid, nm in process_ids() if nm.lower().startswith("weixin")]
    if pid_wanted:
        procs = [p for p in procs if p[0] == pid_wanted]

    grand_total = 0
    t0 = time.time()
    for pid, nm in procs:
        h = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
        if not h:
            continue
        regs = regions(h)
        if typef:
            regs = [r for r in regs if r[2] in typef]
        total = sum(r[1] for r in regs)
        # region type breakdown
        brk = {}
        for r in regions(h):
            brk[r[2]] = brk.get(r[2], 0) + r[1]
        print(f"\npid={pid} {nm}: selected {len(regs)} regions {total/1048576:.1f} MB "
              f"(type breakdown MB: " +
              ", ".join(f"{k:#x}={v/1048576:.0f}" for k, v in sorted(brk.items())) + ")")
        if max_mb:
            budget, kept, acc = max_mb * 1048576, [], 0
            for r in regs:
                if acc + r[1] > budget:
                    break
                kept.append(r)
                acc += r[1]
            regs = kept
            total = acc
            print(f"  capped to {acc/1048576:.1f} MB")

        scanned = 0
        last = time.time()
        for base, rsize, rtype, prot in regs:
            off = 0
            carry = b""
            cbase = base
            while off < rsize:
                n = min(CHUNK, rsize - off)
                buf = ctypes.create_string_buffer(n)
                got = ctypes.c_size_t(0)
                if not k32.ReadProcessMemory(h, ctypes.c_void_p(base + off), buf, n,
                                             ctypes.byref(got)) or not got.value:
                    carry = b""
                    cbase = base + off + n
                    off += n
                    continue
                data = carry + buf.raw[: got.value]
                dbase = cbase
                scanned += got.value
                grand_total += got.value
                limit = len(data) - 31
                for i in range(0, limit, step):
                    k = data[i:i + 32]
                    dek = Cipher(AES(k), ECB()).decryptor().update(c)
                    r = hit(dek)
                    if r:
                        key = bytes(k)
                        print(f"\n*** CANDIDATE *** {r}")
                        print(f"    pid={pid} addr={dbase+i:#x}")
                        print(f"    key={binascii.hexlify(key).decode()}")
                        vr = verify(page, key)
                        for page_size, reserve, start, pt in vr:
                            print(f"    VERIFIED page_size={page_size} reserve={reserve} "
                                  f"start={start} header={pt[:24]!r}")
                        if vr:
                            with open("FOUND_KEY.txt", "w", encoding="utf-8") as f:
                                f.write(binascii.hexlify(key).decode() + "\n")
                            k32.CloseHandle(h)
                            return key, vr
                carry = data[-64:]
                cbase = dbase + len(data) - len(carry)
                off += n
                if time.time() - last > 15:
                    last = time.time()
                    el = time.time() - t0
                    print(f"    {scanned/1048576:.0f}/{total/1048576:.0f} MB  "
                          f"{el:.0f}s  {grand_total/el/1048576:.1f} MB/s", flush=True)
        k32.CloseHandle(h)
    print(f"\nno key. elapsed={time.time()-t0:.0f}s scanned={grand_total/1048576:.1f} MB")
    return None, None


if __name__ == "__main__":
    db = sys.argv[1] if len(sys.argv) > 1 else \
        r"G:\weixin\xwechat_files\wxid_pysr0b0aplrs21_986b\db_storage\message\message_0.db"
    step = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    types = sys.argv[3] if len(sys.argv) > 3 else "private"
    mb = int(sys.argv[4]) if len(sys.argv) > 4 else None
    main(db, step=step, types=types, max_mb=mb)
