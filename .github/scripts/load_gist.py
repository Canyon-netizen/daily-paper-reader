#!/usr/bin/env python3
"""Load LLM / Supabase / etc. secrets from a GitHub Gist into $GITHUB_ENV.

Shared by all 7 GitHub Actions workflows (daily-paper-reader, conference-retrieval,
maintain-{arxiv,biorxiv,chemrxiv,medrxiv,supabase}, maintain-version-refresh).
The script replaces the per-workflow inline `python3 - <<'PY' ... PY` heredoc that
previously lived in `Load secrets from Gist` step.

Features:
  * Reads DPR_GIST_ID / DPR_GIST_TOKEN from env, fetches the Gist via REST.
  * Writes the raw Gist response to /tmp/dpr-gist.json so downstream
    `src/main.py:apply_topics_from_gist_env()` can fall back to it when
    env encoding fails.
  * Flattens legacy `llm.{apiKey, baseUrl, model}` + top-level `provider` into
    `LLM_API_KEY / LLM_BASE_URL / LLM_MODEL` (with `provider/model` join) so the
    old Gist format keeps working.
  * Writes each `key=value` line to $GITHUB_ENV so subsequent steps inherit.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


GIST_RAW_PATH = "/tmp/dpr-gist.json"


def fetch_gist(token: str, gist_id: str) -> dict[str, Any]:
    req = urllib.request.Request(
        f"https://api.github.com/gists/{gist_id}",
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "dpr-load-gist/1.0",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def flatten_legacy_llm_section(payload: dict[str, Any]) -> None:
    """Pop `llm.{apiKey, baseUrl, model}` from legacy Gist payloads and expose
    them as `LLM_API_KEY / LLM_BASE_URL / LLM_MODEL`. If `LLM_MODEL` already
    exists at the top level (new Gist format), leave it alone.

    Also handles the `provider/model` join when the legacy `llm.model` is just
    `MiniMax-M3` and the top-level `provider` is `minimax`.
    """
    llm = payload.pop("llm", None)
    if not isinstance(llm, dict):
        return
    if "apiKey" in llm and "LLM_API_KEY" not in payload:
        payload["LLM_API_KEY"] = llm["apiKey"]
    if "baseUrl" in llm and "LLM_BASE_URL" not in payload:
        payload["LLM_BASE_URL"] = llm["baseUrl"]
    if "model" in llm and "LLM_MODEL" not in payload:
        model = llm["model"]
        provider = payload.get("provider", "")
        if provider and "/" not in str(model):
            payload["LLM_MODEL"] = f"{provider}/{model}"
        else:
            payload["LLM_MODEL"] = str(model)


# 前端 `paper-hide.ts` / `settings-page.ts` 会把隐藏论文列表写到 Gist 文件
# (key 为 `hiddenPapers: string[]`)。这个字段是纯浏览器状态,不应进 CI env —
# 一旦落进 $GITHUB_ENV 会被序列化成 `hiddenPapers=["2401.01234","2405.05678"]`
# 污染环境(虽然无害,但脏)。在 write_env_lines 之前把它从 payload 里 pop 掉。
#
# 注意与 flatten_legacy_llm_section 的区别:那段是 *展开* 嵌套对象,
# 这段是 *丢弃* 字段(浏览器独占)。
def filter_payload_for_env(payload: dict[str, Any]) -> None:
    """Stage 2 纵深防御:即使将来用户图书馆误用了同一个 gist(dpr-config.json),
    也不让浏览器侧的用户态数据(笔记 / 星标 / 阅读状态)被当成 config 写进
    $GITHUB_ENV。这层是兜底,主防御是 lib/user-library/gist.ts 用独立 gist id。

    2026-08-02 扩展:加 `libraries` 字段(用户自建文献库列表)进黑名单。
    与 userLibrary(单数 per-paper 状态)同源,同防御等级。"""
    payload.pop("hiddenPapers", None)
    payload.pop("userLibrary", None)
    payload.pop("libraries", None)
    payload.pop("schemaVersion", None)  # 防止 userLibrary doc 整体作为 config 被写入


# Keys we treat as secrets — their VALUES must never reach stdout or the env
# file via this function. They come from a Gist, not from ${{ secrets.* }}, so
# GitHub's automatic log-masking does NOT apply (see review of daily-paper-reader
# workflow: public fork repo logs are world-readable, leaking these is bad).
# 约定:这套 Gist 通常含 LLM_* / RERANK_* / SUPABASE_* / OPENREVIEW_* / MINIMAX_* 等。
# 只要 key 含下面这些子串,都按 secret 处理 —— 新增 secret 类型只需扩 _SECRET_KEY_HINTS,
# 不必改每个调用方。
_SECRET_KEY_HINTS = (
    # 常规:API_KEY/PASSWORD/TOKEN 一眼可识别
    "API_KEY", "PASSWORD", "TOKEN", "PRIVATE_KEY",
    # SECRET 容易误吞像 SECRET_KEY/SUPABASE_SERVICE_KEY 这种,但 *_SECRET_* 在 Gist
    # 里基本都是 credential(测试明确覆盖了 SUPABASE_SERVICE_KEY)。
    "SECRET",
    # SUPABASE_SERVICE_KEY 走 _KEY 路径,OpenReview 用 OPENREVIEW_PASSWORD 已覆盖;
    # 凡 _KEY 结尾的只要不是 RERANK_API_KEY 这种命中 API_KEY,可能漏。这里统一兜:
    "SERVICE_KEY",
)


def _is_secret_key(key: str) -> bool:
    up = key.upper()
    return any(h in up for h in _SECRET_KEY_HINTS)


def write_env_lines(payload: dict[str, Any], env_file: str | None) -> None:
    """把 Gist 字段写入 $GITHUB_ENV(后续步骤继承),同时把 secret 值注册为
    ::add-mask::,防止它们出现在 Actions 日志里。

    设计:
      - 只在 stdout 打 key 名 + 长度(便于诊断),不打印 value。
      - 对疑似 secret 的 key,先 ::add-mask::,再写到 env_file — GitHub
        收到 mask 标记后会替换日志里该值的所有出现。
      - 非 secret key(URL / 频道名 / 配置开关等)按原样写,方便观察。
    """
    for key, value in payload.items():
        if _is_secret_key(key):
            # 先 mask,再写 env file —— 顺序很重要,mask 必须在日志已经能看到
            # value 之前注册。
            print(f"::add-mask::{value}")
        line = f"{key}={value}"
        # 只在 stdout 输出"已加载",不输出 value(避免误打 secret)。
        # value 长度大于 0 时打长度;空值给 "<empty>",便于诊断 Gist 字段缺失。
        print(f"[load_gist] {key}={'<set, len=' + str(len(value)) + '>' if value else '<empty>'}")
        if env_file:
            with open(env_file, "a", encoding="utf-8") as fp:
                fp.write(line + "\n")


def main() -> int:
    token = os.environ.get("DPR_GIST_TOKEN", "").strip()
    gist_id = os.environ.get("DPR_GIST_ID", "").strip()
    if not token or not gist_id:
        print("::error::DPR_GIST_TOKEN / DPR_GIST_ID missing", file=sys.stderr)
        return 1

    try:
        data = fetch_gist(token, gist_id)
    except urllib.error.HTTPError as exc:
        print(f"::error::Gist fetch HTTP {exc.code}: {exc.reason}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"::error::Gist fetch network error: {exc.reason}", file=sys.stderr)
        return 1

    # Persist raw Gist response so src/main.py:apply_topics_from_gist_env()
    # can read it as a fallback when env encoding fails (multi-line topics etc.).
    with open(GIST_RAW_PATH, "w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False, indent=2)

    files = data.get("files") or {}
    target = next(
        (
            f["content"]
            for f in files.values()
            if isinstance(f, dict) and f.get("filename", "").endswith(".json")
        ),
        None,
    )
    if not target:
        print("::error::no .json file in gist", file=sys.stderr)
        return 1

    payload = json.loads(target)
    flatten_legacy_llm_section(payload)
    filter_payload_for_env(payload)
    write_env_lines(payload, os.environ.get("GITHUB_ENV"))
    return 0


if __name__ == "__main__":
    sys.exit(main())