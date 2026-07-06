#!/usr/bin/env bash
# scripts/run-pipeline.sh — 统一 Python 入口；强制 venv 激活 + cwd=repo 根。
#
# 背景（PR #B 之后）：
#   `src/*.py` 已统一为 `from src.X import ...` 的 package-mode。
#   这意味着 Python 进程启动时要把 src/ 当作 package —— 即 cwd 必须是仓库
#   根目录（这样 `from src.X import ...` 才会先在 sys.path[0] 找到 src/）。
#   裸 `python src/main.py` 在 cwd ≠ 仓库根时会失败（ModuleNotFoundError: src），
#   裸 `python src/main.py` 即使 cwd=仓库根也跑不通（Python 的 script-mode
#   把脚本所在目录放 sys.path[0]，而不是 cwd）——上面两种情况下用户都会撞墙。
#
# 本脚本做两件事：
#   1. 强制 cd 到仓库根
#   2. 把 `scripts/run-pipeline.sh src/main.py [args...]`
#      自动转译为 `python -m src.main [args...]`
#      让 Python 把 src/ 当作 package 解析。
#
# 用法:
#   scripts/run-pipeline.sh src/main.py --help
#   scripts/run-pipeline.sh src/main.py --fetch-days 9 --profile-tag rl
#   scripts/run-pipeline.sh src/conference_pipeline.py --conference ICML
#   scripts/run-pipeline.sh -m pytest tests/ -q      # -m 形式直接透传
#   scripts/run-pipeline.sh -c "import src.source_config; print(src.source_config.ARXIV_SOURCE_KEY)"
#
# 与现有脚本的关系：
#   - `scripts/bootstrap_local.sh`：首次安装 venv + 启后端（不变）
#   - `scripts/local_debug.sh`：仅启 `local_debug_server.py`（不变）
#   - `scripts/run-pipeline.sh`：**新增**入口；唯一安全的所有 Python 调用入口。

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VENV_DIR="${DPR_LOCAL_VENV:-.venv}"

# 1) venv 激活（如已激活则跳过）
if [ -d "$VENV_DIR" ] && [ -z "${VIRTUAL_ENV:-}" ]; then
    # shellcheck disable=SC1091
    source "$VENV_DIR/bin/activate"
fi

# 2) 没有任何参数时打印帮助
if [ "$#" -eq 0 ]; then
    cat <<EOF
usage: scripts/run-pipeline.sh <python-args...>

examples:
    scripts/run-pipeline.sh src/main.py --help
    scripts/run-pipeline.sh src/main.py --fetch-days 9
    scripts/run-pipeline.sh src/conference_pipeline.py --conference ICML
    scripts/run-pipeline.sh -m pytest tests/ -q
    scripts/run-pipeline.sh -c "import src.source_config; print('OK')"

environment:
    DPR_LOCAL_VENV   venv 目录名 (default: .venv)
EOF
    exit 2
fi

# 3) 透传警示：未激活 venv
if [ -z "${VIRTUAL_ENV:-}" ]; then
    echo "[run-pipeline] WARN: 未检测到 venv (DPR_LOCAL_VENV=$VENV_DIR 也未找到)。" >&2
    echo "[run-pipeline] 建议先运行: scripts/bootstrap_local.sh" >&2
fi

# 4) 自动转译 `src/<name>.py` → `-m src.<name>` 以保证 package-mode 导入
first_arg="${1:-}"
case "$first_arg" in
    src/*.py)
        # 例: src/main.py -> -m src.main
        module="${first_arg%.py}"
        module="${module//\//.}"
        shift
        exec python -m "$module" "$@"
        ;;
    *)
        # -m pytest / -c "..." / 其他形式直接透传
        exec python "$@"
        ;;
esac
