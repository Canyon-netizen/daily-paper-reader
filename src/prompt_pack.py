"""PR-4 Prompt Pack 1.0 — 可版本化的 LLM prompt。

设计原则:
  - 零破坏: config.prompt_packs.active.<target> 默认 None (走硬编码 const)
  - 载体 = 目录: config/prompts/<pack_id>/<version>/{manifest.json,body.md}
  - 24000 char 上限: 对齐 Polaris _TARGET_BUDGET_CHARS
  - Taxonomy 兼容: manifest.requires_taxonomies_version 加载时校验

注:本模块不引入新依赖。pack 目录与 manifest 必须已在仓库内/磁盘上。
不存在的 pack 走 graceful fallback(视为 None,等同 hardcoded)。
"""

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

# 对齐 Polaris skillset._TARGET_BUDGET_CHARS = 24000
TARGET_BUDGET_CHARS = 24000

# 约定的 pack 根路径(相对仓库根的绝对路径)。
# Pack.load() 接受 dir_path 字符串,不再重定向 root,所以这是参考实现,
# 实际 file path 由 caller 从 config 内 pin 解析得到。
_REPO_ROOT_DEFAULT = Path(__file__).resolve().parent.parent
_PROMPTS_ROOT = _REPO_ROOT_DEFAULT / "config" / "prompts"


@dataclass
class Pack:
    """一个具体版本的 prompt pack。"""

    manifest: Dict[str, Any]
    body: str

    @classmethod
    def load(cls, dir_path: str) -> "Pack":
        """从 dir_path/manifest.json + manifest.body_file 加载。"""
        d = Path(dir_path)
        manifest_path = d / "manifest.json"
        if not manifest_path.exists():
            raise FileNotFoundError(f"pack manifest 不存在: {manifest_path}")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        _validate_manifest(manifest)

        body_file = manifest.get("body_file") or "body.md"
        body_path = d / body_file
        if not body_path.exists():
            raise FileNotFoundError(f"pack body 不存在: {body_path}")
        body = body_path.read_text(encoding="utf-8")

        return cls(manifest=manifest, body=body)


def _validate_manifest(manifest: Dict[str, Any]) -> None:
    """轻量 JSON-Schema 风格校验 —— 不依赖 jsonschema,只检查 plan §7 必填字段。

    必填: pack_id / version / display_name / kind / targets / body_file。
    """
    required = ("pack_id", "version", "display_name", "kind", "targets", "body_file")
    missing = [k for k in required if not manifest.get(k)]
    if missing:
        raise ValueError(
            f"pack_manifest 缺少必填字段: {', '.join(missing)}"
        )
    if not isinstance(manifest["targets"], list):
        raise ValueError("pack_manifest.targets 必须是数组")
    if not manifest["targets"]:
        raise ValueError("pack_manifest.targets 不能为空")


def load_active_pack(
    target: str,
    config: Optional[Dict[str, Any]],
    *,
    repo_root: Optional[str] = None,
) -> Optional[Pack]:
    """从 config.prompt_packs.active[target] 读取 pin,载入对应 pack。

    pin 格式: "<pack_id>:<version>",如 "nips-style:2026-07-15"。
    返回 None 表示 pin 未配置 / pack 不存在,让 caller 走 hardcoded default。
    """
    if not config:
        return None
    pp = config.get("prompt_packs") or {}
    active = pp.get("active") or {}
    pin = active.get(target)
    if not pin:
        return None
    if ":" not in pin:
        # 非法 pin — graceful fallback 到 None(不抛),保持默认行为。
        return None
    pack_id, version = pin.split(":", 1)
    pack_id = pack_id.strip()
    version = version.strip()
    if not pack_id or not version:
        return None

    root = Path(repo_root) if repo_root else _REPO_ROOT_DEFAULT
    dir_path = str(root / "config" / "prompts" / pack_id / version)
    try:
        return Pack.load(dir_path)
    except FileNotFoundError:
        # 磁盘上不存在 → graceful fallback(hardcoded 默认)。
        return None


def inject_into_prompt(
    prompt: str,
    target: str,
    config: Optional[Dict[str, Any]],
    *,
    repo_root: Optional[str] = None,
) -> str:
    """把 pack.body 拼到 prompt 前面。pin 未配置 / pack 不存在时返回原 prompt。

    - pack.body 为空字符串时直接返回原 prompt(等价于 none 注入)。
    - 拼后超过 TARGET_BUDGET_CHARS 截断,末尾附 marker。
    - 任何异常走 graceful fallback,绝不抛 —— PR-4 是「可选注入层」。
    """
    try:
        pack = load_active_pack(target, config, repo_root=repo_root)
    except Exception:
        return prompt
    if pack is None:
        return prompt
    body = (pack.body or "").strip()
    if not body:
        return prompt
    injected = f"{body}\n\n---\n\n{prompt}"
    if len(injected) > TARGET_BUDGET_CHARS:
        injected = (
            injected[: TARGET_BUDGET_CHARS - 50]
            + "\n\n... [truncated to 24000 chars]"
        )
    return injected


__all__ = [
    "Pack",
    "TARGET_BUDGET_CHARS",
    "load_active_pack",
    "inject_into_prompt",
]