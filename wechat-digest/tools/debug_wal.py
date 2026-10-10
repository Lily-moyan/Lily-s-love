"""调试：找出 WAL 帧内页的正确 HMAC/解密参数组合。

已确认的事实：帧头解析正确（pgno 非 0，帧 salt 与 WAL 头 salt 一致），
但按"主库第 1 页/非第 1 页"的规则做 HMAC 全部失败。
这里枚举几种变体，看哪一种能通过校验：
  - 参与 HMAC 的数据范围：page[0:4032] 或 page[16:4032]
  - mac_salt 来源：主库 salt / WAL 头 salt / 帧 salt
  - 参与 HMAC 的页号：帧内 pgno 或固定 1

用法： python debug_wal.py <db 路径>
"""
from __future__ import annotations

import hashlib
import hmac as hmac_mod
import os
import struct
import sys

PAGE_SZ = 4096
HMAC_OFF = 4032
HMAC_SZ = 64
SALT_SZ = 16
KEY_SZ = 32
WAL_HDR_SZ = 32
FRAME_HDR_SZ = 24


def mac_key_for(enc_key: bytes, salt: bytes) -> bytes:
    mac_salt = bytes(b ^ 0x3A for b in salt)
    return hashlib.pbkdf2_hmac("sha512", enc_key, mac_salt, 2, dklen=KEY_SZ)


def check(enc_key: bytes, raw: bytes, data: bytes, pgno: int, salt: bytes) -> bytes:
    mk = mac_key_for(enc_key, salt)
    hm = hmac_mod.new(mk, data, hashlib.sha512)
    hm.update(struct.pack("<I", pgno))
    return hm.digest()


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    db_path = argv[0]
    wal_path = db_path + "-wal"
    keys_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out", "keys.json")
    with open(os.path.abspath(keys_path), encoding="utf-8") as fh:
        import json

        key_map = json.load(fh)["salt_to_key"]

    with open(db_path, "rb") as fh:
        db_salt = fh.read(SALT_SZ)
    enc_key = bytes.fromhex(key_map[db_salt.hex()])

    with open(wal_path, "rb") as fh:
        wal = fh.read()
    print(f"WAL: {wal_path}")
    print(f"  大小 {len(wal)} 字节")
    magic, version, page_size, ckpt, s1, s2 = struct.unpack(">6I", wal[:24])
    print(f"  magic=0x{magic:08x}  version={version}  page_size={page_size}  ckpt_seq={ckpt}")
    print(f"  salt1=0x{s1:08x} salt2=0x{s2:08x}")
    print(f"  wal header hex: {wal[:32].hex()}")
    frame_sz = FRAME_HDR_SZ + PAGE_SZ
    print(f"  (大小-32)/{frame_sz} = {(len(wal)-32)/frame_sz:.3f}  -> 约 {(len(wal)-32)//frame_sz} 帧")
    wal_salt = wal[16:24]
    print(f"  主库 salt={db_salt.hex()}  WAL头 salt={wal_salt.hex()}  相同={db_salt==wal_salt}")

    print("\n  前 6 帧头部：")
    for k in range(6):
        off = WAL_HDR_SZ + k * frame_sz
        if off + FRAME_HDR_SZ > len(wal):
            break
        hdr = wal[off : off + FRAME_HDR_SZ]
        pgno = struct.unpack(">I", hdr[0:4])[0]
        commit = struct.unpack(">I", hdr[4:8])[0]
        fsalt = hdr[8:16]
        print(
            f"    帧{k}: pgno={pgno:<6} commit_pages={commit:<6} salt={fsalt.hex()} "
            f"与WAL头一致={fsalt == wal_salt}  头hex={hdr.hex()}"
        )

    print("\n  枚举 HMAC 变体（帧 0）：")
    off = WAL_HDR_SZ
    hdr = wal[off : off + FRAME_HDR_SZ]
    pgno_f = struct.unpack(">I", hdr[0:4])[0]
    fsalt = hdr[8:16]
    raw = wal[off + FRAME_HDR_SZ : off + frame_sz]
    stored = raw[HMAC_OFF:PAGE_SZ]

    variants = []
    for rng_name, rng in (("page[0:4032]", raw[0:HMAC_OFF]), ("page[16:4032]", raw[SALT_SZ:HMAC_OFF])):
        for salt_name, salt in (("db_salt", db_salt), ("wal_salt", wal_salt), ("frame_salt", fsalt)):
            for pgno_name, pg in (("frame_pgno", pgno_f), ("one", 1), ("frame_pgno+1", pgno_f + 1)):
                got = check(enc_key, raw, rng, pg, salt)
                ok = got == stored
                variants.append((ok, rng_name, salt_name, pgno_name))
    hits = [v for v in variants if v[0]]
    for ok, rng_name, salt_name, pgno_name in variants:
        mark = "  <<< 命中" if ok else ""
        print(f"    {rng_name:<14}{salt_name:<12}pgno={pgno_name:<14}{'OK' if ok else 'x'}{mark}")
    if not hits:
        print("\n  没有任何组合命中。补充线索：")
        print(f"    帧0 存储的 HMAC = {stored.hex()}")
        print(f"    帧0 页前 32 字节 = {raw[:32].hex()}")
        print(f"    帧0 页尾 96 字节 = {raw[PAGE_SZ-96:].hex()}")
        print("\n  再试：HMAC 是否覆盖加密后的整页(含 IV 与 HMAC 区之外的 4016 字节) + pgno 的其它编码")
        for enc_name, payload in (
            ("page[0:4016]", raw[:PAGE_SZ - 80]),
            ("page[16:4016]", raw[SALT_SZ : PAGE_SZ - 80]),
            ("page[0:4032]+pgno(be)", None),
        ):
            if payload is None:
                mk = mac_key_for(enc_key, db_salt)
                hm = hmac_mod.new(mk, raw[0:HMAC_OFF], hashlib.sha512)
                hm.update(struct.pack(">I", pgno_f))
                got = hm.digest()
            else:
                mk = mac_key_for(enc_key, db_salt)
                hm = hmac_mod.new(mk, payload, hashlib.sha512)
                hm.update(struct.pack("<I", pgno_f))
                got = hm.digest()
            print(f"    {enc_name:<22}{'OK' if got == stored else 'x'}")
    else:
        print(f"\n  命中组合：{hits}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
