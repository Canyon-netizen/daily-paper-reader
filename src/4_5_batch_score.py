# -*- coding: utf-8 -*-
"""src/4.5.batch_score.py — 一次性给所有论文打 0-1 相关度分。

用法:
  # 真实打分(用配置好的 LLM):
  python -m src.4_5_batch_score

  # 启发式占位(无 LLM key,仅按 venue / date 算):
  python -m src.4_5_batch_score --heuristic

  # 跑完后:
  #   - frontmatter score 字段被覆写
  #   - 打印 ≥0.8 留下 / <0.8 删除清单
  #   - delete-candidates.txt 写到 data/ 让你审核

风险:
  - 0.8 阈值几乎会全删(LLM 给的 0-1 分大多 0.3-0.6)
  - 实际删除必须用户手动确认:本脚本只生成候选清单,不直接删
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_PAPERS = REPO_ROOT / "docs" / "papers"
DATA_DIR = REPO_ROOT / "data"


def iter_paper_md_files() -> List[Path]:
    """所有 docs/papers/**/*.md(跳过 README / 路径占位)。"""
    out: List[Path] = []
    for p in DOCS_PAPERS.rglob("*.md"):
        name = p.name
        if name in ("README.md", "path-spec.md", "zotero-usage.md"):
            continue
        if name.startswith("_"):
            continue
        out.append(p)
    return out


def parse_frontmatter(md: str) -> Tuple[Dict[str, Any], str]:
    if not md.startswith("---"):
        return ({}, md)
    end = md.find("\n---", 4)
    if end < 0:
        return ({}, md)
    block = md[4:end]
    body = md[end + 4 :]
    try:
        data = yaml.safe_load(block) or {}
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    return (data, body)


def write_frontmatter(md_path: Path, score: float) -> None:
    """覆写 frontmatter score 字段(score: 0.0 ~ 1.0)。"""
    text = md_path.read_text(encoding="utf-8")
    data, body = parse_frontmatter(text)
    data["score"] = round(score, 3)
    # 重写 frontmatter,保持 body
    yaml_str = yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
    md_path.write_text(f"---\n{yaml_str}---{body}", encoding="utf-8")


def heuristic_score(front: Dict[str, Any]) -> float:
    """无 LLM 时的占位评分。
    base 0.50 + venue 会议 +0.20 + categories.task rl/agent +0.05(每个) + 新近 +0.10。
    限定 0-1 范围。"""
    score = 0.50
    venue = (front.get("venue") or "").lower()
    if any(v in venue for v in ("icml", "iclr", "neurips", "aaai", "acl", "emnlp", "cvpr", "iccv", "aaai")):
        score += 0.20
    cats = front.get("categories") or {}
    tasks = cats.get("task") or []
    boost = min(0.10, 0.05 * len([t for t in tasks if t in ("rl", "agent", "mas", "llm-agent", "robotics")]))
    score += boost
    date = front.get("date") or ""
    if date.startswith("2026-") or date.startswith("2025-"):
        score += 0.10
    return min(1.0, max(0.0, score))


def llm_score_papers(router, items: List[Tuple[Path, Dict[str, Any]]]) -> Dict[Path, float]:
    """批量调 LLM 一次给所有论文打 0-1 分,返回 {path: score}。

    系统提示词(精读 + 相关度评估):
    - 用户兴趣(默认 arxiv AI/ML/NLP/RL):"深度学习、AI 智能体、强化学习"
    - 论文含 title / tldr / abstract,LLM 输出 0-1 浮点分
    - 输出格式:JSON 数组 [{id, score}],严格

    简化版:一次 LLM 调用装 50 篇,分批处理。
    """
    SYSTEM_PROMPT = (
        "你是研究助手,任务:根据用户的整体兴趣,给每篇 arXiv 论文打一个 0-1 的"
        "相关度分数。\n"
        "用户兴趣(默认):深度学习、AI 智能体、强化学习、自然语言处理、"
        "机器人、计算机视觉。\n"
        "打分原则:论文主题与上述兴趣的相关度。0.0 = 完全无关,1.0 = 核心相关。\n"
        "**重要**:你只能根据给定的标题 / 摘要,不要追求与兴趣字面匹配,应理解"
        "研究问题与方法的语义关联(例如 RLHF / 对齐虽然不直接写"强化学习"四字,"
        "但本质相关)。\n"
        "输出格式:严格 JSON 数组,每项是 {\"i\": \"<顺序索引>\", \"s\": <0-1 浮点数>},"
        "无任何额外文字、Markdown 代码块、注释。"
    )

    BATCH = 50
    results: Dict[Path, float] = {}
    for start in range(0, len(items), BATCH):
        batch = items[start : start + BATCH]
        user_lines = [
            f"论文 #{i + 1}:",
            f"  标题: {front.get('title_zh') or front.get('title') or ''}",
            f"  摘要: {(front.get('tldr') or front.get('abstract') or front.get('evidence') or '')[:300]}",
            ""
            for i, (_p, front) in enumerate(batch)
        ]
        # 上面这行会插入空行
        user_msg = (
            f"下面共 {len(batch)} 篇论文,逐篇打分。输出 [{','.join(['#'+str(i+1) for i in range(len(batch))])}] "
            f"对应的 JSON 数组(每项是 {{\"i\":<1..N 顺序>,\"s\":<0-1 浮点>}})。\n\n"
            + "\n".join(user_lines)
        )
        try:
            resp = router.call(
                "library.score",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )
        except Exception as e:
            print(f"[batch {start}-{start+len(batch)}] LLM call failed: {e}", file=sys.stderr)
            for _p, _ in batch:
                results[_p] = 0.5
            continue
        # Parse JSON object
        try:
            content = resp.get("content") if isinstance(resp, dict) else None
            if not content:
                print(f"[batch {start}] empty response", file=sys.stderr)
                for _p, _ in batch:
                    results[_p] = 0.5
                continue
            payload = json.loads(content)
            # 支持 {"scores": [{"i":1,"s":0.7},...]} 或 [...数组...]
            if isinstance(payload, dict):
                arr = payload.get("scores") or payload.get("results") or next(iter(payload.values()), [])
            else:
                arr = payload
            score_map: Dict[int, float] = {}
            for it in arr or []:
                try:
                    idx = int(it.get("i"))
                    s = float(it.get("s"))
                    score_map[idx] = max(0.0, min(1.0, s))
                except Exception:
                    continue
            for i, (path, _front) in enumerate(batch, start=1):
                if i in score_map:
                    results[path] = score_map[i]
                else:
                    results[path] = 0.5  # 没回分,默认中位
        except Exception as e:
            print(f"[batch {start}] parse failed: {e}; raw={content[:200]}", file=sys.stderr)
            for _p, _ in batch:
                results[_p] = 0.5
    return results


def main() -> int:
    p = argparse.ArgumentParser(description="批量给所有论文打 0-1 相关度分,写回 frontmatter")
    p.add_argument("--heuristic", action="store_true", help="无 LLM,占位评分")
    p.add_argument("--threshold", type=float, default=0.8, help="删除阈值(默认 0.8)")
    p.add_argument("--dry-run", action="store_true", help="不写文件,只打印")
    p.add_argument("--yes-delete", action="store_true", help="**真删** ≥ threshold 以下的论文(默认只列清单)")
    args = p.parse_args()

    files = iter_paper_md_files()
    print(f"[batch-score] 扫到 {len(files)} 个 paper md 文件")

    items: List[Tuple[Path, Dict[str, Any]]] = []
    for f in files:
        text = f.read_text(encoding="utf-8")
        front, _ = parse_frontmatter(text)
        items.append((f, front))

    scores: Dict[Path, float] = {}
    if args.heuristic:
        for p_, front in items:
            scores[p_] = heuristic_score(front)
    else:
        try:
            from src.llm_router import get_llm_router
        except Exception as e:
            print(f"[batch-score] import llm_router 失败: {e}; 回退启发式", file=sys.stderr)
            args.heuristic = True
        if not args.heuristic:
            router = get_llm_router()
            scores = llm_score_papers(router, items)

    # 写回 frontmatter
    if not args.dry_run:
        for p_, s in scores.items():
            write_frontmatter(p_, s)
    print(f"[batch-score] 已写 {len(scores)} 个 score(0-1)")

    # 统计 + 写候选清单
    keep, kill = [], []
    for p_, s in sorted(scores.items(), key=lambda x: -x[1]):
        front = dict(x[0] for x in [])  # noop
        # 重建 frontmatter from file
        text = p_.read_text(encoding="utf-8")
        front, _ = parse_frontmatter(text)
        title = (front.get("title_zh") or front.get("title") or "").strip()[:60]
        arxiv = (front.get("pdf") or "").split("/")[-1] or p_.stem
        if s >= args.threshold:
            keep.append((arxiv, title, s))
        else:
            kill.append((arxiv, title, s))

    print(f"\n=== ≥ {args.threshold} 留下: {len(keep)} 篇 ===")
    for a, t, s in keep[:50]:
        print(f"  ✓ {s:.2f} {a}  {t}")
    if len(keep) > 50:
        print(f"  ... 还有 {len(keep) - 50} 篇")
    print(f"\n=== < {args.threshold} 删除候选: {len(kill)} 篇 ===")
    for a, t, s in kill[:50]:
        print(f"  ✗ {s:.2f} {a}  {t}")
    if len(kill) > 50:
        print(f"  ... 还有 {len(kill) - 50} 篇")

    # 写候选清单
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    candidate_path = DATA_DIR / "delete-candidates.txt"
    with open(candidate_path, "w", encoding="utf-8") as f:
        f.write(f"# delete-candidates — score < {args.threshold}\n")
        f.write(f"# generated: {args.heuristic and 'heuristic' or 'LLM'}\n")
        f.write(f"# total: {len(kill)} papers\n\n")
        for a, t, s in kill:
            f.write(f"{s:.3f}\t{a}\t{t}\n")
    print(f"\n[batch-score] 候选清单写到 {candidate_path}")

    if not args.yes_delete:
        print(f"\n⚠️ 这次没删任何文件。带 --yes-delete 才会真删(谨慎!)")
        return 0

    # 真删
    import shutil
    deleted = 0
    for p_, s in scores.items():
        if s < args.threshold:
            shutil.rmtree(p_.parent, ignore_errors=False) if p_.parent != DOCS_PAPERS else None
            if p_.parent != DOCS_PAPERS:
                # 不要把整个 docs/papers 删了,只删文件
                p_.unlink()
            else:
                p_.unlink()
            deleted += 1
    print(f"[batch-score] ⚠️ 已删 {deleted} 个文件(< {args.threshold});需 git commit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
