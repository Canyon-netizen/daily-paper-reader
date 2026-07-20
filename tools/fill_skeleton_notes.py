#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fill in the 13 skeleton paper notes that were left with placeholder frontmatter
(title_zh "(待补 — 7-20 step 6 paper_source NameError 漏写)", evidence/tldr backfill
skeletons) and no Chinese 摘要 section.

Privacy: this script reads credentials ONLY from the process environment (loaded
from .env by src.local_env). It NEVER prints, logs, or writes any secret value.
The custom .env keys used by this project (token/id/api/url/model) are mapped to
the names ClientFactory expects, purely in-memory.

Usage:
  python tools/fill_skeleton_notes.py --test        # connectivity smoke test only
  python tools/fill_skeleton_notes.py --file <path> # process one file
  python tools/fill_skeleton_notes.py               # process all skeleton files
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))

from src.local_env import load_local_env  # noqa: E402


def _map_env() -> None:
    """Map this project's custom .env keys to ClientFactory's expected names.

    Never prints any value. `url`/`model` are non-secret config; `api` is the key.
    """
    load_local_env()
    api = os.getenv("api") or os.getenv("LLM_API_KEY")
    url = os.getenv("url") or os.getenv("LLM_BASE_URL") or "https://api.minimaxi.com/v1"
    model = os.getenv("model") or ""
    # Provider is inferred from the minimaxi base url -> 'minimax'.
    if model and "/" not in model:
        low = url.lower()
        if "minimaxi" in low:
            model = f"minimax/{model}"
        elif "deepseek" in low:
            model = f"deepseek/{model}"
        elif "siliconflow" in low:
            model = f"siliconflow/{model}"
        else:
            model = f"openai-compatible/{model}"
    if api and not os.getenv("LLM_API_KEY"):
        os.environ["LLM_API_KEY"] = api
    if url and not os.getenv("LLM_BASE_URL"):
        os.environ["LLM_BASE_URL"] = url
    if model and not os.getenv("LLM_MODEL"):
        os.environ["LLM_MODEL"] = model


def _client():
    from llm import ClientFactory  # noqa

    return ClientFactory.from_env()


def _chat(client, messages, temperature=0.4, max_tokens=8000):
    client.kwargs = {"temperature": temperature, "max_tokens": max_tokens}
    resp = client.chat(messages)
    if isinstance(resp, dict):
        content = resp.get("content")
        if content:
            return content
        # fall back to reasoning content if the model only emitted a think block
        rc = resp.get("reasoning_content")
        if rc:
            return rc
        raise RuntimeError("LLM returned empty content")
    if isinstance(resp, str):
        return resp
    raise RuntimeError("Unexpected LLM response shape")


def _strip_reasoning(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.DOTALL)
    return text.strip()


def _extract_json(text: str) -> dict:
    text = _strip_reasoning(text)
    # strip code fences
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object found in LLM output")
    return json.loads(text[start : end + 1])


# ---- file parsing -------------------------------------------------------

FM_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)


def parse_note(path: Path):
    raw = path.read_text(encoding="utf-8")
    m = FM_RE.match(raw)
    if not m:
        raise ValueError(f"no frontmatter in {path}")
    return m.group(1), m.group(2)


def get_fm_field(fm: str, key: str) -> str | None:
    m = re.search(rf"^{re.escape(key)}:\s*(.*)$", fm, flags=re.MULTILINE)
    return m.group(1).strip() if m else None


def get_abstract_en(body: str) -> str:
    m = re.search(r"^##\s*Abstract\s*\n(.*?)(?=\n##\s|\Z)", body, flags=re.DOTALL | re.MULTILINE)
    return (m.group(1).strip() if m else "").strip()


TAXONOMY = json.loads((ROOT / "config" / "taxonomies.json").read_text(encoding="utf-8"))


