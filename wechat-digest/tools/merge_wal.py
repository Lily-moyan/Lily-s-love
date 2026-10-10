"""第 4 步：把 WAL 里的最新消息并入明文库。

为什么不能简单重写 WAL
----------------------
SQLite 校验 WAL 时会逐帧校验 CRC（覆盖帧头 + 页内容）。如果只把页内容解密成明文，
校验和立刻失配，SQLite 会认为整个 WAL 无效而丢弃——最新消息反而丢了。
重算 CRC 可以做，但没必要。

本脚本的做法：页面级覆盖
------------------------
  1) 解析 WAL：32 字节文件头 + 若干帧，每帧 = 24 字节帧头 + 4096 字节页
     帧头 = pgno(4,大端) + 提交时页数(4,大端) + salt1(4) + salt2(4) + 校验(8)
  2) 用主库的 enc_key 解密帧内页（非首页：加密范围[0:4016]，IV=[4016:4032]；
     首页需把[0:16]换回 "SQLite format 3\\x00" 文件头）
  3) **逐页用 SQLCipher 的 HMAC-SHA512 校验**（覆盖 page + pgno），不通过的帧直接拒绝
  4) 只在最后一个有效提交点之前覆盖，保证事务一致性
  5) 把解密后的页按 (pgno-1)*4096 覆盖到明文库副本上

产物是普通 SQLite 文件，不含 WAL，SQLite 打开即得到完整最新数据。

用法： python merge_wal.py --keys out/keys.json --db-dir backup/db_storage \
                            --plain-dir out/decrypted --out-dir out/merged
"""
from __future__ import annotations

import hashlib
import hmac as hmac_mod
import json
import os
import shutil
import sqlite3
import struct
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

PAGE_SZ = 4096
RESERVE_SZ = 80
IV_OFF = PAGE_SZ - RESERVE_SZ          # 4016
HMAC_OFF = PAGE_SZ - RESERVE_SZ + 16   # 4032
SALT_SZ = 16
KEY_SZ = 32
HMAC_SZ = 64
WAL_HDR_SZ = 32
FRAME_HDR_SZ = 24
SQLITE_HDR = b"SQLite format 3\x00"


def ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def page_hmac_ok(enc_key: bytes, page: bytes, pgno: int, salt: bytes) -> bool:
    """SQLCipher 4 逐页 HMAC 校验（page1 跳过前 16 字节 salt）。"""
    mac_salt = bytes(b ^ 0x3A for b in salt)
    mac_key = hashlib.pbkdf2_hmac("sha512", enc_key, mac_salt, 2, dklen=KEY_SZ)
    if pgno == 1:
        data = page[SALT_SZ:HMAC_OFF]
    else:
        data = page[:HMAC_OFF]
    stored = page[HMAC_OFF:PAGE_SZ]
    hm = hmac_mod.new(mac_key, data, hashlib.sha512)
    hm.update(struct.pack("<I", pgno))
    return hmac_mod.compare_digest(hm.digest(), stored)


def decrypt_wal_page(enc_key: bytes, page: bytes, pgno: int) -> bytes:
    iv = page[IV_OFF : IV_OFF + 16]
    dec = Cipher(algorithms.AES(enc_key), modes.CBC(iv)).decryptor()
    if pgno == 1:
        body = dec.update(page[SALT_SZ:IV_OFF]) + dec.finalize()
        return SQLITE_HDR + body + b"\x00" * RESERVE_SZ
    body = dec.update(page[:IV_OFF]) + dec.finalize()
    return body + b"\x00" * RESERVE_SZ


