"""PR-7 Citation Guard — Deep Dive 引用核查 CLI

对齐 Polaris paper_review.py::check_citation_existence + review_passed:
- 三态存在性分类: exact / minor / fabricated
- 支持轴: supported / partial / unsupported (需 --run-support-check 开启)
- PASS_RATING = 6.0 → 简化为 (no fabricated) AND (supported / checked >= 0.6)
- 默认 run_support_check: false,只跑 existence 三源核查,不调 LLM

CLI 入口:
    python -m citation_guard docs/papers/.../<id>-slug.md
    python -m citation_guard docs/papers/.../<id>-slug.md --library library.json
    python -m citation_guard docs/papers/.../<id>-slug.md --run-support-check --paper-fulltext paper.txt

写出 <md>.citations.json,退出码:
    0  pass
    1  调用错误(md 不存在等)
    2  pass=false(fabricated > 0)
"""
from __future__ import annotations

import argparse
import datetime
import difflib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

# -----------------------------------------------------------------------------
# 常量 (plan §5, 对齐 Polaris paper_review.py:222-242)
# -----------------------------------------------------------------------------

EXACT_SIMILARITY = 0.92
MINOR_SIMILARITY = 0.75
YEAR_TOLERANCE = 1
NUMBER_TOLERANCE = 0.01
MAX_SUPPORT_CHECKS = 30
MAX_GUARDRAIL_REGENS = 2
PASS_RATING = 6.0  # 通过分,简化为 supported/checked >= 0.6

CITE_MARKER_RE = re.compile(r"\[(\d+)\]")
# 引用列表行:[N] 作者, 年份. 标题
# 行内形如: "[1] Lewis et al., 2020. Retrieval-Augmented Generation ..."
# 或:      "[2] Some Paper Title, 2024"  (无 . 终止)
# 正则策略:先剥前导 "[N] ",剩余部分在第一个 ", YYYY." 或 ", YYYY" 处切年份,标题为切后剩余。
CITE_REF_LINE_RE = re.compile(r"^\s*\[(\d+)\]\s+(.+?)\s*$")
CITE_YEAR_AT_END_RE = re.compile(r",\s*(\d{4})\s*\.?\s*$")
CITE_YEAR_INNER_RE = re.compile(r",\s*(\d{4})\s*\.\s*")

REF_SECTION_HEADERS = (
    "## 参考文献",
    "## References",
    "## 七、相关工作",
    "## Related Work",
)


def _normalize_title(s: str) -> str:
    """lowercase + 去标点(Unicode 范围允许 CJK 字符)"""
    s = s.lower().strip()
    return re.sub(r"[^a-z0-9一-鿿\s]", "", s).strip()


def _similarity(a: str, b: str) -> float:
    """归一化标题后的 SequenceMatcher ratio"""
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, _normalize_title(a), _normalize_title(b)).ratio()


# -----------------------------------------------------------------------------
# 引用提取 (plan §7)
# -----------------------------------------------------------------------------


