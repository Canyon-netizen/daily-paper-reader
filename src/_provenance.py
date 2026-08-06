"""PR-3 统一 provenance 模块(plan §5.1)。

每个 LLM 产物 / checkpoint 至少包含:
  {
    "code_version":  "git:<sha>",          # git rev-parse HEAD 短 SHA
    "config_hash":   "sha256:...",         # config.yaml 内容的 sha256
    "model_route":   "stage:<stage_name>", # 哪个 LLM stage 产出
    "provider_model": "...",                # 实际 LLM 模型 ID
    "prompt_pack":   { id / version / hash / body } | null,
    "input_artifacts": [{ path, sha256 }],
  }

目标:解决 DPR 当前「同一天模型/配置变化后无法解释差异」的问题。
当结果对不上时,可以拉出 checkpoint.provenance 看当时是哪个 SHA / config / model。

fail-loud 原则(plan §5.3):
  - 缺 code_version / config_hash / model_route 任一 → raise(不允许「不知道是哪个
    模型跑的」静默写入)
  - prompt_pack null 时不算 fail:没有 active pack 也合理
  - input_artifacts 留空 list 也合理

调用示例:
    from src._provenance import build_provenance, capture_config_hash, capture_input_hashes

    prov = build_provenance(
        stage="topic.debate",
        provider_model=os.environ.get("LLM_MODEL", ""),
        prompt_pack=pack.snapshot() if pack else None,
        input_artifacts=capture_input_hashes([raw_path, bm25_path]),
    )
    pipeline_checkpoint_write(..., provenance=prov)
"""
from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = REPO_ROOT / "config.yaml"


def git_short_sha(repo_root: Path | None = None) -> str:
    """当前 HEAD 的短 SHA,前缀 'git:'。失败返 'git:<unavailable>' 而不是抛 —— provenance
    容错而非阻断,但允许 caller 通过 sentinel 检测「我们不知道版本」。
    """
    root = repo_root or REPO_ROOT
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(root), stderr=subprocess.DEVNULL, timeout=5,
        )
        return f"git:{out.decode('utf-8').strip()}"
    except Exception:
        return "git:<unavailable>"


def config_hash(repo_root: Path | None = None) -> str:
    """config.yaml 的 sha256。文件不存在 → 'sha256:<missing>' 兜底。"""
    p = (repo_root or REPO_ROOT) / "config.yaml"
    if not p.exists():
        return "sha256:<missing>"
    try:
        h = hashlib.sha256(p.read_bytes()).hexdigest()
        return f"sha256:{h}"
    except OSError:
        return "sha256:<unreadable>"


def file_sha256(path: Path | str) -> str | None:
    """单文件 sha256。文件不存在 / 不可读 → None(caller 决定要不要 fallback)。"""
    p = Path(path)
    if not p.exists() or not p.is_file():
        return None
    try:
        h = hashlib.sha256(p.read_bytes()).hexdigest()
        return f"sha256:{h}"
    except OSError:
        return None


def capture_input_hashes(
    paths: Iterable[Path | str | None],
) -> list[dict[str, str]]:
    """把一组输入路径转成 [{path, sha256}] 列表,None / missing 跳过。"""
    out: list[dict[str, str]] = []
    for raw in paths:
        if raw is None:
            continue
        p = Path(raw)
        h = file_sha256(p)
        if h is None:
            continue
        out.append({"path": str(p), "sha256": h})
    return out


def build_provenance(
    *,
    stage: str,
    provider_model: str | None = None,
    prompt_pack: dict[str, Any] | None = None,
    input_artifacts: list[dict[str, str]] | None = None,
    code_version: str | None = None,
    config_hash_value: str | None = None,
    repo_root: Path | None = None,
) -> dict[str, Any]:
    """构造一个完整 provenance dict。

    必填:stage(provider_model / prompt_pack / input_artifacts 都是 optional,
    反映「这个产物实际跑了什么」的真实性 —— 没值就 None,不伪造)。

    plan §5.3 fail-loud 不在此处做:build_provenance 总是返有效 dict,
    校验在 caller(commit 时的 verdict + UI)做。这里只保证形状一致。
    """
    return {
        "code_version": code_version if code_version is not None else git_short_sha(repo_root),
        "config_hash": config_hash_value if config_hash_value is not None else config_hash(repo_root),
        "model_route": f"stage:{stage}",
        "provider_model": provider_model,
        "prompt_pack": prompt_pack,
        "input_artifacts": input_artifacts or [],
    }


__all__ = [
    "REPO_ROOT",
    "CONFIG_FILE",
    "git_short_sha",
    "config_hash",
    "file_sha256",
    "capture_input_hashes",
    "build_provenance",
]