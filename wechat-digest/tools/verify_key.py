"""SQLCipher 4 密钥校验：用 HMAC-SHA512 判定候选密钥是否真的对。

为什么必须校验：内存里"长得像密钥"的字符串成百上千，命中不等于正确。
SQLCipher 每页自带 HMAC，能对上才是唯一可信的判据（比解密看文件头更严格）。

布局（page_size=4096, reserve=80，微信 4.1+ 实测）：
    [0:16]      salt（仅第 1 页，明文）
    [16:4016]   加密数据
    [4016:4032] 本页随机 IV
    [4032:4096] HMAC-SHA512

密钥派生：
    enc_key = PBKDF2-HMAC-SHA512(passphrase, salt, 256000, dklen=32)
    mac_salt = salt XOR 0x3a
    mac_key  = PBKDF2-HMAC-SHA512(enc_key, mac_salt, 2, dklen=32)
    HMAC-SHA512(mac_key, page1[16:4032] + LE32(1)) == page1[4032:4096]

用法：
  python verify_key.py <db 路径> <payload_hex> [更多 payload ...]
  python verify_key.py <db 路径> --from-scan scan2.json [--limit 200]

payload 可以是 64 位 hex（passphrase）或 96 位 hex（passphrase+salt，前 64 位生效）。
"""
from __future__ import annotations

import hashlib
import hmac as hmac_mod
import json
import struct
import sys

PAGE = 4096
RESERVE = 80
IV_OFF = PAGE - RESERVE          # 4016
HMAC_OFF = PAGE - RESERVE + 16   # 4032
ITERATIONS = 256000


def derive_enc_key(passphrase: bytes, salt: bytes, iterations: int = ITERATIONS) -> bytes:
    return hashlib.pbkdf2_hmac("sha512", passphrase, salt, iterations, dklen=32)


def page1_hmac_ok(enc_key: bytes, page1: bytes) -> bool:
    if len(page1) < PAGE:
        return False
    salt = page1[:16]
    stored = page1[HMAC_OFF:PAGE]
    mac_salt = bytes(b ^ 0x3A for b in salt)
    mac_key = hashlib.pbkdf2_hmac("sha512", enc_key, mac_salt, 2, dklen=32)
    calc = hmac_mod.new(mac_key, page1[16:HMAC_OFF] + struct.pack("<I", 1), hashlib.sha512).digest()
    return hmac_mod.compare_digest(calc, stored)


def header_ok(enc_key: bytes, page1: bytes) -> bool:
    """退化校验：直接用页内 IV 解密第 1 页前 16 字节，看是不是 SQLite 文件头。"""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    iv = page1[IV_OFF:IV_OFF + 16]
    dec = Cipher(algorithms.AES(enc_key), modes.CBC(iv)).decryptor()
    return (dec.update(page1[16:32]) + dec.finalize()) == b"SQLite format 3\x00"


def test(db_path: str, payload_hex: str, iterations: int = ITERATIONS, deep: bool = False) -> bool:
    passphrase = bytes.fromhex(payload_hex[:64])
    with open(db_path, "rb") as fh:
        page1 = fh.read(PAGE)
    enc_key = derive_enc_key(passphrase, page1[:16], iterations)
    if page1_hmac_ok(enc_key, page1):
        print(f"    [HMAC 通过] payload={payload_hex[:32]}... iter={iterations}")
        if deep:
            print(f"    [文件头] {'OK' if header_ok(enc_key, page1) else '不匹配'}")
        return True
    return False


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    db_path = argv[0]
    rest = argv[1:]
    limit = 200
    payloads: list[str] = []
    if rest and rest[0] == "--from-scan":
        with open(rest[1], encoding="utf-8") as fh:
            report = json.load(fh)
        merged = report.get("ascii", []) + report.get("utf16", [])
        merged.sort(key=lambda item: item["count"], reverse=True)
        payloads = [item["payload"] for item in merged][:limit]
    else:
        payloads = rest

    print(f"目标库: {db_path}")
    print(f"待校验候选: {len(payloads)} 个（PBKDF2 256000 轮，每个约 0.2-0.5 秒）")
    for idx, payload in enumerate(payloads):
        for iterations in (ITERATIONS, 64000):
            if test(db_path, payload, iterations, deep=True):
                print(f"\n结果: 第 {idx} 个候选有效 -> passphrase = {payload[:64]}")
                return 0
    print("\n结果: 全部候选均未通过 HMAC 校验")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
