"""抽查指定会话的发送者分布，确认 real_sender_id 解析是否可信。

用法： python check_senders.py [会话名关键字 ...]
不带参数时检查几个默认的大群。
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import time

BASE = r"G:\dsh\wechat-digest"
MERGED = os.path.join(BASE, "out", "merged", "message")


def ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def report(record: dict, cutoff: int) -> None:
    path = os.path.join(MERGED, record["shard"])
    if not os.path.exists(path):
        print(f"  缺少 {path}")
        return
    con = ro(path)
    rid2name = {r: u for r, u in con.execute("SELECT rowid, user_name FROM Name2Id")}
    table = record["table"]
    try:
        total_all = con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        all_distinct = con.execute(f'SELECT COUNT(DISTINCT real_sender_id) FROM "{table}"').fetchone()[0]
        win_distinct = con.execute(
            f'SELECT COUNT(DISTINCT real_sender_id) FROM "{table}" WHERE create_time >= ?', (cutoff,)
        ).fetchone()[0]
        top = con.execute(
            f'SELECT real_sender_id, COUNT(*) FROM "{table}" WHERE create_time >= ? '
            f"GROUP BY 1 ORDER BY 2 DESC LIMIT 6",
            (cutoff,),
        ).fetchall()
    except sqlite3.Error as exc:
        print(f"  查询失败: {exc}")
        con.close()
        return
    print(
        f"\n=== {record['display_name'][:34]} ==="
        f"\n  表={table}  分片={record['shard']}  会话={record['username']}"
        f"\n  全表 {total_all} 条 / 不同发送者 {all_distinct} 人；"
        f"近 7 天不同发送者 {win_distinct} 人"
    )
    for rid, n in top:
        name = rid2name.get(rid, "<未映射>") or "<空>"
        mark = "  <- 本人" if name == "wxid_pysr0b0aplrs21" else ""
        print(f"    sender_rid={rid:<6} {n:>6} 条 -> {name[:34]}{mark}")
    con.close()


def main(argv: list[str]) -> int:
    with open(os.path.join(BASE, "out", "conversations.json"), encoding="utf-8") as fh:
        records = json.load(fh)["records"]

    if argv:
        keys = argv
    else:
        keys = ["🍄²专注母婴", "007美妆", "三期4栋多多买菜", "炒饭会交流群", "DSH Desktop"]

    seen = set()
    cutoff = int(time.time()) - 7 * 86400
    for key in keys:
        for rec in records:
            if key in rec["display_name"] and rec["username"] not in seen:
                seen.add(rec["username"])
                report(rec, cutoff)
                break
        else:
            print(f"\n=== 未找到匹配「{key}」的会话 ===")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
