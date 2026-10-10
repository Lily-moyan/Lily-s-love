"""验证 libzstd 解压路径，并看清 type 49 解压后的 XML 结构。

本机没有 zstandard 包（pip 网络被拦），改用 Git 自带的 libzstd.dll。
注意：微信写入的 zstd 帧头 FCS 字段缺失，ZSTD_getFrameContentSize 会返回
"未知"，因此必须用 ZSTD_decompressBound 或逐步放大缓冲区，不能直接按 FCS 分配。

用法： python zstd_probe.py [会话名关键字]
"""
from __future__ import annotations

import ctypes
import json
import os
import sqlite3
import sys
from collections import Counter
from datetime import datetime

BASE = r"G:\dsh\wechat-digest"
MERGED = os.path.join(BASE, "out", "merged", "message")
ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"
CONTENTSIZE_UNKNOWN = 0xFFFFFFFFFFFFFFFF

DLL_CANDIDATES = (
    r"C:\Program Files\Git\mingw64\bin\libzstd.dll",
    r"C:\Program Files\Git\usr\bin\msys-zstd-1.dll",
)


def load_zstd():
    for cand in DLL_CANDIDATES:
        if not os.path.exists(cand):
            continue
        lib = ctypes.CDLL(cand)
        lib.ZSTD_getFrameContentSize.argtypes = [ctypes.c_char_p, ctypes.c_size_t]
        lib.ZSTD_getFrameContentSize.restype = ctypes.c_ulonglong
        lib.ZSTD_decompress.argtypes = [
            ctypes.c_char_p, ctypes.c_size_t, ctypes.c_char_p, ctypes.c_size_t
        ]
        lib.ZSTD_decompress.restype = ctypes.c_size_t
        lib.ZSTD_isError.argtypes = [ctypes.c_size_t]
        lib.ZSTD_isError.restype = ctypes.c_uint
        lib.ZSTD_getErrorName.argtypes = [ctypes.c_size_t]
        lib.ZSTD_getErrorName.restype = ctypes.c_char_p
        if hasattr(lib, "ZSTD_decompressBound"):
            lib.ZSTD_decompressBound.argtypes = [ctypes.c_char_p, ctypes.c_size_t]
            lib.ZSTD_decompressBound.restype = ctypes.c_ulonglong
        print(f"已加载 {cand}")
        return lib
    raise SystemExit("未找到 libzstd.dll")


def decompress(lib, data: bytes) -> tuple[bytes | None, str]:
    size = lib.ZSTD_getFrameContentSize(data, len(data))
    note = f"FCS={size}"
    if size in (CONTENTSIZE_UNKNOWN, 0xFFFFFFFFFFFFFFFE):
        bound = 0
        if hasattr(lib, "ZSTD_decompressBound"):
            bound = lib.ZSTD_decompressBound(data, len(data))
        cap = int(bound) if bound and bound < 64 * 1024 * 1024 else 4 * 1024 * 1024
        note += f" 未知 -> decompressBound={bound} 用容量 {cap}"
    else:
        cap = int(size)
    for attempt in range(6):
        buf = ctypes.create_string_buffer(cap)
        got = lib.ZSTD_decompress(buf, cap, data, len(data))
        if not lib.ZSTD_isError(got):
            return buf.raw[:got], note + f" 实得 {got} 字节"
        err = lib.ZSTD_getErrorName(got).decode()
        if "Destination buffer is too small" in err:
            cap *= 3
            note += f" | 扩容到 {cap}"
            continue
        return None, note + f" 失败: {err}"
    return None, note + " 多次扩容仍失败"


def ro(p: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{p}?mode=ro", uri=True)


def main(argv: list[str]) -> int:
    lib = load_zstd()
    name = argv[0] if argv else "炒饭会交流群"
    with open(os.path.join(BASE, "out", "conversations.json"), encoding="utf-8") as fh:
        records = json.load(fh)["records"]
    hits = [r for r in records if name in r["display_name"]]
    username = hits[0]["username"]
    recs = [r for r in records if r["username"] == username]
    group = username
    print(f"会话 {hits[0]['display_name']} ({group})")

    shown = Counter()
    text_samples = []
    for r in recs:
        con = ro(os.path.join(MERGED, r["shard"]))
        cols = [c[1] for c in con.execute(f'PRAGMA table_info("{r["table"]}")')]
        for row in con.execute(f'SELECT * FROM "{r["table"]}" ORDER BY create_time DESC LIMIT 800'):
            d = dict(zip(cols, row))
            lt = d.get("local_type") or 0
            t, sub = lt & 0xFFFFFFFF, lt >> 32
            blob = d.get("message_content")
            if t == 49 and isinstance(blob, (bytes, bytearray)) and bytes(blob[:4]) == ZSTD_MAGIC:
                if shown[sub] >= 1 or sum(shown.values()) >= 6:
                    continue
                out, note = decompress(lib, bytes(blob))
                shown[sub] += 1
                print(f"\n--- subtype={sub} {datetime.fromtimestamp(d['create_time']):%m-%d %H:%M} {note} ---")
                if out:
                    s = out.decode("utf-8", "replace")
                    print(s[:900])
                else:
                    print("  解压失败")
            elif t == 1 and len(text_samples) < 6:
                s = str(blob or "")
                text_samples.append((datetime.fromtimestamp(d["create_time"]).strftime("%m-%d %H:%M"), s[:200]))
        con.close()

    print("\n=== 群内显示名（chatroom_member） ===")
    con = ro(os.path.join(BASE, "out", "merged", "contact", "contact.db"))
    cols = [c[1] for c in con.execute('PRAGMA table_info("chatroom_member")')]
    print("  字段:", ", ".join(cols))
    try:
        rows = con.execute(
            "SELECT * FROM chatroom_member WHERE chat_room_username = ? LIMIT 8", (group,)
        ).fetchall()
        if not rows:
            rows = con.execute("SELECT * FROM chatroom_member LIMIT 5").fetchall()
            print("  (该群未匹配到，展示前 5 行示例)")
        for row in rows:
            print("   ", dict(zip(cols, row)))
    except sqlite3.Error as exc:
        print("  查询失败:", exc)
    con.close()

    print("\n=== type 1 文本样本（注意是否带发送者前缀） ===")
    for ts, s in text_samples:
        print(f"  [{ts}] {s!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
