"""
Layout-agnostic SQLCipher key brute force.

Key insight: for CBC, plaintext P = D_K(C) XOR IV. If we know the first plaintext
block P of page 1 (the SQLite header), then the IV must be D_K(C) XOR P, and an IV
is always stored inside the page itself. So for each candidate key we run ONE AES
block decrypt and then simply test whether the implied IV occurs in the page.

That single test covers every reserve size, both IV placements and every page size
at once, with no per-layout cost.

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
from brute import regions, k32, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ  # noqa: E402

MAGIC = b"SQLite format 3\x00"
# sqlite header bytes 16.. : page size, write ver, read ver, reserved, payload fracs
HDR4096 = bytes([0x10, 0x00, 0x01, 0x01, 0x00, 0x40, 0x20, 0x20])
HDR1024 = bytes([0x04, 0x00, 0x01, 0x01, 0x00, 0x40, 0x20, 0x20])


class Oracle:
    def __init__(self, page):
        self.page = page
        self.sixteen = set()     # all 16-byte windows
        self.prefix8 = set()     # first 8 bytes of all 16-byte windows
        for i in range(0, len(page) - 15):
            w = page[i:i + 16]
            self.sixteen.add(w)
            self.prefix8.add(w[:8])
        self.c = page[0:32]

    def hit(self, dek):
        """dek = AES-ECB-decrypt of page[0:32]; returns reason or None."""
        y0, y1 = dek[0:16], dek[16:32]
        for name, y in (("blk0", y0), ("blk1", y1)):
            iv = bytes(a ^ b for a, b in zip(y, MAGIC))
            if iv in self.sixteen:
                return f"{name}/magic iv={binascii.hexlify(iv).decode()}"
            for pname, pre in (("hdr4096", HDR4096), ("hdr1024", HDR1024)):
                p8 = bytes(a ^ b for a, b in zip(y[:8], pre))
                if p8 in self.prefix8:
                    return f"{name}/{pname} iv8={binascii.hexlify(p8).decode()}"
        return None


def verify(page, key, reason):
    """Recover the true layout and fully decrypt page 1."""
    results = []
    for page_size in (4096, 1024, 2048, 8192):
        if page_size > len(page):
            continue
        for start in (0, 16):
            for reserve in range(16, page_size // 2, 16):
                plen = page_size - reserve - start
                if plen <= 0 or plen % 16:
                    continue
                ivpos = start + plen
                iv = page[ivpos:ivpos + 16]
                if len(iv) != 16:
                    continue
                try:
                    d = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
                    pt = d.update(page[start:start + plen]) + d.finalize()
                except Exception:
                    continue
                head = page[:16] + pt if start == 16 else pt
                if start == 0 and pt.startswith(MAGIC):
                    results.append((page_size, reserve, start, pt))
                elif start == 16:
                    # plaintext page 1 body follows the on-disk salt
                    if pt[:8] == HDR4096 or pt[:8] == HDR1024 or pt.startswith(MAGIC):
                        results.append((page_size, reserve, start, head))
    return results


def scan_buffer(data, oracle, base, step, key_fn, budget=None):
    n = 0
    t0 = time.time()
    limit = len(data) - 31
    for i in range(0, limit, step):
        k = data[i:i + 32]
        n += 1
        r = oracle.hit(key_fn(k))
        if r:
            return base + i, bytes(k), r
        if budget and time.time() - t0 > budget:
            break
    return None


def main(db_path, mode, radius=2 * 1024 * 1024, step=1, max_mb=None):
    page = read_page1(db_path, 8192)
    salt = page[:16]
    oracle = Oracle(page)
    print(f"DB   : {db_path}")
    print(f"salt : {binascii.hexlify(salt).decode()}")
    print(f"page windows indexed: 16B={len(oracle.sixteen)} 8B-prefix={len(oracle.prefix8)}")

    AES, ECB = algorithms.AES, modes.ECB

    def key_fn(k):
        return Cipher(AES(k), ECB()).decryptor().update(oracle.c)

    procs = [(pid, nm) for pid, nm in process_ids() if nm.lower().startswith("weixin")]
    print(f"weixin pids: {[p for p, _ in procs]}")

    t0 = time.time()
    if mode == "near":
        shex = binascii.hexlify(salt)
        needles = [salt, shex, b"x'" + shex + b"'", shex.upper()]
        CHUNK = 8 * 1024 * 1024
        found = []
        for pid, nm in procs:
            h = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
            if not h:
                continue
            regs = regions(h)
            addrs = []
            for base, rsize, rtype, prot in regs:
                off = 0
                carry = b""
                cbase = base
                while off < rsize:
                    n = min(CHUNK, rsize - off)
                    b = ctypes.create_string_buffer(n)
                    got = ctypes.c_size_t(0)
                    if k32.ReadProcessMemory(h, ctypes.c_void_p(base + off), b, n,
                                             ctypes.byref(got)) and got.value:
                        d = carry + b.raw[: got.value]
                        db_ = cbase
                        for nd in needles:
                            s = 0
                            while True:
                                j = d.find(nd, s)
                                if j < 0:
                                    break
                                addrs.append(db_ + j)
                                s = j + 1
                        carry = d[-256:]
                        cbase = db_ + len(d) - len(carry)
                    else:
                        carry = b""
                        cbase = base + off + n
                    off += n
            addrs = sorted(set(addrs))
            print(f"\npid={pid} {nm}: {len(addrs)} salt occurrences")
            done = set()
            for va in addrs:
                win = None
                wlo = 0
                for base, rsize, rtype, prot in regs:
                    if base <= va < base + rsize:
                        lo = max(base, va - radius)
                        hi = min(base + rsize, va + radius)
                        if (lo, hi) in done:
                            break
                        done.add((lo, hi))
                        n = hi - lo
                        b = ctypes.create_string_buffer(n)
                        got = ctypes.c_size_t(0)
                        if k32.ReadProcessMemory(h, ctypes.c_void_p(lo), b, n,
                                                 ctypes.byref(got)) and got.value:
                            win, wlo = b.raw[: got.value], lo
                        break
                if win is None:
                    continue
                t1 = time.time()
                r = scan_buffer(win, oracle, wlo, step, key_fn)
                print(f"  win {wlo:#x}+{len(win)/1048576:.1f}MB salt@{va:#x} "
                      f"{len(win)/1e6:.1f}M cands {time.time()-t1:.0f}s -> "
                      f"{'HIT' if r else 'miss'}")
                if r:
                    found.append((pid, r))
                    break
            k32.CloseHandle(h)
            if found:
                break
    else:
        CHUNK = 4 * 1024 * 1024
        found = []
        for pid, nm in procs:
            h = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
            if not h:
                continue
            regs = regions(h)
            if max_mb:
                budget = max_mb * 1048576
                kept, acc = [], 0
                for r_ in regs:
                    if acc + r_[1] > budget:
                        break
                    kept.append(r_)
                    acc += r_[1]
                regs = kept
            total = sum(r_[1] for r_ in regs)
            print(f"\npid={pid} {nm}: {len(regs)} regions, {total/1048576:.1f} MB, step={step}")
            scanned = 0
            last = time.time()
            for base, rsize, rtype, prot in regs:
                off = 0
                carry = b""
                cbase = base
                while off < rsize:
                    n = min(CHUNK, rsize - off)
                    b = ctypes.create_string_buffer(n)
                    got = ctypes.c_size_t(0)
                    if not k32.ReadProcessMemory(h, ctypes.c_void_p(base + off), b, n,
                                                 ctypes.byref(got)) or not got.value:
                        carry = b""
                        cbase = base + off + n
                        off += n
                        continue
                    d = carry + b.raw[: got.value]
                    db_ = cbase
                    scanned += got.value
                    r = scan_buffer(d, oracle, db_, step, key_fn)
                    if r:
                        found.append((pid, r))
                        break
                    carry = d[-64:]
                    cbase = db_ + len(d) - len(carry)
                    off += n
                    if time.time() - last > 20:
                        last = time.time()
                        print(f"    {scanned/1048576:.0f} MB  {time.time()-t0:.0f}s", flush=True)
                if found:
                    break
            k32.CloseHandle(h)
            if found:
                break

    print(f"\n===== elapsed {time.time()-t0:.0f}s =====")
    if not found:
        print("NO KEY FOUND")
        return None
    pid, (addr, key, reason) = found[0]
    print(f"*** KEY FOUND *** pid={pid} addr={addr:#x}")
    print(f"    key    = {binascii.hexlify(key).decode()}")
    print(f"    reason = {reason}")
    vr = verify(page, key, reason)
    for page_size, reserve, start, pt in vr:
        print(f"    verify: page_size={page_size} reserve={reserve} start={start} "
              f"header={pt[:24]!r}")
    with open("FOUND_KEY.txt", "w", encoding="utf-8") as f:
        f.write(binascii.hexlify(key).decode() + "\n")
    return key


if __name__ == "__main__":
    db = sys.argv[1] if len(sys.argv) > 1 else \
        r"G:\weixin\xwechat_files\wxid_pysr0b0aplrs21_986b\db_storage\message\message_0.db"
    mode = sys.argv[2] if len(sys.argv) > 2 else "near"
    step = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    radius = int(sys.argv[4]) if len(sys.argv) > 4 else 2 * 1024 * 1024
    main(db, mode, radius=radius, step=step)