def extract_citations(md_text: str) -> list[dict]:
    """从 md 中提取 [N] 标记 + 文末的引用列表。

    返回 [{marker, title, year}, ...],只保留正文(不含引用段)中实际出现过的 marker。
    """
    # 找到引用段起始位置,只从它之前的正文里收集 markers
    ref_idx = -1
    for header in REF_SECTION_HEADERS:
        idx = md_text.find(header)
        if idx >= 0:
            ref_idx = idx
            break
    body_text = md_text if ref_idx < 0 else md_text[:ref_idx]
    markers = set(int(m) for m in CITE_MARKER_RE.findall(body_text))

    ref_section = ""
    if ref_idx >= 0:
        ref_section = md_text[ref_idx:]

    refs: list[dict] = []
    for line in ref_section.split("\n"):
        m = CITE_REF_LINE_RE.match(line)
        if not m:
            continue
        n = int(m.group(1))
        # 文中没出现的 marker 跳过(避免误核查文末列表里的虚引用)
        if markers and n not in markers:
            continue
        body = m.group(2).strip()
        year: int | None = None
        title = body
        # 形式 1:文末 ", YYYY" 或 ", YYYY."
        ym = CITE_YEAR_AT_END_RE.search(body)
        if ym:
            year = int(ym.group(1))
            title = body[: ym.start()].rstrip(" .,;")
        else:
            # 形式 2:文中 ", YYYY. Title"
            ym2 = CITE_YEAR_INNER_RE.search(body)
            if ym2:
                year = int(ym2.group(1))
                title = body[ym2.end() :].strip().rstrip(".")
            else:
                # 形式 3:"Author YYYY. Title"(无逗号),常见于简短引用
                ym3 = re.search(r"\b(\d{4})\b\.?\s+(.+)$", body)
                if ym3:
                    year = int(ym3.group(1))
                    title = ym3.group(2).strip().rstrip(".")
        if year is None:
            title = title.rstrip(".")
        refs.append(
            {
                "marker": f"[{n}]",
                "title": title,
                "year": year,
            }
        )
    return refs


# -----------------------------------------------------------------------------
# 三源核查 (plan §6)
# -----------------------------------------------------------------------------


def search_library(title: str, year: int | None, library_papers: list[dict]) -> dict | None:
    """Step 1: 库内精确匹配(similarity >= 0.99)"""
    for p in library_papers:
        p_title = p.get("title", "")
        sim = _similarity(title, p_title)
        if sim < 0.99:
            continue
        p_year_raw = p.get("year")
        try:
            p_year = int(p_year_raw) if p_year_raw is not None else year
        except (TypeError, ValueError):
            p_year = year
        if year is None:
            return {
                "source": "library",
                "paper_id": p.get("id"),
                "title": p_title,
                "year": p_year_raw,
                "similarity": sim,
                "year_tolerance": 0,
            }
        if p_year is not None and abs(int(p_year) - int(year)) <= YEAR_TOLERANCE:
            return {
                "source": "library",
                "paper_id": p.get("id"),
                "title": p_title,
                "year": p_year_raw,
                "similarity": sim,
                "year_tolerance": abs(int(p_year) - int(year)),
            }
    return None


def search_semantic_scholar(
    title: str,
    year: int | None = None,
    rate_limit_per_min: int = 100,
    retry_max: int = 5,
    sleep_fn: Any = time.sleep,
) -> tuple[list[dict], bool]:
    """Step 2: S2 API。遇 429 指数退避(1/2/4/8/16s)。

    返回 (hits, network_ok):
      - network_ok=True:成功调了 API,可能 0 hits 也算 OK(没找到)
      - network_ok=False:网络 / 解析失败,plan §4.3 「network outage 不应
        标记为 fabricated」

    历史:之前直接返 list,failure → [] 容易被 caller 误判为「fabricated」。
    现在 caller 必须看 network_ok 显式区分「远程确认没有」与「根本没调通」。
    """
    url = (
        "https://api.semanticscholar.org/graph/v1/paper/search?"
        f"query={urllib.parse.quote(title)}&limit=5&fields=title,year"
    )
    last_err: str | None = None
    for attempt in range(retry_max):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "DPR-citation-guard/1.0"}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return [
                    {"title": h.get("title", ""), "year": h.get("year")}
                    for h in data.get("data", [])
                ], True
        except urllib.error.HTTPError as e:
            last_err = str(e)
            if e.code == 429 and attempt < retry_max - 1:
                sleep_fn(2**attempt)
                continue
            return [], False
        except Exception as e:
            last_err = str(e)
            return [], False
    return [], False


def search_openalex(title: str, year: int | None = None) -> tuple[list[dict], bool]:
    """Step 3: OpenAlex fallback(polite pool 含 mailto UA)。

    同上,返回 (hits, network_ok) 二元组。
    """
    url = (
        "https://api.openalex.org/works?"
        f"search={urllib.parse.quote(title)}&per_page=5"
    )
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "DPR-citation-guard/1.0 (mailto:maintainer@example.com)"
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return [
                {"title": h.get("title", ""), "year": h.get("publication_year")}
                for h in data.get("results", [])
            ], True
    except Exception:
        return [], False


