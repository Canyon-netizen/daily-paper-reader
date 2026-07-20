"""Cross-step utility helpers shared by main + step scripts.

Why this exists
---------------
A handful of small functions used to live as private copies in two or more
files (main.py vs 6.generate_docs.py most often) and drift independently.
The earliest case was ``normalize_arxiv_id`` — main.py handled ``arxiv:``
and ``v\\d+`` suffix, 6.generate_docs.py did not. Step scripts re-
implemented URL shapes the upstream caller never sees.

The second slice is the trio ``log`` / ``group_start`` / ``group_end``:
byte-identical in every step script (``0``, ``2.3``, ``3``, ``4``, ``5``)
and configurable only via the print statements' GitHub Actions fold
markers. Step scripts also each carry their own ``load_json`` /
``save_json``, but those vary by caller (2-space vs 4-space indent,
Chinese vs English error messages, with or without an auto-log on save),
so they stay local — calling code that wants the common helper imports
``from src._utils import log`` and stays in charge of IO.

Rules
-----
- No business logic. Only stateless conversions of values (strings, ints,
  booleans) and tiny IO wrappers.
- Stdlib only. Step scripts already import one another across ``src.*``;
  pulling in ``requests`` or ``arxiv`` here would force a transitive upgrade.
- Keep functions pure (no ``os.environ`` lookups beyond ``DPR_*`` env
  names that pre-existed in callers).
- 2-space indent inside this module so it matches ``0`` / ``2.3`` / ``3``
  (the first set of step scripts to copy these helpers). 4-space files
  (``4``, ``5``) are aggressively linted on import-export pairs and will
  be re-indented by their owners when they switch.

Re-exports from this module should be considered stable; renaming a
function will require updating all callers, so prefer adding a new
function and deprecating the old one in-place.
"""
from __future__ import annotations

import datetime as _dt
import re
from typing import Any


_ARXIV_ID_RE = re.compile(r"^(\d{4}\.\d{4,5})(?:v\d+)?$")


def normalize_arxiv_id(value: Any) -> str:
    r"""Return the canonical arXiv id (e.g. ``1706.03762``) for any of:

    - bare id: ``1706.03762`` / ``1706.03762v1``
    - ``arxiv:1706.03762`` (with optional v#)
    - URL: ``https://arxiv.org/abs/1706.03762v1`` /
      ``https://arxiv.org/pdf/1706.03762v1.pdf`` /
      ``http://arxiv.org/pdf/1706.03762``
    - empty / None → ``""``

    Case-insensitive. Strips query string and trailing ``.pdf``. If the
    tail is not a valid arXiv id, returns whatever the input was (lower-
    cased & stripped) so callers can still log the offending string.

    Byte-equivalent (in semantics) to the union of:

    - ``src/main.py:239`` (handles ``arxiv:``, ``/abs/``, ``/pdf/``, ``v\d+``)
    - ``src/6.generate_docs.py:235`` (handles ``http://`` + ``abs/``/``pdf/``,
      ``.pdf`` suffix). 6.generate_docs.py:235's version failed on
      ``arxiv:`` prefix and on ``v#`` suffix; main.py:239 covers both.
    """
    text = str(value or "").strip().lower()
    if not text:
        return ""
    if text.startswith("arxiv:"):
        text = text.split(":", 1)[1].strip()
    if text.startswith("http://") or text.startswith("https://"):
        # Drop query string / fragment, trailing slash.
        text = text.split("?", 1)[0].split("#", 1)[0]
        text = text.rstrip("/")
        if "/abs/" in text:
            text = text.rsplit("/abs/", 1)[-1]
        elif "/pdf/" in text:
            text = text.rsplit("/pdf/", 1)[-1]
        else:
            text = text.rsplit("/", 1)[-1]
    if text.endswith(".pdf"):
        text = text[: -len(".pdf")]
    text = text.strip()
    matched = _ARXIV_ID_RE.match(text)
    if matched:
        return matched.group(1)
    return text


# --- run-output helpers (log + GitHub Actions fold group markers) ---
#
# Byte-equivalent to the trio that lived in every step script before this
# module existed. 4-space-indented callers (``4``, ``5``) accept the
# switch to 2-space because the function *body* stays in this module — the
# import site is the only place the indent choice becomes visible.


def log(message: str) -> None:
  ts = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
  print(f"[{ts}] {message}", flush=True)


def group_start(title: str) -> None:
  print(f"::group::{title}", flush=True)


def group_end() -> None:
  print("::endgroup::", flush=True)


# --- figure meta.json helpers ------------------------------------------
#
# backfill 脚本 (tools/backfill_md_from_txt.py, tools/fill_skeleton_notes.py)
# 直接构造 markdown,从来不抽图;但同一篇 id 在 docs/assets/figures/arxiv/<id>/
# 下面通常已有 webp + meta.json(由 daily pipeline / paper_figures.py 提前抽好)。
# 渲染层 ([arxiv].astro) 只看 figures_json frontmatter 字段,不扫磁盘目录,
# 所以 backfill 落盘的 md 会"有图但页面不显示"。
#
# 这两个 helper 让 backfill 脚本在写 md 前把 meta.json 的 figures 列表
# 转成 YAML 单引号包裹的 figures_json 字符串(与 daily pipeline 风格一致),
# 然后注入 frontmatter。这样:
#   1. backfill 落盘即带图(不需要再跑 sync_figures_json_to_md.py)
#   2. 未来如 frontmatter 漂移,astro-src/lib/paper.ts:loadFiguresFromAssetMeta
#      还有兜底


import json as _json
import os as _os
from typing import List as _List, Optional as _Optional


def figures_json_from_meta(docs_dir: str, arxiv_id_with_v: str) -> _Optional[str]:
  """读 docs/assets/figures/arxiv/<arxiv_id_with_v>/meta.json,返回 YAML 形式的
  figures_json 字符串(含外层单引号包裹),供 backfill 注入 frontmatter。

  arxiv_id_with_v: 带 v# 的完整 id(backfill 脚本里从 pdf URL 提的就是这种),
  例如 "2607.14171v1"。直接当目录名用,不去扫其他 v#。

  找不到 / 解析失败 / figures 列表为空 -> 返回 None(调用方应跳过注入,
  而不是写一个空的 figures_json 行)。
  """
  if not arxiv_id_with_v:
    return None
  meta_path = _os.path.join(
    docs_dir, "assets", "figures", "arxiv", arxiv_id_with_v, "meta.json",
  )
  if not _os.path.exists(meta_path):
    return None
  try:
    with open(meta_path, "r", encoding="utf-8") as f:
      payload = _json.load(f)
  except (OSError, _json.JSONDecodeError):
    return None
  figs = payload.get("figures") if isinstance(payload, dict) else None
  if not isinstance(figs, list) or not figs:
    return None
  # meta.json 的 url 是相对于 docs/ 的路径(形如 assets/figures/arxiv/<id>v1/fig-001.webp),
  # 跟 daily pipeline 写入 figures_json 的 url 形态完全一致,直接用。
  return _yaml_single_quoted(_json.dumps(figs, ensure_ascii=False))


def _yaml_single_quoted(s: str) -> str:
  """把 JSON 字符串包成 YAML 单引号标量(' 内部 ' 重复一次)。"""
  escaped = s.replace("'", "''")
  return f"'{escaped}'"
