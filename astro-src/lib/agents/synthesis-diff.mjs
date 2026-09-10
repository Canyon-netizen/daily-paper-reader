/**
 * lib/agents/synthesis-diff.mjs — synthesis diff (iter #66)
 *
 * 关闭 docs/agents-workflow.md §6 候选 "synthesis diff (--diff-syntheses)":
 *   比较同一个 session 的两份 synthesis_*.md,输出 proposals 增量 / references 增量 /
 *   关键句变更 / 主题分歧 / 字数变化。
 *
 * 设计原则(同 iter #57 export-bundle / iter #61 paper-compiler):
 *   - 纯函数,无 IO,无 DOM(单测友好)
 *   - 输出字节级稳定(同输入 → 同输出)
 *   - 双 surface 共享(同 paper-compiler / synthesis-pdf):
 *     agents-run.mjs --diff-syntheses (CLI) ──┐
 *     /agents/<sid>/diff/ (browser)         ──┴── both import from
 *                                              lib/agents/synthesis-diff.mjs
 *   - 不依赖 gray-matter / markdown-it:浅解析 YAML frontmatter + 简单行扫
 *     抽主题 / refs / 字数,与 paper-compiler.mjs / synthesis-pdf.mjs 一致
 *
 * 单一真相源 for:
 *   - stripFrontmatter(md)        复用合成解析(synthesis-pdf 同款浅解析)
 *   - extractSynthesisTopics(md)  从 body 抽 H1/H2/H3 标题作为"主题"
 *   - extractSynthesisRefIds(md)  从 body 抽 arXiv id 列表(regex)
 *   - countWords(text)            字数(中英文混合,按字符 + 词混合估算)
 *   - diffSyntheses(synA, synB, opts)  核心纯函数:输出 diff 结构
 *   - formatSynthesisDiffText(diff)    文本渲染(CLI stdout)
 *
 * 跑法:node --test tests/test_agents_synthesis_diff.mjs
 */

// ---------------------------------------------------------------------------
// Frontmatter 解析 — 复用 synthesis-pdf 的浅 YAML 解析
// ---------------------------------------------------------------------------

/**
 * stripFrontmatter(md) — 浅剥离 + 标量 / 数组 / 布尔解析。
 * 与 synthesis-pdf.mjs / paper-compiler.mjs 的 stripFrontmatter 行为保持一致,
 * 这里再写一份是为了让 synthesis-diff 模块自包含(不强制 import 别的 lib)。
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
    else if (/^-?\d+(\.\d+)?$/.test(raw)) frontmatter[key] = Number(raw);
    else frontmatter[key] = raw;
  }
  return { frontmatter, body: src.slice(m[0].length).trim() };
}

// ---------------------------------------------------------------------------
// Body 特征抽取
// ---------------------------------------------------------------------------

/**
 * extractSynthesisTopics(body) — 从 body 抽 H1/H2/H3 标题作为"主题列表"。
 * 例子:
 *   "# Foo\n\n## Bar\n"  →  ["Foo", "Bar"]
 *   "## A\n### B\n# D"   →  ["A", "B", "D"]
 * 用途:topics set diff(added/removed/shared)是用户可见的核心信号。
 */
export function extractSynthesisTopics(body) {
  if (!body) return [];
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (h) out.push(String(h[2]).trim());
  }
  return out;
}

/**
 * extractSynthesisRefIds(body) — 从 body 抽 arXiv id 列表。
 * 策略:
 *   1. arXiv canonical id: `\d{4}\.\d{4,5}` (YYMM.NNNN/NNNNN 形式)
 *   2. arXiv URL: arxiv\.org/abs/(\d{4}\.\d{4,5})
 *   3. 去重 + 稳定排序
 */
export function extractSynthesisRefIds(body) {
  if (!body) return [];
  const ids = new Set();
  const re = /(?:arxiv\.org\/abs\/|\b)(\d{4}\.\d{4,5})\b/g;
  let m;
  while ((m = re.exec(body)) !== null) ids.add(m[1]);
  return [...ids].sort();
}

/**
 * countWords(text) — 字数估算。
 * - 中文字符每个算 1 字
 * - 英文 / 数字 token 按空格切,每段算 1 词
 * - 标点符号不计
 * 用途:看 synthesis 长度变化趋势。
 */
