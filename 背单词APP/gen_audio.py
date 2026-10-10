# -*- coding: utf-8 -*-
"""
用 edge-tts（微软神经网络音色）给 APP 生成发音音频
--------------------------------------------------
输出到 audio/ 目录：
    w-<词>.mp3           30 个单词（正常速）
    w-<词>-slow.mp3      30 个单词（慢速 0.7X）
    s-<序号>-<n>.mp3     120 个故事句子（正常速）
并生成 audio/manifest.json（文件名清单，供 SW 预缓存）

用法（在 G:\\dsh\\背单词APP 目录下）：
    python gen_audio.py             # 只生成缺失的
    python gen_audio.py --force     # 全部重生成
    python gen_audio.py --word-only # 只生成单词（不含句子）
"""
import asyncio
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, "index.html")
OUT = os.path.join(HERE, "audio")

# 音色与语速：儿童学词，稍慢一点更清楚
VOICE = "en-US-AriaNeural"
RATE = "-15%"
# 慢速档：APP 里「0.7X 慢速」按钮用这一组
RATE_SLOW = "-40%"
PITCH = "+0Hz"

FORCE = "--force" in sys.argv
WORD_ONLY = "--word-only" in sys.argv


def balanced(text, start, open_ch, close_ch):
    """从 start（指向 open_ch）开始按括号配对取出整段，跳过字符串内部"""
    depth = 0
    in_str = False
    esc = False
    i = start
    while i < len(text):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == open_ch:
                depth += 1
            elif c == close_ch:
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]
        i += 1
    raise SystemExit("括号没配对：从 %d 开始" % start)


def read_wordlist():
    """从 index.html 里读出 PLAN 和 STORIES。

    注意：STORIES 是 JS 字面量（键名没引号），不是合法 JSON，
    所以先用 Node 把它抽成 data.json，再读。
    """
    dump_js = os.path.join(HERE, "tools", "dump-data.cjs")
    data_json = os.path.join(HERE, "tools", "data.json")
    if os.path.exists(dump_js):
        import subprocess
        r = subprocess.run(["node", dump_js, HTML, data_json],
                           capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        if r.returncode == 0 and os.path.exists(data_json):
            with io.open(data_json, encoding="utf-8") as f:
                d = json.load(f)
            return d["PLAN"], d["STORIES"]
        sys.stderr.write("Node 抽取失败，回退到内置解析：%s\n" % (r.stderr or "").strip())

    # 回退：内置解析（只在 dump-data.cjs 不可用时用）
    html = io.open(HTML, encoding="utf-8").read()
    key = "var PLAN = "
    i = html.find(key)
    if i < 0:
        raise SystemExit("找不到 PLAN")
    plan = json.loads(balanced(html, html.index("[", i), "[", "]"))
    raise SystemExit("STORIES 不是合法 JSON，请先确保 tools/dump-data.cjs 可用")
    return plan, {}


def jobs_from(plan, stories):
    """产出 (文件名, 要念的文本, 类型)

    类型：word（正常速单词）/ word_slow（慢速单词）/ sentence（故事句子）
    """
    out = []
    for w in plan:
        word = w[0]
        out.append(("w-%s.mp3" % word, word, "word"))
        out.append(("w-%s-slow.mp3" % word, word, "word_slow"))
    if WORD_ONLY:
        return out
    for w in plan:
        word = w[0]
        st = stories.get(word)
        if not st:
            continue
        for i, pair in enumerate(st.get("s", [])):
            key = "s-%s-%d.mp3" % (word, i + 1)
            out.append((key, pair[0], "sentence"))
    return out


async def synth_one(edge_tts, text, path, rate=None):
    """生成单个 mp3；失败重试 3 次"""
    use_rate = rate or RATE
    last = None
    for attempt in range(3):
        try:
            comm = edge_tts.Communicate(text, VOICE, rate=use_rate, pitch=PITCH)
            data = b""
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    data += chunk["data"]
            if not data:
                raise RuntimeError("空音频")
            with open(path, "wb") as f:
                f.write(data)
            return len(data)
        except Exception as e:                     # noqa: BLE001
            last = e
            await asyncio.sleep(1.2 * (attempt + 1))
    raise RuntimeError("生成失败 %s: %s" % (text, last))


async def main():
    import edge_tts

    plan, stories = read_wordlist()
    jobs = jobs_from(plan, stories)
    os.makedirs(OUT, exist_ok=True)

    todo = [j for j in jobs if FORCE or not os.path.exists(os.path.join(OUT, j[0]))]
    print("音色：%s  正常速：%s  慢速：%s" % (VOICE, RATE, RATE_SLOW))
    print("总共 %d 条，需要生成 %d 条" % (len(jobs), len(todo)))
    if not todo:
        print("都是最新的，不用生成。")
    else:
        ok_count, fail = 0, []
        for idx, (name, text, kind) in enumerate(todo, 1):
            path = os.path.join(OUT, name)
            rate = RATE_SLOW if kind == "word_slow" else RATE
            try:
                size = await synth_one(edge_tts, text, path, rate=rate)
                ok_count += 1
                print("  [%d/%d] %-24s %6d bytes  %s" % (idx, len(todo), name, size, text))
            except Exception as e:                 # noqa: BLE001
                fail.append(name)
                print("  [%d/%d] %-24s 失败: %s" % (idx, len(todo), name, e))
            await asyncio.sleep(0.25)              # 温和限速，别把接口打急

        print("\n成功 %d 条，失败 %d 条" % (ok_count, len(fail)))
        if fail:
            print("失败清单：" + ", ".join(fail))

    # 写清单（只列真实存在的文件）
    have = [n for (n, _t, _k) in jobs if os.path.exists(os.path.join(OUT, n))]
    manifest = {
        "voice": VOICE,
        "rate": RATE,
        "rateSlow": RATE_SLOW,
        "words": [n for (n, _t, k) in jobs if k == "word" and n in have],
        "wordsSlow": [n for (n, _t, k) in jobs if k == "word_slow" and n in have],
        "sentences": [n for (n, _t, k) in jobs if k == "sentence" and n in have],
    }
    with io.open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("清单写入 audio/manifest.json：单词 %d 个（慢速 %d 个），句子 %d 句"
          % (len(manifest["words"]), len(manifest["wordsSlow"]), len(manifest["sentences"])))

    total = sum(os.path.getsize(os.path.join(OUT, n)) for n in have)
    print("音频总大小：%.2f MB" % (total / 1024.0 / 1024.0))


if __name__ == "__main__":
    asyncio.run(main())
