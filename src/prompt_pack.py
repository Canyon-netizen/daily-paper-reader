"""PR-4 Prompt Pack 1.0 — 可版本化的 LLM prompt。

设计原则:
  - 零破坏: config.prompt_packs.active.<target> 默认 None (走硬编码 const)
  - 载体 = 目录: config/prompts/<pack_id>/<version>/{manifest.json,body.md}
  - 24000 char 上限: 对齐 Polaris _TARGET_BUDGET_CHARS
  - Taxonomy 兼容: manifest.requires_taxonomies_version 加载时校验
  - Target allowlist: load_active_pack 接收的 target 必须在 manifest.targets 里,
    否则 graceful fallback(plan §4.1 「未知 target 不得注入」)。
  - Content hash: Pack.content_hash = sha256(manifest_json + body),写到
    checkpoint provenance 里,run-start snapshot 锁定 active pack 的 id/version/hash/body,
    后续修改 active.<target> 不会影响已落盘的 checkpoint(plan §4.1 「修改 active
    pack 后,已写入 checkpoint 的 run 仍使用旧 hash」)。

注:本模块不引入新依赖。pack 目录与 manifest 必须已在仓库内/磁盘上。
不存在的 pack 走 graceful fallback(视为 None,等同 hardcoded)。
"""

import hashlib
import json
import os
from dataclasses import dataclass, field
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
    # PR-4 plan §4.1 content hash: sha256(manifest_json + body),给
    # checkpoint provenance 写入「run-start snapshot」用。
    # 默认由 __post_init__ 计算;load() 路径下 manifest_json 来自磁盘原文件。
    content_hash: str = field(init=False)

    def __post_init__(self) -> None:
        # manifest_json 用 sort_keys=True 复现,保证同一份 manifest 在不同
        # Python dict order 下 hash 也一致。
        m_json = json.dumps(self.manifest, sort_keys=True, ensure_ascii=False)
        self.content_hash = hashlib.sha256(
            (m_json + "\n" + self.body).encode("utf-8")
        ).hexdigest()

    @classmethod
    def load(cls, dir_path: str, target: str | None = None) -> "Pack":
        """从 dir_path/manifest.json + manifest.body_file 加载。

        target 可选:命中 manifest.bodies[target] 时优先,缺省回退 body_file。
        多 body pack(例如 library-digest 三 stage)必传 target 才能取对 body。

        target allowlist:传 target 时,target 必须在 manifest.targets 里;否则
        raise ValueError。load_active_pack 在 caller 层捕获这个异常并 graceful
        fallback ——「不合法 target 在运行前失败」(plan §4.1 验收 2)。
        """
        d = Path(dir_path)
        manifest_path = d / "manifest.json"
        if not manifest_path.exists():
            raise FileNotFoundError(f"pack manifest 不存在: {manifest_path}")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        _validate_manifest(manifest)

        # target allowlist
        if target is not None:
            if target not in (manifest.get("targets") or []):
                raise ValueError(
                    f"target {target!r} 不在 manifest.targets 列表内: "
                    f"{manifest.get('targets')}"
                )

        bodies_map = manifest.get("bodies") or {}
        if target and isinstance(bodies_map, dict) and isinstance(bodies_map.get(target), str):
            body_file = bodies_map[target]
        else:
            body_file = manifest.get("body_file") or "body.md"
        body_path = d / body_file
        if not body_path.exists():
            raise FileNotFoundError(f"pack body 不存在: {body_path}")
        body = body_path.read_text(encoding="utf-8")

        return cls(manifest=manifest, body=body)

    def snapshot(self) -> Dict[str, Any]:
        """返回可写入 checkpoint provenance 的快照 dict。

        锁定 active pack 的 id/version/content_hash/body —— 之后即使
        config 改了 pin,checkpoint 回看时也能 100% 复现当时的 prompt。
        """
        return {
            "pack_id": self.manifest.get("pack_id"),
            "version": self.manifest.get("version"),
            "kind": self.manifest.get("kind"),
            "targets": list(self.manifest.get("targets") or []),
            "content_hash": self.content_hash,
            "body": self.body,
        }


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

    多 body pack 会在内部把 target 一并传给 Pack.load(),使 bodies[target] 优先于 body_file。
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
        return Pack.load(dir_path, target=target)
    except (FileNotFoundError, ValueError):
        # FileNotFoundError:磁盘上不存在 → graceful fallback(hardcoded 默认)
        # ValueError:target 不在 allowlist → plan §4.1「未知 target 不得注入」
        # 但主流程仍走 hardcoded default,而不是崩
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