/**
 * lib/agents/paper-compiler.mjs — session deliverables → 可投稿论文 (iter #61)
 *
 * 关闭 docs/agents-workflow.md §6 记录的第 1 号差距:
 *   "❌ Modifier 不写 LaTeX — 目前只写 markdown"
 *
 * 3 智能体循环(Designer → Feedback → Gate → Modifier)会往
 * archive/<sid>/{drafts,reviews,experiments,paper_additions,rebuttals}/ 里
 * 撒下一堆**碎片** markdown,外加 synthesis/。碎片本身不是科研产出的终点 ——
 * "科研全流程自动化"的最后一公里是把它们**装配成一篇论文**。本模块就是那台装配机。
 *
 * 单一真相源 for:
 *   - buildPaperDraft(input)       纯函数:meta + rounds + deliverables + syntheses → PaperDraft
 *   - formatPaperMarkdown(draft)   纯函数:PaperDraft → 1 份 markdown 论文
 *   - formatPaperLatex(draft)      纯函数:PaperDraft → 1 份可编译 LaTeX 论文
 *   - formatBibtex(entries)        纯函数:bib entries → .bib 文件
 *   - collectBibliography(rounds)  纯函数:proposal evidence → 去重引文表
 *
 * 双 surface 复用(与 export-bundle.mjs 同策略):
 *   - astro-src/scripts/agents-run.mjs --compile-paper   CLI 入口(从 archive/ 读)
 *   - 浏览器页面可直接 import 同一份实现
 *
 * 设计原则:
 *   - 纯函数,无 IO,无 DOM,无 Node/Browser API 依赖(调用方负责读写文件)
 *   - 输出字节级稳定:同一输入 → 同一输出(generatedAt 由调用方注入以便可复现)
 *   - LaTeX 输出是**可编译骨架**,不是"能直接投稿的成稿":正文来自 Modifier 的
 *     markdown,本模块负责结构 / 转义 / 引文,不负责润色学术语言
 *
 * 跑法:node --test tests/test_agents_paper_compiler.mjs
 */

// ---------------------------------------------------------------------------
// 章节规格:deliverable kind → 论文章节
// ---------------------------------------------------------------------------

/**
 * 论文骨架。顺序即成稿顺序。
 * `sources` 是该章节吸收的 deliverable kind(与 agents-run.mjs writeDeliverable 的
 * kind 标签一致:draft / review / experiment / paper_addition / rebuttal)。
 */
export const PAPER_SECTIONS = [
  {
    id: 'introduction',
    title: 'Introduction',
    titleZh: '引言',
    sources: [],
    blurb: '研究目标与动机,由 session goal + 最新 synthesis 导出。',
  },
  {
    id: 'related_work',
    title: 'Related Work',
    titleZh: '相关工作',
    sources: ['review', 'paper_addition'],
    blurb: 'literature_review 与 add_paper proposal 产出的综述片段。',
  },
  {
    id: 'method',
    title: 'Method',
    titleZh: '方法',
    sources: ['experiment'],
    blurb: 'experiment_plan proposal 产出的实验设计。',
  },
  {
    id: 'results',
    title: 'Results and Discussion',
    titleZh: '结果与讨论',
    sources: ['draft'],
    blurb: 'create_draft proposal 产出的正文草稿。',
  },
  {
    id: 'limitations',
    title: 'Limitations and Threats to Validity',
    titleZh: '局限性与效度威胁',
    sources: ['rebuttal'],
    blurb: 'rebuttal proposal 产出的自我质疑与答辩。',
  },
];

/** deliverable kind → 归档子目录(与 writeDeliverable 反向映射,供调用方读盘用) */
export const DELIVERABLE_DIRS = {
  draft: 'drafts',
  review: 'reviews',
  experiment: 'experiments',
  paper_addition: 'paper_additions',
  rebuttal: 'rebuttals',
};

// ---------------------------------------------------------------------------
// 小工具:frontmatter / 文本
// ---------------------------------------------------------------------------

/**
 * stripFrontmatter(md) — 剥掉 deliverable .md 顶部的 YAML frontmatter。
 * 只做本模块需要的浅解析(标量 + 简单数组),不引入 gray-matter 依赖 —— 保持零依赖纯函数。
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

/**
 * 去掉 deliverable body 里的顶层 `# 标题` 行 —— 论文里标题由章节结构提供,
 * 保留会造成"标题套标题"。
 */
