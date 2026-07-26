import type { PaperListItem, Paper } from './paper';
import type { PaperFrontmatter } from './paper';

const ARXIV_ID_RE = /^(\d{4}\.\d{4,5})v(\d+)$/;

/**
 * 从 arXiv ID 中提取 canonical ID (去掉版本后缀)
 * 例如: "2607.00483v2" → "2607.00483"
 * 非标准格式直接返回原值
 */
export function getCanonicalArxivId(arxivId: string): string {
  const m = ARXIV_ID_RE.exec(arxivId);
  return m ? m[1] : arxivId;
}

/**
 * 从 arXiv ID 中提取版本号
 * 例如: "2607.00483v2" → 2
 * 非标准格式返回 0
 */
export function getArxivVersion(arxivId: string): number {
  const m = ARXIV_ID_RE.exec(arxivId);
  return m ? parseInt(m[2], 10) : 0;
}

/**
 * 判断是否为标准 arXiv ID 格式
 */
export function isArxivId(arxivId: string): boolean {
  return ARXIV_ID_RE.test(arxivId);
}

/**
 * 为去重构建 key:标准 arXiv 用 "arxiv:{canonicalId}",其他用 "id:{id}"
 */
export function buildDedupKey(arxivId: string, fallbackId: string): string {
  if (isArxivId(arxivId)) {
    return `arxiv:${getCanonicalArxivId(arxivId)}`;
  }
  return `id:${fallbackId}`;
}

/**
 * arXiv 版本去重:同一 canonical ID 只保留版本号最大的那条
 * @param items 待去重的项目数组,需包含 arxivId 字段
 * @param getArxivId 获取 arxivId 的函数
 * @returns 去重后的数组
 */
export function dedupByArxivVersion<T extends { arxivId?: string; id: string }>(
  items: T[],
  getArxivId: (item: T) => string = (item) => item.arxivId || '',
): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const arxivId = getArxivId(item);
    const key = buildDedupKey(arxivId, item.id);
    const existing = byKey.get(key);
    const ver = getArxivVersion(arxivId);
    const existingVer = existing ? getArxivVersion(getArxivId(existing)) : 0;
    if (!existing || ver > existingVer) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
}

/**
 * 比较两个 arXiv ID 的版本
 * 返回:负数 a<b, 0 a===b, 正数 a>b
 */
export function compareArxivVersions(a: string, b: string): number {
  const va = getArxivVersion(a);
  const vb = getArxivVersion(b);
  return va - vb;
}

/**
 * 从文件路径中提取 arXiv ID
 * 例如: "2026/07/2607.00483v2" → "2607.00483v2"
 */
export function extractArxivIdFromPath(path: string): string | null {
  const m = path.match(/(\d{4}\.\d{4,5}v\d+)/);
  return m ? m[1] : null;
}

/**
 * 规范化 arXiv ID 用于存储/比较:统一去除 v 前缀的大小写差异
 * 例如: "2607.00483V2" → "2607.00483v2"
 */
export function normalizeArxivId(arxivId: string): string {
  return arxivId.replace(/V(\d+)$/i, 'v$1');
}

/**
 * 从 Paper 或 PaperListItem 中提取 arXiv ID
 */
export function extractArxivId(item: Pick<Paper | PaperListItem, 'arxivId' | 'id'>): string {
  return item.arxivId || '';
}

/**
 * 独立的 Paper 数组去重函数
 * 保持原有 dedupByCanonicalArxivId 的签名和语义
 */
export function dedupByCanonicalArxivId(items: PaperListItem[]): PaperListItem[] {
  return dedupByArxivVersion(items, extractArxivId);
}

/**
 * 生成子版本比较信息,辅助决策 v2 是否值得保留
 * 用于 demoting v1 时,比较 llm_tldr / evidence / tags 等字段
 */
export function generateVersionComparison(
  v1: Partial<PaperFrontmatter>,
  v2: Partial<PaperFrontmatter>
): {
  hasMoreContent: boolean;
  hasBetterEvidence: boolean;
  hasMoreTags: boolean;
  summary: string;
} {
  let hasMoreContent = false;
  let hasBetterEvidence = false;
  let hasMoreTags = false;

  // 比较内容长度(tldr/证据/标签)
  if (v2.tldr && (!v1.tldr || v2.tldr.length > v1.tldr.length)) hasMoreContent = true;
  if (v2.evidence && (!v1.evidence || v2.evidence.length > v1.evidence.length)) hasBetterEvidence = true;
  if (v2.categories && v1.categories) {
    const v2Tags = new Set<string>(v2.categories.task || []);
    const v1Tags = new Set<string>(v1.categories.task || []);
    if (v2Tags.size > v1Tags.size) hasMoreTags = true;
  }

  return {
    hasMoreContent,
    hasBetterEvidence,
    hasMoreTags,
    summary: hasMoreContent || hasBetterEvidence || hasMoreTags
      ? 'v2 有更多/更好的内容'
      : 'v1 v2 差异不大',
  };
}