def _year_within_tolerance(hit_year: int | None, ref_year: int | None) -> int:
    """返回 year_tolerance,无法判定返回 YEAR_TOLERANCE(视为容忍)"""
    if hit_year is None or ref_year is None:
        return YEAR_TOLERANCE
    return abs(int(hit_year) - int(ref_year))


def check_citation_existence(citation: dict, library_papers: list[dict]) -> tuple[str, dict | None]:
    """plan §4.3 双轴 evidence 模型 + 三源核查。

    返回 (existence, match_info):
      - existence ∈ {"exact", "minor", "fabricated", "not_checked"}
      - match_info 含 source/title/year/similarity/year_tolerance

    「not_checked」语义(plan §4.3 验收 2):网络不可用时,远程两源全部失败,
    不应判定 fabricated —— 把 fabricated 留给「远程确认找不到」的情况。
    """
    title = citation["title"]
    year = citation.get("year")

    # Step 1 — 库内(本地,不需要网络)
    lib = search_library(title, year, library_papers)
    if lib:
        return "exact", lib

    # Step 2 — S2
    s2_hits, s2_ok = search_semantic_scholar(title, year)
    if s2_ok and s2_hits:
        best = max(s2_hits, key=lambda h: _similarity(title, h.get("title", "")))
        sim = _similarity(title, best.get("title", ""))
        if sim >= EXACT_SIMILARITY and _year_within_tolerance(best.get("year"), year) <= YEAR_TOLERANCE:
            return "exact", {
                "source": "semantic_scholar",
                "title": best.get("title"),
                "year": best.get("year"),
                "similarity": sim,
                "year_tolerance": _year_within_tolerance(best.get("year"), year),
            }

    # Step 3 — OpenAlex fallback
    oa_hits, oa_ok = search_openalex(title, year)
    if oa_ok and oa_hits:
        best = max(oa_hits, key=lambda h: _similarity(title, h.get("title", "")))
        sim = _similarity(title, best.get("title", ""))
        if sim >= MINOR_SIMILARITY:
            return "minor", {
                "source": "openalex",
                "title": best.get("title"),
                "year": best.get("year"),
                "similarity": sim,
                "year_tolerance": _year_within_tolerance(best.get("year"), year),
            }

    # 区分:远程两源都网络挂了 → not_checked;都 OK 但 0 hits → fabricated
    if not s2_ok and not oa_ok:
        return "not_checked", {
            "source": "none",
            "reason": "remote APIs unreachable; cannot verify",
        }
    return "fabricated", None


def _extract_claim_context(md_text: str, marker: str, window: int = 200) -> str:
    """Find marker in md body, return ±window chars around it."""
    # marker like "[1]" -> escape for regex
    escaped = re.escape(marker)
    m = re.search(escaped, md_text)
    if not m:
        return ""
    pos = m.start()
    start = max(0, pos - window)
    end = min(len(md_text), pos + window)
    return md_text[start:end]


