#!/usr/bin/env python3
"""重新生成 LFS 缺失内容的 .txt PDF 文本缓存。"""
from __future__ import annotations
import os, re, sys, time, urllib.request, urllib.error
import xml.etree.ElementTree as ET
from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
import fitz

LIST_FILE = "/tmp/lfs-pointer-files.txt"
ARXIV_ID_RE = re.compile(r"(\d{4}\.\d{4,5}(v\d+)?)")
NS = {"atom": "http://www.w3.org/2005/Atom"}
TIMEOUT = 90
RETRIES = 3

def fetch(url: str) -> Optional[bytes]:
    for attempt in range(1, RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.read()
        except Exception as e:
            print(f"  retry {attempt}/{RETRIES} {url}: {e}", file=sys.stderr, flush=True)
            time.sleep(5 * attempt)
    return None

def fetch_arxiv_meta(arxiv_id: str) -> dict:
    api = f"https://export.arxiv.org/api/query?id_list={arxiv_id}"
    txt = fetch(api)
    if not txt:
        return {}
    try:
        root = ET.fromstring(txt)
        e = root.find("atom:entry", NS)
        if e is None:
            return {}
        return {
            "title": " ".join((e.find("atom:title", NS).text or "").split()),
            "published": (e.find("atom:published", NS).text or "").strip(),
        }
    except Exception:
        return {}

def extract_text(pdf: bytes) -> tuple:
    doc = fitz.open(stream=pdf, filetype="pdf")
    n = doc.page_count
    parts = []
    try:
        for page in doc:
            parts.append(page.get_text("text"))
    finally:
        doc.close()
    return "\n\n".join(parts), n

def render_txt(arxiv_id, title, published, n, body):
    return (
        f"Title: {title or arxiv_id}\n\n"
        f"URL Source: https://arxiv.org/pdf/{arxiv_id}\n\n"
        f"Published Time: {published or 'unknown'}\n\n"
        f"Number of Pages: {n}\n\n"
        f"Markdown Content:\n{body.strip()}\n"
    )

def process(path: str) -> str:
    name = os.path.basename(path)
    m = ARXIV_ID_RE.search(name)
    if not m:
        return f"SKIP (no arxiv id): {path}"
    arxiv_id = m.group(1)
    pdf_url = f"https://arxiv.org/pdf/{arxiv_id}"
    pdf = fetch(pdf_url)
    if not pdf or pdf[:4] != b"%PDF":
        return f"FAIL (no pdf): {path}"
    try:
        body, n = extract_text(pdf)
    except Exception as e:
        return f"FAIL (pymupdf: {e}): {path}"
    meta = fetch_arxiv_meta(arxiv_id)
    rendered = render_txt(arxiv_id, meta.get("title", arxiv_id), meta.get("published", ""), n, body)
    with open(path, "w", encoding="utf-8") as f:
        f.write(rendered)
    return f"OK (pymupdf): {path} ({len(rendered)} bytes)"

def main():
    with open(LIST_FILE) as f:
        paths = [l.strip() for l in f if l.strip()]
    print(f"regenerating {len(paths)} .txt files", flush=True)
    ok = fail = 0
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(process, p): p for p in paths}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                r = fut.result()
            except Exception as e:
                r = f"EXCEPTION: {e}"
            print(f"[{i}/{len(paths)}] {r}", flush=True)
            if r.startswith("OK"):
                ok += 1
            else:
                fail += 1
    print(f"\ndone: {ok} ok, {fail} fail", flush=True)

if __name__ == "__main__":
    main()