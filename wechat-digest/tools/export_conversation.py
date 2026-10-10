"""单会话消息导出器：把某个微信会话导出为可读文本 + 结构化 JSONL。

这是「第 5 步」的地基。踩过的坑（都已在本文件里处理）：
  1) local_type 是 64 位打包值：低 32 位=类型，高 32 位=子类型。
     例如 244813135921 = (57<<32)|49 -> 类型 49（appmsg）的子类型 57（引用回复）。
  2) 群消息的 message_content 带发送者前缀 `wxid_xxx:\\n实际内容`，必须剥掉。
  3) type 49 的 XML 本身是 ZSTD 压缩帧存在 message_content 里（不是 compress_content），
     且帧头常缺 FCS 字段；本机无 zstandard 包，走 Git 自带 libzstd.dll 的 ctypes 绑定。
  4) 群昵称不在 chatroom_member（只有 room_id/member_id）。用"谁引用了我"的
     <refermsg><displayname> 反推本人群昵称，才能准确识别 @我。
  5) 同一会话可能跨多个 shard，各 shard 的 Name2Id rowid 独立 -> 逐 shard 解析。

用法：
  python export_conversation.py --name 炒饭会交流群 --stats
  python export_conversation.py --name 炒饭会交流群 --days 7
  python export_conversation.py --name 炒饭会交流群 --since 2026-10-02
"""
from __future__ import annotations

import ctypes
import json
import os
import re
import sqlite3
import sys
from datetime import datetime
from html import unescape

BASE = r"G:\dsh\wechat-digest"
MERGED = os.path.join(BASE, "out", "merged", "message")
EXPORT_DIR = os.path.join(BASE, "out", "exports")
MY_WXID = "wxid_pysr0b0aplrs21"
ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"
CONTENTSIZE_UNKNOWN = 0xFFFFFFFFFFFFFFFF

TYPE_NAMES = {
    1: "文本", 3: "图片", 34: "语音", 42: "名片", 43: "视频",
    47: "表情", 48: "位置", 49: "appmsg", 50: "通话",
    10000: "系统", 10002: "撤回",
}
NOISE_TYPES = {47, 10000}
ZSTD_DLLS = (
    r"C:\Program Files\Git\mingw64\bin\libzstd.dll",
    r"C:\Program Files\Git\usr\bin\msys-zstd-1.dll",
)

_zstd = None


def get_zstd():
    global _zstd
    if _zstd is not None:
        return _zstd
    for cand in ZSTD_DLLS:
        if not os.path.exists(cand):
            continue
        try:
            lib = ctypes.CDLL(cand)
        except OSError:
            continue
        lib.ZSTD_getFrameContentSize.argtypes = [ctypes.c_char_p, ctypes.c_size_t]
        lib.ZSTD_getFrameContentSize.restype = ctypes.c_ulonglong
        lib.ZSTD_decompress.argtypes = [ctypes.c_char_p, ctypes.c_size_t, ctypes.c_char_p, ctypes.c_size_t]
        lib.ZSTD_decompress.restype = ctypes.c_size_t
        lib.ZSTD_isError.argtypes = [ctypes.c_size_t]
        lib.ZSTD_isError.restype = ctypes.c_uint
        lib.ZSTD_getErrorName.argtypes = [ctypes.c_size_t]
        lib.ZSTD_getErrorName.restype = ctypes.c_char_p
        if hasattr(lib, "ZSTD_decompressBound"):
            lib.ZSTD_decompressBound.argtypes = [ctypes.c_char_p, ctypes.c_size_t]
            lib.ZSTD_decompressBound.restype = ctypes.c_ulonglong
        _zstd = lib
        return lib
    return None


def zstd_decompress(data: bytes) -> bytes | None:
    lib = get_zstd()
    if lib is None:
        return None
    size = lib.ZSTD_getFrameContentSize(data, len(data))
    if size in (CONTENTSIZE_UNKNOWN, 0xFFFFFFFFFFFFFFFE):
        bound = lib.ZSTD_decompressBound(data, len(data)) if hasattr(lib, "ZSTD_decompressBound") else 0
        cap = int(bound) if bound and 0 < bound < 32 * 1024 * 1024 else 2 * 1024 * 1024
    else:
        cap = int(size) + 1
    for _ in range(6):
        buf = ctypes.create_string_buffer(cap)
        got = lib.ZSTD_decompress(buf, cap, data, len(data))
        if not lib.ZSTD_isError(got):
            return buf.raw[:got]
        if b"too small" in lib.ZSTD_getErrorName(got):
            cap *= 3
            continue
        return None
    return None


def ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def load_contacts() -> dict[str, str]:
    con = ro(os.path.join(BASE, "out", "merged", "contact", "contact.db"))
    out: dict[str, str] = {}
    for username, remark, nick in con.execute("SELECT username, remark, nick_name FROM contact"):
        remark = (remark or "").strip()
        nick = (nick or "").strip()
        out[username] = remark or nick or username
    con.close()
    return out


def find_conversation(name: str) -> tuple[str, list[dict]]:
    with open(os.path.join(BASE, "out", "conversations.json"), encoding="utf-8") as fh:
        records = json.load(fh)["records"]
    hits = [r for r in records if name in r["display_name"]] or [
        r for r in records if name in r["username"]
    ]
    if not hits:
        raise SystemExit(f"未找到匹配「{name}」的会话")
    username = hits[0]["username"]
    return username, [r for r in records if r["username"] == username]


def clean(s: str | None) -> str:
    if not s:
        return ""
    s = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", s, flags=re.S)
    s = unescape(unescape(s))
    return re.sub(r"\s+", " ", s).strip()


def tag(xml: str, name: str) -> str:
    m = re.search(rf"<{name}>(.*?)</{name}>", xml, re.S)
    return clean(m.group(1)) if m else ""


def parse_appmsg(xml: str) -> str:
    """把 appmsg XML 压成一行可读文本。"""
    sub = tag(xml, "type")
    title = tag(xml, "title")
    des = tag(xml, "des")
    url = tag(xml, "url")
    fileext = tag(xml, "fileext")

    if sub == "62":
        return f"[拍了拍] {title}"
    if sub == "57":
        ref = re.search(r"<refermsg>(.*?)</refermsg>", xml, re.S)
        who, quoted = "", ""
        if ref:
            r = ref.group(1)
            who = tag(r, "displayname")
            inner = re.search(r"<content>(.*?)</content>", r, re.S)
            if inner:
                inner_raw = unescape(inner.group(1))
                if "<title>" in inner_raw:
                    quoted = tag(inner_raw, "title")
                else:
                    # 被引用的是普通文本消息：剥掉标签直接取文本
                    quoted = clean(re.sub(r"<[^>]+>", " ", inner_raw))
        tail = f"  ↳引用 {who}: {quoted}" if (who or quoted) else ""
        return f"{title}{tail}"
    if sub == "6" or fileext:
        return f"[文件] {title}" + (f" ({fileext})" if fileext else "")
    if sub == "19":
        return f"[聊天记录] {title or des}"
    link = f"  <{url[:200]}>" if url else ""
    if sub == "5":
        return f"[链接] {title}{(' — ' + des) if des else ''}{link}"
    if sub in ("4", "36", "51", "47", "124", "8"):
        return f"[分享] {title}{(' — ' + des) if des else ''}{link}"
    parts = [f"[appmsg{sub}]"]
    if title:
        parts.append(title)
    if des:
        parts.append(des)
    if url:
        parts.append(url[:80])
    return " ".join(parts)


def extract_text(raw) -> str:
    """把 message_content 变成可读文本（处理 bytes/ZSTD/XML）。"""
    if raw is None:
        return ""
    if isinstance(raw, (bytes, bytearray)):
        b = bytes(raw)
        if b[:4] == ZSTD_MAGIC:
            dec = zstd_decompress(b)
            if dec is None:
                return "[ZSTD 解压失败]"
            text = dec.decode("utf-8", "replace")
        else:
            text = b.decode("utf-8", "replace")
    else:
        text = str(raw)
    if "<appmsg" in text:
        return parse_appmsg(text)
    if "<msg" in text[:80] or text.lstrip().startswith("<?xml"):
        # 图片/视频等非 appmsg 的 XML：类型标签已表达信息，正文留空避免噪声
        if "<img" in text:
            return ""
        if "<video" in text:
            return ""
        if "<emoji" in text:
            return ""
        return ""
    return text.strip()


