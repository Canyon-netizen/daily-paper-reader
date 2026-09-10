/**
 * lib/agents/web-search.ts — typed mirror of web-search.mjs (iter #68).
 *
 * Phase A shim pattern(同 export-bundle / paper-compiler / synthesis-pdf /
 * synthesis-diff):.mjs 是 runtime 真相源,.ts 只声明 type contract + re-export。
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  score?: number | null;
  publishedAt?: string | null;
}

export interface SearchWebOpts {
  backend?: 'stub' | 'tavily';
  apiKey?: string;
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  minScore?: number;
  searchDepth?: 'basic' | 'advanced';
}

export interface SearchWebResponse {
  results: WebSearchResult[];
  query: string;
  backend: 'stub' | 'tavily';
  stub: boolean;
  error?: string | null;
}

export interface TavilyRequest {
  url: string;
  body: {
    api_key: string;
    query: string;
    max_results: number;
    search_depth: string;
    include_answer: boolean;
    include_raw_content: boolean;
    include_domains?: string[];
    exclude_domains?: string[];
  };
}

export interface FilterWebSearchOpts {
  includeDomains?: string[];
  excludeDomains?: string[];
  minScore?: number;
}

export {
  normalizeWebSearchUrl,
  stubSearch,
  buildTavilyRequest,
  parseTavilyResponse,
  dedupeWebSearchResults,
  filterWebSearchResults,
  searchWeb,
  formatWebSearchText,
} from './web-search.mjs';