export function countWords(text) {
  if (!text) return 0;
  // 移除 markdown 控制字符
  const cleaned = String(text ?? '').replace(/^#+\s+/gm, '').replace(/[*_`>]/g, '');
  // 拆中文字符(每个算 1) + 英文 / 数字 token
  const chineseChars = (cleaned.match(/[一-鿿]/g) || []).length;
  const latinWords = (cleaned.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length;
  return chineseChars + latinWords;
}

// ---------------------------------------------------------------------------
// diffSyntheses — 核心纯函数
// ---------------------------------------------------------------------------

/**
 * diffSyntheses(synA, synB, opts) — 比较两份 synthesis,输出 diff 结构。
 *
 * 输入:
 *   synA, synB = { idx: number, raw: string }
 *   opts.includeBody = true   (默认)是否计算 body 字数 / topics / refs
 *
 * 输出结构:
 *   {
 *     idxA: number, idxB: number,
 *     meta: { title, generatedAt, model, roundsSynthesized, deliverablesReferenced, uniquePapers } × 2,
 *     metaDelta: { generatedAtDeltaMs, roundsSynthesizedDelta, deliverablesReferencedDelta, uniquePapersDelta, modelChanged, titleChanged },
 *     body: { wordCountA, wordCountB, wordCountDelta, topicsAdded, topicsRemoved, topicsShared, refsRefIdsAdded, refsRefIdsRemoved, refsRefIdsShared },
 *     stats: { added: number, removed: number, shared: number },
 *     similarity: number     // 0-1,Jaccard 相似度(topics ∩ / topics ∪)
 *   }
 */
export function diffSyntheses(synA, synB, opts = {}) {
  const includeBody = opts.includeBody !== false;
  const a = synA ?? { idx: 0, raw: '' };
  const b = synB ?? { idx: 0, raw: '' };
  const parsedA = stripFrontmatter(a.raw ?? '');
  const parsedB = stripFrontmatter(b.raw ?? '');

  const fmA = parsedA.frontmatter;
  const fmB = parsedB.frontmatter;

  // ---- meta delta ----
  const at = fmA.generated_at ? Date.parse(fmA.generated_at) : null;
  const bt = fmB.generated_at ? Date.parse(fmB.generated_at) : null;
  const generatedAtDeltaMs = (at != null && bt != null) ? (bt - at) : null;

  const meta = {
    titleA: fmA.title ? String(fmA.title) : null,
    titleB: fmB.title ? String(fmB.title) : null,
    generatedAtA: fmA.generated_at ? String(fmA.generated_at) : null,
    generatedAtB: fmB.generated_at ? String(fmB.generated_at) : null,
    modelA: fmA.model != null ? String(fmA.model) : null,
    modelB: fmB.model != null ? String(fmB.model) : null,
    roundsSynthesizedA: fmA.rounds_synthesized != null ? Number(fmA.rounds_synthesized) : null,
    roundsSynthesizedB: fmB.rounds_synthesized != null ? Number(fmB.rounds_synthesized) : null,
    deliverablesReferencedA: fmA.deliverables_referenced != null ? Number(fmA.deliverables_referenced) : null,
    deliverablesReferencedB: fmB.deliverables_referenced != null ? Number(fmB.deliverables_referenced) : null,
    uniquePapersA: fmA.unique_papers != null ? Number(fmA.unique_papers) : null,
    uniquePapersB: fmB.unique_papers != null ? Number(fmB.unique_papers) : null,
  };
  const metaDelta = {
    generatedAtDeltaMs,
    roundsSynthesizedDelta: (meta.roundsSynthesizedA != null && meta.roundsSynthesizedB != null)
      ? meta.roundsSynthesizedB - meta.roundsSynthesizedA : null,
    deliverablesReferencedDelta: (meta.deliverablesReferencedA != null && meta.deliverablesReferencedB != null)
      ? meta.deliverablesReferencedB - meta.deliverablesReferencedA : null,
    uniquePapersDelta: (meta.uniquePapersA != null && meta.uniquePapersB != null)
      ? meta.uniquePapersB - meta.uniquePapersA : null,
    modelChanged: meta.modelA !== meta.modelB,
    titleChanged: meta.titleA !== meta.titleB,
  };

  // ---- body diff ----
  let body = null;
  if (includeBody) {
    const topicsA = extractSynthesisTopics(parsedA.body);
    const topicsB = extractSynthesisTopics(parsedB.body);
    const refsA = extractSynthesisRefIds(parsedA.body);
    const refsB = extractSynthesisRefIds(parsedB.body);

    const setA = new Set(topicsA);
    const setB = new Set(topicsB);
    const topicsAdded = topicsB.filter((t) => !setA.has(t));
    const topicsRemoved = topicsA.filter((t) => !setB.has(t));
    const topicsShared = topicsA.filter((t) => setB.has(t));

    const refSetA = new Set(refsA);
    const refSetB = new Set(refsB);
    const refsRefIdsAdded = refsB.filter((r) => !refSetA.has(r));
    const refsRefIdsRemoved = refsA.filter((r) => !refSetB.has(r));
    const refsRefIdsShared = refsA.filter((r) => refSetB.has(r));

    const wordCountA = countWords(parsedA.body);
    const wordCountB = countWords(parsedB.body);

    // similarity:Jaccard on topics + 0.5× Jaccard on refs,加权平均
    const jaccTopics = topicsShared.length / Math.max(1, topicsAdded.length + topicsRemoved.length + topicsShared.length);
    const jaccRefs = refsRefIdsShared.length / Math.max(1, refsRefIdsAdded.length + refsRefIdsRemoved.length + refsRefIdsShared.length);
    const similarity = +((jaccTopics * 0.7 + jaccRefs * 0.3)).toFixed(3);

    body = {
      wordCountA,
      wordCountB,
      wordCountDelta: wordCountB - wordCountA,
      topicsAdded,
      topicsRemoved,
      topicsShared,
      refsRefIdsAdded,
      refsRefIdsRemoved,
      refsRefIdsShared,
    };
    // 把 similarity 也放到 body 上面,方便渲染
    body.similarity = similarity;
  }

  const stats = body ? {
    topicsAdded: body.topicsAdded.length,
    topicsRemoved: body.topicsRemoved.length,
    topicsShared: body.topicsShared.length,
    refsAdded: body.refsRefIdsAdded.length,
    refsRemoved: body.refsRefIdsRemoved.length,
    refsShared: body.refsRefIdsShared.length,
    similarity: body.similarity,
  } : { topicsAdded: 0, topicsRemoved: 0, topicsShared: 0, refsAdded: 0, refsRemoved: 0, refsShared: 0, similarity: 1 };

  return {
    idxA: a.idx ?? 0,
    idxB: b.idx ?? 0,
    meta,
    metaDelta,
    body,
    stats,
  };
}

// ---------------------------------------------------------------------------
// formatSynthesisDiffText — CLI stdout 渲染
// ---------------------------------------------------------------------------

/**
 * formatSynthesisDiffText(diff) — 把 diffSyntheses 输出渲染成 stdout 文本。
 * 与 formatDiffText (--diff rounds) 同模式:summary line + sectioned list。
 */
export function formatSynthesisDiffText(diff) {
  if (!diff) return '(empty diff)';
  const lines = [];
  lines.push(`🔄 Synthesis #${diff.idxA} → #${diff.idxB}`);
  const sim = diff.stats?.similarity;
  lines.push(`Topics: ${diff.stats?.topicsShared ?? 0} shared · ${diff.stats?.topicsAdded ?? 0} added · ${diff.stats?.topicsRemoved ?? 0} removed · similarity ${sim != null ? sim : '?'}`);

  const md = diff.metaDelta ?? {};
  const sign = (n) => (n == null ? '?' : (n > 0 ? `+${n}` : `${n}`));
  lines.push(`Meta: rounds ${sign(md.roundsSynthesizedDelta)} · deliverables ${sign(md.deliverablesReferencedDelta)} · unique_papers ${sign(md.uniquePapersDelta)} · model ${md.modelChanged ? 'CHANGED' : 'same'}${md.titleChanged ? ' · title CHANGED' : ''}`);

  if (diff.body) {
    const signW = (n) => (n > 0 ? `+${n}` : `${n}`);
    lines.push(`Body: words ${diff.body.wordCountA} → ${diff.body.wordCountB} (Δ ${signW(diff.body.wordCountDelta)})`);
  }
  if (diff.body?.topicsAdded?.length) {
    lines.push(`➕ Topics added (${diff.body.topicsAdded.length}):`);
    for (const t of diff.body.topicsAdded) lines.push(`   + ${t}`);
  }
  if (diff.body?.topicsRemoved?.length) {
    lines.push(`➖ Topics removed (${diff.body.topicsRemoved.length}):`);
    for (const t of diff.body.topicsRemoved) lines.push(`   - ${t}`);
  }
  if (diff.body?.refsRefIdsAdded?.length) {
    lines.push(`📚 Refs added (${diff.body.refsRefIdsAdded.length}):`);
    for (const r of diff.body.refsRefIdsAdded) lines.push(`   + arXiv:${r}`);
  }
  if (diff.body?.refsRefIdsRemoved?.length) {
    lines.push(`📖 Refs removed (${diff.body.refsRefIdsRemoved.length}):`);
    for (const r of diff.body.refsRefIdsRemoved) lines.push(`   - arXiv:${r}`);
  }
  return lines.join('\n');
}