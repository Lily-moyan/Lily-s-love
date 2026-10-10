"""
Targeted key brute force: locate every occurrence of the target DB's salt in the
live WeChat process, then brute force 32-byte windows in a large window around
each occurrence.

Rationale: the cipher key and the salt belong to the same sqlite/codec context,
so they are very likely within a few hundred KB of each other.

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
from brute import regions, MEMORY_BASIC_INFORMATION, k32, PROCESS_QUERY_INFORMATION, \
    PROCESS_VM_READ, SQLITE_MAGIC  # noqa: E402

CHUNK = 8 * 1024 * 1024


def find_all(pid, needles):
    """Return [(needle_index, addr)] for all occurrences."""
    h = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not h:
        return []
    hits = []
    for base, rsize, rtype, prot in regions(h):
        off = 0
        carry = b""
        carry_base = base
        while off < rsize:
            n = min(CHUNK, rsize - off)
            buf = ctypes.create_string_buffer(n)
            got = ctypes.c_size_t(0)
            if k32.ReadProcessMemory(h, ctypes.c_void_p(base + off), buf, n,
                                     ctypes.byref(got)) and got.value:
                data = carry + buf.raw[: got.value]
                dbase = carry_base
                for ni, needle in enumerate(needles):
                    s = 0
                    while True:
                        i = data.find(needle, s)
                        if i < 0:
                            break
                        hits.append((ni, dbase + i))
                        s = i + 1
                carry = data[-256:]
                carry_base = dbase + len(data) - len(carry)
            else:
                carry = b""
                carry_base = base + off + n
            off += n
    k32.CloseHandle(h)
    return hits


def read_window(h, va, radius, region_list):
    """Read [va-radius, va+radius] clipped to containing region."""
    for base, rsize, rtype, prot in region_list:
        if base <= va < base + rsize:
            lo = max(base, va - radius)
            hi = min(base + rsize, va + radius)
            n = hi - lo
            if n <= 0:
                return None, 0
            buf = ctypes.create_string_buffer(n)
            got = ctypes.c_size_t(0)
            if k32.ReadProcessMemory(h, ctypes.c_void_p(lo), buf, n, ctypes.byref(got)) and got.value:
                return buf.raw[: got.value], lo
            return None, 0
    return None, 0


def main(db_path, radius, step):
    page = read_page1(db_path, 8192)
    salt = page[:16]
    shex = binascii.hexlify(salt)
    needles = [salt, shex, b"x'" + shex + b"'", shex.upper()]
    print(f"DB    : {db_path}")
    print(f"salt  : {shex.decode()}")
    print(f"radius: {radius/1048576:.1f} MB   step={step}")

    procs = [(pid, nm) for pid, nm in process_ids() if nm.lower().startswith("weixin")]
    all_hits = []
    for pid, nm in procs:
        hits = find_all(pid, needles)
        if hits:
            print(f"pid={pid} {nm}: {len(hits)} salt occurrence(s)")
            all_hits.extend([(pid, ni, a) for ni, a in hits])

    if not all_hits:
        print("salt not present in memory")
        return None

    AES = algorithms.AES
    for page_size, reserve in ((4096, 48),):
        plen = page_size - reserve
        iv = page[plen:plen + 16]
        c1 = page[:16]
        target = bytes(a ^ b for a, b in zip(SQLITE_MAGIC, iv))
        print(f"\nlayout page={page_size} reserve={reserve} target={binascii.hexlify(target).decode()}")

        seen_windows = set()
        for pid, ni, addr in all_hits:
            h = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
            if not h:
                continue
            regs = regions(h)
            data, lo = read_window(h, addr, radius, regs)
            k32.CloseHandle(h)
            if data is None:
                print(f"  hit@{addr:#x} unreadable")
                continue
            if (pid, lo) in seen_windows:
                continue
            seen_windows.add((pid, lo))
            t0 = time.time()
            ncand = 0
            for i in range(0, len(data) - 31, step):
                k = data[i:i + 32]
                ncand += 1
                if Cipher(AES(k), modes.ECB()).decryptor().update(c1) == target:
                    print(f"\n*** KEY FOUND ***")
                    print(f"  addr = {lo+i:#x} (salt hit @ {addr:#x})")
                    print(f"  key  = {binascii.hexlify(bytes(k)).decode()}")
                    return bytes(k)
            print(f"  window@{lo:#x} ({len(data)/1048576:.1f} MB, salt@{addr:#x}, form={ni}) "
                  f"{ncand/1e6:.1f}M cands in {time.time()-t0:.0f}s  -- miss")
    print("\nno key found in any window")
    return None


if __name__ == "__main__":
    db = sys.argv[1] if len(sys.argv) > 1 else \
        r"G:\weixin\xwechat_files\wxid_pysr0b0aplrs21_986b\db_storage\message\message_0.db"
    radius = int(sys.argv[2]) if len(sys.argv) > 2 else 1024 * 1024
    step = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    main(db, radius, step)
