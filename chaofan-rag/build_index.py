# -*- coding: utf-8 -*-
"""Step 2: pages.jsonl -> chunked BM25 index (index.json).

Chunking unit is the slide (one page = one semantic unit); long pages are
split. Tokenisation for Chinese uses character bigrams (plus single CJK
chars kept as a low-priority fallback), ASCII words are kept whole.

Usage:
    python build_index.py            # data/pages.jsonl -> data/index.json
    python build_index.py --stats
"""
import argparse
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PAGES = os.path.join(HERE, "data", "pages.jsonl")
DEFAULT_INDEX = os.path.join(HERE, "data", "index.json")

CJK = r"\u4e00-\u9fff\u3400-\u4dbf"
BULLET = re.compile(
    r"^\s*(?:[•·▪◦‣∙*]|[-–—]\s|\(?\d{1,2}[\.\)、]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]|[a-dA-D][\.\)、])"
)
TOKEN_RE = re.compile(r"[a-zA-Z0-9]+(?:[\.\-_/][a-zA-Z0-9]+)*|[" + CJK + r"]+")

# deck chrome that repeats on nearly every slide
BOILER_WORDS = ("炒饭会", "课伴", "BDS", "bds", "Bds")
NOISE_ONLY = set("炒饭会BDS bds课伴")


def strip_chrome(line):
    """Remove repeating header chrome; return '' if nothing meaningful left."""
    s = line
    for w in BOILER_WORDS:
        s = s.replace(w, " ")
    s = s.strip()
    if not s or set(s) <= NOISE_ONLY:
        return ""
    return s

MAX_CHARS = 420      # split pages longer than this
SPLIT_CHARS = 360
OVERLAP = 60


def is_cjk(ch):
    return "\u4e00" <= ch <= "\u9fff" or "\u3400" <= ch <= "\u4dbf"


def clean_page(raw):
    """Rejoin layout line breaks while preserving bullet structure."""
    out = []
    for raw_line in raw.splitlines():
        line = strip_chrome(raw_line.strip())
        if not line:
            continue
        if not out:
            out.append(line)
            continue
        if BULLET.match(line):
            out.append("\n" + line)
            continue
        prev = out[-1].rstrip()
        if prev and is_cjk(prev[-1]) and is_cjk(line[0]):
            out.append(line)
        else:
            out.append(" " + line)
    text = "".join(out)
    text = re.sub(r"[ \t\u00a0]{2,}", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    # layout often leaves a space between two CJK glyphs of the same word
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r"([" + CJK + r"])[ \t]+([" + CJK + r"])", r"\1\2", text)
    return text.strip()


def page_title(text):
    """First meaningful line, skipping deck boilerplate headers."""
    for line in text.splitlines():
        s = strip_chrome(line.strip())
        if s and len(s) > 1:
            return s[:60]
    return text[:60]


def is_noise(text):
    t = re.sub(r"[\s\n]+", "", text)
    return len(t) < 8


def chunk_page(page, text):
    """Return list of chunk dicts for one page."""
    if len(text) <= MAX_CHARS:
        return [text]
    pieces, start = [], 0
    while start < len(text):
        end = min(start + SPLIT_CHARS, len(text))
        if end < len(text):
            # prefer to cut at punctuation
            window = text[start:end]
            cut = max(window.rfind(c) for c in "。！？；\n")
            if cut > SPLIT_CHARS * 0.5:
                end = start + cut + 1
        pieces.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - OVERLAP, start + 1)
    return [p for p in pieces if p]


def tokenize(text):
    """CJK bigrams + single CJK chars + ASCII words."""
    toks = []
    for m in TOKEN_RE.finditer(text.lower()):
        t = m.group(0)
        if is_cjk(t[0]):
            if len(t) == 1:
                toks.append(t)
            else:
                toks.extend(t[i:i + 2] for i in range(len(t) - 1))
                toks.extend(t)  # single chars: fallback recall
        else:
            toks.append(t)
    return toks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", default=DEFAULT_PAGES)
    ap.add_argument("--out", default=DEFAULT_INDEX)
    ap.add_argument("--stats", action="store_true")
    args = ap.parse_args()

    rows = []
    with open(args.pages, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))

    chunks = []
    for row in rows:
        text = clean_page(row["text"])
        if is_noise(text):
            continue
        title = page_title(text)
        doc = row.get("doc", "")
        for piece in chunk_page(row["page"], text):
            chunks.append({
                "id": len(chunks),
                "doc": doc,
                "page": row["page"],
                "title": title,
                "text": piece,
            })

    postings = {}
    doclen = []
    title_tokens = []
    for ch in chunks:
        toks = tokenize(ch["text"])
        doclen.append(len(toks))
        tf = {}
        for t in toks:
            tf[t] = tf.get(t, 0) + 1
        for t, n in tf.items():
            postings.setdefault(t, []).append([ch["id"], n])
        title_tokens.append(tokenize(ch["title"]))

    index = {
        "meta": {
            "source": os.path.basename(args.pages),
            "docs": sorted({c["doc"] for c in chunks if c["doc"]}),
            "chunks": len(chunks),
            "pages": len(rows),
            "avgdl": (sum(doclen) / len(doclen)) if doclen else 0.0,
            "tokens": sum(doclen),
            "terms": len(postings),
        },
        "chunks": chunks,
        "doclen": doclen,
        "title_tokens": title_tokens,
        "postings": postings,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(args.out) / 1024.0
    print("chunks   :", len(chunks), "from", len(rows), "pages")
    print("tokens   :", index["meta"]["tokens"], "avgdl",
          round(index["meta"]["avgdl"], 1))
    print("terms    :", len(postings))
    print("index    :", args.out, "(%.0f KB)" % size)
    if args.stats:
        pages = sorted({c["page"] for c in chunks})
        print("pages indexed:", pages[0], "-", pages[-1], "count", len(pages))


if __name__ == "__main__":
    main()
