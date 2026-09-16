// astro-src/lib/writing/version.ts
//
// R7 E.3.4: writing draft versioning (Git commit 自动绑定).
//
//   - DraftVersion interface: commitSha, message, savedAt, wordCount, author
//   - bindDraftToGit(writingId, opts): create version bound to Git commit or hash
//   - getVersionHistory(writingId): read from localStorage
//   - compareVersions(a, b): line-based diff stats
//
// Storage: localStorage key `dpr_writing_versions_v1`
//   Schema: { [writingId]: DraftVersion[] }

export interface DraftVersion {
  commitSha: string;
  message: string;
  savedAt: number; // timestamp ms
  wordCount: number;
  author?: string;
}

export interface BindDraftToGitOpts {
  message?: string;
  commitSha?: string;
  wordCount: number;
  author?: string;
  updatedAt?: number; // timestamp, defaults to Date.now()
}

const STORAGE_KEY = 'dpr_writing_versions_v1';

function getStorage(): Record<string, DraftVersion[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setStorage(data: Record<string, DraftVersion[]>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/** 用 writingId + updatedAt 生成一个短 hash (当没有 Git commit 时用) */
function generateFallbackSha(writingId: string, updatedAt: number): string {
  // 简单 hash: djb2 + 时间戳前 7 位
  let h = 5381;
  const str = `${writingId}:${updatedAt}`;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  const hash = (h >>> 0).toString(16);
  return hash.slice(0, 7);
}

/**
 * 把当前 draft 状态绑定到一个版本记录.
 * - 若 opts.commitSha 给出,直接用它.
 * - 否则用 fallback hash (writingId + updatedAt 前 7 位).
 */
export function bindDraftToGit(
  writingId: string,
  opts: BindDraftToGitOpts,
): DraftVersion {
  const savedAt = opts.updatedAt ?? Date.now();
  const commitSha = opts.commitSha ?? generateFallbackSha(writingId, savedAt);
  const version: DraftVersion = {
    commitSha,
    message: opts.message ?? `Saved draft ${writingId}`,
    savedAt,
    wordCount: opts.wordCount,
    author: opts.author,
  };

  const storage = getStorage();
  const history = storage[writingId] ?? [];
  history.unshift(version); // newest first
  // 确保按 savedAt 降序排列
  history.sort((a, b) => b.savedAt - a.savedAt);
  storage[writingId] = history;
  setStorage(storage);

  return version;
}

/**
 * 读取指定 writing 的版本历史.
 */
export function getVersionHistory(writingId: string): DraftVersion[] {
  const storage = getStorage();
  return storage[writingId] ?? [];
}

/**
 * 基于行集合的 diff 比较.
 * 返回: { wordDelta, timeDeltaMs, linesAdded, linesRemoved }
 *
 * 注意: wordDelta 是通过 wordCount 字段估算,不是实际行内容.
 */
export function compareVersions(
  a: DraftVersion,
  b: DraftVersion,
): {
  wordDelta: number;
  timeDeltaMs: number;
  linesAdded: number;
  linesRemoved: number;
} {
  const wordDelta = b.wordCount - a.wordCount;
  const timeDeltaMs = b.savedAt - a.savedAt;

  // 简单 line-based diff: 用 wordCount 估算 lines (假设平均每行 50 词)
  const avgWordsPerLine = 50;
  const linesA = Math.ceil(a.wordCount / avgWordsPerLine);
  const linesB = Math.ceil(b.wordCount / avgWordsPerLine);

  // 简单估算: 增加的行数 vs 删除的行数
  const linesAdded = Math.max(0, linesB - linesA);
  const linesRemoved = Math.max(0, linesA - linesB);

  return {
    wordDelta,
    timeDeltaMs,
    linesAdded,
    linesRemoved,
  };
}

/**
 * 清空指定 writing 的版本历史.
 */
export function clearVersionHistory(writingId: string): void {
  const storage = getStorage();
  delete storage[writingId];
  setStorage(storage);
}

/**
 * 获取所有有版本记录的 writingId 列表.
 */
export function getAllWritingIds(): string[] {
  const storage = getStorage();
  return Object.keys(storage);
}
