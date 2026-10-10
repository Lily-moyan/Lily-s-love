"""核查某会话在窗口内逐日消息量，判断"某天无分节"是真空洞还是漏数据。

用法： python daily_counts.py <会话名关键字> [天数]
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from collections import Counter
from datetime import datetime, timedelta

BASE = r"G:\dsh\wechat-digest"
MERGED = os.path.join(BASE, "out", "merged", "message")


def ro(p: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{p}?mode=ro", uri=True)


def main(argv: list[str]) -> int:
    name = argv[0] if argv else "炒饭会交流群"
    days = int(argv[1]) if len(argv) > 1 else 7
    with open(os.path.join(BASE, "out", "conversations.json"), encoding="utf-8") as fh:
        records = json.load(fh)["records"]
    hits = [r for r in records if name in r["display_name"]]
    if not hits:
        print("未找到会话")
        return 2
    username = hits[0]["username"]
    recs = [r for r in records if r["username"] == username]

    latest = 0
    per_day: Counter = Counter()
    type_by_day: dict[str, Counter] = {}
    for r in recs:
        con = ro(os.path.join(MERGED, r["shard"]))
        cols = [c[1] for c in con.execute(f'PRAGMA table_info("{r["table"]}")')]
        for row in con.execute(f'SELECT * FROM "{r["table"]}"'):
            d = dict(zip(cols, row))
            ct = d.get("create_time") or 0
            latest = max(latest, ct)
            day = datetime.fromtimestamp(ct).strftime("%Y-%m-%d")
            per_day[day] += 1
            lt = d.get("local_type") or 0
            type_by_day.setdefault(day, Counter())[lt & 0xFFFFFFFF] += 1
        con.close()

    t0 = datetime.fromtimestamp(latest - days * 86400).date()
    end = datetime.fromtimestamp(latest).date()
    print(f"会话 {hits[0]['display_name']}  分片 {', '.join(r['shard'] for r in recs)}")
    print(f"最新消息 {datetime.fromtimestamp(latest):%Y-%m-%d %H:%M:%S}，窗口起点 {t0}")
    print(f"该会话全表消息总数 {sum(per_day.values())}\n")
    print(f"{'日期':<12}{'消息数':>7}   类型构成")
    print("-" * 60)
    d = t0
    while d <= end:
        key = d.strftime("%Y-%m-%d")
        n = per_day.get(key, 0)
        comp = type_by_day.get(key, Counter())
        desc = ", ".join(f"{k}:{v}" for k, v in sorted(comp.items(), key=lambda kv: -kv[1])[:5])
        flag = "   <-- 该会话当天无消息" if n == 0 else ""
        print(f"{key:<12}{n:>7}   {desc}{flag}")
        d += timedelta(days=1)

    print("\n全表最早/最晚消息：")
    keys = sorted(per_day)
    print(f"  最早 {keys[0]}   最晚 {keys[-1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
