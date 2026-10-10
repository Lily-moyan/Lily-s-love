"""给已有摘要补一条「消息数口径说明」，然后可以跑 build_index.py。

背景：多个子任务都报告"背景给的消息数与导出文本不一致，原因不明"。
根因在导出器——紧凑文本会把同一发送者 5 分钟内的连续发言合并为一条缩进续言行，
另外图片/视频等无正文消息占计数但不成行。这是口径差异，不是数据缺失。
现在导出器已把精确拆分写进文件头，但已生成的摘要需要补一句说明，
避免把"未知缺口"留给读者。

用法： python finalize_digests.py
"""
from __future__ import annotations

import glob
import os

BASE = r"G:\dsh\wechat-digest"
DIGESTS = os.path.join(BASE, "out", "digests")

NOTE = (
    "- **消息数口径已核实（非数据缺失）**：导出文本的「带时间戳发言数」必然小于"
    "「窗口内消息总数」，原因是导出器会把同一发送者 5 分钟内的连续发言合并成一条带缩进的"
    "续言行，且图片/视频等无正文消息占计数但不成行。精确拆分已写进导出文件头部的 "
    "`# 统计口径` 一行，可直接查证。\n"
)


def main() -> int:
    files = sorted(glob.glob(os.path.join(DIGESTS, "*.md")))
    files = [f for f in files if not os.path.basename(f).startswith("_")]
    touched = 0
    for path in files:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        if "消息数口径已核实" in text:
            continue
        if not text.endswith("\n"):
            text += "\n"
        text += NOTE
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        touched += 1
        print(f"  已补充口径说明: {os.path.basename(path)}")
    print(f"共补充 {touched}/{len(files)} 份摘要")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
