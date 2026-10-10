"""把各会话摘要汇总成一份周报索引 + 合并待办清单。

从 out/digests/*.md 里按规范的结构解析出：一句话概览、关键结论数、资源数、
待办条目、统计数据，然后产出 out/digests/_汇总_<起止>.md。

设计取舍：待办是唯一需要"跨会话去重排序"的东西，所以单独拉一张总表；
结论和资源量太大，只保留索引与计数，不重复正文。

用法： python build_index.py
"""
from __future__ import annotations

import glob
import os
import re
from datetime import datetime

BASE = r"G:\dsh\wechat-digest"
DIGESTS = os.path.join(BASE, "out", "digests")


def section(text: str, name: str) -> str:
    """取出 `## name` 到下一个 `## ` 之间的内容。"""
    m = re.search(rf"^##\s*{re.escape(name)}\s*$(.*?)(?=^##\s|\Z)", text, re.S | re.M)
    return m.group(1).strip() if m else ""


def bullet_items(block: str, checkbox_only: bool = False) -> list[str]:
    """取出条目。checkbox_only=True 时只认 `- [ ]` 形式，避免把嵌套的解释性
    子条目（如「  - 依据：…」）当成待办。"""
    out = []
    for line in block.splitlines():
        s = line.strip()
        m = re.match(r"^[-*]\s+\[[ xX]\]\s*(.+)$", s)
        if m:
            out.append(m.group(1).strip())
            continue
        if checkbox_only:
            continue
        m2 = re.match(r"^[-*]\s+(\S.*)$", s)
        if m2:
            out.append(m2.group(1).strip())
    return out


NOOP_PREFIXES = ("无", "依据", "说明", "补充说明", "备注", "n/a", "N/A")


def parse(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    title = ""
    for line in text.splitlines():
        if line.startswith("# "):
            title = line[2:].strip()
            break
    tables = re.findall(r"^\|.*\|$", section(text, "值得看的资源"), re.M)
    res_rows = [t for t in tables if not re.match(r"^\|[\s:|-]+\|$", t)][1:]  # 去掉表头
    stats = section(text, "数据统计")
    # 各份摘要的措辞不统一（"我发言 7 条" / "我发出 2 条" / "我发言数：0"），
    # 原来只认后两种，导致周静那份 7 条被显示成 0。
    mine = ""
    m = re.search(r"我(?:发出|发言数|发言)[^\d]{0,6}(\d+)", stats)
    if m:
        mine = m.group(1)
    msgs = ""
    m = re.search(r"消息数[^\d]*(\d+)", stats)
    if m:
        msgs = m.group(1)
    todos = bullet_items(section(text, "待我处理"), checkbox_only=True)
    todos = [t for t in todos if t.strip() and not t.strip().startswith(NOOP_PREFIXES)]
    overview = section(text, "一句话概览").replace("\n", " ").strip()
    conclusions = bullet_items(section(text, "关键结论"))
    return {
        "path": path,
        "title": title,
        "overview": overview,
        "conclusions": len(conclusions),
        "resources": len(res_rows),
        "todos": todos,
        "my_msgs": mine,
        "msgs": msgs,
        "images": len(section(text, "图片内容补充")),
    }


def main() -> int:
    files = sorted(glob.glob(os.path.join(DIGESTS, "*.md")))
    files = [f for f in files if not os.path.basename(f).startswith("_")]
    if not files:
        print("out/digests 下没有摘要文件")
        return 1

    items = [parse(f) for f in files]
    items.sort(key=lambda r: (-len(r["todos"]), -r["conclusions"]))

    total_todos = sum(len(r["todos"]) for r in items)
    total_conc = sum(r["conclusions"] for r in items)
    total_res = sum(r["resources"] for r in items)
    today = datetime.now().strftime("%Y-%m-%d")
    out_path = os.path.join(DIGESTS, f"_汇总_{today}.md")

    lines = [
        f"# 聊天重点汇总 · 生成于 {today}",
        "",
        "> 数据快照截止 **2026-10-09 10:59**。之后的聊天需重跑备份+解密才能纳入。",
        f"> 覆盖 {len(items)} 个会话，合计 {total_conc} 条关键结论、{total_res} 条资源、"
        f"**{total_todos} 条待办**。",
        "",
        "## 一、待我处理（跨会话合并）",
        "",
    ]
    if total_todos == 0:
        lines.append("全部会话均无待我处理的事项。")
    else:
        lines.append("| # | 事项 | 来源会话 |")
        lines.append("|---|---|---|")
        idx = 0
        for r in items:
            for todo in r["todos"]:
                idx += 1
                clean = todo.replace("|", "\\|")
                lines.append(f"| {idx} | {clean} | {r['title'].split(' 摘要')[0]} |")
    lines += ["", "## 二、会话索引", "", "| 会话 | 消息数 | 我发言 | 关键结论 | 资源 | 待办 |", "|---|---|---|---|---|---|"]
    for r in items:
        name = r["title"].split(" 摘要")[0]
        lines.append(
            f"| [{name}]({os.path.basename(r['path'])}) | {r['msgs'] or '-'} | "
            f"{r['my_msgs'] or '0'} | {r['conclusions']} | {r['resources']} | {len(r['todos'])} |"
        )
    lines += ["", "## 三、各会话概览", ""]
    for r in items:
        name = r["title"].split(" 摘要")[0]
        lines.append(f"### {name}")
        lines.append("")
        lines.append(r["overview"] or "（无概览）")
        lines.append("")
        lines.append(f"详见 `{os.path.basename(r['path'])}`")
        lines.append("")

    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    # 汇总文件名带日期，每天都会生成新的一份。不清理的话工作台里会堆出一串同名索引，
    # 让人分不清哪份是最新（todos 接口虽然取的是最新那份，但界面会显示多个）。
    for old_path in glob.glob(os.path.join(DIGESTS, "_汇总_*.md")):
        if os.path.abspath(old_path) != os.path.abspath(out_path):
            try:
                os.remove(old_path)
                print(f"  已清理旧汇总: {os.path.basename(old_path)}")
            except OSError as exc:
                print(f"  旧汇总删除失败 {old_path}: {exc}")

    print(f"汇总 {len(items)} 个会话 -> {out_path}")
    print(f"  关键结论 {total_conc} 条，资源 {total_res} 条，待办 {total_todos} 条")
    print()
    print(f"{'会话':<34}{'消息':>6}{'我发':>6}{'结论':>6}{'资源':>6}{'待办':>6}")
    print("-" * 68)
    for r in items:
        print(
            f"{r['title'].split(' 摘要')[0][:32]:<34}{r['msgs'] or '-':>6}{r['my_msgs'] or '0':>6}"
            f"{r['conclusions']:>6}{r['resources']:>6}{len(r['todos']):>6}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
