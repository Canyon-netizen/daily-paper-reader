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


def is_too_short_for_abstract_translation(zh_abstract: str, abstract_en: str) -> bool:
    """
    粗略识别「把 Abstract 写成一句 TLDR」的情况。
    对较长英文摘要，完整中文翻译通常不会只有英文词数的一小部分。

    阈值采用分段(而非单点):
      - en < 60 词:不校验(短摘要本身就短,误判代价高)
      - 60 ≤ en < 150:比值 0.55(中等长度)
      - en ≥ 150:比值 0.45(长摘要中文更省字,比值反而低)

    真 TLDR(比如 en=200 zh_cjk=27, ratio=0.13)任何合理阈值都会命中。
    """
    zh_cjk = len(re.findall(r"[一-鿿]", zh_abstract or ""))
    en_words = len(re.findall(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?", abstract_en or ""))
    if en_words < 60:
        return False
    ratio = 0.55 if en_words < 150 else 0.45
    return zh_cjk < int(en_words * ratio)

