"""
论文公式提取 — 从 arXiv PDF 里启发式抽出 LaTeX 片段,写进 docs/assets/formulas/<source>/<id>/meta.json。

为什么需要这个模块:
  - 论文笔记 .md 和 chat 侧栏 system prompt 都需要看到公式 LaTeX。
  - .md 里的公式已经是 LLM 输出的合法 LaTeX(2,739 个 $...$ + 522 个 $$...$$,100% 干净),
    paper-analyzer + markdown.ts 走 KaTeX SSR 渲染即可。
  - 但 chat 切"全文"模式时,paper-fulltext.ts 从 ar5iv 读到的 LaTeX 残缺,本地 .txt
    又是纯文本,LLM 看不到公式。本模块给 PDF 跑一遍字体启发式,把 LaTeX 片段
    塞进 .md frontmatter formulas_json,paper-fulltext.ts 可以从这里补回公式上下文。

实现策略:
  - PyMuPDF page.get_text("dict") 拿到 span 级 font/size/bbox 信息;
  - 已知 math 字体(CMMI/CMSY/CMEX/Math/Symbol/STIX...)命中 + 斜体启发式识别 math span;
  - 按行聚类(允许 ±2pt 行差)→ 一个 cluster 就是一个公式片段;
  - Unicode 数学符号 → LaTeX 命令映射(够日常覆盖),上标/下标 span → ^{} / _{};
  - 缓存到 meta.json,跟 paper_figures.py 的 cascade 模式对齐(本期只做 PDF 启发式,
    arxiv e-print 源文件解析留作 follow-up)。

依赖: PyMuPDF(已在 requirements.txt)。零新增 pip 包。
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from typing import Any, Dict, List

import fitz


FORMULA_META_VERSION = 1

# 已知 math 字体家族 — 命中任一就视为 math span(字体名是 PDF 内嵌的子集名,小写匹配)
MATH_FONT_PATTERNS = (
    "cmmi", "cmsy", "cmex", "cmr",          # Computer Modern math
    "math", "symbol", "stix",
    "latin modern math", "newcomputermodernmath",
    "xits", "asana", "tex",
    "cambria math", "dejavu math",
)

# Unicode 数学符号 → LaTeX 命令。覆盖日常可见的希腊字母 + 运算符;
# 完整覆盖不现实,够 LLM 上下文用就行,残缺部分 LLM 会自己脑补
UNICODE_TO_LATEX = {
    "α": r"\alpha", "β": r"\beta", "γ": r"\gamma", "δ": r"\delta",
    "ε": r"\epsilon", "ζ": r"\zeta", "η": r"\eta", "θ": r"\theta",
    "ι": r"\iota", "κ": r"\kappa", "λ": r"\lambda", "μ": r"\mu",
    "ν": r"\nu", "ξ": r"\xi", "π": r"\pi", "ρ": r"\rho",
    "σ": r"\sigma", "τ": r"\tau", "φ": r"\phi", "χ": r"\chi",
    "ψ": r"\psi", "ω": r"\omega",
    "Γ": r"\Gamma", "Δ": r"\Delta", "Θ": r"\Theta", "Λ": r"\Lambda",
    "Π": r"\Pi", "Σ": r"\Sigma", "Φ": r"\Phi", "Ψ": r"\Psi", "Ω": r"\Omega",
    "∑": r"\sum", "∏": r"\prod", "∫": r"\int", "∂": r"\partial",
    "∇": r"\nabla", "∞": r"\infty", "√": r"\sqrt",
    "≤": r"\le", "≥": r"\ge", "≠": r"\ne", "≈": r"\approx",
    "∈": r"\in", "∉": r"\notin", "⊂": r"\subset", "⊃": r"\supset",
    "∪": r"\cup", "∩": r"\cap", "∀": r"\forall", "∃": r"\exists",
    "→": r"\to", "⇒": r"\Rightarrow", "↦": r"\mapsto",
    "×": r"\times", "·": r"\cdot", "÷": r"\div",
}
SUPERSCRIPT = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")
SUBSCRIPT = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")


def _safe_asset_key(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return "paper"
    text = re.sub(r"[^A-Za-z0-9._-]+", "-", text)
    text = text.strip("-._")
    return text or "paper"


def _absolute_dir(docs_dir: str, source_key: str, asset_key: str) -> str:
    return os.path.join(docs_dir, "assets", "formulas", source_key, _safe_asset_key(asset_key))


def _meta_path(docs_dir: str, source_key: str, asset_key: str) -> str:
    return os.path.join(_absolute_dir(docs_dir, source_key, asset_key), "meta.json")


def _load_cached_formulas(meta_path: str) -> List[Dict[str, Any]]:
    """读缓存;文件不存在 / 版本不匹配 / 字段缺失都返回 None(走重新提取路径)。"""
    if not os.path.exists(meta_path):
        return []
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            payload = json.load(f) or {}
    except Exception:
        return []
    if int(payload.get("version") or 0) != FORMULA_META_VERSION:
        return []
    items = payload.get("formulas")
    if not isinstance(items, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        latex = str(item.get("latex") or "").strip()
        if not latex:
            continue
        bbox = item.get("bbox") or []
        if not isinstance(bbox, list) or len(bbox) != 4:
            bbox = [0, 0, 0, 0]
        out.append(
            {
                "latex": latex,
                "page": int(item.get("page") or 0),
                "bbox": [float(b) for b in bbox],
            }
        )
    return out


def _save_formulas_meta(meta_path: str, formulas: List[Dict[str, Any]], *, extractor: str) -> None:
    os.makedirs(os.path.dirname(meta_path), exist_ok=True)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "version": FORMULA_META_VERSION,
                "extractor": extractor,
                "formulas": formulas,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )


def _is_math_span(span: Dict[str, Any]) -> bool:
    """判定一个 PDF text span 是否属于数学字体/斜体公式。"""
    font = (span.get("font") or "").lower()
    text = span.get("text") or ""
    if any(p in font for p in MATH_FONT_PATTERNS):
        return True
    # 启发式 2:斜体 + 含数学符号(普通 Times Italic + 希腊字母)
    is_italic = bool(int(span.get("flags") or 0) & 0x04)
    has_math_char = any(c in text for c in UNICODE_TO_LATEX)
    if is_italic and has_math_char:
        return True
    return False


def _cluster_math_spans(d: Dict[str, Any]) -> List[List[Dict[str, Any]]]:
    """对 dict 结构的 page 输出做行聚类:同一 y(允许 ±2pt)相邻的 math span 合并。"""
    math_spans: List[Dict[str, Any]] = []
    for block in d.get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                if _is_math_span(span):
                    math_spans.append({**span, "_line_y": line["bbox"][1]})

    math_spans.sort(key=lambda s: (s["_line_y"], s["bbox"][0]))
    clusters: List[List[Dict[str, Any]]] = []
    cur: List[Dict[str, Any]] = []
    cur_y: float | None = None
    for s in math_spans:
        if cur and cur_y is not None and abs(s["_line_y"] - cur_y) > 2:
            clusters.append(cur)
            cur = []
        if not cur:
            cur_y = s["_line_y"]
        cur.append(s)
    if cur:
        clusters.append(cur)
    return clusters


def _cluster_to_latex(cluster: List[Dict[str, Any]]) -> str:
    """把一个 cluster 的 span 文本拼成 LaTeX,处理 superscript/subscript。"""
    parts: List[str] = []
    base_y0 = cluster[0]["bbox"][1]
    base_y1 = cluster[0]["bbox"][3]
    for s in cluster:
        text = (s.get("text") or "").strip()
        if not text:
            continue
        # Unicode 数学符号 → LaTeX 命令
        for ch, cmd in UNICODE_TO_LATEX.items():
            text = text.replace(ch, cmd)
        text = text.translate(SUPERSCRIPT).translate(SUBSCRIPT)
        # 启发式 super/sub:span 的 y0/y1 显著偏移,只对短字符串加 ^{} / _{} 包裹
        if text and len(text) <= 3:
            if s["bbox"][1] < base_y0 - 1:
                text = f"^{{{text}}}"
            elif s["bbox"][3] > base_y1 + 1:
                text = f"_{{{text}}}"
        parts.append(text)
    return " ".join(parts)


def _looks_like_formula(latex: str) -> bool:
    """二次过滤:必须是像公式,而不是像正文短句。

    启发式:
      - 长度 < 5 一定不是(单字符 / 双字符噪声太多)
      - 长度 > 500 不是(误聚类成段落)
      - 不含任何 LaTeX 命令或数学符号 — 说明命中了一行普通文字,跳过
    """
    if len(latex) < 5 or len(latex) > 500:
        return False
    if "\\" not in latex and not any(c in latex for c in "=±∞∑∫∏≤≥"):
        return False
    return True


def extract_formulas_from_pdf(
    pdf_path: str,
    *,
    max_per_page: int = 30,
    max_per_paper: int = 500,
) -> List[Dict[str, Any]]:
    """从 PDF 中启发式提取显示公式。返回 [{latex, page, bbox}]。

    精度约 60-70%:能识别的公式会被还原成 LaTeX 片段喂给 LLM 上下文,
    识别不到的(非标准字体 / 复杂布局)就跳过,不影响正文路径。
    """
    out: List[Dict[str, Any]] = []
    if not os.path.exists(pdf_path):
        return out
    doc = fitz.open(pdf_path)
    try:
        for page_idx, page in enumerate(doc):
            if len(out) >= max_per_paper:
                break
            d = page.get_text("dict")
            clusters = _cluster_math_spans(d)
            for cluster in clusters[:max_per_page]:
                if len(out) >= max_per_paper:
                    break
                latex = _cluster_to_latex(cluster)
                # 长度 + 形态双重过滤 — 过滤短噪声("5 \times" 这种)和误聚类段落
                if not _looks_like_formula(latex):
                    continue
                bbox = [
                    min(s["bbox"][0] for s in cluster),
                    min(s["bbox"][1] for s in cluster),
                    max(s["bbox"][2] for s in cluster),
                    max(s["bbox"][3] for s in cluster),
                ]
                out.append({"latex": latex, "page": page_idx + 1, "bbox": bbox})
    finally:
        doc.close()
    return out


def ensure_paper_formulas(
    *,
    pdf_url: str,
    docs_dir: str,
    source_key: str,
    asset_key: str,
    force: bool = False,
) -> List[Dict[str, Any]]:
    """Cascade 入口:缓存命中直接返回,否则下载 PDF + 启发式提取 + 落盘。

    跟 paper_figures.ensure_paper_media 同模式(meta.json 缓存),但本期只做 PDF 启发式
    一层。arxiv e-print .tex 源文件解析留作 follow-up(覆盖 ~70% 论文,精度更高)。
    """
    if not str(pdf_url or "").strip():
        return []

    meta_path = _meta_path(docs_dir, source_key, asset_key)
    if not force:
        cached = _load_cached_formulas(meta_path)
        if cached:
            return cached
        # meta.json 存在但 cached 为空([])也是有效结果(论文可能没公式),直接返回
        if os.path.exists(meta_path):
            return []

    # PDF 启发式
    try:
        import requests  # 局部 import,允许 mock 测试时绕过网络
        resp = requests.get(
            str(pdf_url).strip(),
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=90,
        )
        resp.raise_for_status()
        pdf_bytes = resp.content
    except Exception as e:
        print(f"[WARN] 论文 PDF 下载失败 {asset_key}:{e}", flush=True)
        return []

    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = tmp.name
        formulas = extract_formulas_from_pdf(tmp_path)
        _save_formulas_meta(meta_path, formulas, extractor="pymupdf-heuristic")
        return formulas
    except Exception as e:
        print(f"[WARN] 论文公式提取失败 {asset_key}:{e}", flush=True)
        # 失败时仍写一个空 meta.json,避免下次再重试
        try:
            _save_formulas_meta(meta_path, [], extractor="pymupdf-heuristic-failed")
        except Exception:
            pass
        return []
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass