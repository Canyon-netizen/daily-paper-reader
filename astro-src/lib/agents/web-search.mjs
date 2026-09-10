/**
 * lib/agents/web-search.mjs — web search tool (iter #68)
 *
 * 关闭 docs/agents-workflow.md §6 候选 "加 web search 工具":
 *   "Designer 现在只调 arXiv 候选 — 不像 STORM / Deep Research 那样能搜维基 / 联网;
 *    要真 web research 需要加 web fetch 工具"
 *
 * 设计原则(同 iter #56 search-arxiv / iter #61 paper-compiler / iter #66 synthesis-diff):
 *   - 纯函数,无 IO 直接依赖;调用方负责 fetch
 *   - 输出字节级稳定
 *   - 双 surface 共享(同 paper-compiler / synthesis-pdf / synthesis-diff):
 *     agents-run.mjs --web-search (CLI) ──┐
 *     /agents/<sid>/search/ (browser)     ──┴── both import from
 *                                            lib/agents/web-search.mjs
 *   - 默认 stub mode(零依赖,零网络,返回空数组)— 用户给 WEB_SEARCH_API_KEY 才走真 Tavily
 *   - Tavily 是当下最常用的 AI research search backend(语义 + 关键词混合 + source ranking),
 *     不像 Bing/Google 那种需要 OAuth2 + 复杂计费
 *
 * 单一真相源 for:
 *   - searchWeb(query, opts)             主入口:stub 或 tavily backend + parse + 过滤
 *   - parseTavilyResponse(jsonBody)      浅解析 Tavily response
 *   - normalizeWebSearchUrl(url)         去 utm_* / ref_* tracking params,统一 https
 *   - dedupeWebSearchResults(results)    按 normalized url 去重,保留第一次出现
 *   - filterWebSearchResults(results, opts)  按 includeDomains / excludeDomains / minScore 过滤
 *   - formatWebSearchText(results)       CLI stdout 渲染
 *
 * 跑法:node --test tests/test_agents_web_search.mjs
 *
 * 实跑(可选,需要真 API key):
 *   WEB_SEARCH_API_KEY=tvly-... \
 *     node astro-src/scripts/agents-run.mjs --web-search "LLM agent benchmark 2026"
 */

// ---------------------------------------------------------------------------
// types (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} WebSearchResult
 * @property {string} title        — 搜索结果标题
 * @property {string} url          — normalized URL (无 utm_* 等 tracking)
 * @property {string} snippet      — 摘要(可能是 html 摘,stripTags 后)
 * @property {string} [source]     — domain (e.g. "arxiv.org") 给 --web-search 输出可读
 * @property {number} [score]      — backend 评分(Tavily 给 0-1)
 * @property {string} [publishedAt] — ISO date if available
 */

/**
 * @typedef {Object} SearchWebOpts
 * @property {'stub'|'tavily'} [backend='stub']
 * @property {string}         [apiKey]       — required for tavily backend;可由 WEB_SEARCH_API_KEY 注入
 * @property {number}         [maxResults=5]
 * @property {string[]}       [includeDomains]  — only include these domains
 * @property {string[]}       [excludeDomains]  — skip these domains
 * @property {number}         [minScore=0]      — drop results below this score
 * @property {string}         [searchDepth='basic']  — tavily: 'basic' or 'advanced'
 */

/**
 * @typedef {Object} SearchWebResponse
 * @property {WebSearchResult[]} results
 * @property {string}            query
 * @property {'stub'|'tavily'}   backend
 * @property {boolean}           stub          — true if no real backend ran (caller 可决定是否 warn)
 * @property {string|null}       [error]       — error message if backend failed
 */

// ---------------------------------------------------------------------------
// URL normalization — 去 utm_*, ref_*, fbclid, etc. 防止同一结果出现多次
// ---------------------------------------------------------------------------

const TRACKING_PARAMS = /^(utm_[a-z_]+|ref|ref[a-z_]*|fbclid|gclid|mc_[a-z_]+|_ga|_gl|_gid|icid|src|vero_id|vero_conv|trk|ncid|oly_[a-z_]+|__hssc|__hstc|hsa_[a-z_]+)$/i;

/**
 * normalizeWebSearchUrl(url) — 去 tracking params,统一 https,去 trailing slash。
 * - 保留 path + query(去掉的只是 utm_* / fbclid 等)
 * - 保留 fragment?—— 不保留,大多数 search snippet 不需要 anchor
 * @param {string} url
 * @returns {string}  normalized URL
 */
export function normalizeWebSearchUrl(url) {
  const src = String(url ?? '').trim();
  if (!src) return '';
  let u;
  try {
    u = new URL(src);
  } catch {
    return src; // 解析失败就原样返回
  }
  // 强制 https
  if (u.protocol === 'http:') u.protocol = 'https:';
  // 删 tracking params
  const params = [...u.searchParams.entries()];
  u.search = '';
  for (const [k, v] of params) {
    if (TRACKING_PARAMS.test(k)) continue;
    u.searchParams.append(k, v);
  }
  // 去 fragment + 尾 slash(path 是 root 时保留)
  u.hash = '';
  let out = u.toString();
  if (out.endsWith('/') && u.pathname !== '/' && !u.search) {
    // path 不是 root 才去尾 slash
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * extractDomain(url) — 从 URL 拿 host(小写,无 www. 前缀)。
 */
function extractDomain(url) {
  try {
    const u = new URL(url);
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Stub backend — 不发网络,返回 0 结果 + stub: true 给 caller 提示
// ---------------------------------------------------------------------------

/**
 * stubSearch(query, opts) — 永远返回空数组 + stub: true。
 * 让"无 API key"的本地跑仍能跑完(同 iter #56 search-arxiv 的 sandbox fallback 模式)。
 */
export function stubSearch(query, opts = {}) {
  return {
    query: String(query ?? '').trim(),
    backend: /** @type {'stub'} */ ('stub'),
    stub: true,
    results: [],
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Tavily backend — 调 https://api.tavily.com/search
// 调用方负责 fetch + 注入 apiKey(env: WEB_SEARCH_API_KEY);
// 我们只解析 response JSON + 抽字段。
// ---------------------------------------------------------------------------

/**
 * buildTavilyRequest(query, opts) — 组 Tavily POST body。
 * @returns {{url: string, body: object}}
 */
export function buildTavilyRequest(query, opts = {}) {
  const maxResults = opts.maxResults ?? 5;
  const searchDepth = opts.searchDepth ?? 'basic';
  const body = {
    api_key: opts.apiKey ?? '',
    query: String(query ?? ''),
    max_results: maxResults,
    search_depth: searchDepth,
    include_answer: false,
    include_raw_content: false,
  };
  if (Array.isArray(opts.includeDomains) && opts.includeDomains.length) {
    body.include_domains = opts.includeDomains;
  }
  if (Array.isArray(opts.excludeDomains) && opts.excludeDomains.length) {
    body.exclude_domains = opts.excludeDomains;
  }
  return { url: 'https://api.tavily.com/search', body };
}

/**
 * parseTavilyResponse(jsonBody) — Tavily API response JSON → WebSearchResult[]。
 * Tavily 返回: { results: [{ title, url, content, score, raw_content?, published_date? }], answer?: ... }
 * 我们只取需要的字段;`content` 是 snippet(html 可能带标签),strip 掉。
 */
export function parseTavilyResponse(jsonBody) {
  const body = jsonBody && typeof jsonBody === 'object' ? jsonBody : {};
  const raw = Array.isArray(body.results) ? body.results : [];
  /** @type {WebSearchResult[]} */
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const url = String(r.url ?? '').trim();
    if (!url) continue;
    const title = String(r.title ?? '').trim() || '(untitled)';
    let snippet = String(r.content ?? '').trim();
    // 去掉常见 html 标签(Tavily 有时给原始片段带 <b> 等)
    snippet = snippet.replace(/<\/?(?:b|i|em|strong|code|br|p)>/gi, '');
    out.push({
      title,
      url: normalizeWebSearchUrl(url),
      snippet: snippet.slice(0, 500),
      source: extractDomain(url),
      score: typeof r.score === 'number' ? r.score : null,
      publishedAt: r.published_date ? String(r.published_date) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 去重 + 过滤
// ---------------------------------------------------------------------------

/**
 * dedupeWebSearchResults(results) — 按 normalized URL 去重,保留第一次出现(score 累加 max)。
 */
export function dedupeWebSearchResults(results) {
  /** @type {Map<string, WebSearchResult>} */
  const seen = new Map();
  for (const r of results ?? []) {
    const rawUrl = r?.url ?? '';
    if (!rawUrl) continue;
    const normUrl = normalizeWebSearchUrl(rawUrl);
    if (!normUrl) continue;
    if (!seen.has(normUrl)) {
      seen.set(normUrl, { ...r, url: normUrl });
      continue;
    }
    const prev = seen.get(normUrl);
    if (typeof r.score === 'number') {
      prev.score = Math.max(prev.score ?? 0, r.score);
    }
  }
  return [...seen.values()];
}

/**
 * filterWebSearchResults(results, opts) — 按 includeDomains / excludeDomains / minScore 过滤。
 *   includeDomains: 只保留 host 在列表中的("arxiv.org" 匹配 "arxiv.org" 和 "subdomain.arxiv.org")
 *   excludeDomains: 丢弃 host 在列表中的
 *   minScore: 丢弃 score < minScore (没 score 字段的结果总是保留)
 */
export function filterWebSearchResults(results, opts = {}) {
  const include = Array.isArray(opts.includeDomains) && opts.includeDomains.length
    ? new Set(opts.includeDomains.map((d) => String(d).toLowerCase().replace(/^www\./, '')))
    : null;
  const exclude = Array.isArray(opts.excludeDomains) && opts.excludeDomains.length
    ? new Set(opts.excludeDomains.map((d) => String(d).toLowerCase().replace(/^www\./, '')))
    : null;
  const minScore = typeof opts.minScore === 'number' ? opts.minScore : 0;
  return (results ?? []).filter((r) => {
    const host = extractDomain(r.url ?? '');
    if (include && !include.has(host) && ![...include].some((d) => host.endsWith(`.${d}`))) {
      return false;
    }
    if (exclude && (exclude.has(host) || [...exclude].some((d) => host.endsWith(`.${d}`)))) {
      return false;
    }
    if (typeof r.score === 'number' && r.score < minScore) {
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * searchWeb(query, opts) — 主入口。
 *
 * opts.backend:
 *   - 'stub'  (默认)  不发网络,返回 { stub: true, results: [] }
 *   - 'tavily'        期待 opts.apiKey 已注入(由调用方从 env 读 WEB_SEARCH_API_KEY);
 *                     调用方负责 fetch,我们只 parse + 过滤 + dedupe。
 *                     fetch 失败时返回 { error: msg, results: [], backend: 'tavily' }
 *
 * 注:本函数不直接调 fetch — 让调用方(CLI / 浏览器)负责 IO。
 * 用法:
 *   // CLI:
 *   const apiKey = process.env.WEB_SEARCH_API_KEY ?? '';
 *   const req = buildTavilyRequest(query, { apiKey, maxResults: 5 });
 *   const resp = await fetch(req.url, { method: 'POST', body: JSON.stringify(req.body), ... });
 *   const json = await resp.json();
 *   const results = parseTavilyResponse(json);
 *   const final = filterWebSearchResults(dedupeWebSearchResults(results), opts);
 *
 * 这里只暴露 helper,parse + filter + dedupe 都在 .mjs 内做,
 * caller 可在外部 fetch 后调用我们 — 或用 rawSearchWeb 一步到位(本函数)如果 caller 自己 fetch。
 */
export function searchWeb(query, opts = {}) {
  const backend = opts.backend ?? 'stub';
  const q = String(query ?? '').trim();
  if (!q) {
    return {
      query: '',
      backend,
      stub: backend === 'stub',
      results: [],
      error: null,
    };
  }
  if (backend === 'tavily') {
    return {
      query: q,
      backend,
      stub: false,
      results: [],
      error: 'tavily backend requires caller to fetch; use buildTavilyRequest + parseTavilyResponse directly',
    };
  }
  return stubSearch(q, opts);
}

// ---------------------------------------------------------------------------
// 文本渲染 — CLI stdout
// ---------------------------------------------------------------------------

/**
 * formatWebSearchText(response) — 渲染成 stdout 文本。
 * 同 formatExportText / formatDiffText / formatSynthesisDiffText 的模式。
 */
export function formatWebSearchText(response) {
  if (!response) return '(empty web search response)';
  const { query, results = [], backend = 'stub', stub = false, error = null } = response;
  const lines = [];
  const tag = stub ? ' (stub mode)' : '';
  lines.push(`🔍 Web search: "${query}" · backend=${backend}${tag}`);
  if (error) {
    lines.push(`⚠️  ${error}`);
  }
  if (!results.length) {
    if (stub) {
      lines.push(`No results (stub mode — set WEB_SEARCH_API_KEY to enable Tavily backend)`);
    } else if (error) {
      lines.push(`No results (see error above)`);
    } else {
      lines.push(`No results found`);
    }
    return lines.join('\n');
  }
  lines.push(`${results.length} result${results.length === 1 ? '' : 's'}:`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const scoreTag = typeof r.score === 'number' ? ` (score ${r.score.toFixed(2)})` : '';
    const dateTag = r.publishedAt ? ` · ${r.publishedAt}` : '';
    lines.push(`  ${i + 1}. ${r.title}${scoreTag}`);
    lines.push(`     ${r.url}${dateTag}`);
    if (r.snippet) {
      const snippet = r.snippet.length > 200 ? `${r.snippet.slice(0, 200)}…` : r.snippet;
      lines.push(`     ${snippet}`);
    }
  }
  return lines.join('\n');
}