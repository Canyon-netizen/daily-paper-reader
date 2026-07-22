"""PR-5 Concept Backlinks: slug 规范化。

完整复用 Polaris concepts.py:75 wiki_slug:
  name.lower() + 非 word/非 CJK 字符塌缩为 -,空则回落 sha256(name)[:12]。
"""
from __future__ import annotations

import hashlib
import re


def wiki_slug(name: str) -> str:
    """对齐 Polaris wiki_slug.

    - 全部 lower
    - 保留 word 字符(等价于 [A-Za-z0-9_]) + CJK 一-鿿
    - 其余字符塌缩为单个 "-"
    - 两端 "-strip" 后为空 → 回落 sha256(name)[:12]
    """
    if name is None:
        return hashlib.sha256(b"").hexdigest()[:12]
    lowered = str(name).lower()
    slug = re.sub(r"[^\w一-鿿-]+", "-", lowered).strip("-")
    if not slug:
        slug = hashlib.sha256(str(name).encode("utf-8")).hexdigest()[:12]
    return slug