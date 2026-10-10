"""分析 WAL 的 salt 世代结构，并判定哪种合并策略能产出合法数据库。

背景：本机 WCDB 的 WAL 里，帧头 salt 与 WAL 头 salt 不一致。若直接套用标准 SQLite
的「salt 必须一致」规则，会判定整个 WAL 失效；若不加区分地覆盖全部帧，又会把不同
世代的 schema 页混在一起，产出重复索引等不一致结果。

本脚本枚举三种策略，对每种结果做 PRAGMA quick_check + 统计，用事实说话：
  V1 全部有效帧（截至最后一个提交点）
  V2 仅最后一个 salt 世代的帧（截至该世代最后一个提交点）
  V0 不合并（基线）

用法： python analyze_wal_generations.py
"""
from __future__ import annotations

import hashlib
import hmac as hmac_mod
import json
import os
import shutil
import sqlite3
import struct
import sys

import importlib.util

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
from merge_wal import (  # noqa: E402
    HMAC_OFF,
    PAGE_SZ,
    SALT_SZ,
    WAL_HDR_SZ,
    FRAME_HDR_SZ,
    SQLITE_HDR,
    decrypt_wal_page,
    page_hmac_ok,
)

BASE = r"G:\dsh\wechat-digest"
KEYS = os.path.join(BASE, "out", "keys.json")
SRC = os.path.join(BASE, "backup", "db_storage", "message")
PLAIN = os.path.join(BASE, "out", "decrypted", "message")
TMP = os.path.join(BASE, "out", "wal_probe")
FRAME_SZ = FRAME_HDR_SZ + PAGE_SZ


def parse_frames(wal_path: str, enc_key: bytes, db_salt: bytes):
    with open(wal_path, "rb") as fh:
        wal = fh.read()
    frames = []
    off = WAL_HDR_SZ
    while off + FRAME_SZ <= len(wal):
        hdr = wal[off : off + FRAME_HDR_SZ]
        pgno = struct.unpack(">I", hdr[0:4])[0]
        commit = struct.unpack(">I", hdr[4:8])[0]
        fsalt = hdr[8:16]
        if pgno == 0:
            break
        raw = wal[off + FRAME_HDR_SZ : off + FRAME_SZ]
        if not page_hmac_ok(enc_key, raw, pgno, db_salt):
            break
        frames.append((off, pgno, commit, fsalt, decrypt_wal_page(enc_key, raw, pgno)))
        off += FRAME_SZ
    return frames


def overlay(plain_db: str, out_db: str, frames) -> None:
    shutil.copyfile(plain_db, out_db)
    with open(out_db, "r+b") as fh:
        for _off, pgno, _commit, _salt, page in frames:
            fh.seek((pgno - 1) * PAGE_SZ)
            fh.write(page)


def probe(db_path: str):
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        check = con.execute("PRAGMA quick_check").fetchone()[0]
        n_master = con.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()[0]
        tabs = [
            r[0]
            for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg\\_%' ESCAPE '\\'"
            )
        ]
        total = 0
        for t in tabs:
            try:
                total += con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            except sqlite3.Error:
                pass
        con.close()
        return f"quick_check={check[:24]!r} sqlite_master={n_master} 会话表={len(tabs)} 消息={total}"
    except sqlite3.Error as exc:
        return f"打不开: {exc}"


def main() -> int:
    os.makedirs(TMP, exist_ok=True)
    with open(KEYS, encoding="utf-8") as fh:
        key_map = json.load(fh)["salt_to_key"]

    for name in ("biz_message_0.db", "message_0.db", "message_3.db"):
        src = os.path.join(SRC, name)
        wal_path = src + "-wal"
        plain = os.path.join(PLAIN, name)
        if not (os.path.exists(wal_path) and os.path.exists(plain)):
            continue
        with open(src, "rb") as fh:
            db_salt = fh.read(SALT_SZ)
        enc_key = bytes.fromhex(key_map[db_salt.hex()])
        frames = parse_frames(wal_path, enc_key, db_salt)

        # salt 世代划分
        groups: list[tuple[bytes, int, int]] = []
        for idx, fr in enumerate(frames):
            if groups and groups[-1][0] == fr[3]:
                groups[-1] = (fr[3], groups[-1][1], idx)
            else:
                groups.append((fr[3], idx, idx))
        print(f"\n=== {name} ===")
        print(f"  有效帧 {len(frames)}，salt 世代 {len(groups)} 个")
        for salt, a, b in groups:
            n_commit = sum(1 for fr in frames[a : b + 1] if fr[2])
            print(f"    salt={salt.hex()}  帧 {a}..{b}  共 {b - a + 1} 帧，提交点 {n_commit}")

        # V1: 全部有效帧截至最后提交
        last_c = max((i for i, fr in enumerate(frames) if fr[2]), default=-1)
        v1 = frames[: last_c + 1] if last_c >= 0 else []
        # V2: 最后一个 salt 世代，截至该世代最后提交
        gsalt, ga, gb = groups[-1]
        sub = frames[ga : gb + 1]
        last_c2 = max((i for i, fr in enumerate(sub) if fr[2]), default=-1)
        v2 = sub[: last_c2 + 1] if last_c2 >= 0 else []

        print(f"  V0 基线        : {probe(plain)}")
        for label, variant in (("V1 全部帧", v1), ("V2 末世代", v2)):
            out_db = os.path.join(TMP, f"{label.split()[0]}_{name}")
            overlay(plain, out_db, variant)
            print(f"  {label:<14}（{len(variant)} 帧）: {probe(out_db)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
