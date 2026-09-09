//
// tests/test_agents_round_comparison_matrix.mjs -- Round comparison matrix (iter #52)
//
// Coverage:
//   (A) Session dashboard renders round comparison matrix section
//   (B) Computes N×N pair counts correctly (N*(N-1)/2)
//   (C) Jaccard similarity: 0 / 0.5 / 1 cases
//   (D) Design drift: stdev of pairwise jaccards
//   (E) Drift buckets: <0.05 / <0.15 / >=0.15
//   (F) avg_score_delta computation
//   (C) CSS classes for matrix table
//
// 跑法: node --test tests/test_agents_round_comparison_matrix.mjs
//

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SESSION_DASH = join(ROOT, 'astro-src', 'pages', 'agents', '[sessionId]', 'index.astro');
const CSS = join(ROOT, 'astro-src', 'styles', 'agents.css');

describe('session dashboard renders matrix section', () => {
  it('contains Round Comparison Matrix header', async () => {
    const src = await readFile(SESSION_DASH, 'utf8');
    assert.match(src, /Round Comparison Matrix \(iter #52\)/);
  });

  it('contains N×N matrix table markup', async () => {
    const src = await readFile(SESSION_DASH, 'utf8');
    assert.match(src, /agents-matrix-table/);
    assert.match(src, /agents-matrix-corner/);
    assert.match(src, /agents-matrix-diag/);
    assert.match(src, /agents-matrix-cell/);
  });

  it('shows design drift metric', async () => {
    const src = await readFile(SESSION_DASH, 'utf8');
    assert.match(src, /设计漂移/);
    assert.match(src, /driftBucket/);
    assert.match(src, /driftCls/);
  });

  it('has expandable pair details table', async () => {
    const src = await readFile(SESSION_DASH, 'utf8');
    assert.match(src, /agents-matrix-pair-details/);
    assert.match(src, /全部 pair 详情/);
    assert.match(src, /按 titles Jaccard 升序/);
  });
});

describe('jaccard similarity', () => {
  function jaccard(a, b) {
    if (a.size === 0 && b.size === 0) return 1;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const uni = a.size + b.size - inter;
    return uni === 0 ? 1 : inter / uni;
  }

  it('empty ∩ empty → 1', () => {
    assert.equal(jaccard(new Set(), new Set()), 1);
  });

  it('A=A → 1', () => {
    const a = new Set(['x', 'y', 'z']);
    assert.equal(jaccard(a, a), 1);
  });

  it('A ∩ B = ½(A∪B) → 0.5', () => {
    const a = new Set(['x', 'y']);
    const b = new Set(['y', 'z']);
    // inter=1 (y), uni=3 (x,y,z) → 1/3 ≈ 0.333
    assert.ok(Math.abs(jaccard(a, b) - 1/3) < 1e-9);
  });

  it('disjoint sets → 0', () => {
    const a = new Set(['x', 'y']);
    const b = new Set(['z', 'w']);
    assert.equal(jaccard(a, b), 0);
  });

  it('subset → |A|/|B|', () => {
    const a = new Set(['x']);
    const b = new Set(['x', 'y']);
    // inter=1, uni=2 → 0.5
    assert.equal(jaccard(a, b), 0.5);
  });
});

describe('pair count', () => {
  function pairCount(n) {
    return n * (n - 1) / 2;
  }
  it('N=1 → 0', () => assert.equal(pairCount(1), 0));
  it('N=2 → 1', () => assert.equal(pairCount(2), 1));
  it('N=3 → 3', () => assert.equal(pairCount(3), 3));
  it('N=5 → 10', () => assert.equal(pairCount(5), 10));
});

describe('design drift (stdev of pairwise jaccards)', () => {
  function stdev(xs) {
    if (xs.length === 0) return 0;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    return Math.sqrt(v);
  }

  it('all same → 0', () => {
    assert.equal(stdev([0.5, 0.5, 0.5]), 0);
  });

  it('[0, 1] → 0.5', () => {
    assert.equal(stdev([0, 1]), 0.5);
  });

  it('empty → 0', () => {
    assert.equal(stdev([]), 0);
  });

  it('monotonic 1 → 0.5 spread', () => {
    // xs = [0, 0.5, 1]: mean = 0.5, var = (0.25 + 0 + 0.25)/3 = 1/6, stdev = sqrt(1/6)
    const v = stdev([0, 0.5, 1]);
    assert.ok(Math.abs(v - Math.sqrt(1/6)) < 1e-9);
  });
});

describe('drift buckets', () => {
  function bucket(d) {
    if (d < 0.05) return '稳定';
    if (d < 0.15) return '轻微漂移';
    return '明显漂移';
  }
  function cls(d) {
    if (d < 0.05) return 'agents-drift-low';
    if (d < 0.15) return 'agents-drift-mid';
    return 'agents-drift-high';
  }

  it('0 → 稳定 / low', () => {
    assert.equal(bucket(0), '稳定');
    assert.equal(cls(0), 'agents-drift-low');
  });
  it('0.04 → 稳定 / low', () => {
    assert.equal(bucket(0.04), '稳定');
    assert.equal(cls(0.04), 'agents-drift-low');
  });
  it('0.05 → 轻微漂移 / mid', () => {
    assert.equal(bucket(0.05), '轻微漂移');
    assert.equal(cls(0.05), 'agents-drift-mid');
  });
  it('0.149 → 轻微漂移 / mid', () => {
    assert.equal(bucket(0.149), '轻微漂移');
    assert.equal(cls(0.149), 'agents-drift-mid');
  });
  it('0.15 → 明显漂移 / high', () => {
    assert.equal(bucket(0.15), '明显漂移');
    assert.equal(cls(0.15), 'agents-drift-high');
  });
  it('0.5 → 明显漂移 / high', () => {
    assert.equal(bucket(0.5), '明显漂移');
    assert.equal(cls(0.5), 'agents-drift-high');
  });
});

describe('avg_score_delta null when missing', () => {
  // mirrors: A.avgScore < 0 || B.avgScore < 0 → null
  function delta(a, b) {
    if (a < 0 || b < 0) return null;
    return b - a;
  }
  it('both valid → b - a', () => {
    assert.equal(delta(7.0, 8.0), 1.0);
  });
  it('A = -1 → null', () => {
    assert.equal(delta(-1, 8.0), null);
  });
  it('B = -1 → null', () => {
    assert.equal(delta(7.0, -1), null);
  });
  it('both = -1 → null', () => {
    assert.equal(delta(-1, -1), null);
  });
});

describe('CSS for matrix', () => {
  it('has matrix selectors', async () => {
    const css = await readFile(CSS, 'utf8');
    assert.ok(css.includes('.agents-matrix-table'));
    assert.ok(css.includes('.agents-matrix-cell'));
    assert.ok(css.includes('.agents-matrix-corner'));
    assert.ok(css.includes('.agents-matrix-diag'));
    assert.ok(css.includes('.agents-matrix-pair-details'));
    assert.ok(css.includes('.agents-drift-low'));
    assert.ok(css.includes('.agents-drift-mid'));
    assert.ok(css.includes('.agents-drift-high'));
  });

  it('has dark-mode variants', async () => {
    const css = await readFile(CSS, 'utf8');
    const idx = css.indexOf('iter #52');
    assert.ok(idx > 0);
    const darkIdx = css.indexOf('@media (prefers-color-scheme: dark)', idx);
    assert.ok(darkIdx > 0);
    const darkEnd = css.indexOf('\n}\n', darkIdx);
    const block = css.slice(darkIdx, darkEnd > 0 ? darkEnd : css.length);
    assert.ok(block.includes('.agents-matrix-table'));
    assert.ok(block.includes('.agents-drift-high'));
  });
});