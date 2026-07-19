#!/usr/bin/env python
"""维护入口：检测 docs/papers/ 下论文是否落后于 arXiv 最新版本，并自动重生成。

设计（扁平 docs/papers/ 结构，见 docs/path-spec.md）:
  1. 扫描 docs/papers/*.md，解析每篇的 arXiv id + 版本号 + section(deep/quick)。
  2. 按 canonical id（去掉 v\\d+$）分组；对每个 canonical id 查询 arXiv API 取最新版本。
  3. 若磁盘版本 < arXiv 最新版本 → stale：
       - 子进程调用 `python src/6.generate_docs.py --paper-id <最新id> --paper-section <deep|quick>`
         （quick 追加 --glance-only），复用既有单篇生成逻辑写出新版本 .md/.txt/figures。
       - 删除旧版本的 .md / .txt 与旧的 figure 资源目录。
  4. arxiv-index.json 由 workflow 里的 `node astro-src/scripts/build-arxiv-index.mjs` 重建。

为什么不 import src/6.generate_docs.py：该模块在 import 期就会初始化 LLM 客户端，
且文件名以数字开头无法常规 import。用 subprocess 调用它的 --paper-id 单篇模式，
与 src/main.py 调 Step6 的方式完全一致，隔离干净、复用经过验证的生成路径。

用法:
  python src/maintain/refresh_versions.py --dry-run
  python src/maintain/refresh_versions.py --limit 5
  python src/maintain/refresh_versions.py --only-id 2606.29340
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import requests

MAINTAIN_DIR = os.path.dirname(__file__)
SRC_DIR = os.path.abspath(os.path.join(MAINTAIN_DIR, ".."))
ROOT_DIR = os.path.abspath(os.path.join(SRC_DIR, ".."))
GENERATE_DOCS = os.path.join(SRC_DIR, "6.generate_docs.py")

# arXiv 论文文件名: <id><vN>-<slug>.md，id 形如 2606.29340 / 1706.03762。
# 仅匹配 arXiv 风格 id（YYMM.NNNNN）；biorxiv/medrxiv 等其它源用不同 id 方案，跳过。
ARXIV_FILE_RE = re.compile(r"^(?P<canonical>\d{4}\.\d{4,5})v(?P<ver>\d+)-(?P<slug>.+)$")
DEEP_MARKER = "## 论文详细总结（自动生成）"
GLANCE_MARKERS = ("## 速览", "## TLDR")
ARXIV_API = "https://export.arxiv.org/api/query?id_list={ids}"
ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}


def log(message: str) -> None:
    print(f"[refresh-versions] {message}", flush=True)


@dataclass
class LocalPaper:
    canonical: str          # 2606.29340
    version: int            # 1
    versioned_id: str       # 2606.29340v1
    slug: str               # phf-privileged-hidden-flow-...
    basename: str           # 2606.29340v1-phf-...
    section: str            # "deep" | "quick"
    md_path: str
    txt_path: str


def detect_section(md_path: str) -> str:
    """区分 deep(精读)/quick(速读/glance)以决定重生成深度。

    判定优先级（高→低，命中即返回）：
      1. 含 `## 论文详细总结（自动生成）` → 精读已生成，确为 deep
      2. 含 `## 速览` / `## TLDR` → 速读/glance，确为 quick
      3. 以上都没有的"残缺笔记"（历史上只有摘要、详细总结生成失败）：
         默认 deep，避免被降级为 glance-only 而丢失精读意图
    宁可过度保守（误把 quick 当 deep 重新精读一次）也不可降级丢失精读内容。
    """
    try:
        with open(md_path, "r", encoding="utf-8") as f:
            content = f.read()
    except OSError:
        return "deep"

    if DEEP_MARKER in content:
        return "deep"
    if any(m in content for m in GLANCE_MARKERS):
        return "quick"
    return "deep"


def scan_local_papers(papers_dir: str) -> List[LocalPaper]:
    """递归枚举 docs/papers/<YYYY>/<MM>/ 下所有 arXiv 论文笔记。"""
    out: List[LocalPaper] = []
    if not os.path.isdir(papers_dir):
        return out
    # docs/papers/ 现在按 docs/papers/<YYYY>/<MM>/ 分桶,递归收 .md。
    # papers.meta.json / README.md 等顶层非论文文件靠 stem 不是 ARXIV 模式跳过。
    for root, _dirs, files in os.walk(papers_dir):
        for name in sorted(files):
            if not name.endswith(".md") or name == "README.md":
                continue
            stem = name[: -len(".md")]
            m = ARXIV_FILE_RE.match(stem)
            if not m:
                continue
            md_path = os.path.join(root, name)
            out.append(
                LocalPaper(
                    canonical=m.group("canonical"),
                    version=int(m.group("ver")),
                    versioned_id=f"{m.group('canonical')}v{m.group('ver')}",
                    slug=m.group("slug"),
                    basename=stem,
                    section=detect_section(md_path),
                    md_path=md_path,
                    txt_path=os.path.join(root, f"{stem}.txt"),
                )
            )
    return out


def dedupe_local_by_canonical(papers: List[LocalPaper]) -> Dict[str, LocalPaper]:
    """同一 canonical id 若磁盘上有多个版本，保留最高版本作为对比基准。"""
    best: Dict[str, LocalPaper] = {}
    for p in papers:
        cur = best.get(p.canonical)
        if cur is None or p.version > cur.version:
            best[p.canonical] = p
    return best


def fetch_latest_version(canonical_id: str, timeout: int = 30) -> Optional[int]:
    """查询 arXiv API 取该 canonical id 的最新版本号。

    用 canonical id（无 vN）查询时，atom:id 会返回最新版本，形如
    http://arxiv.org/abs/2606.29340v2 → 返回 2。解析失败返回 None（跳过，不误删）。
    """
    url = ARXIV_API.format(ids=canonical_id)
    try:
        resp = requests.get(url, timeout=timeout)
    except requests.RequestException as exc:
        log(f"[WARN] 查询失败 {canonical_id}: {exc}")
        return None
    if resp.status_code != 200:
        log(f"[WARN] arXiv API status={resp.status_code} for {canonical_id}")
        return None
    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError as exc:
        log(f"[WARN] XML 解析失败 {canonical_id}: {exc}")
        return None
    entry = root.find("atom:entry", ATOM_NS)
    if entry is None:
        return None
    id_elem = entry.find("atom:id", ATOM_NS)
    raw = (id_elem.text or "").strip() if id_elem is not None else ""
    m = re.search(r"v(\d+)\s*$", raw.rsplit("/", 1)[-1])
    return int(m.group(1)) if m else None


def figure_dir_for(docs_dir: str, versioned_id: str) -> str:
    return os.path.join(docs_dir, "assets", "figures", "arxiv", versioned_id)


def regenerate_paper(latest_id: str, section: str, dry_run: bool) -> bool:
    """子进程调用 Step6 单篇模式生成新版本笔记。返回是否成功。"""
    cmd = [
        sys.executable,
        GENERATE_DOCS,
        "--paper-id",
        latest_id,
        "--paper-section",
        section,
        "--force-glance",
    ]
    if section == "quick":
        cmd.append("--glance-only")
    log(f"{'[DRY] ' if dry_run else ''}regenerate {latest_id} (section={section})")
    if dry_run:
        return True
    env = {**os.environ, "PYTHONPATH": ROOT_DIR + os.pathsep + os.environ.get("PYTHONPATH", "")}
    result = subprocess.run(cmd, cwd=ROOT_DIR, env=env)
    if result.returncode != 0:
        log(f"[ERROR] 生成失败 {latest_id}, returncode={result.returncode}")
        return False
    return True


def _rel(path: str) -> str:
    """相对仓库根的展示路径；跨盘符（Windows）时回退到绝对路径。"""
    try:
        return os.path.relpath(path, ROOT_DIR)
    except ValueError:
        return path


def prune_old_version(docs_dir: str, old: LocalPaper, dry_run: bool) -> None:
    """删除旧版本的 .md/.txt 与旧 figure 资源目录。"""
    targets = [old.md_path, old.txt_path, figure_dir_for(docs_dir, old.versioned_id)]
    for path in targets:
        if not os.path.exists(path):
            continue
        log(f"{'[DRY] ' if dry_run else ''}prune {_rel(path)}")
        if dry_run:
            continue
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        else:
            try:
                os.remove(path)
            except OSError as exc:
                log(f"[WARN] 删除失败 {path}: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="检测并刷新 docs/papers/ 中落后于 arXiv 最新版本的论文笔记。"
    )
    parser.add_argument("--docs-dir", default=os.path.join(ROOT_DIR, "docs"), help="docs 根目录。")
    parser.add_argument("--dry-run", action="store_true", help="只报告，不生成/不删除。")
    parser.add_argument("--limit", type=int, default=0, help="本次最多刷新的论文数（0=不限）。")
    parser.add_argument("--only-id", default="", help="仅检查指定 canonical id（如 2606.29340）。")
    parser.add_argument(
        "--section-filter", choices=["deep", "quick"], default="", help="仅刷新该 section。"
    )
    parser.add_argument("--sleep", type=float, default=3.0, help="每次 arXiv 查询间隔秒数（礼貌限速）。")
    args = parser.parse_args()

    docs_dir = os.path.abspath(args.docs_dir)
    papers_dir = os.path.join(docs_dir, "papers")

    local = scan_local_papers(papers_dir)
    latest_by_canonical = dedupe_local_by_canonical(local)

    only = args.only_id.strip().lower()
    canonicals = sorted(latest_by_canonical.keys())
    if only:
        canonicals = [c for c in canonicals if c == only]
    if args.section_filter:
        canonicals = [c for c in canonicals if latest_by_canonical[c].section == args.section_filter]

    log(f"扫描 {len(local)} 篇笔记，{len(latest_by_canonical)} 个 canonical id，待检查 {len(canonicals)} 个。")

    stale: List[Tuple[LocalPaper, int]] = []
    for i, canonical in enumerate(canonicals):
        cur = latest_by_canonical[canonical]
        latest = fetch_latest_version(canonical)
        if latest is None:
            continue
        if latest > cur.version:
            log(f"STALE {canonical}: 磁盘 v{cur.version} < arXiv v{latest} (section={cur.section})")
            stale.append((cur, latest))
        if args.sleep > 0 and i < len(canonicals) - 1:
            time.sleep(args.sleep)

    if not stale:
        log("没有发现落后版本，无需刷新。")
        return

    if args.limit and args.limit > 0:
        stale = stale[: args.limit]
        log(f"应用 --limit {args.limit}，本次刷新 {len(stale)} 篇。")

    refreshed = 0
    for old, latest in stale:
        latest_id = f"{old.canonical}v{latest}"
        if regenerate_paper(latest_id, old.section, args.dry_run):
            prune_old_version(docs_dir, old, args.dry_run)
            refreshed += 1

    log(f"{'[DRY] ' if args.dry_run else ''}完成：刷新 {refreshed}/{len(stale)} 篇。")


if __name__ == "__main__":
    main()
