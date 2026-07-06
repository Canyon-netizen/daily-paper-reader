#!/usr/bin/env bash
# scripts/local-cors-proxy.sh — wrapper for scripts/local-cors-proxy.mjs
#
# 启动 paper-analyzer 在离线 / 自部署场景下用到的本地 arXiv CORS 反代。
# 默认监听 127.0.0.1:8123（loopback only, 避免暴露给 LAN）；需要 LAN 调试时
# 显式 PROXY_HOST=0.0.0.0。PROXY_HOST / PROXY_PORT 均可覆盖。
#
# 与 `scripts/run-pipeline.sh` 不同：这条不需要 Python venv，
# 只要 Node ≥ 18（自带 native fetch）。Node / bun 二选一自检测。

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
    echo "[local-cors-proxy] ERROR: 未找到 bun 或 node。请安装 Bun (https://bun.sh) 或 Node ≥ 18。" >&2
    exit 1
fi

echo "[local-cors-proxy] runtime: $RUNTIME" >&2

PROXY_HOST="${PROXY_HOST:-127.0.0.1}"
PROXY_PORT="${PROXY_PORT:-8123}"
export PROXY_HOST PROXY_PORT

exec "$RUNTIME" scripts/local-cors-proxy.mjs "$@"
