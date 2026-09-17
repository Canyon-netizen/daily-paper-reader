#!/usr/bin/env node
// astro-src/scripts/agents-web-search.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/web-search.mjs (pure helpers)。
// normalizeWebSearchUrl (tracking params / https / trailing slash) +
// stubSearch + buildTavilyRequest + parseTavilyResponse +
// dedupeWebSearchResults + filterWebSearchResults + searchWeb +
// formatWebSearchText。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadMjs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadMjs('lib/agents/web-search.mjs');
const {
  normalizeWebSearchUrl,
  stubSearch,
  buildTavilyRequest,
  parseTavilyResponse,
  dedupeWebSearchResults,
  filterWebSearchResults,
  searchWeb,
  formatWebSearchText,
} = mod;

// ---------- normalizeWebSearchUrl ----------
test('normalizeWebSearchUrl: 空字符串 → 空', () => {
  assert.equal(normalizeWebSearchUrl(''), '');
});

test('normalizeWebSearchUrl: null → 空', () => {
  assert.equal(normalizeWebSearchUrl(null), '');
});

test('normalizeWebSearchUrl: undefined → 空', () => {
  assert.equal(normalizeWebSearchUrl(undefined), '');
});

test('normalizeWebSearchUrl: http → https', () => {
  assert.match(normalizeWebSearchUrl('http://example.com/a'), /^https:/);
});

test('normalizeWebSearchUrl: 去掉 utm_*', () => {
  const r = normalizeWebSearchUrl('https://x.com/a?utm_source=test&id=1');
  assert.ok(!r.includes('utm_source'));
  assert.ok(r.includes('id=1'));
});

test('normalizeWebSearchUrl: 去掉 ref_*', () => {
  const r = normalizeWebSearchUrl('https://x.com/a?ref=home&keep=1');
  assert.ok(!r.includes('ref='));
  assert.ok(r.includes('keep=1'));
});

test('normalizeWebSearchUrl: 去掉 fbclid/gclid', () => {
  const r = normalizeWebSearchUrl('https://x.com/?fbclid=abc&gclid=def&ok=1');
  assert.ok(!r.includes('fbclid'));
  assert.ok(!r.includes('gclid'));
  assert.ok(r.includes('ok=1'));
});

test('normalizeWebSearchUrl: 去掉 fragment', () => {
  const r = normalizeWebSearchUrl('https://x.com/a#section1');
  assert.ok(!r.includes('#'));
});

test('normalizeWebSearchUrl: 去 trailing slash', () => {
  const r = normalizeWebSearchUrl('https://x.com/page/');
  assert.ok(!r.endsWith('/page/'));
});

test('normalizeWebSearchUrl: root 保留 /', () => {
  const r = normalizeWebSearchUrl('https://x.com/');
  assert.ok(r.endsWith('/'));
});

test('normalizeWebSearchUrl: 无效 URL 原样', () => {
  const r = normalizeWebSearchUrl('not a url');
  assert.equal(r, 'not a url');
});

test('normalizeWebSearchUrl: 保留 path + query', () => {
  const r = normalizeWebSearchUrl('https://x.com/path/to?a=1&b=2');
  assert.match(r, /\/path\/to/);
  assert.match(r, /a=1/);
  assert.match(r, /b=2/);
});

// ---------- stubSearch ----------
test('stubSearch: 永远返回 stub: true', () => {
  const r = stubSearch('hello');
  assert.equal(r.stub, true);
  assert.equal(r.backend, 'stub');
});

test('stubSearch: 空 results', () => {
  const r = stubSearch('hello');
  assert.deepEqual(r.results, []);
});

test('stubSearch: error null', () => {
  const r = stubSearch('q');
  assert.equal(r.error, null);
});

test('stubSearch: query trim', () => {
  const r = stubSearch('  hello  ');
  assert.equal(r.query, 'hello');
});

// ---------- buildTavilyRequest ----------
test('buildTavilyRequest: 包含 url', () => {
  const r = buildTavilyRequest('q');
  assert.match(r.url, /tavily\.com/);
});

test('buildTavilyRequest: 默认 maxResults=5', () => {
  const r = buildTavilyRequest('q');
  assert.equal(r.body.max_results, 5);
});

test('buildTavilyRequest: 默认 searchDepth=basic', () => {
  const r = buildTavilyRequest('q');
  assert.equal(r.body.search_depth, 'basic');
});

test('buildTavilyRequest: 自定义 maxResults', () => {
  const r = buildTavilyRequest('q', { maxResults: 10 });
  assert.equal(r.body.max_results, 10);
});

