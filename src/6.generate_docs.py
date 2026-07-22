#!/usr/bin/env python
# Step 6：根据推荐结果生成 Docs（精读区 / 速读区），并更新侧边栏。

import argparse
import html
import json
import math
import os
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
import re
import tempfile
import time
import xml.etree.ElementTree as ET
from urllib.parse import quote_plus
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF
import requests
from llm import ClientFactory, LLMClient

SCRIPT_DIR = os.path.dirname(__file__)
ROOT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from src._utils import normalize_arxiv_id
from src.paper_figures import ensure_paper_media
from src.paper_formulas import ensure_paper_formulas
from src.title_utils import strip_title_markup
from src.venue_extract import venue_label_list
from src.taxonomy import (
    normalize_category_dim,
    build_categories as _build_cats,
    categories_to_yaml_inline,
)

CONFIG_FILE = os.path.join(ROOT_DIR, "config.yaml")
TODAY_STR = str(os.getenv("DPR_RUN_DATE") or "").strip() or datetime.now(timezone.utc).strftime("%Y%m%d")
RANGE_DATE_RE = re.compile(r"^(\d{8})-(\d{8})$")

# LLM 配置（使用 llm.py 内的 ClientFactory）
# PR-3:走 router 的 `doc.generate` stage；未配 llm_stage_models 时 fallback LLM_MODEL env。
LLM_CLIENT = None
if os.getenv("LLM_MODEL") or os.getenv("BLT_API_KEY"):
    LLM_CLIENT = ClientFactory.from_env(stage="doc.generate")

DEFAULT_DOCS_CONCURRENCY = 4

from src.generate_docs_text_utils import (
    REASONING_BLOCK_RE,
    PLACEHOLDER_TEXT_RE,
    strip_llm_reasoning,
    is_placeholder_text,
    is_too_short_for_abstract_translation,
)
def call_llm_text(
    client: LLMClient,
    messages: List[Dict[str, str]],
    temperature: float,
    max_tokens: int,
    response_format: Dict[str, Any] | None = None,
) -> str:
    client.kwargs.update(
        {
            "temperature": float(temperature),
            "max_tokens": int(max_tokens),
        }
    )
    resp = client.chat(messages=messages, response_format=response_format)
    return strip_llm_reasoning(resp.get("content") or "")

def call_llm_structured_json(
    client: LLMClient,
    messages: List[Dict[str, str]],
    schema_name: str,
    schema: Dict[str, Any],
    temperature: float,
    max_tokens: int,
) -> Dict[str, Any] | None:
    client.kwargs.update(
        {
            "temperature": float(temperature),
            "max_tokens": int(max_tokens),
        }
    )
    # 行为等价于原拒绝/finish_reason/parse_error/reasoning-strip 链:
    # - refusal -> log warn 不抛 -> on_refusal 静默
    # - finish_reason 非 stop -> log warn 不抛 -> on_incomplete_finish
    # - parse_error -> 试一次 reasoning-strip 后 抛 ValueError -> retry_on_reasoning=True
    return client.chat_structured_safe(
        messages=messages,
        schema_name=schema_name,
        schema=schema,
        on_refusal=lambda t: log(f"[WARN] Structured output refusal: {t}"),
        on_incomplete_finish=lambda fr: log(
            f"[WARN] Structured output 未完成：finish_reason={fr}"
        ),
    )

def log(message: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {message}", flush=True)

def log_substep(code: str, name: str, phase: str) -> None:
    """
    用于前端解析的子步骤标记。
    格式： [SUBSTEP] 6.1 - xxx START/END
    """
    phase = str(phase or "").strip().upper()
    if phase not in ("START", "END"):
        phase = "INFO"
    log(f"[SUBSTEP] {code} - {name} {phase}")

def load_config() -> dict:
    if not os.path.exists(CONFIG_FILE):
        return {}
    try:
        import yaml  # type: ignore
    except Exception:
        log("[WARN] 未安装 PyYAML，无法解析 config.yaml。")
        return {}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
            return data if isinstance(data, dict) else {}
    except Exception as e:
        log(f"[WARN] 读取 config.yaml 失败：{e}")
        return {}

def resolve_docs_dir() -> str:
    docs_dir = os.getenv("DOCS_DIR")
    config = load_config()
    paper_setting = (config or {}).get("arxiv_paper_setting") or {}
    crawler_setting = (config or {}).get("crawler") or {}
    cfg_docs = paper_setting.get("docs_dir") or crawler_setting.get("docs_dir")
    if not docs_dir and cfg_docs:
        if os.path.isabs(cfg_docs):
            docs_dir = cfg_docs
        else:
            docs_dir = os.path.join(ROOT_DIR, cfg_docs)
    if not docs_dir:
        docs_dir = os.path.join(ROOT_DIR, "docs")
    return docs_dir

def slugify(title: str) -> str:
    s = (title or "").strip().lower()
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"[^a-z0-9\-]+", "", s)
    return s or "paper"

def extract_pdf_text(pdf_path: str) -> str:
    doc = fitz.open(pdf_path)
    texts = []
    try:
        for page in doc:
            texts.append(page.get_text("text"))
    finally:
        doc.close()
    return "\n\n".join(texts)

def fetch_paper_markdown_via_jina(pdf_url: str, max_retries: int = 3) -> str | None:
    if not pdf_url:
        return None
    base = "https://r.jina.ai/"
    full_url = base + pdf_url
    for attempt in range(1, max_retries + 1):
        try:
            log(f"[JINA] 第 {attempt} 次请求：{full_url}")
            resp = requests.get(full_url, timeout=60)
            if resp.status_code != 200:
                log(f"[JINA][WARN] 状态码 {resp.status_code}，响应前 100 字符：{(resp.text or '')[:100]}")
            else:
                text = (resp.text or "").strip()
                if text:
                    log("[JINA] 获取到结构化 Markdown 文本，将直接用作 .txt 内容。")
                    return text
        except Exception as e:
            log(f"[JINA][WARN] 请求失败（第 {attempt} 次）：{e}")
        time.sleep(2 * attempt)
    log("[JINA][ERROR] 多次请求失败，将回退到 PyMuPDF 抽取。")
    return None

def parse_arxiv_xml_feed(xml_text: str) -> Dict[str, Any]:
    """
    从 arXiv API XML feed 中解析第一条 paper 元数据，返回内部统一字典。
    """
    root = ET.fromstring(xml_text)
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    entry = root.find("atom:entry", ns)
    if entry is None:
        raise RuntimeError("未从 arXiv 返回中解析到论文条目")

    def _text(tag: str) -> str:
        elem = entry.find(tag, ns)
        return (elem.text or "").strip() if elem is not None else ""

    arxiv_id = _text("atom:id")
    if arxiv_id:
        arxiv_id = arxiv_id.rsplit("/", 1)[-1]

    title = " ".join(_text("atom:title").split())
    abstract = " ".join(_text("atom:summary").split())
    published = _text("atom:published")
    published_date = ""
    if published:
        published_date = published.split("T", 1)[0].replace("-", "")

    authors = []
    for a in entry.findall("atom:author", ns):
        name_elem = a.find("atom:name", ns)
        if name_elem is not None:
            name = (name_elem.text or "").strip()
            if name and name not in authors:
                authors.append(name)

    pdf_url = ""
    for link in entry.findall("atom:link", ns):
        href = (link.attrib.get("href") or "").strip()
        if href.endswith(".pdf"):
            pdf_url = href
            break
        if link.attrib.get("title") == "pdf" and href:
            pdf_url = href
            break

    return {
        "id": arxiv_id,
        "title": title,
        "abstract": abstract,
        "published": published_date,
        "authors": authors,
        "link": pdf_url,
        "pdf_url": pdf_url,
        "llm_tags": ["query:transformer", "query:attention"],
    }

def fetch_arxiv_paper_meta(arxiv_id: str) -> Dict[str, Any]:
    """
    通过 arXiv API 拉取单篇论文元数据，用于单篇补生成。
    """
    pid = normalize_arxiv_id(arxiv_id)
    if not pid:
        raise ValueError("paper id 不能为空")
    url = f"https://export.arxiv.org/api/query?id_list={quote_plus(pid)}"
    log(f"[INFO] 拉取 arXiv 元数据：{url}")
    resp = requests.get(url, timeout=30)
    if resp.status_code != 200:
        raise RuntimeError(f"arXiv API 请求失败，status={resp.status_code}")
    return parse_arxiv_xml_feed(resp.text)

def translate_title_and_abstract_to_zh(title: str, abstract: str) -> Tuple[str, str]:
    if LLM_CLIENT is None:
        return "", ""
    title = title.strip() if title else ""
    abstract = abstract.strip() if abstract else ""
    if not title and not abstract:
        return "", ""

    system_prompt = (
        "你是一名熟悉机器学习与自然科学论文的专业翻译，请将英文标题和摘要翻译为自然、准确的中文。"
        "保持学术风格，尽量保留专有名词，不要额外添加评论。"
        "摘要必须完整忠实翻译英文 abstract，不要压缩成 TLDR、要点或改写总结。"
    )
    payload = {"title": title, "abstract": abstract}
    user_text = json.dumps(payload, ensure_ascii=False)

    user_prompt = (
        "请将上面的 JSON 中的 title 与 abstract 翻译成中文，并严格输出 JSON：\n"
        "{\"title_zh\": \"...\", \"abstract_zh\": \"...\"}\n"
        "要求：只输出 JSON，不要输出任何其它说明文字。\n"
        "Output must be strict JSON only, no markdown, no fences, no extra text."
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text},
        {"role": "user", "content": user_prompt},
    ]
    try:
        schema = {
            "type": "object",
            "properties": {
                "title_zh": {"type": "string"},
                "abstract_zh": {"type": "string"},
            },
            "required": ["title_zh", "abstract_zh"],
            "additionalProperties": False,
        }
        parsed = call_llm_structured_json(
            LLM_CLIENT,
            messages,
            schema_name="translate_zh",
            schema=schema,
            temperature=0.2,
            max_tokens=4000,
        )
    except Exception:
        return "", ""

    try:
        if not isinstance(parsed, dict):
            return "", ""
        obj = parsed
        if not isinstance(obj, dict):
            return "", ""
        zh_title = strip_llm_reasoning(str(obj.get("title_zh") or ""))
        zh_abstract = strip_llm_reasoning(str(obj.get("abstract_zh") or ""))
        if is_placeholder_text(zh_title):
            zh_title = ""
        if is_placeholder_text(zh_abstract):
            zh_abstract = ""
        if zh_abstract and is_too_short_for_abstract_translation(zh_abstract, abstract):
            zh_abstract = ""
    except Exception:
        return "", ""
    return zh_title, zh_abstract

from src.generate_docs_md_helpers import (
    extract_section_tail,
    strip_auto_sections,
    normalize_meta_tldr_line,
    normalize_glance_block_format,
    ensure_single_sentence_end,
)