def check_citation_support(
    citation: dict,
    claim_context: str,
    paper_abstract_or_fulltext: str | None,
    call=None,
) -> str:
    """Return "supported" | "partial" | "unsupported" | "not_checked".

    Uses injected `call` if provided (test seam), else routes through
    `get_llm_router().call("cite.guard", ...)`. If no LLM is configured or
    it fails, returns "not_checked" (do NOT silently mis-classify).

    Args:
        citation: {marker, title, year} from extract_citations
        claim_context: 1-3 sentence snippet of paper text around the [N] marker
        paper_abstract_or_fulltext: optional abstract/fulltext to ground the
            judgment — used as the "evidence to check against". If None, return
            "not_checked" (can't judge without the paper text).
        call: optional override (callable taking prompt → dict response)
    """
    if not paper_abstract_or_fulltext:
        return "not_checked"

    prompt = f'''你是引用核查员。论文正文片段说:

"""
{claim_context}
"""

正文引用了 [{citation['marker']}] 「{citation['title']}」({citation.get('year') or '?'}).

该论文的摘要/全文:
"""
{paper_abstract_or_fulltext}
"""

请判断该引用是否支持正文陈述:
- "supported": 论文明确支持正文的陈述
- "partial": 论文部分支持,但范围 / 条件与正文不一致
- "unsupported": 论文与正文陈述矛盾,或正文夸大了论文结论

只输出 JSON: {{"support": "<supported|partial|unsupported>", "reason": "<一句话>"}}'''

    try:
        if call is not None:
            resp = call(prompt)
            # Direct dict response from injected call
            if isinstance(resp, dict):
                support = resp.get("support", "")
                if support in ("supported", "partial", "unsupported"):
                    return support
        else:
            from src.llm_router import get_llm_router

            router = get_llm_router()
            resp = router.call(
                "cite.guard",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
            )
            # Extract content from response
            content = ""
            if hasattr(resp, "choices") and resp.choices:
                content = resp.choices[0].message.content or ""
            elif isinstance(resp, dict):
                content = resp.get("content", "") or ""
            if content:
                # Parse JSON from content
                import json

                data = json.loads(content)
                support = data.get("support", "")
                if support in ("supported", "partial", "unsupported"):
                    return support
    except Exception:
        pass
    return "not_checked"


# -----------------------------------------------------------------------------
# review_passed (plan §6)
# -----------------------------------------------------------------------------


def review_passed(summary: dict, citations: list[dict]) -> bool:
    """plan §4.3 review_passed 双轴模型。

    规则:
      1. 有任何 fabricated → False(已知出错)
      2. not_checked 不算 pass 也不算 fail —— 它是「网络挂了,这次没查」
      3. support check 跑过的部分(supported + partial + unsupported)中,
         supported 占比 ≥ PASS_RATING/10 才算 pass

    与历史的差异:之前 `if checked == 0: return True` 把「没跑 support」
    当作 pass —— 这是 plan §4.3 验收 4「把 fabricated 与 unsupported 分别
    计数,pass 逻辑明确为无 fabricated + checked support 达标,不把 minor
    直接当 support」里要修的 bug。
    """
    has_fabricated = any(c.get("existence") == "fabricated" for c in citations)
    if has_fabricated:
        return False
    # 支持性轴:只统计 support check 实际跑过的部分,not_checked 不算分母
    checked = (
        summary.get("supported", 0)
        + summary.get("partial", 0)
        + summary.get("unsupported", 0)
    )
    if checked == 0:
        # 没跑 support check → 保守视为 pass,但要求 existence 全 exact
        # (无 fabricated / minor / not_checked)
        not_passable = (
            summary.get("fabricated", 0)
            + summary.get("not_checked", 0)
            + summary.get("minor", 0)
        )
        return not_passable == 0
    return summary.get("supported", 0) / checked >= PASS_RATING / 10


# -----------------------------------------------------------------------------
# 主入口
# -----------------------------------------------------------------------------


