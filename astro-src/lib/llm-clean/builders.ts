// /lib/llm-clean/builders.ts — LLM-emit 对象的构造 builder。
//
// 集中理由(参见 [[feedback_subq_fields_whitelist]]):
//   - extractBalancedJson / JSON.parse / callLLMRaw 出来的字段会"无声丢失";
//   - `as` cast + 漏字段不会报错;
//   - regen / 部分拷字段路径("只拷 LLM 输出那 4 个字段,把自己手动加的不拷")
//     容易漏。
//
// 解决:类型构造必须走这里的 builder。任何字段缺失:
//   - required 字段 → 调用处类型不匹配(编译期捕获)
//   - optional 字段 → 显式默认值兜底(undefined / normalize 后)
// 新增字段时必须同步 (type / input shape / builder) 三处,由 TS 编译保证。

import type {
  SubQ,
  SubQInput,
  Facet,
  FacetInput,
} from '../types';
import { ALLOWED_FACET_CATEGORIES, FACET_CATEGORY_LABELS } from '../types/facet';
import { ALLOWED_EXPLORATION_TYPES } from '../types/subq';
import { normalizeAliasToken, normalizeAliases, normalizeQuery, clampText } from './normalize';

/**
 * 构造 SubQ。所有 LLM-emitted 字段 (label/reason/aliases/explorationType) 必须
 * 在这里被白名单拷过,保证任何字段漏拷时 TypeScript 直接报缺 required。
 */
export function buildSubQ(input: SubQInput): SubQ {
  const cleanedQuery = normalizeQuery(input.query);
  const out: SubQ = {
    id: input.id,
    label: String(input.label ?? '').slice(0, 60),
    query: cleanedQuery || (typeof input.query === 'string' ? input.query.trim() : ''),
    reason: String(input.reason ?? '').trim(),
    selected: input.selected !== false,
    source: input.source,
    explorationType: (() => {
      const raw = String(input.explorationType ?? '').trim().toLowerCase();
      // ALLOWED_EXPLORATION_TYPES 的元素类型即 SubQ['explorationType']
      // (nullable 字段;optional<T> = T | undefined);has() 接受 string,直接判定后 cast。
      return ALLOWED_EXPLORATION_TYPES.has(raw as never)
        ? (raw as NonNullable<SubQ['explorationType']>)
        : undefined;
    })(),
    aliases:
      input.aliases !== undefined
        ? normalizeAliases(input.aliases, cleanedQuery)
        : undefined,
    hitCount: typeof input.hitCount === 'number' ? input.hitCount : undefined,
    hitSamples: Array.isArray(input.hitSamples)
      ? input.hitSamples.filter((s): s is string => typeof s === 'string')
      : undefined,
    searchError: input.searchError ? String(input.searchError) : undefined,
    facetId: (() => {
      const t = String(input.facetId ?? '').trim().slice(0, 64);
      return t || undefined;
    })(),
    facetLabel: (() => {
      const t = String(input.facetLabel ?? '').trim().slice(0, 60);
      return t || undefined;
    })(),
  };
  return out;
}

/**
 * regen 路径专用:从已有 SubQ + LLM 出的部分字段构造新值。
 * 与 buildSubQ 不同 —— 这条路径要"保留已有手动修改过的字段",只在合适时覆盖。
 */
export function buildRegenSubQ(args: {
  base: SubQ;
  replacement: SubQ;
}): SubQ {
  const { base, replacement } = args;
  // label/query/reason:始终用 LLM 新出的(用户点 regen 本意就是"重写这些")
  // aliases/explorationType:若 base 已经有手动填的值则保留 base,只在 base 为空时用 LLM
  //                      新出的。这样用户手动改的优先级 > LLM 一次性产出。
  const keepAliases =
    base.aliases && base.aliases.length > 0
      ? base.aliases
      : replacement.aliases ?? base.aliases;
  return buildSubQ({
    id: base.id,
    label: replacement.label,
    query: replacement.query || base.query,
    reason: replacement.reason ?? base.reason,
    selected: base.selected,
    source: base.source,
    explorationType: replacement.explorationType ?? base.explorationType,
    aliases: keepAliases,
    hitCount: base.hitCount,
    hitSamples: base.hitSamples,
    searchError: base.searchError,
    // facet 归属:用户已有归属优先(regen 不应把子方向搬到别的维度),
    // 旧 session / base 无归属时才用 replacement 补齐。
    facetId: base.facetId ?? replacement.facetId,
    facetLabel: base.facetLabel ?? replacement.facetLabel,
  });
}

/**
 * 构造 Facet。id/label/note 清洗 + 截断,category 非法 → 'method' 兜底。
 * 不负责去重 id / 校验 subq 映射(那需要 facets+subqs 全局上下文,在 decomposeIdea 解析层做)。
 */
export function buildFacet(input: FacetInput): Facet {
  const rawCat = String(input.category ?? '').trim().toLowerCase();
  const category: Facet['category'] = ALLOWED_FACET_CATEGORIES.has(rawCat as Facet['category'])
    ? (rawCat as Facet['category'])
    : 'method';
  return {
    id: String(input.id ?? '').trim().slice(0, 64),
    label: String(input.label ?? '').trim().slice(0, 60),
    category: category in FACET_CATEGORY_LABELS ? category : 'method',
    note: clampText(input.note, 180),
  };
}

// re-export normalize helpers for callers that want one-stop import.
export { normalizeAliasToken, normalizeAliases, normalizeQuery, clampText, clampStringArray } from './normalize';