"""
Decrypt a WeChat 4.x WCDB/SQLCipher database to a plaintext SQLite file.

The page layout (page size, whether the 16-byte salt occupies the head of the
ciphertext stream, and the reserve size holding IV+HMAC) is auto-detected by
decrypting page 1 and validating the resulting SQLite header, then confirmed
against page 2 being a well-formed b-tree page.

WAL frames are decrypted with the same scheme and folded into the output, so
recent messages that have not been checkpointed are included.

Read-only with respect to WeChat's own files.
"""
import argparse
import binascii
import ctypes
import ctypes.wintypes as wt
import os
import struct
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b"SQLite format 3\x00"
BTREE_TYPES = {0x02, 0x05, 0x0A, 0x0D}

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
k32.CreateFileW.restype = wt.HANDLE
k32.CreateFileW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p,
                            wt.DWORD, wt.DWORD, wt.HANDLE]


def read_locked(path):
    """Read a whole file that another process holds open (shared read)."""
    GENERIC_READ = 0x80000000
    FILE_SHARE_ALL = 0x00000007
    OPEN_EXISTING = 3
    INVALID = wt.HANDLE(-1).value
    h = k32.CreateFileW(path, GENERIC_READ, FILE_SHARE_ALL, None, OPEN_EXISTING, 0, None)
    if h == INVALID or h is None:
        raise OSError(f"cannot open {path} err={ctypes.get_last_error()}")
    chunks = []
    buf = ctypes.create_string_buffer(1 << 20)
    got = wt.DWORD(0)
    while True:
        ok = k32.ReadFile(h, buf, len(buf), ctypes.byref(got), None)
        if not ok or got.value == 0:
            break
        chunks.append(buf.raw[: got.value])
    k32.CloseHandle(h)
    return b"".join(chunks)


def aes_cbc_dec(key, iv, data):
    d = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    return d.update(data) + d.finalize()


def decrypt_page(key, page, info):
    """Return the plaintext page (page_size bytes) or None."""
    page_size, start, reserve = info
    plen = page_size - reserve - start
    if plen <= 0 or plen % 16:
        return None
    iv = page[start + plen:start + plen + 16]
    if len(iv) != 16:
        return None
    try:
        body = aes_cbc_dec(key, iv, page[start:start + plen])
    except Exception:
        return None
    if start == 0:
        pt = body
    elif start == 16:
        pt = page[:16] + body
    else:
        return None
    if len(pt) < page_size:
        pt = pt + b"\x00" * (page_size - len(pt))
    return pt[:page_size]


def detect(key, raw):
    """Find (page_size, start, reserve) that makes page 1 look like SQLite."""
    for page_size in (4096, 1024, 2048, 8192, 512):
        if len(raw) < page_size * 2:
            continue
        for start in (0, 16):
            for reserve in range(16, min(page_size // 2, 600) + 1, 16):
                info = (page_size, start, reserve)
                p1 = decrypt_page(key, raw[:page_size], info)
                if not p1:
                    continue
                if start == 0:
                    ok = p1.startswith(MAGIC)
                else:
                    ok = p1[16:24] in (b"\x10\x00\x01\x01\x00\x40\x20\x20"[:8],
                                       b"\x04\x00\x01\x01\x00\x40\x20\x20"[:8],
                                       b"\x08\x00\x01\x01\x00\x40\x20\x20"[:8],
                                       b"\x20\x00\x01\x01\x00\x40\x20\x20"[:8])
                if not ok:
                    continue
                p2 = decrypt_page(key, raw[page_size:page_size * 2], info)
                if p2 and p2[0] in BTREE_TYPES:
                    return info
    return None


def parse_wal(wal, page_size, key, info):
    """Return {page_no: plaintext_page} from decrypted WAL frames."""
    pages = {}
    if len(wal) < 32:
        return pages
    magic, ver, wpage, ckpt, s1, s2 = struct.unpack(">6I", wal[:24])
    if magic not in (0x377F0682, 0x377F0683):
        return pages
    if wpage not in (512, 1024, 2048, 4096, 8192, 16384, 32768, 65536):
        return pages
    frame = 32
    while frame + 24 + wpage <= len(wal):
        hdr = wal[frame:frame + 24]
        pno, dbsize, fs1, fs2, ck1, ck2 = struct.unpack(">6I", hdr)
        body = wal[frame + 24: frame + 24 + wpage]
        pt = decrypt_page(key, body, info)
        if pt is not None and pno > 0:
            pages[pno] = pt
        frame += 24 + wpage
    return pages


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("key", help="hex AES key")
    ap.add_argument("db", help="encrypted db path")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--no-wal", action="store_true")
    args = ap.parse_args()

    key = binascii.unhexlify(args.key)
    if len(key) != 32:
        print(f"warning: key is {len(key)} bytes, expected 32")

    print(f"reading {args.db} ...")
    raw = read_locked(args.db)
    print(f"  {len(raw)} bytes ({len(raw)/1048576:.1f} MB)")

    info = detect(key, raw)
    if not info:
        print("LAYOUT DETECTION FAILED - key is probably wrong")
        return 1
    page_size, start, reserve = info
    print(f"layout: page_size={page_size} ciphertext_start={start} reserve={reserve}")

    npages = len(raw) // page_size
    print(f"decrypting {npages} pages ...")
    out = bytearray()
    bad = 0
    for i in range(npages):
        pg = raw[i * page_size:(i + 1) * page_size]
        pt = decrypt_page(key, pg, info)
        if pt is None:
            pt = b"\x00" * page_size
            bad += 1
        if i == 0 and start == 16:
            pt = MAGIC + pt[16:]
        out += pt
    print(f"  done ({bad} undecryptable pages)")

    # fold in WAL
    wal_path = args.db + "-wal"
    if not args.no_wal and os.path.exists(wal_path):
        try:
            wal = read_locked(wal_path)
            pages = parse_wal(wal, page_size, key, info)
            print(f"WAL: {len(wal)} bytes -> {len(pages)} page images")
            for pno, pt in pages.items():
                if pno == 1 and start == 16:
                    pt = MAGIC + pt[16:]
                off = (pno - 1) * page_size
                if off + page_size <= len(out):
                    out[off:off + page_size] = pt
                else:
                    # database grew: extend
                    if off > len(out):
                        out += b"\x00" * (off - len(out))
                    out += pt
        except OSError as e:
            print(f"WAL skipped: {e}")

    with open(args.out, "wb") as f:
        f.write(bytes(out))
    print(f"wrote {args.out} ({len(out)/1048576:.1f} MB)")

    import sqlite3
    con = sqlite3.connect(args.out)
    try:
        n = con.execute(
            "select count(*) from sqlite_master where type='table'").fetchone()[0]
        print(f"sqlite3 opened OK: {n} tables")
        for row in con.execute("select name from sqlite_master where type='table' "
                               "order by name limit 40"):
            print("   ", row[0])
    except Exception as e:
        print(f"sqlite3 verification failed: {e}")
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
