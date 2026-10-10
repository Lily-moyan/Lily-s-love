"""
Brute force the SQLCipher AES-256 key by scanning the live WeChat process memory
for a 32-byte window that decrypts page 1 of the target DB.

Oracle: for CBC, P1 = D_K(C1) XOR IV, so we need D_K(C1) == MAGIC XOR IV.
That is a single AES block operation per candidate key.

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

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
MEM_COMMIT = 0x1000
MEM_PRIVATE = 0x20000
MEM_MAPPED = 0x40000
MEM_IMAGE = 0x1000000
PAGE_NOACCESS = 0x01
PAGE_GUARD = 0x100
READABLE = {0x02, 0x04, 0x08, 0x20, 0x40, 0x80}
SQLITE_MAGIC = b"SQLite format 3\x00"


class MEMORY_BASIC_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_void_p),
        ("AllocationBase", ctypes.c_void_p),
        ("AllocationProtect", wt.DWORD),
        ("RegionSize", ctypes.c_size_t),
        ("State", wt.DWORD),
        ("Protect", wt.DWORD),
        ("Type", wt.DWORD),
    ]


k32.VirtualQueryEx.argtypes = [wt.HANDLE, ctypes.c_void_p,
                               ctypes.POINTER(MEMORY_BASIC_INFORMATION), ctypes.c_size_t]
k32.VirtualQueryEx.restype = ctypes.c_size_t
k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
k32.OpenProcess.restype = wt.HANDLE
k32.ReadProcessMemory.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p,
                                  ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
k32.ReadProcessMemory.restype = wt.BOOL
k32.CloseHandle.argtypes = [wt.HANDLE]


def regions(h):
    addr = 0
    mbi = MEMORY_BASIC_INFORMATION()
    sz = ctypes.sizeof(mbi)
    out = []
    while k32.VirtualQueryEx(h, ctypes.c_void_p(addr), ctypes.byref(mbi), sz) == sz:
        base = mbi.BaseAddress or 0
        rsize = mbi.RegionSize
        nxt = base + rsize
        if nxt <= addr:
            break
        addr = nxt
        if mbi.State != MEM_COMMIT:
            continue
        if mbi.Protect & (PAGE_GUARD | PAGE_NOACCESS):
            continue
        if (mbi.Protect & 0xFF) not in READABLE:
            continue
        out.append((base, rsize, mbi.Type, mbi.Protect))
    return out


def main(db_path, page_size=4096, reserve=48, step=1, types_filter=None, max_mb=None):
    page = read_page1(db_path, max(page_size, 8192))
    plen = page_size - reserve
    iv = page[plen:plen + 16]
    c1 = page[:16]
    target = bytes(a ^ b for a, b in zip(SQLITE_MAGIC, iv))
    print(f"DB={db_path}")
    print(f"page_size={page_size} reserve={reserve}")
    print(f"C1     = {binascii.hexlify(c1).decode()}")
    print(f"IV     = {binascii.hexlify(iv).decode()}")
    print(f"target = {binascii.hexlify(target).decode()}  (D_K(C1) must equal this)")

    AES = algorithms.AES
    ECB = modes.ECB
    dec = lambda k: Cipher(AES(k), ECB()).decryptor().update(c1)  # noqa: E731

    # benchmark
    t0 = time.time()
    n = 3000
    for i in range(n):
        dec(page[16:48])
    dt = time.time() - t0
    per = dt / n
    print(f"\nbenchmark: {per*1e6:.2f} us/candidate")

    procs = [(pid, nm) for pid, nm in process_ids() if nm.lower().startswith("weixin")]
    target_pid = 8716
    for pid, nm in procs:
        if pid in [p for p, _ in procs]:
            pass
    pid = target_pid
    print(f"target process pid={pid}")

    h = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not h:
        print("OpenProcess failed")
        return None
    regs = regions(h)
    if types_filter:
        regs = [r for r in regs if r[2] in types_filter]
    total = sum(r[1] for r in regs)
    print(f"regions={len(regs)} total={total/1048576:.1f} MB")
    est = (total / step) * per
    print(f"estimated scan time: {est:.0f}s ({est/60:.1f} min) with step={step}")

    if max_mb:
        budget = max_mb * 1048576
        kept, acc = [], 0
        for r in regs:
            if acc + r[1] > budget:
                break
            kept.append(r)
            acc += r[1]
        regs = kept
        print(f"limited to {acc/1048576:.1f} MB")

    CHUNK = 4 * 1024 * 1024
    scanned = 0
    cands = 0
    t0 = time.time()
    last_report = t0
    for base, rsize, rtype, prot in regs:
        off = 0
        carry = b""
        carry_base = base
        while off < rsize:
            n = min(CHUNK, rsize - off)
            buf = ctypes.create_string_buffer(n)
            got = ctypes.c_size_t(0)
            if not k32.ReadProcessMemory(h, ctypes.c_void_p(base + off), buf, n,
                                         ctypes.byref(got)) or not got.value:
                carry = b""
                carry_base = base + off + n
                off += n
                continue
            data = carry + buf.raw[: got.value]
            dbase = carry_base
            scanned += got.value
            limit = len(data) - 31
            for i in range(0, limit, step):
                k = data[i:i + 32]
                cands += 1
                if dec(k) == target:
                    key = bytes(k)
                    print(f"\n*** KEY FOUND ***")
                    print(f"    address = {dbase+i:#x}")
                    print(f"    key     = {binascii.hexlify(key).decode()}")
                    k32.CloseHandle(h)
                    return key
            carry = data[-64:]
            carry_base = dbase + len(data) - len(carry)
            off += n
            now = time.time()
            if now - last_report > 20:
                last_report = now
                print(f"    ...{scanned/1048576:.0f} MB, {cands/1e6:.1f}M candidates, "
                      f"{now-t0:.0f}s", flush=True)
    k32.CloseHandle(h)
    print(f"\nnot found. scanned={scanned/1048576:.1f} MB candidates={cands/1e6:.1f}M "
          f"elapsed={time.time()-t0:.0f}s")
    return None


if __name__ == "__main__":
    db = sys.argv[1] if len(sys.argv) > 1 else \
        r"G:\weixin\xwechat_files\wxid_pysr0b0aplrs21_986b\db_storage\message\message_0.db"
    step = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    mb = int(sys.argv[3]) if len(sys.argv) > 3 else None
    main(db, step=step, max_mb=mb)
