# -*- coding: utf-8 -*-
"""Step 3: query the local index (BM25 retrieval with page citations).

Examples:
    python rag.py "OPC 是什么"
    python rag.py "定价 三档报价" -k 3 --full
    python rag.py "CAC LTV 回本周期" --json
    python rag.py --outline            # 全部页标题索引
    python rag.py                      # 交互式检索 (Ctrl-C / 空行退出)
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_index import tokenize  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_INDEX = os.path.join(HERE, "data", "index.json")

K1 = 1.5
B = 0.75
TITLE_BOOST = 2.0


class Retriever:
    def __init__(self, path=DEFAULT_INDEX):
        with open(path, encoding="utf-8") as fh:
            idx = json.load(fh)
        self.chunks = idx["chunks"]
        self.doclen = idx["doclen"]
        self.postings = idx["postings"]
        self.title_tokens = idx["title_tokens"]
        self.meta = idx["meta"]
        self.avgdl = self.meta["avgdl"] or 1.0
        self.N = max(len(self.chunks), 1)

    # ---------- scoring ----------
    def _score(self, q_tokens, use_unigram):
        scores = {}
        for qt in q_tokens:
            if not use_unigram and len(qt) == 1 and "\u4e00" <= qt <= "\u9fff":
                continue
            plist = self.postings.get(qt)
            if not plist:
                continue
            df = len(plist)
            idf = __import__("math").log(1 + (self.N - df + 0.5) / (df + 0.5))
            for cid, tf in plist:
                dl = self.doclen[cid]
                ttf = tf + TITLE_BOOST * self.title_tokens[cid].count(qt)
                denom = ttf + K1 * (1 - B + B * dl / self.avgdl)
                scores[cid] = scores.get(cid, 0.0) + idf * ttf * (K1 + 1) / denom
        return scores

    def search(self, query, k=5):
        q_tokens = tokenize(query)
        if not q_tokens:
            return []
        scores = self._score(q_tokens, use_unigram=False)
        if not scores:
            scores = self._score(q_tokens, use_unigram=True)
        ranked = sorted(scores.items(), key=lambda kv: -kv[1])[:k]
        return [(self.chunks[cid], sc) for cid, sc in ranked]

    # ---------- presentation ----------
    def snippet(self, chunk, query, width=320):
        text = chunk["text"].replace("\n", " ")
        toks = {t for t in tokenize(query) if len(t) > 1}
        if not toks:
            return text[:width]
        best, best_hit = 0, -1
        starts = [min((text.find(t) for t in toks if text.find(t) >= 0), default=-1)]
        starts += [m for t in toks for m in _all_pos(text, t)]
        for p in {s for s in starts if s >= 0}:
            lo = max(0, p - 30)
            window = text[lo:lo + width]
            hit = sum(1 for t in toks if t in window)
            if hit > best_hit:
                best, best_hit = lo, hit
        out = text[best:best + width]
        return ("…" if best > 0 else "") + out + ("…" if best + width < len(text) else "")


def _all_pos(text, sub):
    pos, start = [], 0
    while True:
        i = text.find(sub, start)
        if i < 0:
            return pos
        pos.append(i)
        start = i + 1


def print_hit(rank, chunk, score, retriever, query, full=False, show_doc=False):
    cite = "p.%-3d" % chunk["page"]
    if show_doc and chunk.get("doc"):
        cite = "%s %s" % (_short_doc(chunk["doc"]), cite)
    head = "[%d] %.2f  %s  %s" % (rank, score, cite, chunk["title"])
    body = chunk["text"] if full else retriever.snippet(chunk, query)
    print(head)
    for line in body.splitlines():
        print("     " + line.strip())
    print()


def _short_doc(doc):
    """第202回 deck -> '回202' style short tag from a long file stem."""
    import re
    m = re.search(r"第(\d+)回", doc)
    return "回" + m.group(1) if m else doc[:12]


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("query", nargs="*", help="查询词；留空进入交互模式")
    ap.add_argument("-k", "--top", type=int, default=5)
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    ap.add_argument("--full", action="store_true", help="打印整段文本")
    ap.add_argument("--outline", action="store_true", help="打印全部页标题索引")
    ap.add_argument("--index", default=DEFAULT_INDEX)
    args = ap.parse_args()

    r = Retriever(args.index)
    multi = len(r.meta.get("docs") or []) > 1

    if args.outline:
        seen = set()
        for c in r.chunks:
            key = (c.get("doc", ""), c["page"])
            if key in seen:
                continue
            seen.add(key)
            print("%s p.%-4d %s" % ((c.get("doc", "")[:14] + " ") if multi else "",
                                    c["page"], c["title"]))
        print("\n共 %d 页 / %d 段落（%d 份文档）"
              % (len(seen), len(r.chunks), len(r.meta.get("docs") or [1])))
        return

    def run(q):
        hits = r.search(q, args.top)
        if args.json:
            print(json.dumps(
                [{"doc": c.get("doc", ""), "page": c["page"], "title": c["title"],
                  "score": round(s, 3), "text": c["text"]} for c, s in hits],
                ensure_ascii=False, indent=2))
            return
        if not hits:
            print("(无匹配：换个说法，或先用 --outline 看看目录)\n")
            return
        for i, (c, s) in enumerate(hits, 1):
            print_hit(i, c, s, r, q, full=args.full, show_doc=multi)

    if args.query:
        run(" ".join(args.query))
        return

    print("炒饭会第202回 · OPC 路径选择与启动方式 —— 本地检索 (Ctrl-C 或空行退出)")
    print("索引：%d 段 / %d 页 / %d 份文档\n"
          % (r.meta["chunks"], r.meta["pages"], len(r.meta.get("docs") or [1])))
    while True:
        try:
            q = input("检索> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not q:
            break
        run(q)


if __name__ == "__main__":
    main()
