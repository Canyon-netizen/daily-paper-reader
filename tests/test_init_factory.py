"""Unit tests for src/maintain/init_factory helpers."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow `import src.maintain.init_factory` without packaging.
ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from src.maintain.init_factory import (  # noqa: E402
    add_embed_args,
    build_sync_cmd,
    resolve_embed_device,
    resolve_raw_path,
)


def _ns(**kwargs):
    """Build a minimal argparse.Namespace that build_sync_cmd needs."""
    p = argparse.ArgumentParser()
    add_embed_args(p)
    # Override defaults with provided kwargs
    args = p.parse_args([])
    for k, v in kwargs.items():
        setattr(args, k, v)
    return args


def test_add_embed_args_attaches_expected_flags() -> None:
    p = argparse.ArgumentParser()
    add_embed_args(p)
    args = p.parse_args(["--embed-batch-size", "16", "--local-maintain", "--no-embeddings"])
    assert args.embed_batch_size == 16
    assert args.local_maintain is True
    assert args.no_embeddings is True
    # Sensible defaults for the rest
    assert args.embed_chunk_size == 512
    assert args.upsert_batch_size == 200
    assert args.schema == "public"


def test_resolve_embed_device_sets_cpu_when_no_torch() -> None:
    args = _ns()
    # Simulate torch absent (None) — should default to cpu.
    resolve_embed_device(args, torch_module=None)
    assert args.embed_device == "cpu"
    assert not args.embed_devices


def test_resolve_embed_device_local_maintain_keeps_local_only() -> None:
    args = _ns(local_maintain=True)
    resolve_embed_device(args, torch_module=None)
    assert args.embed_local_only is True


def test_resolve_raw_path_uses_explicit_when_set() -> None:
    out = resolve_raw_path(
        raw_input="relative/path.json",
        project_root="/tmp/proj",
        date_str="20251010",
        default_filename="fallback.json",
    )
    # Path-compare instead of string-compare so the test passes on both
    # POSIX and Windows (resolve_raw_path uses os.path.join, which yields
    # back-slashes on Windows).
    from pathlib import Path
    assert Path(out).parts[-2:] == Path("proj/relative/path.json").parts[-2:]


def test_resolve_raw_path_falls_back_to_default() -> None:
    out = resolve_raw_path(
        raw_input="",
        project_root="/tmp/proj",
        date_str="20251010",
        default_filename="biorxiv_papers_20251010.json",
    )
    from pathlib import PurePosixPath, PureWindowsPath
    # Match either POSIX or Windows-style path; production code uses
    # os.path.join, which yields the platform's separator.
    posix = PurePosixPath("/tmp/proj/archive/20251010/raw/biorxiv_papers_20251010.json")
    win = PureWindowsPath("/tmp/proj/archive/20251010/raw/biorxiv_papers_20251010.json")
    win_out = PureWindowsPath(out)
    posix_out = PurePosixPath(out)
    assert (
        str(win_out).lower() == str(win).lower()
        or str(posix_out) == str(posix)
    )


def test_build_sync_cmd_minimal() -> None:
    args = _ns()
    cmd = build_sync_cmd(
        backend_key="biorxiv",
        date_str="20251010",
        raw_path="/tmp/raw.json",
        args=args,
    )
    # It should be a python invocation of sync.py with the right flags.
    assert cmd[0] == sys.executable
    assert cmd[1].endswith("sync.py")
    assert "--backend-key" in cmd
    idx = cmd.index("--backend-key")
    assert cmd[idx + 1] == "biorxiv"
    assert "--raw-input" in cmd
    raw_idx = cmd.index("--raw-input")
    assert cmd[raw_idx + 1] == "/tmp/raw.json"
    # Default papers-table is omitted; explicitly set when needed.
    assert "--papers-table" not in cmd


def test_build_sync_cmd_with_papers_table() -> None:
    args = _ns()
    cmd = build_sync_cmd(
        backend_key="iclr",
        date_str="20251010",
        raw_path="/tmp/raw.json",
        args=args,
        papers_table="iclr_openreview_papers",
    )
    assert "--papers-table" in cmd
    idx = cmd.index("--papers-table")
    assert cmd[idx + 1] == "iclr_openreview_papers"


def test_build_sync_cmd_appends_no_embeddings() -> None:
    args = _ns(no_embeddings=True)
    cmd = build_sync_cmd(
        backend_key="chemrxiv",
        date_str="20251010",
        raw_path="/tmp/raw.json",
        args=args,
    )
    assert "--no-embeddings" in cmd