def generate_deep_summary(md_file_path: str, txt_file_path: str, max_retries: int = 3) -> str | None:
    if LLM_CLIENT is None:
        log("[WARN] 未配置 BLT_API_KEY，跳过精读总结。")
        return None
    if not os.path.exists(md_file_path):
        return None

    with open(md_file_path, "r", encoding="utf-8") as f:
        paper_md_content = strip_auto_sections(f.read())

    paper_txt_content = ""
    if os.path.exists(txt_file_path):
        with open(txt_file_path, "r", encoding="utf-8") as f:
            paper_txt_content = f.read()

    system_prompt = (
        "你是一名资深学术论文分析助手，请使用中文、以 Markdown 形式，"
        "对给定论文做结构化、深入、客观的总结。"
    )
    user_prompt = (
        "请基于下面提供的论文内容，生成一段详细的中文总结，要求按照如下要点依次展开：\n"
        "1. 论文的核心问题与整体含义（研究动机和背景）。\n"
        "2. 论文提出的方法论：核心思想、关键技术细节、公式或算法流程。\n"
        "3. 实验设计：使用了哪些数据集 / 场景，它的 benchmark 是什么，对比了哪些方法。\n"
        "4. 资源与算力：如果文中有提到，请总结使用了多少算力（GPU 型号、数量、训练时长等）。若未明确说明，也请指出这一点。\n"
        "5. 实验数量与充分性：大概做了多少组实验（如不同数据集、消融实验等），这些实验是否充分、是否客观、公平。\n"
        "6. 论文的主要结论与发现。\n"
        "7. 优点：方法或实验设计上有哪些亮点。\n"
        "8. 不足与局限：包括实验覆盖、偏差风险、应用限制等。\n\n"
        "请用分层标题和项目符号（Markdown 格式）组织上述内容，语言尽量简洁但信息要尽量完整。\n"
        "**公式与符号渲染要求**：所有数学公式、定理表达式、目标函数、约束、梯度形式等，"
        "必须使用 KaTeX 兼容的 LaTeX 语法，并用 `$$...$$`（独立行）或 `$...$`（行内）包裹。"
        "例如写 `$$L(θ,λ) = E[ρ_t·Â_t - λ·((ρ_t-1)^2 - δ)]$$`，"
        "不要再用 ``` 代码块包公式，也不要把公式写成纯文字描述。\n"
        "只输出最终总结，不要输出思考过程、分析过程或 <think> 标签。\n"
        "要求：最后单独输出一行“（完）”作为结束标记。"
    )

    messages = [{"role": "system", "content": system_prompt}]
    if paper_txt_content:
        messages.append({"role": "user", "content": f"### 论文 PDF 提取文本 ###\n{paper_txt_content}"})
    messages.append({"role": "user", "content": f"### 论文 Markdown 元数据 ###\n{paper_md_content}"})
    messages.append({"role": "user", "content": user_prompt})

    last = ""
    for attempt in range(1, max_retries + 1):
        try:
            summary = call_llm_text(LLM_CLIENT, messages, temperature=0.3, max_tokens=4096)
            summary = (summary or "").strip()
            if not summary:
                continue
            last = summary
            if os.getenv("DPR_DEBUG_STEP6") == "1":
                log(f"[DEBUG][STEP6] deep_summary attempt={attempt} len={len(summary)} tail={summary[-20:]!r}")
            if "（完）" in summary:
                return summary
            # 续写一次：避免输出被截断
            cont_messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "你上一次的总结可能被截断了，请从中断处继续补全，不要重复已输出内容。"},
                {"role": "user", "content": f"上一次输出如下：\n\n{summary}\n\n请继续补全，最后以一行“（完）”结束。"},
            ]
            cont = call_llm_text(LLM_CLIENT, cont_messages, temperature=0.3, max_tokens=2048)
            cont = (cont or "").strip()
            merged = f"{summary}\n\n{cont}".strip()
            if os.getenv("DPR_DEBUG_STEP6") == "1":
                log(f"[DEBUG][STEP6] deep_summary_cont attempt={attempt} len={len(cont)} merged_tail={merged[-20:]!r}")
            if "（完）" in merged:
                return merged
        except Exception as e:
            log(f"[WARN] 精读总结失败（第 {attempt} 次）：{e}")
            time.sleep(2 * attempt)
    return last or None

def generate_glance_overview(title: str, abstract: str, max_retries: int = 3) -> str | None:
    """
    生成论文速览（包含 TLDR、Motivation、Method、Result、Conclusion）。
    使用 JSON 结构化输出，确保返回完整的五个字段。
    """
    if LLM_CLIENT is None:
        log("[WARN] 未配置 LLM_CLIENT，跳过速览生成。")
        return None

    system_prompt = "你是论文速览助手，请用中文生成信息密度高、但不冗长的论文速览。"
    payload = {"title": title, "abstract": abstract}
    user_text = json.dumps(payload, ensure_ascii=False)
    user_prompt = (
        "请基于上面的 JSON 中的 title 和 abstract，输出一个中文速览摘要，严格返回 JSON（不要输出任何其它文字）：\n"
        "{\"tldr\":\"...\",\"motivation\":\"...\",\"method\":\"...\",\"result\":\"...\",\"conclusion\":\"...\",\"context\":\"...\"}\n"
        "要求：\n"
        "- tldr：150-220个中文字符，不是一句话口号；通常写成3-4个短句，按“问题背景→核心方法→关键结果→贡献意义”的顺序组织\n"
        "- motivation/method/result/conclusion：每个字段30-70个中文字符，通常一句话；对标论文页速览卡片，简洁但必须包含具体信息\n"
        "- context(主题语境)：40-90个中文字符，1-2句话；把这篇论文放回所属研究主题里定位——说明它在该主题脉络中的位置(承接/扩展/对比哪类已有工作)、典型适用场景或边界条件、已知局限性或仍未解决的问题；不要重复 tldr/motivation/method/result/conclusion 里已经说过的事实\n"
        "- 不要把英文句子放进中文字段；可保留必要英文术语或模型名\n"
        "Output must be strict JSON only, no markdown, no fences, no extra text."
    )

    schema = {
        "type": "object",
        "properties": {
            "tldr": {"type": "string"},
            "motivation": {"type": "string"},
            "method": {"type": "string"},
            "result": {"type": "string"},
            "conclusion": {"type": "string"},
            "context": {"type": "string"},
        },
        "required": ["tldr", "motivation", "method", "result", "conclusion"],
        "additionalProperties": False,
    }

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text},
        {"role": "user", "content": user_prompt},
    ]

    for attempt in range(1, max_retries + 1):
        try:
            parsed = call_llm_structured_json(
                LLM_CLIENT,
                messages,
                schema_name="glance_overview",
                schema=schema,
                temperature=0.2,
                max_tokens=2048,
            )
            if not isinstance(parsed, dict):
                continue
            obj = parsed
            tldr = str(obj.get("tldr") or "").strip()
            motivation = str(obj.get("motivation") or "").strip()
            method = str(obj.get("method") or "").strip()
            result = str(obj.get("result") or "").strip()
            conclusion = str(obj.get("conclusion") or "").strip()
            context = str(obj.get("context") or "").strip()
            # 过滤掉空字段和占位符（"。" 或 "方法与实现细节请参考摘要与正文。" 等）
            # context 是新增的可选字段,空字符串视为未提供,不参与"必填五段必须齐全"的判断。
            placeholder_fields = {"", "。", "方法与实现细节请参考摘要与正文。", "结果与对比结论请参考摘要与正文。", "总体而言，该工作在所述任务上展示了有效性，并提供了可复用的思路或工具。"}
            all_fields = [tldr, motivation, method, result, conclusion]
            if not all(x and x not in placeholder_fields for x in all_fields):
                continue
            lines = [
                f"**TLDR**：{ensure_single_sentence_end(tldr)} \\",
                f"**Motivation**：{ensure_single_sentence_end(motivation)} \\",
                f"**Method**：{ensure_single_sentence_end(method)} \\",
                f"**Result**：{ensure_single_sentence_end(result)} \\",
                f"**Conclusion**：{ensure_single_sentence_end(conclusion)}",
            ]
            if context and context not in placeholder_fields:
                lines.append(f"**Context**：{ensure_single_sentence_end(context)}")
            return "\n".join(lines)
        except Exception as e:
            # 额度不足等“硬失败”不必重试，直接降级
            msg = str(e)
            if (
                "insufficient_user_quota" in msg
                or "额度不足" in msg
                or "insufficient quota" in msg
                or ("403" in msg and "Forbidden" in msg)
            ):
                log(f"[WARN] 速览生成失败（额度不足，停止重试）：{e}")
                break
            log(f"[WARN] 速览生成失败（第 {attempt} 次）：{e}")
            time.sleep(2 * attempt)
    return None

def build_glance_fallback(paper: Dict[str, Any]) -> str:
    """
    当 LLM 额度不足/不可用时的降级速览：
    - TLDR 优先用 llm_tldr_cn/llm_tldr；否则用摘要首句；
    - 其余字段用“基于摘要的启发式”生成，保证 5 段齐全。
    """
    abstract = str(paper.get("abstract") or "").strip()
    tldr = (
        str(paper.get("llm_tldr_cn") or paper.get("llm_tldr") or paper.get("llm_tldr_en") or "").strip()
    )
    evidence = str(paper.get("canonical_evidence") or "").strip()

    def first_sentence(text: str) -> str:
        s = (text or "").strip()
        if not s:
            return ""
        parts = re.split(r"(?<=[。！？.!?])\\s+", s)
        return (parts[0] if parts else s).strip()

    if not tldr:
        tldr = first_sentence(abstract)
    if not tldr and evidence:
        tldr = evidence
    tldr = ensure_single_sentence_end(tldr or "基于摘要生成的速览信息。")

    motivation = ensure_single_sentence_end(
        first_sentence(evidence) or "本文关注一个具有代表性的研究问题，并尝试提升现有方法的效果或可解释性。"
    )

    method_hint = ""
    if abstract:
        m = re.search(r"(we (?:propose|present|introduce|develop)[^\\.]{0,200})\\.", abstract, re.I)
        if m:
            method_hint = m.group(1).strip()
    method = ensure_single_sentence_end(method_hint or "方法与实现细节请参考摘要与正文。")

    result_hint = ""
    if abstract:
        m = re.search(r"(experiments? (?:show|demonstrate)[^\\.]{0,200})\\.", abstract, re.I)
        if m:
            result_hint = m.group(1).strip()
    result = ensure_single_sentence_end(result_hint or "结果与对比结论请参考摘要与正文。")

    conclusion = ensure_single_sentence_end("总体而言，该工作在所述任务上展示了有效性，并提供了可复用的思路或工具。")

    return "\n".join(
        [
            f"**TLDR**：{tldr} \\",
            f"**Motivation**：{motivation} \\",
            f"**Method**：{method} \\",
            f"**Result**：{result} \\",
            f"**Conclusion**：{conclusion}",
        ]
    )

def build_tags_html(section: str, llm_tags: List[str], llm_categories: Optional[Dict[str, List[str]]] = None) -> str:
    """
    渲染论文底部标签行 (paper 内容区)。优先读 llm_categories 4-dim;
    不存在时回退到历史 llm_tags 字符串数组。
    """
    tags_html: List[str] = []
    # 4-dim 调色板 — 与 astro-src/lib/paper.ts 渲染层对齐(.tag-venue/task/method/type)。
    kind_to_css: Dict[str, str] = {
        "venue": "tag-venue",
        "task": "tag-task",
        "method": "tag-method",
        "type": "tag-type",
        "query": "tag-blue",
        "paper": "tag-pink",
        "keyword": "tag-blue",
    }
    seen = set()

    def _emit(kind: str, label: str) -> None:
        t = (label or "").strip()
        if not t:
            return
        key = f"{kind}:{t}"
        if key in seen:
            return
        seen.add(key)
        css = kind_to_css.get(kind, "tag-pink")
        tags_html.append(
            f'<span class="tag-label {css}">{html.escape(t)}</span>'
        )

    if isinstance(llm_categories, dict):
        for dim in ("venue", "task", "method", "type"):
            items = llm_categories.get(dim) or []
            if not isinstance(items, list):
                continue
            for label in items:
                _emit(dim, str(label))
    else:
        # 新链路按 query 标签展示；历史 keyword:* 统一折叠为 query:*，避免重复。
        for tag in llm_tags:
            raw = str(tag).strip()
            if not raw:
                continue
            kind, label = split_sidebar_tag(raw)
            if kind == "keyword":
                kind = "query"
            _emit(kind, label)
    return " ".join(tags_html)