def build_prompt(title_en: str, abstract_en: str, authors: str):
    sys_msg = (
        "你是一名熟悉机器学习与自然科学论文的专业研究助理与翻译。"
        "请严格只输出一个 JSON 对象，不要输出任何解释文字或代码块标记。"
    )
    task = {
        "title_en": title_en,
        "abstract_en": abstract_en,
        "authors": authors,
        "task_allow": TAXONOMY["task"],
        "method_allow": TAXONOMY["method"],
        "type_allow": TAXONOMY["type"],
    }
    user_msg = (
        "根据下面的论文标题与英文摘要，输出 JSON，字段如下（全部为中文，除非注明）：\n"
        "{\n"
        '  "title_en": "论文的正确英文标题（若给定 title_en 明显错误，如为 URL/URL Source/Markdown Content 等噪声，请根据摘要与作者补全正确英文标题）",\n'
        '  "title_zh": "标题的自然准确中文翻译（不加书名号）",\n'
        '  "abstract_zh": "英文 abstract 的完整忠实中文翻译，须覆盖全部信息，不要压缩成要点",\n'
        '  "tldr": "3-5 句中文速览，说明问题、方法与主要结论",\n'
        '  "evidence": "一句话说明该论文与强化学习/智能体/大模型等主题的相关点（15-30字）",\n'
        '  "motivation": "一句话研究动机",\n'
        '  "method": "一句话方法概述",\n'
        '  "result": "一句话主要结果",\n'
        '  "conclusion": "一句话结论",\n'
        '  "score": 数字 0-10（该论文的整体质量/相关性评分，一位小数）,\n'
        '  "categories": {"venue": [], "task": [从 task_allow 选0-2个], "method": [从 method_allow 选0-2个], "type": [从 type_allow 选0-1个]}\n'
        "}\n"
        "categories 只能使用给定白名单中的英文小写值；不确定就留空数组。\n\n"
        "论文信息：\n" + json.dumps(task, ensure_ascii=False)
    )
    return [
        {"role": "system", "content": sys_msg},
        {"role": "user", "content": user_msg},
    ]