function dropLeadingH1(body) {
  return body.replace(/^#\s+[^\n]*\n+/, '');
}

/** 提取 markdown 里某个 `## 名字` 小节的正文(用于从 synthesis 里抠摘要)。 */
export function extractMarkdownSection(md, headingPattern) {
  const src = typeof md === 'string' ? md : '';
  const lines = src.split(/\r?\n/);
  const out = [];
  let inside = false;
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      if (inside) break;              // 撞到下一个标题 → 结束
      if (headingPattern.test(h[2])) { inside = true; continue; }
      continue;
    }
    if (inside) out.push(line);
  }
  return out.join('\n').trim();
}

// ---------------------------------------------------------------------------
// 引文:proposal evidence → bibliography
// ---------------------------------------------------------------------------

/** 把任意 paperId 规约成 arXiv id(去掉路径 / 前缀),拿不准就原样返回。 */
function canonicalPaperId(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const m = s.match(/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  return m ? m[1] : s.replace(/^.*\//, '');
}

/** arXiv id → 合法 BibTeX cite key */
function bibKeyFor(id) {
  const cleaned = String(id).replace(/[^A-Za-z0-9]/g, '_');
  return `arxiv_${cleaned}`;
}

/**
 * collectBibliography(rounds) — 从所有 round 的 proposal.evidence.paperIds
 * 抽出去重引文表。按 id 字典序稳定排序(保证字节级可复现)。
 * @returns {Array<{ key: string, id: string, citedBy: string[], citations: number }>}
 */
export function collectBibliography(rounds) {
  /** @type {Map<string, { key: string, id: string, citedBy: Set<string> }>} */
  const seen = new Map();
  for (const r of rounds ?? []) {
    for (const p of r?.designer?.proposals ?? []) {
      for (const raw of p?.evidence?.paperIds ?? []) {
        const id = canonicalPaperId(raw);
        if (!id) continue;
        if (!seen.has(id)) seen.set(id, { key: bibKeyFor(id), id, citedBy: new Set() });
        if (p.id) seen.get(id).citedBy.add(String(p.id));
      }
    }
  }
  return [...seen.values()]
    .map((e) => ({
      key: e.key,
      id: e.id,
      citedBy: [...e.citedBy].sort(),
      citations: e.citedBy.size,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** formatBibtex(entries) — 引文表 → .bib 文件内容(arXiv misc 条目)。 */
export function formatBibtex(entries) {
  const list = entries ?? [];
  if (!list.length) return '% no references collected from proposal evidence\n';
  const out = [];
  for (const e of list) {
    out.push(`@misc{${e.key},`);
    out.push(`  title        = {arXiv:${e.id}},`);
    out.push(`  eprint       = {${e.id}},`);
    out.push('  archivePrefix = {arXiv},');
    out.push(`  note         = {cited by ${e.citations} proposal(s)},`);
    out.push('}');
    out.push('');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// buildPaperDraft:装配
// ---------------------------------------------------------------------------

/**
 * buildPaperDraft(input) — 把一个 session 的全部产出装配成结构化论文对象。
 *
 * input:
 *   meta         session meta.json
 *   rounds       RoundRecord[]（用于引文 + 统计）
 *   deliverables Array<{ kind, path?, raw, round?, idx? }>  kind ∈ DELIVERABLE_DIRS 的键
 *   syntheses    Array<{ idx, raw }>
 *   generatedAt  ISO 串（调用方注入以保证可复现；缺省用当前时间）
 *
 * @returns PaperDraft
 */
export function buildPaperDraft(input) {
  const {
    meta = null,
    rounds = [],
    deliverables = [],
    syntheses = [],
    generatedAt = new Date().toISOString(),
  } = input ?? {};

  const goal = meta?.goal ? String(meta.goal) : '';
  const sessionId = meta?.session_id ?? '(unknown)';

  // 解析每份 deliverable:剥 frontmatter、取标题、去掉重复 H1
  const parsed = (deliverables ?? []).map((d, i) => {
    const { frontmatter, body } = stripFrontmatter(d?.raw ?? '');
    const h1 = (d?.raw ?? '').match(/^#\s+(.+)$/m);
    return {
      kind: d?.kind ?? 'draft',
      path: d?.path ?? null,
      round: d?.round ?? (frontmatter.round != null ? Number(frontmatter.round) : null),
      idx: d?.idx ?? i,
      title: String(frontmatter.title ?? (h1 ? h1[1] : '') ?? '').trim() || '(untitled)',
      decision: frontmatter.decision ?? null,
      relatedPapers: Array.isArray(frontmatter.related_papers) ? frontmatter.related_papers : [],
      body: dropLeadingH1(body).trim(),
    };
  });

  // 稳定排序:先 round,再 idx —— 保证同输入同输出
  const byOrder = (a, b) => (a.round ?? 0) - (b.round ?? 0) || (a.idx ?? 0) - (b.idx ?? 0);

  const latestSynthesis = (syntheses ?? [])
    .slice()
    .sort((a, b) => (a?.idx ?? 0) - (b?.idx ?? 0))
    .pop() ?? null;

  // 摘要:优先从最新 synthesis 抠"摘要 / Abstract / TL;DR"小节,退化到 goal
  const synthesisAbstract = latestSynthesis
    ? extractMarkdownSection(latestSynthesis.raw ?? '', /摘要|abstract|tl;?dr|概述/i)
    : '';
  const abstract = synthesisAbstract
    || (goal ? `本文围绕以下研究目标展开:${goal}` : '(no abstract available: session has neither a goal nor a synthesis)');

  // 引言:goal + synthesis 的关键发现
  const synthesisFindings = latestSynthesis
    ? extractMarkdownSection(latestSynthesis.raw ?? '', /关键发现|key findings?|发现/i)
    : '';

  const sections = PAPER_SECTIONS.map((spec) => {
    if (spec.id === 'introduction') {
      const paras = [];
      if (goal) paras.push(`本研究的目标是:${goal}`);
      if (synthesisFindings) paras.push(synthesisFindings);
      if (!paras.length) paras.push('_(引言待补:该 session 尚无 goal 或 synthesis)_');
      return { ...spec, entries: [], body: paras.join('\n\n'), empty: !goal && !synthesisFindings };
    }
    const entries = parsed.filter((p) => spec.sources.includes(p.kind)).sort(byOrder);
    return { ...spec, entries, body: '', empty: entries.length === 0 };
  });

  const bibliography = collectBibliography(rounds);

  let proposals = 0;
  let applied = 0;
  for (const r of rounds ?? []) {
    proposals += r?.designer?.proposals?.length ?? 0;
    applied += r?.modifier?.applied?.length ?? 0;
  }

  return {
    sessionId,
    generatedAt,
    title: goal ? truncateTitle(goal) : `Research Session ${sessionId}`,
    goal,
    abstract,
    meta,
    sections,
    bibliography,
    stats: {
      rounds: (rounds ?? []).length,
      proposals,
      applied,
      deliverables: parsed.length,
      syntheses: (syntheses ?? []).length,
      references: bibliography.length,
      sectionsWithContent: sections.filter((s) => !s.empty).length,
    },
  };
}

/** goal 往往是一整句话;论文标题裁到合理长度(按词/字截断,不截断到一半的词)。 */
function truncateTitle(goal, max = 80) {
  const s = String(goal).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

// ---------------------------------------------------------------------------
// Markdown 输出
// ---------------------------------------------------------------------------

/** formatPaperMarkdown(draft) — PaperDraft → 1 份 markdown 论文。 */
export function formatPaperMarkdown(draft) {
  if (!draft) return '# Paper\n\n(draft is empty)\n';
  const lines = [];
  const stats = draft.stats ?? {};

  lines.push(`# ${draft.title ?? 'Untitled'}`);
  lines.push('');
  lines.push(`> Session \`${draft.sessionId ?? '?'}\` · generated ${draft.generatedAt ?? '?'}`);
  lines.push(`> ${stats.rounds ?? 0} rounds · ${stats.proposals ?? 0} proposals · ${stats.deliverables ?? 0} deliverables · ${stats.references ?? 0} references`);
  lines.push('');
  lines.push('## Abstract');
  lines.push('');
  lines.push(draft.abstract ?? '');
  lines.push('');

  for (const section of draft.sections ?? []) {
    lines.push(`## ${section.title}`);
    lines.push('');
    if (section.body) {
      lines.push(section.body);
      lines.push('');
      continue;
    }
    if (!section.entries?.length) {
      lines.push(`_(本节暂无内容 —— ${section.blurb})_`);
      lines.push('');
      continue;
    }
    for (const e of section.entries) {
      lines.push(`### ${e.title}`);
      lines.push('');
      const prov = [];
      if (e.round != null) prov.push(`round ${e.round}`);
      if (e.decision) prov.push(String(e.decision));
      if (prov.length) {
        lines.push(`_${prov.join(' · ')}_`);
        lines.push('');
      }
      if (e.body) {
        lines.push(e.body);
        lines.push('');
      }
    }
  }

  const bib = draft.bibliography ?? [];
  lines.push('## References');
  lines.push('');
  if (!bib.length) {
    lines.push('_(no references collected from proposal evidence)_');
  } else {
    bib.forEach((e, i) => {
      lines.push(`${i + 1}. arXiv:${e.id} — cited by ${e.citations} proposal(s)`);
    });
  }
  lines.push('');
  lines.push('---');
  lines.push('*Compiled by DPR agents paper-compiler (iter #61)*');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// LaTeX 输出
// ---------------------------------------------------------------------------

/**
 * escapeLatex(s) — 转义 LaTeX 特殊字符。
 *
 * 关键点:`\` → `\textbackslash{}` 这类替换**自身带花括号**,如果直接顺序替换,
 * 后一步的 `{}` 转义会把刚生成的命令花括号再转义一遍(`\textbackslash\{\}`),
 * 产出无法编译的 LaTeX。所以先把三个"需要展开成命令"的字符换成哨兵,
 * 转义完剩余字符后再把哨兵还原成命令。
 */
export function escapeLatex(s) {
  // 哨兵只含字母 + NUL：一旦含 `_` `{` 等 LaTeX 特殊字符，下面的转义步骤会把
  // 哨兵自身也改写掉，还原时便对不上（这正是本函数最初的一个 bug）。
  const BS = '\u0000LATEXBS\u0000';
  const TILDE = '\u0000LATEXTILDE\u0000';
  const CARET = '\u0000LATEXCARET\u0000';
  return String(s ?? '')
    .split('\\').join(BS)
    .split('~').join(TILDE)
    .split('^').join(CARET)
    .replace(/([&%$#_{}])/g, '\\$1')
    .split(BS).join('\\textbackslash{}')
    .split(TILDE).join('\\textasciitilde{}')
    .split(CARET).join('\\textasciicircum{}');
}

/**
 * inlineToLatex(text) — 行内 markdown → LaTeX。
 * 先分词再转义:被 markdown 标记包裹的片段单独处理,其余部分整体转义,
 * 避免"先转义导致标记字符被吃掉"的经典 bug。
 */
function inlineToLatex(text) {
  const src = String(text ?? '');
  const parts = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) parts.push(escapeLatex(src.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith('**')) parts.push(`\\textbf{${escapeLatex(tok.slice(2, -2))}}`);
    else if (tok.startsWith('`')) parts.push(`\\texttt{${escapeLatex(tok.slice(1, -1))}}`);
    else parts.push(`\\textit{${escapeLatex(tok.slice(1, -1))}}`);
    last = m.index + tok.length;
  }
  if (last < src.length) parts.push(escapeLatex(src.slice(last)));
  return parts.join('');
}

/**
 * latexItemBody(text) — 列表项正文 → `\item` 后面跟的内容。
 *
 * 坑:LaTeX 把 `\item[foo]` 里的方括号当成"自定义标签",会吞掉方括号内容并
 * 顶替掉项目符号。而 markdown 列表项以 `[` 开头非常常见(`- [round 1] ...`、
 * `- [TODO] ...`),直接拼就会静默丢内容。正文以 `[` 开头时插一个空组 `{}` 挡住。
 */
function latexItemBody(text) {
  const body = inlineToLatex(text);
  return body.startsWith('[') ? `{}${body}` : body;
}

/**
 * mdBlockToLatex(md, opts) — 块级 markdown → LaTeX。
 * 支持:标题(降级到 subsection 之下)、无序/有序列表、引用块、段落。
 * 刻意不支持表格 / 图片 —— 那些需要人工排版,留原文更诚实。
 */
function mdBlockToLatex(md, { baseLevel = 2 } = {}) {
  const lines = String(md ?? '').split(/\r?\n/);
  const out = [];
  let listMode = null; // 'itemize' | 'enumerate' | null
  let inQuote = false;

  const closeList = () => {
    if (listMode) { out.push(`\\end{${listMode}}`); listMode = null; }
  };
  const closeQuote = () => {
    if (inQuote) { out.push('\\end{quote}'); inQuote = false; }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) { closeList(); closeQuote(); out.push(''); continue; }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList(); closeQuote();
      const depth = Math.min(baseLevel + heading[1].length - 1, 4);
      const cmd = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'][depth] ?? 'subparagraph';
      out.push(`\\${cmd}{${inlineToLatex(heading[2])}}`);
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      closeQuote();
      if (listMode !== 'itemize') { closeList(); out.push('\\begin{itemize}'); listMode = 'itemize'; }
      out.push(`  \\item ${latexItemBody(bullet[1])}`);
      continue;
    }

    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      closeQuote();
      if (listMode !== 'enumerate') { closeList(); out.push('\\begin{enumerate}'); listMode = 'enumerate'; }
      out.push(`  \\item ${latexItemBody(numbered[1])}`);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
      if (!inQuote) { out.push('\\begin{quote}'); inQuote = true; }
      out.push(inlineToLatex(quote[1]));
      continue;
    }

    closeList(); closeQuote();
    out.push(inlineToLatex(trimmed));
  }
  closeList();
  closeQuote();

  // 压掉连续空行,保持输出紧凑且字节稳定
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * formatPaperLatex(draft, opts) — PaperDraft → 可编译 LaTeX。
 * opts.documentclass 默认 'article';opts.bibResource 给 \addbibresource / thebibliography 用。
 */
export function formatPaperLatex(draft, opts = {}) {
  if (!draft) return '% empty draft\n';
  const documentclass = opts.documentclass ?? 'article';
  const stats = draft.stats ?? {};
  const bib = draft.bibliography ?? [];
  const out = [];

  out.push(`% Compiled by DPR agents paper-compiler (iter #61)`);
  out.push(`% Session: ${draft.sessionId ?? '?'}  Generated: ${draft.generatedAt ?? '?'}`);
  out.push(`% Source: ${stats.rounds ?? 0} rounds / ${stats.deliverables ?? 0} deliverables`);
  out.push(`\\documentclass[11pt]{${documentclass}}`);
  out.push('\\usepackage[utf8]{inputenc}');
  out.push('\\usepackage[T1]{fontenc}');
  out.push('\\usepackage{hyperref}');
  out.push('\\usepackage{graphicx}');
  out.push('\\usepackage{amsmath,amssymb}');
  out.push('% 中文支持:如正文含中文,用 xelatex 编译并取消下一行注释');
  out.push('% \\usepackage{ctex}');
  out.push('');
  out.push(`\\title{${escapeLatex(draft.title ?? 'Untitled')}}`);
  out.push('\\author{DPR Multi-Agent Research Loop}');
  out.push('\\date{\\today}');
  out.push('');
  out.push('\\begin{document}');
  out.push('\\maketitle');
  out.push('');
  out.push('\\begin{abstract}');
  out.push(mdBlockToLatex(draft.abstract ?? '', { baseLevel: 2 }));
  out.push('\\end{abstract}');
  out.push('');

  for (const section of draft.sections ?? []) {
    out.push(`\\section{${escapeLatex(section.title)}}`);
    if (section.body) {
      out.push(mdBlockToLatex(section.body, { baseLevel: 1 }));
      out.push('');
      continue;
    }
    if (!section.entries?.length) {
      out.push(`\\textit{${escapeLatex(`(本节暂无内容 —— ${section.blurb})`)}}`);
      out.push('');
      continue;
    }
    for (const e of section.entries) {
      out.push(`\\subsection{${escapeLatex(e.title)}}`);
      const prov = [];
      if (e.round != null) prov.push(`round ${e.round}`);
      if (e.decision) prov.push(String(e.decision));
      if (prov.length) out.push(`\\textit{${escapeLatex(prov.join(' \u00b7 '))}}\\\\`);
      if (e.body) out.push(mdBlockToLatex(e.body, { baseLevel: 2 }));
      out.push('');
    }
  }

  // 用 thebibliography 而非 biblatex —— 无需额外 pass,pdflatex 一次过
  out.push('\\begin{thebibliography}{99}');
  if (!bib.length) {
    out.push('% no references collected from proposal evidence');
  } else {
    for (const e of bib) {
      out.push(`\\bibitem{${e.key}} arXiv preprint \\texttt{${escapeLatex(e.id)}}. \\url{https://arxiv.org/abs/${escapeLatex(e.id)}}.`);
    }
  }
  out.push('\\end{thebibliography}');
  out.push('');
  out.push('\\end{document}');
  return out.join('\n');
}
