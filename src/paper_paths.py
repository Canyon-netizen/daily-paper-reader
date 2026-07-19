"""集中 docs/papers/ 路径生成。

设计:
  论文 arxiv id 的 YYMM 前缀天然带年月信息(例 `2606.18483v1` → 2026-06,
  `2510.18483v1` → 2025-10)。把它直接转成 `YYYY/MM/` 子目录,方便 `ls docs/papers/`
  一眼看清最近哪些月份有数据。

命名规则(见 docs/path-spec.md):
  docs/papers/
  ├── papers.meta.json                       # 索引,留在顶层
  ├── README.md                              # 顶层
  └── <YYYY>/<MM>/<arxiv-id>-<slug>.{md,txt}

用法:
  >>> paper_dir("/x/docs", "2606.18483v1")
  '/x/docs/papers/2026/06'
  >>> paper_md_path("/x/docs", "2606.18483v1", "multimodal-reward-hacking")
  '/x/docs/papers/2026/06/2606.18483v1-multimodal-reward-hacking.md'
  >>> paper_id("2606.18483v1", "foo-bar")
  'papers/2026/06/2606.18483v1-foo-bar'

bioRxiv / chemRxiv 等其他源文件名带 `YYYY-MM-DD` 中段,模式不一样:
  >>> paper_month_subdir("biorxiv-10-1101-2025-11-14-688412-v3-...")
  '2025/11'
"""
from __future__ import annotations

import re
from typing import Optional

# arXiv id:`YYMM.NNNNN` + 可选 `v#` + slug。例 `2606.18483v1-foo`。
_ARXIV_ID_RE = re.compile(r"^(?P<yymm>\d{4})\.(?P<rest>\d{4,5})(?:v(?P<ver>\d+))?")
# bioRxiv 文件名:`biorxiv-10-1101-YYYY-MM-DD-...-v#-...`
_BIORXIV_DATE_RE = re.compile(
    r"^biorxiv-10-\d+-(\d{4})-(\d{2})-\d+-(?P<rest>.+)$"
)


class PaperPathError(ValueError):
    pass


def paper_month_subdir(arxiv_id: str) -> str:
    """从 arxiv id 解析 `YYYY/MM`。

    支持:
      - `2606.18483v1` / `2606.18483` (纯 id)
      - `biorxiv-10-1101-2025-11-14-688412-v3-foo` (bioRxiv 文件名)
    失败抛 PaperPathError。
    """
    s = (arxiv_id or "").strip()
    if not s:
        raise PaperPathError("arxiv_id 不能为空")
    # arXiv
    m = _ARXIV_ID_RE.match(s)
    if m:
        yy, mm = m.group("yymm")[:2], m.group("yymm")[2:]
        year = f"20{yy}"
        if not (1 <= int(mm) <= 12):
            raise PaperPathError(f"月份越界: {s!r} → {yy}-{mm}")
        return f"{year}/{mm}"
    # bioRxiv
    m2 = _BIORXIV_DATE_RE.match(s)
    if m2:
        year, month = m2.group(1), m2.group(2)
        if not (1 <= int(month) <= 12):
            raise PaperPathError(f"月份越界: {s!r} → {year}-{month}")
        return f"{year}/{month}"
    raise PaperPathError(f"无法从 {arxiv_id!r} 解析年月(arXiv/bioRxiv 模式都不匹配)")


def paper_basename(arxiv_id: str, slug: Optional[str] = None) -> str:
    """`<arxiv-id>[-<slug>]` —— slug 可选(为空则只返回 id 本身)。"""
    s = (arxiv_id or "").strip()
    if not s:
        raise PaperPathError("arxiv_id 不能为空")
    if slug:
        return f"{s}-{slug}"
    return s


def paper_dir(docs_dir: str, arxiv_id: str) -> str:
    """`docs_dir/papers/<YYYY>/<MM>` —— 单篇论文的子目录。"""
    import os
    return os.path.join(docs_dir, "papers", paper_month_subdir(arxiv_id))


def paper_md_path(docs_dir: str, arxiv_id: str, slug: Optional[str] = None) -> str:
    """`docs_dir/papers/<YYYY>/<MM>/<basename>.md`"""
    import os
    return os.path.join(paper_dir(docs_dir, arxiv_id), f"{paper_basename(arxiv_id, slug)}.md")


def paper_txt_path(docs_dir: str, arxiv_id: str, slug: Optional[str] = None) -> str:
    """`docs_dir/papers/<YYYY>/<MM>/<basename>.txt`"""
    import os
    return os.path.join(paper_dir(docs_dir, arxiv_id), f"{paper_basename(arxiv_id, slug)}.txt")


def paper_id(arxiv_id: str, slug: Optional[str] = None) -> str:
    """仓库内 paper id —— `papers/<YYYY>/<MM>/<basename>`(无扩展名)。

    给 Astro `readPaper(id)` / `listAllPaperIds()` 用的字符串;Astro 内部
    `readPaper` 会在 id 后加 `.md`,`[arxiv].astro` 的 `params.arxiv` 用
    `id.split('/').pop()` 取最后一段,所以子目录层级不影响 URL slug。
    """
    return f"papers/{paper_month_subdir(arxiv_id)}/{paper_basename(arxiv_id, slug)}"


__all__ = [
    "PaperPathError",
    "paper_month_subdir",
    "paper_basename",
    "paper_dir",
    "paper_md_path",
    "paper_txt_path",
    "paper_id",
]


if __name__ == "__main__":
    import sys

    cases = [
        "2606.18483v1",
        "2606.18483",
        "2510.18483v1",
        "2607.09492v1",
        "biorxiv-10-1101-2025-11-14-688412-v3-social-information-quality-and-environmental-volatility-shape-collective-foraging-behavior",
        "biorxiv-10-64898-2026-07-08-736783-v1-interpreting-rewards-from-inverse-reinforcement-learning",
        "",
        "garbage",
    ]
    for c in cases:
        try:
            print(f"{c!r:80} → {paper_month_subdir(c)}")
        except PaperPathError as e:
            print(f"{c!r:80} → ERROR: {e}")
        sys.exit(0)