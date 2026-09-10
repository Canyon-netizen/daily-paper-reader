//
// tests/test_agents_annotations.mjs -- Round annotations (iter #51)
//
// Coverage:
//   (A) Standalone annotation editor page exists with depth-4 imports
//   (B) Round detail page has annotation widget + link to editor
//   (C) Session dashboard has annotation count badge + section
//   (D) Annotation storage key generator is correct
//   (E) markdownToBlocks handles the editor preview cases
//   (F) Annotation bundle exporter structure
//   (G) Verdict: empty storage -> empty list; populated -> entries
//   (H) /agents/ index links to a round annotation page (n/a — link is from round detail)
//   (I) CSS classes for annotation widget
//
// 跑法: node --test tests/test_agents_annotations.mjs
//

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STANDALONE = join(ROOT, 'astro-src', 'pages', 'agents', '[sessionId]', '[roundId]', 'annotations.astro');
const ROUND_DETAIL = join(ROOT, 'astro-src', 'pages', 'agents', '[sessionId]', '[roundId].astro');
const SESSION_DASH = join(ROOT, 'astro-src', 'pages', 'agents', '[sessionId]', 'index.astro');
const CSS = join(ROOT, 'astro-src', 'styles', 'agents.css');

describe('standalone annotation editor page', () => {
  it('exists with depth-4 imports', async () => {
    const src = await readFile(STANDALONE, 'utf8');
    assert.ok(src.length > 500);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/layouts\/BaseLayout\.astro['"]/);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/components\/Navbar\.astro['"]/);
    assert.match(src, /(from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/styles\/agents\.css['"]|import\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/styles\/agents\.css['"])/);
  });

  it('enumerates rounds via getStaticPaths reading archive/', async () => {
    const src = await readFile(STANDALONE, 'utf8');
    assert.match(src, /getStaticPaths/);
    // 文件里 JS 正则字面量字面字符 `round_(\d+)\.json` —— 用 includes 查字面字符串
    assert.ok(src.includes('round_(\\d+)\\.json'));
  });

  it('has editor form + preview + history sections', async () => {
    const src = await readFile(STANDALONE, 'utf8');
    assert.match(src, /agents-ann-body/);
    assert.match(src, /agents-ann-preview/);
    assert.match(src, /agents-ann-history/);
    assert.match(src, /agents-ann-form/);
  });

  it('uses localStorage key dpr_agents_annotations_<sid>_<NNN>', async () => {
    const src = await readFile(STANDALONE, 'utf8');
    assert.match(src, /dpr_agents_annotations_/);
    assert.match(src, /padStart\(3, '0'\)/);
  });

  it('has export + import buttons', async () => {
    const src = await readFile(STANDALONE, 'utf8');
    assert.match(src, /agents-ann-export/);
    assert.match(src, /agents-ann-import/);
  });
});

describe('round detail page has annotation widget', () => {
  it('contains annotation widget section', async () => {
    const src = await readFile(ROUND_DETAIL, 'utf8');
    assert.match(src, /agents-ann-widget-section/);
    assert.match(src, /agents-ann-widget/);
    assert.match(src, /data-sid=/);
    assert.match(src, /data-rid=/);
  });

  it('links to standalone editor page', async () => {
    const src = await readFile(ROUND_DETAIL, 'utf8');
    assert.match(src, /\/annotations\//);
  });

  it('has client-side script reading from localStorage', async () => {
    const src = await readFile(ROUND_DETAIL, 'utf8');
    assert.match(src, /localStorage\.getItem/);
    assert.match(src, /agents-ann-quick/);
  });
});

describe('session dashboard has annotation count', () => {
  it('contains annotation count badge', async () => {
    const src = await readFile(SESSION_DASH, 'utf8');
    assert.match(src, /agents-ann-count-badge/);
    assert.match(src, /data-sid=/);
  });

  it('has annotation section with per-round table', async () => {
    const src = await readFile(SESSION_DASH, 'utf8');
    assert.match(src, /agents-ann-table/);
    assert.match(src, /agents-ann-export-all/);
  });

  it('enumerates round keys r=1..99', async () => {
    const src = await readFile(SESSION_DASH, 'utf8');
    assert.match(src, /maxGuess\s*=\s*99/);
  });
});

describe('annotation key helper', () => {
  function keyFor(sid, n) {
    return `dpr_agents_annotations_${sid}_${String(n).padStart(3, '0')}`;
  }
  it('zero-pads round number', () => {
    assert.equal(keyFor('sess', 1), 'dpr_agents_annotations_sess_001');
    assert.equal(keyFor('sess', 12), 'dpr_agents_annotations_sess_012');
    assert.equal(keyFor('sess', 123), 'dpr_agents_annotations_sess_123');
  });
});

describe('markdownToBlocks (editor preview)', () => {
  // Mirror from page
  function markdownToBlocks(body) {
    const lines = body.split(/\r?\n/);
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (line.startsWith('# ')) { blocks.push({ kind: 'h1', lines: [line.slice(2).trim()] }); i++; continue; }
      if (line.startsWith('## ')) { blocks.push({ kind: 'h2', lines: [line.slice(3).trim()] }); i++; continue; }
      if (line.startsWith('---')) { blocks.push({ kind: 'hr', lines: [] }); i++; continue; }
      if (line.startsWith('> ')) {
        const ls = [];
        while (i < lines.length && lines[i].startsWith('> ')) { ls.push(lines[i].slice(2).trim()); i++; }
        blocks.push({ kind: 'blockquote', lines: ls });
        continue;
      }
      if (/^\s*[-*]\s+\[[ x]\]\s+/.test(line)) {
        const ls = [];
        while (i < lines.length && /^\s*[-*]\s+\[[ x]\]\s+/.test(lines[i])) {
          ls.push(lines[i].replace(/^\s*[-*]\s+\[[ x]\]\s+/, ''));
          i++;
        }
        blocks.push({ kind: 'checklist', lines: ls });
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const ls = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]) && !/^\s*[-*]\s+\[[ x]\]\s+/.test(lines[i])) {
          ls.push(lines[i].replace(/^\s*[-*]\s+/, ''));
          i++;
        }
        blocks.push({ kind: 'ul', lines: ls });
        continue;
      }
      const ls = [];
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith('#') && !lines[i].startsWith('>') && !/^\s*[-*]\s+/.test(lines[i])) {
        ls.push(lines[i]);
        i++;
      }
      blocks.push({ kind: 'p', lines: ls });
    }
    return blocks;
  }

  it('h2 + bullet + checklist + paragraph', () => {
    const md = `## Notes
- item A
- item B
- [ ] todo 1
- [x] todo 2

Body para`;
    const kinds = markdownToBlocks(md).map((b) => b.kind);
    assert.deepEqual(kinds, ['h2', 'ul', 'checklist', 'p']);
  });

  it('empty string -> no blocks', () => {
    assert.deepEqual(markdownToBlocks(''), []);
    assert.deepEqual(markdownToBlocks('\n\n\n'), []);
  });

  it('blockquote', () => {
    const b = markdownToBlocks('> quoted\n> line 2');
    assert.equal(b.length, 1);
    assert.equal(b[0].kind, 'blockquote');
    assert.deepEqual(b[0].lines, ['quoted', 'line 2']);
  });
});

