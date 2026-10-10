# -*- coding: utf-8 -*-
"""Step 1: PDF(s) -> per-page text (JSONL).

Usage:
    python extract.py                          # default: 炒饭会第202回 deck
    python extract.py a.pdf b.pdf              # several decks into one file
    python extract.py --append c.pdf           # add a deck to existing JSONL
    python extract.py --out data/pages.jsonl x.pdf

Each row: {"doc": <file stem>, "page": <1-based>, "text": <page text>}
"""
import argparse
import json
import os
import sys

import fitz  # PyMuPDF

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SRC = [r"G:\AI产品经理\炒饭会\20260923第202回 Opc的路径选择与启动方式.pdf"]
DEFAULT_OUT = os.path.join(HERE, "data", "pages.jsonl")


def extract_one(path, fh):
    """Append every page of one PDF as a JSONL row; return (pages, empty, chars)."""
    doc = fitz.open(path)
    stem = os.path.splitext(os.path.basename(path))[0]
    empty, chars = [], 0
    for i, page in enumerate(doc):
        text = page.get_text("text")
        text = "\n".join(line.rstrip() for line in text.splitlines()).strip()
        if not text:
            empty.append(i + 1)
        chars += len(text)
        fh.write(json.dumps({"doc": stem, "page": i + 1, "text": text},
                            ensure_ascii=False) + "\n")
    return doc.page_count, empty, chars


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sources", nargs="*", default=DEFAULT_SRC)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--append", action="store_true")
    args = ap.parse_args()

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    mode = "a" if args.append else "w"
    total_pages = total_chars = 0
    with open(args.out, mode, encoding="utf-8") as fh:
        for src in args.sources:
            pages, empty, chars = extract_one(src, fh)
            total_pages += pages
            total_chars += chars
            print("%-60s pages=%-4d empty=%-3s chars=%d"
                  % (os.path.basename(src)[:58], pages,
                     len(empty) if empty else 0, chars))
    print("mode        :", "append" if args.append else "overwrite")
    print("pages total :", total_pages)
    print("chars total :", total_chars)
    print("out         :", args.out)


if __name__ == "__main__":
    main()