test('buildTavilyRequest: 自定义 searchDepth', () => {
  const r = buildTavilyRequest('q', { searchDepth: 'advanced' });
  assert.equal(r.body.search_depth, 'advanced');
});

test('buildTavilyRequest: apiKey 透传', () => {
  const r = buildTavilyRequest('q', { apiKey: 'tvly-xyz' });
  assert.equal(r.body.api_key, 'tvly-xyz');
});

test('buildTavilyRequest: includeDomains → snake_case', () => {
  const r = buildTavilyRequest('q', { includeDomains: ['arxiv.org'] });
  assert.deepEqual(r.body.include_domains, ['arxiv.org']);
});

test('buildTavilyRequest: excludeDomains → snake_case', () => {
  const r = buildTavilyRequest('q', { excludeDomains: ['example.com'] });
  assert.deepEqual(r.body.exclude_domains, ['example.com']);
});

test('buildTavilyRequest: 空 includeDomains → 不含字段', () => {
  const r = buildTavilyRequest('q', { includeDomains: [] });
  assert.equal(r.body.include_domains, undefined);
});

test('buildTavilyRequest: include_answer=false', () => {
  const r = buildTavilyRequest('q');
  assert.equal(r.body.include_answer, false);
});

// ---------- parseTavilyResponse ----------
test('parseTavilyResponse: 空对象 → []', () => {
  assert.deepEqual(parseTavilyResponse({}), []);
});

test('parseTavilyResponse: null → []', () => {
  assert.deepEqual(parseTavilyResponse(null), []);
});

test('parseTavilyResponse: 无 results → []', () => {
  assert.deepEqual(parseTavilyResponse({ query: 'q' }), []);
});

