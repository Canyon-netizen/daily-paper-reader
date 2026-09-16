// astro-src/lib/writing/citation-sync.ts
//
// R7 E.3.5: writing ↔ paper cited_papers 同步.
//
//   - syncWritingCitedPapers(writingId, knownPaperIds, opts): 同步 writing 的引用
//   - findOrphanCitations(writingId, knownPapers): 找出未被收录的 arxiv 引用
//
// Storage: localStorage key `dpr_writing_cited_papers_v1`
//   Schema: { [writingId]: { citedPapers: string[], updatedAt: number } }

export interface SyncResult {
  added: string[];
  removed: string[];
  kept: string[];
}

export interface SyncOpts {
  /** writing sections 内容 (array of section content) */
  sections: Array<{ content: string }>;
  /** 当前已知的 paper ids */
  knownPaperIds: string[];
  /** 是否执行实际写入 (默认 false, 只返回结果) */
  dryRun?: boolean;
}

const STORAGE_KEY = 'dpr_writing_cited_papers_v1';

/** 从单个 section 内容提取 arxiv id */
const ARXIV_ID_RE = /arXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?)/gi;

function extractArxivIdsFromSection(content: string): string[] {
  const ids = new Set<string>();
  for (const m of content.matchAll(ARXIV_ID_RE)) {
    // 去除 vN 后缀
    const canonical = m[1].replace(/v\d+$/, '');
    ids.add(canonical);
  }
  return [...ids];
}

/**
 * 从所有 sections 提取所有引用的 arxiv id.
 */
export function extractAllCitedArxivIds(sections: Array<{ content: string }>): string[] {
  const allIds = new Set<string>();
  for (const section of sections) {
    const ids = extractArxivIdsFromSection(section.content);
    for (const id of ids) {
      allIds.add(id);
    }
  }
  return [...allIds];
}

function getStorage(): Record<string, { citedPapers: string[]; updatedAt: number }> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setStorage(data: Record<string, { citedPapers: string[]; updatedAt: number }>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * 同步 writing 的引用列表.
 * - 从 sections 提取所有 [arXiv:NNNN.NNNNN] 格式的引用
 * - 与 knownPaperIds 比较,返回 added/removed/kept
 * - 若 dryRun=false,写入 localStorage
 */
export function syncWritingCitedPapers(
  writingId: string,
  knownPaperIds: string[],
  opts: SyncOpts,
): SyncResult {
  const { sections, dryRun = false } = opts;

  // 从 writing sections 提取所有引用的 arxiv id
  const citedIds = extractAllCitedArxivIds(sections);

  // 比较: known → cited
  const knownSet = new Set(knownPaperIds.map((id) => id.replace(/v\d+$/, '')));
  const citedSet = new Set(citedIds);

  const added: string[] = [];
  const removed: string[] = [];
  const kept: string[] = [];

  for (const id of citedIds) {
    if (!knownSet.has(id)) {
      added.push(id);
    } else {
      kept.push(id);
    }
  }

  // 检查 knownPaperIds 中有但 cited 中没有的 (手动删除的引用)
  for (const id of knownPaperIds) {
    const canonical = id.replace(/v\d+$/, '');
    if (!citedSet.has(canonical)) {
      removed.push(id);
    }
  }

  // 写入存储 (非 dryRun)
  if (!dryRun) {
    const storage = getStorage();
    storage[writingId] = {
      citedPapers: [...added, ...kept],
      updatedAt: Date.now(),
    };
    setStorage(storage);
  }

  return { added, removed, kept };
}

/**
 * 查找孤立的引用: 在 writing 中被提及但不在 knownPapers 中的 arxiv id.
 */
export function findOrphanCitations(
  writingId: string,
  knownPapers: Array<{ arxivId: string }>,
): string[] {
  const storage = getStorage();
  const stored = storage[writingId];

  // 从 knownPapers 提取 id 集合
  const knownSet = new Set(knownPapers.map((p) => p.arxivId.replace(/v\d+$/, '')));

  // 如果没有存储记录,从 writing 内容查找 (需要传入 sections)
  // 这里简化: 假设调用方传入 knownPapers,返回 storage 中的 citedPapers 差集
  if (!stored) {
    return [];
  }

  const orphans: string[] = [];
  for (const citedId of stored.citedPapers) {
    const canonical = citedId.replace(/v\d+$/, '');
    if (!knownSet.has(canonical)) {
      orphans.push(citedId);
    }
  }

  return orphans;
}

/**
 * 读取 writing 的存储引用列表.
 */
export function getStoredCitedPapers(writingId: string): string[] {
  const storage = getStorage();
  return storage[writingId]?.citedPapers ?? [];
}

/**
 * 清除 writing 的引用存储.
 */
export function clearCitedPapers(writingId: string): void {
  const storage = getStorage();
  delete storage[writingId];
  setStorage(storage);
}

/** 合并两套引用列表,返回合并结果和差异. */
export function mergeCitedPapers(
  existing: readonly string[],
  newRefs: readonly string[],
): { merged: string[]; added: string[]; removed: string[] } {
  const existingCanons = existing.map((id) => id.replace(/v\d+$/, ''));
  const newCanons = newRefs.map((id) => id.replace(/v\d+$/, ''));

  const existingSet = new Set(existingCanons);
  const newSet = new Set(newCanons);

  const added: string[] = [];
  const removed: string[] = [];

  // 找出新增的
  for (let i = 0; i < newRefs.length; i++) {
    if (!existingSet.has(newCanons[i])) {
      added.push(newRefs[i]);
    }
  }

  // 找出被删除的
  for (let i = 0; i < existing.length; i++) {
    if (!newSet.has(existingCanons[i])) {
      removed.push(existing[i]);
    }
  }

  // merged = newRefs 作为基础 (按 newRefs 顺序)
  const merged = [...newRefs];

  return { merged, added, removed };
}
