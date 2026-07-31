// astro-src/lib/search/corpus.ts — fetchSearchCorpus() + 字段一致性 guard.
//
// 设计:
//   - 浏览器 fetch /search-corpus.json,与本仓库的其余 ARCH 风格一致(LLM proxy /
//     arxiv-index 等都是客户端 fetch)。
//   - **schema guard**:写盘产物 fields 与编译期 SEARCH_FIELDS 不符 → 拒绝建索引,
//     拒绝静默回退到 substring —— 理由见 plan "阶段 5 数据契约"。位掩码错位会
//     让"BM25 搜出的结果是命中错的字段",这种 bug 在生产环境极难重现。
//   - memoized in-flight dedupe:同一页面多次 searchPapers() 只 fetch 一次。

import { SEARCH_FIELDS, type SearchCorpus, type SearchCorpusRow } from './types';

let memFetch: Promise<SearchCorpus | null> | null = null;

/**
 * 拉搜索语料;若产物不可用(schema / 网络)返回 null。
 * **绝不抛**:searchPapers() 据此触发 substring 降级,而不是抛异常打死搜索框。
 */
export function fetchSearchCorpus(
  baseUrl: string = '',
): Promise<SearchCorpus | null> {
  if (memFetch) return memFetch;
  memFetch = (async () => {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/search-corpus.json`, { cache: 'force-cache' });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return null;
    }
    if (!isSearchCorpus(json)) return null;
    if (!fieldsMatch(json.fields)) return null;
    return json;
  })();
  return memFetch;
}

/** 清 memo —— 测试或热替 build 产物时用。 */
export function resetSearchCorpusMemo(): void {
  memFetch = null;
}

function isSearchCorpus(x: unknown): x is SearchCorpus {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (o.v !== 1) return false;
  if (typeof o.generatedAt !== 'string') return false;
  if (!Array.isArray(o.fields)) return false;
  if (!Array.isArray(o.rows)) return false;
  return true;
}

/** 顺序比较;长度不同直接 false,否则逐位 string eq。 */
function fieldsMatch(fields: unknown): fields is readonly string[] {
  if (!Array.isArray(fields)) return false;
  if (fields.length !== SEARCH_FIELDS.length) return false;
  for (let i = 0; i < SEARCH_FIELDS.length; i++) {
    if (fields[i] !== SEARCH_FIELDS[i]) return false;
  }
  return true;
}

/** 安全地读某行某字段值(用于字段投影,缺字段给空串/[])。 */
export function pickField(row: SearchCorpusRow, field: string): string | string[] {
  switch (field) {
    case 'title': return row.t || '';
    case 'title_zh': return row.z || '';
    case 'tldr': return row.l || '';
    case 'segments': return row.s || '';
    case 'authors': return row.a || '';
    case 'concepts': return row.k || [];
    case 'categories': return row.g || [];
    default: return '';
  }
}