test('parseTavilyResponse: 单结果', () => {
  const r = parseTavilyResponse({
    results: [{ title: 'T', url: 'https://x.com/a', content: 'snippet' }],
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'T');
});

test('parseTavilyResponse: 缺 url → 跳过', () => {
  const r = parseTavilyResponse({
    results: [{ title: 'T' }, { title: 'T2', url: 'https://x.com' }],
  });
  assert.equal(r.length, 1);
});

test('parseTavilyResponse: 缺 title → "(untitled)"', () => {
  const r = parseTavilyResponse({
    results: [{ url: 'https://x.com' }],
  });
  assert.equal(r[0].title, '(untitled)');
});

test('parseTavilyResponse: content strip html tags', () => {
  const r = parseTavilyResponse({
    results: [{ title: 'T', url: 'https://x.com', content: '<b>bold</b> text' }],
  });
  assert.equal(r[0].snippet, 'bold text');
});

test('parseTavilyResponse: snippet 截断 500 字符', () => {
  const longContent = 'a'.repeat(1000);
  const r = parseTavilyResponse({
    results: [{ title: 'T', url: 'https://x.com', content: longContent }],
  });
  assert.equal(r[0].snippet.length, 500);
});

test('parseTavilyResponse: score 透传', () => {
  const r = parseTavilyResponse({
    results: [{ title: 'T', url: 'https://x.com', content: 'c', score: 0.8 }],
  });
  assert.equal(r[0].score, 0.8);
});

test('parseTavilyResponse: 缺 score → null', () => {
  const r = parseTavilyResponse({
    results: [{ title: 'T', url: 'https://x.com', content: 'c' }],
  });
  assert.equal(r[0].score, null);
});

test('parseTavilyResponse: source = domain', () => {
  const r = parseTavilyResponse({
    results: [{ title: 'T', url: 'https://arxiv.org/abs/1', content: 'c' }],
  });
  assert.equal(r[0].source, 'arxiv.org');
});

test('parseTavilyResponse: publishedAt → published_date', () => {
  const r = parseTavilyResponse({
    results: [{
      title: 'T', url: 'https://x.com', content: 'c',
      published_date: '2026-01-01',
    }],
  });
  assert.equal(r[0].publishedAt, '2026-01-01');
});

// ---------- dedupeWebSearchResults ----------
test('dedupe: 相同 url 保留首个', () => {
  const r = dedupeWebSearchResults([
    { title: 'A', url: 'https://x.com', snippet: '1' },
    { title: 'B', url: 'https://x.com', snippet: '2' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'A');
});

test('dedupe: 跟踪参数不同视为同 url', () => {
  const r = dedupeWebSearchResults([
    { title: 'A', url: 'https://x.com/x?utm_source=1', snippet: '1' },
    { title: 'B', url: 'https://x.com/x?utm_source=2', snippet: '2' },
  ]);
  // normalize 后 utm_* 都去掉 → 同 url
  assert.equal(r.length, 1);
});

test('dedupe: 不同 url 全部保留', () => {
  const r = dedupeWebSearchResults([
    { title: 'A', url: 'https://x.com/a' },
    { title: 'B', url: 'https://x.com/b' },
  ]);
  assert.equal(r.length, 2);
});

test('dedupe: 空数组 → 空', () => {
  assert.deepEqual(dedupeWebSearchResults([]), []);
});

test('dedupe: 重复时 score 取 max', () => {
  const r = dedupeWebSearchResults([
    { title: 'A', url: 'https://x.com', score: 0.5 },
    { title: 'B', url: 'https://x.com', score: 0.9 },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].score, 0.9);
});

// ---------- filterWebSearchResults ----------
test('filter: 无 opts → 全部通过', () => {
  const r = filterWebSearchResults([
    { url: 'https://a.com', title: 'A' },
    { url: 'https://b.com', title: 'B' },
  ]);
  assert.equal(r.length, 2);
});

test('filter: includeDomains 只保留匹配', () => {
  const r = filterWebSearchResults([
    { url: 'https://arxiv.org/1', title: 'A' },
    { url: 'https://other.com/1', title: 'O' },
  ], { includeDomains: ['arxiv.org'] });
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'A');
});

test('filter: includeDomains 子域名匹配', () => {
  const r = filterWebSearchResults([
    { url: 'https://blog.arxiv.org/x', title: 'B' },
  ], { includeDomains: ['arxiv.org'] });
  assert.equal(r.length, 1);
});

test('filter: excludeDomains 排除', () => {
  const r = filterWebSearchResults([
    { url: 'https://spam.com/1', title: 'S' },
    { url: 'https://good.com/1', title: 'G' },
  ], { excludeDomains: ['spam.com'] });
  assert.equal(r.length, 1);
});

test('filter: minScore 丢弃低分', () => {
  const r = filterWebSearchResults([
    { url: 'https://a.com', title: 'A', score: 0.3 },
    { url: 'https://b.com', title: 'B', score: 0.8 },
  ], { minScore: 0.5 });
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'B');
});

test('filter: 无 score 的结果不丢', () => {
  const r = filterWebSearchResults([
    { url: 'https://a.com', title: 'A' },
  ], { minScore: 0.5 });
  assert.equal(r.length, 1);
});

test('filter: 同时应用 include/exclude/minScore', () => {
  const r = filterWebSearchResults([
    { url: 'https://arxiv.org/1', title: 'A', score: 0.9 },
    { url: 'https://arxiv.org/2', title: 'B', score: 0.1 },
    { url: 'https://spam.com/1', title: 'S', score: 0.9 },
  ], {
    includeDomains: ['arxiv.org'],
    excludeDomains: ['spam.com'],
    minScore: 0.5,
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'A');
});

// ---------- searchWeb ----------
test('searchWeb: 默认 stub mode', () => {
  const r = searchWeb('q');
  assert.equal(r.stub, true);
  assert.equal(r.backend, 'stub');
});

test('searchWeb: tavily backend → caller must fetch', () => {
  const r = searchWeb('q', { backend: 'tavily', apiKey: 'xyz' });
  assert.equal(r.backend, 'tavily');
  assert.equal(r.stub, false);
  // 仍返回 error,提示 caller 自己 fetch
  assert.match(r.error, /requires caller/i);
});

test('searchWeb: 空 query → 空 results', () => {
  const r = searchWeb('');
  assert.equal(r.results.length, 0);
});

// ---------- formatWebSearchText ----------
test('formatWebSearchText: 空响应', () => {
  const r = formatWebSearchText(null);
  assert.match(r, /empty/);
});

test('formatWebSearchText: stub mode 提示', () => {
  const r = formatWebSearchText({
    query: 'q', results: [], backend: 'stub', stub: true,
  });
  assert.match(r, /stub mode/i);
});

test('formatWebSearchText: 含结果', () => {
  const r = formatWebSearchText({
    query: 'q', backend: 'tavily', stub: false,
    results: [{ title: 'A', url: 'https://x.com/a', snippet: 's', score: 0.5 }],
  });
  assert.match(r, /1 result/);
  assert.match(r, /A/);
  assert.match(r, /https:\/\/x\.com\/a/);
});

test('formatWebSearchText: 多结果 → "N results"', () => {
  const r = formatWebSearchText({
    query: 'q', backend: 'tavily', stub: false,
    results: [
      { title: 'A', url: 'https://x.com/a', snippet: '' },
      { title: 'B', url: 'https://x.com/b', snippet: '' },
    ],
  });
  assert.match(r, /2 results/);
});

test('formatWebSearchText: error 行', () => {
  const r = formatWebSearchText({
    query: 'q', backend: 'tavily', stub: false, error: 'oops',
  });
  assert.match(r, /oops/);
});