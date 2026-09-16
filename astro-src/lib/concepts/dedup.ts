// astro-src/lib/concepts/dedup.ts
//
// R7 G.1.2: concept 去重(slug collision + fuzzy match)。
//
// 两个层面的去重:
//   1. Slug collision:同 slug 不同 label → 合并,label 取最长的
//   2. Fuzzy match:不同 slug 但 label 高度相似(> 0.85) → 合并
//
// 输入/输出都是 ConceptRef 数组。本模块是纯函数,可单测。

import type { ConceptRef } from './extract';

// ---------------------------------------------------------------------------
// 文本相似度 —— Jaccard 词 + char bigram,Chinese-friendly
// (已有 lib/jaccard.ts,但为了 dedup 不引入跨模块依赖,这里内置)
// ---------------------------------------------------------------------------

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9一-龥]+/i).filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function charBigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2));
  }
  return set;
}

function bigramJaccard(a: string, b: string): number {
  const sa = charBigrams(a.toLowerCase());
  const sb = charBigrams(b.toLowerCase());
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 组合相似度:token Jaccard + char-bigram Jaccard,等权。 */
export function labelSimilarity(a: string, b: string): number {
  // 子串包含:一个 label 是另一个的前缀(常见情形:"reinforcement learning" vs
  // "reinforcement learning algorithm")。短串 ≥ 4 字符避免误伤("rl" vs "rlhf")。
  if (a.length >= 4 && b.length >= 4) {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    if (la.includes(lb) || lb.includes(la)) {
      return Math.max((tokensAndBigramsAvg(a, b)), 0.92);
    }
  }
  return tokensAndBigramsAvg(a, b);
}

function tokensAndBigramsAvg(a: string, b: string): number {
  const tokens = jaccard(tokenize(a), tokenize(b));
  const bigrams = bigramJaccard(a, b);
  return (tokens + bigrams) / 2;
}

// ---------------------------------------------------------------------------
// Slug collision 去重
// ---------------------------------------------------------------------------

/** 同 slug 的多条合并:label 取最长,confidence 取 max,parent 取非空第一个。 */
export function dedupBySlug(concepts: readonly ConceptRef[]): ConceptRef[] {
  const map = new Map<string, ConceptRef>();
  for (const c of concepts) {
    const existing = map.get(c.slug);
    if (!existing) {
      map.set(c.slug, { ...c });
      continue;
    }
    map.set(c.slug, mergeTwo(existing, c));
  }
  return Array.from(map.values());
}

function mergeTwo(a: ConceptRef, b: ConceptRef): ConceptRef {
  return {
    slug: a.slug,
    label: a.label.length >= b.label.length ? a.label : b.label,
    parent: a.parent || b.parent,
    sourceStage: Math.min(a.sourceStage, b.sourceStage),
    confidence: Math.max(a.confidence, b.confidence),
  };
}

// ---------------------------------------------------------------------------
// Fuzzy 去重
// ---------------------------------------------------------------------------

export interface FuzzyDedupOptions {
  /** label 相似度 ≥ 这个阈值视为同义,默认 0.85 */
  threshold?: number;
  /** 只在 sourceStage 相同之间合并(default true) */
  sameStageOnly?: boolean;
}

export interface FuzzyDedupResult {
  /** 合并后的 concept 列表 */
  concepts: ConceptRef[];
  /** 被合并的 (oldSlug → newSlug) 映射,调试 / UI 跳转用 */
  merges: { from: string; to: string; similarity: number }[];
}

/**
 * 把 label 高相似的 concept 合并。
 *   - 用 union-find 把所有 connected 的 concept 归为一组
 *   - 每组选 confidence 最高(或 sourceStage 最小)的作为 canonical,其它合并进来
 *   - merges 数组记录「从 → 到」的合并方向
 */
export function dedupByFuzzy(
  concepts: readonly ConceptRef[],
  opts: FuzzyDedupOptions = {},
): FuzzyDedupResult {
  const threshold = opts.threshold ?? 0.85;
  const sameStageOnly = opts.sameStageOnly ?? true;
  const arr = concepts.slice();

  // union-find
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) === x) return x;
    const r = find(parent.get(x)!);
    parent.set(x, r);
    return r;
  };
  const union = (x: string, y: string) => {
    const rx = find(x), ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };

  // 比较所有对 (n^2,够用因为 concept 数量小)
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (sameStageOnly && arr[i].sourceStage !== arr[j].sourceStage) continue;
      const sim = labelSimilarity(arr[i].label, arr[j].label);
      if (sim >= threshold) {
        union(arr[i].slug, arr[j].slug);
      }
    }
  }

  // 收集每组的 concept
  const groups = new Map<string, ConceptRef[]>();
  for (const c of arr) {
    const root = find(c.slug);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(c);
  }

  const result: ConceptRef[] = [];
  const merges: FuzzyDedupResult['merges'] = [];
  for (const [, group] of groups) {
    // 选 canonical:confidence max → sourceStage min → label 长
    const sorted = [...group].sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (a.sourceStage !== b.sourceStage) return a.sourceStage - b.sourceStage;
      return b.label.length - a.label.length;
    });
    const canonical = sorted[0];
    result.push(canonical);
    for (const c of sorted.slice(1)) {
      const sim = labelSimilarity(canonical.label, c.label);
      merges.push({ from: c.slug, to: canonical.slug, similarity: sim });
    }
  }

  // 排序:parent 先 → slug
  result.sort((a, b) => {
    if ((a.parent || '') !== (b.parent || '')) {
      return (a.parent || '') < (b.parent || '') ? -1 : 1;
    }
    return a.slug < b.slug ? -1 : 1;
  });

  return { concepts: result, merges };
}

// ---------------------------------------------------------------------------
// 综合:slug → fuzzy 串联
// ---------------------------------------------------------------------------

export function dedupConcepts(
  concepts: readonly ConceptRef[],
  opts: FuzzyDedupOptions = {},
): FuzzyDedupResult {
  const slugDeduped = dedupBySlug(concepts);
  return dedupByFuzzy(slugDeduped, opts);
}