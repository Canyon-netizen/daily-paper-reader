#!/usr/bin/env bash
# scripts/local-llm-proxy.sh — wrapper for scripts/local-llm-proxy.mjs
#
# Local LLM reverse proxy (2026-09-08):让浏览器把 LLM 请求发到 localhost,
# server-side 注入 MINIMAX_API_KEY,client 永远不持有明文 key。
# 同时把每个调用写到 logs/llm-proxy.jsonl(timestamp / status / latency /
# model / chars / tokens),便于排查「这次为啥失败」「这个月花了多少」。
#
# 默认监听 127.0.0.1:8124(loopback only)。8123 留给 scripts/local-cors-proxy.mjs。
#
# 与 scripts/local-cors-proxy.sh 的区别:
#   - 端口: 8124 vs 8123
#   - 协议: HTTP + JSON forward vs 透传 binary stream(PDF / arXiv XML)
#   - 日志: append-only JSONL vs console-only
#   - 配置: 强制要 MINIMAX_API_KEY,缺失就 exit 1(避免匿名转发)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUNTIME=""
if [ -x "./node_modules/.bin/bun" ]; then
    RUNTIME="./node_modules/.bin/bun"
elif command -v bun >/dev/null 2>&1; then
    RUNTIME="$(command -v bun)"
elif command -v node >/dev/null 2>&1; then
    RUNTIME="$(command -v node)"
else
    echo "[local-llm-proxy] ERROR: 未找到 bun 或 node。请安装 Bun (https://bun.sh) 或 Node ≥ 18。" >&2
    exit 1
fi

LLM_PROXY_HOST="${LLM_PROXY_HOST:-127.0.0.1}"
LLM_PROXY_PORT="${LLM_PROXY_PORT:-8124}"
export LLM_PROXY_HOST LLM_PROXY_PORT

exec "$RUNTIME" scripts/local-llm-proxy.mjs "$@"
