from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from typing import Any, Dict, List, Tuple

import fitz
import requests
from PIL import Image


MIN_FIGURE_WIDTH = 240
MIN_FIGURE_HEIGHT = 180
MIN_FIGURE_AREA = 120_000
WEBP_QUALITY = 82
FIGURE_META_VERSION = 2
PAPERCROPPER_SCRIPT_ENV = "PAPERCROPPER_SCRIPT"
PAPERCROPPER_DIR_ENV = "PAPERCROPPER_DIR"
PAPERCROPPER_MODEL_ENV = "PAPERCROPPER_MODEL"
PAPERCROPPER_PYTHON_ENV = "PAPERCROPPER_PYTHON"
PAPERCROPPER_DISABLE_ENV = "PAPERCROPPER_DISABLE"
PAPERCROPPER_MODEL_FILENAME = "doclayout_yolo_docstructbench_imgsz1280_2501.pt"
PAPERCROPPER_LOG_LIMIT = 1200


def _safe_asset_key(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return "paper"
    text = re.sub(r"[^A-Za-z0-9._-]+", "-", text)
    text = text.strip("-._")
    return text or "paper"


def _relative_prefix(source_key: str, asset_key: str) -> str:
    return "/".join(["assets", "figures", source_key, _safe_asset_key(asset_key)])


def _absolute_dir(docs_dir: str, source_key: str, asset_key: str) -> str:
    return os.path.join(docs_dir, "assets", "figures", source_key, _safe_asset_key(asset_key))


def _relative_tables_prefix(source_key: str, asset_key: str) -> str:
    return "/".join(["assets", "tables", source_key, _safe_asset_key(asset_key)])


def _absolute_tables_dir(docs_dir: str, source_key: str, asset_key: str) -> str:
    return os.path.join(docs_dir, "assets", "tables", source_key, _safe_asset_key(asset_key))


def _load_cached_media(meta_path: str, key: str) -> List[Dict[str, Any]]:
    if not os.path.exists(meta_path):
        return []
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            payload = json.load(f) or {}
    except Exception:
        return []
    if int(payload.get("version") or 0) != FIGURE_META_VERSION:
        return []
    items = payload.get(key)
    if not isinstance(items, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        out.append(
            {
                "url": url,
                "caption": str(item.get("caption") or "").strip(),
                "page": int(item.get("page") or 0),
                "index": int(item.get("index") or 0),
                "width": int(item.get("width") or 0),
                "height": int(item.get("height") or 0),
            }
        )
    return out


def _load_cached_figures(meta_path: str) -> List[Dict[str, Any]]:
    return _load_cached_media(meta_path, "figures")


def _load_cached_tables(meta_path: str) -> List[Dict[str, Any]]:
    return _load_cached_media(meta_path, "tables")


def _save_media_meta(meta_path: str, items: List[Dict[str, Any]], *, extractor: str, key: str) -> None:
    os.makedirs(os.path.dirname(meta_path), exist_ok=True)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "version": FIGURE_META_VERSION,
                "extractor": extractor,
                key: items,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )


def _save_figures_meta(meta_path: str, figures: List[Dict[str, Any]], *, extractor: str) -> None:
    _save_media_meta(meta_path, figures, extractor=extractor, key="figures")


def _save_tables_meta(meta_path: str, tables: List[Dict[str, Any]], *, extractor: str) -> None:
    _save_media_meta(meta_path, tables, extractor=extractor, key="tables")


def _warn_papercropper(message: str) -> None:
    print(f"[WARN] PaperCropper 表格/图表提取降级：{message}", flush=True)


def _tail_log_text(text: str, limit: int = PAPERCROPPER_LOG_LIMIT) -> str:
    compact = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(compact) <= limit:
        return compact
    return "..." + compact[-limit:]


def _papercropper_was_configured() -> bool:
    return any(
        str(os.getenv(name) or "").strip()
        for name in [PAPERCROPPER_SCRIPT_ENV, PAPERCROPPER_DIR_ENV, PAPERCROPPER_MODEL_ENV, PAPERCROPPER_PYTHON_ENV]
    )


def _download_pdf_bytes(pdf_url: str, timeout: int = 90) -> bytes:
    resp = requests.get(
        str(pdf_url or "").strip(),
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=max(int(timeout or 1), 1),
    )
    resp.raise_for_status()
    return resp.content


def _truthy_env(name: str) -> bool:
    return str(os.getenv(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def _first_existing(candidates: List[str]) -> str:
    for candidate in candidates:
        path = str(candidate or "").strip()
        if path and os.path.exists(path):
            return path
    return ""


def _resolve_papercropper() -> Tuple[str, str, str]:
    if _truthy_env(PAPERCROPPER_DISABLE_ENV):
        return "", "", ""

    configured_dir = str(os.getenv(PAPERCROPPER_DIR_ENV) or "").strip()
    cache_root = os.path.expanduser("~/.cache/dpr-tools/papercropper")
    script_path = _first_existing(
        [
            str(os.getenv(PAPERCROPPER_SCRIPT_ENV) or "").strip(),
            os.path.join(configured_dir, "extract.py") if configured_dir else "",
            os.path.join(cache_root, "PaperCropper", "extract.py"),
            os.path.expanduser("~/.cache/dpr-tools/PaperCropper/extract.py"),
            "/tmp/PaperCropper/extract.py",
        ]
    )
    model_path = _first_existing(
        [
            str(os.getenv(PAPERCROPPER_MODEL_ENV) or "").strip(),
            os.path.join(configured_dir, "models", PAPERCROPPER_MODEL_FILENAME) if configured_dir else "",
            os.path.join(cache_root, "models", PAPERCROPPER_MODEL_FILENAME),
            os.path.expanduser(f"~/.cache/dpr-tools/papercropper/models/{PAPERCROPPER_MODEL_FILENAME}"),
            f"/tmp/papercropper-run/models/{PAPERCROPPER_MODEL_FILENAME}",
        ]
    )
    python_path = _first_existing(
        [
            str(os.getenv(PAPERCROPPER_PYTHON_ENV) or "").strip(),
            os.path.join(cache_root, "venv", "bin", "python"),
            "/tmp/papercropper-venv/bin/python",
            sys.executable,
        ]
    )
    if not script_path or not model_path or not python_path:
        return "", "", ""
    return python_path, script_path, model_path


def _load_image_size(path: str) -> tuple[int, int]:
    with Image.open(path) as img:
        img.load()
        return img.size


def _save_webp_from_path(src_path: str, dst_path: str) -> tuple[int, int]:
    with Image.open(src_path) as img:
        img.load()
        width, height = img.size
        if img.mode == "RGBA":
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1])
            export_img = bg
        elif img.mode != "RGB":
            export_img = img.convert("RGB")
        else:
            export_img = img.copy()
        export_img.save(dst_path, format="WEBP", quality=WEBP_QUALITY, method=6)
        return width, height


def _natural_sort_key(path: str) -> List[Any]:
    name = os.path.basename(path)
    parts = re.split(r"(\d+)", name)
    return [int(part) if part.isdigit() else part.lower() for part in parts]


def _collect_papercropper_pngs(
    src_dir: str,
    output_dir: str,
    relative_prefix: str,
    *,
    file_prefix: str,
    label: str,
) -> List[Dict[str, Any]]:
    if not os.path.isdir(src_dir):
        return []

    os.makedirs(output_dir, exist_ok=True)
    items: List[Dict[str, Any]] = []
    seen_hash: set[str] = set()
    paths = [
        os.path.join(src_dir, name)
        for name in os.listdir(src_dir)
        if name.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
    ]
    for index, src_path in enumerate(sorted(paths, key=_natural_sort_key), start=1):
        try:
            with open(src_path, "rb") as f:
                sha = hashlib.sha256(f.read()).hexdigest()
        except Exception:
            continue
        if sha in seen_hash:
            continue
        seen_hash.add(sha)
        file_name = f"{file_prefix}-{len(items) + 1:03d}.webp"
        abs_path = os.path.join(output_dir, file_name)
        try:
            width, height = _save_webp_from_path(src_path, abs_path)
        except Exception:
            continue
        items.append(
            {
                "url": "/".join([relative_prefix.strip("/"), file_name]),
                "caption": "",
                "page": 0,
                "index": len(items) + 1,
                "width": width,
                "height": height,
                "label": label,
            }
        )
    return items


def _extract_media_with_papercropper(
    pdf_path: str,
    figure_output_dir: str,
    figure_relative_prefix: str,
    table_output_dir: str,
    table_relative_prefix: str,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    python_path, script_path, model_path = _resolve_papercropper()
    if not python_path or not script_path or not model_path:
        if not _truthy_env(PAPERCROPPER_DISABLE_ENV) and _papercropper_was_configured():
            _warn_papercropper("未找到可用的 PaperCropper 脚本或模型，改用备用图片提取器。")
        return [], []

    timeout = int(os.getenv("PAPERCROPPER_TIMEOUT_SECONDS") or "360")
    conf = str(os.getenv("PAPERCROPPER_CONF") or "0.4")
    imgsz = str(os.getenv("PAPERCROPPER_IMGSZ") or "1024")
    dpi = str(os.getenv("PAPERCROPPER_DPI") or "200")
    png_dpi = str(os.getenv("PAPERCROPPER_PNG_DPI") or "260")
    batch_size = str(os.getenv("PAPERCROPPER_BATCH_SIZE") or "4")
    padding = str(os.getenv("PAPERCROPPER_PADDING") or "2.0")

    with tempfile.TemporaryDirectory(prefix="papercropper_") as tmp_root:
        cmd = [
            python_path,
            script_path,
            "--pdf",
            pdf_path,
            "--model",
            model_path,
            "--output",
            tmp_root,
            "--formats",
            "png",
            "--targets",
            "figure,table",
            "--conf",
            conf,
            "--imgsz",
            imgsz,
            "--dpi",
            dpi,
            "--png-dpi",
            png_dpi,
            "--batch-size",
            batch_size,
            "--padding",
            padding,
        ]
        try:
            proc = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=max(timeout, 30),
                check=False,
            )
        except subprocess.TimeoutExpired:
            _warn_papercropper(f"执行超时（>{max(timeout, 30)}s），改用备用图片提取器。")
            return [], []
        if proc.returncode != 0:
            detail = _tail_log_text("\n".join([proc.stdout or "", proc.stderr or ""]))
            suffix = f"；输出：{detail}" if detail else ""
            _warn_papercropper(f"执行失败 returncode={proc.returncode}{suffix}")
            return [], []

        doc_output = os.path.join(tmp_root, os.path.splitext(os.path.basename(pdf_path))[0])
        figures = _collect_papercropper_pngs(
            os.path.join(doc_output, "Figures_png"),
            figure_output_dir,
            figure_relative_prefix,
            file_prefix="fig",
            label="Figure",
        )
        tables = _collect_papercropper_pngs(
            os.path.join(doc_output, "Tables_png"),
            table_output_dir,
            table_relative_prefix,
            file_prefix="table",
            label="Table",
        )
        if figures:
            _save_figures_meta(os.path.join(figure_output_dir, "meta.json"), figures, extractor="papercropper")
        if tables:
            _save_tables_meta(os.path.join(table_output_dir, "meta.json"), tables, extractor="papercropper")
        if not figures and not tables:
            detail = _tail_log_text("\n".join([proc.stdout or "", proc.stderr or ""]))
            suffix = f"；输出：{detail}" if detail else ""
            _warn_papercropper(f"执行完成但未产出 figure/table{suffix}")
        else:
            print(f"[INFO] PaperCropper 提取完成：figures={len(figures)} tables={len(tables)}", flush=True)
        return figures, tables


# ============================================================================
# arXiv e-print 源码包抽图(优先级最高)
#
# 背景:对于 TikZ/PGFplots 矢量图论文(如控制论/数学类),PDF 里 figure 是矢量绘制
#  + 文本标签,没有 embedded image object。PyMuPDF-images 兜底分支只能抓到
#  PDF 里 raster image object,这种论文通常只能得到 1 张或 0 张图。
#
# 解法:直接拉 arXiv e-print(LaTeX 源码打包),作者已经准备所有 figure 文件
#  (figures/figs/images/img/ 子目录里的 .png/.pdf/.jpg/.jpeg/.webp),直接 copy 即可。
#
# URL: https://arxiv.org/e-print/<arxiv-id>
# arXiv 返回 Content-Type 不固定 — 大多数论文是 application/x-tar + gzip,
# 也可能是 application/pdf(单文件 LaTeX 源码)。需要嗅探 magic bytes。
#
# 注意:
#   - 仅 source_key == "arxiv" 时启用(其它数据源没 e-print)
#   - 失败/无图时返回 [],让调用者 fallback 到 PaperCropper / PyMuPDF
#   - 与其他抽图器一样:输出 webp,见 _save_webp_from_path
# ============================================================================
EPRINT_SOURCE_DIRS = ("figures", "figs", "figure", "images", "img", "graphics")
EPRINT_IMAGE_EXTS = (".png", ".pdf", ".jpg", ".jpeg", ".webp", ".gif")
EPRINT_MIN_BYTES = 1_000  # 小于这个字节的图通常是空白 placeholder,跳过


def _extract_arxiv_source_tar(blob: bytes, out_dir: str) -> List[str]:
    """
    从 e-print 二进制流里解压所有文件到 out_dir。
    arXiv 通常返回 tar+gzip;少数是 gzip 单文件 .tex。
    返回解压出来的所有文件的相对路径(相对于 out_dir)。
    """
    os.makedirs(out_dir, exist_ok=True)
    out_paths: List[str] = []

    # 尝试 1: tar + gzip(magic: 1f 8b)
    if blob[:2] == b"\x1f\x8b":
        try:
            with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
                # 安全过滤(避免路径穿越,虽然 arXiv 应该是可信的)
                members: List[tarfile.TarInfo] = []
                for m in tar.getmembers():
                    if not m.isfile():
                        continue
                    # 跳过 macOS 隐藏文件
                    name = os.path.basename(m.name)
                    if name.startswith(".") or name in ("__MACOSX",):
                        continue
                    members.append(m)
                tar.extractall(out_dir, members=members)
                for m in members:
                    out_paths.append(os.path.join(out_dir, m.name))
            return out_paths
        except Exception as e:
            print(f"[WARN] arxiv e-print tar.gz 解压失败: {e}")

    # 尝试 2: 纯 gzip 单文件(单 .tex 源码,没图,直接返回)
    import gzip as _gzip

    try:
        with _gzip.open(io.BytesIO(blob), "rb") as gz:
            content = gz.read()
        # 内容看起来是 LaTeX 的话,说明是单文件源码,没 figures/
        if b"\\begin{document}" in content or b"\\documentclass" in content:
            print("[INFO] arxiv e-print 是单文件 LaTeX 源码,无 figures 子目录")
            return []
    except Exception:
        pass

    return []


def _collect_source_figure_files(extract_root: str) -> List[str]:
    """
    在解压出的源码树里找 figure 文件:
      1) 优先 figures/ / figs/ / figure/ / images/ / img/ / graphics/ 这些专用目录
      2) 否则扫描所有 .tex 引用的图片(用简易正则抓 \\includegraphics)
      3) 否则退到根目录扫描 .png/.jpg/.pdf

    返回:绝对路径列表(已 _natural_sort_key 排序,避免不同机器顺序不一致)
    """
    candidates: List[str] = []

    # 1) 专用子目录扫描
    for sub in EPRINT_SOURCE_DIRS:
        sub_path = os.path.join(extract_root, sub)
        if not os.path.isdir(sub_path):
            continue
        for name in os.listdir(sub_path):
            ext = os.path.splitext(name)[1].lower()
            if ext in EPRINT_IMAGE_EXTS:
                candidates.append(os.path.join(sub_path, name))

    if candidates:
        candidates.sort(key=_natural_sort_key)
        return candidates

    # 2) 扫描 .tex 文件里的 \includegraphics 引用
    tex_files: List[str] = []
    for root, _dirs, files in os.walk(extract_root):
        for f in files:
            if f.lower().endswith((".tex", ".latex")):
                tex_files.append(os.path.join(root, f))

    if tex_files:
        ref_re = re.compile(
            r"\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}",
            re.IGNORECASE,
        )
        refs: set[str] = set()
        for tf in tex_files:
            try:
                with open(tf, "r", encoding="utf-8", errors="ignore") as fh:
                    content = fh.read()
            except Exception:
                continue
            tex_dir = os.path.dirname(tf)
            for m in ref_re.finditer(content):
                rel = m.group(1).strip()
                # 去掉可选的扩展名(LaTeX 经常省略)
                rel_no_ext = os.path.splitext(rel)[0]
                # 多个候选扩展名都试一下
                for ext in EPRINT_IMAGE_EXTS:
                    cand = os.path.join(tex_dir, rel + ext)
                    if os.path.isfile(cand):
                        refs.add(cand)
                        break
                    cand2 = os.path.join(tex_dir, rel_no_ext + ext)
                    if os.path.isfile(cand2):
                        refs.add(cand2)
                        break
        if refs:
            candidates = sorted(refs, key=_natural_sort_key)
            return candidates

    # 3) 兜底:整棵树扫 png/jpg/pdf
    for root, _dirs, files in os.walk(extract_root):
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in EPRINT_IMAGE_EXTS:
                candidates.append(os.path.join(root, f))
    candidates.sort(key=_natural_sort_key)
    return candidates


def fetch_arxiv_source_figures(
    arxiv_id: str,
    docs_dir: str,
    asset_key: str,
    *,
    timeout: int = 90,
) -> List[Dict[str, Any]]:
    """
    从 arXiv e-print 源码包里抽 figure 文件,转 webp 后写入
    docs/assets/figures/arxiv/<asset_key>/fig-NNN.webp。

    返回:figures 列表,字段结构与 extract_figures_from_pdf 一致
    (page=0 / index 顺序 / width,height 由 PIL 读)。
    失败(网络错/解压失败/无图)返回 [],调用者 fallback 到其他抽图器。
    """
    arxiv_id = str(arxiv_id or "").strip()
    if not arxiv_id:
        return []

    figure_dir = _absolute_dir(docs_dir, "arxiv", asset_key)
    figure_relative_prefix = _relative_prefix("arxiv", asset_key)
    os.makedirs(figure_dir, exist_ok=True)

    # 已抽过(meta.json 存在)就跳过,除非 force(本函数暂不接 force,留给 ensure_paper_media)
    meta_path = os.path.join(figure_dir, "meta.json")
    if os.path.exists(meta_path):
        cached = _load_cached_figures(meta_path)
        if cached:
            return cached

    url = f"https://arxiv.org/e-print/{arxiv_id}"
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=max(int(timeout or 1), 1),
            allow_redirects=True,
        )
        resp.raise_for_status()
        blob = resp.content
    except Exception as e:
        print(f"[WARN] arxiv e-print 下载失败 ({arxiv_id}): {e}")
        return []

    if len(blob) < 256:
        print(f"[WARN] arxiv e-print 返回过小 ({len(blob)} bytes),可能 ID 不对")
        return []

    # 解压到临时目录
    figures: List[Dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="arxiv_src_") as tmp:
        extracted = _extract_arxiv_source_tar(blob, tmp)
        if not extracted:
            return []

        # 收集 figure 候选文件
        candidates = _collect_source_figure_files(tmp)
        if not candidates:
            print(f"[INFO] arxiv e-print {arxiv_id} 源码里没找到 figure 文件")
            return []

        # 转 webp + 写盘
        seen_sha: set[str] = set()
        idx = 0
        for src_path in candidates:
            try:
                size = os.path.getsize(src_path)
            except OSError:
                continue
            if size < EPRINT_MIN_BYTES:
                continue

            # 去重(同一个图被 sources 里重复引用)
            try:
                with open(src_path, "rb") as fh:
                    sha = hashlib.sha256(fh.read()).hexdigest()
            except OSError:
                continue
            if sha in seen_sha:
                continue
            seen_sha.add(sha)

            idx += 1
            file_name = f"fig-{idx:03d}.webp"
            abs_path = os.path.join(figure_dir, file_name)
            try:
                if src_path.lower().endswith(".pdf"):
                    # LaTeX 里的 figure PDF:用 PyMuPDF 转第一页为 webp
                    import fitz as _fitz

                    with _fitz.open(src_path) as pdf_doc:
                        if len(pdf_doc) == 0:
                            continue
                        page = pdf_doc[0]
                        # 3x 缩放(≈216 DPI),保证清晰
                        mat = _fitz.Matrix(3, 3)
                        pix = page.get_pixmap(matrix=mat, alpha=False)
                        pix.save(abs_path.replace(".webp", ".png"))
                    webp_src = abs_path.replace(".webp", ".png")
                else:
                    webp_src = src_path
                width, height = _save_webp_from_path(webp_src, abs_path)
                if webp_src != src_path:
                    try:
                        os.remove(webp_src)
                    except OSError:
                        pass
            except Exception as e:
                print(f"[WARN] 转 webp 失败 {src_path}: {e}")
                continue

            figures.append(
                {
                    "url": "/".join([figure_relative_prefix.strip("/"), file_name]),
                    "caption": "",
                    "page": 0,
                    "index": idx,
                    "width": width,
                    "height": height,
                }
            )

    if figures:
        _save_figures_meta(meta_path, figures, extractor="arxiv-eprint")
        print(
            f"[INFO] arxiv e-print 抽图完成 {arxiv_id}: figures={len(figures)}",
            flush=True,
        )
    return figures


