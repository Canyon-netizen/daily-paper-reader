/**
 * agents/candidates.mjs — 从 UserLibrary 构造 RoundInput.candidates。
 *
 * 纯函数,接收 library + paper-lookup,无 DOM / localStorage 依赖。
 * Node 测试可注入 fake lookup;浏览器侧把 readPaper 当 lookup 传入。
 */

const DEFAULT_MAX = 30;

/**
 * @typedef {Object} Candidate
 * @property {string} arxivId
 * @property {string} title
 * @property {string} [tldr]
 */

/**
 * @typedef {Object} LibraryLike
 * @property {string[]} paperIds
 * @property {string} [name]
 * @property {string} [statement]
 */

/**
 * @typedef {Object} PaperMeta
 * @property {string} [title]
 * @property {string} [title_zh]
 * @property {string} [tldr]
 * @property {string} [tldr_zh]
 */

/**
 * @typedef {(arxivId: string) => (PaperMeta | null | Promise<PaperMeta | null>)} PaperLookup
 */

/**
 * 从 library 构造 candidates 列表。
 *
 * @param {LibraryLike} library
 * @param {PaperLookup} paperLookup
 * @param {{ maxPapers?: number, skipMissing?: boolean }} [opts]
 * @returns {Promise<Candidate[]>}
 */
export async function buildCandidatesFromLibrary(library, paperLookup, opts = {}) {
  const max = opts.maxPapers ?? DEFAULT_MAX;
  if (!library?.paperIds?.length) return [];
  const ids = library.paperIds.slice(0, max);
  const out = [];
  for (const id of ids) {
    let meta = null;
    try {
      meta = await paperLookup(id);
    } catch {
      meta = null;
    }
    if (!meta) {
      if (opts.skipMissing) continue;
      // 论文不存在 → 用 arxivId 当 fallback title
      out.push({ arxivId: id, title: `(missing) ${id}` });
      continue;
    }
    const title = meta.title_zh || meta.title || id;
    const tldr = meta.tldr_zh || meta.tldr;
    const cand = { arxivId: id, title };
    if (tldr) cand.tldr = tldr;
    out.push(cand);
  }
  return out;
}
