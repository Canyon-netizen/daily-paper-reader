"""Step 6 — pure-Markdown string helpers (no IO, no LLM).

从 6.generate_docs.py 抽出, 这一批函数处理 md 文本格式:
strip auto-sections / normalize meta lines / ensure single
sentence end. 与 stage 1 (frontmatter 解析) + stage 3 (upsert_* +
atomic_write_text) 一起把 6.generate_docs.py 的"非 LLM" 链路拆分。
"""
from __future__ import annotations

import re
from typing import Tuple


def extract_section_tail(md_text: str, heading: str) -> str:
    """
    从 md 中提取某个自动生成段落（heading）后的尾部内容。
    返回不含 heading 的文本（strip 后）。
    """
    if not md_text:
        return ""
    key = f"## {heading}"
    idx = md_text.rfind(key)
    if idx == -1:
        return ""
    return md_text[idx + len(key) :].strip()

def strip_auto_sections(md_text: str) -> str:
    """
    发送给 LLM 的“论文 Markdown 元数据”只保留正文前半段，避免把旧的自动总结/速览再喂回模型。
    """
    if not md_text:
        return ""
    markers = [
        "\n\n---\n\n## 论文详细总结（自动生成）",
        "\n\n---\n\n## 速览摘要（自动生成）",
    ]
    cut_points = [md_text.find(m) for m in markers if md_text.find(m) != -1]
    if not cut_points:
        return md_text
    cut = min(cut_points)
    return md_text[:cut].rstrip()

def normalize_meta_tldr_line(md_text: str) -> Tuple[str, bool]:
    """
    兼容历史版本：元信息区 TLDR 行曾被写成 '**TLDR**: xxx \\'。
    这里把“元信息区”的 TLDR 行末尾反斜杠去掉。
    注意：`## 速览` 区块中会使用 `\\` 表达强制换行，不能误伤。
    """
    if not md_text:
        return md_text, False
    changed = False
    lines = md_text.splitlines()
    out: List[str] = []
    for line in lines:
        # 只处理元信息区 TLDR（使用英文冒号 `:` 的格式）
        if line.startswith("**TLDR**:"):
            new_line = line.rstrip()
            if new_line.endswith("\\"):
                new_line = new_line[:-1].rstrip()
            if new_line != line:
                changed = True
            out.append(new_line)
        else:
            out.append(line)
    return "\n".join(out), changed

def normalize_glance_block_format(md_text: str) -> Tuple[str, bool]:
    """
    规范 `## 速览` 区块的换行符号：
    - TLDR/Motivation/Method/Result 行末尾应带 ` \\`（强制换行）
    - Conclusion 行末尾不应带 `\\`
    """
    if not md_text:
        return md_text, False

    lines = md_text.splitlines()
    out: List[str] = []
    changed = False
    in_glance = False

    def ensure_line_break(s: str) -> str:
        ss = s.rstrip()
        if ss.endswith("\\"):
            return ss
        return ss + " \\"

    def remove_line_break(s: str) -> str:
        ss = s.rstrip()
        if ss.endswith("\\"):
            return ss[:-1].rstrip()
        return ss

    for line in lines:
        stripped = line.strip()
        if stripped == "## 速览":
            in_glance = True
            out.append(line)
            continue

        if in_glance:
            # 速览块结束条件：分隔线或下一个二级标题
            if stripped == "---" or stripped.startswith("## "):
                in_glance = False
                out.append(line)
                continue

            if stripped.startswith("**TLDR**：") or stripped.startswith("**TLDR**:"):
                new_line = ensure_line_break(line)
            elif stripped.startswith("**Motivation**：") or stripped.startswith("**Motivation**:"):
                new_line = ensure_line_break(line)
            elif stripped.startswith("**Method**：") or stripped.startswith("**Method**:"):
                new_line = ensure_line_break(line)
            elif stripped.startswith("**Result**：") or stripped.startswith("**Result**:"):
                new_line = ensure_line_break(line)
            elif (
                stripped.startswith("**Conclusion**：")
                or stripped.startswith("**Conclusion**:")
                or stripped.startswith("**Context**：")
                or stripped.startswith("**Context**:")
            ):
                new_line = remove_line_break(line)
            else:
                new_line = line

            if new_line != line:
                changed = True
            out.append(new_line)
            continue

        out.append(line)

    return "\n".join(out), changed

def ensure_single_sentence_end(text: str) -> str:
    """
    给 TLDR/短句补一个句末标点（避免重复 '。。'）。
    """
    s = (text or "").strip()
    if not s:
        return s
    s = s.rstrip("。.!?！？")
    return s + "。"

