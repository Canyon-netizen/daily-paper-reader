"""Step 6 — pure-text helpers (LLM response cleanup).

从 6.generate_docs.py 抽出, 这是"剥除 LLM reasoning / 占位文本检测"
类的纯文本 helper, 不依赖 LLM 客户端或 sub-script. 主文件 re-export 以
保持 conference_sidebar.py 动态 import 时的 module attrs 兼容性。
"""
from __future__ import annotations

import re


REASONING_BLOCK_RE = re.compile(r"<think>.*?</think>|<thinking>.*?</thinking>", re.IGNORECASE | re.DOTALL)
PLACEHOLDER_TEXT_RE = re.compile(r"^[\s.。…·,，、;；:：!！?？\-_/\\|\"'`]+$")

def strip_llm_reasoning(text: str) -> str:
    """
    部分推理模型会把内部思考以 <think> 标签混入正文。
    文档页只应保留最终答案。
    """
    if not text:
        return ""
    return REASONING_BLOCK_RE.sub("", str(text)).strip()

def is_placeholder_text(text: str) -> bool:
    """
    判断 LLM/历史文档中常见的占位输出，如 "...", ".....", "。".
    """
    s = strip_llm_reasoning(text).strip()
    if not s:
        return True
    return bool(PLACEHOLDER_TEXT_RE.match(s))

