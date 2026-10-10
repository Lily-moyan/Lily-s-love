"""每小时数据刷新管线：备份 -> 密钥 -> 解密 -> 会话映射 -> 图片 -> 状态文件。

原则：
  1) 每一步都独立记录成功/失败/耗时，单步失败不中断整条管线（解密是唯一硬依赖）；
  2) 幂等且增量——已解出的图片不重复解，未变化的目录 robocopy 很快；
  3) 绝不用可疑数据覆盖已知良好的结果：解密后做 quick_check，失败则保留上一版；
  4) 产出 out/status.json 供网页工作台读取，展示层不直接碰数据库。

注意：本脚本**不生成摘要**（那一步需要 LLM，无法无人化）。
它只保证"数据是最新的"，并给出每个会话的最近消息时间，
供工作台判断"某份摘要之后又来了多少新消息"。

用法： python refresh_pipeline.py [--images] [--fast]
"""
from __future__ import annotations

import glob
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from datetime import datetime

BASE = r"G:\dsh\wechat-digest"
TOOLS = os.path.join(BASE, "tools")
ROOT = r"G:\weixin\xwechat_files\wxid_pysr0b0aplrs21_986b"
SRC_DB = os.path.join(ROOT, "db_storage")
BACKUP = os.path.join(BASE, "backup", "db_storage")
PLAIN = os.path.join(BASE, "out", "decrypted")
MERGED = os.path.join(BASE, "out", "merged")
EXPORTS = os.path.join(BASE, "out", "exports")
IMAGES = os.path.join(BASE, "out", "images")
DIGESTS = os.path.join(BASE, "out", "digests")
STATUS = os.path.join(BASE, "out", "status.json")
KEYS = os.path.join(BASE, "out", "keys.json")
IMG_KEY = os.path.join(BASE, "keys", "image_key.json")
PY = sys.executable


def run_tool(script: str, args: list[str], timeout: int = 900) -> tuple[bool, str]:
    cmd = [PY, os.path.join(TOOLS, script)] + args
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, f"超时 >{timeout}s"
    out = (p.stdout or "") + (p.stderr or "")
    tail = "\n".join([ln for ln in out.strip().splitlines() if ln.strip()][-3:])
    return p.returncode == 0, tail[:400]


def step(name: str, fn) -> dict:
    t0 = time.time()
    try:
        ok, note = fn()
    except Exception as exc:  # noqa: BLE001
        ok, note = False, f"{type(exc).__name__}: {exc}"
    rec = {"name": name, "ok": bool(ok), "seconds": round(time.time() - t0, 1), "note": note}
    print(f"  [{'OK ' if ok else 'FAIL'}] {name:<22} {rec['seconds']:>6.1f}s  {note}")
    return rec


def wechat_pids() -> list[int]:
    try:
        p = subprocess.run(["tasklist", "/FI", "IMAGENAME eq Weixin.exe", "/FO", "CSV", "/NH"],
                           capture_output=True, text=True, encoding="gbk", errors="replace",
                           creationflags=0x08000000)
    except Exception:  # noqa: BLE001
        return []
    pids = []
    for line in (p.stdout or "").strip().splitlines():
        parts = line.strip('"').split('","')
        if len(parts) >= 2 and parts[0].lower().startswith("weixin.exe"):
            try:
                pids.append(int(parts[1]))
            except ValueError:
                pass
    return pids


def load_keys() -> dict:
    if not os.path.exists(KEYS):
        return {}
    try:
        with open(KEYS, encoding="utf-8") as fh:
            return json.load(fh).get("salt_to_key", {})
    except Exception:  # noqa: BLE001
        return {}


def critical_key_status() -> tuple[bool, str]:
    """只关心**关键库**（message_*.db）有没有密钥。

    不要用"全部库都有密钥"当条件：`migrate\\unspportmsg.db` 等少数库本来就没有密钥，
    那个判断永远为假，会导致每小时都重新扫一次内存（浪费且可能干扰微信）。
    """
    keys = load_keys()
    if not keys:
        return False, "无 keys.json"
    missing = []
    total = 0
    for p in glob.glob(os.path.join(BACKUP, "message", "message_*.db")):
        total += 1
        with open(p, "rb") as fh:
            if fh.read(16).hex() not in keys:
                missing.append(os.path.basename(p))
    if total == 0:
        return False, "备份里没有 message_*.db"
    return (not missing), (
        f"关键库 {total - len(missing)}/{total} 有密钥"
        + (f"，缺: {', '.join(missing)}" if missing else "")
    )


