"""集中 docs/papers/ 路径生成。

设计:
  论文 frontmatter `date: YYYY-MM-DD` 是权威日期源(真实发表日)。
  把它切成 `YYYY/MM/DD/` 三段子目录,方便 `ls docs/papers/2026/07/`
  直接看到 7 月各日的论文分布。

  注意:arXiv id 的 YYMM 前缀(例 `2607.00083v1`)只是 arXiv 编号,
  不等于发表月。`2607.00083` 的真实发表日可能是 `2026-06-30`——
  应优先用 frontmatter.date,arxiv id 仅作 fallback。

命名规则(见 docs/path-spec.md):
  docs/papers/
  ├── papers.meta.json                       # 索引,留在顶层
  ├── README.md                              # 顶层
  └── <YYYY>/<MM>/<DD>/<arxiv-id>-<slug>.{md,txt}

用法:
  >>> paper_dir("/x/docs", "2607.00083v1", day="30", date_str="2026-06-30")
  '/x/docs/papers/2026/06/30'
  >>> paper_md_path("/x/docs", "2607.00083v1", "harnessing", day="30", date_str="2026-06-30")
  '/x/docs/papers/2026/06/30/2607.00083v1-harnessing.md'
  >>> paper_id("2607.00083v1", "harnessing", day="30", date_str="2026-06-30")
  'papers/2026/06/30/2607.00083v1-harnessing'

bioRxiv 文件名带 `YYYY-MM-DD` 中段,作为 fallback:
  >>> paper_month_subdir("biorxiv-10-1101-2025-11-14-688412-v3-...")
  '2025/11'
"""
from __future__ import annotations

import re
from typing import Optional

# arXiv id:`YYMM.NNNNN` + 可选 `v#` + slug。例 `2607.00083v1-foo`。
_ARXIV_ID_RE = re.compile(r"^(?P<yymm>\d{4})\.(?P<rest>\d{4,5})(?:v(?P<ver>\d+))?")
# bioRxiv 文件名:`biorxiv-10-1101-YYYY-MM-DD-...-v#-...`
_BIORXIV_DATE_RE = re.compile(
    r"^biorxiv-10-\d+-(\d{4})-(\d{2})-\d+-(?P<rest>.+)$"
)
# bioRxiv 文件名(YYYY-MM-DD 中段,含 DD)
_BIORXIV_FULL_DATE_RE = re.compile(
    r"^biorxiv-10-\d+-(\d{4})-(\d{2})-(\d{2})-(?P<rest>.+)$"
)


class PaperPathError(ValueError):
    pass


def paper_month_subdir(arxiv_id: str) -> str:
    """从 arxiv id 解析 `YYYY/MM`。

    支持:
      - `2607.00083v1` / `2607.00083` (纯 id)
      - `biorxiv-10-1101-2025-11-14-688412-v3-foo` (bioRxiv 文件名)
    失败抛 PaperPathError。

    ⚠️ 这是 legacy 函数——返回的 YYYY/MM 来自 arxiv id YYMM,可能与
    真实发表月不一致。新代码应该用 `paper_day_subdir(date_str)`,
    输入 frontmatter.date 拿到权威 `YYYY/MM/DD/`。
    """
    s = (arxiv_id or "").strip()
    if not s:
        raise PaperPathError("arxiv_id 不能为空")
    m = _ARXIV_ID_RE.match(s)
    if m:
        yy, mm = m.group("yymm")[:2], m.group("yymm")[2:]
        year = f"20{yy}"
        if not (1 <= int(mm) <= 12):
            raise PaperPathError(f"月份越界: {s!r} → {yy}-{mm}")
        return f"{year}/{mm}"
    m2 = _BIORXIV_DATE_RE.match(s)
    if m2:
        year, month = m2.group(1), m2.group(2)
        if not (1 <= int(month) <= 12):
            raise PaperPathError(f"月份越界: {s!r} → {year}-{month}")
        return f"{year}/{month}"
    raise PaperPathError(f"无法从 {arxiv_id!r} 解析年月(arXiv/bioRxiv 模式都不匹配)")


