"""Step 6 — Markdown file IO + value escaping.

从 6.generate_docs.py 抽出的"md 文件 upsert + YAML escape + 原子写" 链路:
- yaml_escape_value: 转义 YAML 字符串字段
- atomic_write_text: tmp + os.replace 原子写
- replace_meta_line / upsert_front_matter_field / upsert_auto_block /
  upsert_glance_block_in_text: frontmatter 与正文的 upsert helpers
- normalize_meta_tags_line: 解析 tags 行 (string 转换列表)

这 6 个函数共同依赖 atomic_write_text + yaml_escape_value, 单 submodule
方便后续一起审查与单独测试。
"""
from __future__ import annotations

import os
import re
import tempfile
from typing import List, Tuple


def yaml_escape_value(s: str) -> str:
    if not s:
        return '""'
    if any(c in s for c in [':', '#', '"', "'", '\n', '[', ']', '{', '}', ',', '&', '*', '!', '|', '>', '%', '@', '`']):
        return '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'
    return s

def atomic_write_text(path: str, content: str, encoding: str = "utf-8") -> None:
    """写文本到 path,通过 tmp + os.replace 原子写入。

    防止并发(daily cron + 手动触发跑同一篇)直接 f.write() 把半成品内容
    留在 .md 上。失败时清理 tmp。
    """
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=parent or ".", text=True)
    try:
        with os.fdopen(fd, "w", encoding=encoding) as f:
            f.write(content)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

def upsert_front_matter_field(md_text: str, key: str, value: str) -> Tuple[str, bool]:
    text = str(md_text or "")
    if not text.startswith("---\n") and not text.startswith("---\r\n"):
        return text, False
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    end_idx = normalized.find("\n---", 3)
    if end_idx == -1:
        return text, False

    block = normalized[4:end_idx]
    lines = block.split("\n") if block else []
    updated_lines: List[str] = []
    replaced = False
    for line in lines:
        if line.startswith(f"{key}:"):
            updated_lines.append(f"{key}: {value}")
            replaced = True
        else:
            updated_lines.append(line)
    if not replaced:
        updated_lines.append(f"{key}: {value}")
    updated = "---\n" + "\n".join(updated_lines).rstrip() + "\n---" + normalized[end_idx + 4 :]
    return updated, updated != normalized

