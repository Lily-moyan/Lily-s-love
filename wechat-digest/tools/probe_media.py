"""探查两个数据能力缺口：
  1) 图片消息 XML 里是否存在能与 .dat 文件名（32位 md5）对上的字段 -> 解决图片归属
  2) 语音在库里以什么形式存在、有没有可用的转写文本 -> 解决"关键答复只在语音里"

用法： python probe_media.py [会话名关键字]
"""
from __future__ import annotations

import glob
import json
import os
import re
import sqlite3
import sys
from datetime import datetime

BASE = r"G:\dsh\wechat-digest"
MERGED = os.path.join(BASE, "out", "merged", "message")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_conversation import zstd_decompress  # noqa: E402


def ro(p: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{p}?mode=ro", uri=True)


def main(argv: list[str]) -> int:
    name = argv[0] if argv else "嘉陵江天23栋1单元802土建群"
    with open(os.path.join(BASE, "out", "conversations.json"), encoding="utf-8") as fh:
        recs = json.load(fh)["records"]
    hits = [r for r in recs if name in r["display_name"]]
    if not hits:
        print(f"未找到 {name}")
        return 2
    table = hits[0]["table"]
    display = hits[0]["display_name"]
    print(f"=== 会话 {display}  表 {table} ===")

    # ---- 1. 图片消息 XML 全字段 ----
    print("\n### 1) 图片消息 XML（找可与 .dat 文件名对应的 md5）")
    shown = 0
    for shard in sorted(glob.glob(os.path.join(MERGED, "message_*.db"))):
        con = ro(shard)
        try:
            rows = con.execute(
                f'SELECT create_time, message_content FROM "{table}" '
                f"WHERE (local_type & 0xFFFFFFFF) = 3 ORDER BY create_time DESC LIMIT 3"
            ).fetchall()
        except sqlite3.Error:
            con.close()
            continue
        for ct, blob in rows:
            if shown >= 2:
                break
            text = ""
            if isinstance(blob, (bytes, bytearray)):
                b = bytes(blob)
                if b[:4] == b"\x28\xb5\x2f\xfd":
                    dec = zstd_decompress(b)
                    text = dec.decode("utf-8", "replace") if dec else ""
                else:
                    text = b.decode("utf-8", "replace")
            else:
                text = str(blob or "")
            print(f"\n--- [{datetime.fromtimestamp(ct):%m-%d %H:%M:%S}] ---")
            print(text[:1500])
            attrs = re.findall(r'(\w+)="([^"]{8,})"', text)
            print("  可提取的属性:", [(k, v[:40]) for k, v in attrs][:12])
            shown += 1
        con.close()
        if shown >= 2:
            break

    # ---- 2. 语音的存储形式 ----
    print("\n### 2) 语音存储形式（media_0.db）")
    p = os.path.join(MERGED, "media_0.db")
    con = ro(p)
    for t in [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]:
        try:
            cols = [c[1] for c in con.execute(f'PRAGMA table_info("{t}")')]
            n = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            print(f"  {t}: {n} 行  字段 {cols}")
        except sqlite3.Error as exc:
            print(f"  {t}: {exc}")
    print("\n  其他库里是否有语音转写文本字段（含 voice/text 字样的表）:")
    for shard in sorted(glob.glob(os.path.join(MERGED, "*.db"))) + sorted(glob.glob(os.path.join(MERGED, "*", "*.db"))):
        try:
            c = ro(shard)
            for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table'"):
                if re.search(r"voice|audio|asr|transcri", t, re.I):
                    cols = [x[1] for x in c.execute(f'PRAGMA table_info("{t}")')]
                    print(f"    {os.path.relpath(shard, MERGED)} :: {t} -> {cols}")
            c.close()
        except sqlite3.Error:
            continue
    # 语音消息 XML
    print("\n### 3) 语音消息 XML 样本（看有没有内嵌转写）")
    shown = 0
    for shard in sorted(glob.glob(os.path.join(MERGED, "message_*.db"))):
        c = ro(shard)
        try:
            rows = c.execute(
                f'SELECT create_time, message_content FROM "{table}" '
                f"WHERE (local_type & 0xFFFFFFFF) = 34 ORDER BY create_time DESC LIMIT 2"
            ).fetchall()
        except sqlite3.Error:
            c.close()
            continue
        for ct, blob in rows:
            if shown >= 2:
                break
            text = ""
            if isinstance(blob, (bytes, bytearray)):
                b = bytes(blob)
                text = (
                    zstd_decompress(b).decode("utf-8", "replace")
                    if b[:4] == b"\x28\xb5\x2f\xfd" and zstd_decompress(b)
                    else b.decode("utf-8", "replace")
                )
            else:
                text = str(blob or "")
            print(f"\n--- [{datetime.fromtimestamp(ct):%m-%d %H:%M:%S}] ---")
            print(text[:900])
            shown += 1
        c.close()
        if shown >= 2:
            break
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
