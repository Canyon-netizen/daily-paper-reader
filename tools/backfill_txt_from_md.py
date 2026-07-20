"""
backfill_txt_from_md.py
=======================
为 docs/papers/**/*.md 回填缺失的同名 .txt(从 arXiv PDF 抽取的正文全文)。

背景:
- .md 旁应有同 basename 的 .txt,供 paper-chat 全文模式做 LLM 上下文 / RAG。
  正常 daily pipeline 在 6.generate_docs.py::process_paper 里调 ensure_text_content()
  生成 .txt。但 backfill_md_from_txt.py 等"只补 md"的脚本 / 中断的 pipeline
  只写了 .md,导致 .txt 永久缺失,前端只能退化到 ar5iv/PDF 网络兜底(慢、易失败)。
- 另有一类:同目录已有正文 .txt,但它的 slug 与 .md 不同(md 是 bare-id,txt 是
  slug 形式)。前端按 {md-basename}.txt 找不到 → 同样算"缺失"。这类直接改名复用。

命名契约(必须遵守):
- readFulltextInline(id)(astro-src/pages/papers/[arxiv].astro)读 docs/{id}.txt,
  id = .md 的完整仓库路径 basename;#paper-chat 的 data-txt-name 也是 `{basename}.txt`。
  所以 .txt 文件名必须与 .md **basename 完全一致**(含 slug)。这里直接把 .md 后缀
  换成 .txt,天然满足。

数据源(复用 6.generate_docs.py 的逻辑,避免分叉):
- fetch_paper_markdown_via_jina(pdf_url) → 失败回退 extract_pdf_text(下载 PDF + PyMuPDF)。

调用:
    python tools/backfill_txt_from_md.py --audit      # 只报告缺失,不抓取,缺失>0 时非零退出
    python tools/backfill_txt_from_md.py --dry-run     # 列出待补目标,不抓取
    python tools/backfill_txt_from_md.py               # 抓取并写盘
    python tools/backfill_txt_from_md.py --date 2026-07-17  # 限定 frontmatter date
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path
from typing import Callable, List, Optional

ROOT_DIR = Path(__file__).resolve().parent.parent
DOCS_PAPERS = ROOT_DIR / "docs" / "papers"
GEN_DOCS_PY = ROOT_DIR / "src" / "6.generate_docs.py"

# 抽取文本至少这么长才写盘 —— 对齐前端 loadLocalTxt / SSR inline 的 sanity 阈值,
# 避免写出 404 HTML / 空内容的假 .txt。
MIN_TXT_BYTES = 1000

_PDF_RE = re.compile(r"^pdf:\s*['\"]?(\S+?)['\"]?\s*$", re.M)
# arXiv id(含版本)前缀,用于在同目录找"内容相同、slug 不同"的兄弟 .txt。
_ARXIV_ID_RE = re.compile(r"^(\d{4}\.\d{4,5}v\d+)")


# ---------------------------------------------------------------------------
# 复用 6.generate_docs.py 的抓取逻辑(模块名以数字开头,无法直接 import,动态加载)
# ---------------------------------------------------------------------------
_gen_mod = None


def _load_gen_docs():
    """动态加载 src/6.generate_docs.py,返回其 module 对象(单次缓存)。"""
    global _gen_mod
    if _gen_mod is not None:
        return _gen_mod
    # 保证 `import src.xxx` 与 `from llm import ...`(6.generate_docs.py 顶部)都能解析:
    #   - ROOT_DIR 让 `import src.*` 生效
    #   - ROOT_DIR/src 让脚本按"以自身目录为 sys.path[0]"运行时的裸 import(llm 等)生效
    for p in (str(ROOT_DIR), str(ROOT_DIR / "src")):
        if p not in sys.path:
            sys.path.insert(0, p)
    spec = importlib.util.spec_from_file_location("_gen_docs_dyn", GEN_DOCS_PY)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 {GEN_DOCS_PY}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    _gen_mod = mod
    return mod


def fetch_fulltext(pdf_url: str) -> str:
    """复用 fetch_paper_markdown_via_jina → extract_pdf_text 的兜底链,返回正文文本。

    失败(网络 / PDF 不可达 / 抽取为空)返回 ""。
    """
    if not pdf_url:
        return ""
    mod = _load_gen_docs()
    text = mod.fetch_paper_markdown_via_jina(pdf_url)
    if text:
        return text
    # Jina 失败(限流 / 空)→ 下载 PDF + PyMuPDF 抽取
    import tempfile
    import requests  # 已装,6.generate_docs.py 也依赖

    try:
        resp = requests.get(pdf_url, timeout=60)
        resp.raise_for_status()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_pdf:
            tmp_pdf.write(resp.content)
            tmp_pdf.flush()
            tmp_path = tmp_pdf.name
        try:
            return mod.extract_pdf_text(tmp_path) or ""
        finally:
            try:
                Path(tmp_path).unlink()
            except Exception:
                pass
    except Exception as e:
        print(f"      [PDF] 抓取失败:{e}", flush=True)
        return ""


# ---------------------------------------------------------------------------
# 扫描 / 匹配
# ---------------------------------------------------------------------------
def txt_path_for_md(md_path: Path) -> Path:
    """.md → 同目录、同 basename 的 .txt(满足命名契约)。"""
    return md_path.with_suffix(".txt")


def read_pdf_url(md_path: Path) -> Optional[str]:
    """从 .md frontmatter 读 pdf: URL。"""
    try:
        head = md_path.read_text(encoding="utf-8", errors="replace")[:2000]
    except Exception:
        return None
    m = _PDF_RE.search(head)
    return m.group(1).strip() if m else None


def _canonical_id(name: str) -> Optional[str]:
    """从文件名 stem 取 arXiv id(含版本),取不到返回 None。"""
    m = _ARXIV_ID_RE.match(name)
    return m.group(1) if m else None


def find_sibling_txt(md_path: Path) -> Optional[Path]:
    """在同目录找"同 arXiv id、但 slug 不同"的兄弟 .txt。

    根因:backfill_md_from_txt.py 写 bare-id 的 .md,而更早的真实 pipeline 写了
    slug 形式的 .txt —— 前端按 {md-basename}.txt 找不到。这种情况直接把已有
    正文改名成 .md 的 basename 即可复用(内容更全,免二次抓取)。
    """
    cid = _canonical_id(md_path.stem)
    if not cid:
        return None
    for t in md_path.parent.glob("*.txt"):
        if t.stem == md_path.stem:
            continue  # 精确同名已在 ensure 前判过
        if _canonical_id(t.stem) == cid:
            return t
    return None


def find_missing(date_filter: Optional[str] = None) -> List[Path]:
    """返回所有缺同名 .txt 的 .md 路径列表。

    date_filter: YYYY-MM-DD,按 frontmatter `date:` 过滤(可选)。
    """
    missing: List[Path] = []
    for md in sorted(DOCS_PAPERS.rglob("*.md")):
        if md.name == "README.md":
            continue
        if txt_path_for_md(md).exists():
            continue
        if date_filter:
            head = md.read_text(encoding="utf-8", errors="replace")[:2000]
            dm = re.search(r"^date:\s*['\"]?(\d{4}-\d{2}-\d{2})", head, re.M)
            if not dm or dm.group(1) != date_filter:
                continue
        missing.append(md)
    return missing


# ---------------------------------------------------------------------------
# 单篇回填 —— 供其它脚本 import 的单一事实源
# ---------------------------------------------------------------------------
def ensure_txt_for_md(md_path: Path, *, log: Callable[[str], None] = print) -> bool:
    """确保 md_path 有同名 .txt。已存在 → True(no-op)。

    修复顺序:
      1. 同目录有"同 arXiv id、slug 不同"的兄弟 .txt → 直接改名复用(内容更全,免抓取)。
      2. 否则从 frontmatter pdf: 抓正文,长度 > MIN_TXT_BYTES 才写盘。
    抓取失败 / 太短 → 不写盘,返回 False。幂等,可反复调用。
    """
    md_path = Path(md_path)
    txt_path = txt_path_for_md(md_path)
    if txt_path.exists():
        return True

    # 1) 复用同 id 的兄弟 .txt(改名到 .md 的 basename)
    sib = find_sibling_txt(md_path)
    if sib is not None and sib.stat().st_size > MIN_TXT_BYTES:
        sib.rename(txt_path)
        log(f"      [rename] {sib.name} → {txt_path.name}")
        return True

    # 2) 抓取
    pdf_url = read_pdf_url(md_path)
    if not pdf_url:
        log(f"      [skip] {md_path.name} 无 pdf: URL")
        return False
    text = fetch_fulltext(pdf_url)
    if len(text) <= MIN_TXT_BYTES:
        log(f"      [fail] {md_path.name} 抽取文本过短({len(text)}B),不写盘")
        return False
    txt_path.parent.mkdir(parents=True, exist_ok=True)
    txt_path.write_text(text, encoding="utf-8")
    log(f"      [write] {txt_path.relative_to(ROOT_DIR)} ({len(text)}B)")
    return True


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description="回填 docs/papers 缺失的 .txt")
    ap.add_argument("--audit", action="store_true", help="只报告缺失数,不抓取;缺失>0 时非零退出")
    ap.add_argument("--dry-run", action="store_true", help="列出待补目标但不抓取")
    ap.add_argument("--date", help="按 frontmatter date 过滤 (YYYY-MM-DD)")
    args = ap.parse_args()

    missing = find_missing(args.date)

    if args.audit:
        print(f"[audit] 缺失同名 .txt 的 .md:{len(missing)} 篇")
        for md in missing:
            print(f"  - {md.relative_to(ROOT_DIR)}")
        return 1 if missing else 0

    if not missing:
        print("[backfill] 无缺失,全部 .md 都有同名 .txt ✔")
        return 0

    print(f"[backfill] 待补 {len(missing)} 篇")
    if args.dry_run:
        for md in missing:
            print(f"  - {md.relative_to(ROOT_DIR)}  (pdf={read_pdf_url(md)})")
        return 0

    ok, fail = 0, 0
    failed: List[Path] = []
    for i, md in enumerate(missing, 1):
        print(f"[{i}/{len(missing)}] {md.name}", flush=True)
        if ensure_txt_for_md(md):
            ok += 1
        else:
            fail += 1
            failed.append(md)

    print(f"\n[backfill] 完成:成功 {ok},失败 {fail}")
    if failed:
        print("[backfill] 失败(PDF 不可达 / 无 pdf 字段,请手动核查):")
        for md in failed:
            print(f"  - {md.relative_to(ROOT_DIR)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
