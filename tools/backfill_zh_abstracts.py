"""
backfill_zh_abstracts.py
========================
为 docs/papers/**/*.md 缺失或过短的 ## 摘要 段批量重写。

设计目标:
- 不依赖主 daily pipeline 调用栈(LLM 直接走 .env + requests.post)。
- 复用 src/6.generate_docs.py::translate_title_and_abstract_to_zh 的契约
  (system_prompt + schema + temperature 0.2 + max_tokens 4000),保证主从一致。
- 过短则强化 prompt("必须覆盖 abstract 每一句,不允许压缩 TLDR")重试一次,
  仍失败则跳过 + 报警,**不空覆盖已有内容**。
- 只动 ## 摘要 段正文,不动 frontmatter / ## Abstract / 其他段。

调用:
    python tools/backfill_zh_abstracts.py                 # dry-run 全量扫描
    python tools/backfill_zh_abstracts.py --write        # 落盘全量
    python tools/backfill_zh_abstracts.py --arxiv-id 2607.26474v1  # 单篇
    python tools/backfill_zh_abstracts.py --list-file x.txt        # 自定义清单
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
DOCS_PAPERS = ROOT_DIR / "docs" / "papers"

# 加 src/ 到 sys.path 以 import text_utils / 6.generate_docs
sys.path.insert(0, str(ROOT_DIR))


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


# ---- 文件 IO helpers ---------------------------------------------------------

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.S)
_ABSTRACT_SECTION_RE = re.compile(
    r"^##\s*Abstract\s*\n(.*?)(?=^##\s|\Z)", re.S | re.M
)
_ZH_SECTION_RE = re.compile(
    r"^##\s*摘要\s*\n(.*?)(?=^##\s|\Z)", re.S | re.M
)
_ZH_BLOCK_RE = re.compile(
    r"(^##\s*摘要\s*\n).*?(?=^##\s|\Z)", re.S | re.M
)


def parse_note(path: Path) -> Optional[Dict[str, str]]:
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return None
    fm_m = _FRONTMATTER_RE.search(text)
    if not fm_m:
        return None
    fm = fm_m.group(1)
    ab_m = _ABSTRACT_SECTION_RE.search(text)
    if not ab_m:
        return None
    return {"fm": fm, "body": text, "abstract_en": ab_m.group(1).strip()}


def get_fm_field(fm: str, key: str) -> str:
    m = re.search(r"^%s:\s*(.*)$" % re.escape(key), fm, re.M)
    if not m:
        return ""
    return m.group(1).strip().strip("'\"")


def get_zh_abstract(text: str) -> Optional[str]:
    m = _ZH_SECTION_RE.search(text)
    return m.group(1).strip() if m else None


# ---- LLM ---------------------------------------------------------------------

TRANSLATE_SYSTEM_PROMPT = (
    "你是一名熟悉机器学习与自然科学论文的专业翻译，请将英文标题和摘要翻译为自然、准确的中文。"
    "保持学术风格，尽量保留专有名词，不要额外添加评论。"
    "摘要必须完整忠实翻译英文 abstract，逐句覆盖全部信息，不要压缩成 TLDR、要点或改写总结。"
)
TRANSLATE_USER_PROMPT_TEMPLATE = (
    "请将上面的 JSON 中的 title 与 abstract 翻译成中文，并严格输出 JSON：\n"
    '{"title_zh": "...", "abstract_zh": "..."}\n'
    "要求：只输出 JSON，不要输出任何其它说明文字。\n"
    "Output must be strict JSON only, no markdown, no fences, no extra text."
)
# 第二次(强化)用的 prompt:加重 TLDR 禁令 + 长度下限
TRANSLATE_SYSTEM_PROMPT_STRICT = (
    "你是一名熟悉机器学习与自然科学论文的专业翻译，请将英文标题和摘要翻译为自然、准确的中文。"
    "保持学术风格，尽量保留专有名词，不要额外添加评论。"
    "摘要必须**逐句、逐概念**翻译英文 abstract，禁止任何形式的压缩、合并、改写、TLDR 总结。"
    "翻译字数不得低于英文字数的 45%(中文一字约等于英文 0.7 字,长摘要更省字是正常的,"
    "但禁止缩减到 < 45%)。"
)
TRANSLATE_SCHEMA = {
    "type": "object",
    "properties": {
        "title_zh": {"type": "string"},
        "abstract_zh": {"type": "string"},
    },
    "required": ["title_zh", "abstract_zh"],
    "additionalProperties": False,
}


def call_translate(
    title: str, abstract: str, env: Dict[str, str], *, strict: bool = False,
) -> Optional[Dict[str, str]]:
    """调 LLM 翻译,strict=True 用强化 prompt。失败/异常返回 None。"""
    payload = {"title": title, "abstract": abstract}
    user_text = json.dumps(payload, ensure_ascii=False)

    sys_prompt = TRANSLATE_SYSTEM_PROMPT_STRICT if strict else TRANSLATE_SYSTEM_PROMPT
    messages = [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": user_text},
        {"role": "user", "content": TRANSLATE_USER_PROMPT_TEMPLATE},
    ]

    body = {
        "model": env.get("model", "minimax-m3"),
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 4000,
        "response_format": {"type": "json_object"},
    }
    url = env["url"].rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {env['api']}",
        "Content-Type": "application/json",
    }
    try:
        r = requests.post(url, headers=headers, json=body, timeout=180)
        r.raise_for_status()
        data = r.json()
        content = data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"[ERROR] LLM POST 失败: {e}", flush=True)
        return None

    # 剥除 <think>...</think> 思维链(M-01 等推理模型会包)
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()

    # 优先尝试 strict JSON 解析(若 response_format 生效)
    try:
        obj = json.loads(content)
        if isinstance(obj, dict) and "abstract_zh" in obj:
            return {"title_zh": obj.get("title_zh", ""), "abstract_zh": obj.get("abstract_zh", "")}
    except json.JSONDecodeError:
        pass

    # 容错:取第一个 { 到最后一个 }
    lo = content.find("{")
    hi = content.rfind("}")
    if lo == -1 or hi == -1:
        return None
    try:
        obj = json.loads(content[lo:hi + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict):
        return None
    return {"title_zh": obj.get("title_zh", ""), "abstract_zh": obj.get("abstract_zh", "")}


# ---- 主流程 -------------------------------------------------------------------

def is_zh_bad(zh: Optional[str], abstract_en: str) -> bool:
    """判据:段缺失 / 空 / 占位 / 过短。"""
    from src.generate_docs_text_utils import (  # noqa: E402  (sys.path 已加)
        is_placeholder_text, is_too_short_for_abstract_translation,
    )
    if zh is None:
        return True
    if not zh.strip():
        return True
    if is_placeholder_text(zh):
        return True
    if is_too_short_for_abstract_translation(zh, abstract_en):
        return True
    return False


def replace_zh_section(text: str, new_zh: str) -> str:
    """替换 ## 摘要 段正文;若不存在则插入到 ## Abstract 之前。"""
    if _ZH_SECTION_RE.search(text):
        return _ZH_BLOCK_RE.sub(
            lambda m: m.group(1) + new_zh.strip() + "\n",
            text,
            count=1,
        )
    # 不存在则插入
    if "## Abstract" in text:
        return text.replace(
            "## Abstract",
            "## 摘要\n" + new_zh.strip() + "\n\n## Abstract",
            1,
        )
    return text.rstrip() + "\n\n## 摘要\n" + new_zh.strip() + "\n"


