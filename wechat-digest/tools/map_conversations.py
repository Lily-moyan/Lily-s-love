"""第 3 步产物：把 Msg_<hash> 表翻译成人能看懂的会话清单。

产出 out/conversations.json，每条形如：
  { shard, table, username, display_name, is_group, self_rowid,
    msg_count, first_ts, last_ts, distinct_senders, sender_names }

要点：
  - 表名 = Msg_ + MD5(user_name)；
  - 每个 shard 有独立的 Name2Id，本人 rowid 需逐库用 user_name 反查（本机四库都是 2，但不硬编码）；
  - real_sender_id = 该 shard 的 Name2Id rowid（已用"最大值 == Name2Id 行数"证明）；
  - 显示名优先取 contact.remark，其次 nick_name，群聊用群昵称。

不输出任何聊天正文。用法： python map_conversations.py
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime

DEC = r"G:\dsh\wechat-digest\out\decrypted"
OUT = r"G:\dsh\wechat-digest\out\conversations.json"
MY_WXID = "wxid_pysr0b0aplrs21"
SHARDS = ["message_0.db", "message_1.db", "message_2.db", "message_3.db", "biz_message_0.db"]


def ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def tables(con: sqlite3.Connection) -> list[str]:
    return [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]


def load_display_names() -> dict[str, dict]:
    path = os.path.join(DEC, "contact", "contact.db")
    out: dict[str, dict] = {}
    con = ro(path)
    for username, local_type, remark, nick in con.execute(
        "SELECT username, local_type, remark, nick_name FROM contact"
    ):
        remark = (remark or "").strip()
        nick = (nick or "").strip()
        out[username] = {
            "local_type": local_type,
            "remark": remark,
            "nick_name": nick,
            "display": remark or nick or username,
        }
    con.close()
    return out


def ts(v) -> str:
    if not v:
        return ""
    try:
        return datetime.fromtimestamp(int(v)).strftime("%Y-%m-%d %H:%M")
    except (ValueError, OSError, OverflowError):
        return str(v)


def main() -> int:
    names = load_display_names()
    print(f"contact 资料 {len(names)} 条")

    records = []
    shard_self = {}
    for shard in SHARDS:
        path = os.path.join(DEC, "message", shard)
        if not os.path.exists(path):
            continue
        con = ro(path)
        tset = tables(con)
        if "Name2Id" not in tset:
            print(f"{shard}: 无 Name2Id，跳过")
            con.close()
            continue
        rid2name = {r: u for r, u in con.execute("SELECT rowid, user_name FROM Name2Id")}
        name2rid = {u: r for r, u in rid2name.items()}
        self_rid = name2rid.get(MY_WXID)
        shard_self[shard] = self_rid
        hash2name = {f"Msg_{hashlib.md5(u.encode('utf-8')).hexdigest()}": u for u in rid2name.values()}

        msg_tabs = [t for t in tset if t.startswith("Msg_")]
        max_sender = 0
        for t in msg_tabs:
            try:
                agg = con.execute(
                    f'SELECT COUNT(*), MIN(create_time), MAX(create_time), '
                    f'COUNT(DISTINCT real_sender_id), MAX(real_sender_id) FROM "{t}"'
                ).fetchone()
            except sqlite3.Error:
                continue
            cnt, tmin, tmax, nsenders, msend = agg
            max_sender = max(max_sender, msend or 0)
            username = hash2name.get(t, "?")
            rec = names.get(username, {})
            is_group = "@chatroom" in username
            senders = []
            if nsenders and nsenders <= 30:
                try:
                    sids = [r[0] for r in con.execute(f'SELECT DISTINCT real_sender_id FROM "{t}"')]
                    senders = sorted(
                        {rid2name.get(s, f"<未映射 {s}>") or "我" for s in sids}
                    )
                except sqlite3.Error:
                    pass
            records.append(
                {
                    "shard": shard,
                    "table": t,
                    "username": username,
                    "display_name": rec.get("display", username),
                    "remark": rec.get("remark", ""),
                    "nick_name": rec.get("nick_name", ""),
                    "is_group": is_group,
                    "self_rowid": self_rid,
                    "msg_count": cnt,
                    "first_ts": ts(tmin),
                    "last_ts": ts(tmax),
                    "distinct_senders": nsenders,
                    "sender_names": senders[:20],
                }
            )
        proof = "一致" if max_sender <= len(rid2name) else "不一致!"
        print(
            f"  {shard:<18} Name2Id={len(rid2name):<5} 本人rowid={self_rid}  "
            f"会话表={len(msg_tabs):<4} real_sender_id最大值={max_sender:<5} "
            f"-> 与 Name2Id 行数{proof}"
        )
        con.close()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"self_rowid_by_shard": shard_self, "records": records}, fh, ensure_ascii=False, indent=2)
    print(f"\n共 {len(records)} 条会话记录 -> {OUT}")

    # 汇总：同一会话可能跨 shard，按 username 合并
    merged: dict[str, dict] = {}
    for r in records:
        m = merged.setdefault(
            r["username"],
            {
                "username": r["username"],
                "display_name": r["display_name"],
                "is_group": r["is_group"],
                "msg_count": 0,
                "first_ts": r["first_ts"],
                "last_ts": r["last_ts"],
                "shards": [],
            },
        )
        m["msg_count"] += r["msg_count"]
        m["shards"].append(r["shard"])
        if r["first_ts"] and (not m["first_ts"] or r["first_ts"] < m["first_ts"]):
            m["first_ts"] = r["first_ts"]
        if r["last_ts"] and r["last_ts"] > m["last_ts"]:
            m["last_ts"] = r["last_ts"]

    top = sorted(merged.values(), key=lambda x: -x["msg_count"])
    print(f"\n=== 合并后唯一会话 {len(merged)} 个，按消息量 Top 20 ===")
    print(f"{'消息数':>7}  {'类型':<5}{'最近消息':<18}{'会话名'}")
    print("-" * 72)
    for m in top[:20]:
        kind = "群" if m["is_group"] else "1:1"
        print(f"{m['msg_count']:>7}  {kind:<5}{m['last_ts']:<18}{m['display_name'][:34]}")

    total = sum(m["msg_count"] for m in merged.values())
    groups = sum(1 for m in merged.values() if m["is_group"])
    print(f"\n总计 {total} 条消息，群聊 {groups} 个，单聊 {len(merged) - groups} 个")
    return 0


if __name__ == "__main__":
    sys.exit(main())