def main(argv: list[str]) -> int:
    name, days, since, until, stats_only = None, 7, None, None, False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--name":
            i += 1
            name = argv[i]
        elif a == "--days":
            i += 1
            days = int(argv[i])
        elif a == "--since":
            i += 1
            since = argv[i]
        elif a == "--until":
            i += 1
            until = argv[i]
        elif a == "--stats":
            stats_only = True
        i += 1
    if not name:
        print(__doc__)
        return 2

    username, records = find_conversation(name)
    contacts = load_contacts()
    print(f"会话：{records[0]['display_name']}  ({username})")
    print(f"分片：{', '.join(r['shard'] for r in records)}")

    # ---- 第一遍：拿全表，确定窗口 + 反推本人群昵称 ----
    latest = 0
    my_group_nick = ""
    per_shard_rows: dict[str, list] = {}
    for r in records:
        con = ro(os.path.join(MERGED, r["shard"]))
        con.row_factory = sqlite3.Row
        cols = [c[1] for c in con.execute(f'PRAGMA table_info("{r["table"]}")')]
        rows = []
        for row in con.execute(f'SELECT * FROM "{r["table"]}" ORDER BY create_time, local_id'):
            d = dict(row)
            d["_shard"] = r["shard"]
            rows.append(d)
            if d.get("create_time"):
                latest = max(latest, d["create_time"])
            text = extract_text(d.get("message_content"))
            if text.startswith("<?xml") or text.startswith("<msg>"):
                for m in re.finditer(r"<refermsg>(.*?)</refermsg>", text, re.S):
                    blk = m.group(1)
                    if MY_WXID in blk:
                        dn = tag(blk, "displayname")
                        if dn:
                            my_group_nick = dn
        per_shard_rows[r["shard"]] = rows
        con.close()

    t0 = int(datetime.strptime(since, "%Y-%m-%d").timestamp()) if since else latest - days * 86400
    t1 = int(datetime.strptime(until, "%Y-%m-%d").timestamp()) if until else latest + 1
    print(f"窗口：{datetime.fromtimestamp(t0):%Y-%m-%d %H:%M} -> {datetime.fromtimestamp(t1):%Y-%m-%d %H:%M}")
    print(f"本人群昵称（由引用反推）：{my_group_nick or '未取到'}")

    mention_re = None
    if my_group_nick:
        mention_re = re.compile(re.escape("@" + my_group_nick))

    rows_out = []
    type_hist: dict[str, int] = {}
    zstd_n = 0
    for shard, rows in per_shard_rows.items():
        con = ro(os.path.join(MERGED, shard))
        rid2name = {r: u for r, u in con.execute("SELECT rowid, user_name FROM Name2Id")}
        con.close()
        for d in rows:
            ct = d.get("create_time") or 0
            if not (t0 <= ct < t1):
                continue
            lt = d.get("local_type") or 0
            t, sub = lt & 0xFFFFFFFF, lt >> 32
            raw = d.get("message_content")
            if isinstance(raw, (bytes, bytearray)) and bytes(raw[:4]) == ZSTD_MAGIC:
                zstd_n += 1
            text = extract_text(raw)
            sender = rid2name.get(d.get("real_sender_id"))
            # 剥离发送者前缀 `user_name:\n`
            if sender and text.startswith(sender + ":"):
                text = text[len(sender) + 1 :].lstrip("\n ")
            key = f"{TYPE_NAMES.get(t, str(t))}" + (f"/{sub}" if sub else "")
            type_hist[key] = type_hist.get(key, 0) + 1
            is_mention = bool(mention_re and mention_re.search(text))
            any_at = bool(re.search(r"@[^\s@\u2005]{1,24}[\u2005\s]", text))
            rows_out.append(
                {
                    "time": ct,
                    "shard": shard,
                    "local_id": d.get("local_id"),
                    "type": t,
                    "sub": sub,
                    "type_name": TYPE_NAMES.get(t, str(t)),
                    "sender_wxid": sender,
                    "sender": "我" if sender == MY_WXID else contacts.get(sender or "", sender or "（未知）"),
                    "is_me": sender == MY_WXID,
                    "mention_me": is_mention,
                    "has_at": any_at,
                    "text": text,
                }
            )
    rows_out.sort(key=lambda x: (x["time"], x["local_id"] or 0))

    print(f"\n窗口内消息 {len(rows_out)} 条；其中 ZSTD 压缩内容 {zstd_n} 条")
    print("类型分布：")
    for k, n in sorted(type_hist.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<14} {n} 条")
    mine = sum(1 for r in rows_out if r["is_me"])
    mentions = [r for r in rows_out if r["mention_me"]]
    print(f"我发出 {mine} 条；明确 @我 {len(mentions)} 条")
    for r in mentions[:10]:
        print(f"  @我 [{datetime.fromtimestamp(r['time']):%m-%d %H:%M}] {r['sender']}: {r['text'][:80]}")
    if stats_only:
        return 0

    os.makedirs(EXPORT_DIR, exist_ok=True)
    safe = re.sub(r"[^\w\u4e00-\u9fff-]", "_", records[0]["display_name"])[:40]
    stamp = f"{datetime.fromtimestamp(t0):%Y%m%d}-{datetime.fromtimestamp(t1 - 1):%Y%m%d}"
    jsonl_path = os.path.join(EXPORT_DIR, f"{safe}_{stamp}.jsonl")
    txt_path = os.path.join(EXPORT_DIR, f"{safe}_{stamp}.txt")
    with open(jsonl_path, "w", encoding="utf-8") as fh:
        for row in rows_out:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    lines: list[str] = []
    last_day, last_sender, last_ts = None, None, 0
    for row in rows_out:
        t, sub = row["type"], row["sub"]
        if t in NOISE_TYPES:
            continue
        day = datetime.fromtimestamp(row["time"]).strftime("%Y-%m-%d")
        if day != last_day:
            lines.append(f"\n===== {day} =====")
            last_day, last_sender = day, None
        stamp_s = datetime.fromtimestamp(row["time"]).strftime("%H:%M")
        tags = []
        if row["mention_me"]:
            tags.append("@我")
        elif row["has_at"]:
            tags.append("@")
        if t == 3:
            tags.append("图片")
        elif t == 34:
            tags.append("语音")
        elif t == 43:
            tags.append("视频")
        text = row["text"].replace("\n", " ").strip()
        if not text and not tags:
            continue
        if len(text) > 300:
            text = text[:300] + "…"
        tag_s = f"[{'/'.join(tags)}] " if tags else ""
        who = row["sender"]
        if who == last_sender and row["time"] - last_ts <= 300 and not tags:
            lines.append(f"    {text}")
        else:
            lines.append(f"[{stamp_s}] {who}: {tag_s}{text}")
        last_sender, last_ts = who, row["time"]
    # 把统计口径写进文件头：否则下游会把"带时间戳发言数"误当成"消息总数"，
    # 误判为数据缺失。真实关系是：
    #   窗口内消息总数 = 带时间戳发言 + 同一人 5 分钟内续言 + 被过滤的噪声消息
    n_ts = sum(1 for ln in lines if re.match(r"^\[\d\d:\d\d\] ", ln))
    n_cont = sum(1 for ln in lines if ln.startswith("    "))
    n_noise = len(rows_out) - n_ts - n_cont
    header = (
        f"# 会话：{records[0]['display_name']} ({username})\n"
        f"# 窗口：{datetime.fromtimestamp(t0):%Y-%m-%d %H:%M} ~ "
        f"{datetime.fromtimestamp(t1 - 1):%Y-%m-%d %H:%M}\n"
        f"# 统计口径：窗口内消息 {len(rows_out)} 条 = 带时间戳发言 {n_ts} 条 "
        f"+ 同一人5分钟内续言 {n_cont} 条 + 过滤掉的噪声/无正文消息 {n_noise} 条\n"
        f"# 我发出 {sum(1 for r in rows_out if r['is_me'])} 条；明确 @我 "
        f"{sum(1 for r in rows_out if r['mention_me'])} 条；ZSTD 压缩内容 {zstd_n} 条\n"
        f"# 阅读约定：缩进且无时间戳的行属于上一条同一人的延续；↳引用 表示对某人的引用回复\n"
    )
    with open(txt_path, "w", encoding="utf-8") as fh:
        fh.write(header + "\n" + "\n".join(lines))

    print(f"\nJSONL -> {jsonl_path}")
    print(f"紧凑文本 -> {txt_path}  （{len(lines)} 行，{os.path.getsize(txt_path)} 字节）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