def find_targets(list_file: Optional[str], arxiv_id: Optional[str]) -> List[Path]:
    """收集待修 .md 路径清单。"""
    if arxiv_id:
        # 单篇模式:glob 匹配 *.md 含 id 前缀
        return sorted(DOCS_PAPERS.rglob(f"{arxiv_id}*.md"))

    if list_file:
        return [Path(p) for p in Path(list_file).read_text(encoding="utf-8").splitlines() if p.strip()]

    # 默认全量扫描:## 摘要 缺失或过短都纳入
    out: List[Path] = []
    for md in sorted(DOCS_PAPERS.rglob("*.md")):
        if md.name == "README.md":
            continue
        try:
            t = md.read_text(encoding="utf-8")
        except Exception:
            continue
        ab_m = _ABSTRACT_SECTION_RE.search(t)
        if not ab_m:
            continue  # 没有 Abstract 段的笔记(其他模板)跳过
        zh = get_zh_abstract(t)
        if is_zh_bad(zh, ab_m.group(1).strip()):
            out.append(md)
    return out


def process_one(md_path: Path, env: Dict[str, str], *, dry_run: bool) -> str:
    """处理单篇。返回状态: 'ok' / 'skipped' / 'failed'。"""
    parsed = parse_note(md_path)
    if not parsed:
        return "skipped"
    title = get_fm_field(parsed["fm"], "title").strip().strip("'\"")
    if not title:
        return "skipped"
    abstract_en = parsed["abstract_en"]
    zh = get_zh_abstract(parsed["body"])

    if not is_zh_bad(zh, abstract_en):
        return "skipped"

    print(f"  [target] {md_path.name} (zh={len(zh) if zh else 0} chars, en={len(abstract_en.split())} words)", flush=True)

    # 第一次翻译
    res = call_translate(title, abstract_en, env, strict=False)
    abstract_zh = (res or {}).get("abstract_zh", "").strip()
    if abstract_zh and is_zh_bad(abstract_zh, abstract_en):
        # 触发强化 prompt 重试
        print(f"    [retry] 第一次过短,用 strict prompt 重试", flush=True)
        res = call_translate(title, abstract_en, env, strict=True)
        abstract_zh = (res or {}).get("abstract_zh", "").strip()

    if not abstract_zh or is_zh_bad(abstract_zh, abstract_en):
        print(
            f"    [FAIL] {md_path.name} 翻译仍过短/失败,跳过(不覆盖)",
            flush=True,
        )
        return "failed"

    if dry_run:
        print(
            f"    [dry-run] 将写入 zh_abstract ({len(abstract_zh)} CJK chars)",
            flush=True,
        )
        return "ok"

    new_text = replace_zh_section(parsed["body"], abstract_zh)
    md_path.write_text(new_text, encoding="utf-8")
    print(
        f"    [WRITE] {md_path.name} (zh={len(abstract_zh)} chars)",
        flush=True,
    )
    return "ok"


