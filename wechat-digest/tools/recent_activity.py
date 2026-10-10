"""列出最近 N 天活跃的会话，供人工挑选摘要范围。

输出每个会话在时间窗内的消息总数、我发出的条数、参与人数与最近时间。
不输出任何聊天正文。

用法： python recent_activity.py [--days 7] [--top 40]
"""
from __future__ import annotations

import glob
import json
import os
import sqlite3
import sys
import time

BASE = r"G:\dsh\wechat-digest"
MERGED = os.path.join(BASE, "out", "merged")
CONVS = os.path.join(BASE, "out", "conversations.json")
SALT_SZ = 16


def ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def main(argv: list[str]) -> int:
    days, top = 7, 40
    i = 0
    while i < len(argv):
        if argv[i] == "--days":
            i += 1
            days = int(argv[i])
        elif argv[i] == "--top":
            i += 1
            top = int(argv[i])
        i += 1

    cutoff = int(time.time()) - days * 86400
    print(f"时间窗：最近 {days} 天（create_time >= {time.strftime('%Y-%m-%d %H:%M', time.localtime(cutoff))}）")

    with open(CONVS, encoding="utf-8") as fh:
        conv = json.load(fh)
    meta = {r["table"]: r for r in conv["records"]}
    self_by_shard = conv["self_rowid_by_shard"]

    agg: dict[str, dict] = {}
    for shard_path in sorted(glob.glob(os.path.join(MERGED, "message", "*.db"))):
        shard = os.path.basename(shard_path)
        con = ro(shard_path)
        tables = [
            r[0]
            for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg\\_%' ESCAPE '\\'"
            )
        ]
        self_rid = self_by_shard.get(shard)
        for t in tables:
            try:
                total, mine, mx = con.execute(
                    f'SELECT COUNT(*), SUM(CASE WHEN real_sender_id = ? THEN 1 ELSE 0 END), '
                    f'MAX(create_time) FROM "{t}" WHERE create_time >= ?',
                    (self_rid, cutoff),
                ).fetchone()
            except sqlite3.Error:
                continue
            if not total:
                continue
            # 发送者必须求并集，不能取 max：同一会话可能跨多个 shard，
            # 各 shard 的 Name2Id 独立，rowid 不可直接比较。
            sids = {
                r[0]
                for r in con.execute(
                    f'SELECT DISTINCT real_sender_id FROM "{t}" WHERE create_time >= ?', (cutoff,)
                )
            }
            # 该会话在**全部时间**上的最新消息时间：工作台用它判断某份摘要之后是否又有新消息
            last_global = con.execute(f'SELECT MAX(create_time) FROM "{t}"').fetchone()[0] or 0
            m = meta.get(t, {})
            key = m.get("username", t)
            rec = agg.setdefault(
                key,
                {
                    "username": key,
                    "display": m.get("display_name", t),
                    "is_group": m.get("is_group", False),
                    "total": 0,
                    "mine": 0,
                    "last": 0,
                    "last_global": 0,
                    "sids": set(),
                    "shards": set(),
                },
            )
            rec["total"] += total
            rec["mine"] += mine or 0
            rec["last"] = max(rec["last"], mx or 0)
            rec["last_global"] = max(rec["last_global"], last_global)
            rec["sids"] |= sids
            rec["shards"].add(shard)
        con.close()

    for rec in agg.values():
        rec["senders"] = len(rec["sids"])
        rec["shard_count"] = len(rec["shards"])
        del rec["sids"]
        del rec["shards"]

    rows = sorted(agg.values(), key=lambda r: -r["total"])
    print(f"\n窗口内活跃会话共 {len(rows)} 个，按消息量列出前 {min(top, len(rows))} 个：\n")
    print(f"{'#':>3}  {'消息':>6}{'我发':>6}{'人数':>5}  {'最近':<12}{'类型':<5}会话名")
    print("-" * 84)
    for idx, r in enumerate(rows[:top], 1):
        kind = "群" if r["is_group"] else "1:1"
        last = time.strftime("%m-%d %H:%M", time.localtime(r["last"])) if r["last"] else "-"
        print(
            f"{idx:>3}  {r['total']:>6}{r['mine']:>6}{r['senders']:>5}  {last:<12}{kind:<5}{r['display'][:40]}"
        )
    with open(os.path.join(BASE, "out", "recent_activity.json"), "w", encoding="utf-8") as fh:
        json.dump({"days": days, "cutoff": cutoff, "rows": rows}, fh, ensure_ascii=False, indent=2)
    print(f"\n完整清单已写入 out/recent_activity.json")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