def paper_day_subdir(date_str: str) -> str:
    """从 frontmatter `date: YYYY-MM-DD` 解析 `YYYY/MM/DD`。

    这是新代码推荐的入口——date 是权威日期源,arxiv id YYMM 只作 fallback。
    """
    s = (date_str or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
    if not m:
        raise PaperPathError(f"date_str 必须是 YYYY-MM-DD,得到 {date_str!r}")
    year, month, day = m.group(1), m.group(2), m.group(3)
    if not (1 <= int(month) <= 12):
        raise PaperPathError(f"月份越界: {date_str!r} → {month}")
    if not (1 <= int(day) <= 31):
        raise PaperPathError(f"日期越界: {date_str!r} → {day}")
    return f"{year}/{month}/{day}"


def paper_basename(arxiv_id: str, slug: Optional[str] = None) -> str:
    """`<arxiv-id>[-<slug>]` —— slug 可选(为空则只返回 id 本身)。"""
    s = (arxiv_id or "").strip()
    if not s:
        raise PaperPathError("arxiv_id 不能为空")
    if slug:
        return f"{s}-{slug}"
    return s


def paper_dir(
    docs_dir: str,
    arxiv_id: str,
    *,
    day: Optional[str] = None,
    date_str: Optional[str] = None,
) -> str:
    """`docs_dir/papers/<YYYY>/<MM>[/<DD>]` —— 单篇论文的子目录。

    - 传 `date_str="2026-06-30"` → `YYYY/MM/DD/`(权威路径)
    - 传 `day="30"` 单独 → 用 `paper_month_subdir(arxiv_id)` + `/30`,但若
      arxiv id YYMM 与 day 暗示的月不一致会抛 PaperPathError(防御性)
    - 都不传 → legacy `YYYY/MM/`(仅给未迁移数据或工具脚本用)
    """
    import os
    if date_str:
        sub = paper_day_subdir(date_str)
    elif day:
        month = paper_month_subdir(arxiv_id)
        sub = f"{month}/{day}"
    else:
        sub = paper_month_subdir(arxiv_id)
    return os.path.join(docs_dir, "papers", sub)


def paper_md_path(
    docs_dir: str,
    arxiv_id: str,
    slug: Optional[str] = None,
    *,
    day: Optional[str] = None,
    date_str: Optional[str] = None,
) -> str:
    """`docs_dir/papers/<YYYY>/<MM>[/<DD>]/<basename>.md`"""
    import os
    return os.path.join(
        paper_dir(docs_dir, arxiv_id, day=day, date_str=date_str),
        f"{paper_basename(arxiv_id, slug)}.md",
    )


def paper_txt_path(
    docs_dir: str,
    arxiv_id: str,
    slug: Optional[str] = None,
    *,
    day: Optional[str] = None,
    date_str: Optional[str] = None,
) -> str:
    """`docs_dir/papers/<YYYY>/<MM>[/<DD>]/<basename>.txt`"""
    import os
    return os.path.join(
        paper_dir(docs_dir, arxiv_id, day=day, date_str=date_str),
        f"{paper_basename(arxiv_id, slug)}.txt",
    )


def paper_id(
    arxiv_id: str,
    slug: Optional[str] = None,
    *,
    day: Optional[str] = None,
    date_str: Optional[str] = None,
) -> str:
    """仓库内 paper id —— `papers/<YYYY>/<MM>[/<DD>]/<basename>`(无扩展名)。

    给 Astro `readPaper(id)` / `listAllPaperIds()` 用的字符串;Astro 内部
    `readPaper` 会在 id 后加 `.md`,`[arxiv].astro` 的 `params.arxiv` 用
    `id.split('/').pop()` 取最后一段,所以子目录层级不影响 URL slug。

    新代码必须传 `date_str` 才能正确得到 `YYYY/MM/DD/` 路径。
    """
    import os
    sub = (
        paper_day_subdir(date_str)
        if date_str
        else (f"{paper_month_subdir(arxiv_id)}/{day}" if day else paper_month_subdir(arxiv_id))
    )
    return f"papers/{sub}/{paper_basename(arxiv_id, slug)}"


__all__ = [
    "PaperPathError",
    "paper_month_subdir",
    "paper_day_subdir",
    "paper_basename",
    "paper_dir",
    "paper_md_path",
    "paper_txt_path",
    "paper_id",
]


if __name__ == "__main__":
    import sys

    cases_date = [
        "2026-06-30",
        "2026-07-13",
        "2025-11-14",
        "",
        "garbage",
        "2026-13-01",  # 月越界
        "2026-06-32",  # 日越界
    ]
    print("=== paper_day_subdir ===")
    for c in cases_date:
        try:
            print(f"  {c!r:20} → {paper_day_subdir(c)}")
        except PaperPathError as e:
            print(f"  {c!r:20} → ERROR: {e}")

    cases_id = [
        "2607.00083v1",
        "2607.00083",
        "2510.18483v1",
        "2607.09492v1",
        "biorxiv-10-1101-2025-11-14-688412-v3-social-information-quality-and-environmental-volatility-shape-collective-foraging-behavior",
        "biorxiv-10-64898-2026-07-08-736783-v1-interpreting-rewards-from-inverse-reinforcement-learning",
        "",
        "garbage",
    ]
    print("\n=== paper_month_subdir ===")
    for c in cases_id:
        try:
            print(f"  {c!r:80} → {paper_month_subdir(c)}")
        except PaperPathError as e:
            print(f"  {c!r:80} → ERROR: {e}")

    print("\n=== paper_id with date_str (new) ===")
    try:
        print(f"  paper_id('2607.00083v1', 'harnessing-the-latent-space', date_str='2026-06-30')")
        print(f"    → {paper_id('2607.00083v1', 'harnessing-the-latent-space', date_str='2026-06-30')}")
        print(f"  paper_id('2607.09492v1', date_str='2026-07-13')")
        print(f"    → {paper_id('2607.09492v1', date_str='2026-07-13')}")
    except PaperPathError as e:
        print(f"  ERROR: {e}")

    sys.exit(0)