def extract_figures_from_pdf(
    pdf_path: str,
    output_dir: str,
    relative_prefix: str,
    *,
    min_width: int = MIN_FIGURE_WIDTH,
    min_height: int = MIN_FIGURE_HEIGHT,
    min_area: int = MIN_FIGURE_AREA,
) -> List[Dict[str, Any]]:
    os.makedirs(output_dir, exist_ok=True)
    figures: List[Dict[str, Any]] = []
    seen_xref: set[int] = set()
    seen_sha: set[str] = set()
    fig_index = 1

    with fitz.open(pdf_path) as doc:
        for page_idx in range(len(doc)):
            page = doc[page_idx]
            for image_info in page.get_images(full=True):
                xref = int(image_info[0] or 0)
                if xref <= 0 or xref in seen_xref:
                    continue
                seen_xref.add(xref)
                try:
                    raw = doc.extract_image(xref)
                except Exception:
                    continue
                image_bytes = raw.get("image") if isinstance(raw, dict) else None
                if not image_bytes:
                    continue
                sha = hashlib.sha256(image_bytes).hexdigest()
                if sha in seen_sha:
                    continue
                seen_sha.add(sha)

                try:
                    with Image.open(io.BytesIO(image_bytes)) as img:
                        img.load()
                        width, height = img.size
                        if width < min_width or height < min_height or width * height < min_area:
                            continue
                        if img.mode == "RGBA":
                            bg = Image.new("RGB", img.size, (255, 255, 255))
                            bg.paste(img, mask=img.split()[-1])
                            export_img = bg
                        elif img.mode != "RGB":
                            export_img = img.convert("RGB")
                        else:
                            export_img = img.copy()
                except Exception:
                    continue

                file_name = f"fig-{fig_index:03d}.webp"
                abs_path = os.path.join(output_dir, file_name)
                export_img.save(abs_path, format="WEBP", quality=WEBP_QUALITY, method=6)

                figures.append(
                    {
                        "url": "/".join([relative_prefix.strip("/"), file_name]),
                        "caption": "",
                        "page": page_idx + 1,
                        "index": fig_index,
                        "width": width,
                        "height": height,
                    }
                )
                fig_index += 1

    _save_figures_meta(os.path.join(output_dir, "meta.json"), figures, extractor="pymupdf-images")
    return figures