def run_guard(md_path: str | Path, config: dict | None = None) -> dict:
    """扫 md → 核查引用 → 写 *.citations.json → 返回 verdict dict"""
    md_path = Path(md_path)
    if not md_path.exists():
        raise FileNotFoundError(f"md not found: {md_path}")
    config = config or {}
    md_text = md_path.read_text(encoding="utf-8")
    # paper_id 取文件名第一段,如 2510.18483v1-starbench-rpg → 2510.18483v1
    paper_id = md_path.stem.split("-")[0]
    citations = extract_citations(md_text)

    library = config.get("library_papers", [])
    checked: list[dict] = []
    for c in citations:
        existence, match = check_citation_existence(c, library)
        checked.append(
            {
                "marker": c["marker"],
                "raw_text": c["title"],
                "existence": existence,
                "support": "not_checked",
                "match": match,
            }
        )

    # Support check: gated by config flag, requires paper_fulltext
    run_support_check = config.get("run_support_check", False)
    paper_fulltext = config.get("paper_fulltext")
    support_call = config.get("support_call")  # For testing: inject LLM call function
    if not paper_fulltext:
        # Try loading from file path
        fulltext_path = config.get("paper_fulltext_path")
        if fulltext_path and Path(fulltext_path).exists():
            paper_fulltext = Path(fulltext_path).read_text(encoding="utf-8")

    support_counts = {"supported": 0, "partial": 0, "unsupported": 0, "not_checked": 0}
    if run_support_check and paper_fulltext:
        # Only check citations with existence in {exact, minor}
        eligible = [c for c in checked if c["existence"] in ("exact", "minor")]
        # Respect MAX_SUPPORT_CHECKS limit
        to_check = eligible[:MAX_SUPPORT_CHECKS]
        for c in to_check:
            claim_ctx = _extract_claim_context(md_text, c["marker"])
            support = check_citation_support(
                citation={"marker": c["marker"], "title": c["raw_text"], "year": None},
                claim_context=claim_ctx,
                paper_abstract_or_fulltext=paper_fulltext,
                call=support_call,
            )
            c["support"] = support
            support_counts[support] = support_counts.get(support, 0) + 1
        # Remaining eligible citations (not checked due to limit) stay not_checked
        remaining = len(eligible) - len(to_check)
        support_counts["not_checked"] = support_counts.get("not_checked", 0) + remaining

    summary = {
        "total": len(checked),
        "exact": sum(1 for c in checked if c["existence"] == "exact"),
        "minor": sum(1 for c in checked if c["existence"] == "minor"),
        "fabricated": sum(1 for c in checked if c["existence"] == "fabricated"),
        "not_checked": sum(1 for c in checked if c["existence"] == "not_checked"),
        "supported": support_counts.get("supported", 0),
        "partial": support_counts.get("partial", 0),
        "unsupported": support_counts.get("unsupported", 0),
    }
    passed = review_passed(summary, checked)

    out = {
        "paper_id": paper_id,
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "pass": passed,
        "pass_rating": PASS_RATING,
        "summary": summary,
        "citations": checked,
        "fabricated_action": config.get("fabricated_action", "replace_with_question_mark"),
    }

    out_path = md_path.with_suffix(".citations.json")
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="DPR Citation Guard")
    parser.add_argument("md_path", help="Path to the markdown file to scan")
    parser.add_argument("--library", help="Optional path to library JSON", default=None)
    parser.add_argument(
        "--run-support-check",
        action="store_true",
        help="Enable LLM support axis check (supported/partial/unsupported)",
    )
    parser.add_argument(
        "--paper-fulltext",
        help="Path to paper fulltext/abstract for support check",
    )
    args = parser.parse_args(argv)

    config: dict = {}
    if args.library and Path(args.library).exists():
        config["library_papers"] = json.loads(Path(args.library).read_text(encoding="utf-8"))

    if args.run_support_check:
        config["run_support_check"] = True
    if args.paper_fulltext:
        config["paper_fulltext_path"] = args.paper_fulltext

    md_path = Path(args.md_path)
    if not md_path.exists():
        print(f"[ERROR] md not found: {md_path}", file=sys.stderr)
        return 1

    try:
        result = run_guard(md_path, config)
    except FileNotFoundError as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1

    s = result["summary"]
    print(
        f"[citation_guard] {md_path.name} pass={result['pass']} "
        f"total={s['total']} exact={s['exact']} minor={s['minor']} fabricated={s['fabricated']}"
    )
    if s.get("supported", 0) or s.get("partial", 0) or s.get("unsupported", 0):
        print(
            f"  support: supported={s['supported']} partial={s['partial']} unsupported={s['unsupported']}"
        )
    if not result["pass"]:
        if s["fabricated"] > 0:
            return 2
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
