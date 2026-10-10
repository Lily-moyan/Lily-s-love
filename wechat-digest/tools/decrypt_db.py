"""用提取到的密钥解密微信 4.1+ 数据库（SQLCipher 4）。

页面布局（page_size=4096, reserve=80）：
    [0:16]      salt（仅第 1 页，明文）
    [16:4016]   加密数据
    [4016:4032] 本页 IV（每页独立随机）
    [4032:4096] HMAC-SHA512

第 1 页解密后需要重新拼上 "SQLite format 3\\x00" 文件头；所有页尾部补 80 字节 0。

用法： python decrypt_db.py --keys out/keys.json --db-dir backup/db_storage --out-dir out/decrypted
"""
from __future__ import annotations

import hashlib
import hmac as hmac_mod
import json
import os
import struct
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

PAGE_SZ = 4096
RESERVE_SZ = 80
IV_SZ = 16
KEY_SZ = 32
SALT_SZ = 16
HMAC_SZ = 64
SQLITE_HDR = b"SQLite format 3\x00"


def page1_hmac_ok(enc_key: bytes, page1: bytes) -> bool:
    salt = page1[:SALT_SZ]
    mac_salt = bytes(b ^ 0x3A for b in salt)
    mac_key = hashlib.pbkdf2_hmac("sha512", enc_key, mac_salt, 2, dklen=KEY_SZ)
    data = page1[SALT_SZ : PAGE_SZ - RESERVE_SZ + IV_SZ]
    stored = page1[PAGE_SZ - HMAC_SZ : PAGE_SZ]
    hm = hmac_mod.new(mac_key, data, hashlib.sha512)
    hm.update(struct.pack("<I", 1))
    return hmac_mod.compare_digest(hm.digest(), stored)


def decrypt_file(src: str, dst: str, enc_key: bytes) -> tuple[bool, int]:
    size = os.path.getsize(src)
    npages = (size + PAGE_SZ - 1) // PAGE_SZ
    with open(src, "rb") as fin:
        page1 = fin.read(PAGE_SZ)
    if len(page1) < PAGE_SZ:
        return False, 0
    if not page1_hmac_ok(enc_key, page1):
        return False, 0

    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    with open(src, "rb") as fin, open(dst, "wb") as fout:
        for pgno in range(1, npages + 1):
            page = fin.read(PAGE_SZ)
            if len(page) < PAGE_SZ:
                if not page:
                    break
                page = page + b"\x00" * (PAGE_SZ - len(page))
            iv = page[PAGE_SZ - RESERVE_SZ : PAGE_SZ - RESERVE_SZ + IV_SZ]
            dec = Cipher(algorithms.AES(enc_key), modes.CBC(iv)).decryptor()
            if pgno == 1:
                body = dec.update(page[SALT_SZ : PAGE_SZ - RESERVE_SZ]) + dec.finalize()
                fout.write(SQLITE_HDR + body + b"\x00" * RESERVE_SZ)
            else:
                body = dec.update(page[: PAGE_SZ - RESERVE_SZ]) + dec.finalize()
                fout.write(body + b"\x00" * RESERVE_SZ)
    return True, npages


def main(argv: list[str]) -> int:
    keys_path = db_dir = out_dir = None
    i = 0
    while i < len(argv):
        if argv[i] == "--keys":
            i += 1
            keys_path = argv[i]
        elif argv[i] == "--db-dir":
            i += 1
            db_dir = argv[i]
        elif argv[i] == "--out-dir":
            i += 1
            out_dir = argv[i]
        else:
            i += 1
        i += 1
    if not (keys_path and db_dir and out_dir):
        print(__doc__)
        return 2

    with open(keys_path, encoding="utf-8") as fh:
        key_map = json.load(fh)["salt_to_key"]

    results = []
    for root, _dirs, files in os.walk(db_dir):
        for name in sorted(files):
            if not name.endswith(".db"):
                continue
            src = os.path.join(root, name)
            if os.path.getsize(src) < PAGE_SZ:
                continue
            with open(src, "rb") as fh:
                salt_hex = fh.read(SALT_SZ).hex()
            enc_key_hex = key_map.get(salt_hex)
            rel = os.path.relpath(src, db_dir)
            dst = os.path.join(out_dir, rel)
            if not enc_key_hex:
                results.append((rel, "NO_KEY", 0))
                continue
            ok, npages = decrypt_file(src, dst, bytes.fromhex(enc_key_hex))
            results.append((rel, "OK" if ok else "HMAC_FAIL", npages))

    ok_n = sum(1 for r in results if r[1] == "OK")
    print(f"{'文件':<28}{'状态':<12}{'页数':>8}")
    print("-" * 50)
    for rel, status, npages in results:
        print(f"{rel:<28}{status:<12}{npages:>8}")
    print(f"\n合计: {ok_n}/{len(results)} 个数据库解密成功")
    return 0 if ok_n else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
