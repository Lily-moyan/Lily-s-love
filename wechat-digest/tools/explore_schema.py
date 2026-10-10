"""第 3 步探查：会话表名映射规则与发送者语义。

只输出 schema、行数、id↔user_name 映射与命中率，不打印任何聊天正文。

用法： python explore_schema.py
"""
from __future__ import annotations

import hashlib
import os
import sqlite3
import sys

DEC = r"G:\dsh\wechat-digest\out\decrypted"
MY_WXID = "wxid_pysr0b0aplrs21"

MAX_NAMES = 8


def ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def tables(con: sqlite3.Connection) -> list[str]:
    return [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]


def columns(con: sqlite3.Connection, table: str) -> list[tuple]:
    return list(con.execute(f'PRAGMA table_info("{table}")'))


def main() -> int:
    m0 = os.path.join(DEC, "message", "message_0.db")
    if not os.path.exists(m0):
        print(f"缺少 {m0}")
        return 2
    con = ro(m0)
    tabs = tables(con)
    msg_tabs = [t for t in tabs if t.startswith("Msg_")]
    other_tabs = [t for t in tabs if not t.startswith("Msg_")]
    print(f"=== message_0.db ===")
    print(f"会话表 {len(msg_tabs)} 张，其他表 {len(other_tabs)} 张")
    print("其他表:", ", ".join(other_tabs))

    # ---- 会话表 schema ----
    print("\n=== 会话表结构（以最大的一张为例） ===")
    sample = "Msg_bc03d209791368c2da44eca8820f1146"
    for cid, name, ctype, notnull, dflt, pk in columns(con, sample):
        print(f"  {cid:>2} {name:<22}{ctype:<10}{'PK' if pk else ''}")

    # ---- 行数分布 ----
    print("\n=== 会话表行数 Top 10 ===")
    counts = []
    for t in msg_tabs:
        try:
            n = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            counts.append((n, t))
        except sqlite3.Error:
            pass
    counts.sort(reverse=True)
    for n, t in counts[:10]:
        print(f"  {n:>8}  {t}")
    print(f"  合计 {sum(n for n, _ in counts)} 行")

    # ---- Name2Id 位置与内容 ----
    print("\n=== Name2Id ===")
    n2i_con, n2i_name = None, None
    for path, label in ((m0, "message_0.db"), (os.path.join(DEC, "contact", "contact.db"), "contact.db")):
        c = ro(path)
        if "Name2Id" in tables(c):
            n2i_con, n2i_name = c, label
            break
    if n2i_con is None:
        print("  未找到 Name2Id 表")
        return 1
    print(f"  位于 {n2i_name}")
    print("  字段:", [c[1] for c in columns(n2i_con, "Name2Id")])
    rows = n2i_con.execute("SELECT rowid, user_name FROM Name2Id").fetchall()
    print(f"  行数 {len(rows)}")

    # ---- 验证表名 = Msg_ + MD5(user_name) ----
    print("\n=== 表名映射规则验证 ===")
    tabset = set(msg_tabs)
    for label, fn in (
        ("MD5(user_name)", lambda s: hashlib.md5(s.encode("utf-8")).hexdigest()),
        ("MD5(lower(user_name))", lambda s: hashlib.md5(s.lower().encode("utf-8")).hexdigest()),
        ("SHA1(user_name)[:32]", lambda s: hashlib.sha1(s.encode("utf-8")).hexdigest()[:32]),
    ):
        hit = sum(1 for _rid, un in rows if f"Msg_{fn(un)}" in tabset)
        print(f"  {label:<24} 命中 {hit}/{len(rows)}")

    md5_map = {f"Msg_{hashlib.md5(un.encode('utf-8')).hexdigest()}": un for _rid, un in rows}
    covered = len(set(md5_map) & tabset)
    print(f"  会话表被解释覆盖: {covered}/{len(tabset)}（差 {len(tabset) - covered} 张）")

    # ---- 发送者语义 ----
    print("\n=== 发送者语义（message_0.db，最新库） ===")
    rid_to_name = {rid: un for rid, un in rows}
    name_to_rid = {un: rid for rid, un in rows}
    print(f"  本人 wxid 在 Name2Id 的 rowid: {name_to_rid.get(MY_WXID, '不在表中')}")
    for t in [sample] + [x[1] for x in counts[1:4]]:
        try:
            vals = [r[0] for r in con.execute(f'SELECT DISTINCT real_sender_id FROM "{t}" ORDER BY 1')]
        except sqlite3.Error as exc:
            print(f"  {t}: 读取失败 {exc}")
            continue
        named = [(v, rid_to_name.get(v, f"<未映射 {v}>")) for v in vals[:MAX_NAMES]]
        conv = md5_map.get(t, "?")
        print(f"  {t[:20]}...  会话={conv[:22]}")
        for v, nm in named:
            mark = "  <- 本人" if nm == MY_WXID else ""
            print(f"      real_sender_id={v:<6} -> {nm}{mark}")

    # ---- 旧库语义（message_1/2/3） ----
    print("\n=== 旧库发送者语义（message_1/2/3.db） ===")
    for fname in ("message_1.db", "message_2.db", "message_3.db"):
        p = os.path.join(DEC, "message", fname)
        if not os.path.exists(p):
            continue
        c = ro(p)
        ts = [t for t in tables(c) if t.startswith("Msg_")]
        if not ts:
            print(f"  {fname}: 无会话表")
            continue
        t = ts[0]
        cols = [x[1] for x in columns(c, t)]
        if "real_sender_id" not in cols:
            print(f"  {fname}: 无 real_sender_id 字段，字段有 {cols}")
            continue
        vals = [r[0] for r in c.execute(f'SELECT DISTINCT real_sender_id FROM "{t}" ORDER BY 1')]
        n = c.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        print(f"  {fname}: 会话表 {len(ts)} 张，样本 {t[:20]}... {n} 行，real_sender_id 取值 {vals}")
        c.close()

    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
