"""One-off backfill for paper 2607.17823v1.

Re-extract figures with the new caption-aware vector crop and write the
resulting figures_json + title_plain fields into the existing markdown file.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import paper_figures  # noqa: E402
from title_utils import strip_title_markup  # noqa: E402

ARXIV_ID = "2607.17823v1"
DOCS = ROOT / "docs"
MD_PATH = DOCS / "papers" / "2026" / "07" / "21" / (
    f"{ARXIV_ID}-theoretical-foundations-of-maxk-reinforcement-learning.md"
)
ASSET_DIR = DOCS / "assets" / "figures" / "arxiv" / ARXIV_ID
META_PATH = ASSET_DIR / "meta.json"
PDF_URL = f"https://arxiv.org/pdf/{ARXIV_ID}"


def yaml_escape(s: str) -> str:
    if not s:
        return '""'
    if any(c in s for c in [':', '#', '"', "'", '\n', '[', ']', '{', '}', ',', '&', '*', '!', '|', '>', '%', '@', '`']):
        return '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'
    return s


def main() -> int:
    if not MD_PATH.exists():
        print(f"missing: {MD_PATH}")
        return 1

    tmp = Path(tempfile.mkdtemp(prefix=f"bf-{ARXIV_ID}-"))
    try:
        pdf_path = tmp / "paper.pdf"
        print(f"downloading {PDF_URL}")
        req = urllib.request.Request(PDF_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            pdf_path.write_bytes(r.read())

        backup_dir = tmp / "backup"
        if ASSET_DIR.exists():
            shutil.copytree(ASSET_DIR, backup_dir)
        ASSET_DIR.mkdir(parents=True, exist_ok=True)

        for old in ASSET_DIR.glob("fig-*.webp"):
            old.unlink()
        META_PATH.unlink(missing_ok=True)

        figures = paper_figures.crop_pdf_caption_figures(
            str(pdf_path),
            str(ASSET_DIR),
            f"assets/figures/arxiv/{ARXIV_ID}",
        )
        print(f"cropped {len(figures)} figures")
        for f in figures:
            print(f"  page {f['page']}: {f['caption'][:80]}")

        if not figures:
            print("no figures captured; aborting")
            return 1

        meta = json.loads(META_PATH.read_text(encoding="utf-8"))
        text = MD_PATH.read_text(encoding="utf-8")

        # Insert title_plain / title_zh_plain.
        new_lines: list[str] = []
        for line in text.splitlines(keepends=True):
            new_lines.append(line)
            stripped = line.strip()
            if stripped.startswith("title:") and "title_plain:" not in text:
                m = re.match(r'title:\s*(.*)', stripped)
                if m:
                    raw_title = m.group(1).strip().strip('"').replace('\\"', '"').replace('\\\\', '\\')
                    plain = strip_title_markup(raw_title)
                    if plain and plain != raw_title:
                        new_lines.append(f"title_plain: {yaml_escape(plain)}\n")
            elif stripped.startswith("title_zh:") and "title_zh_plain:" not in text:
                m = re.match(r'title_zh:\s*(.*)', stripped)
                if m:
                    raw_title = m.group(1).strip().strip('"').replace('\\"', '"').replace('\\\\', '\\')
                    plain = strip_title_markup(raw_title)
                    if plain and plain != raw_title:
                        new_lines.append(f"title_zh_plain: {yaml_escape(plain)}\n")
        text = "".join(new_lines)

        figures_json = json.dumps(meta["figures"], ensure_ascii=False)
        escaped = '"' + figures_json.replace("\\", "\\\\").replace('"', '\\"') + '"'
        new_text, count = re.subn(
            r"^figures_json:.*$",
            f"figures_json: {escaped}",
            text,
            count=1,
            flags=re.MULTILINE,
        )
        if count == 0:
            print("no figures_json line found; aborting")
            return 1

        MD_PATH.write_text(new_text, encoding="utf-8")
        print("updated md")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())