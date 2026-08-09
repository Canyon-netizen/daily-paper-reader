"""Shared init-script scaffolding for the per-source maintainers.

Why this exists
---------------
Before this module, the 9 per-source `init_*.py` scripts (`init_aaai.py`,
`init_acl.py`, `init_biorxiv.py`, `init_chemrxiv.py`, `init_emnlp.py`,
`init_iclr.py`, `init_icml.py`, `init_medrxiv.py`, `init_neurips.py`) were
~95% identical: same argparse setup, same torch/CUDA block, same
`run_step("Step 1 - fetch …", ...)`, same `run_step("Step 2 - sync …", ...)`
boilerplate. The only real differences were:

  1. the source name (biorxiv, medrxiv, chemrxiv, aaai, acl, emnlp, iclr,
     icml, neurips)
  2. the raw-archive token template (e.g. `biorxiv_papers_20251011` vs
     `iclr-openreview-2023-2025`)
  3. the per-source fetch-CLI flags (`--days` for arxiv-family, `--year-end
     + --year-count` for conference-family, `--username/--password` for
     OpenReview-based)
  4. the Supabase `--backend-key` and (for some) `--papers-table`

This module extracts the common scaffolding into a handful of helpers so each
init script can shrink from ~165 lines to ~50 lines, while preserving its
public CLI surface (so existing GitHub Actions and cron jobs keep working).

Not in scope: init_arxiv.py is structurally similar but uses --days with the
arxiv fetcher; we leave it standalone because (a) it has additional flags
unique to arxiv (split-on-error-depth, custom model loaders, etc.) and (b) it
is invoked from `src/main.py` and `src/local_debug_server.py` separately.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from datetime import datetime, timezone
from typing import Callable, List, Optional, Sequence


SCRIPT_DIR = os.path.dirname(__file__)
ROOT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
TODAY_STR = datetime.now(timezone.utc).strftime("%Y%m%d")

DEFAULT_EMBED_BATCH_SIZE = 8
DEFAULT_EMBED_CHUNK_SIZE = 512
LOCAL_MAINTAIN_EMBED_BATCH_SIZE = 64
LOCAL_MAINTAIN_EMBED_CHUNK_SIZE = 1024


# =============================================================================
# Argparse — common flags for the embed/sync half of every init script
# =============================================================================

def add_embed_args(parser: argparse.ArgumentParser) -> None:
    """Add the embed-* and sync-* flags shared by every init_*.py."""
    parser.add_argument("--embed-model", type=str, default="")
    parser.add_argument("--embed-device", type=str, default="")
    parser.add_argument("--embed-devices", type=str, default="")
    parser.add_argument("--embed-batch-size", type=int, default=DEFAULT_EMBED_BATCH_SIZE)
    parser.add_argument("--embed-chunk-size", type=int, default=DEFAULT_EMBED_CHUNK_SIZE)
    parser.add_argument("--embed-max-length", type=int, default=0)
    parser.add_argument("--embed-local-only", action="store_true")
    parser.add_argument("--local-maintain", action="store_true")
    parser.add_argument("--reserve-upload-cpus", type=int, default=2)
    parser.add_argument("--upload-workers", type=int, default=2)
    parser.add_argument("--max-pending-upload-chunks", type=int, default=2)
    parser.add_argument("--schema", type=str, default=os.getenv("SUPABASE_SCHEMA", "public"))
    parser.add_argument("--upsert-batch-size", type=int, default=200)
    parser.add_argument("--upsert-timeout", type=int, default=120)
    parser.add_argument("--upsert-retries", type=int, default=5)
    parser.add_argument("--upsert-retry-wait", type=float, default=2.0)
    parser.add_argument("--no-embeddings", action="store_true")


def resolve_embed_device(args: argparse.Namespace, torch_module=None) -> None:
    """Set args.embed_device / args.embed_devices from CUDA availability.

    Mirrors the logic that was copy-pasted into every init_*.py. Mutates `args`
    in place; no return value.
    """
    if args.local_maintain and args.embed_batch_size == DEFAULT_EMBED_BATCH_SIZE:
        args.embed_batch_size = LOCAL_MAINTAIN_EMBED_BATCH_SIZE
    if args.local_maintain and args.embed_chunk_size == DEFAULT_EMBED_CHUNK_SIZE:
        args.embed_chunk_size = LOCAL_MAINTAIN_EMBED_CHUNK_SIZE
    if args.local_maintain:
        args.embed_local_only = True
    if not str(args.embed_device or "").strip() and not str(args.embed_devices or "").strip():
        cuda_mod = getattr(torch_module, "cuda", None) if torch_module is not None else None
        if args.local_maintain and cuda_mod is not None and cuda_mod.is_available() and int(cuda_mod.device_count() or 0) > 0:
            args.embed_devices = ",".join(
                f"cuda:{idx}" for idx in range(int(cuda_mod.device_count() or 0))
            )
        else:
            args.embed_device = "cpu"
    elif args.local_maintain and not str(args.embed_devices or "").strip() and str(args.embed_device or "").strip().lower() == "auto":
        cuda_mod = getattr(torch_module, "cuda", None) if torch_module is not None else None
        if cuda_mod is not None and cuda_mod.is_available() and int(cuda_mod.device_count() or 0) > 0:
            args.embed_devices = ",".join(
                f"cuda:{idx}" for idx in range(int(cuda_mod.device_count() or 0))
            )
        else:
            args.embed_device = "cpu"


# =============================================================================
# Subprocess helpers
# =============================================================================

# 默认软失败匹配标记(Supabase 401 / 凭据轮换场景)
DEFAULT_SOFT_FAIL_MARKERS: tuple[str, ...] = (
    "Invalid API key",
    "HTTP 401",
    "401 Unauthorized",
    "401",
)


def _is_soft_fail_marker_match(text: str, markers: Sequence[str]) -> bool:
    """检查 text 是否包含任一 marker(大小写不敏感,空 markers 永远命中)。

    空 markers 视为「全部软失败」——给会议 init 的「先跳过 sync, 改天补」场景用。
    """
    if not markers:
        return True
    lower = (text or "").lower()
    return any(str(m).lower() in lower for m in markers if m)


def run_step(
    label: str,
    args: Sequence[str],
    cwd: Optional[str] = None,
    *,
    soft_fail: bool = False,
    soft_fail_markers: Optional[Sequence[str]] = None,
) -> None:
    """Run a subprocess with PYTHONPATH=ROOT_DIR so ``from src.X`` resolves.

    ``soft_fail=True`` 时,若子进程退出非零且 stderr/stdout 含任一
    ``soft_fail_markers``(默认是 Supabase 401 / "Invalid API key" / "HTTP 401"
    三种),则只写一条 WARNING 到 stderr,不再抛 CalledProcessError —— 这样
    GHA cron 不会因为一次性凭据轮换把已经 fetch 好的 raw archive 丢掉,
    下次重跑(sync 步骤)即可。

    ``soft_fail_markers`` 不传 → 走默认集合。传空 tuple () → 任何非零都吞掉。
    传非空 tuple → 只吞包含任一 marker 的失败。

    Child stdout/stderr 通过 capture_output=True + text=True 抓到本地,
    再原样 print 回 stdout,这样 GHA log panel 既能看 child 输出,
    又能在 child 失败时拿到完整 stderr 给 CalledProcessError。
    """
    print(f"[INFO] {label}: {' '.join(args)}", flush=True)
    env = {**os.environ, "PYTHONPATH": ROOT_DIR}
    # capture_output + text: 拿到 child stdout/stderr 再由我们自己 print,
    # 这样 GHA log 仍能看到(若用 check=True 默认捕获,GHA 不会显示 child log)。
    completed = subprocess.run(
        list(args),
        check=False,
        env=env,
        cwd=cwd or ROOT_DIR,
        capture_output=True,
        text=True,
    )
    # 把 child 输出原样回流到 parent,GHA 不会因为 capture_output 看不到。
    if completed.stdout:
        print(completed.stdout, end="", flush=True)
    if completed.stderr:
        # stderr 直接 print(无 end='\n' 时 subprocess 会自带尾换行)
        print(completed.stderr, end="", flush=True)
    if completed.returncode == 0:
        return
    # 失败路径:拼出 combined 文本做 marker 匹配(stdout+stderr 都算)
    combined = (completed.stdout or "") + "\n" + (completed.stderr or "")
    if soft_fail:
        markers = (
            list(soft_fail_markers)
            if soft_fail_markers is not None
            else list(DEFAULT_SOFT_FAIL_MARKERS)
        )
        if _is_soft_fail_marker_match(combined, markers):
            # 把命中 marker 的原始行附在 WARN 末尾,方便排查("到底是 401 还是 quota")
            matched_line = ""
            for line in (completed.stdout or "").splitlines() + (completed.stderr or "").splitlines():
                if any(str(m).lower() in line.lower() for m in markers if m):
                    matched_line = line.strip()[:300]
                    break
            sys.stderr.write(
                f"[WARN] {label} 软失败(returncode={completed.returncode}, "
                f"matched soft-fail marker);raw archive 已保留,下次重跑 sync。\n"
                f"  marker: {matched_line}\n"
            )
            sys.stderr.flush()
            return
    # 默认硬失败:显式抛 CalledProcessError 以兼容历史 caller 的 try/except。
    raise subprocess.CalledProcessError(
        returncode=completed.returncode,
        cmd=list(args),
        output=completed.stdout,
        stderr=completed.stderr,
    )


def python_executable() -> str:
    return sys.executable


# =============================================================================
# Sync step — identical for every init_*.py modulo backend_key / papers_table
# =============================================================================

def build_sync_cmd(
    *,
    backend_key: str,
    date_str: str,
    raw_path: str,
    args: argparse.Namespace,
    papers_table: Optional[str] = None,
) -> List[str]:
    """Build the `python src/maintain/sync.py …` command for one source.

    Args:
      backend_key:  value passed to `--backend-key` (e.g. "aaai", "iclr")
      date_str:     pre-resolved run-date token
      raw_path:     absolute path to the fetch output JSON
      args:         parsed argparse.Namespace containing the common
                    embed/sync flags (caller must have run resolve_embed_device)
      papers_table: when set, appended as `--papers-table <name>`. Some
                    backends need this explicitly; sync.py can otherwise infer
                    from the backend key.

    Returns the cmd list ready to be passed to subprocess.run.
    """
    cmd: List[str] = [
        python_executable(),
        os.path.join(SCRIPT_DIR, "sync.py"),
        "--backend-key", backend_key,
        "--date", date_str,
        "--schema", str(args.schema),
        "--embed-batch-size", str(max(int(args.embed_batch_size or 1), 1)),
        "--embed-chunk-size", str(max(int(args.embed_chunk_size or 1), 1)),
        "--embed-max-length", str(int(args.embed_max_length or 0)),
        "--reserve-upload-cpus", str(max(int(args.reserve_upload_cpus or 0), 0)),
        "--upload-workers", str(max(int(args.upload_workers or 1), 1)),
        "--max-pending-upload-chunks", str(max(int(args.max_pending_upload_chunks or 1), 1)),
        "--upsert-batch-size", str(max(int(args.upsert_batch_size or 1), 1)),
        "--upsert-timeout", str(max(int(args.upsert_timeout or 1), 1)),
        "--upsert-retries", str(max(int(args.upsert_retries or 0), 0)),
        "--upsert-retry-wait", str(max(float(args.upsert_retry_wait or 0.0), 0.0)),
        "--raw-input", raw_path,
    ]
    if papers_table:
        cmd += ["--papers-table", papers_table]
    if args.local_maintain:
        cmd.append("--local-maintain-mode")
    if args.embed_model:
        cmd += ["--embed-model", str(args.embed_model)]
    if args.embed_devices:
        cmd += ["--embed-devices", str(args.embed_devices)]
    else:
        cmd += ["--embed-device", str(args.embed_device or "cpu")]
    if args.embed_local_only and not args.local_maintain:
        cmd.append("--embed-local-only")
    if args.no_embeddings:
        cmd.append("--no-embeddings")
    return cmd


# =============================================================================
# Convenience: typical "resolve raw_path" logic
# =============================================================================

def resolve_raw_path(
    *,
    raw_input: str,
    project_root: str,
    date_str: str,
    default_filename: str,
) -> str:
    """Return either the explicit --raw-input or the default archive path."""
    raw_path = str(raw_input or "").strip()
    if raw_path:
        if not os.path.isabs(raw_path):
            raw_path = os.path.abspath(os.path.join(project_root, raw_path))
        return raw_path
    return os.path.join(project_root, "archive", date_str, "raw", default_filename)