/**
 * lib/agents/synthesis-pdf.mjs — synthesis → 打印就绪 HTML (iter #63)
 *
 * 关闭 docs/agents-workflow.md §6 line 186 候选:
 *   "把 synthesis 输出为 PDF (pandoc / wkhtmltopdf)"
 *
 * 设计选择:不依赖 pandoc / wkhtmltopdf 等系统工具,而是生成**自包含的
 * 打印就绪 HTML** —— 用户用任何浏览器打开后,Cmd/Ctrl+P → "Save as PDF"
 * 即可。理由:
 *   1. 零系统依赖,纯 JS,Node CLI + 浏览器 ESM 都能用
 *   2. 浏览器渲染对中文 / emoji / 数学公式的支持比 pandoc / wkhtmltopdf 都好
 *   3. @media print CSS + @page 规则让浏览器"Save as PDF"自带页眉页脚
 *
 * 单一真相源 for:
 *   - buildPdfBundle(input)         纯函数:meta + synthesis → PDFBundle
 *   - formatPdfHtml(bundle, opts)   纯函数:PDFBundle → 1 份自包含 HTML
 *   - buildPdfFileName(sessionId)   纯函数:导出文件名生成
 *
 * 双 surface 复用(同 export-bundle / paper-compiler):
 *   - astro-src/scripts/agents-run.mjs --export-pdf  CLI 入口(从 archive/ 读)
 *   - 浏览器侧可 import 同一份实现
 *
 * 设计原则:
 *   - 纯函数,无 IO,无 DOM(单测友好)
 *   - 输出字节级稳定(同输入 → 同输出,frontmatter 解析路径)
 *   - HTML 内嵌全部 CSS + 字体 fallback,无外部资源
 *   - 移动到任何环境都能打开
 *
 * 跑法:node --test tests/test_agents_synthesis_pdf.mjs
 */

// ---------------------------------------------------------------------------
// Frontmatter 解析(同 paper-compiler 的 stripFrontmatter,避免依赖 gray-matter)
// ---------------------------------------------------------------------------

/**
 * 浅解析 YAML frontmatter(只做本模块需要的标量 + 数组 + 布尔),
 * 与 paper-compiler.mjs 的 stripFrontmatter 行为保持一致。
 * @param {string} md
 * @returns {{ frontmatter: Record<string, unknown>, body: string }}
 */
export function stripFrontmatter(md) {
  const src = typeof md === 'string' ? md : '';
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, body: src.trim() };
  const frontmatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let raw = kv[2].trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      const inner = raw.slice(1, -1).trim();
      frontmatter[key] = inner
        ? inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
        : [];
      continue;
    }
    raw = raw.replace(/^["']|["']$/g, '');
    if (raw === 'true') frontmatter[key] = true;
    else if (raw === 'false') frontmatter[key] = false;
    else frontmatter[key] = raw;
  }
  return { frontmatter, body: src.slice(m[0].length).trim() };
}

// ---------------------------------------------------------------------------
// Markdown → HTML(子集,够 synthesis 用)
// ---------------------------------------------------------------------------

/**
 * inlineMdToHtml(text) — 行内 markdown → HTML(粗体 / 行内代码 / 斜体 / 链接)。
 * 与 paper-compiler.mjs 里的 inlineToLatex 不同:这里是生成 HTML 不是 LaTeX。
 */
function inlineMdToHtml(text) {
  const src = String(text ?? '');
  // 先按反引号切,code 片段整体保留(不再二次转义)
  const parts = [];
  const re = /(`[^`\n]+`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) parts.push({ text: src.slice(last, m.index), code: false });
    parts.push({ text: m[0].slice(1, -1), code: true });
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push({ text: src.slice(last), code: false });

  return parts.map((p) => {
    if (p.code) return `<code>${escapeHtml(p.text)}</code>`;
    // 链接 [text](url) —— 先把 url 抽出来,单独 escapeAttr(只转义 HTML 属性字符),
    // 不参与 escapeHtml 的常规转义,避免双转义引号
    let s = p.text;
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${escapeAttr(u)}">${escapeHtml(t)}</a>`);
    s = escapeHtmlPreservingTags(s);
    // 粗体 **foo**
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // 斜体 *foo*
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return s;
  }).join('');
}

