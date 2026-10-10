"""批量解密微信 4.x 的 .dat 图片。

密钥来自 keys/image_key.json（由 find_image_key2.py 内存扫描得到，已用 JPEG 魔数验证）。

V2 布局：
    [0:6]    magic 07 08 56 32 08 07
    [6:10]   aes_size (uint32 LE)
    [10:14]  xor_size (uint32 LE)
    [14]     保留
    [15:15+align16(aes_size)]  AES-128-ECB（PKCS7）
    之后                     明文段
    末尾 xor_size 字节        单字节 XOR 段（解出后文件尾应为 FF D9）

用法：
  python decrypt_dat.py --conv 炒饭会交流群 --month 2026-10
  python decrypt_dat.py --conv 炒饭会交流群 --month 2026-10 --list-xml 3
  python decrypt_dat.py --attach <attach目录> --out-dir out/images/xxx
"""
from __future__ import annotations

import glob
import json
import os
import re
import sqlite3
import struct
import sys
from collections import Counter
from datetime import datetime

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

BASE = r"G:\dsh\wechat-digest"
MERGED = os.path.join(BASE, "out", "merged", "message")
ROOT = r"G:\weixin\xwechat_files\wxid_pysr0b0aplrs21_986b"
ATTACH = os.path.join(ROOT, "msg", "attach")
KEY_FILE = os.path.join(BASE, "keys", "image_key.json")

V2 = b"\x07\x08\x56\x32\x08\x07"
V1 = b"\x07\x08\x56\x31\x08\x07"
V1_KEY = b"cfcd208495d565ef"
MAGICS = {
    "jpg": b"\xff\xd8\xff", "png": b"\x89PNG", "gif": b"GIF8",
    "webp": b"RIFF", "bmp": b"BM", "wxgf": b"wxgf", "tif": b"II*\x00",
}


def ro(p: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{p}?mode=ro", uri=True)


def aes_ecb(key: bytes, data: bytes) -> bytes:
    dec = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
    out = dec.update(data) + dec.finalize()
    if out:
        pad = out[-1]
        if 1 <= pad <= 16 and out[-pad:] == bytes([pad]) * pad:
            out = out[:-pad]
    return out


def fmt_of(b: bytes) -> str | None:
    for name, magic in MAGICS.items():
        if b.startswith(magic):
            return name
    return None


def decrypt_file(path: str, aes_key: bytes | None, xor_key: int) -> tuple[bytes | None, str, str]:
    """返回 (数据, 格式, 说明)。"""
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) < 16:
        return None, "", "文件过小"
    sig = data[:6]
    if sig == V2 or sig == V1:
        key = V1_KEY if sig == V1 else aes_key
        if key is None:
            return None, "", "缺少 AES 密钥"
        aes_size, xor_size = struct.unpack_from("<LL", data, 6)
        aligned = aes_size + ((16 - aes_size % 16) % 16)
        off = 15
        if off + aligned > len(data):
            return None, "", "头部长度越界"
        head_plain = aes_ecb(key, data[off : off + aligned])
        off += aligned
        raw_end = len(data) - xor_size
        middle = data[off:raw_end] if off < raw_end else b""
        tail = bytes(b ^ xor_key for b in data[raw_end:])
        out = head_plain + middle + tail
    else:
        # 旧版：整文件单字节 XOR
        key = None
        for name, magic in MAGICS.items():
            k = data[0] ^ magic[0]
            if all((data[i] ^ k) == magic[i] for i in range(min(len(magic), 8))):
                key = k
                break
        if key is None:
            return None, "", "既非 V1/V2，也无法推出 XOR 密钥"
        out = bytes(b ^ key for b in data)
    fmt = fmt_of(out[:16]) or ""
    return out, fmt, "OK"