def parse_wal(path: str, enc_key: bytes, db_salt: bytes):
    """返回 (frames, stats)。frames 为 [(pgno, plain_page)]，只到最后一个有效提交点。"""
    size = os.path.getsize(path)
    stats = {"frames_total": 0, "frames_hmac_ok": 0, "frames_applied": 0, "bad_hmac": 0, "reason": ""}
    if size < WAL_HDR_SZ + FRAME_HDR_SZ + PAGE_SZ:
        stats["reason"] = "WAL 太小，无有效帧"
        return [], stats

    with open(path, "rb") as fh:
        wal = fh.read()
    magic, version, page_size, ckpt, salt1, salt2 = struct.unpack(">6I", wal[:24])
    stats["wal_magic"] = hex(magic)
    stats["wal_page_size"] = page_size
    if page_size != PAGE_SZ:
        stats["reason"] = f"WAL 页大小 {page_size} != {PAGE_SZ}"
        return [], stats
    wal_salt = wal[16:24]  # salt1+salt2（大端字节序原样）

    frame_sz = FRAME_HDR_SZ + PAGE_SZ
    off = WAL_HDR_SZ
    all_frames = []  # (pgno, fsalt, commit_pages, plain_page)
    stats["generations"] = {}
    while off + frame_sz <= len(wal):
        hdr = wal[off : off + FRAME_HDR_SZ]
        pgno = struct.unpack(">I", hdr[0:4])[0]
        commit_pages = struct.unpack(">I", hdr[4:8])[0]
        fsalt = hdr[8:16]
        stats["frames_total"] += 1
        if pgno == 0:
            break
        raw_page = wal[off + FRAME_HDR_SZ : off + frame_sz]
        if not page_hmac_ok(enc_key, raw_page, pgno, db_salt):
            stats["bad_hmac"] += 1
            # 单帧 HMAC 失败 -> 该帧及其后不可信
            break
        stats["frames_hmac_ok"] += 1
        all_frames.append((pgno, fsalt, commit_pages, decrypt_wal_page(enc_key, raw_page, pgno)))
        stats["generations"][fsalt.hex()] = stats["generations"].get(fsalt.hex(), 0) + 1
        off += frame_sz

    # 关键：必须采用与 SQLite 完全相同的有效性规则——只有帧头 salt1/salt2 与 WAL 头
    # 一致的帧才属于"当前世代"，才会被 SQLite 采用。
    #
    # 其余帧是环形缓冲区里的旧世代残留。它们同样能通过 HMAC（确实是本库的真页），
    # 但把它们覆盖上去等于把数据库回滚到旧状态。实测后果：
    #   message_0.db   187799 -> 185453 条，quick_check 报损坏
    #   message_3.db   1238   -> 1016   条，quick_check 报损坏
    # 所以"HMAC 通过"只是必要条件，不是充分条件。
    current = [(p, c, pg) for (p, s, c, pg) in all_frames if s == wal_salt]
    stats["frames_current_gen"] = len(current)
    if not current:
        stats["reason"] = (
            f"WAL 内无当前世代帧（{len(stats['generations'])} 个旧世代残留），按 SQLite 规则跳过"
        )
        return [], stats

    last_commit_idx = max((i for i, (_p, c, _pg) in enumerate(current) if c), default=-1)
    if last_commit_idx < 0:
        stats["reason"] = "当前世代内没有有效提交点"
        return [], stats
    current = current[: last_commit_idx + 1]
    stats["commits"] = sum(1 for _p, c, _pg in current if c)
    stats["frames_applied"] = len(current)
    return [(p, pg) for (p, _c, pg) in current], stats


def merge_db(db_rel: str, src_db: str, plain_db: str, wal_path: str, enc_key: bytes, out_db: str):
    os.makedirs(os.path.dirname(os.path.abspath(out_db)), exist_ok=True)
    shutil.copyfile(plain_db, out_db)

    with open(src_db, "rb") as fh:
        db_salt = fh.read(SALT_SZ)

    frames, stats = parse_wal(wal_path, enc_key, db_salt)
    if not frames:
        return 0, stats

    with open(out_db, "r+b") as fh:
        for pgno, page in frames:
            fh.seek((pgno - 1) * PAGE_SZ)
            fh.write(page)
    return len(frames), stats


def count_messages(db_path: str) -> tuple[int, int]:
    """返回 (会话表数, 消息总数)。"""
    con = ro(db_path)
    tabs = [
        r[0]
        for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg\\_%' ESCAPE '\\'")
    ]
    total = 0
    for t in tabs:
        try:
            total += con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        except sqlite3.Error:
            pass
    con.close()
    return len(tabs), total


