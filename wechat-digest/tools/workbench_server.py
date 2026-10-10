"""微信聊天重点工作台 —— 本地只读网页服务。

设计原则：
  - **展示层不碰数据库**：只读 out/status.json 与 out/digests/*.md，数据由
    refresh_pipeline.py 负责生成。这样页面永远秒开，且不会因为查询搞坏数据。
  - 只绑 127.0.0.1，仅本机可访问；所有文件访问都做路径与扩展名白名单校验。
  - 每小时自动触发一次数据刷新（后台线程），同时页面自身每小时重新拉数据。
    注意：刷新的是**数据**；**摘要**需要 LLM，无法无人化，工作台会标出过期摘要。

用法： python workbench_server.py [--port 8765] [--no-pipeline]
"""
from __future__ import annotations

import glob
import json
import os
import re
import socket
import subprocess
import urllib.request
import sys
import threading
import time
import urllib.parse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = r"G:\dsh\wechat-digest"
OUT = os.path.join(BASE, "out")
DIGESTS = os.path.join(OUT, "digests")
IMAGES = os.path.join(OUT, "images")
STATUS = os.path.join(OUT, "status.json")
PAGE = os.path.join(BASE, "workbench", "index.html")
PIPELINE = os.path.join(BASE, "tools", "refresh_pipeline.py")
LOG = os.path.join(OUT, "workbench.log")
URL_FILE = os.path.join(OUT, "workbench.url")

# 不要用 8765：实测它会被 DSH 自己的文件服务（进程外 python.exe，
# Server: SimpleHTTP/0.6，监听 0.0.0.0）抢占。一旦被抢，我们的 POST /api/refresh
# 会返回 501，前端就报"触发失败"。所以默认从下面这些端口里挑。
PORT_CANDIDATES = [18765, 18766, 18767, 18888]
PY = sys.executable


def append_log(msg: str) -> None:
    """统一日志：服务与守护进程都写同一个文件，出问题时有据可查。"""
    try:
        os.makedirs(OUT, exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] [server] {msg}\n")
    except OSError:
        pass

REFRESH_SECONDS = 3600  # 每小时
ALLOWED_IMG = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

STATE = {
    "last_pipeline_start": None,
    "last_pipeline_end": None,
    "last_pipeline_ok": None,
    "last_pipeline_note": "",
    "next_pipeline_at": None,
    "refreshing": False,
}
STATE_LOCK = threading.Lock()