def normalize_meta_tags_line(content: str) -> Tuple[str, bool]:
    """
    兼容历史格式：文章页 `**Tags**` 不再展示“精读区/速读区”标签。
    只删除标签内容严格为“精读区/速读区”的 span，避免误伤关键词标签。
    """
    if not content:
        return content, False
    pattern = re.compile(
        r'<span\s+class="tag-label\s+tag-(?:blue|green)">\s*(?:精读区|速读区)\s*</span>\s*',
        re.IGNORECASE,
    )
    fixed = pattern.sub("", content)
    return fixed, fixed != content

def replace_meta_line(md_text: str, label: str, value: str, add_slash: bool = True) -> Tuple[str, bool]:
    """
    替换形如 `**Label**: xxx \\` 的元数据行。
    - 仅替换第一处匹配
    - 若不存在则不插入（避免意外改写用户自定义元信息结构）
    """
    txt = md_text or ""
    v = (value or "").strip()
    if not v:
        return txt, False
    line = f"**{label}**: {v}"
    if add_slash:
        line += " " + "\\"
    pattern = re.compile(f"^\\*\\*{re.escape(label)}\\*\\*:\\s*.*$", re.M)
    # 使用函数替换，避免 replacement string 中的反斜杠被当作转义序列解析
    new_txt, n = pattern.subn(lambda _m: line, txt, count=1)
    return new_txt, n > 0 and new_txt != txt

def format_date_str(date_str: str) -> str:
    s = str(date_str or "").strip()
    m = RANGE_DATE_RE.match(s)
    if m:
        a, b = m.group(1), m.group(2)
        return f"{a[:4]}-{a[4:6]}-{a[6:]} ~ {b[:4]}-{b[4:6]}-{b[6:]}"
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return date_str

def prepare_paper_paths(docs_dir: str, date_str: str, title: str, arxiv_id: str) -> Tuple[str, str, str]:
    slug = slugify(title)
    # 论文路径按 frontmatter date (YYYY-MM-DD) 分桶到 docs/papers/<YYYY>/<MM>/<DD>/,
    # 方便 ls docs/papers/2026/07/ 一眼看到当月各日的论文。arxiv id YYMM 不等于
    # 真实发表月(如 2607.00083 真实发表日可能是 2026-06-30),所以必须用 date_str 优先。
    # 所有构造都走 src.paper_paths,避免散落拼字符串漏改子目录层。
    from src.paper_paths import paper_md_path, paper_txt_path, paper_id
    # date_str 可能是 YYYYMMDD(来自 --date / TODAY_STR)或 YYYY-MM-DD,统一 normalize 成 ISO。
    iso_date = format_date_str(date_str) if date_str else ""
    if arxiv_id and iso_date:
        md_path = paper_md_path(docs_dir, arxiv_id, slug, date_str=iso_date)
        txt_path = paper_txt_path(docs_dir, arxiv_id, slug, date_str=iso_date)
        pid = paper_id(arxiv_id, slug, date_str=iso_date)
    elif arxiv_id:
        # 退化:date 不可解析时仍按 arxiv YYMM 单层分桶,不抛错(避免 daily pipeline 阻塞)
        md_path = paper_md_path(docs_dir, arxiv_id, slug)
        txt_path = paper_txt_path(docs_dir, arxiv_id, slug)
        pid = paper_id(arxiv_id, slug)
    else:
        md_path = os.path.join(docs_dir, "papers", f"{slug}.md")
        txt_path = os.path.join(docs_dir, "papers", f"{slug}.txt")
        pid = f"papers/{slug}"
    return md_path, txt_path, pid

def prepare_day_report_paths(docs_dir: str, date_str: str) -> Tuple[str, str]:
    # 日报 README 不再单文件存放 — 详情由首页 docs/README.md 承载。
    # 返回虚拟路径以保留调用方签名兼容。
    return docs_dir, os.path.join(docs_dir, "README.md")

def prepare_home_module_paths(docs_dir: str) -> Tuple[str, str]:
    notice_path = os.path.join(docs_dir, "_home_notice.md")
    promo_path = os.path.join(docs_dir, "_home_promo.md")
    return notice_path, promo_path

def ensure_home_module_files(docs_dir: str) -> Tuple[str, str]:
    notice_path, promo_path = prepare_home_module_paths(docs_dir)
    if not os.path.exists(notice_path):
        with open(notice_path, "w", encoding="utf-8") as f:
            f.write("────────────────────────────────────────\n")
            f.write("（公告占位）欢迎使用 Daily Paper Reader。\n")
            f.write("（公告占位）可在此放置本周更新、维护通知等。\n")
            f.write("────────────────────────────────────────\n")
    if not os.path.exists(promo_path):
        with open(promo_path, "w", encoding="utf-8") as f:
            f.write("")
    return notice_path, promo_path

def _read_module_markdown(path: str) -> str:
    if not os.path.exists(path):
        return ""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return (f.read() or "").strip()
    except Exception:
        return ""

def _format_entry_tags(tags: List[Tuple[str, str]]) -> str:
    labels: List[str] = []
    for kind, label in tags or []:
        k = (kind or "").strip()
        v = (label or "").strip()
        if k == "score":
            try:
                score_num = float(v)
                labels.append(f"评分：{score_num:.1f}/10")
            except Exception:
                labels.append(f"评分：{v}")
            continue
        if not v:
            continue
        if k in ("keyword", "query", "paper"):
            labels.append(f"{k}:{v}")
        else:
            labels.append(v)
    return "、".join(labels) if labels else "无标签"

def _entry_score_text(tags: List[Tuple[str, str]]) -> str:
    for kind, label in tags or []:
        if (kind or "").strip() == "score":
            v = (label or "").strip()
            if not v:
                return ""
            try:
                return f"{float(v):.1f}/10"
            except Exception:
                return v
    return ""

def build_daily_brief_summary(
    date_label: str,
    deep_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    quick_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    total_count: int,
    run_status: str,
) -> str:
    if total_count == 0:
        return "> 今日无新推荐，系统未产出可展示论文。"

    def _format_preview_item(paper_id: str, title: str, tags: List[Tuple[str, str]]) -> str:
        name = ((title or "").strip() or paper_id)
        score = _entry_score_text(tags)
        return f"《{name}》（{score}）" if score else f"《{name}》"

    deep_preview = [_format_preview_item(paper_id, title, tags) for paper_id, title, tags in deep_entries[:2] if (title or paper_id)]
    quick_preview = [_format_preview_item(paper_id, title, tags) for paper_id, title, tags in quick_entries[:3] if (title or paper_id)]
    highlight = []
    if deep_preview:
        highlight.append(f"- 精读：{', '.join(deep_preview)}")
    if quick_preview:
        highlight.append(f"- 速读：{', '.join(quick_preview)}")
    if not highlight:
        return (
            f"- 状态：{run_status}。\n"
            f"- 已完成今日生成，共收录 {total_count} 篇（精读 {len(deep_entries)} 篇，速读 {len(quick_entries)} 篇）。"
        )

    fallback = (
        f"- 今日共生成 {total_count} 篇推荐（精读 {len(deep_entries)} 篇，速读 {len(quick_entries)} 篇）\n"
        + "\n".join(highlight)
        + "\n- 这些结果覆盖了当下较热的方向，建议先看精读区论文的关键问题与方法。"
    )

    if LLM_CLIENT is None:
        return fallback

    system_prompt = (
        "你是日报编辑，请输出 3 句以内、吸引人、简洁但具体的中文总结。"
        "内容必须基于给定的推荐数据，不要编造论文信息。"
    )
    user_prompt = (
        f"日报日期：{date_label}\n"
        f"状态：{run_status}\n"
        f"总数：{total_count} 篇\n"
        f"精读：{len(deep_entries)} 篇\n"
        f"速读：{len(quick_entries)} 篇\n"
        f"精读列表（含分数）：{json.dumps(deep_preview, ensure_ascii=False)}\n"
        f"速读列表（含分数）：{json.dumps(quick_preview, ensure_ascii=False)}\n\n"
        "请按以下格式输出：\n"
        "1) 一句概括今天做了什么，适合标题感官。\n"
        "2) 一句给出最值得看的 1~2 个方向/结论。\n"
        "3) 一句给出下步建议（面向普通读者）。\n"
        "直接输出 1-3 行文本，不要 Markdown 标题，也不要 JSON，不要输出思考过程或 <think> 标签。"
    )
    try:
        content = call_llm_text(
            LLM_CLIENT,
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.45,
            max_tokens=768,
        )
        content = (content or "").strip()
        if content:
            return content
    except Exception as e:
        log(f"[WARN] 生成日报简报失败：{e}")

    return fallback

def build_docsify_id_href(path_no_ext: str) -> str:
    """
    生成站内 Markdown 内链 / 路由一致的相对路径。

    历史命名:此函数名带 "docsify" 是迁移前的惯性(原来输出 `#/...` 给 Docsify router)。
    现 Astro 5 站点没有 `#!/` 路由 —— 只要 Markdown 内链以 `/ym/day/title` /
    `/YYYYMMDD-YYYYMMDD/title` 形式给出,Astro 的动态路由就能命中(详见
    docs/path-spec.md §1)。因此本函数现在只负责:
      1. 规范化路径分隔符与去 `.md` 后缀;
      2. 输出前导 `/` 的绝对路径,与 Astro build trailingSlash='always' 配置对齐。
    注意:在 Markdown 中用 `(#/...)` 会被 Astro 在生成链接时当作页内锚点,触发
    浏览器 querySelector 报错;如要指向站内页面,直接传路径字符串即可。
    """
    p = str(path_no_ext or "").strip()
    p = p.replace("\\", "/").strip()
    p = re.sub(r"\.md$", "", p, flags=re.IGNORECASE)
    if not p:
        return "/"
    p = p.lstrip("/")
    return f"/{p}"

def build_latest_report_section(
    date_str: str,
    date_label: str | None,
    generated_at: str,
    recommend_exists: bool,
    deep_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    quick_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    paper_evidence_by_id: Dict[str, str],
) -> str:
    effective_label = (date_label or "").strip() or format_date_str(date_str)
    run_status = "成功" if recommend_exists else "未产出 recommend 文件（视为无结果）"
    total = len(deep_entries) + len(quick_entries)
    summary = build_daily_brief_summary(
        date_label=effective_label,
        deep_entries=deep_entries,
        quick_entries=quick_entries,
        total_count=total,
        run_status=run_status,
    )

    lines: List[str] = []
    lines.append(f"- 最新运行日期：{effective_label}")
    lines.append(f"- 运行时间：{generated_at}")
    lines.append(f"- 运行状态：{run_status}")
    lines.append(f"- 本次总论文数：{total}")
    lines.append(f"- 精读区：{len(deep_entries)}")
    lines.append(f"- 速读区：{len(quick_entries)}")
    if summary:
        lines.append("")
        lines.append("### 今日简报（AI）")
        lines.append(summary)
    lines.append(f"- 详情：[本次日报](#本次日报)")
    lines.append("")
    lines.append("### 精读区论文标签")
    if deep_entries:
        for idx, (paper_id, title, tags) in enumerate(deep_entries, start=1):
            safe_title = (title or "").strip() or paper_id
            evidence = (paper_evidence_by_id.get(str(paper_id).strip(), "") or "").strip()
            lines.append(f"{idx}. [{safe_title}]({build_docsify_id_href(paper_id)})  ")
            lines.append(f"   标签：{_format_entry_tags(tags)}")
            if evidence:
                lines.append(f"   evidence：{evidence}")
    else:
        lines.append("- 本次无精读推荐。")
    lines.append("")
    lines.append("### 速读区论文标签")
    if quick_entries:
        for idx, (paper_id, title, tags) in enumerate(quick_entries, start=1):
            safe_title = (title or "").strip() or paper_id
            evidence = (paper_evidence_by_id.get(str(paper_id).strip(), "") or "").strip()
            lines.append(f"{idx}. [{safe_title}]({build_docsify_id_href(paper_id)})  ")
            lines.append(f"   标签：{_format_entry_tags(tags)}")
            if evidence:
                lines.append(f"   evidence：{evidence}")
    else:
        lines.append("- 本次无速读推荐。")
    lines.append("")
    return "\n".join(lines)