def _yaml_escape(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ").strip()


def _fmt_list(xs):
    if not xs:
        return "[]"
    return "[" + ", ".join(f'"{x}"' for x in xs) + "]"


def _clean_cat(cats: dict) -> dict:
    out = {"venue": [], "task": [], "method": [], "type": []}
    for dim in ("task", "method", "type"):
        allow = set(TAXONOMY[dim])
        vals = cats.get(dim) or []
        for v in vals:
            v = str(v).strip().lower()
            if v in allow and v not in out[dim]:
                out[dim].append(v)
    return out


def _oneline(s: str) -> str:
    """Collapse any internal whitespace/newlines so a value stays a single YAML line."""
    return re.sub(r"\s+", " ", (s or "").strip())


def rebuild_frontmatter(fm: str, data: dict) -> str:
    cats = _clean_cat(data.get("categories") or {})
    replacements = {
        "title_zh": _oneline(data["title_zh"]),
        "evidence": _oneline(data["evidence"]),
        "tldr": _oneline(data["tldr"]),
        "motivation": _oneline(data["motivation"]),
        "method": _oneline(data["method"]),
        "result": _oneline(data["result"]),
        "conclusion": _oneline(data["conclusion"]),
    }
    # repair a broken/noisy English title if the LLM supplied a better one
    fixed_title = _oneline(data.get("title_en") or "")
    lines = fm.split("\n")
    out_lines = []
    seen = set()
    for line in lines:
        km = re.match(r"^([A-Za-z_]+):\s*(.*)$", line)
        if not km:
            out_lines.append(line)
            continue
        key = km.group(1)
        cur_val = km.group(2)
        if key == "title":
            noisy = any(tok in cur_val for tok in ("URL Source", "Markdown Content", "Number of Pages", "Published Time"))
            if noisy and fixed_title:
                out_lines.append(f'title: "{_yaml_escape(fixed_title)}"')
            else:
                out_lines.append(line)
            seen.add(key)
        elif key == "title_zh":
            out_lines.append(f'title_zh: "{_yaml_escape(replacements["title_zh"])}"')
            seen.add(key)
        elif key == "evidence":
            out_lines.append(f'evidence: "{_yaml_escape(replacements["evidence"])}"')
            seen.add(key)
        elif key == "tldr":
            out_lines.append(f'tldr: "{_yaml_escape(replacements["tldr"])}"')
            seen.add(key)
        elif key == "score":
            try:
                sc = float(data.get("score"))
                sc = max(0.0, min(10.0, sc))
            except Exception:
                sc = 0.0
            out_lines.append(f"score: {sc}")
            seen.add(key)
        elif key == "categories":
            out_lines.append(
                "categories: { venue: %s, task: %s, method: %s, type: %s }"
                % (_fmt_list(cats["venue"]), _fmt_list(cats["task"]),
                   _fmt_list(cats["method"]), _fmt_list(cats["type"]))
            )
            seen.add(key)
        else:
            out_lines.append(line)
    # append motivation/method/result/conclusion if missing
    for k in ("motivation", "method", "result", "conclusion"):
        if not re.search(rf"^{k}:", fm, flags=re.MULTILINE):
            out_lines.append(f'{k}: "{_yaml_escape(replacements[k])}"')
    return "\n".join(out_lines)


def process(path: Path, client, dry_run=False):
    fm, body = parse_note(path)
    title_en = (get_fm_field(fm, "title") or "").strip().strip('"')
    authors = (get_fm_field(fm, "authors") or "").strip().strip('"')
    abstract_en = get_abstract_en(body)
    if not abstract_en:
        raise RuntimeError(f"no English abstract in {path.name}")

    data = _extract_json(_chat(client, build_prompt(title_en, abstract_en, authors)))
    required = ["title_zh", "abstract_zh", "tldr", "evidence", "motivation", "method", "result", "conclusion"]
    for k in required:
        if not str(data.get(k, "")).strip():
            raise RuntimeError(f"LLM missing field '{k}' for {path.name}")

    new_fm = rebuild_frontmatter(fm, data)

    # 兜底抽图注入:backfill_2026-07-20_step6fix 这一批骨架笔记常缺 figures_json;
    # 同 id 的 meta.json 若已存在(由 daily pipeline 提前抽好),这里把 figures 列表注入 frontmatter。
    # 实现思路:rebuild_frontmatter 是逐行替换,不重写整个 dict;append 一行最干净。
    arxiv_id = None
    aid_m = re.search(r"^arxiv_id:\s*(\S+)", fm, flags=re.MULTILINE) or re.search(r"/(\d{4}\.\d{4,5}v\d+)\b", str(path))
    if aid_m:
        arxiv_id = aid_m.group(1)
    # 只在当前 frontmatter 没有 figures_json 时注入(避免覆盖已有/更全的列表)
    if arxiv_id and not re.search(r"^figures_json:", new_fm, flags=re.MULTILINE):
        try:
            from src._utils import figures_json_from_meta  # type: ignore
            figs_yaml = figures_json_from_meta(str(ROOT / "docs"), arxiv_id)
            if figs_yaml:
                new_fm = new_fm + f"\nfigures_json: {figs_yaml}"
        except Exception as e:
            print(f"[warn] figures_json 注入跳过 ({arxiv_id}): {e}", flush=True)

    # insert Chinese 摘要 section before ## Abstract if absent
    if re.search(r"^##\s*摘要", body, flags=re.MULTILINE):
        new_body = body
    else:
        zh = data["abstract_zh"].strip()
        new_body = re.sub(
            r"(^##\s*Abstract\b)",
            f"## 摘要\n{zh}\n\n\\1",
            body,
            count=1,
            flags=re.MULTILINE,
        )

    new_content = f"---\n{new_fm}\n---\n{new_body}"
    if dry_run:
        return data, new_content
    path.write_text(new_content, encoding="utf-8")
    return data, None


SKELETON_MARK = "待补 — 7-20 step 6"


def find_skeletons() -> list[Path]:
    docs = ROOT / "docs" / "papers"
    out = []
    for p in docs.rglob("*.md"):
        try:
            head = p.read_text(encoding="utf-8")[:800]
        except Exception:
            continue
        if SKELETON_MARK in head:
            out.append(p)
    return sorted(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--file")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    _map_env()

    if not os.getenv("LLM_MODEL") or not os.getenv("LLM_API_KEY"):
        print("ERROR: LLM credentials not available in environment", file=sys.stderr)
        sys.exit(2)

    client = _client()

    if args.test:
        out = _chat(client, [{"role": "user", "content": "只回复两个字：正常"}], max_tokens=50)
        print("LLM connectivity OK. reply:", _strip_reasoning(out)[:40])
        return

    if args.file:
        targets = [Path(args.file)]
    else:
        targets = find_skeletons()

    print(f"{len(targets)} target file(s)")
    for i, p in enumerate(targets, 1):
        try:
            data, preview = process(p, client, dry_run=args.dry_run)
            print(f"[{i}/{len(targets)}] OK  {p.name}  -> title_zh={data['title_zh'][:30]}")
            if args.dry_run and preview:
                print("----- PREVIEW -----")
                print(preview[:1200])
        except Exception as e:
            print(f"[{i}/{len(targets)}] FAIL {p.name}: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
