#!/usr/bin/env python3
"""Demo: 真 LLM 跑 paper.deep_extract + project.idea_forge 一次。

用法:
  # 1) 写一个 deepseek / openai / 任意 OpenAI-compatible key 到 .env:
  echo 'LLM_API_KEY=sk-xxx' >> .env
  echo 'LLM_BASE_URL=https://api.deepseek.com/v1' >> .env
  echo 'LLM_MODEL=deepseek-chat' >> .env

  # 2) 跑:
  python tools/demo_prompts.py --arxiv 2607.23029v1
  python tools/demo_prompts.py --arxiv 2607.23029v1 --project papers_2026_08

输出:
  - dist/demo/deep-extract-<arxiv>.json   (deep-extract LLM 输出,原始)
  - dist/demo/idea-bank-<project>.json   (idea-forge LLM 输出,原始)
  - 控制台打印自我评分

目的: 让用户在浏览器之外也能 (a) 验证 prompt 真的能产生可解析 JSON;
(b) 看 LLM 实际输出 vs Round 2 prompt 的字段要求对比;
(c) 用 6 维 rubric 自打分。

不做的事:
  - 不写回 docs/ 或 frontmatter (避免污染 repo)
  - 不调 GitHub Actions / 不动 Gist / 不动 IDB
  - 不调 backfill (那是另一个脚本)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env() -> dict[str, str]:
    """从 .env 读 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL"""
    env = {}
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    # env override
    for k in ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"):
        if k in os.environ:
            env[k] = os.environ[k]
    return env


def call_llm(prompt_body: str, paper_text: str, env: dict) -> str:
    """调 LLM (OpenAI compatible chat completions)。失败抛 RuntimeError。"""
    if not env.get("LLM_API_KEY"):
        raise RuntimeError("LLM_API_KEY 未设置 — 看本文件 docstring 第 1 步")
    import urllib.request

    base = env.get("LLM_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
    model = env.get("LLM_MODEL", "deepseek-chat")
    url = f"{base}/chat/completions"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": prompt_body},
            {"role": "user", "content": paper_text[:12000]},  # 12K char 上限
        ],
        "temperature": 0.2,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {env['LLM_API_KEY']}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    return result["choices"][0]["message"]["content"]


def load_prompt(pack_path: Path) -> str:
    """从 config/prompts/<pack>/<date>/body.md 读 prompt body"""
    body = pack_path / "body.md"
    if not body.exists():
        raise RuntimeError(f"Prompt not found: {body}")
    return body.read_text(encoding="utf-8")


def load_paper(arxiv_id: str) -> tuple[str, str]:
    """从 docs/papers/ 找一篇论文 + 它的 .txt 全文(如有)"""
    # 简化: 只读 frontmatter
    md_files = list((ROOT / "docs" / "papers").rglob(f"*{arxiv_id}*.md"))
    if not md_files:
        raise RuntimeError(f"No paper found for arxiv={arxiv_id}")
    md = md_files[0]
    text = md.read_text(encoding="utf-8")
    # 截 frontmatter (--- 之间)
    if text.startswith("---"):
        end = text.find("\n---\n", 4)
        if end != -1:
            text = text[end + 5:]
    title = md.name.replace(".md", "")
    return title, text


def load_paper_summary(arxiv_id: str, max_chars: int = 600) -> str:
    """给 idea-forge 用: 返回 "arXiv:ID Title — 首段摘要" 紧凑版。"""
    md_files = list((ROOT / "docs" / "papers").rglob(f"*{arxiv_id}*.md"))
    if not md_files:
        return ""
    text = md_files[0].read_text(encoding="utf-8")
    # 截 frontmatter 之后
    if text.startswith("---"):
        end = text.find("\n---\n", 4)
        if end != -1:
            text = text[end + 5:]
    # 取首段
    first_para = text.strip().split("\n\n")[0]
    # 截 frontmatter 的 title 行 (--- 之后的第一行)
    lines = text.strip().splitlines()
    title = lines[0].lstrip("# ").strip() if lines else md_files[0].stem
    canonical = re.sub(r"v\d+$", "", arxiv_id)
    summary = first_para[:max_chars].replace("\n", " ").strip()
    return f'arXiv:{canonical} "{title}" — {summary}'


def strip_thinking(raw: str) -> str:
    """剥掉 LLM 输出的 <think>...</think> 思考块 (Qwen/MiniMax/DeepSeek R1 类模型常见)。"""
    import re
    s = raw
    # 多行匹配: <think>...</think> 或 <think> ... </think> (任意空白)
    s = re.sub(r"<think>[\s\S]*?</think>", "", s, flags=re.IGNORECASE)
    s = re.sub(r"<thinking>[\s\S]*?</thinking>", "", s, flags=re.IGNORECASE)
    return s.strip()


def strip_markdown_fences(raw: str) -> str:
    """LLM 偶尔仍会包 ```json ... ```,剥掉。"""
    s = raw.strip()
    if s.startswith("```"):
        first_nl = s.find("\n")
        if first_nl != -1:
            s = s[first_nl + 1:]
        if s.endswith("```"):
            s = s[:-3]
    return s.strip()


def self_score_deep_extract(parsed: dict) -> dict[str, float]:
    """6 维 rubric 自动打分 (Round 2 prompt 验证)。"""
    scores = {}

    # D1 Faithfulness — proxy: metric.context 是否含具体场景词 + 数字 + baseline
    # LLM 实际有两种 grounding 方式:
    #   (a) 硬锚点: Table N / Figure N / Section X.Y / page N
    #   (b) 语义锚点: 具体任务名 (Quadratic/MNIST/...) + 具体设置 (T=50/n=10/ε_total≈5) + baseline 名 (DP-GM/FedAvg/...)
    # 两种都算 grounded,语义锚点往往更可读
    metrics = parsed.get("reported_metrics", [])
    if metrics:
        hard_anchor = {"table", "figure", "section", "page"}
        scene_words = {"quadratic", "logistic", "mnist", "cifar", "glue", "squad",
                       "humaneval", "mmlu", "gsm", "gsm8k", "toy", "imagenet",
                       "t=", "n=", "ε", "epsilon", "round", "epoch", "shot", "batch"}
        baseline_words = {"baseline", "dp-gm", "fedavg", "non-private", "private",
                          "ppo", "dqn", "lora", "full fine-tune", "sft", "rlhf",
                          "4-bit", "8-bit", "fp16", "fp32", "quantized"}
        def has_grounding(ctx: str) -> bool:
            c = ctx.lower()
            return (any(k in c for k in hard_anchor)
                    or (any(k in c for k in scene_words) and any(k in c for k in baseline_words)))
        traceable = sum(1 for m in metrics if has_grounding(str(m.get("context", ""))))
        scores["D1"] = round(traceable / len(metrics) * 5, 2)
    else:
        scores["D1"] = 1.0

    # D2 Completeness — 5 字段全有
    fields = ["reported_metrics", "datasets", "compute_requirements", "limitations", "replicability_score", "replicability_reason"]
    present = sum(1 for f in fields if f in parsed)
    scores["D2"] = round(present / len(fields) * 5, 2)

    # D3 Specificity — proxy: value 不是模糊词
    fuzzy = {"large", "significant", "substantial", "approximately", "around", "various", "several"}
    if metrics:
        specific = sum(1 for m in metrics if not any(w in str(m.get("value", "")).lower() for w in fuzzy))
        scores["D3"] = round(specific / len(metrics) * 5, 2)
    else:
        scores["D3"] = 1.0

    # D4 Limitation depth — proxy: 含具体场景词
    lims = parsed.get("limitations", [])
    if lims:
        depth_words = {"specific", "n", "out-of-distribution", "real-time", "cross-domain", "OOD", "low-resource"}
        scored = sum(1 for l in lims if any(w in str(l).lower() for w in depth_words) or len(str(l)) > 30)
        scores["D4"] = round(scored / len(lims) * 5, 2)
    else:
        scores["D4"] = 1.0

    # D5 Replicability — proxy: score 在 1-5 且 reason > 20 字
    score_val = parsed.get("replicability_score", 0)
    reason = parsed.get("replicability_reason", "")
    if 1 <= score_val <= 5 and len(str(reason)) > 20:
        scores["D5"] = 4.5
    elif 1 <= score_val <= 5:
        scores["D5"] = 2.5
    else:
        scores["D5"] = 1.0

    # D6 JSON hygiene — 字段类型正确
    try:
        assert isinstance(parsed.get("reported_metrics", []), list)
        assert isinstance(parsed.get("datasets", []), list)
        assert isinstance(parsed.get("limitations", []), list)
        scores["D6"] = 5.0
    except AssertionError:
        scores["D6"] = 2.0

    return scores


def self_score_idea_forge(parsed: dict, valid_arxiv_ids: set[str]) -> dict[str, float]:
    """6 维 rubric 自动打分 (Round 2 idea-forge prompt 验证)。"""
    ideas = parsed.get("ideas", [])
    scores = {}

    # I1 Concrete — proxy: hypothesis 含数字 + eval_design 含 baseline + metric
    if ideas:
        concrete = 0
        for idea in ideas:
            hyp = str(idea.get("hypothesis", "")) + " " + str(idea.get("expected_outcome", ""))
            ev = str(idea.get("eval_design", ""))
            has_num = any(ch.isdigit() for ch in hyp)
            has_baseline = any(w in ev.lower() for w in ["baseline", "vs", "compare", "against"])
            has_metric = any(w in ev.lower() for w in ["accuracy", "f1", "bleu", "rouge", "mse", "reward", "return", "loss", "pass@", "win rate", "sample efficiency"])
            if has_num and (has_baseline or has_metric):
                concrete += 1
        scores["I1"] = round(concrete / len(ideas) * 5, 2)
    else:
        scores["I1"] = 1.0

    # I2 Grounded — proxy: rationale 含 "demonstrated / showed / Gap:" 等 grounding 词
    if ideas:
        grounded = sum(1 for i in ideas if any(w in str(i.get("rationale", "")).lower()
                                                  for w in ["demonstrated", "showed", "show", "gap:", "et al.", "(20", "arXiv:", "paper"]))
        scores["I2"] = round(grounded / len(ideas) * 5, 2)
    else:
        scores["I2"] = 1.0

    # I3 Novel — proxy: novelty ≥ 4 的 idea 占比 + 含 "exceeds" / "novel" 词
    if ideas:
        novel_count = sum(1 for i in ideas if int(i.get("novelty", 0)) >= 4)
        has_exceeds = sum(1 for i in ideas if "exceeds" in str(i.get("rationale", "")).lower() or "novel" in str(i.get("rationale", "")).lower())
        # 至少 1 个 novelty ≥ 4 → 满分
        scores["I3"] = 5.0 if novel_count >= 1 and has_exceeds >= 1 else (3.5 if novel_count >= 1 else 2.0)
    else:
        scores["I3"] = 1.0

    # I4 Feasible — proxy: feasibility ≥ 3 的 idea 占比
    if ideas:
        feas = sum(1 for i in ideas if 3 <= int(i.get("feasibility", 0)) <= 5)
        scores["I4"] = round(feas / len(ideas) * 5, 2)
    else:
        scores["I4"] = 1.0

    # I5 Diverse — proxy: rationale 含不同方法/任务名 + cited 引用对去重
    if ideas:
        # 方法词池 (扩展到 RL / game AI / 通用 ML)
        method_words = {
            "lora", "rlhf", "ppo", "dqn", "quantiz", "federated", "transformer",
            "diffusion", "rag", "agent", "graph", "retrieval", "fine-tune", "adapter",
            "prune", "self-play", "psro", "nash", "curriculum", "shield", "shielding",
            "mcts", "td(λ)", "value network", "policy", "reward", "imitation",
            "distillation", "ensemble", "monte carlo", "tree search", "exploration",
        }
        found_words = set()
        for i in ideas:
            r = str(i.get("rationale", "")).lower() + " " + str(i.get("title", "")).lower()
            for w in method_words:
                if w in r:
                    found_words.add(w)
        # citedArxivIds 组合多样性 (不同引用组合数)
        cited_pairs = set()
        for i in ideas:
            cids = tuple(sorted(i.get("citedArxivIds", []) or []))
            if cids:
                cited_pairs.add(cids)
        # 综合: 方法词 ≥ 3 或 引用组合 ≥ 3 → 5; ≥ 2 → 4; else 2.5
        diversity = max(len(found_words), len(cited_pairs))
        scores["I5"] = 5.0 if diversity >= 3 else (4.0 if diversity >= 2 else 2.5)
    else:
        scores["I5"] = 1.0

    # I6 Cited — proxy: citedArxivIds 至少 1 条, 且都来自 valid_arxiv_ids
    if ideas:
        cited_total = 0
        cited_valid = 0
        for i in ideas:
            cids = i.get("citedArxivIds", [])
            if isinstance(cids, list) and cids:
                cited_total += 1
                if all(c in valid_arxiv_ids for c in cids):
                    cited_valid += 1
        if cited_total >= len(ideas) * 0.8:
            scores["I6"] = 5.0 if cited_valid == cited_total else 4.0
        else:
            scores["I6"] = round(cited_total / len(ideas) * 5, 2)
    else:
        scores["I6"] = 1.0

    return scores


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arxiv", help="e.g. 2607.23029v1 — run paper.deep_extract on this paper")
    ap.add_argument("--papers", help="comma-separated arxiv ids — run project.idea_forge on this set")
    ap.add_argument("--out-dir", default="dist/demo", help="output dir")
    args = ap.parse_args()

    if not args.arxiv and not args.papers:
        ap.error("must specify either --arxiv or --papers")
    if args.arxiv and args.papers:
        ap.error("--arxiv and --papers are mutually exclusive")

    env = load_env()
    print(f"[demo] model={env.get('LLM_MODEL', '???')} base={env.get('LLM_BASE_URL', '???')}")
    out_dir = ROOT / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.arxiv:
        print(f"[demo] mode=deep-extract arxiv={args.arxiv}")
        title, paper_text = load_paper(args.arxiv)
        print(f"[demo] paper title: {title[:60]}...")

        pack_paths = list(ROOT.glob("config/prompts/paper-deep-extract/*/"))
        if not pack_paths:
            raise RuntimeError("No paper-deep-extract prompt pack found")
        pack_path = pack_paths[0]
        prompt = load_prompt(pack_path)
        print(f"[demo] loaded prompt ({len(prompt)} chars)")

        raw = call_llm(prompt, paper_text, env)
        clean = strip_thinking(raw)
        clean = strip_markdown_fences(clean)

        out_path = out_dir / f"deep-extract-{args.arxiv}.json"
        out_path.write_text(clean, encoding="utf-8")
        print(f"[demo] saved → {out_path.relative_to(ROOT)}")

        try:
            parsed = json.loads(clean)
            print("[demo] ✅ JSON parse OK")
            scores = self_score_deep_extract(parsed)
            print(f"[demo] self-score: {scores}")
            print(f"[demo] avg = {round(sum(scores.values()) / len(scores), 2)} / 5")
        except json.JSONDecodeError as e:
            print(f"[demo] ❌ JSON parse FAIL: {e}")
            print(f"[demo] raw output first 200 chars:\n{clean[:200]}")
            return 1
        return 0

    if args.papers:
        arxiv_ids = [x.strip() for x in args.papers.split(",") if x.strip()]
        print(f"[demo] mode=idea-forge papers={arxiv_ids}")

        # 加载每篇的简短摘要作为 LLM 输入
        paper_blurbs = []
        valid_ids = set()
        for aid in arxiv_ids:
            blurb = load_paper_summary(aid)
            if not blurb:
                print(f"[demo] ⚠️  paper not found: {aid}")
                continue
            paper_blurbs.append(blurb)
            valid_ids.add(re.sub(r"v\d+$", "", aid))
        if not paper_blurbs:
            raise RuntimeError("No papers found for idea-forge input")
        papers_context = "Papers:\n" + "\n".join(f"{i+1}. {b}" for i, b in enumerate(paper_blurbs))

        pack_paths = list(ROOT.glob("config/prompts/idea-forge/*/"))
        if not pack_paths:
            raise RuntimeError("No idea-forge prompt pack found")
        pack_path = pack_paths[0]
        prompt_body = load_prompt(pack_path)
        print(f"[demo] loaded idea-forge prompt ({len(prompt_body)} chars)")

        raw = call_llm(prompt_body, papers_context, env)
        clean = strip_thinking(raw)
        clean = strip_markdown_fences(clean)

        out_path = out_dir / f"idea-bank-{'+'.join(arxiv_ids[:3])}.json"
        out_path.write_text(clean, encoding="utf-8")
        print(f"[demo] saved → {out_path.relative_to(ROOT)}")

        try:
            parsed = json.loads(clean)
            print("[demo] ✅ JSON parse OK")
            scores = self_score_idea_forge(parsed, valid_ids)
            print(f"[demo] self-score: {scores}")
            print(f"[demo] avg = {round(sum(scores.values()) / len(scores), 2)} / 5")
            print(f"[demo] ideas: {len(parsed.get('ideas', []))}")
        except json.JSONDecodeError as e:
            print(f"[demo] ❌ JSON parse FAIL: {e}")
            print(f"[demo] raw output first 200 chars:\n{clean[:200]}")
            return 1
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())