def quick_check_all() -> tuple[bool, str]:
    """明文库完整性校验。

    `*_fts.db` 是 FTS5 全文索引（含影子表），对它跑 quick_check 会稳定报错，
    属于已知误报且与摘要无关，因此排除在硬门禁之外，只在备注里体现。
    """
    bad, fts = [], 0
    for p in glob.glob(os.path.join(MERGED, "**", "*.db"), recursive=True):
        if os.path.basename(p).endswith("_fts.db"):
            fts += 1
            continue
        try:
            con = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
            r = con.execute("PRAGMA quick_check").fetchone()[0]
            con.close()
            if r != "ok":
                bad.append(os.path.basename(p))
        except sqlite3.Error:
            bad.append(os.path.basename(p))
    note = f"{len(bad)} 个库异常: {', '.join(bad[:3])}" if bad else "业务库全部通过"
    if fts:
        note += f"（已跳过 {fts} 个 FTS 索引库，quick_check 对其为已知误报）"
    return (not bad), note


def get_digest_files() -> list[dict]:
    out = []
    for p in sorted(glob.glob(os.path.join(DIGESTS, "*.md"))):
        name = os.path.basename(p)
        if name.startswith("_"):
            continue
        with open(p, encoding="utf-8") as fh:
            text = fh.read()
        title = ""
        for line in text.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                break
        m = re.search(r"(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})", title)
        out.append({
            "file": name,
            "title": title,
            "conv": title.split(" 摘要")[0].strip(),
            "window_start": m.group(1) if m else "",
            "window_end": m.group(2) if m else "",
            "mtime": datetime.fromtimestamp(os.path.getmtime(p)).strftime("%Y-%m-%d %H:%M"),
            "size": os.path.getsize(p),
        })
    return out