def ensure_paper_figures(
    *,
    pdf_url: str,
    docs_dir: str,
    source_key: str,
    asset_key: str,
    force: bool = False,
) -> List[Dict[str, Any]]:
    figures, _tables = ensure_paper_media(
        pdf_url=pdf_url,
        docs_dir=docs_dir,
        source_key=source_key,
        asset_key=asset_key,
        force=force,
    )
    return figures


def ensure_paper_media(
    *,
    pdf_url: str,
    docs_dir: str,
    source_key: str,
    asset_key: str,
    force: bool = False,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if not str(pdf_url or "").strip():
        return [], []

    figure_dir = _absolute_dir(docs_dir, source_key, asset_key)
    table_dir = _absolute_tables_dir(docs_dir, source_key, asset_key)
    figure_relative_prefix = _relative_prefix(source_key, asset_key)
    table_relative_prefix = _relative_tables_prefix(source_key, asset_key)
    figure_meta_path = os.path.join(figure_dir, "meta.json")
    table_meta_path = os.path.join(table_dir, "meta.json")
    if not force:
        cached_figures = _load_cached_figures(figure_meta_path)
        cached_tables = _load_cached_tables(table_meta_path)
        if cached_figures and cached_tables:
            return cached_figures, cached_tables
        if (cached_figures or os.path.exists(figure_meta_path)) and os.path.exists(table_meta_path):
            return cached_figures, cached_tables

    # 优先级 1: arXiv e-print 源码包(对 TikZ/PGFplots 矢量图论文唯一靠谱的来源)
    # 仅 arxiv 数据源启用 — 其它源(biorxiv / chemrxiv)没 e-print 接口
    if str(source_key or "").strip().lower() == "arxiv" and asset_key:
        eprint_figs = fetch_arxiv_source_figures(
            arxiv_id=asset_key,
            docs_dir=docs_dir,
            asset_key=asset_key,
        )
        if eprint_figs:
            # e-print 路径只产出 figures,不抓 tables;tables 留给 PDF 路径补
            # 但通常 arxiv 论文 table 也在 figures 目录下,所以保留 figures 即可
            return eprint_figs, []

    pdf_bytes = _download_pdf_bytes(pdf_url)
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp_pdf:
        tmp_pdf.write(pdf_bytes)
        tmp_pdf.flush()

        figures, tables = _extract_media_with_papercropper(
            tmp_pdf.name,
            figure_dir,
            figure_relative_prefix,
            table_dir,
            table_relative_prefix,
        )
        if figures or tables:
            return figures, tables

        return extract_figures_from_pdf(tmp_pdf.name, figure_dir, figure_relative_prefix), []
