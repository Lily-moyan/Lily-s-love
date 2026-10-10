"""第 3 步探查（二）：逐库验证 Name2Id 与发送者语义，并定位显示名来源。

核心验证思路（不需要读任何聊天正文）：
  1) 每个 shard 是独立 SQLite 文件，可能各有自己的 Name2Id，rowid 分配可能不同；
  2) 1:1 会话的对方 wxid 可以直接由表名反推（MD5 反查），于是：
     若某张 1:1 会话表里出现「对方 rowid」与「本人 rowid」两个发送者，
     就证明该库的 real_sender_id 确实是 Name2Id rowid，而不是会话内角色 1/2。

用法： python explore_schema2.py
"""
from __future__ import annotations

import hashlib
import os
import sqlite3
import sys

DEC = r"G:\dsh\wechat-digest\out\decrypted"
MY_WXID = "wxid_pysr0b0aplrs21"


def ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def tables(con: sqlite3.Connection) -> list[str]:
    return [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]


def has_col(con, table, col) -> bool:
    return any(c[1] == col for c in con.execute(f'PRAGMA table_info("{table}")'))


def load_name2id(path: str):
    con = ro(path)
    if "Name2Id" not in tables(con):
        con.close()
        return None, None, None
    rows = con.execute("SELECT rowid, user_name FROM Name2Id").fetchall()
    rid2name = {r: u for r, u in rows}
    name2rid = {u: r for r, u in rows}
    return con, rid2name, name2rid


def main() -> int:
    print("=== 各 shard 的 Name2Id 情况 ===")
    dbs = ["message_0.db", "message_1.db", "message_2.db", "message_3.db"]
    info = {}
    for fname in dbs:
        p = os.path.join(DEC, "message", fname)
        if not os.path.exists(p):
            continue
        con, rid2name, name2rid = load_name2id(p)
        if con is None:
            print(f"  {fname:<16} 无 Name2Id 表")
            continue
        ts = [t for t in tables(con) if t.startswith("Msg_")]
        # 本人 rowid
        myrid = None
        for r, u in rid2name.items():
            if u == MY_WXID:
                myrid = r
                break
        print(
            f"  {fname:<16} Name2Id {len(rid2name):>5} 行，本人 rowid={myrid}，"
            f"会话表 {len(ts)} 张，rowid 最大值 {max(rid2name) if rid2name else '-'}"
        )
        info[fname] = (con, rid2name, name2rid, ts, myrid)

    # ---- 逐库 sender 语义验证 ----
    print("\n=== 发送者语义逐库验证（利用 1:1 会话反推） ===")
    for fname, (con, rid2name, name2rid, ts, myrid) in info.items():
        if myrid is None or not ts:
            print(f"  {fname}: 跳过（无本人 rowid 或无会话表）")
            continue
        checked = confirmed = 0
        sample_msgs = []
        for t in ts:
            if not has_col(con, t, "real_sender_id"):
                continue
            senders = {r[0] for r in con.execute(f'SELECT DISTINCT real_sender_id FROM "{t}"')}
            # 该表对应的会话 wxid：反查 MD5
            conv = None
            for r, u in rid2name.items():
                if f"Msg_{hashlib.md5(u.encode('utf-8')).hexdigest()}" == t:
                    conv = u
                    break
            if not conv or "@chatroom" in conv or "@openim" in conv:
                continue
            checked += 1
            partner = name2rid.get(conv)
            if partner is None:
                continue
            # 该库的语义若为 Name2Id rowid：senders 应为 {myrid, partner} 的子集
            looks_rowid = senders <= {myrid, partner}
            # 若为会话内角色 1/2：senders 应为 {1,2} 子集，且不依赖 rowid 大小
            looks_role = senders <= {1, 2}
            if looks_rowid and not looks_role:
                confirmed += 1
            elif checked <= 4:
                sample_msgs.append((t, conv, sorted(senders), myrid, partner, looks_rowid, looks_role))
        # 汇总：整库所有 1:1 会话的 sender 取值上限
        allmax = 0
        for t in ts:
            if has_col(con, t, "real_sender_id"):
                try:
                    m = con.execute(f'SELECT MAX(real_sender_id) FROM "{t}"').fetchone()[0]
                    allmax = max(allmax, m or 0)
                except sqlite3.Error:
                    pass
        print(
            f"  {fname:<16} 1:1 会话 {checked} 张，其中明确支持『rowid 语义』的 {confirmed} 张；"
            f"全库 real_sender_id 最大值 {allmax}"
        )
        for t, conv, senders, mr, pr, lr, lro in sample_msgs[:2]:
            print(f"      {t[:22]}... 对方={conv[:24]} senders={senders} 本人rid={mr} 对方rid={pr}")

    # ---- SendInfo 表（权威的"我发过"记录） ----
    print("\n=== SendInfo（message_0.db） ===")
    m0 = os.path.join(DEC, "message", "message_0.db")
    c = ro(m0)
    if "SendInfo" in tables(c):
        print("  字段:", [x[1] for x in c.execute('PRAGMA table_info("SendInfo")')])
        print("  行数:", c.execute("SELECT COUNT(*) FROM SendInfo").fetchone()[0])
        for row in c.execute("SELECT * FROM SendInfo LIMIT 3"):
            print("   样本:", row)
    else:
        print("  无该表")
    c.close()

    # ---- 显示名来源 ----
    print("\n=== 显示名来源（contact.db） ===")
    cc = ro(os.path.join(DEC, "contact", "contact.db"))
    cts = tables(cc)
    print("  contact.db 表:", ", ".join(cts))
    if "contact" in cts:
        cols = [x[1] for x in cc.execute('PRAGMA table_info("contact")')]
        print(f"  contact 字段({len(cols)}):", ", ".join(cols[:24]))
        print("  行数:", cc.execute("SELECT COUNT(*) FROM contact").fetchone()[0])
    if "chat_room" in cts:
        cols = [x[1] for x in cc.execute('PRAGMA table_info("chat_room")')]
        print(f"  chat_room 字段({len(cols)}):", ", ".join(cols[:20]))
        print("  行数:", cc.execute("SELECT COUNT(*) FROM chat_room").fetchone()[0])
    # 展示多少个会话表能在 contact 里找到显示名
    name2 = {}
    if "contact" in cts:
        for row in cc.execute("SELECT username, local_type, remark, nick_name FROM contact"):
            name2[row[0]] = row
    con0, rid2name0, _, ts0, _ = info.get("message_0.db", (None, {}, {}, [], None))
    convs = set()
    for t in ts0:
        for r, u in rid2name0.items():
            if f"Msg_{hashlib.md5(u.encode('utf-8')).hexdigest()}" == t:
                convs.add(u)
                break
    hit = sum(1 for u in convs if u in name2)
    print(f"\n  message_0.db 的 {len(convs)} 个会话中，{hit} 个能在 contact 表找到资料")
    for u in sorted(convs)[:6]:
        rec = name2.get(u)
        if rec:
            print(f"    {u[:28]:<30} local_type={rec[1]} 备注={str(rec[2])[:12]!r} 昵称={str(rec[3])[:12]!r}")
    cc.close()
    for con, *_ in info.values():
        con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