/** escapeHtml(s) — 基础 HTML 转义 */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** escapeAttr(s) — HTML 属性值转义(更严格,不允许引号) */
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * escapeHtmlPreservingTags(s) — 把字符串里**已存在的 HTML 标签**原样保留,
 * 只转义标签之间的纯文本。用途:链接替换之后,我们的 `<a>` 标签不应被再次转义。
 * 实现:split on `<tag>` 边界,纯文本走 escapeHtml,标签本身原样返回。
 */
function escapeHtmlPreservingTags(s) {
  const src = String(s ?? '');
  // 按 HTML 标签边界切:标签之间是纯文本(走 escapeHtml),标签本身原样
  const parts = src.split(/(<[^>]+>)/g);
  return parts.map((p) => p.startsWith('<') ? p : escapeHtml(p)).join('');
}

/**
 * mdToHtml(md) — 块级 + 行内 markdown → HTML(子集)。
 * 支持:# / ## / ### 标题,无序/有序列表,引用块,段落,`---` 分隔线。
 * 与 paper-compiler.mjs 的 mdBlockToLatex 对称。
 */
function mdToHtml(md) {
  const lines = String(md ?? '').split(/\r?\n/);
  const out = [];
  let listMode = null; // 'ul' | 'ol' | null
  let inQuote = false;
  let paraBuf = [];

  const closeList = () => {
    if (listMode) { out.push(`</${listMode}>`); listMode = null; }
  };
  const closeQuote = () => {
    if (inQuote) { out.push('</blockquote>'); inQuote = false; }
  };
  const flushPara = () => {
    if (paraBuf.length) {
      out.push(`<p>${inlineMdToHtml(paraBuf.join(' '))}</p>`);
      paraBuf = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (!line.trim()) {
      closeList(); closeQuote(); flushPara();
      continue;
    }

    if (/^---\s*$/.test(line)) {
      closeList(); closeQuote(); flushPara();
      out.push('<hr />');
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList(); closeQuote(); flushPara();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inlineMdToHtml(h[2])}</h${lvl}>`);
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      closeQuote(); flushPara();
      if (listMode !== 'ul') { closeList(); out.push('<ul>'); listMode = 'ul'; }
      out.push(`  <li>${inlineMdToHtml(bullet[1])}</li>`);
      continue;
    }

    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      closeQuote(); flushPara();
      if (listMode !== 'ol') { closeList(); out.push('<ol>'); listMode = 'ol'; }
      out.push(`  <li>${inlineMdToHtml(numbered[1])}</li>`);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeList(); flushPara();
      if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
      out.push(`  <p>${inlineMdToHtml(quote[1])}</p>`);
      continue;
    }

    closeList(); closeQuote();
    paraBuf.push(line);
  }
  closeList();
  closeQuote();
  flushPara();

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// PDFBundle:assembler
// ---------------------------------------------------------------------------

/**
 * buildPdfBundle(input) — 把一个 session 的 meta + 所有 synthesis 装配成 PDFBundle。
 *
 * @param {object} input
 * @param {Record<string, unknown>|null} input.meta
 * @param {Array<{idx:number, raw:string}>} input.syntheses
 * @param {string} [input.generatedAt]
 * @returns {{
 *   sessionId: string,
 *   title: string,
 *   goal: string,
 *   generatedAt: string,
 *   meta: Record<string, unknown>|null,
 *   syntheses: Array<{idx:number, title:string, generatedAt:string, model:string|null, roundsSynthesized:number|null, deliverablesReferenced:number|null, uniquePapers:number|null, html:string, body:string}>,
 *   stats: {syntheses: number, totalHtmlBytes: number}
 * }}
 */
export function buildPdfBundle(input) {
  const {
    meta = null,
    syntheses = [],
    generatedAt = new Date().toISOString(),
  } = input ?? {};

  const sessionId = meta?.session_id ?? '(unknown)';
  const goal = meta?.goal ? String(meta.goal) : '';

  const list = (syntheses ?? [])
    .slice()
    .sort((a, b) => (a?.idx ?? 0) - (b?.idx ?? 0))
    .map((s) => {
      const { frontmatter, body } = stripFrontmatter(s?.raw ?? '');
      const html = mdToHtml(body);
      return {
        idx: s?.idx ?? 0,
        title: String(frontmatter.title ?? `Synthesis #${s?.idx ?? '?'}`),
        generatedAt: String(frontmatter.generated_at ?? generatedAt),
        model: frontmatter.model != null ? String(frontmatter.model) : null,
        roundsSynthesized: frontmatter.rounds_synthesized != null ? Number(frontmatter.rounds_synthesized) : null,
        deliverablesReferenced: frontmatter.deliverables_referenced != null ? Number(frontmatter.deliverables_referenced) : null,
        uniquePapers: frontmatter.unique_papers != null ? Number(frontmatter.unique_papers) : null,
        body,
        html,
      };
    });

  const totalHtmlBytes = list.reduce((s, x) => s + x.html.length, 0);

  return {
    sessionId,
    title: goal || `Research Session ${sessionId}`,
    goal,
    generatedAt,
    meta,
    syntheses: list,
    stats: {
      syntheses: list.length,
      totalHtmlBytes,
    },
  };
}

