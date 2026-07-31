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
 * canonical arXiv id —— **全站唯一实现**(Stage 0)。
 *
 * 不变式:用户态(星标 / 阅读状态 / 笔记 / 回收站)一律以本函数的输出为键,
 * 永不含 `vN`。理由:`maintain-version-refresh` 会把论文从 v1 刷到 v2,若以带
 * 版本的 id 为键,用户笔记会在刷新后全部孤立(Polaris 用 dedup_key 解决同一问题)。
 *
 * 与 getCanonicalArxivId 的区别:后者要求整串严格匹配 `YYMM.NNNNN vN`,不匹配
 * 就原样返回;本函数只做"剥掉尾部版本号"这一件事,对 `2305.16291`(本来就无
 * 版本号)和 `2607.00483v2` 都给出正确结果,因此适合当 storage key 的归一器。
 *
 * 历史:曾有三份近似副本 —— `lib/dom-utils.ts:36`、`scripts/paper-fulltext.ts:170`
 * (带 .trim())、`scripts/topic-search.ts` 的 `canonicalId`。三份副本会让
 * "canonical" 变成实现定义,那两处现已改为 re-export 本函数。
 */
export function canonicalArxivId(id: string): string {
  return String(id || '').trim().replace(/v\d+$/i, '');
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