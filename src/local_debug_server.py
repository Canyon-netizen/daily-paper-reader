#!/usr/bin/env python3
"""本地调试后端：静态托管前端，并把工作流触发映射成本地子进程。"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None

ROOT_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT_DIR / ".env"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def norm_text(value: Any) -> str:
    return str(value or "").strip()


def build_secret_env(secret: dict[str, Any] | None) -> dict[str, str]:
    if not isinstance(secret, dict):
        return {}
    summarized = secret.get("summarizedLLM") if isinstance(secret.get("summarizedLLM"), dict) else {}
    chat_llms = secret.get("chatLLMs") if isinstance(secret.get("chatLLMs"), list) else []
    first_chat = chat_llms[0] if chat_llms and isinstance(chat_llms[0], dict) else {}

    api_key = norm_text(summarized.get("apiKey") or first_chat.get("apiKey"))
    base_url = norm_text(summarized.get("baseUrl") or first_chat.get("baseUrl"))
    model = norm_text(summarized.get("model"))
    if not model and isinstance(first_chat.get("models"), list) and first_chat.get("models"):
        model = norm_text(first_chat.get("models")[0])

    env: dict[str, str] = {}
    if summarized or first_chat:
        env["SUMMARY_API_KEY"] = api_key
        env["DEEPSEEK_API_KEY"] = api_key
        env["SUMMARY_BASE_URL"] = base_url
        env["DEEPSEEK_BASE_URL"] = base_url
        env["LLM_PRIMARY_BASE_URL"] = base_url
        env["SUMMARY_MODEL"] = model
        env["DEEPSEEK_MODEL"] = model

    reranker = secret.get("rerankerLLM") if isinstance(secret.get("rerankerLLM"), dict) else {}
    rerank_profile = norm_text(reranker.get("profile"))
    rerank_provider = norm_text(reranker.get("provider") or reranker.get("type"))
    rerank_model = norm_text(reranker.get("model"))
    rerank_key = norm_text(reranker.get("apiKey"))
    rerank_base = norm_text(reranker.get("baseUrl"))
    if reranker:
        env["RERANK_PROFILE"] = rerank_profile
        env["RERANK_PROVIDER"] = rerank_provider
        env["RERANK_MODEL"] = rerank_model
        env["RERANK_API_KEY"] = rerank_key
        env["RERANK_API_BASE_URL"] = rerank_base
        if rerank_provider == "public_zwwen":
            env["PUBLIC_RERANK_API_KEY"] = rerank_key
            env["PUBLIC_RERANK_API_BASE_URL"] = rerank_base
        if rerank_provider == "siliconflow":
            env["SILICONFLOW_API_KEY"] = rerank_key
            env["SILICONFLOW_RERANK_URL"] = rerank_base
    return env


def quote_env_value(value: str) -> str:
    text = str(value or "")
    if not text:
        return ""
    if any(ch.isspace() or ch in {'"', "'", "#", "\\"} for ch in text):
        escaped = text.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return text


def update_env_file(path: Path, values: dict[str, str]) -> None:
    clean_values = {str(k): str(v).strip() for k, v in values.items() if str(k).strip()}
    existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    updated_keys: set[str] = set()
    next_lines: list[str] = []
    for line in existing:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            next_lines.append(line)
            continue
        prefix = "export " if stripped.startswith("export ") else ""
        body = stripped[len("export ") :] if prefix else stripped
        key = body.split("=", 1)[0].strip()
        if key in clean_values:
            next_lines.append(f"{prefix}{key}={quote_env_value(clean_values[key])}")
            updated_keys.add(key)
        else:
            next_lines.append(line)
    for key in clean_values:
        if key not in updated_keys:
            next_lines.append(f"{key}={quote_env_value(clean_values[key])}")
    path.write_text("\n".join(next_lines).rstrip() + "\n", encoding="utf-8")



def as_bool(value: Any, default: bool = False) -> bool:
    text = str(value if value is not None else "").strip().lower()
    if not text:
        return default
    return text in {"1", "true", "yes", "y", "on"}


def build_command(workflow_key: str, workflow_file: str, inputs: dict[str, str]) -> list[str]:
    python = sys.executable
    if workflow_file == "daily-paper-reader.yml" or workflow_key == "daily-now":
        cmd = [python, "src/main.py"]
        if as_bool(inputs.get("run_enrich"), False):
            cmd.append("--run-enrich")
        if inputs.get("fetch_days"):
            cmd.extend(["--fetch-days", str(inputs["fetch_days"])])
        if inputs.get("fetch_mode"):
            cmd.extend(["--fetch-mode", str(inputs["fetch_mode"])])
        if inputs.get("profile_tag"):
            cmd.extend(["--profile-tag", str(inputs["profile_tag"])])
        cmd.extend(["--embedding-device", "cpu", "--embedding-batch-size", "8"])
        return cmd

    if workflow_file == "conference-paper-retrieval.yml" or workflow_key == "conference-retrieval":
        run_date = datetime.now(timezone.utc).strftime("%Y%m%d")
        conference = str(inputs.get("conference") or "ICML")
        years = str(inputs.get("years") or "2025")
        profile_tag = str(inputs.get("profile_tag") or "")
        pipeline_cmd = [
            python,
            "src/conference_pipeline.py",
            "--conferences",
            conference,
            "--years",
            years,
            "--top-k",
            str(inputs.get("top_k") or "50"),
            "--rrf-top-n",
            str(inputs.get("rrf_top_n") or "200"),
            "--output-dir",
            f"archive/{run_date}/filtered",
            "--embedding-device",
            "cpu",
            "--embedding-batch-size",
            "8",
        ]
        if as_bool(inputs.get("run_rerank"), True) or as_bool(inputs.get("run_llm_refine"), True):
            pipeline_cmd.extend(["--run-rerank", "--rerank-device", "cpu", "--rerank-batch-size", "4"])
        if as_bool(inputs.get("run_llm_refine"), True):
            pipeline_cmd.extend(["--run-llm-refine", "--llm-min-star", str(inputs.get("llm_min_star") or "4"), "--llm-filter-concurrency", "2"])
        script = "\n".join([
            "set -euo pipefail",
            (
                f"TOKENS=$(CONFERENCE_INPUT={shlex.quote(conference)} "
                f"YEARS_INPUT={shlex.quote(years)} "
                f"{shlex.quote(python)} -c "
                + shlex.quote(
                    "import os, sys; "
                    "sys.path.insert(0, 'src'); "
                    "from conference_retrieval import build_years_token, parse_conferences, parse_years; "
                    "print('-'.join(parse_conferences(os.environ.get('CONFERENCE_INPUT', '')))); "
                    "print(build_years_token(parse_years(os.environ.get('YEARS_INPUT', ''))))"
                )
                + ")"
            ),
            "CONF_TOKEN=$(echo \"$TOKENS\" | sed -n '1p')",
            "YEAR_TOKEN=$(echo \"$TOKENS\" | sed -n '2p')",
            f"PROFILE_TAG={shlex.quote(profile_tag)}",
            "export DPR_FILTER_PROFILE_TAG=\"$PROFILE_TAG\"",
            (
                "TOPIC_MARKER=$(CONF_TOKEN=\"$CONF_TOKEN\" YEAR_TOKEN=\"$YEAR_TOKEN\" "
                "PROFILE_TAG=\"$DPR_FILTER_PROFILE_TAG\" "
                f"{shlex.quote(python)} - <<'PY'\n"
                "import os, sys\n"
                "sys.path.insert(0, 'src')\n"
                "from conference_sidebar import build_conference_topic_marker, topic_from_profile_tag\n"
                "kind, label = topic_from_profile_tag(os.environ.get('PROFILE_TAG', ''))\n"
                "print(build_conference_topic_marker(os.environ['CONF_TOKEN'], os.environ['YEAR_TOKEN'], kind, label))\n"
                "PY\n"
                ")"
            ),
            (
                "if [ -f docs/_sidebar.md ] && grep -Fq \"$TOPIC_MARKER\" docs/_sidebar.md; then\n"
                "  echo \"[INFO] 已存在会议词条，跳过重复检索：conference=${CONF_TOKEN}-${YEAR_TOKEN} profile=${DPR_FILTER_PROFILE_TAG:-General}\"\n"
                "  exit 0\n"
                "fi"
            ),
            " ".join(shlex.quote(part) for part in pipeline_cmd),
            f"{shlex.quote(python)} src/conference_sidebar.py "
            f"--result archive/{run_date}/rank/conference-${{CONF_TOKEN}}-${{YEAR_TOKEN}}.supabase.llm.json "
            f"--result archive/{run_date}/rank/conference-${{CONF_TOKEN}}-${{YEAR_TOKEN}}.supabase.rerank.json "
            f"--result archive/{run_date}/filtered/conference-${{CONF_TOKEN}}-${{YEAR_TOKEN}}.supabase.rrf.json "
            "--sidebar docs/_sidebar.md",
        ])
        return ["bash", "-lc", script]

    if workflow_file == "reset-content.yml" or workflow_key == "reset-content":
        return [python, "-c", "import shutil, pathlib; root=pathlib.Path('.'); shutil.rmtree(root/'docs', ignore_errors=True); shutil.copytree(root/'docs_init', root/'docs'); print('docs reset from docs_init')"]

    # F1: 触发指定会议源的 init_<conf>.py — 跑 fetch + sync 到 Supabase。
    # inputs: conferences=AAAI,ICML,NEURIPS / year_end=2025 / year_count=3 / skip_fetch=true
    # workflow_key="init-conferences" 也可被前端表单触发。
    if workflow_key == "init-conferences":
        conferences_csv = str(inputs.get("conferences") or "ICML,NeurIPS")
        year_end = int(inputs.get("year_end") or 0) or None
        year_count = int(inputs.get("year_count") or 0) or 3
        skip_fetch = as_bool(inputs.get("skip_fetch"), False)
        if year_end is None:
            year_end = datetime.now(timezone.utc).year
        # 解析 conference 列表
        wanted = [c.strip() for c in conferences_csv.split(",") if c.strip()]
        if not wanted:
            raise ValueError("init-conferences 需要 conferences 列表,例如 'AAAI,ICML'")
        # 允许前端传会议展示名(AAAI/ACL/EMNLP/ICLR/ICML/NEURIPS)或 backend key(aaai/acl/...)
        # init 脚本文件名是 <key> 形式,小写
        name_to_init = {
            "AAAI": "aaai",
            "ACL": "acl",
            "EMNLP": "emnlp",
            "ICLR": "iclr",
            "ICML": "icml",
            "NEURIPS": "neurips",
        }
        # 用 bash -lc 串行跑每个 init,任意一个失败 exit 1。
        # 年份 2025 默认 = year_end; 范围 [year_end - year_count + 1, year_end]。
        script_parts = ["set -euo pipefail"]
        for conf in wanted:
            key = name_to_init.get(conf.upper(), conf.lower())
            init_script = f"src/maintain/init_{key}.py"
            cmd = [python, init_script, "--year-end", str(year_end), "--year-count", str(year_count)]
            if skip_fetch:
                cmd.append("--skip-fetch")
            script_parts.append(" ".join(shlex.quote(part) for part in cmd))
        return ["bash", "-lc", "\n".join(script_parts)]

    if workflow_file == "sync.yml" or workflow_key == "sync":
        return ["git", "status", "--short"]

    raise ValueError(f"本地调试后端暂不支持 workflow: {workflow_key or workflow_file}")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        # 仅保留 /api/local/health — 其它 endpoint (config/secret/runs/dispatch)
        # 在 commit 46b2b74 之后前端不再消费,移除以减少攻击面。
        parsed = urlparse(self.path)
        if parsed.path == "/api/local/health":
            return self._json({"ok": True, "mode": "local-debug", "time": utc_now()})
        return super().do_GET()

    def do_POST(self) -> None:
        # POST endpoint 全部移除 (config/secret/workflows/dispatch)。
        # 前端改走 GitHub REST workflow_dispatch (见 astro-src/pages/conferences/index.astro);
        # 本机调试 pipeline 通过 src/main.py 子进程直接跑,不需 HTTP。
        return self._json({"ok": False, "error": "POST endpoints removed; use CLI or GitHub Actions"}, status=404)

    def _json(self, payload: dict[str, Any], status: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily Paper Reader 本地调试后端")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8567)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    display_host = "127.0.0.1" if args.host in {"0.0.0.0", "::"} else args.host
    print(f"[local-debug] serving http://{display_host}:{args.port}", flush=True)
    if display_host != args.host:
        print(f"[local-debug] listening on {args.host}:{args.port}", flush=True)
    print("[local-debug] HTTP endpoints trimmed to /api/local/health only; pipeline runs via src/main.py subprocess", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