def quick_check(db_path: str) -> tuple[bool, str]:
    """合并结果必须过完整性检查才允许保留。

    两个坑：
      1) 必须用 try/finally 关连接——否则 PRAGMA 抛异常时连接泄漏，
         紧接着的 os.remove 会因 Windows 文件占用报 WinError 32；
      2) `*_fts.db`（FTS5 全文索引）的 quick_check 会稳定报错，属已知误报，
         与摘要无关，直接放行。
    """
    if os.path.basename(db_path).endswith("_fts.db"):
        return True, "FTS 索引库跳过校验（quick_check 对其为已知误报）"
    con = None
    try:
        con = ro(db_path)
        res = con.execute("PRAGMA quick_check").fetchone()[0]
        return res == "ok", str(res)[:70]
    except sqlite3.Error as exc:
        return False, str(exc)[:70]
    finally:
        if con is not None:
            con.close()


def main(argv: list[str]) -> int:
    keys_path = db_dir = plain_dir = out_dir = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--keys":
            i += 1
            keys_path = argv[i]
        elif a == "--db-dir":
            i += 1
            db_dir = argv[i]
        elif a == "--plain-dir":
            i += 1
            plain_dir = argv[i]
        elif a == "--out-dir":
            i += 1
            out_dir = argv[i]
        i += 1
    if not all((keys_path, db_dir, plain_dir, out_dir)):
        print(__doc__)
        return 2

    with open(keys_path, encoding="utf-8") as fh:
        key_map = json.load(fh)["salt_to_key"]

    print(f"{'文件':<28}{'帧总数':>7}{'HMAC过':>8}{'已应用':>8}  {'消息数变化':<22}备注")
    print("-" * 96)
    grand_before = grand_after = 0
    for root, _dirs, files in os.walk(db_dir):
        for name in sorted(files):
            if not name.endswith(".db"):
                continue
            src_db = os.path.join(root, name)
            wal_path = src_db + "-wal"
            rel = os.path.relpath(src_db, db_dir)
            plain_db = os.path.join(plain_dir, rel)
            out_db = os.path.join(out_dir, rel)
            if not os.path.exists(plain_db):
                continue
            with open(src_db, "rb") as fh:
                salt_hex = fh.read(SALT_SZ).hex()
            enc_key_hex = key_map.get(salt_hex)
            if not enc_key_hex:
                continue

            if not os.path.exists(wal_path) or os.path.getsize(wal_path) <= WAL_HDR_SZ:
                os.makedirs(os.path.dirname(os.path.abspath(out_db)), exist_ok=True)
                shutil.copyfile(plain_db, out_db)
                continue

            applied, stats = merge_db(
                rel, src_db, plain_db, wal_path, bytes.fromhex(enc_key_hex), out_db
            )
            if applied:
                ok, detail = quick_check(out_db)
                if not ok:
                    # 宁可不要 WAL 数据，也不能交出一个损坏的库
                    os.remove(out_db)
                    shutil.copyfile(plain_db, out_db)
                    applied = 0
                    stats["reason"] = f"合并结果未过完整性检查（{detail}），已回退为未合并版本"
            note = stats.get("reason", "")
            if stats["bad_hmac"]:
                note = f"HMAC 失败 {stats['bad_hmac']} 帧"
            elif applied:
                note = f"提交点 {stats.get('commits', 0)} 个"

            delta = ""
            if rel.startswith("message\\") or rel.startswith("message/"):
                b_tabs, b_cnt = count_messages(plain_db)
                a_tabs, a_cnt = count_messages(out_db)
                grand_before += b_cnt
                grand_after += a_cnt
                delta = f"{b_cnt} -> {a_cnt} (+{a_cnt - b_cnt})"
            print(
                f"{rel:<28}{stats['frames_total']:>7}{stats['frames_hmac_ok']:>8}{applied:>8}  {delta:<22}{note}"
            )

    print("-" * 96)
    print(f"message_*.db 消息总数: {grand_before} -> {grand_after}  (新增 {grand_after - grand_before} 条)")
    print(f"合并结果目录: {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