/** buildPdfFileName(sessionId, idx?) — 给 CLI / 浏览器用 */
export function buildPdfFileName(sessionId, idx) {
  const safe = String(sessionId ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  return idx != null ? `${safe}-synthesis-${String(idx).padStart(3, '0')}.html`
                     : `${safe}-synthesis.html`;
}

// ---------------------------------------------------------------------------
// formatPdfHtml:输出打印就绪 HTML
// ---------------------------------------------------------------------------

/**
 * formatPdfHtml(bundle, opts) — PDFBundle → 1 份自包含、打印就绪的 HTML。
 *
 * 设计:
 *   - 内嵌 CSS(含 @page + @media print),用户在浏览器里 Cmd/Ctrl+P → "Save as PDF"
 *   - 内嵌 Google Fonts 引用 + 兜底系统字体栈,中英文都能渲染
 *   - 每份 synthesis 是 1 个 <article>,用 <section class="page-break"> 分隔
 *   - 顶部 cover + 目录 + footer(meta)
 *
 * @param {object} bundle
 * @param {object} [opts]
 * @param {string} [opts.cssVariant='academic']  'academic' | 'compact' | 'presentation'
 * @returns {string} 完整的 HTML 文档字符串
 */
export function formatPdfHtml(bundle, opts = {}) {
  const variant = opts.cssVariant ?? 'academic';
  if (!bundle) return '<!doctype html><html><body><p>empty bundle</p></body></html>';

  const stats = bundle.stats ?? {};
  const css = variant === 'compact' ? CSS_COMPACT
            : variant === 'presentation' ? CSS_PRESENTATION
            : CSS_ACADEMIC;

  const synthesesHtml = (bundle.syntheses ?? []).map((s) => `
    <article class="synthesis" id="synthesis-${s.idx}">
      <header class="synthesis-header">
        <h2 class="synthesis-title">${escapeHtml(s.title)}</h2>
        <div class="synthesis-meta">
          ${s.generatedAt ? `<span class="synth-meta-item">📅 ${escapeHtml(s.generatedAt)}</span>` : ''}
          ${s.model ? `<span class="synth-meta-item">🤖 model: ${escapeHtml(s.model)}</span>` : ''}
          ${s.roundsSynthesized != null ? `<span class="synth-meta-item">🔄 ${s.roundsSynthesized} round${s.roundsSynthesized === 1 ? '' : 's'}</span>` : ''}
          ${s.deliverablesReferenced != null ? `<span class="synth-meta-item">📝 ${s.deliverablesReferenced} deliverable${s.deliverablesReferenced === 1 ? '' : 's'}</span>` : ''}
          ${s.uniquePapers != null ? `<span class="synth-meta-item">📚 ${s.uniquePapers} paper${s.uniquePapers === 1 ? '' : 's'}</span>` : ''}
        </div>
      </header>
      <div class="synthesis-body">
        ${s.html}
      </div>
    </article>
  `).join('\n<hr class="page-break" />\n');

  const tocItems = (bundle.syntheses ?? []).map((s) =>
    `<li><a href="#synthesis-${s.idx}">Synthesis #${s.idx} — ${escapeHtml(s.title)}</a></li>`
  ).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(bundle.title)} — Synthesis Export</title>
<meta name="generator" content="DPR agents synthesis-pdf (iter #63)" />
<style>${css}</style>
</head>
<body>
<header class="cover">
  <div class="cover-inner">
    <div class="cover-stamp">DPR Multi-Agent Research Loop</div>
    <h1 class="cover-title">${escapeHtml(bundle.title)}</h1>
    ${bundle.goal ? `<p class="cover-goal">${escapeHtml(bundle.goal)}</p>` : ''}
    <dl class="cover-stats">
      <dt>Session</dt><dd><code>${escapeHtml(bundle.sessionId)}</code></dd>
      <dt>Generated</dt><dd>${escapeHtml(bundle.generatedAt)}</dd>
      <dt>Syntheses</dt><dd>${stats.syntheses ?? 0}</dd>
    </dl>
    <p class="cover-hint">
      📌 打开后按 <kbd>Cmd/Ctrl</kbd>+<kbd>P</kbd> → 选择 "Save as PDF" 即可导出 PDF。
      建议边距:默认 / 缩放:100% / 启用"背景图形"。
    </p>
  </div>
</header>

${tocItems ? `<nav class="toc">
  <h2>目录 / Table of Contents</h2>
  <ol>${tocItems}</ol>
</nav>
<hr class="page-break" />` : ''}

<main class="syntheses">
${synthesesHtml || '<p class="empty">(no syntheses in this session)</p>'}
</main>

<footer class="colophon">
  <hr />
  <p>Generated by <code>astro-src/lib/agents/synthesis-pdf.mjs</code> (iter #63).</p>
  <p>Source: <code>archive/${escapeHtml(bundle.sessionId)}/synthesis/synthesis_*.md</code></p>
</footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// CSS variants(全部内嵌,无外部依赖)
// ---------------------------------------------------------------------------

const CSS_BASE = `
  :root {
    --fg: #1a1a1a;
    --fg-muted: #555;
    --fg-faint: #888;
    --bg: #ffffff;
    --accent: #0b5cad;
    --accent-soft: #e8f1fb;
    --border: #d8d8d8;
    --code-bg: #f4f4f4;
    --blockquote-fg: #555;
    --quote-bar: #c8d4e2;
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
    --font-mono: "SF Mono", "JetBrains Mono", Menlo, Consolas, "Courier New", monospace;
  }
  @page {
    size: A4;
    margin: 22mm 18mm 22mm 18mm;
    @top-left { content: ""; }
    @top-right { content: ""; }
    @bottom-left { content: "DPR agents synthesis-pdf"; font-size: 9pt; color: #888; }
    @bottom-right { content: counter(page) " / " counter(pages); font-size: 9pt; color: #888; }
  }
  html { font-size: 11pt; }
  body {
    color: var(--fg);
    background: var(--bg);
    font-family: var(--font-sans);
    line-height: 1.65;
    max-width: 100%;
    margin: 0;
    padding: 0;
  }
  code, pre, kbd {
    font-family: var(--font-mono);
    font-size: 0.92em;
  }
  code {
    background: var(--code-bg);
    padding: 1px 5px;
    border-radius: 3px;
  }
  pre {
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 12px 14px;
    overflow-x: auto;
    line-height: 1.45;
  }
  pre code { background: none; padding: 0; }
  a { color: var(--accent); text-decoration: none; border-bottom: 1px solid transparent; }
  a:hover { border-bottom-color: var(--accent); }
  blockquote {
    margin: 1em 0;
    padding: 0.6em 1em;
    border-left: 4px solid var(--quote-bar);
    color: var(--blockquote-fg);
    background: var(--accent-soft);
    border-radius: 0 4px 4px 0;
  }
  blockquote p { margin: 0.4em 0; }
  hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
  ul, ol { padding-left: 1.5em; }
  li { margin: 0.3em 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
  th { background: var(--accent-soft); }
  img { max-width: 100%; height: auto; }
  kbd {
    background: #fafafa;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 0.85em;
  }
  @media print {
    body { font-size: 10.5pt; }
    a { color: var(--fg); }
    a[href^="http"]::after {
      content: " (" attr(href) ")";
      font-size: 0.85em;
      color: var(--fg-faint);
      word-break: break-all;
    }
    .no-print { display: none !important; }
    .page-break {
      break-before: page;
      page-break-before: always;
      border: none;
      margin: 0;
      height: 0;
    }
    .cover, .toc, footer.colophon { break-inside: avoid; }
    .synthesis { break-inside: avoid-page; }
  }
  @media screen {
    body { max-width: 820px; margin: 0 auto; padding: 2.5rem 1.5rem; }
    .cover, .toc { border: 1px solid var(--border); border-radius: 8px; padding: 1.5rem 2rem; }
  }
`;

const CSS_ACADEMIC = CSS_BASE + `
  .cover { margin: 0 0 2.5rem 0; }
  .cover-stamp {
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.7rem;
    color: var(--fg-muted);
    margin-bottom: 0.8rem;
  }
  .cover-title { font-size: 1.85rem; margin: 0 0 0.6rem 0; line-height: 1.3; color: var(--accent); }
  .cover-goal { color: var(--fg-muted); margin: 0 0 1.2rem 0; }
  .cover-stats { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 1rem; font-size: 0.92rem; margin: 1.2rem 0; }
  .cover-stats dt { color: var(--fg-muted); }
  .cover-stats dd { margin: 0; }
  .cover-hint { color: var(--fg-muted); font-size: 0.88rem; background: var(--accent-soft); padding: 0.6rem 0.9rem; border-radius: 4px; }
  .toc h2 { font-size: 1.1rem; margin-top: 0; }
  .toc ol { padding-left: 1.5em; }
  .synthesis { margin: 0 0 2rem 0; }
  .synthesis-header { border-bottom: 1px solid var(--border); padding-bottom: 0.6rem; margin-bottom: 1.2rem; }
  .synthesis-title { font-size: 1.4rem; margin: 0 0 0.4rem 0; color: var(--accent); }
  .synthesis-meta { display: flex; flex-wrap: wrap; gap: 0.8rem; font-size: 0.82rem; color: var(--fg-muted); }
  .synth-meta-item { white-space: nowrap; }
  .synthesis-body h1, .synthesis-body h2, .synthesis-body h3 { color: var(--fg); }
  .synthesis-body h1 { font-size: 1.4rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
  .synthesis-body h2 { font-size: 1.15rem; margin-top: 1.6em; }
  .synthesis-body h3 { font-size: 1.02rem; margin-top: 1.3em; }
  footer.colophon { color: var(--fg-faint); font-size: 0.82rem; margin-top: 3rem; }
  footer.colophon p { margin: 0.3rem 0; }
`;

const CSS_COMPACT = CSS_BASE + `
  .cover { margin: 0 0 1.5rem 0; }
  .cover-title { font-size: 1.4rem; margin: 0 0 0.4rem 0; color: var(--accent); }
  .cover-goal { color: var(--fg-muted); margin: 0 0 0.8rem 0; font-size: 0.95rem; }
  .cover-stats { font-size: 0.85rem; display: flex; gap: 1rem; flex-wrap: wrap; }
  .cover-stats dt, .cover-stats dd { display: inline; margin: 0; }
  .cover-stats dt { color: var(--fg-muted); }
  .cover-stats dt::after { content: ": "; }
  .cover-stats dd { margin-right: 0.6rem; }
  .toc { font-size: 0.9rem; margin: 0 0 1.5rem 0; }
  .toc h2 { font-size: 0.95rem; margin-top: 0; }
  .synthesis { margin: 0 0 1.2rem 0; }
  .synthesis-title { font-size: 1.1rem; color: var(--accent); margin: 0 0 0.3rem 0; }
  .synthesis-meta { font-size: 0.78rem; color: var(--fg-muted); margin-bottom: 0.6rem; }
  .synthesis-body h1, .synthesis-body h2, .synthesis-body h3 { color: var(--fg); }
  .synthesis-body h1 { font-size: 1.15rem; }
  .synthesis-body h2 { font-size: 1.02rem; }
  footer.colophon { font-size: 0.75rem; color: var(--fg-faint); margin-top: 1.5rem; }
`;

const CSS_PRESENTATION = CSS_BASE + `
  body { font-size: 13pt; }
  .cover { text-align: center; padding: 4rem 2rem !important; }
  .cover-stamp { font-size: 0.85rem; }
  .cover-title { font-size: 2.4rem; line-height: 1.25; margin: 1rem 0; color: var(--accent); }
  .cover-goal { font-size: 1.1rem; }
  .cover-stats { justify-content: center; display: flex; gap: 1.5rem; font-size: 1rem; }
  .cover-stats dt, .cover-stats dd { display: inline; margin: 0; }
  .cover-stats dt::after { content: ": "; }
  .toc { padding: 1.5rem 2rem !important; }
  .synthesis { margin: 0 0 2.5rem 0; }
  .synthesis-title { font-size: 1.7rem; color: var(--accent); }
  .synthesis-body { font-size: 1.05rem; line-height: 1.75; }
  .synthesis-body h1 { font-size: 1.6rem; }
  .synthesis-body h2 { font-size: 1.35rem; }
  @media print {
    body { font-size: 12pt; }
    .synthesis-title { font-size: 1.5rem; }
  }
`;
