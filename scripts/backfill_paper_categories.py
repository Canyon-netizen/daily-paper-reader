#!/usr/bin/env python3
"""Backfill `categories:` 4-dim block into docs/papers/*.md frontmatter.

Why this exists
---------------
在 [[B1]]–[[B5]] 改造后,paper frontmatter 用 `categories: {venue, task, method, type}`
取代旧的 `tags: [query:<label>, ...]`。但 docs/papers/*.md 里全是历史 paper,
还没人会自动迁移它们 — 这就是 backfill 的责任。

不做
----
- 不调用任何外部网络服务 — venue 从 source 重推,task 从 ALIAS_OLD_TAG_TO_TASK
  字典直迁;method/type 与缺 task 的 paper 留空 (4-dim 缺值由前端
  paper.ts::backfillVenueDim 兜底 + paper-analyzer 浏览器工具的 LLM 二次
  精读 才会填上)。

做
----
- venues:从 source 推 (走 src/venue_extract.extract_venue);
- task:从旧 tags: ['query:rl', 'query:reasoning', ...] 走 src/taxonomy
  的 ALIAS_OLD_TAG_TO_TASK (lowercase keys) 直迁;
- method:从 ALIAS_OLD_TAG_TO_METHOD 直迁 (只有 self-distillation);
- type + 缺值:留空,不动;
- 把 frontmatter 中 `tags:` 行直接删除,新增 `categories:` 单行 flow-style 块,
  与 src/taxonomy.categories_to_yaml_inline 输出一致。

Usage
-----
    python scripts/backfill_paper_categories.py --dry-run --only 2606.15576
    python scripts/backfill_paper_categories.py --delay-ms 500
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

# 直接以模块名 import (避免依赖 src 包内部 __init__ 链)。
import taxonomy as _taxonomy_mod  # type: ignore[import-not-found]  # noqa: E402
import venue_extract as _venue_mod  # type: ignore[import-not-found]  # noqa: E402

ALIAS_OLD_TAG_TO_TASK = _taxonomy_mod.ALIAS_OLD_TAG_TO_TASK
ALIAS_OLD_TAG_TO_METHOD = _taxonomy_mod.ALIAS_OLD_TAG_TO_METHOD
categories_to_yaml_inline = _taxonomy_mod.categories_to_yaml_inline
TASK_ALLOWLIST = _taxonomy_mod.TASK_ALLOWLIST
METHOD_ALLOWLIST = _taxonomy_mod.METHOD_ALLOWLIST
venue_label_list = _venue_mod.venue_label_list

DOCS_DIR = ROOT / "docs" / "papers"

FRONTMATTER_RE = re.compile(
    r"^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$", re.MULTILINE
)
TAGS_LINE_RE = re.compile(r"^(\s*)tags:\s*\[[^\]]*\]\s*$", re.MULTILINE)


def parse_frontmatter(text: str) -> tuple[dict, str] | None:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return None
    try:
        data = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        return None
    return data, m.group(2)


def derive_categories(data: dict) -> dict[str, list[str]] | None:
    """基于 source + 旧 tags 推 4-dim categories。
    返回 None 表示什么都没有可写(已迁移或没历史可推)。"""
    # 若已存在,skip — 让 backfill 幂等。
    if isinstance(data.get("categories"), dict) and any(
        data["categories"].get(dim)
        for dim in ("venue", "task", "method", "type")
    ):
        return None

    venue = venue_label_list(data.get("source"))
    task: list[str] = []
    method: list[str] = []
    type_dim: list[str] = []

    raw_tags = data.get("tags")
    if isinstance(raw_tags, str):
        inner = raw_tags.strip()
        if inner.startswith("[") and inner.endswith("]"):
            inner = inner[1:-1]
        tag_items = [t.strip().strip('"\'') for t in inner.split(",") if t.strip()]
    elif isinstance(raw_tags, list):
        tag_items = [str(t).strip() for t in raw_tags if str(t).strip()]
    else:
        tag_items = []

    for tag in tag_items:
        # 旧 kind:label 形态(distribution / 'query:rl' / 'keyword:foo')
        kind, _, label = tag.partition(":")
        kind = kind.strip().lower()
        label = label.strip().lower()
        if not label:
            continue
        # 先 map method (priority),不要在 task 里重复 (self distillation 既是 task 又是 method)。
        if label in ALIAS_OLD_TAG_TO_METHOD or kind == "method":
            mapped = ALIAS_OLD_TAG_TO_METHOD.get(label)
            if mapped and mapped not in method:
                method.append(mapped)
            continue
        # task 直迁
        mapped = ALIAS_OLD_TAG_TO_TASK.get(label)
        if mapped and mapped not in task:
            task.append(mapped)
            continue
        # kind=kebab-case 候选池字符保留 (e.g. old 'rl' as 'paper:rl'):仍按 raw 试 task 白名单
        raw = label
        # 试图原样 lowercase 进入白名单 (避免 ALIAS_OLD_TAG_TO_TASK 未覆盖的项被静默丢失)
        if raw in TASK_ALLOWLIST and raw not in task:
            task.append(raw)
            continue
        if raw in METHOD_ALLOWLIST and raw not in method:
            method.append(raw)
            continue

    cats = {
        "venue": venue,
        "task": task,
        "method": method,
        "type": type_dim,
    }
    return cats if any(cats.values()) else None


def render_categories(cats: dict[str, list[str]]) -> str:
    return f"categories: {categories_to_yaml_inline(cats)}"


def insert_categories_block(text: str, cats: dict[str, list[str]]) -> str:
    """在原 `tags:` 行位置替换 — `tags:` 删除,`categories:` 插入。
    若原 MD 没有 `tags:` 行,则插到 `pdf:` 后 / `date:` 前(对齐 build_markdown_content
    顺序)。
    """
    new_line = render_categories(cats)
    # 1) 找到 `tags: [...]` 行替换 (CRLF 与 LF 都考虑)
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    inserted = False
    for line in lines:
        stripped = line.strip()
        if TAGS_LINE_RE.match(stripped):
            # 删除旧 tags 行,改写 categories — 用原有缩进。
            indent = TAGS_LINE_RE.match(stripped).group(1)  # type: ignore[union-attr]
            trailing = "\n" if line.endswith("\n") else ""
            out.append(f"{indent}{new_line}{trailing}")
            inserted = True
            continue
        out.append(line)
    if not inserted:
        # 找不到 `tags:` — 插到 `pdf:` 行后 / `score:` 前(若都没有,append 到尾部 --- 之前)。
        out2: list[str] = []
        for line in out:
            out2.append(line)
            stripped = line.lstrip()
            if not inserted and stripped.startswith("pdf:"):
                trailing = "\n" if line.endswith("\n") else ""
                indent = line[: len(line) - len(line.lstrip())]
                out2[-1] = line  # 保留 pdf 行不变
                # 注意这里得插 new_line 在 pdf 行 *后*。
                out2.append(f"{indent}{new_line}{trailing}")
                inserted = True
        out = out2
        if not inserted:
            # 退化:append 到 frontmatter 末尾 (--- 之前)
            for i in range(len(out) - 1, -1, -1):
                if out[i].strip() == "---":
                    indent = out[i][:-3] if out[i].endswith("---") else ""
                    eol = "\n" if not out[i].endswith("\n") else ""
                    out.insert(i, f"{indent}{new_line}{eol}")
                    inserted = True
                    break
    return "".join(out)


def process_file(path: Path, dry_run: bool) -> tuple[bool, str]:
    text = path.read_text(encoding="utf-8")
    parsed = parse_frontmatter(text)
    if parsed is None:
        return False, "no-frontmatter"
    data, _body = parsed
    cats = derive_categories(data)
    if cats is None:
        return False, "no-change-needed"

    new_text = insert_categories_block(text, cats)
    if new_text == text:
        return False, "no-text-change"
    if not dry_run:
        path.write_text(new_text, encoding="utf-8")
    return True, f"→ categories={cats}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Don't write changes")
    parser.add_argument(
        "--only",
        default=None,
        help="Only process MD files whose name starts with this prefix",
    )
    parser.add_argument(
        "--delay-ms",
        type=int,
        default=0,
        help="Sleep N ms between files (LLM-free; reserved for future use).",
    )
    args = parser.parse_args()

    if not DOCS_DIR.exists():
        print(f"No {DOCS_DIR} directory; nothing to backfill.", file=sys.stderr)
        return 0

    changed = 0
    skipped = 0
    # docs/papers/ 现在按 <YYYY>/<MM/> 分桶,递归收所有 .md。
    targets = sorted(DOCS_DIR.rglob("*.md"))
    if args.only:
        targets = [p for p in targets if p.name.startswith(args.only)]
    for path in targets:
        if path.name == "README.md":
            continue
        was_changed, reason = process_file(path, args.dry_run)
        if was_changed:
            changed += 1
            print(f"[{path.name}] {reason}")
        else:
            skipped += 1
        if args.delay_ms and was_changed:
            import time
            time.sleep(args.delay_ms / 1000)
    mode = "DRY-RUN" if args.dry_run else "WRITTEN"
    print(f"\n{mode}: {changed} changed, {skipped} unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
