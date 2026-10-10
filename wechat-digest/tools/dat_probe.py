"""DAT 图片解密探查：确定格式分布、XOR 密钥与 V2 的 AES 密钥来源。

V2 布局（据公开实现，已在本文件按同样逻辑复现）：
    [0:6]    magic 07 08 56 32 08 07
    [6:10]   aes_size  (uint32 LE)
    [10:14]  xor_size  (uint32 LE)
    [14]     保留字节
    [15:15+align16(aes_size)]  AES-128-ECB 加密段（PKCS7 填充）
    之后                     明文段（长度 = len - xor_size - offset）
    末尾 xor_size 字节       逐字节 XOR 段（密钥单字节）
自校验：XOR 段解出来后文件尾应为 FF D9（JPEG EOI），这是 xor 密钥的判定依据。

AES 密钥候选（按"能不能解出 JPEG/PNG 魔数"验证）：
  1) 消息 XML 里的 <img aeskey="32位hex">（hex 解码后 16 字节）—— 若能成立则历史图片可批量解
  2) V1 固定密钥 b'cfcd208495d565ef'
  3) 内存里的 16/32 字符 ASCII token

用法：
  python dat_probe.py --conv 炒饭会交流群
  python dat_probe.py --attach <attach目录> --aes-key <16字节hex或ASCII>
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
from html import unescape

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

BASE = r"G:\dsh\wechat-digest"
MERGED = os.path.join(BASE, "out", "merged", "message")
ROOT = r"G:\weixin\xwechat_files\wxid_pysr0b0aplrs21_986b"
ATTACH = os.path.join(ROOT, "msg", "attach")

V2 = b"\x07\x08\x56\x32\x08\x07"
V1 = b"\x07\x08\x56\x31\x08\x07"
V1_AES_KEY = b"cfcd208495d565ef"
MAGICS = {
    "jpg": b"\xff\xd8\xff",
    "png": b"\x89PNG",
    "gif": b"GIF8",
    "webp": b"RIFF",
    "bmp": b"BM",
    "wxgf": b"wxgf",
    "tif": b"II*\x00",
}


def ro(p: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{p}?mode=ro", uri=True)


def aes_ecb_decrypt(key: bytes, data: bytes) -> bytes | None:
    if len(key) != 16:
        return None
    try:
        dec = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
        out = dec.update(data) + dec.finalize()
    except Exception:
        return None
    # 去 PKCS7 填充
    if not out:
        return out
    pad = out[-1]
    if 1 <= pad <= 16 and out[-pad:] == bytes([pad]) * pad:
        return out[:-pad]
    return out


def fmt_of(blob: bytes) -> str | None:
    for name, magic in MAGICS.items():
        if blob.startswith(magic):
            return name
    return None


def parse_header(path: str):
    with open(path, "rb") as fh:
        head = fh.read(32)
    if len(head) < 15:
        return None
    sig = head[:6]
    aes_size, xor_size = struct.unpack_from("<LL", head, 6)
    return {
        "sig": sig,
        "kind": "V2" if sig == V2 else ("V1" if sig == V1 else "XOR/other"),
        "aes_size": aes_size,
        "xor_size": xor_size,
        "cipher": head[15:31],
        "head": head,
    }


def derive_xor_key(paths: list[str]) -> int | None:
    """XOR 密钥判定：解出后文件尾必须是 FF D9（或 00 00 之类已知结尾）。"""
    votes: Counter = Counter()
    for p in paths[:64]:
        try:
            size = os.path.getsize(p)
            with open(p, "rb") as fh:
                if fh.read(6) != V2:
                    continue
                fh.seek(size - 2)
                tail = fh.read(2)
        except OSError:
            continue
        if len(tail) != 2:
            continue
        k = tail[0] ^ 0xFF
        if (tail[1] ^ k) == 0xD9:
            votes[k] += 1
    if not votes:
        return None
    return votes.most_common(1)[0][0]


def decrypt_v2(path: str, aes_key: bytes, xor_key: int) -> tuple[bytes | None, str]:
    with open(path, "rb") as fh:
        data = fh.read()
    h = parse_header(path)
    if h is None or h["sig"] not in (V2, V1):
        return None, "非 V1/V2"
    aes_size, xor_size = h["aes_size"], h["xor_size"]
    aligned = aes_size + ((16 - aes_size % 16) % 16)
    offset = 15
    if offset + aligned > len(data):
        return None, "头部长度越界"
    dec_aes = aes_ecb_decrypt(aes_key, data[offset : offset + aligned])
    if dec_aes is None:
        return None, "AES 失败"
    offset += aligned
    raw_end = len(data) - xor_size
    raw = data[offset:raw_end] if offset < raw_end else b""
    dec_xor = bytes(b ^ xor_key for b in data[raw_end:])
    out = dec_aes + raw + dec_xor
    return out, fmt_of(out[:16]) or "未知"


def db_aeskeys(conv_hash: str) -> list[str]:
    """从该会话的图片消息 XML 里收集 <img aeskey=...>（XML 可能是 ZSTD 压缩的）。"""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from export_conversation import zstd_decompress

    keys: Counter = Counter()
    for shard in sorted(glob.glob(os.path.join(MERGED, "message_*.db"))):
        con = ro(shard)
        t = f"Msg_{conv_hash}"
        try:
            rows = con.execute(
                f'SELECT message_content FROM "{t}" WHERE (local_type & 0xFFFFFFFF) = 3'
            ).fetchall()
        except sqlite3.Error:
            con.close()
            continue
        for (blob,) in rows:
            if blob is None:
                continue
            if isinstance(blob, (bytes, bytearray)):
                b = bytes(blob)
                if b[:4] == b"\x28\xb5\x2f\xfd":
                    dec = zstd_decompress(b)
                    if not dec:
                        continue
                    text = dec.decode("utf-8", "replace")
                else:
                    text = b.decode("utf-8", "replace")
            else:
                text = str(blob)
            for m in re.finditer(r'aeskey="([0-9a-fA-F]{32})"', text):
                keys[m.group(1).lower()] += 1
        con.close()
    return [k for k, _ in keys.most_common()]


def main(argv: list[str]) -> int:
    conv = attach = None
    given_key = None
    i = 0
    while i < len(argv):
        if argv[i] == "--conv":
            i += 1
            conv = argv[i]
        elif argv[i] == "--attach":
            i += 1
            attach = argv[i]
        elif argv[i] == "--aes-key":
            i += 1
            given_key = argv[i]
        i += 1

    conv_hash = None
    display = None
    if conv:
        with open(os.path.join(BASE, "out", "conversations.json"), encoding="utf-8") as fh:
            recs = json.load(fh)["records"]
        hits = [r for r in recs if conv in r["display_name"]]
        if not hits:
            print(f"未找到会话 {conv}")
            return 2
        display = hits[0]["display_name"]
        conv_hash = hits[0]["table"][len("Msg_") :]
        attach = os.path.join(ATTACH, conv_hash)
        print(f"会话 {display} -> attach 目录 {conv_hash}")

    if not attach or not os.path.isdir(attach):
        print(f"attach 目录不存在: {attach}")
        return 2

    # ---- 格式分布 ----
    dats = glob.glob(os.path.join(attach, "**", "*.dat"), recursive=True)
    print(f"\n.dat 文件 {len(dats)} 个")
    kind = Counter()
    name_pat = Counter()
    for p in dats:
        h = parse_header(p)
        if h:
            kind[h["kind"]] += 1
        name_pat[re.sub(r"[0-9a-f]{32}", "<md5>", os.path.basename(p))] += 1
    print("格式分布:", dict(kind))
    print("文件名模式:", dict(name_pat.most_common(6)))

    # ---- XOR 密钥 ----
    xor_key = derive_xor_key(dats)
    print(f"\nXOR 密钥（由文件尾自校验推出）: {hex(xor_key) if xor_key is not None else '未推出'}")

    # ---- 选一个 V2 探针 ----
    probe = None
    for p in dats:
        h = parse_header(p)
        if h and h["sig"] == V2:
            probe = (p, h)
            break
    if not probe:
        print("没有 V2 探针文件")
        return 1
    path, h = probe
    print(f"\n探针文件: {os.path.relpath(path, attach)}")
    print(f"  aes_size={h['aes_size']} xor_size={h['xor_size']} cipher={h['cipher'].hex()}")

    # ---- 候选密钥逐个验证 ----
    print("\n=== 候选 AES 密钥验证（判据：解出 JPEG/PNG 魔数） ===")
    used_keys = [("V1固定密钥", V1_AES_KEY)]
    if given_key:
        try:
            used_keys.append(("命令行给定(hex)", bytes.fromhex(given_key)))
        except ValueError:
            used_keys.append(("命令行给定(ascii)", given_key.encode()[:16]))
    db_keys = db_aeskeys(conv_hash) if conv_hash else []
    print(f"  从数据库 XML 收到 {len(db_keys)} 个 <img aeskey>（hex 形式）")
    for k in db_keys[:12]:
        used_keys.append((f"DB aeskey {k[:8]}…", bytes.fromhex(k)))

    hit = 0
    for label, key in used_keys:
        if xor_key is None:
            continue
        out, fmt = decrypt_v2(path, key, xor_key)
        ok = fmt in MAGICS
        if ok:
            hit += 1
        print(f"  {label:<28} key={key.hex():<34} -> {fmt}{'  <<< 命中' if ok else ''}")
    print(f"\n命中 {hit} 个")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