def main(argv: list[str]) -> int:
    do_images = "--images" in argv
    fast = "--fast" in argv
    t_all = time.time()
    print(f"=== 数据刷新 {datetime.now():%Y-%m-%d %H:%M:%S} ===")
    steps: list[dict] = []

    def s_backup():
        os.makedirs(BACKUP, exist_ok=True)
        p = subprocess.run(
            ["robocopy", SRC_DB, BACKUP, "/E", "/R:1", "/W:1", "/NP", "/NFL", "/NDL", "/NJH", "/NJS"],
            capture_output=True, text=True, encoding="gbk", errors="replace",
        )
        n = len(glob.glob(os.path.join(BACKUP, "**", "*"), recursive=True))
        return p.returncode < 8, f"robocopy exit={p.returncode}, 备份目录 {n} 项"

    steps.append(step("1 备份 db_storage", s_backup))

    key_ok, key_note = critical_key_status()
    if not key_ok:
        steps.append(step("2 提取数据库密钥", lambda: run_tool(
            "find_key_v2.py",
            ["--db-dir", BACKUP, "--json", KEYS] + [str(p) for p in wechat_pids()],
        )))
    else:
        steps.append(step("2 数据库密钥", lambda: (True, key_note)))

    def s_decrypt():
        ok, note = run_tool("decrypt_db.py", ["--keys", KEYS, "--db-dir", BACKUP, "--out-dir", PLAIN])
        return ok, note

    steps.append(step("3 解密数据库", s_decrypt))

    def s_wal():
        ok, note = run_tool("merge_wal.py", [
            "--keys", KEYS, "--db-dir", BACKUP, "--plain-dir", PLAIN, "--out-dir", MERGED,
        ])
        return ok, note

    steps.append(step("4 WAL 合并(带完整性门禁)", s_wal))

    def s_integrity():
        return quick_check_all()

    steps.append(step("5 明文库完整性校验", s_integrity))

    steps.append(step("6 会话映射", lambda: run_tool("map_conversations.py", [])))
    steps.append(step("7 活跃度统计", lambda: run_tool("recent_activity.py", ["--days", "7", "--top", "80"])))
    # 重新生成跨会话汇总（待办总表），工作台直接读它
    steps.append(step("8 汇总待办索引", lambda: run_tool("build_index.py", [])))

    if do_images and not fast:
        if not os.path.exists(IMG_KEY):
            steps.append(step("9 图片密钥", lambda: run_tool(
                "find_image_key2.py", ["--conv", "炒饭会交流群"] + [str(p) for p in wechat_pids()]
            )))
        else:
            steps.append(step("9 图片密钥", lambda: (True, "已缓存")))

        def s_images():
            if not os.path.exists(IMG_KEY):
                return False, "缺图片密钥"
            act_path = os.path.join(BASE, "out", "recent_activity.json")
            if not os.path.exists(act_path):
                return False, "缺 recent_activity.json"
            with open(act_path, encoding="utf-8") as fh:
                act = json.load(fh)["rows"]
            conv = json.load(open(os.path.join(BASE, "out", "conversations.json"), encoding="utf-8"))["records"]
            name2hash = {}
            for r in conv:
                name2hash.setdefault(r["username"], r["table"][4:])
            months = sorted({datetime.now().strftime("%Y-%m"), "2026-10", "2026-09"})
            done = skipped = 0
            for row in act:
                h = name2hash.get(row["username"])
                if not h:
                    continue
                out_dir = os.path.join(IMAGES, f"bubble_{h}")
                for m in months:
                    bub = os.path.join(ROOT, "cache", m, "Message", h, "Bubble")
                    if not os.path.isdir(bub):
                        continue
                    todo = [p for p in glob.glob(os.path.join(bub, "*.dat"))
                            if not os.path.exists(os.path.join(out_dir, os.path.basename(p)[:-4] + ".jpg"))]
                    if not todo:
                        skipped += 1
                        continue
                    ok, _ = run_tool("decrypt_dat.py",
                                     ["--attach", bub, "--subdir", ".", "--out-dir", out_dir], timeout=600)
                    done += len(todo) if ok else 0
            return True, f"新解 {done} 张，跳过 {skipped} 个目录（无新增）"

        steps.append(step("10 解密新增图片", s_images))

    # ---- 汇总状态 ----
    snapshot_at = ""
    conv_status: list[dict] = []
    act_path = os.path.join(BASE, "out", "recent_activity.json")
    if os.path.exists(act_path):
        with open(act_path, encoding="utf-8") as fh:
            act = json.load(fh)
        conv_status = act.get("rows", [])
    # 快照时间用 session.db 的会话表时间，比扫全部消息表便宜得多
    try:
        con = sqlite3.connect(f"file:{os.path.join(MERGED, 'session', 'session.db')}?mode=ro", uri=True)
        v = con.execute("SELECT MAX(last_timestamp) FROM SessionTable").fetchone()[0]
        snapshot_at = datetime.fromtimestamp(v).strftime("%Y-%m-%d %H:%M:%S") if v else ""
        con.close()
    except sqlite3.Error:
        pass

    digests = get_digest_files()
    for row in conv_status:
        match = next(
            (d for d in digests if d["conv"] and (d["conv"] in row["display"] or row["display"] in d["conv"])),
            None,
        )
        row["digest_file"] = match["file"] if match else ""
        row["digest_window_end"] = match["window_end"] if match else ""
        row["digest_mtime"] = match["mtime"] if match else ""
        if match and match["window_end"]:
            latest = row.get("last_global") or row["last"] or 0
            last_day = datetime.fromtimestamp(latest).strftime("%Y-%m-%d") if latest else ""
            row["stale"] = bool(last_day and last_day > match["window_end"])
        else:
            row["stale"] = False

    # 密钥覆盖情况（仅作展示：少数库如 migrate\unspportmsg.db 本来就没有密钥）
    keys_map = load_keys()
    total_db = with_key = 0
    for p in glob.glob(os.path.join(BACKUP, "**", "*.db"), recursive=True):
        if os.path.getsize(p) < 4096:
            continue
        total_db += 1
        with open(p, "rb") as fh:
            if fh.read(16).hex() in keys_map:
                with_key += 1

    img_total = len(glob.glob(os.path.join(IMAGES, "**", "*.jpg"), recursive=True)) + \
        len(glob.glob(os.path.join(IMAGES, "**", "*.png"), recursive=True))

    status = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "duration_s": round(time.time() - t_all, 1),
        "snapshot_at": snapshot_at,
        "steps": steps,
        "keys": {"db_with_key": with_key, "db_total": total_db, "image_key": os.path.exists(IMG_KEY)},
        "conversations": conv_status,
        "digests": digests,
        "image_total": img_total,
        "image_conv_dirs": len(glob.glob(os.path.join(IMAGES, "*"))),
    }
    os.makedirs(os.path.dirname(STATUS), exist_ok=True)
    with open(STATUS, "w", encoding="utf-8") as fh:
        json.dump(status, fh, ensure_ascii=False, indent=2)
    print(f"\n完成，用时 {status['duration_s']}s -> {STATUS}")
    print(f"密钥 {with_key}/{total_db}，快照 {snapshot_at}，图片 {img_total} 张，摘要 {len(digests)} 份")
    fails = [s["name"] for s in steps if not s["ok"]]
    if fails:
        print(f"失败步骤: {', '.join(fails)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