describe('annotation bundle exporter', () => {
  function buildBundle(sid, byRound) {
    return { session: sid, exported_at: '2025-01-01T00:00:00.000Z', rounds: byRound };
  }

  it('serializes session + per-round history arrays', () => {
    const bundle = buildBundle('sess-1', {
      '001': [{ saved_at: 1, body: 'hello' }],
      '002': [{ saved_at: 2, body: 'foo' }, { saved_at: 3, body: 'bar' }],
    });
    assert.equal(bundle.session, 'sess-1');
    assert.equal(bundle.rounds['001'].length, 1);
    assert.equal(bundle.rounds['002'].length, 2);
    assert.equal(bundle.rounds['002'][1].body, 'bar');
  });
});

describe('empty storage produces empty annotation table', () => {
  function buildTableRows(counts, latest, previews) {
    const numRounds = counts.size;
    if (numRounds === 0) return null;
    return [...counts.keys()].sort((a, b) => a - b).map((r) => ({ r, count: counts.get(r) }));
  }

  it('empty -> null', () => {
    const counts = new Map();
    const rows = buildTableRows(counts);
    assert.equal(rows, null);
  });

  it('populated -> rows sorted', () => {
    const counts = new Map();
    counts.set(2, 3);
    counts.set(1, 1);
    const rows = buildTableRows(counts, new Map(), new Map());
    assert.equal(rows[0].r, 1);
    assert.equal(rows[1].r, 2);
    assert.equal(rows[1].count, 3);
  });
});

describe('CSS for annotations', () => {
  it('has agents-ann-* selectors', async () => {
    const css = await readFile(CSS, 'utf8');
    assert.ok(css.includes('.agents-ann-badge'));
    assert.ok(css.includes('.agents-ann-widget-meta'));
    assert.ok(css.includes('.agents-ann-widget-latest'));
    assert.ok(css.includes('#agents-ann-body'));
    assert.ok(css.includes('.agents-ann-history'));
    assert.ok(css.includes('.agents-ann-history-item'));
    assert.ok(css.includes('#agents-ann-preview'));
  });

  it('has dark-mode variants', async () => {
    const css = await readFile(CSS, 'utf8');
    // 找到 iter #51 那段(包含 .agents-ann-*) 在 prefers-color-scheme:dark 里
    const idx = css.indexOf('iter #51');
    assert.ok(idx > 0, 'iter #51 marker must exist');
    const darkIdx = css.indexOf('@media (prefers-color-scheme: dark)', idx);
    assert.ok(darkIdx > 0, 'dark media query must come after iter #51 marker');
    const darkEnd = css.indexOf('\n}\n', darkIdx);
    const block = css.slice(darkIdx, darkEnd > 0 ? darkEnd : css.length);
    assert.ok(block.includes('.agents-ann-badge'));
    assert.ok(block.includes('.agents-ann-history-item'));
  });
});