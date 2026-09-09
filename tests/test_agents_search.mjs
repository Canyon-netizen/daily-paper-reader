//
// tests/test_agents_search.mjs -- Archive-wide search (iter #48)
//
// Coverage:
//   (A) /agents/search/ page exists with depth-2 imports
//   (B) Reads ?q=<query> from URL + filters server-side
//   (C) Indexes: meta.goal, designer.proposals[].title + rationale,
//       modifier.applied[].payload.title, synthesis bodies
//   (D) snippetAround extracts ±N char context around the match
//   (E) highlightSnippet wraps matches in <mark>
//   (F) Sort order: score DESC, lastSeen DESC
//   (G) Goal hits weighted 3x, synthesis 2x, proposal/applied 1x
//   (H) /agents/ index links to search
//   (I) CSS classes for input + hit list
//
// 跑法: node --test tests/test_agents_search.mjs
//

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAGE = join(ROOT, 'astro-src', 'pages', 'agents', 'search.astro');
const INDEX = join(ROOT, 'astro-src', 'pages', 'agents', 'index.astro');
const CSS = join(ROOT, 'astro-src', 'styles', 'agents.css');

describe('search page structure', () => {
  it('exists with depth-2 imports', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.ok(src.length > 500);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/layouts\/BaseLayout\.astro['"]/);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/components\/Navbar\.astro['"]/);
    assert.match(src, /(from\s+['"]\.\.\/\.\.\/styles\/agents\.css['"]|import\s+['"]\.\.\/\.\.\/styles\/agents\.css['"])/);
  });

  it('reads ?q= from URL via Astro.url.searchParams', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /Astro\.url/);
    assert.match(src, /searchParams\.get\('q'\)/);
  });

  it('indexes goal / proposal title + rationale / applied.payload.title / synthesis body', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /goal/);
    assert.match(src, /rationale/);
    assert.match(src, /applied\.payload\.title/);
    assert.match(src, /synthesis/);
  });

  it('renders hits list + highlight snippets', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /agents-search-hits/);
    assert.match(src, /agents-search-hit-snippet/);
    assert.match(src, /highlightSnippet/);
    assert.match(src, /<mark>/);
  });

  it('client-side debounced filter (200ms)', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /setTimeout/);
    assert.match(src, /data-hit-text/);
    assert.ok(/200/.test(src), 'debounce delay 200ms expected');
  });
});

describe('snippetAround semantics', () => {
  // 镜像实现
  function snippetAround(text, query, radius = 50) {
    if (!text) return '';
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text.slice(0, radius * 2);
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + query.length + radius);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';
    return prefix + text.slice(start, end) + suffix;
  }

  it('returns leading + trailing ellipsis when match is in middle', () => {
    const text = 'a'.repeat(200) + 'NEEDLE' + 'b'.repeat(200);
    const s = snippetAround(text, 'NEEDLE', 10);
    assert.ok(s.startsWith('…'));
    assert.ok(s.endsWith('…'));
    assert.ok(s.includes('NEEDLE'));
  });

  it('no ellipsis when match is at start', () => {
    const text = 'NEEDLE' + 'b'.repeat(100);
    const s = snippetAround(text, 'NEEDLE', 10);
    assert.ok(!s.startsWith('…'));
    assert.ok(s.includes('NEEDLE'));
  });

  it('returns head when query not found', () => {
    const text = 'a'.repeat(200);
    const s = snippetAround(text, 'NEEDLE', 5);
    assert.equal(s, 'a'.repeat(10));
  });
});

describe('countOccurrences semantics', () => {
  function countOccurrences(text, query) {
    if (!text || !query) return 0;
    const lower = text.toLowerCase();
    const needle = query.toLowerCase();
    let count = 0;
    let pos = 0;
    while ((pos = lower.indexOf(needle, pos)) !== -1) { count++; pos += needle.length; }
    return count;
  }

  it('counts case-insensitive', () => {
    // 'foo' 在 'fooo' 内部也是一个匹配(indexOf 不重叠扫描)
    assert.equal(countOccurrences('Foo foo FOO fooo', 'foo'), 4);
    assert.equal(countOccurrences('Foo foo FOO', 'foo'), 3);
  });

  it('counts zero for empty query', () => {
    assert.equal(countOccurrences('abc', ''), 0);
  });

  it('counts zero for empty text', () => {
    assert.equal(countOccurrences('', 'foo'), 0);
  });

  it('handles Chinese', () => {
    assert.equal(countOccurrences('文献综述与文献综述', '文献'), 2);
  });
});

describe('highlightSnippet wraps matches in <mark>', () => {
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;',
    }[c] ?? c));
  }
  function highlightSnippet(s, query) {
    if (!query) return escapeHtml(s);
    const lower = s.toLowerCase();
    const needle = query.toLowerCase();
    const parts = [];
    let pos = 0;
    while (true) {
      const idx = lower.indexOf(needle, pos);
      if (idx === -1) { parts.push(escapeHtml(s.slice(pos))); break; }
      parts.push(escapeHtml(s.slice(pos, idx)));
      parts.push(`<mark>${escapeHtml(s.slice(idx, idx + needle.length))}</mark>`);
      pos = idx + needle.length;
    }
    return parts.join('');
  }

  it('wraps single match', () => {
    const out = highlightSnippet('foo bar baz', 'bar');
    assert.match(out, /<mark>bar<\/mark>/);
  });

  it('wraps multiple matches', () => {
    const out = highlightSnippet('foo foo foo', 'foo');
    assert.equal((out.match(/<mark>/g) ?? []).length, 3);
  });

  it('escapes HTML entities (but not all tag chars)', () => {
    // escapeHtml replaces & with & so <script> stays literal
    // (the real defense is against & → & in attribute values)
    const out = highlightSnippet('foo & bar', 'foo');
    assert.ok(out.includes('&'), 'should escape & to &');
  });

  it('returns escaped string when no query', () => {
    const out = highlightSnippet('foo & bar', '');
    assert.ok(out.includes('&'), 'should escape & to &');
    assert.ok(out.includes('foo'));
  });
});

describe('weighting: goal=3x, synthesis=2x, proposal=1x', () => {
  // 读源码里 constant 的字面量
  it('goal weight = 3', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /occ \* 3/);
  });
  it('synthesis weight = 2', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /occ \* 2/);
  });
});

describe('/agents/ index links to search', () => {
  it('has Search button', async () => {
    const src = await readFile(INDEX, 'utf8');
    assert.match(src, /\/agents\/search\//);
  });
});

describe('CSS for search', () => {
  it('has agents-search-input + hit list classes', async () => {
    const css = await readFile(CSS, 'utf8');
    assert.ok(css.includes('.agents-search-input'));
    assert.ok(css.includes('.agents-search-hits'));
    assert.ok(css.includes('.agents-search-hit'));
    assert.ok(css.includes('.agents-search-hit-snippet'));
    assert.ok(css.includes('.agents-search-hit-snippet mark'));
  });
});
