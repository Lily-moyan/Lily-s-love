"""
Hunt the WCDB/SQLCipher key for a target DB.

The DB file's first 16 bytes are the cipher salt. Locate that salt (raw bytes,
ASCII hex, or x'..' literal form) inside the live WeChat process, dump the
surrounding struct, and brute force every 32-byte window in that window as a
raw AES-256 SQLCipher key.

Read-only against the target process.
"""
import binascii
import ctypes
import ctypes.wintypes as wt
import os
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from recon_key import process_ids  # noqa: E402
from crack import read_page1  # noqa: E402

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
MEM_COMMIT = 0x1000
PAGE_NOACCESS = 0x01
PAGE_GUARD = 0x100
READABLE = {0x02, 0x04, 0x08, 0x20, 0x40, 0x80}


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

PAGE = 4096
SQLITE_MAGIC = b"SQLite format 3\x00"
CHUNK = 4 * 1024 * 1024
CTX = 1024


def find_patterns(pid, needles):
    """Return list of (addr, needle_index, context, ctx_base)."""
    h = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not h:
        return []
    hits = []
    addr = 0
    mbi = MEMORY_BASIC_INFORMATION()
    sz = ctypes.sizeof(mbi)
    while k32.VirtualQueryEx(h, ctypes.c_void_p(addr), ctypes.byref(mbi), sz) == sz:
        base = mbi.BaseAddress or 0
        rsize = mbi.RegionSize
        nxt = base + rsize
        if nxt <= addr:
            break
        addr = nxt
        if mbi.State != MEM_COMMIT or (mbi.Protect & (PAGE_GUARD | PAGE_NOACCESS)):
            continue
        if (mbi.Protect & 0xFF) not in READABLE:
            continue
        off = 0
        carry = b""
        carry_base = base
        while off < rsize:
            n = min(CHUNK, rsize - off)
            buf = ctypes.create_string_buffer(n)
            got = ctypes.c_size_t(0)
            if k32.ReadProcessMemory(h, ctypes.c_void_p(base + off), buf, n, ctypes.byref(got)) and got.value:
                data = carry + buf.raw[: got.value]
                dbase = carry_base
                for ni, needle in enumerate(needles):
                    start = 0
                    while True:
                        i = data.find(needle, start)
                        if i < 0:
                            break
                        lo = max(0, i - CTX)
                        hi = min(len(data), i + len(needle) + CTX)
                        hits.append((dbase + i, ni, data[lo:hi], dbase + lo))
                        start = i + 1
                carry = data[-max(CTX, 64):]
                carry_base = dbase + len(data) - len(carry)
            else:
                carry = b""
                carry_base = base + off + n
            off += n
    k32.CloseHandle(h)
    return hits


def check(page1, key, reserve, head_iv):
    """Cheap oracle: does the first plaintext block equal the SQLite magic?"""
    page_size = PAGE
    if head_iv:
        payload_len = page_size - reserve - 16
        if payload_len <= 0 or payload_len % 16:
            return False
        iv = page1[:16]
        ct = page1[16:32]
    else:
        payload_len = page_size - reserve
        if payload_len <= 0 or payload_len % 16:
            return False
        iv = page1[payload_len:payload_len + 16]
        if len(iv) != 16:
            return False
        ct = page1[:16]
    try:
        d = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
        return d.update(ct) == SQLITE_MAGIC
    except Exception:
        return False


def full_decrypt_page1(page1, key, reserve, head_iv):
    if head_iv:
        payload_len = PAGE - reserve - 16
        iv, body = page1[:16], page1[16:16 + payload_len]
    else:
        payload_len = PAGE - reserve
        iv, body = page1[payload_len:payload_len + 16], page1[:payload_len]
    d = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    return d.update(body) + d.finalize()


def main(db_path):
    buf = read_page1(db_path, 8192)
    salt = buf[:16]
    shex = binascii.hexlify(salt)
    needles = [
        salt,
        shex,
        b"x'" + shex + b"'",
        b"X'" + shex + b"'",
        shex.upper(),
    ]
    print(f"DB   : {db_path}")
    print(f"salt : {shex.decode()}")
    print(f"needles: raw / ascii-hex / x'..' literal\n")

    procs = [p for p in process_ids() if p[1].lower().startswith("weixin")]
    grand = 0
    for pid, name in procs:
        hits = find_patterns(pid, needles)
        if not hits:
            continue
        print(f"=== pid={pid} {name}: {len(hits)} salt occurrence(s) ===")
        # merge overlapping contexts to avoid duplicate work
        seen = set()
        for addr, ni, ctx, cbase in hits:
            if (pid, cbase, len(ctx)) in seen:
                continue
            seen.add((pid, cbase, len(ctx)))
            grand += 1
            print(f"\n--- hit @ {addr:#x} form={ni} ctx {cbase:#x}+{len(ctx)} ---")
            for i in range(0, len(ctx), 16):
                row = ctx[i:i + 16]
                hx = " ".join(f"{b:02x}" for b in row)
                asc = "".join(chr(b) if 32 <= b < 127 else "." for b in row)
                mark = " <<<" if cbase + i <= addr < cbase + i + 16 else ""
                print(f"    {cbase + i:#014x}  {hx:<47}  {asc}{mark}")

            for off in range(0, max(1, len(ctx) - 31)):
                key = ctx[off:off + 32]
                if len(key) < 32:
                    break
                for head_iv in (False, True):
                    for reserve in range(16, 401, 16):
                        if check(buf, key, reserve, head_iv):
                            pt = full_decrypt_page1(buf, key, reserve, head_iv)
                            print(f"\n*** KEY FOUND ***")
                            print(f"    addr    = {cbase+off:#x}")
                            print(f"    key     = {binascii.hexlify(key).decode()}")
                            print(f"    reserve = {reserve}  head_iv={head_iv}")
                            print(f"    page1   = {pt[:64]!r}")
                            return key, reserve, head_iv
            print("    (no key in this context)")
    print(f"\nDone. {grand} distinct contexts scanned, no key found.")
    return None, None, None


if __name__ == "__main__":
    db = sys.argv[1] if len(sys.argv) > 1 else \
        r"G:\weixin\xwechat_files\wxid_pysr0b0aplrs21_986b\db_storage\message\message_0.db"
    main(db)