def run_pipeline(do_images: bool = True) -> None:
    """在后台线程里跑数据管线；不阻塞任何 HTTP 请求。"""
    with STATE_LOCK:
        if STATE["refreshing"]:
            return
        STATE["refreshing"] = True
        STATE["last_pipeline_start"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    args = [PY, PIPELINE] + (["--images"] if do_images else [])
    try:
        p = subprocess.run(args, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=3600)
        ok = p.returncode == 0
        tail = "\n".join([ln for ln in (p.stdout or "").strip().splitlines() if ln.strip()][-6:])
    except Exception as exc:  # noqa: BLE001
        ok, tail = False, f"{type(exc).__name__}: {exc}"
    with STATE_LOCK:
        STATE["refreshing"] = False
        STATE["last_pipeline_end"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        STATE["last_pipeline_ok"] = ok
        STATE["last_pipeline_note"] = tail[-600:]
        STATE["next_pipeline_at"] = datetime.fromtimestamp(
            time.time() + REFRESH_SECONDS
        ).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[pipeline] ok={ok} at {STATE['last_pipeline_end']}")


def pipeline_loop(do_images: bool) -> None:
    # 冷启动：status.json 不存在或已超过 30 分钟才立刻跑一次，
    # 否则等一个完整周期 —— 避免刚手动刷新过又重复跑一遍。
    fresh = False
    if os.path.exists(STATUS):
        fresh = (time.time() - os.path.getmtime(STATUS)) < 1800
    if not fresh:
        run_pipeline(do_images)
    with STATE_LOCK:
        STATE["next_pipeline_at"] = datetime.fromtimestamp(
            time.time() + REFRESH_SECONDS
        ).strftime("%Y-%m-%d %H:%M:%S")
    while True:
        time.sleep(REFRESH_SECONDS)
        run_pipeline(do_images)


def safe_child(root: str, rel: str) -> str | None:
    """把 rel 限制在 root 之内，防目录穿越。"""
    rel = urllib.parse.unquote(rel).replace("\\", "/").lstrip("/")
    if ".." in rel.split("/"):
        return None
    full = os.path.normpath(os.path.join(root, rel))
    if not full.startswith(os.path.normpath(root) + os.sep):
        return None
    return full if os.path.isfile(full) else None


def parse_todos() -> list[dict]:
    """从最新的汇总文件里抽出「待我处理」总表。

    注意：条目文本里的竖线在生成时被转义成 `\\|`，所以不能简单 split("|")，
    否则会把带竖线的事项拆断。
    """
    files = sorted(glob.glob(os.path.join(DIGESTS, "_汇总_*.md")))
    if not files:
        return []
    with open(files[-1], encoding="utf-8") as fh:
        text = fh.read()
    m = re.search(r"^##\s*一、待我处理.*?$(.*?)(?=^##\s|\Z)", text, re.S | re.M)
    block = m.group(1) if m else ""
    items = []
    for line in block.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in re.split(r"(?<!\\)\|", s.strip("|"))]
        if len(cells) < 3:
            continue
        # 只认编号为数字的行：# 列是序号。这样表头（#）与分隔行（---）都会被跳过。
        if not cells[0].isdigit():
            continue
        items.append({"text": cells[1].replace("\\|", "|"), "conv": cells[2]})
    return items


class Handler(BaseHTTPRequestHandler):
    server_version = "WeChatDigestWorkbench/1.0"

    def log_message(self, fmt, *args):  # 静音访问日志，避免刷屏
        pass

    def handle_error(self, request, client_address):
        """单个请求出错不能拖垮服务，但要留下痕迹。

        典型来源：浏览器中途取消请求（BrokenPipe）——以前是静默吞掉，
        出问题时完全没线索。
        """
        import traceback

        append_log(f"请求异常 {client_address}: {traceback.format_exc()[-500:]}")

    def _json(self, obj, code: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _text(self, text: str, ctype: str = "text/plain; charset=utf-8", code: int = 200) -> None:
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path in ("/", "/index.html"):
            if os.path.exists(PAGE):
                with open(PAGE, encoding="utf-8") as fh:
                    self._text(fh.read(), "text/html; charset=utf-8")
            else:
                self._text("<h1>workbench/index.html 缺失</h1>", "text/html; charset=utf-8", 500)
            return

        if path == "/api/status":
            payload = {"state": dict(STATE), "refresh_seconds": REFRESH_SECONDS}
            if os.path.exists(STATUS):
                try:
                    with open(STATUS, encoding="utf-8") as fh:
                        payload["data"] = json.load(fh)
                except json.JSONDecodeError as exc:
                    payload["error"] = f"status.json 解析失败: {exc}"
            else:
                payload["error"] = "尚无 status.json，请先执行一次数据刷新"
            self._json(payload)
            return

        if path == "/api/todos":
            items = parse_todos()
            self._json({"items": items, "count": len(items)})
            return

        if path == "/api/digests":
            items = []
            for p in sorted(glob.glob(os.path.join(DIGESTS, "*.md"))):
                name = os.path.basename(p)
                items.append({
                    "file": name,
                    "index": name.startswith("_"),
                    "mtime": datetime.fromtimestamp(os.path.getmtime(p)).strftime("%Y-%m-%d %H:%M"),
                    "size": os.path.getsize(p),
                })
            self._json({"items": items})
            return

        if path == "/api/digest":
            f = (qs.get("file") or [""])[0]
            full = safe_child(DIGESTS, f)
            if not full or not full.endswith(".md"):
                self._json({"error": "非法文件"}, 400)
                return
            with open(full, encoding="utf-8") as fh:
                self._text(fh.read(), "text/markdown; charset=utf-8")
            return

        if path == "/api/images":
            conv = (qs.get("conv") or [""])[0]
            groups = []
            roots = [os.path.join(IMAGES, conv)] if conv else sorted(glob.glob(os.path.join(IMAGES, "*")))
            for root in roots:
                if not os.path.isdir(root):
                    continue
                files = []
                for p in glob.glob(os.path.join(root, "**", "*"), recursive=True):
                    if os.path.isfile(p) and os.path.splitext(p)[1].lower() in ALLOWED_IMG:
                        files.append({
                            "rel": os.path.relpath(p, root).replace("\\", "/"),
                            "name": os.path.basename(p),
                            "size": os.path.getsize(p),
                            "mtime": datetime.fromtimestamp(os.path.getmtime(p)).strftime("%Y-%m-%d %H:%M"),
                        })
                files.sort(key=lambda x: x["mtime"], reverse=True)
                if files:
                    groups.append({"dir": os.path.basename(root), "count": len(files), "files": files[:200]})
            groups.sort(key=lambda g: -g["count"])
            self._json({"groups": groups[:40]})
            return

        if path.startswith("/img/"):
            rest = path[len("/img/"):]
            parts = rest.split("/", 1)
            if len(parts) != 2:
                self._json({"error": "非法路径"}, 400)
                return
            full = safe_child(os.path.join(IMAGES, parts[0]), parts[1])
            if not full or os.path.splitext(full)[1].lower() not in ALLOWED_IMG:
                self._json({"error": "非法图片"}, 400)
                return
            ext = os.path.splitext(full)[1].lower()
            ctype = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                     "gif": "image/gif", "webp": "image/webp"}[ext.lstrip(".")]
            with open(full, "rb") as fh:
                body = fh.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "max-age=300")
            self.end_headers()
            self.wfile.write(body)
            return

        self._json({"error": "未知路径"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/refresh":
            with STATE_LOCK:
                busy = STATE["refreshing"]
            if busy:
                self._json({"ok": False, "note": "刷新正在进行中"})
                return
            threading.Thread(target=run_pipeline, kwargs={"do_images": True}, daemon=True).start()
            self._json({"ok": True, "note": "已在后台开始刷新"})
            return
        self._json({"error": "未知路径"}, 404)


def port_free(port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.8)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def probe_ours(port: int) -> bool:
    """端口上跑的是不是我们自己：探测 /api/status 能否返回带 state 的 JSON。

    这一步很关键——只判断"端口是否被占"会把别人的服务误当成自己，
    于是 POST 打到别人身上变成 501。
    """
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status", timeout=2) as r:
            data = json.loads(r.read().decode("utf-8"))
            return isinstance(data, dict) and "state" in data
    except Exception:  # noqa: BLE001
        return False


def pick_port(explicit: int | None) -> int:
    if explicit:
        return explicit
    for p in PORT_CANDIDATES:
        if port_free(p):
            return p
        if probe_ours(p):
            return p
    return PORT_CANDIDATES[0]


def bootstrap_state() -> None:
    """启动时从已有的 status.json 恢复管线状态。

    否则当 status.json 还新鲜、管线线程按设计先等待一个周期时，
    界面上会显示"未运行"，让人误以为刷新没生效。
    """
    if not os.path.exists(STATUS):
        return
    try:
        with open(STATUS, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return
    ok = all(s.get("ok") for s in data.get("steps", [])) if data.get("steps") else None
    with STATE_LOCK:
        STATE["last_pipeline_end"] = data.get("generated_at")
        STATE["last_pipeline_ok"] = ok
        STATE["last_pipeline_note"] = "由上一次数据刷新写入（服务启动时恢复）"
        STATE["next_pipeline_at"] = datetime.fromtimestamp(
            time.time() + REFRESH_SECONDS
        ).strftime("%Y-%m-%d %H:%M:%S")


def main(argv: list[str]) -> int:
    no_pipeline = "--no-pipeline" in argv
    explicit = int(argv[argv.index("--port") + 1]) if "--port" in argv else None
    port = pick_port(explicit)
    if port != (explicit or 0):
        occupied = [p for p in PORT_CANDIDATES if p != port and not port_free(p)]
        if occupied:
            append_log(f"端口 {occupied} 已被其他程序占用，改用 {port}")
            print(f"注意: 端口 {occupied} 已被占用，改用 {port}")

    bootstrap_state()
    if not no_pipeline:
        threading.Thread(target=pipeline_loop, args=(True,), daemon=True).start()

    try:
        srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as exc:
        append_log(f"绑定 127.0.0.1:{port} 失败: {exc}")
        print(f"绑定失败: {exc}")
        return 2
    url = f"http://127.0.0.1:{port}/"
    try:
        with open(URL_FILE, "w", encoding="ascii") as fh:
            fh.write(url)
    except OSError as exc:
        append_log(f"写入 {URL_FILE} 失败: {exc}")
    append_log(f"服务启动 {url} 刷新间隔={REFRESH_SECONDS}s")
    print(f"工作台已启动: {url}")
    print(f"数据刷新间隔: {REFRESH_SECONDS}s（{'已启用' if not no_pipeline else '已禁用'}）")
    print(f"实际地址已写入: {URL_FILE}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("停止")
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
