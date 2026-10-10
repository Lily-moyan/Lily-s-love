"""
Enumerate every WeChat DB, print its salt, and test the candidate key material
against each one across layout variants.

Read-only. DB files are opened with FILE_SHARE_READ|WRITE|DELETE so the live
WeChat process holding them open does not block us.
"""
import binascii
import ctypes
import ctypes.wintypes as wt
import glob
import os

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

ACCT = r"G:\weixin\xwechat_files\wxid_pysr0b0aplrs21_986b"
SQLITE_MAGIC = b"SQLite format 3\x00"

CAND = [
    "d653500f5d361bc11636a60177f2a663f0797bf4876b9d388caa8464c07f65a9"
    "65389cd5bffc68dcc22af909b9473315",
    "807e92b18be7817b5a8376fd03d45bdcd40a2915905695273af4418085a6960b"
    "0a496aea7e8ad7dbf386029fb447cc96",
]

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
k32.CreateFileW.restype = wt.HANDLE
k32.CreateFileW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p,
                            wt.DWORD, wt.DWORD, wt.HANDLE]


def read_head(path, n=8192):
    GENERIC_READ = 0x80000000
    FILE_SHARE_ALL = 0x00000007
    OPEN_EXISTING = 3
    h = k32.CreateFileW(path, GENERIC_READ, FILE_SHARE_ALL, None, OPEN_EXISTING, 0, None)
    if h == wt.HANDLE(-1).value or h is None:
        raise OSError(f"CreateFileW failed err={ctypes.get_last_error()} {path}")
    buf = ctypes.create_string_buffer(n)
    got = wt.DWORD(0)
    k32.ReadFile(h, buf, n, ctypes.byref(got), None)
    k32.CloseHandle(h)
    return buf.raw[: got.value]


def decrypt_first_block(page, key, page_size, reserve, head_iv):
    if head_iv:
        plen = page_size - reserve - 16
        if plen <= 0 or plen % 16:
            return None
        iv, ct = page[:16], page[16:32]
    else:
        plen = page_size - reserve
        if plen <= 0 or plen % 16:
            return None
        iv = page[plen:plen + 16]
        if len(iv) != 16:
            return None
        ct = page[:16]
    try:
        d = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
        return d.update(ct)
    except Exception:
        return None


def main():
    dbs = sorted(glob.glob(os.path.join(ACCT, "db_storage", "**", "*.db"), recursive=True))
    dbs = [d for d in dbs if not d.endswith(("-shm", "-wal"))]
    print(f"{len(dbs)} databases\n")

    salts = {}
    for d in dbs:
        try:
            head = read_head(d, 16)
        except OSError as e:
            print(f"  !! {e}")
            continue
        salts[d] = head[:16]

    tails = {c[64:].lower() for c in CAND}
    print("=== salt table ===")
    for d, s in salts.items():
        shex = binascii.hexlify(s).decode()
        rel = os.path.relpath(d, ACCT)
        mark = "  <== matches literal tail" if shex in tails else ""
        print(f"  {shex}  {rel}{mark}")

    # try opening 8192 bytes per db and testing candidate keys
    print("\n=== key trials ===")
    hits = []
    for d in dbs:
        page = read_head(d, 8192)
        for ci, chex in enumerate(CAND):
            mat = binascii.unhexlify(chex)
            keyviews = {
                "first32": mat[:32],
                "last32": mat[16:48],
            }
            for kname, key in keyviews.items():
                for page_size in (4096, 1024, 2048, 8192):
                    for head_iv in (False, True):
                        for reserve in range(16, 513, 16):
                            pt = decrypt_first_block(page, key, page_size, reserve, head_iv)
                            if pt == SQLITE_MAGIC:
                                print(f"  *** HIT db={os.path.relpath(d, ACCT)} "
                                      f"cand={ci} {kname} page={page_size} "
                                      f"reserve={reserve} head_iv={head_iv}")
                                hits.append((d, ci, kname, page_size, reserve, head_iv))
    if not hits:
        print("  (no candidate key decrypts any database with a raw-key scheme)")
    else:
        for h in hits:
            print(" ", h)


if __name__ == "__main__":
    main()