def normalize_sidebar_tag(tag: str) -> str:
    text = (tag or "").strip()
    if not text:
        return ""
    for prefix in ("keyword:", "query:", "paper:", "ref:", "cite:"):
        if text.startswith(prefix):
            return text[len(prefix) :].strip()
    return text

def split_sidebar_tag(tag: str) -> Tuple[str, str]:
    """
    将 tag 解析为 (kind, label)：
    - keyword:xxx -> ("keyword", "xxx")
    - query:xxx   -> ("query", "xxx")
    - paper/ref/cite:xxx -> ("paper", "xxx")  # 预留：论文引用/跟踪标签
    - 其它 -> ("other", 原文本)
    """
    raw = (tag or "").strip()
    if not raw:
        return ("other", "")
    for prefix, kind in (
        ("keyword:", "keyword"),
        ("query:", "query"),
        ("paper:", "paper"),
        ("ref:", "paper"),
        ("cite:", "paper"),
    ):
        if raw.startswith(prefix):
            label = raw[len(prefix) :].strip()
            # composite 是 llm refine 的内部 requirement 后缀，不对前端展示。
            if kind == "query" and label.endswith(":composite"):
                label = label[: -len(":composite")].strip()
            return (kind, label)
    return ("other", raw)

def round_half_up(x: float) -> int:
    return int(math.floor(x + 0.5))

def score_to_star_rating(score: Any) -> float:
    """
    将 10 分制评分映射为 5 星制，并四舍五入到 0.5 星。
    例：10->5，9->4.5，8->4，7->3.5
    """
    try:
        s = float(score)
    except Exception:
        return 0.0
    if not math.isfinite(s):
        return 0.0
    s = max(0.0, min(10.0, s))
    return round_half_up(s) / 2.0

def build_sidebar_stars_html(score: Any) -> str:
    rating = score_to_star_rating(score)
    try:
        score_str = f"{float(score):.1f}"
    except Exception:
        score_str = ""

    if score_str:
        title = f"评分：{score_str}/10（{rating:.1f}/5）"
    else:
        title = "评分：无"

    pct = max(0.0, min(100.0, (rating / 5.0) * 100.0))
    pct_str = f"{pct:.0f}%"

    # 使用“背景星 + 填充星”的方式支持半星/小数显示
    return (
        f'<span class="dpr-stars" title="{html.escape(title)}" '
        f'aria-label="{rating:.1f} out of 5">'
        f'<span class="dpr-stars-bg">☆☆☆☆☆</span>'
        f'<span class="dpr-stars-fill" style="width:{pct_str}">★★★★★</span>'
        f"</span>"
    )

def extract_sidebar_tags(paper: Dict[str, Any], max_tags: int = 6) -> List[Tuple[str, str]]:
    """
    侧边栏展示的标签:
    - 优先读 llm_categories (4-dim {venue, task, method, type});若不存在则回退
      到历史 llm_tags (string[] ['kind:label', ...]) — 兼容老数据。
    - 去重 + 限制数量,避免侧边栏过长。
    """
    q: List[Tuple[str, str]] = []
    paper_tags: List[Tuple[str, str]] = []
    other: List[Tuple[str, str]] = []
    seen_labels = set()

    cats = paper.get("llm_categories")
    if isinstance(cats, dict):
        # 4-dim 顺序固定 venue→task→method→type,保证上游侧边栏排序稳定
        for dim in ("venue", "task", "method", "type"):
            items = cats.get(dim) or []
            if not isinstance(items, list):
                continue
            for label in items:
                t = str(label).strip()
                if not t:
                    continue
                key = f"{dim}:{t}"
                if key in seen_labels:
                    continue
                seen_labels.add(key)
                if dim == "venue":
                    q.append((dim, t))
                elif dim == "task":
                    paper_tags.append((dim, t))
                else:
                    other.append((dim, t))
                if max_tags > 0 and len(seen_labels) >= max_tags:
                    break
            if max_tags > 0 and len(seen_labels) >= max_tags:
                break
    else:
        # 历史 llm_tags 兼容:kind:label 格式
        raw: List[str] = []
        if isinstance(paper.get("llm_tags"), list):
            raw.extend([str(t) for t in (paper.get("llm_tags") or [])])

        for t in raw:
            kind, label = split_sidebar_tag(t)
            if kind == "keyword":
                kind = "query"
            label = (label or "").strip()
            if not label:
                continue
            dedup_key = f"{kind}:{label}"
            if dedup_key in seen_labels:
                continue
            seen_labels.add(dedup_key)
            if kind == "query":
                q.append((kind, label))
            elif kind == "paper":
                paper_tags.append((kind, label))
            else:
                other.append((kind, label))

            if max_tags > 0 and len(seen_labels) >= max_tags:
                break

    tags = q + paper_tags + other
    score = paper.get("llm_score")
    score_tag = []
    if score is not None:
        try:
            score_tag.append(("score", str(float(score))))
        except Exception:
            score_tag.append(("score", str(score)))
    return score_tag + tags

def ensure_text_content(pdf_url: str, txt_path: str) -> str:
    if os.path.exists(txt_path):
        with open(txt_path, "r", encoding="utf-8") as f:
            return f.read()
    text_content = fetch_paper_markdown_via_jina(pdf_url)
    if text_content is None and pdf_url:
        resp = requests.get(pdf_url, timeout=60)
        resp.raise_for_status()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp_pdf:
            tmp_pdf.write(resp.content)
            tmp_pdf.flush()
            text_content = extract_pdf_text(tmp_pdf.name)
    os.makedirs(os.path.dirname(txt_path), exist_ok=True)
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(text_content or "")
    return text_content or ""

from src.generate_docs_md_io import (
    yaml_escape_value,
    atomic_write_text,
    upsert_auto_block,
    upsert_glance_block_in_text,
    upsert_front_matter_field,
    upsert_front_matter_field_to_path,
    verify_paper_md_was_written,
)

def maybe_generate_paper_figures(
    paper: Dict[str, Any],
    *,
    docs_dir: str,
    paper_id: str,
    pdf_url: str,
) -> List[Dict[str, Any]]:
    figures, _tables = maybe_generate_paper_media(
        paper,
        docs_dir=docs_dir,
        paper_id=paper_id,
        pdf_url=pdf_url,
    )
    return figures

