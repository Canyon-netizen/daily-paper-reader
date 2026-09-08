"""诊断:论文 frontmatter categories 覆盖度 vs 公共文献库 LIBRARIES 标签。

用法:python scripts/_diag_library_coverage.py
"""
import os
import re
import json
import yaml
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAPERS_DIR = ROOT / "docs" / "papers"
sys.path.insert(0, str(ROOT))

# 复用 astro-src/lib/libraries.ts 的 LIBRARIES 配置
# 直接 import TS 麻烦,把它的 7 个库写在这里
LIBRARIES = [
    {"id": "rl", "tags": ["task:rl"]},
    {"id": "multi-agent", "tags": ["task:mas"]},
    {"id": "game-ai", "tags": ["task:game-ai"]},
    {"id": "llm-agent", "tags": ["task:llm-agent", "task:agent"]},
    {"id": "reasoning", "tags": ["task:reasoning", "method:rlhf"]},
    {"id": "robotics", "tags": ["task:robotics", "task:manipulation", "task:locomotion"]},
    {"id": "computer-vision", "tags": ["task:vision"]},
]
LIB_TAG_SET = set()
for lib in LIBRARIES:
    for t in lib["tags"]:
        LIB_TAG_SET.add(t)


def parse_frontmatter(text: str) -> dict:
    """极简 frontmatter 解析,避免引 gray-matter 依赖"""
    m = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    try:
        return yaml.safe_load(m.group(1)) or {}
    except Exception:
        return {}


def flatten_tags(fm: dict) -> list[str]:
    cats = fm.get("categories") or {}
    if not isinstance(cats, dict):
        return []
    out = []
    for dim in ("venue", "task", "method", "type"):
        for label in cats.get(dim) or []:
            out.append(f"{dim}:{label}")
    return out


def main():
    md_files = list(PAPERS_DIR.rglob("*.md"))
    print(f"[diag] papers dir: {PAPERS_DIR}")
    print(f"[diag] .md files (含 README / topic-seeds / 其它): {len(md_files)}")

    # 排除非论文 .md
    paper_files = [p for p in md_files if "/topic-seeds-" not in p.name and not p.name.startswith("_") and p.name != "README.md"]
    print(f"[diag] paper files: {len(paper_files)}")

    papers = []
    category_counter = Counter()
    unmatched_examples = []
    for p in paper_files:
        text = p.read_text(encoding="utf-8", errors="replace")
        fm = parse_frontmatter(text)
        if not fm:
            continue
        # 取 canonical arxiv id
        axid = fm.get("arxiv_id") or fm.get("id") or p.stem
        tags = flatten_tags(fm)
        for t in tags:
            category_counter[t] += 1
        matched_libs = [t for t in tags if t in LIB_TAG_SET]
        papers.append({
            "id": axid,
            "title": (fm.get("title") or "")[:60],
            "tags": tags,
            "matched_libs": matched_libs,
            "categories": fm.get("categories", {}),
            "path": str(p.relative_to(ROOT)),
        })
        if not matched_libs and len(unmatched_examples) < 8:
            unmatched_examples.append((axid, (fm.get("title") or "")[:60], tags))

    # 去重(同一 arxiv id 多版本只算 1 次,跟 SSR dedup 口径一致)
    seen = set()
    deduped = []
    for p in papers:
        cid = re.sub(r"v\d+$", "", p["id"])
        if cid in seen:
            continue
        seen.add(cid)
        deduped.append(p)
    print(f"[diag] 唯一论文数(dedup): {len(deduped)}")
    print()

    # 库归属统计
    print("=" * 70)
    print("文献库成员数(去重后,每篇可归属多个库)")
    print("=" * 70)
    lib_member_count = {lib["id"]: 0 for lib in LIBRARIES}
    for p in deduped:
        for lib in LIBRARIES:
            if any(t in lib["tags"] for t in p["tags"]):
                lib_member_count[lib["id"]] += 1
    for lib in LIBRARIES:
        n = lib_member_count[lib["id"]]
        print(f"  {lib['id']:<20s}  {n:>4d} 篇  tags={lib['tags']}")
    print()

    # 无库归属的论文
    no_lib = [p for p in deduped if not p["matched_libs"]]
    print(f"无任何文献库归属的论文: {len(no_lib)} / {len(deduped)} = {len(no_lib)*100/len(deduped):.1f}%")
    print(f"  (示例,前 10 条)")
    for p in no_lib[:10]:
        print(f"    {p['id'][:50]:<50s}  cats={list(p['categories'].keys())} tags={p['tags']}")
    print()

    # 出现但未被任何库覆盖的 category:tag(高频 Top 20)
    uncovered_tags = Counter()
    for p in deduped:
        for t in p["tags"]:
            if t not in LIB_TAG_SET:
                uncovered_tags[t] += 1
    print("未映射到任何文献库的 tag(Top 20,出现 >= 3 次):")
    for tag, cnt in uncovered_tags.most_common(20):
        if cnt < 3:
            break
        print(f"  {tag:<30s}  {cnt:>4d} 篇")
    print()

    # 覆盖率分布:每篇归属几个库
    membership_dist = Counter(len(p["matched_libs"]) for p in deduped)
    print("每篇论文归属的库数分布:")
    for n_libs, cnt in sorted(membership_dist.items()):
        print(f"  {n_libs} 个库: {cnt} 篇")
    print()

    # 总结
    total_in_libs = sum(1 for p in deduped if p["matched_libs"])
    print("=" * 70)
    print(f"总结:")
    print(f"  论文总数: {len(deduped)}")
    print(f"  在至少 1 个库: {total_in_libs} ({total_in_libs*100/len(deduped):.1f}%)")
    print(f"  在 0 个库:   {len(no_lib)} ({len(no_lib)*100/len(deduped):.1f}%)")
    print(f"  7 个库合计成员(去重): sum-of-libs = {sum(lib_member_count.values())}")
    print(f"    期望 1 篇只归 1 库的话,缺 {len(deduped) - sum(lib_member_count.values())} 篇覆盖")
    print(f"    期望全部都至少归 1 库的话,缺 {len(no_lib)} 篇")
    print()


if __name__ == "__main__":
    main()
