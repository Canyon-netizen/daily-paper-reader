"""
backfill_md_from_txt.py
========================
从 docs/papers/{arxiv-id}.txt 回填对应的 {arxiv-id}.md。

设计目标:
- 让首页 totalPapers 从 205 跳到 238(以及去掉"最近更新 7-10")。
- 不依赖 src.main / 6.generate_docs.py 调用栈,绕开 paper_source NameError。
- 单次批量 LLM prompt: 一次 N 篇 abstract,返回 N 行 JSON,本地解析。
- 机械字段从 txt 直接 regex 提(title/authors/date/pdf/source);
  LLM 字段取 title_zh/categories/score/evidence/tldr摘要。

调用:
    python tools/backfill_md_from_txt.py --date 2026-07-19
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
DOCS_PAPERS = ROOT_DIR / "docs" / "papers"


def load_env() -> Dict[str, str]:
    env_file = ROOT_DIR / ".env"
    out: Dict[str, str] = {}
    if not env_file.exists():
        return out
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip()
    return out


def parse_txt(path: Path) -> Dict[str, Any] | None:
    """从 ar5iv/arXiv jina 拉出的标准 txt 头部提取机械字段。"""
    txt = path.read_text(encoding="utf-8", errors="replace")
    title_m = re.search(r"^Title:\s*(.+?)\s*$", txt, re.M)
    url_m = re.search(r"^URL Source:\s*(https?://arxiv\.org/pdf/[\w./\-]+)\s*$", txt, re.M)
    pub_m = re.search(r"^Published Time:\s*(.+?)\s*$", txt, re.M)
    pages_m = re.search(r"^Number of Pages:\s*(\d+)\s*$", txt, re.M)

    if not title_m or not url_m:
        return None
    arxiv_id = url_m.group(1).rsplit("/", 1)[-1].removesuffix(".pdf")

    published = pub_m.group(1) if pub_m else ""
    from email.utils import parsedate_to_datetime

    date_str = ""
    try:
        date_str = parsedate_to_datetime(published).strftime("%Y-%m-%d")
    except Exception:
        date_str = ""

    # abstract 段:"# ABSTRACT" 到下一个 "# " 标题之前
    abs_m = re.search(
        r"#\s*ABSTRACT\s*\n+(.+?)(?=\n#\s|\n---|\Z)",
        txt,
        re.S | re.I,
    )
    abstract = abs_m.group(1).strip() if abs_m else ""

    # 行内 abstract 留 ~4500 字符给 LLM(够用)
    abstract = re.sub(r"\s+", " ", abstract)[:4500]

    return {
        "arxiv_id": arxiv_id,
        "title": title_m.group(1).strip(),
        "pdf": url_m.group(1),
        "date": date_str,
        "abstract": abstract,
    }


def call_llm_batch(papers: List[Dict[str, Any]], env: Dict[str, str]) -> List[Dict[str, Any]]:
    """一次 prompt 把 papers 全发给 LLM,期望返回长度相同的 JSON 数组。"""
    sys_prompt = (
        "你是论文元数据抽取助手。"
        "你会得到 N 篇论文的 arxiv_id/title/abstract。"
        "**严格按输入顺序**,**输出恰好 N 个 JSON 对象**的 JSON 数组,不要 markdown 围栏,"
        "不要解释,不要前缀。Schema 每个对象:"
        '{"arxiv_id":"...", "title_zh":"...中文翻译...", '
        '"task_tags":["rl"|"mas"|"llm-agent"|"agent"|"reasoning"|"gui"|"vision"|"game-ai"|"robotics"|"code"|"self-distillation"|"intervention"], '
        '"score":1..10 整数, "evidence":"<=24字中文要点", '
        '"tldr_zh":"<=180字中文摘要"}'
    )

    user_payload = []
    for p in papers:
        user_payload.append(
            {
                "arxiv_id": p["arxiv_id"],
                "title": p["title"],
                "abstract": p.get("abstract", ""),
            }
        )
    user_text = json.dumps(user_payload, ensure_ascii=False)

    body = {
        "model": env.get("model", "minimax-m3"),
        "messages": [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_text},
        ],
        "temperature": 0.2,
        "max_tokens": 8192,
    }
    url = env["url"].rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {env['api']}",
        "Content-Type": "application/json",
    }

    print(f"[LLM] POST {url} papers={len(papers)}", flush=True)
    r = requests.post(url, headers=headers, json=body, timeout=180)
    r.raise_for_status()
    data = r.json()
    content = data["choices"][0]["message"]["content"]
    # strip 思维链(子代理已知 根因:minimax 返回  块)
    content = re.sub(r"", "", content, flags=re.S).strip()
    content = re.sub(r"^```(?:json)?\s*", "", content)
    content = re.sub(r"\s*```$", "", content)
    print(f"[LLM] content head 200: {content[:200]!r}", flush=True)

    try:
        arr = json.loads(content)
    except json.JSONDecodeError:
        # 容错:取第一个 '[' 到最后一个 ']'
        lo = content.find("[")
        hi = content.rfind("]")
        if lo == -1 or hi == -1:
            raise RuntimeError(f"LLM 返回非 JSON: {content[:500]}")
        arr = json.loads(content[lo : hi + 1])

    if not isinstance(arr, list) or len(arr) != len(papers):
        raise RuntimeError(f"LLM JSON 长度不符:got {len(arr) if isinstance(arr,list) else type(arr)}, expect {len(papers)}")
    return arr  # type: ignore[return-value]


def render_md(parsed: Dict[str, Any], llm: Dict[str, Any], generated_at: str) -> str:
    task_tags = llm.get("task_tags") or []
    task_tags = [t for t in task_tags if isinstance(t, str) and t.strip()]
    title_zh = (llm.get("title_zh") or "").strip()
    score = llm.get("score")
    try:
        score_num = max(0, min(10, int(score)))
    except Exception:
        score_num = 0
    evidence = (llm.get("evidence") or "").strip()
    tldr = (llm.get("tldr_zh") or "").strip()

    fm = {
        "title": parsed["title"],
        "title_zh": title_zh or parsed["title"],
        "authors": "",  #  txt 头部 author 抽取不可靠,留空
        "date": parsed["date"] or "",
        "generated_at": generated_at,
        "pdf": parsed["pdf"],
        "categories": {
            "venue": [],
            "task": task_tags,
            "method": [],
            "type": [],
        },
        "score": score_num,
        "evidence": evidence or "(待补)",
        "tldr": tldr or "(待 LLM 补)",
        "source": "arxiv",
        "selection_source": "backfill_2026-07-19",
    }

    import yaml

    front = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False).strip()
    body = "\n\n## 摘要\n\n" + (tldr or "(待 LLM 摘要)") + "\n\n## Abstract\n\n" + parsed.get("abstract", "") + "\n"
    return f"---\n{front}\n---\n{body}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="YYYY-MM-DD,用于筛选当天 mtime 的 txt")
    ap.add_argument("--limit", type=int, default=0, help="dry-run 限制篇数(0=全部)")
    ap.add_argument("--offset", type=int, default=0, help="dry-run 起始偏移")
    args = ap.parse_args()

    date_prefix = args.date  # YYYY-MM-DD
    targets: List[Path] = []
    for p in sorted(DOCS_PAPERS.glob("*.txt")):
        if not p.exists():
            continue
        try:
            mt = time.strftime("%Y-%m-%d", time.localtime(p.stat().st_mtime))
        except Exception:
            continue
        if mt != date_prefix:
            continue
        if (DOCS_PAPERS / f"{p.stem}.md").exists():
            continue
        targets.append(p)

    print(f"[scan] {len(targets)} 待补 md 的 txt (mtime={date_prefix})")
    if not targets:
        return 0

    parsed_list: List[Dict[str, Any]] = []
    for p in targets:
        rec = parse_txt(p)
        if not rec or not rec["date"]:
            print(f"[skip] {p.name} (parse failed or no date)")
            continue
        parsed_list.append(rec)

    print(f"[parse] {len(parsed_list)}/{len(targets)} parsed OK")
    if not parsed_list:
        return 0

    if args.limit and args.limit > 0:
        parsed_list = parsed_list[args.offset : args.offset + args.limit]
        print(f"[limit] dry-run off={args.offset} len={len(parsed_list)}")

    env = load_env()
    if not env.get("api"):
        print("[error] .env 缺少 api url model — 无法调 LLM,先回退到纯骨架 md")
        # 骨架版回退
        for rec in parsed_list:
            md_path = DOCS_PAPERS / f"{rec['arxiv_id']}.md"
            md_path.write_text(
                "---\n"
                f"title: {rec['title']}\n"
                f"title_zh: 'N/A'\n"
                f"authors: ''\n"
                f"date: {rec['date']}\n"
                f"generated_at: '{args.date} 00:00:00 UTC'\n"
                f"pdf: '{rec['pdf']}'\n"
                "categories: { venue: [], task: [], method: [], type: [] }\n"
                "score: 0\n"
                "evidence: '(backfill-only)'\n"
                "tldr: '(待 LLM 补)'\n"
                "source: arxiv\n"
                "selection_source: 'backfill_2026-07-19'\n"
                "---\n\n## Abstract\n\n" + rec.get("abstract", "") + "\n",
                encoding="utf-8",
            )
            print(f"[write] {md_path.name}")
        return 0

    llm_results = call_llm_batch(parsed_list, env)
    now = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    for rec, llm in zip(parsed_list, llm_results):
        md_path = DOCS_PAPERS / f"{rec['arxiv_id']}.md"
        try:
            content = render_md(rec, llm, now)
            md_path.write_text(content, encoding="utf-8")
            print(f"[write] {md_path.name}")
        except Exception as e:
            print(f"[ERROR] {rec['arxiv_id']}: {e}", flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
