"""工作台守护进程：看护服务、退出即重启，并把日志写进文件。

为什么需要它
------------
把服务当成"托管后台任务"跑是不可靠的：运行时会回收任务，
表现就是页面突然 `ERR_CONNECTION_REFUSED`，而且没有任何日志可查
（这次就是这样——任务列表直接空了，服务无声消失）。

所以改成：
  1) 由 explorer 拉起本守护进程，使它**脱离工具 shell 的进程树**，不被回收；
  2) 守护进程负责拉起 workbench_server.py，退出就重启；
  3) 服务与守护的输出统一落到 out/workbench.log，下次出问题有据可查。

用法（一般由 workbench\\run_server.cmd 调用）：
  pythonw workbench_supervisor.py
"""
from __future__ import annotations

import datetime
import json
import os
import subprocess
import urllib.request
import sys
import time

BASE = r"G:\dsh\wechat-digest"
SERVER = os.path.join(BASE, "tools", "workbench_server.py")
LOG = os.path.join(BASE, "out", "workbench.log")
URL_FILE = os.path.join(BASE, "out", "workbench.url")
PY = sys.executable


def log(msg: str) -> None:
    line = f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] [supervisor] {msg}"
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def our_instance_running() -> str:
    """返回在跑的"我们自己"服务的 URL，没有则空串。

    不能用"端口是否被占"判断：实测 8765 会被 DSH 自己的文件服务
    （python.exe / SimpleHTTP/0.6 / 监听 0.0.0.0）占用，误判成自己会让守护进程
    直接退出、真正的服务永远起不来。判据改成：读 out/workbench.url 并探测
    /api/status 能否返回带 state 的 JSON。
    """
    try:
        with open(URL_FILE, encoding="ascii") as fh:
            url = fh.read().strip()
    except OSError:
        return ""
    if not url:
        return ""
    try:
        with urllib.request.urlopen(url.rstrip("/") + "/api/status", timeout=2) as r:
            data = json.loads(r.read().decode("utf-8"))
            return url if isinstance(data, dict) and "state" in data else ""
    except Exception:  # noqa: BLE001
        return ""


def main() -> int:
    running = our_instance_running()
    if running:
        log(f"服务已在 {running} 运行，本守护进程退出（避免重复拉起）")
        return 0

    log(f"守护启动：python={PY}（端口由服务自动挑选，避开被占用的）")
    quick_fails = 0
    while True:
        t0 = time.time()
        try:
            with open(LOG, "a", encoding="utf-8") as lf:
                lf.write(f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] [supervisor] 拉起服务\n")
                lf.flush()
                p = subprocess.Popen([PY, SERVER], stdout=lf, stderr=lf)
            log(f"服务已拉起 pid={p.pid}")
            code = p.wait()
        except Exception as exc:  # noqa: BLE001
            log(f"拉起服务失败: {type(exc).__name__}: {exc}")
            code = -1

        dur = time.time() - t0
        log(f"服务退出 code={code}，存活 {dur:.1f}s")

        # 常见快速退出原因：端口被占（另一个实例已在跑）——那就别硬撑
        if dur < 5:
            quick_fails += 1
            if our_instance_running():
                log("检测到自己已在运行，守护退出")
                return 0
        else:
            quick_fails = 0

        if quick_fails >= 5:
            log("连续快速退出 5 次，疑似依赖缺失或端口冲突，等待 60s 再试")
            time.sleep(60)
            quick_fails = 0
        else:
            time.sleep(5)


if __name__ == "__main__":
    raise SystemExit(main())
