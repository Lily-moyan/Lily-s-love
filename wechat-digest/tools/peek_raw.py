"""临时探查：看清 type 49（appmsg）的原始 XML 结构与 @ 提及的编码方式。

只打印少量样本（截断），用于确定导出器的解析规则。

用法： python peek_raw.py [会话名关键字]
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from collections import Counter
from datetime import datetime

BASE = r"G:\dsh\wechat-digest"
MERGED = os.path.join(BASE, "out", "merged", "message")
MY_WXID = "wxid_pysr0b0aplrs21"


def ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def main(argv: list[str]) -> int:
    name = argv[0] if argv else "炒饭会交流群"
    with open(os.path.join(BASE, "out", "conversations.json"), encoding="utf-8") as fh:
        records = json.load(fh)["records"]
    hits = [r for r in records if name in r["display_name"]]
    if not hits:
        print("未找到会话")
        return 2
    username = hits[0]["username"]
    recs = [r for r in records if r["username"] == username]
    print(f"会话 {hits[0]['display_name']} ({username})")

    subtypes: Counter = Counter()
    samples49 = []
    samples_mention = []
    for r in recs:
        con = ro(os.path.join(MERGED, r["shard"]))
        rid2name = {x: y for x, y in con.execute("SELECT rowid, user_name FROM Name2Id")}
        cols = [c[1] for c in con.execute(f'PRAGMA table_info("{r["table"]}")')]
        q = f'SELECT * FROM "{r["table"]}" ORDER BY create_time DESC LIMIT 1200'
        for row in con.execute(q):
            d = dict(zip(cols, row))
            lt = d.get("local_type") or 0
            t = lt & 0xFFFFFFFF
            sub = lt >> 32
            if t == 49:
                subtypes[sub] += 1
                if len(samples49) < 6:
                    samples49.append(
                        (
                            sub,
                            datetime.fromtimestamp(d["create_time"]).strftime("%m-%d %H:%M"),
                            str(d.get("message_content"))[:420],
                        )
                    )
            elif t == 1 and len(samples_mention) < 6:
                txt = str(d.get("message_content") or "")
                if "@" in txt:
                    samples_mention.append((datetime.fromtimestamp(d["create_time"]).strftime("%m-%d %H:%M"), txt[:160]))
        con.close()

    print(f"\n=== type 49 的子类型分布（最近 1200 条内） ===")
    for sub, n in subtypes.most_common():
        print(f"  subtype={sub:<4} {n} 条")

    print("\n=== type 49 原始 XML 样本 ===")
    for sub, ts, content in samples49:
        print(f"\n--- [{ts}] subtype={sub} ---")
        print(content)

    print("\n=== 含 @ 的文本样本 ===")
    for ts, txt in samples_mention:
        print(f"  [{ts}] {txt!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