def image_xmls(conv_hash: str, limit: int) -> None:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from export_conversation import zstd_decompress

    print(f"\n=== 图片消息 XML 样本（最多 {limit} 条，用于确认文件↔消息的关联字段） ===")
    shown = 0
    for shard in sorted(glob.glob(os.path.join(MERGED, "message_*.db"))):
        con = ro(shard)
        try:
            rows = con.execute(
                f'SELECT create_time, message_content FROM "Msg_{conv_hash}" '
                f"WHERE (local_type & 0xFFFFFFFF) = 3 ORDER BY create_time DESC LIMIT ?",
                (limit,),
            ).fetchall()
        except sqlite3.Error:
            con.close()
            continue
        for ct, blob in rows:
            if shown >= limit:
                break
            if isinstance(blob, (bytes, bytearray)):
                b = bytes(blob)
                text = (
                    zstd_decompress(b).decode("utf-8", "replace")
                    if b[:4] == b"\x28\xb5\x2f\xfd" and zstd_decompress(b)
                    else b.decode("utf-8", "replace")
                )
            else:
                text = str(blob)
            print(f"\n--- [{datetime.fromtimestamp(ct):%m-%d %H:%M:%S}] ---")
            print(text[:1200])
            shown += 1
        con.close()
        if shown >= limit:
            break


def main(argv: list[str]) -> int:
    conv = attach = out_dir = month = None
    subdir = "Img"
    list_xml = 0
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--conv":
            i += 1
            conv = argv[i]
        elif a == "--attach":
            i += 1
            attach = argv[i]
        elif a == "--out-dir":
            i += 1
            out_dir = argv[i]
        elif a == "--month":
            i += 1
            month = argv[i]
        elif a == "--subdir":
            i += 1
            subdir = argv[i]
        elif a == "--list-xml":
            i += 1
            list_xml = int(argv[i])
        i += 1

    conv_hash = None
    if conv:
        with open(os.path.join(BASE, "out", "conversations.json"), encoding="utf-8") as fh:
            recs = json.load(fh)["records"]
        hits = [r for r in recs if conv in r["display_name"]]
        if not hits:
            print(f"未找到会话 {conv}")
            return 2
        conv_hash = hits[0]["table"][len("Msg_") :]
        attach = os.path.join(ATTACH, conv_hash)
        out_dir = out_dir or os.path.join(BASE, "out", "images", re.sub(r"[^\w\u4e00-\u9fff-]", "_", hits[0]["display_name"])[:32])
        print(f"会话 {hits[0]['display_name']}  attach={conv_hash}")

    if list_xml and conv_hash:
        image_xmls(conv_hash, list_xml)
        return 0

    if not attach or not os.path.isdir(attach):
        print(f"attach 目录不存在: {attach}")
        return 2
    if not out_dir:
        print("--out-dir 必填（或配合 --conv 自动推导）")
        return 2

    with open(KEY_FILE, encoding="utf-8") as fh:
        keys = json.load(fh)
    aes_key = keys["aes_key"].encode("ascii")[:16]
    xor_key = keys["xor_key"]
    print(f"AES 密钥 {keys['aes_key']}  XOR 密钥 {hex(xor_key)}")

    pattern = os.path.join(attach, month or "", subdir, "*.dat")
    dats = sorted(glob.glob(pattern))
    if not dats:
        print(f"没找到文件: {pattern}")
        return 1
    print(f"待解密 {len(dats)} 个 .dat -> {out_dir}")

    stats: Counter = Counter()
    rows = []
    for p in dats:
        out, fmt, note = decrypt_file(p, aes_key, xor_key)
        base = os.path.basename(p)
        if out is None:
            stats[f"失败:{note}"] += 1
            continue
        # 结构自校验：JPEG 应以 FF D9 结尾
        struct_ok = True
        if fmt == "jpg":
            struct_ok = out.endswith(b"\xff\xd9")
        # 保留 _t/_h 后缀：同一 md5 可能同时存在缩略图、原图、高清图三种变体，
        # 剥掉后缀会让它们互相覆盖。
        name = base[:-4] if base.endswith(".dat") else base
        sub = os.path.dirname(os.path.relpath(p, attach))
        target = os.path.join(out_dir, sub, f"{name}.{fmt or 'bin'}")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as fh:
            fh.write(out)
        # 保留源文件的修改时间：这是把图片与消息时间对齐的唯一线索
        try:
            mt = os.path.getmtime(p)
            os.utime(target, (mt, mt))
        except OSError:
            pass
        stats[f"{fmt or '未知'}{'' if struct_ok else '(尾部异常)'}"] += 1
        rows.append((datetime.fromtimestamp(os.path.getmtime(p)), base, target, len(out), struct_ok))

    print(f"\n结果: {dict(stats)}")
    print("最早/最新文件时间:", rows[0][0] if rows else "-", "->", rows[-1][0] if rows else "-")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
