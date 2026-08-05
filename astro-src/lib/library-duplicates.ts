// astro-src/lib/library-duplicates.ts
// 论文重复检测:版本簇 + 跨 ID 标题重复
//
// 与 listPapers 的 dedup 选项不同——这里检测的是"同一论文的多个文件"
// (版本簇/标题重复),在列表视图中它们会作为多条记录出现。

import { canonicalArxivId, getArxivVersion } from './arxiv';
import type { PaperListItem } from './paper';

/** 重复原因类型 */
export type DuplicateReason = 'version-cluster' | 'cross-id-similar-title';

/** 单个论文文件引用(从 PaperListItem 投影) */
export interface PaperFileRef {
  relPath: string;
  arxivId: string;
  canonicalId: string;
  version: number;
  title: string;
  date: string;
  /** 是否包含 wikiContent(Polaris 5 节中文解读) */
  hasWiki: boolean;
}

/** 重复组 */
export interface DuplicateGroup {
  /** 重复组的标识(version-cluster 用 canonicalId, cross-id 用归一化标题) */
  groupKey: string;
  reason: DuplicateReason;
  files: PaperFileRef[];
}

/** 把 PaperListItem 转换为 PaperFileRef(仅取需要的字段) */
export function toFileRef(p: PaperListItem): PaperFileRef {
  return {
    relPath: p.id,
    arxivId: p.arxivId,
    canonicalId: p.canonicalArxivId,
    version: getArxivVersion(p.arxivId),
    title: p.title_plain || p.title || '',
    date: p.date || '',
    hasWiki: !!p.wikiContent,
  };
}

/**
 * 找出版本簇:同一 canonicalId 有多个文件(不同版本/不同入库日期)
 * @param papers 论文列表
 * @returns 有 2+ 文件的 canonicalId 分组
 */
export function findVersionClusters(papers: PaperFileRef[]): DuplicateGroup[] {
  const byCanonical = new Map<string, PaperFileRef[]>();
  for (const p of papers) {
    if (!p.canonicalId) continue;
    const arr = byCanonical.get(p.canonicalId) || [];
    arr.push(p);
    byCanonical.set(p.canonicalId, arr);
  }
  const groups: DuplicateGroup[] = [];
  for (const [canonicalId, files] of byCanonical) {
    if (files.length > 1) {
      // 按版本号降序排,最新的在前
      files.sort((a, b) => b.version - a.version);
      groups.push({
        groupKey: canonicalId,
        reason: 'version-cluster',
        files,
      });
    }
  }
  // 按文件数降序排
  groups.sort((a, b) => b.files.length - a.files.length);
  return groups;
}

/**
 * 标题归一化:小写 → 去非字母数字 → 合并空白
 * 用于检测跨 ID 的标题重复
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/\s+/g, '');
}

/**
 * 找出跨 ID 的标题重复:不同 canonicalId 但标题完全相同(归一化后)
 * 阈值:归一化后标题长度 >= 30 才参与比较(避免短标题误报)
 * @param papers 论文列表
 * @returns 有 2+ 文件的标题重复组
 */
export function findCrossIdTitleDupes(papers: PaperFileRef[]): DuplicateGroup[] {
  // 第一次遍历:按归一化标题分桶,只保留长度 >= 30 的
  const byNormalizedTitle = new Map<string, PaperFileRef[]>();
  for (const p of papers) {
    const normalized = normalizeTitle(p.title);
    if (normalized.length >= 30) {
      const arr = byNormalizedTitle.get(normalized) || [];
      arr.push(p);
      byNormalizedTitle.set(normalized, arr);
    }
  }
  const groups: DuplicateGroup[] = [];
  for (const [normalizedTitle, files] of byNormalizedTitle) {
    // 跨 ID 才算重复:files 里 canonicalId 至少有 2 个不同的
    const uniqueCanons = new Set(files.map((f) => f.canonicalId));
    if (uniqueCanons.size > 1) {
      groups.push({
        groupKey: normalizedTitle,
        reason: 'cross-id-similar-title',
        files,
      });
    }
  }
  // 按文件数降序排
  groups.sort((a, b) => b.files.length - a.files.length);
  return groups;
}

/**
 * 综合检测:版本簇 + 跨 ID 标题重复,按组内文件数降序
 * @param papers 论文列表(from listPapers 或类似数据源)
 * @returns 所有重复组
 */
export function findDuplicateGroups(papers: PaperListItem[]): DuplicateGroup[] {
  const refs = papers.map(toFileRef);
  const versionGroups = findVersionClusters(refs);
  const crossIdGroups = findCrossIdTitleDupes(refs);
  // 合并并按文件数降序排
  const all = [...versionGroups, ...crossIdGroups];
  all.sort((a, b) => b.files.length - a.files.length);
  return all;
}

/**
 * 统计摘要:返回各原因的组数
 */
export function duplicateStats(groups: DuplicateGroup[]): { versionCluster: number; crossIdTitle: number } {
  let versionCluster = 0;
  let crossIdTitle = 0;
  for (const g of groups) {
    if (g.reason === 'version-cluster') versionCluster++;
    else crossIdTitle++;
  }
  return { versionCluster, crossIdTitle };
}