def maybe_generate_paper_media(
    paper: Dict[str, Any],
    *,
    docs_dir: str,
    paper_id: str,
    pdf_url: str,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    source_key = str(paper.get("source") or "").strip().lower()
    if source_key not in {"arxiv", "biorxiv"}:
        return [], []
    if not str(pdf_url or "").strip():
        return [], []

    asset_key = str(paper.get("id") or paper_id.replace("/", "-")).strip()
    try:
        return ensure_paper_media(
            pdf_url=pdf_url,
            docs_dir=docs_dir,
            source_key=source_key,
            asset_key=asset_key,
        )
    except Exception as e:
        log(f"[WARN] 论文图表提取失败：{asset_key}: {e}")
        return [], []

def build_markdown_content(
    paper: Dict[str, Any],
    section: str,
    zh_title: str,
    zh_abstract: str,
    tags_list: List[str],
    categories: Optional[Dict[str, List[str]]] = None,
) -> str:
    """
    生成论文 Markdown 内容，使用 YAML front matter 存储元数据。
    前端通过解析 front matter 渲染页面布局。

    `categories`:4-dim {venue, task, method, type},由 pipeline 上游传入
       (一般是 paper.get("llm_categories"),流程与 legacy tags_list 并存 —
       pipeline 全部迁移后会真正在 frontmatter 写 categories: 行)。
    `tags_list`:历史 string[] tags,本批内仍写 frontmatter `tags:` 行,
       保留向后读兼容 (B7 migration 后端会统一迁移到 categories)。
    """
    zh_title = strip_llm_reasoning(zh_title)
    zh_abstract = strip_llm_reasoning(zh_abstract)
    if is_placeholder_text(zh_title):
        zh_title = ""
    if is_placeholder_text(zh_abstract):
        zh_abstract = ""

    title = (paper.get("title") or "").strip()
    authors = paper.get("authors") or []
    published = str(paper.get("published") or "").strip()
    if published:
        published = published[:10]
    pdf_url = str(paper.get("link") or paper.get("pdf_url") or "").strip()
    score = paper.get("llm_score")
    evidence = str(paper.get("canonical_evidence") or "").strip()
    tldr = (
        paper.get("llm_tldr_cn")
        or paper.get("llm_tldr")
        or paper.get("llm_tldr_en")
        or ""
    ).strip()
    abstract_en = (paper.get("abstract") or "").strip()
    if not abstract_en:
        abstract_en = "arXiv did not provide an abstract for this paper."
    paper_source = str(paper.get("source") or "").strip()
    selection_source = str(paper.get("selection_source") or "").strip()
    figure_assets = paper.get("_figure_assets") if isinstance(paper.get("_figure_assets"), list) else []
    table_assets = paper.get("_table_assets") if isinstance(paper.get("_table_assets"), list) else []
    formula_assets = paper.get("_formula_assets") if isinstance(paper.get("_formula_assets"), list) else []

    # 解析速览内容
    glance = paper.get("_glance_overview", "").strip()
    glance_tldr = ""
    glance_motivation = ""
    glance_method = ""
    glance_result = ""
    glance_conclusion = ""
    glance_context = ""

    if glance:
        for line in glance.split("\n"):
            line = line.strip().rstrip("\\").strip()
            if line.startswith("**TLDR**：") or line.startswith("**TLDR**:"):
                glance_tldr = line.split("：", 1)[-1].split(":", 1)[-1].strip()
            elif line.startswith("**Motivation**：") or line.startswith("**Motivation**:"):
                glance_motivation = line.split("：", 1)[-1].split(":", 1)[-1].strip()
            elif line.startswith("**Method**：") or line.startswith("**Method**:"):
                glance_method = line.split("：", 1)[-1].split(":", 1)[-1].strip()
            elif line.startswith("**Result**：") or line.startswith("**Result**:"):
                glance_result = line.split("：", 1)[-1].split(":", 1)[-1].strip()
            elif line.startswith("**Conclusion**：") or line.startswith("**Conclusion**:"):
                glance_conclusion = line.split("：", 1)[-1].split(":", 1)[-1].strip()
            elif line.startswith("**Context**：") or line.startswith("**Context**:"):
                glance_context = line.split("：", 1)[-1].split(":", 1)[-1].strip()

    # 优先使用速览生成的 TLDR（100字左右），否则使用原来的 TLDR
    display_tldr = glance_tldr if glance_tldr else tldr
    if is_placeholder_text(display_tldr):
        display_tldr = ""

    # 辅助函数：转义 YAML 字符串中的特殊字符
    # 构建 YAML front matter
    lines = ["---"]
    lines.append(f"title: {yaml_escape_value(title)}")
    # 纯文本标题:标题里可能含 inline TeX(如 `$\max$@$k$`),原始值保留给富渲染,
    # 但浏览器 <title> / 列表卡片 / 搜索索引 / a11y 文本需要一份剥掉标记的版本。
    # 仅当剥掉后与原值不同才 emit,避免为纯英文标题写冗余字段。
    title_plain = strip_title_markup(title)
    if title_plain and title_plain != title:
        lines.append(f"title_plain: {yaml_escape_value(title_plain)}")
    if zh_title:
        lines.append(f"title_zh: {yaml_escape_value(zh_title)}")
        zh_title_plain = strip_title_markup(zh_title)
        if zh_title_plain and zh_title_plain != zh_title:
            lines.append(f"title_zh_plain: {yaml_escape_value(zh_title_plain)}")
    lines.append(f"authors: {yaml_escape_value(', '.join(authors) if authors else 'Unknown')}")
    lines.append(f"date: {yaml_escape_value(published or 'Unknown')}")
    lines.append(f"generated_at: {yaml_escape_value(datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC'))}")
    if pdf_url:
        lines.append(f"pdf: {yaml_escape_value(pdf_url)}")
    # 4-dim categories:本批开始写到 frontmatter — 与 TS 端 paper-analyzer.ts
    # buildFrontmatter / Python taxonomy.categories_to_yaml_inline 同 shape。
    # 单行 flow-style,JSON-loadable inline,Python 手写 frontmatter parser
    # (`generate_docs_frontmatter.py::_parse_front_matter`) 直接认。
    if categories:
        # 来源可信 (已 normalize 过) — 直接 category_to_yaml_inline 输出。
        try:
            from taxonomy import categories_to_yaml_inline as _cat_yaml
        except Exception:
            _cat_yaml = None
        if _cat_yaml is not None:
            lines.append(f"categories: {_cat_yaml(categories)}")
        else:
            # 单点 import 失败时,fallback 手拼 — 保险起见,不该发生。
            def _fallback(c: Dict[str, List[str]]) -> str:
                parts = []
                for dim in ("venue", "task", "method", "type"):
                    items = c.get(dim, []) or []
                    if not items:
                        parts.append(f"{dim}: []")
                    else:
                        quoted = ", ".join(f'"{v}"' for v in items)
                        parts.append(f"{dim}: [{quoted}]")
                return "{ " + ", ".join(parts) + " }"
            lines.append(f"categories: {_fallback(categories)}")
    if tags_list:
        # 历史 tags: — 本批过渡保留,旧 reader 仍按此消费;B7 migration 后
        # 统一迁到 categories 后才会不再 emit。
        lines.append(f"tags: [{', '.join(yaml_escape_value(t) for t in tags_list)}]")
    if score is not None:
        lines.append(f"score: {score}")
    if evidence:
        lines.append(f"evidence: {yaml_escape_value(evidence)}")
    if display_tldr:
        lines.append(f"tldr: {yaml_escape_value(display_tldr)}")
    if paper_source:
        lines.append(f"source: {yaml_escape_value(paper_source)}")
    if selection_source:
        lines.append(f"selection_source: {yaml_escape_value(selection_source)}")
    if figure_assets:
        lines.append(f"figures_json: {yaml_escape_value(json.dumps(figure_assets, ensure_ascii=False))}")
    if table_assets:
        lines.append(f"tables_json: {yaml_escape_value(json.dumps(table_assets, ensure_ascii=False))}")
    if formula_assets:
        # 公式片段(PDF 启发式抽取的 LaTeX),paper-fulltext.ts 拿来做 chat 上下文
        lines.append(f"formulas_json: {yaml_escape_value(json.dumps(formula_assets, ensure_ascii=False))}")

    # 速览字段
    if glance_motivation:
        lines.append(f"motivation: {yaml_escape_value(glance_motivation)}")
    if glance_method:
        lines.append(f"method: {yaml_escape_value(glance_method)}")
    if glance_result:
        lines.append(f"result: {yaml_escape_value(glance_result)}")
    if glance_conclusion:
        lines.append(f"conclusion: {yaml_escape_value(glance_conclusion)}")
    if glance_context:
        lines.append(f"context: {yaml_escape_value(glance_context)}")

    lines.append("---")
    lines.append("")

    # 正文部分：摘要
    if zh_abstract:
        lines.append("## 摘要")
        lines.append(zh_abstract)
        lines.append("")

    lines.append("## Abstract")
    lines.append(abstract_en)

    return "\n".join(lines)

def build_tags_list(section: str, llm_tags: List[str]) -> List[str]:
    """
    构建标签列表，保留 kind:label 格式。
    """
    tags: List[str] = []
    seen = set()
    for tag in llm_tags:
        raw = str(tag).strip()
        if not raw:
            continue
        kind, label = split_sidebar_tag(raw)
        if kind == "keyword":
            kind = "query"
        label = (label or "").strip()
        if not label:
            continue
        dedup_key = f"{kind}:{label}"
        if dedup_key in seen:
            continue
        seen.add(dedup_key)
        tags.append(dedup_key)
    return tags

def prepare_llm_categories(paper: Dict[str, Any]) -> Dict[str, List[str]]:
    """为 paper.llm_categories 凑 4-dim:

    1) venue:从 source 重推 (Python venue_extract.venue_label_list,与 TS
      paper.ts::backfillVenueDim 同源);
    2) task/method/type:本批内不强求填充 — LLM 尚未产出 (LLM 产出 step 在
      step 4/5 之外;此处为空 list 即可,前端 backfillVenueDim 会只补 venue)。
      LLM 真正填上后(后续 plan 迭代 / paper-analyzer 浏览器工具),B6 backfill
      再做反推 + 全 LLM 重打 4-dim。

    注意:这里的 `categories` 不是历史 llm_tags (string[]) — `paper` 已有的
    `llm_categories` 字段(若已由上游产)会被优先合并。"""
    raw_cats = paper.get("llm_categories")
    if not isinstance(raw_cats, dict):
        raw_cats = {}
    cats: Dict[str, List[str]] = {
        "venue": list(raw_cats.get("venue") or []),
        "task": normalize_category_dim(raw_cats.get("task"), "task"),
        "method": normalize_category_dim(raw_cats.get("method"), "method"),
        "type": normalize_category_dim(raw_cats.get("type"), "type"),
    }
    # venue 维度权威来源是 source;若 llm_categories 没填就从 source 推。
    if not cats["venue"]:
        cats["venue"] = venue_label_list(paper.get("source"))
    return cats


def process_paper(
    paper: Dict[str, Any],
    section: str,
    date_str: str,
    docs_dir: str,
    glance_only: bool = False,
    force_glance: bool = False,
) -> Tuple[str, str]:
    title = (paper.get("title") or "").strip()
    arxiv_id = str(paper.get("id") or paper.get("paper_id") or "").strip()
    md_path, txt_path, paper_id = prepare_paper_paths(docs_dir, date_str, title, arxiv_id)
    abstract_en = (paper.get("abstract") or "").strip()
    pdf_url = str(paper.get("link") or paper.get("pdf_url") or "").strip()
    paper_source = str(paper.get("source") or "").strip()

    # 准备 4-dim categories(从 source 推 venue;task/method/type 若上游已打,
    # 经 taxonomy 白名单过滤一次)。本批入口总是把 paper["llm_categories"]
    # 补齐,后续 build_markdown_content / extract_sidebar_tags 才有的读。
    paper["llm_categories"] = prepare_llm_categories(paper)

    glance = ""

    if os.path.exists(md_path):
        # 即使是 glance-only，也要确保生成/补齐 .txt（用于前端聊天上下文等）
        if glance_only and pdf_url:
            try:
                ensure_text_content(pdf_url, txt_path)
            except Exception:
                # 不阻塞文档生成流程：txt 拉取失败时继续（避免因为网络/源站问题导致整批中断）
                pass

        try:
            with open(md_path, "r", encoding="utf-8") as f:
                existing = f.read()
        except Exception:
            existing = ""

        existing_meta = _parse_front_matter(existing)
        has_figures_json = bool(str(existing_meta.get("figures_json") or "").strip()) if existing_meta else False
        has_tables_json = bool(str(existing_meta.get("tables_json") or "").strip()) if existing_meta else False
        has_formulas_json = bool(str(existing_meta.get("formulas_json") or "").strip()) if existing_meta else False
        if not has_figures_json or not has_tables_json:
            figures, tables = maybe_generate_paper_media(
                paper,
                docs_dir=docs_dir,
                paper_id=paper_id,
                pdf_url=pdf_url,
            )
            if figures and not has_figures_json:
                paper["_figure_assets"] = figures
                updated, changed = upsert_front_matter_field(
                    existing,
                    "figures_json",
                    yaml_escape_value(json.dumps(figures, ensure_ascii=False)),
                )
                if changed:
                    with open(md_path, "w", encoding="utf-8") as f:
                        f.write(updated + ("\n" if not updated.endswith("\n") else ""))
                    existing = updated
            if tables and not has_tables_json:
                paper["_table_assets"] = tables
                updated, changed = upsert_front_matter_field(
                    existing,
                    "tables_json",
                    yaml_escape_value(json.dumps(tables, ensure_ascii=False)),
                )
                if changed:
                    with open(md_path, "w", encoding="utf-8") as f:
                        f.write(updated + ("\n" if not updated.endswith("\n") else ""))
                    existing = updated

        # formulas_json 独立 backfill — 不依赖 figures/tables 结果,避免主流程一失败就连带跳过
        # 提取逻辑独立,且部分老论文 pdf_url 为空时直接 no-op
        if not has_formulas_json and pdf_url:
            formula_assets = ensure_paper_formulas(
                pdf_url=pdf_url,
                docs_dir=docs_dir,
                source_key=paper_source or "arxiv",
                asset_key=paper_id.replace("/", "-"),
            )
            if formula_assets:
                paper["_formula_assets"] = formula_assets
                updated, changed = upsert_front_matter_field(
                    existing,
                    "formulas_json",
                    yaml_escape_value(json.dumps(formula_assets, ensure_ascii=False)),
                )
                if changed:
                    with open(md_path, "w", encoding="utf-8") as f:
                        f.write(updated + ("\n" if not updated.endswith("\n") else ""))
                    existing = updated

        # 修复模式：若自动总结/速览存在“被截断”的迹象，则仅重生成该段落，不改动前面正文
        # 若已存在 Markdown，但缺少中文标题/中文摘要，则在“重新跑 Step6”时自动补齐
        # （历史上 --glance-only 或部分修复流程不会写入中文标题/摘要）
        if not glance_only and existing:
            try:
                lines = existing.splitlines()
                # 判断顶部是否已有两行 H1（英文+中文）
                h1_count = 0
                for line in lines[:6]:
                    if line.startswith("# "):
                        h1_count += 1
                    elif line.strip() == "":
                        # 允许空行，但一旦遇到非 H1 非空行就停止
                        continue
                    else:
                        break

                has_zh_title = h1_count >= 2
                has_zh_abstract_section = "## 摘要" in existing
                # 即使 ## 摘要 段存在,也检测正文是否过短/占位 —— 历史 backfill
                # 可能把 tldr 直接塞进 ## 摘要(见 tools/backfill_md_from_txt.py)。
                existing_zh_abstract = ""
                if has_zh_abstract_section:
                    zh_abs_m = re.search(
                        r"^##\s*摘要\s*\n(.*?)(?=^##\s|\Z)",
                        existing,
                        re.S | re.M,
                    )
                    existing_zh_abstract = (zh_abs_m.group(1).strip() if zh_abs_m else "")
                zh_abstract_is_bad = (
                    not has_zh_abstract_section
                    or not existing_zh_abstract
                    or is_placeholder_text(existing_zh_abstract)
                    or is_too_short_for_abstract_translation(existing_zh_abstract, abstract_en)
                )
                need_zh = (not has_zh_title) or zh_abstract_is_bad

                if need_zh:
                    zh_title, zh_abstract = translate_title_and_abstract_to_zh(
                        title, abstract_en
                    )
                    updated = existing

                    if (not has_zh_title) and zh_title:
                        # 插入到第一行英文标题之后
                        out_lines: List[str] = []
                        inserted = False
                        for i, line in enumerate(lines):
                            out_lines.append(line)
                            if i == 0 and line.startswith("# "):
                                out_lines.append(f"# {zh_title}")
                                inserted = True
                        if inserted:
                            updated = "\n".join(out_lines)

                    if zh_abstract_is_bad and zh_abstract:
                        # 替换 ## 摘要 段 —— 不存在则插入,已存在则重写正文。
                        if "## 摘要" in updated:
                            updated = re.sub(
                                r"(^##\s*摘要\s*\n).*?(?=^##\s|\Z)",
                                lambda m: m.group(1) + zh_abstract.strip() + "\n",
                                updated,
                                count=1,
                                flags=re.S | re.M,
                            )
                        elif "## Abstract" in updated:
                            updated = updated.replace(
                                "## Abstract",
                                "## 摘要\n" + zh_abstract.strip() + "\n\n## Abstract",
                                1,
                            )
                        else:
                            updated = (
                                updated.rstrip()
                                + "\n\n## 摘要\n"
                                + zh_abstract.strip()
                                + "\n"
                            )
                        if zh_abstract_is_bad and existing_zh_abstract:
                            log(
                                f"[WARN][STEP6] ## 摘要 过短被强制重写: "
                                f"{os.path.basename(md_path)} (cjk={len(existing_zh_abstract)} chars)"
                            )

                    if updated != existing:
                        with open(md_path, "w", encoding="utf-8") as f:
                            f.write(updated + ("\n" if not updated.endswith("\n") else ""))
                        existing = updated
            except Exception:
                # 补齐中文标题/摘要失败时不影响其它生成逻辑
                pass

        # 已存在速览则默认不重复生成（避免重复 LLM 调用），除非 force_glance=true
        has_glance = "## 速览" in existing
        if force_glance or not has_glance:
            glance = generate_glance_overview(title, abstract_en) or build_glance_fallback(paper)
            if glance:
                paper["_glance_overview"] = glance

        # 修复历史格式：TLDR 行末尾不应带反斜杠
        fixed, changed = normalize_meta_tldr_line(existing)
        if changed:
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(fixed + ("\n" if not fixed.endswith("\n") else ""))
            existing = fixed
            if os.getenv("DPR_DEBUG_STEP6") == "1":
                log(f"[DEBUG][STEP6] fixed TLDR trailing slash: {os.path.basename(md_path)}")

        # 修复历史格式：文章页 Tags 不再显示“精读区/速读区”
        fixed, changed = normalize_meta_tags_line(existing)
        if changed:
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(fixed + ("\n" if not fixed.endswith("\n") else ""))
            existing = fixed
            if os.getenv("DPR_DEBUG_STEP6") == "1":
                log(f"[DEBUG][STEP6] removed section tag from Tags: {os.path.basename(md_path)}")

        # 同步 Tags 行（例如 keyword:SR 与 query:SR 同名时也要都展示）
        tags_html = build_tags_html(section, paper.get("llm_tags") or [], paper.get("llm_categories"))
        if tags_html:
            updated, changed = replace_meta_line(existing, "Tags", tags_html, add_slash=True)
            if changed:
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(updated + ("\n" if not updated.endswith("\n") else ""))
                existing = updated

        # 规范速览块格式：TLDR/Motivation/Method/Result 末尾应带 `\\`
        updated, changed = normalize_glance_block_format(existing)
        if changed:
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(updated + ("\n" if not updated.endswith("\n") else ""))
            existing = updated

        # 插入/替换速览内容
        if glance and (force_glance or "## 速览" not in existing):
            updated = upsert_glance_block_in_text(existing, glance)
            if updated != existing:
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(updated)
                existing = updated

        if glance_only:
            # 只生成速览：不拉取 PDF、不做精读总结
            return paper_id, title

        if section == "deep":
            # 精读区：检查是否已有详细总结
            tail = extract_section_tail(existing, "论文详细总结（自动生成）")
            if tail:
                return paper_id, title

            # 生成详细总结
            pdf_url = str(paper.get("link") or paper.get("pdf_url") or "").strip()
            ensure_text_content(pdf_url, txt_path)
            summary = generate_deep_summary(md_path, txt_path)
            if summary:
                upsert_auto_block(md_path, "论文详细总结（自动生成）", summary)
            return paper_id, title
        else:
            # 速读区：不生成详细总结，只保留速览和摘要
            return paper_id, title

    # 新文件：如果只需要速览，则不拉取 PDF/Jina 文本，直接用元数据生成页面
    if glance_only:
        # 速览模式也需要生成/补齐全文 txt（优先 jina，失败则 pymupdf 兜底）
        if pdf_url:
            try:
                ensure_text_content(pdf_url, txt_path)
            except Exception:
                pass
        figures, tables = maybe_generate_paper_media(
            paper,
            docs_dir=docs_dir,
            paper_id=paper_id,
            pdf_url=pdf_url,
        )
        if figures:
            paper["_figure_assets"] = figures
        if tables:
            paper["_table_assets"] = tables
        # 公式提取(启发式,失败 no-op)— 仅 arxiv 等带 pdf_url 的源生效
        if pdf_url:
            formulas = ensure_paper_formulas(
                pdf_url=pdf_url,
                docs_dir=docs_dir,
                source_key=paper_source or "arxiv",
                asset_key=paper_id.replace("/", "-"),
            )
            if formulas:
                paper["_formula_assets"] = formulas
        glance = generate_glance_overview(title, abstract_en) or build_glance_fallback(paper)
        if glance:
            paper["_glance_overview"] = glance
        tags_list = build_tags_list(section, paper.get("llm_tags") or [])
        content = build_markdown_content(
            paper, section, "", "", tags_list, paper.get("llm_categories")
        )
        os.makedirs(os.path.dirname(md_path), exist_ok=True)
        atomic_write_text(md_path, content)
        verify_paper_md_was_written(md_path)
        return paper_id, title

    # 新文件：生成完整内容
    pdf_url = str(paper.get("link") or paper.get("pdf_url") or "").strip()
    ensure_text_content(pdf_url, txt_path)
    figures, tables = maybe_generate_paper_media(
        paper,
        docs_dir=docs_dir,
        paper_id=paper_id,
        pdf_url=pdf_url,
    )
    if figures:
        paper["_figure_assets"] = figures
    if tables:
        paper["_table_assets"] = tables
    if pdf_url:
        formulas = ensure_paper_formulas(
            pdf_url=pdf_url,
            docs_dir=docs_dir,
            source_key=paper_source or "arxiv",
            asset_key=paper_id.replace("/", "-"),
        )
        if formulas:
            paper["_formula_assets"] = formulas

    zh_title, zh_abstract = translate_title_and_abstract_to_zh(title, abstract_en)
    tags_list = build_tags_list(section, paper.get("llm_tags") or [])
    glance = generate_glance_overview(title, abstract_en) or build_glance_fallback(paper)
    if glance:
        paper["_glance_overview"] = glance
    content = build_markdown_content(
        paper, section, zh_title, zh_abstract, tags_list, paper.get("llm_categories")
    )

    os.makedirs(os.path.dirname(md_path), exist_ok=True)
    atomic_write_text(md_path, content)
    verify_paper_md_was_written(md_path)

    # PR-5: 概念图谱提取(默认 disabled)
    try:
        _pipeline_cfg = load_config() or {}
        _concepts_cfg = (_pipeline_cfg.get("concepts") or {}) if isinstance(_pipeline_cfg, dict) else {}
    except Exception:
        _concepts_cfg = {}
    if _concepts_cfg.get("enabled") and os.path.exists(md_path):
        try:
            from src.concept_extractor import extract_concepts
            with open(md_path, "r", encoding="utf-8") as f:
                _md_text = f.read()
            _concepts = extract_concepts(_md_text, _pipeline_cfg)
            from datetime import datetime, timezone
            upsert_front_matter_field_to_path(md_path, "wiki_compiled", True)
            upsert_front_matter_field_to_path(
                md_path,
                "wiki_compiled_at",
                datetime.now(timezone.utc).isoformat(),
            )
            upsert_front_matter_field_to_path(md_path, "concepts", _concepts)
        except Exception as e:  # 概念提取失败不阻塞主流程
            print(f"[concepts] extract failed: {e}", flush=True)

    # 精读区：生成详细总结
    if section == "deep":
        summary = generate_deep_summary(md_path, txt_path)
        if summary:
            upsert_auto_block(md_path, "论文详细总结（自动生成）", summary)
    # 速读区：不生成额外的总结，只保留速览和摘要

    return paper_id, title

def resolve_paper_id_to_md_path(docs_dir: str, paper_id: str) -> str:
    """
    根据 paper_id 反推 md 文件路径。
    扁平化后 paper_id 格式: papers/<arxiv-id>-<slug>
    """
    parts = str(paper_id or "").strip().split("/")
    if len(parts) != 2 or parts[0] != "papers":
        return ""
    return os.path.join(docs_dir, "papers", f"{parts[1]}.md")

def filter_entries_by_existing_files(
    docs_dir: str,
    deep_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    quick_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
) -> Tuple[List[Tuple[str, str, List[Tuple[str, str]]]], List[Tuple[str, str, List[Tuple[str, str]]]]]:
    """
    过滤掉 docs 目录下不存在的论文条目，保持 sidebar 与实际文件同步。
    """
    filtered_deep: List[Tuple[str, str, List[Tuple[str, str]]]] = []
    filtered_quick: List[Tuple[str, str, List[Tuple[str, str]]]] = []

    for paper_id, title, tags in deep_entries:
        md_path = resolve_paper_id_to_md_path(docs_dir, paper_id)
        if md_path and os.path.exists(md_path):
            filtered_deep.append((paper_id, title, tags))
        else:
            log(f"[INFO] 过滤已删除论文（精读区）: {paper_id}")

    for paper_id, title, tags in quick_entries:
        md_path = resolve_paper_id_to_md_path(docs_dir, paper_id)
        if md_path and os.path.exists(md_path):
            filtered_quick.append((paper_id, title, tags))
        else:
            log(f"[INFO] 过滤已删除论文（速读区）: {paper_id}")

    return filtered_deep, filtered_quick

def update_sidebar(
    sidebar_path: str,
    date_str: str,
    deep_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    quick_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    paper_evidence_by_id: Dict[str, str],
    date_label: str | None = None,
    docs_dir: str | None = None,
) -> None:
    def build_sidebar_item_payload(
        paper_id: str,
        title: str,
        tags: List[Tuple[str, str]],
        route_href: str,
        evidence: str = "",
    ) -> str:
        score_text = "-"
        clean_tags: List[Dict[str, str]] = []
        for kind, label in (tags or []):
            safe_kind = (kind or "other").strip() or "other"
            safe_label = (label or "").strip()
            if not safe_label:
                continue
            if safe_kind == "score":
                try:
                    score_text = f"{float(safe_label):.1f}"
                except Exception:
                    score_text = safe_label
                continue
            clean_tags.append({"kind": safe_kind, "label": safe_label})

        arxiv_id = str(paper_id or "").strip().split("/")[-1]
        paper_link = f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else route_href
        payload = {
            "title": (title or "").strip() or paper_id,
            "link": paper_link,
            "score": score_text,
            "tags": clean_tags,
        }
        safe_evidence = str(evidence or "").strip()
        if safe_evidence:
            payload["evidence"] = safe_evidence
        return html.escape(json.dumps(payload, ensure_ascii=False), quote=True)

    # 过滤掉 docs 目录下不存在的论文条目，保持 sidebar 与实际文件同步
    if docs_dir:
        filtered_deep, filtered_quick = filter_entries_by_existing_files(docs_dir, deep_entries, quick_entries)
        deep_entries = filtered_deep
        quick_entries = filtered_quick

    effective_label = (date_label or "").strip() or format_date_str(date_str)
    # 用隐藏 marker 做稳定定位，避免“展示标题”变更导致无法覆盖更新
    marker = f"<!--dpr-date:{date_str}-->"
    day_heading = f"  * {effective_label} {marker}\n"
    legacy_day_heading = f"  * {format_date_str(date_str)}\n"

    lines: List[str] = []
    if os.path.exists(sidebar_path):
        with open(sidebar_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

    daily_idx = -1
    for i, line in enumerate(lines):
        if line.strip().startswith("* Daily Papers"):
            daily_idx = i
            break
    if daily_idx == -1:
        if not any("[首页]" in line for line in lines):
            lines.append("* [首页](/)\n")
        lines.append("* Daily Papers\n")
        daily_idx = len(lines) - 1

    day_idx = -1
    for i in range(daily_idx + 1, len(lines)):
        line = lines[i]
        if line.startswith("* "):
            break
        # 优先按 marker 精准匹配
        if marker in line:
            day_idx = i
            break
        # 兼容历史格式（没有 marker）
        if line == legacy_day_heading:
            day_idx = i
            break

    if day_idx != -1:
        end = day_idx + 1
        while end < len(lines):
            if lines[end].startswith("  * ") and not lines[end].startswith("    * "):
                break
            end += 1
        del lines[day_idx:end]

    block: List[str] = [day_heading]
    if deep_entries:
        block.append("    * 精读区\n")
        for paper_id, title, tags in deep_entries:
            safe_title = html.escape((title or "").strip() or paper_id)
            href = build_docsify_id_href(paper_id)
            evidence = paper_evidence_by_id.get(str(paper_id).strip(), "")
            payload_json = build_sidebar_item_payload(paper_id, title, tags, href, evidence)
            block.append(
                "      * "
                f'<a class="dpr-sidebar-item-link dpr-sidebar-item-structured" href="{href}" data-sidebar-item="{payload_json}">{safe_title}</a>\n'
            )
    if quick_entries:
        block.append("    * 速读区\n")
        for paper_id, title, tags in quick_entries:
            safe_title = html.escape((title or "").strip() or paper_id)
            href = build_docsify_id_href(paper_id)
            evidence = paper_evidence_by_id.get(str(paper_id).strip(), "")
            payload_json = build_sidebar_item_payload(paper_id, title, tags, href, evidence)
            block.append(
                "      * "
                f'<a class="dpr-sidebar-item-link dpr-sidebar-item-structured" href="{href}" data-sidebar-item="{payload_json}">{safe_title}</a>\n'
            )

    insert_idx = daily_idx + 1
    lines[insert_idx:insert_idx] = block

    # 清理历史 Sidebar 中遗留的“日报”入口
    i = daily_idx + 1
    while i < len(lines):
        line = lines[i]
        if line.startswith("* "):
            break
        if lines[i].startswith("    * [日报]("):
            del lines[i]
            continue
        i += 1

    with open(sidebar_path, "w", encoding="utf-8") as f:
        f.writelines(lines)

def build_day_report_markdown(
    date_str: str,
    date_label: str | None,
    deep_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    quick_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    recommend_exists: bool,
) -> str:
    effective_label = (date_label or "").strip() or format_date_str(date_str)
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    total = len(deep_entries) + len(quick_entries)
    run_status = "成功" if recommend_exists else "未产出 recommend 文件（视为无结果）"
    summary = build_daily_brief_summary(
        date_label=effective_label,
        deep_entries=deep_entries,
        quick_entries=quick_entries,
        total_count=total,
        run_status=run_status,
    )

    lines: List[str] = []
    lines.append(f"# 日报 · {effective_label}")
    lines.append("")
    lines.append(f"- 生成时间：{generated_at}")
    lines.append(f"- 当次推荐总数：{total}")
    lines.append(f"- 精读区：{len(deep_entries)}")
    lines.append(f"- 速读区：{len(quick_entries)}")
    if summary:
        lines.append("")
        lines.append("## 今日简报（AI）")
        lines.append(summary)
    lines.append("")

    if not recommend_exists:
        lines.append("> 本次未找到 recommend 结果文件。")
        lines.append("")
    elif total == 0:
        lines.append("> 本次触发没有产出可推荐论文。")
        lines.append("")

    lines.append("## 精读区")
    if deep_entries:
        for idx, (paper_id, title, _tags) in enumerate(deep_entries, start=1):
            safe_title = (title or "").strip() or paper_id
            score = _entry_score_text(_tags)
            suffix = f"（{score}）" if score else ""
            lines.append(f"{idx}. [{safe_title}]({build_docsify_id_href(paper_id)}) {suffix}")
    else:
        lines.append("- 本次无精读推荐。")
    lines.append("")

    lines.append("## 速读区")
    if quick_entries:
        for idx, (paper_id, title, _tags) in enumerate(quick_entries, start=1):
            safe_title = (title or "").strip() or paper_id
            score = _entry_score_text(_tags)
            suffix = f"（{score}）" if score else ""
            lines.append(f"{idx}. [{safe_title}]({build_docsify_id_href(paper_id)}) {suffix}")
    else:
        lines.append("- 本次无速读推荐。")
    lines.append("")

    lines.append("---")
    lines.append("使用键盘方向键可在日报/论文之间快速切换。")
    lines.append("")
    return "\n".join(lines)

def write_day_report_readme(
    docs_dir: str,
    date_str: str,
    date_label: str | None,
    deep_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    quick_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    recommend_exists: bool,
) -> str:
    day_dir, day_readme = prepare_day_report_paths(docs_dir, date_str)
    os.makedirs(day_dir, exist_ok=True)
    content = build_day_report_markdown(
        date_str=date_str,
        date_label=date_label,
        deep_entries=deep_entries,
        quick_entries=quick_entries,
        recommend_exists=recommend_exists,
    )
    with open(day_readme, "w", encoding="utf-8") as f:
        f.write(content)
    return day_readme

def list_day_report_links(docs_dir: str) -> List[Tuple[str, str]]:
    # 扁平化后日报详情只在 docs/README.md,不再列举历史日期目录。
    return []

def build_home_readme_content(
    docs_dir: str,
    date_str: str,
    date_label: str | None,
    generated_at: str,
    recommend_exists: bool,
    deep_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    quick_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    paper_evidence_by_id: Dict[str, str],
) -> str:
    notice_path, promo_path = ensure_home_module_files(docs_dir)
    notice_md = _read_module_markdown(notice_path)
    promo_md = _read_module_markdown(promo_path)
    latest_report_md = build_latest_report_section(
        date_str=date_str,
        date_label=date_label,
        generated_at=generated_at,
        recommend_exists=recommend_exists,
        deep_entries=deep_entries,
        quick_entries=quick_entries,
        paper_evidence_by_id=paper_evidence_by_id,
    )

    lines: List[str] = []
    lines.append(notice_md or "（公告模块为空）")
    lines.append("")
    lines.append("## 每次日报")
    lines.append(latest_report_md)
    if promo_md:
        lines.append("")
        lines.append(promo_md)
    lines.append("")
    return "\n".join(lines)

def sync_home_readme_from_day_report(
    docs_dir: str,
    date_str: str,
    date_label: str | None,
    generated_at: str,
    recommend_exists: bool,
    deep_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    quick_entries: List[Tuple[str, str, List[Tuple[str, str]]]],
    paper_evidence_by_id: Dict[str, str],
) -> str:
    home_readme = os.path.join(docs_dir, "README.md")
    # 首页由三段模块拼接：公告栏（独立 md）+ 本次日报 + 宣传栏（独立 md）
    content = build_home_readme_content(
        docs_dir=docs_dir,
        date_str=date_str,
        date_label=date_label,
        generated_at=generated_at,
        recommend_exists=recommend_exists,
        deep_entries=deep_entries,
        quick_entries=quick_entries,
        paper_evidence_by_id=paper_evidence_by_id,
    )
    with open(home_readme, "w", encoding="utf-8") as f:
        f.write(content)
    return home_readme

def get_paper_sidebar_evidence(paper: Dict[str, Any]) -> str:
    return str(paper.get("canonical_evidence") or "").strip()

def write_run_daily_log(
    date_str: str,
    mode: str,
    recommend_path: str,
    recommend_exists: bool,
    deep_count: int,
    quick_count: int,
    docs_dir: str,
    day_readme: str,
) -> str:
    log_dir = os.path.join(ROOT_DIR, "archive", date_str, "logs")
    os.makedirs(log_dir, exist_ok=True)
    out_path = os.path.join(log_dir, "daily_report.json")
    payload = {
        "date": format_date_str(date_str),
        "mode": mode,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "recommend_path": recommend_path,
        "recommend_exists": bool(recommend_exists),
        "deep_count": int(deep_count),
        "quick_count": int(quick_count),
        "total_count": int(deep_count + quick_count),
        "docs_dir": docs_dir,
        "day_readme": day_readme,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return out_path

def backfill_history_day_reports(docs_dir: str) -> int:
    # 扁平化后不再按日期分桶,无需补齐历史日报 README。
    return 0

from src.generate_docs_frontmatter import (
    _extract_md_section,
    _parse_simple_yaml_list,
    _parse_front_matter,
    _parse_generated_md_to_meta,
)

def write_day_meta_index_json(
    docs_dir: str,
    date_str: str,
    date_label: str | None,
    deep_list: List[Dict[str, Any]],
    quick_list: List[Dict[str, Any]],
) -> str:
    """
    在 docs/papers/ 下生成可下载的索引 JSON。所有论文统一汇总到这一份,
    而不是按日期分桶;过往每日运行会原地覆盖同一文件(内容包含最近一次 run 的全量论文)。
    """
    target_dir = os.path.join(docs_dir, "papers")
    os.makedirs(target_dir, exist_ok=True)
    out_path = os.path.join(target_dir, "papers.meta.json")

    effective_label = (date_label or "").strip() or format_date_str(date_str)

    papers: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []
    for section, lst in (("deep", deep_list), ("quick", quick_list)):
        for paper in lst:
            try:
                title = (paper.get("title") or "").strip()
                arxiv_id = str(paper.get("id") or paper.get("paper_id") or "").strip()
                md_path, _, pid = prepare_paper_paths(docs_dir, date_str, title, arxiv_id)
                item = _parse_generated_md_to_meta(
                    md_path,
                    pid,
                    section,
                    str(paper.get("selection_source") or ""),
                    str(paper.get("abstract") or ""),
                )
                papers.append(item)
            except Exception as e:
                errors.append(
                    {
                        "paper_id": str(paper.get("id") or paper.get("paper_id") or ""),
                        "error": str(e),
                    }
                )

    payload = {
        "label": effective_label,
        "date": format_date_str(date_str),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "count": len(papers),
        "papers": papers,
        "errors": errors,
    }

    with open(out_path, "w", encoding="utf-8") as f:
        # 索引文件用于下载：保持可读的 JSON pretty 格式（每个 paper 一个对象块）
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return out_path

def main() -> None:
    parser = argparse.ArgumentParser(description="Step 6: generate docs for deep/quick sections.")
    parser.add_argument("--date", type=str, default=TODAY_STR, help="date string YYYYMMDD.")
    parser.add_argument("--mode", type=str, default=None, help="mode for recommend file.")
    parser.add_argument("--docs-dir", type=str, default=None, help="override docs dir.")
    parser.add_argument(
        "--sidebar-date-label",
        type=str,
        default=None,
        help="侧边栏日期标题展示文本（例如：2026-01-01 ~ 2026-01-27）。不填则使用单日日期。",
    )
    parser.add_argument(
        "--glance-only",
        action="store_true",
        help="只生成/补齐 `## 速览`（基于 title+abstract），不下载 PDF/Jina 文本，不生成精读总结。",
    )
    parser.add_argument(
        "--force-glance",
        action="store_true",
        help="强制重生成 `## 速览` 并覆盖写入（即使文件里已存在该块）。",
    )
    parser.add_argument(
        "--sidebar-only",
        action="store_true",
        help="只更新 docs/_sidebar.md（不生成/不重写论文 Markdown，避免触发 LLM 调用）。",
    )
    parser.add_argument(
        "--fix-tags-only",
        action="store_true",
        help="仅修复已生成文章里的 `**Tags**`（移除“精读区/速读区”标签），不触发 LLM。",
    )
    parser.add_argument(
        "--paper-id",
        type=str,
        default=None,
        help="单篇模式：填写 arXiv id（如 1706.03762v1 / https://arxiv.org/abs/1706.03762v1）。",
    )
    parser.add_argument(
        "--paper-date",
        type=str,
        default="",
        help="单篇模式：论文输出目录日期（YYYYMMDD），默认使用论文发布时间。",
    )
    parser.add_argument(
        "--paper-section",
        type=str,
        default="quick",
        help="单篇模式：deep 或 quick（默认 quick）。",
    )
    parser.add_argument(
        "--paper-title",
        type=str,
        default=None,
        help="单篇模式：可选，手动覆盖论文标题。",
    )
    parser.add_argument(
        "--docs-concurrency",
        type=int,
        default=DEFAULT_DOCS_CONCURRENCY,
        help="step6 每篇论文并发生成数量。",
    )
    args = parser.parse_args()

    date_str = args.date or TODAY_STR
    mode = args.mode
    if not mode:
        config = load_config()
        setting = (config or {}).get("arxiv_paper_setting") or {}
        mode = str(setting.get("mode") or "standard").strip()
    if "," in mode:
        mode = mode.split(",", 1)[0].strip()

    docs_dir = args.docs_dir or resolve_docs_dir()
    created_reports = backfill_history_day_reports(docs_dir)
    if created_reports > 0:
        log(f"[INFO] 已补齐历史日报 README：{created_reports} 个")

    if args.paper_id:
        log_substep("6.p", "单篇论文生成", "START")
        try:
            paper = fetch_arxiv_paper_meta(args.paper_id)
            if not str(paper.get("source") or "").strip():
                paper["source"] = "arxiv"
            if args.paper_title:
                paper["title"] = args.paper_title.strip()
            single_date = (args.paper_date or "").strip()
            if not single_date:
                single_date = (paper.get("published") or "").strip()
            if not single_date:
                single_date = TODAY_STR

            section = (args.paper_section or "quick").strip().lower()
            if section not in ("deep", "quick"):
                section = "quick"

            paper_id = str(paper.get("id") or args.paper_id).strip()
            paper["paper_id"] = paper_id
            _, paper_title = process_paper(
                paper,
                section,
                single_date,
                docs_dir,
                glance_only=args.glance_only,
                force_glance=args.force_glance,
            )
            log(f"[OK] 单篇论文已生成：{paper_title}（{paper_id}），date={single_date}，section={section}")
            log_substep("6.p", "单篇论文生成", "END")
            return
        except Exception as e:
            log(f"[ERROR] 单篇论文生成失败：{e}")
            log_substep("6.p", "单篇论文生成", "END")
            return

    archive_dir = os.path.join(ROOT_DIR, "archive", date_str, "recommend")
    recommend_path = os.path.join(archive_dir, f"arxiv_papers_{date_str}.{mode}.json")
    recommend_exists = os.path.exists(recommend_path)
    if not recommend_exists:
        log(f"[WARN] recommend 文件不存在（今天可能没有新论文）：{recommend_path}。将生成空日报并更新首页。")

    log_substep("6.1", "读取 recommend 结果", "START")
    payload = {}
    try:
        if recommend_exists:
            with open(recommend_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
    finally:
        log_substep("6.1", "读取 recommend 结果", "END")
    deep_list = payload.get("deep_dive") or []
    quick_list = payload.get("quick_skim") or []

    def _paper_score(p: dict) -> float:
        try:
            return float(p.get("llm_score", 0) or 0)
        except Exception:
            return 0.0

    def _paper_id(p: dict) -> str:
        return str(p.get("id") or p.get("paper_id") or "").strip()

    # 侧边栏展示按分数降序（同分按 id 稳定排序），避免“高分被埋在下面”
    deep_list = sorted(deep_list, key=lambda p: (-_paper_score(p), _paper_id(p)))
    quick_list = sorted(quick_list, key=lambda p: (-_paper_score(p), _paper_id(p)))

    if args.fix_tags_only:
        changed_files = 0
        total_files = 0
        for section, lst in (("deep", deep_list), ("quick", quick_list)):
            for paper in lst:
                title = (paper.get("title") or "").strip()
                arxiv_id = str(paper.get("id") or paper.get("paper_id") or "").strip()
                md_path, _, _ = prepare_paper_paths(docs_dir, date_str, title, arxiv_id)
                if not os.path.exists(md_path):
                    continue
                total_files += 1
                try:
                    with open(md_path, "r", encoding="utf-8") as f:
                        content = f.read()
                except Exception:
                    continue
                fixed, changed = normalize_meta_tags_line(content)
                if not changed:
                    continue
                try:
                    with open(md_path, "w", encoding="utf-8") as f:
                        f.write(fixed + ("\n" if not fixed.endswith("\n") else ""))
                    changed_files += 1
                except Exception:
                    continue
        log(f"[OK] fix-tags-only: scanned={total_files}, updated={changed_files}")
        return

    deep_entries: List[Tuple[str, str, List[Tuple[str, str]]]] = []
    quick_entries: List[Tuple[str, str, List[Tuple[str, str]]]] = []
    docs_concurrency = max(1, int(args.docs_concurrency))

    def _process_section(
        section: str,
        papers: List[Dict[str, Any]],
        paper_evidence_by_id: Dict[str, str],
    ) -> List[Tuple[str, str, List[Tuple[str, str]]]]:
        if not papers:
            return []
        max_workers = max(1, docs_concurrency)
        futures: Dict[Any, Tuple[int, Dict[str, Any]]] = {}
        results: List[Tuple[int, Tuple[str, str, List[Tuple[str, str]]]]] = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            for index, paper in enumerate(papers):
                future = executor.submit(
                    process_paper,
                    paper,
                    section,
                    date_str,
                    docs_dir,
                    args.glance_only,
                    args.force_glance,
                )
                futures[future] = (index, paper)

            for future in as_completed(futures):
                index, paper = futures[future]
                paper_id = str(paper.get("id") or paper.get("paper_id") or "").strip()
                paper_label = paper_id or paper.get("title") or f"<paper #{index}>"
                try:
                    pid, title = future.result()
                except (requests.RequestException, json.JSONDecodeError,
                        TimeoutError, ConnectionError, OSError) as e:
                    log(
                        f"[WARN] 生成{section}论文失败（瞬时错误，跳过该篇）："
                        f"{paper_label} | {type(e).__name__}: {e}"
                    )
                    continue
                except Exception as e:
                    log(
                        f"[ERROR] 生成{section}论文失败（疑似代码 bug，中止本节）："
                        f"{paper_label} | {type(e).__name__}: {e}"
                    )
                    log("".join(traceback.format_exception(type(e), e, e.__traceback__)))
                    raise
                paper_evidence_by_id[str((pid or "").strip())] = get_paper_sidebar_evidence(paper)
                section_tags = extract_sidebar_tags(paper)
                results.append((index, (pid, title, section_tags)))

        results.sort(key=lambda item: item[0])
        return [v for _, v in results]

    sidebar_evidence_by_id: Dict[str, str] = {}

    if args.sidebar_only:
        log_substep("6.2", "跳过生成文章（仅更新侧边栏）", "SKIP")
        for paper in deep_list:
            title = (paper.get("title") or "").strip()
            arxiv_id = str(paper.get("id") or paper.get("paper_id") or "").strip()
            _, _, pid = prepare_paper_paths(docs_dir, date_str, title, arxiv_id)
            sidebar_evidence_by_id[str(pid).strip()] = get_paper_sidebar_evidence(paper)
            deep_entries.append((pid, title, extract_sidebar_tags(paper)))

        for paper in quick_list:
            title = (paper.get("title") or "").strip()
            arxiv_id = str(paper.get("id") or paper.get("paper_id") or "").strip()
            _, _, pid = prepare_paper_paths(docs_dir, date_str, title, arxiv_id)
            sidebar_evidence_by_id[str(pid).strip()] = get_paper_sidebar_evidence(paper)
            quick_entries.append((pid, title, extract_sidebar_tags(paper)))
        log_substep("6.3", "跳过生成文章（仅更新侧边栏）", "SKIP")
    else:
        log_substep("6.2", "生成精读区文章", "START")
        deep_entries = _process_section("deep", deep_list, sidebar_evidence_by_id)
        log_substep("6.2", "生成精读区文章", "END")

        log_substep("6.3", "生成速读区文章", "START")
        quick_entries = _process_section("quick", quick_list, sidebar_evidence_by_id)
        log_substep("6.3", "生成速读区文章", "END")

        # 一致性检查：防止 _process_section 静默吞掉全部异常后写 0 md、
        # 但 step6 仍然 exit 0 把"空日报"提交上去。
        # 任何异常如果走到这一步之前已经 raise,_process_section 会直接冒泡;
        # 这里只防"瞬时错误跳过若干篇"导致 .md 显著少于预期的情况。
        expected = len(deep_list) + len(quick_list)
        actual = len(deep_entries) + len(quick_entries)
        if expected > 0:
            missing = expected - actual
            if missing > 0:
                ratio = actual / expected
                log(
                    f"[ERROR] step6 一致性检查未通过：expected {expected} mds, "
                    f"actual {actual} ({missing} failed; 写入率 {ratio:.0%}). "
                    f"Abort 防止空日报 commit。"
                )
                # daily commit 拒绝提交明显残缺的一批,让用户在
                # GH Actions 日志里立刻看到 [WARN]/[ERROR] 行号和
                # paper id,而不是几天后才发现 home 没有新论文。
                raise SystemExit(2)
            else:
                log(
                    f"[OK] step6 一致性检查通过：expected {expected}, "
                    f"actual {actual} mds."
                )

    log_substep("6.4", "生成当日日报并同步首页 README", "START")
    run_generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    day_readme = write_day_report_readme(
        docs_dir=docs_dir,
        date_str=date_str,
        date_label=args.sidebar_date_label,
        deep_entries=deep_entries,
        quick_entries=quick_entries,
        recommend_exists=recommend_exists,
    )
    home_readme = sync_home_readme_from_day_report(
        docs_dir=docs_dir,
        date_str=date_str,
        date_label=args.sidebar_date_label,
        generated_at=run_generated_at,
        recommend_exists=recommend_exists,
        deep_entries=deep_entries,
        quick_entries=quick_entries,
        paper_evidence_by_id=sidebar_evidence_by_id,
    )
    log(f"[OK] day report saved: {day_readme}")
    log(f"[OK] home README synced: {home_readme}")
    log_substep("6.4", "生成当日日报并同步首页 README", "END")

    sidebar_path = os.path.join(docs_dir, "_sidebar.md")
    if deep_entries or quick_entries:
        log_substep("6.5", "更新侧边栏", "START")
        update_sidebar(
            sidebar_path,
            date_str,
            deep_entries,
            quick_entries,
            sidebar_evidence_by_id,
            date_label=args.sidebar_date_label,
            docs_dir=docs_dir,
        )
        log_substep("6.5", "更新侧边栏", "END")
    else:
        log_substep("6.5", "更新侧边栏", "SKIP")
        log("[INFO] 本次无推荐论文，不写入 Sidebar 日期目录。")

    log_substep("6.6", "生成可下载元数据索引（JSON）", "START")
    try:
        out_path = write_day_meta_index_json(
            docs_dir,
            date_str,
            args.sidebar_date_label,
            deep_list,
            quick_list,
        )
        log(f"[OK] meta index saved: {out_path}")
    except Exception as e:
        log(f"[WARN] 生成元数据索引失败：{e}")
    log_substep("6.6", "生成可下载元数据索引（JSON）", "END")

    log_substep("6.7", "写入运行日志（日报）", "START")
    run_log = write_run_daily_log(
        date_str=date_str,
        mode=mode,
        recommend_path=recommend_path,
        recommend_exists=recommend_exists,
        deep_count=len(deep_entries),
        quick_count=len(quick_entries),
        docs_dir=docs_dir,
        day_readme=day_readme,
    )
    log(f"[OK] daily report log saved: {run_log}")
    log_substep("6.7", "写入运行日志（日报）", "END")

    log(f"[OK] docs updated: {docs_dir}")

if __name__ == "__main__":
    main()