def main() -> int:
    ap = argparse.ArgumentParser(description="回填 ## 摘要 段(完整中文翻译)")
    ap.add_argument("--write", action="store_true", help="实际写盘(默认 dry-run)")
    ap.add_argument("--arxiv-id", help="单篇模式:仅处理指定 id")
    ap.add_argument("--list-file", help="每行一个 .md 路径的清单文件")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--offset", type=int, default=0)
    args = ap.parse_args()

    env = load_env()
    if not env.get("api"):
        print("[error] .env 缺少 api url model", file=sys.stderr)
        return 1

    targets = find_targets(args.list_file, args.arxiv_id)
    if args.limit and args.limit > 0:
        targets = targets[args.offset:args.offset + args.limit]
    print(f"[scan] 待处理 {len(targets)} 篇 (dry-run={not args.write})")
    if not targets:
        return 0

    ok = skipped = failed = 0
    for i, md in enumerate(targets, 1):
        print(f"[{i}/{len(targets)}]", flush=True)
        r = process_one(md, env, dry_run=not args.write)
        if r == "ok":
            ok += 1
        elif r == "skipped":
            skipped += 1
        else:
            failed += 1
        time.sleep(0.3)  # 避免限流

    print(f"\n[backfill_zh] 完成: ok={ok} skipped={skipped} failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())