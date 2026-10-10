"""
Extract SQLCipher key candidates from live WeChat process memory and validate
them against a real database page. Read-only against the target process.
"""
import ctypes
import ctypes.wintypes as wt
import binascii
import hashlib
import os
import re
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from recon_key import scan_process, process_ids  # noqa: E402

ACCT = r"G:\weixin\xwechat_files\wxid_pysr0b0aplrs21_986b"
DB = os.path.join(ACCT, "db_storage", "message", "message_0.db")
PAGE = 4096
SQLITE_MAGIC = b"SQLite format 3\x00"


def read_page1(path, n=PAGE):
    """Read first n bytes allowing other processes to hold the file open."""
    import ctypes.wintypes as wt
    GENERIC_READ = 0x80000000
    FILE_SHARE_ALL = 0x00000007
    OPEN_EXISTING = 3
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateFileW.restype = wt.HANDLE
    k32.CreateFileW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p,
                                wt.DWORD, wt.DWORD, wt.HANDLE]
    h = k32.CreateFileW(path, GENERIC_READ, FILE_SHARE_ALL, None, OPEN_EXISTING, 0, None)
    if h == wt.HANDLE(-1).value or h is None:
        raise OSError(f"CreateFileW failed err={ctypes.get_last_error()} for {path}")
    buf = ctypes.create_string_buffer(n)
    got = wt.DWORD(0)
    k32.ReadFile(h, buf, n, ctypes.byref(got), None)
    k32.CloseHandle(h)
    return buf.raw[: got.value]


def try_decrypt(page1, key, reserve, tag):
    payload_len = PAGE - reserve
    if payload_len <= 0 or payload_len % 16:
        return None
    iv = page1[payload_len:payload_len + 16]
    if len(iv) != 16:
        return None
    dec = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    pt = dec.update(page1[:payload_len]) + dec.finalize()
    if pt.startswith(SQLITE_MAGIC):
        return pt
    return None


def candidates(material, salt_file):
    """Yield (key, label) candidates for a 32/48-byte material."""
    out = []
    if len(material) >= 32:
        out.append((("raw32", hashlib.sha256(b"").digest()), None))  # placeholder removed below
        out.pop()
        out.append((material[:32], "raw-key(first32)"))
    salts = {"file": salt_file}
    if len(material) == 48:
        salts["literal"] = material[32:48]
    passw = {
        "bytes": bytes(material),
        "hexstr": binascii.hexlify(material),
    }
    if len(material) == 48:
        passw["key32bytes"] = bytes(material[:32])
        passw["key32hex"] = binascii.hexlify(material[:32])
    for sname, salt in salts.items():
        if len(salt) != 16:
            continue
        for pname, pw in passw.items():
            for halg, miniter in (("sha512", 256000), ("sha256", 256000),
                                  ("sha1", 64000), ("sha512", 64000)):
                for it in {miniter, 1, 4000, 64000, 256000}:
                    try:
                        k = hashlib.pbkdf2_hmac(halg, pw, salt, it, 32)
                    except Exception:
                        continue
                    out.append((k, f"pbkdf2-{halg}-{it}-salt:{sname}-pw:{pname}"))
    return out


def main():
    page1 = read_page1(DB)
    salt_file = page1[:16]
    print(f"DB: {DB}")
    print(f"file salt (first 16 bytes): {binascii.hexlify(salt_file).decode()}")
    print(f"page1[:16] hex: {binascii.hexlify(page1[:16]).decode()}\n")

    procs = [p for p in process_ids() if p[1].lower().startswith("weixin")]
    bodies = {}
    for pid, name in procs:
        total, err, matches = scan_process(pid)
        if err:
            continue
        for addr, h in matches:
            bodies.setdefault(h.decode().lower(), []).append((pid, addr))

    print(f"unique x'..' bodies: {len(bodies)}")
    with open("key_candidates.txt", "w", encoding="utf-8") as f:
        for b in bodies:
            f.write(b + "\n")

    found = []
    for body, locs in bodies.items():
        material = binascii.unhexlify(body)
        print(f"\n--- candidate body len={len(body)} hex ({len(material)} bytes) "
              f"@pid={locs[0][0]} addr={locs[0][1]:#x}")
        for key, label in candidates(material, salt_file):
            for reserve in (48, 80, 32, 64, 16, 20, 36, 96, 112, 128):
                pt = try_decrypt(page1, key, reserve, label)
                if pt:
                    print(f"    *** MATCH reserve={reserve} :: {label}")
                    print(f"        decrypted header: {pt[:32]!r}")
                    found.append((body, reserve, label, key.hex()))
                    break
    print("\n===== RESULTS =====")
    for body, reserve, label, keyhex in found:
        print(f"body={body}\n  reserve={reserve}\n  scheme={label}\n  aeskey={keyhex}")
    if not found:
        print("no match yet")


if __name__ == "__main__":
    main()
