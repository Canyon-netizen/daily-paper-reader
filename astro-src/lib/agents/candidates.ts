/**
 * agents/candidates.ts — 从 UserLibrary 构造 RoundInput.candidates(类型版本)。
 *
 * 单一真相源:candidates.ts
 *   ↕  行为由 candidates.mjs 镜像 + tests/test_agents_candidates_lib.mjs 守护
 */

import type { UserLibrary } from '../user-libraries/types';

const DEFAULT_MAX = 30;

export interface Candidate {
  arxivId: string;
  title: string;
  tldr?: string;
}

export interface PaperMetaLike {
  title?: string;
  title_zh?: string;
  tldr?: string;
  tldr_zh?: string;
}

export type PaperLookup = (arxivId: string) => PaperMetaLike | null | Promise<PaperMetaLike | null>;

export interface BuildOpts {
  maxPapers?: number;
  skipMissing?: boolean;
}

/**
 * 从 library 构造 candidates 列表。
 *
 * @param library - UserLibrary(或任意带 paperIds 的对象)
 * @param paperLookup - 单论文元数据查找器(浏览器侧可用 readPaper,测试可注入 fake)
 * @param opts - { maxPapers, skipMissing }
 * @returns Candidate[]  顺序 = library.paperIds 原序,截断到 maxPapers
 */
export async function buildCandidatesFromLibrary(
  library: UserLibrary | { paperIds: string[] },
  paperLookup: PaperLookup,
  opts: BuildOpts = {},
): Promise<Candidate[]> {
  const max = opts.maxPapers ?? DEFAULT_MAX;
  if (!library?.paperIds?.length) return [];
  const ids = library.paperIds.slice(0, max);
  const out: Candidate[] = [];
  for (const id of ids) {
    let meta: PaperMetaLike | null = null;
    try {
      meta = await paperLookup(id);
    } catch {
      meta = null;
    }
    if (!meta) {
      if (opts.skipMissing) continue;
      out.push({ arxivId: id, title: `(missing) ${id}` });
      continue;
    }
    const title = meta.title_zh || meta.title || id;
    const tldr = meta.tldr_zh || meta.tldr;
    const cand: Candidate = { arxivId: id, title };
    if (tldr) cand.tldr = tldr;
    out.push(cand);
  }
  return out;
}
