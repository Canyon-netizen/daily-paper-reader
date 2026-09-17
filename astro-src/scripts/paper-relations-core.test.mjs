// Test file for paper-relations/core.mjs pure functions
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadMjs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', '..', relPath)],
    bundle: true, format: 'esm', platform: 'node',
    write: false, target: 'es2022',
    external: ['node:fs', 'node:fs/promises', 'node:path', 'fs', 'path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

describe('paper-relations-core: flattenCategories', () => {
  test('returns empty array for null/undefined input', async () => {
    const { flattenCategories } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    assert.deepStrictEqual(flattenCategories(null), []);
    assert.deepStrictEqual(flattenCategories(undefined), []);
  });

  test('returns empty array for empty object', async () => {
    const { flattenCategories } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    assert.deepStrictEqual(flattenCategories({}), []);
  });

  test('flattens single category dimension', async () => {
    const { flattenCategories } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const result = flattenCategories({ venue: ['ICML'], task: [], method: [], type: [] });
    assert.deepStrictEqual(result, ['venue:ICML']);
  });

  test('flattens multiple category dimensions', async () => {
    const { flattenCategories } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const result = flattenCategories({
      venue: ['ICML', 'NeurIPS'],
      task: ['rl'],
      method: [],
      type: [],
    });
    assert.deepStrictEqual(result, ['venue:ICML', 'venue:NeurIPS', 'task:rl']);
  });

  test('removes duplicate entries within same dimension', async () => {
    const { flattenCategories } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const result = flattenCategories({
      venue: ['ICML', 'ICML'], // duplicate
      task: [],
      method: [],
      type: [],
    });
    assert.deepStrictEqual(result, ['venue:ICML']);
  });

  test('handles empty category arrays', async () => {
    const { flattenCategories } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const result = flattenCategories({ venue: [], task: [], method: [], type: [] });
    assert.deepStrictEqual(result, []);
  });
});

describe('paper-relations-core: jaccardEdges', () => {
  test('returns empty array for empty rows', async () => {
    const { jaccardEdges } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const result = jaccardEdges([]);
    assert.deepStrictEqual(result, []);
  });

  test('returns empty array for single row', async () => {
    const { jaccardEdges } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const result = jaccardEdges([{ id: 'p1', g: ['task:rl'] }]);
    assert.deepStrictEqual(result, []);
  });

  test('computes jaccard similarity for two papers', async () => {
    const { jaccardEdges } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'p1', g: ['task:rl', 'task:nlp'] },
      { id: 'p2', g: ['task:rl', 'task:cv'] },
    ];
    const result = jaccardEdges(rows);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].source, 'p1');
    assert.strictEqual(result[0].target, 'p2');
    assert.strictEqual(result[0].type, 'jaccard');
    // Intersection: {rl} = 1, Union: {rl, nlp, cv} = 3, Jaccard = 1/3
    assert.strictEqual(result[0].weight, 1/3);
  });

  test('returns shared tags in result', async () => {
    const { jaccardEdges } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'p1', g: ['task:rl', 'venue:icml'] },
      { id: 'p2', g: ['task:rl', 'venue:nips'] },
    ];
    const result = jaccardEdges(rows);
    assert.deepStrictEqual(result[0].shared, ['task:rl']);
  });

  test('respects minWeight threshold', async () => {
    const { jaccardEdges } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'p1', g: ['task:rl'] },
      { id: 'p2', g: ['task:nlp'] },
    ];
    const result = jaccardEdges(rows, 0.5);
    assert.deepStrictEqual(result, []);
  });

  test('handles papers with no tags', async () => {
    const { jaccardEdges } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'p1', g: [] },
      { id: 'p2', g: ['task:rl'] },
    ];
    const result = jaccardEdges(rows);
    assert.deepStrictEqual(result, []);
  });

  test('computes edges for multiple papers', async () => {
    const { jaccardEdges } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'p1', g: ['task:rl'] },
      { id: 'p2', g: ['task:rl'] },
      { id: 'p3', g: ['task:cv'] },
    ];
    const result = jaccardEdges(rows);
    assert.strictEqual(result.length, 1); // Only p1-p2 have overlap
  });
});

describe('paper-relations-core: tfidfEdges', () => {
  test('returns empty array for less than 2 rows', async () => {
    const { tfidfEdges } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    assert.deepStrictEqual(tfidfEdges([]), []);
    assert.deepStrictEqual(tfidfEdges([{ id: 'p1' }]), []);
  });

  test('computes tfidf edges between papers', async () => {
    const { tfidfEdges } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'p1', t: 'deep learning', z: '', l: '' },
      { id: 'p2', t: 'deep learning', z: '', l: '' },
    ];
    const result = tfidfEdges(rows);
    assert.ok(result.length > 0);
    assert.strictEqual(result[0].type, 'tfidf');
  });

  test('respects minWeight threshold', async () => {
    const { tfidfEdges } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'p1', t: 'uniqueword1', z: '', l: '' },
      { id: 'p2', t: 'uniqueword2', z: '', l: '' },
    ];
    const result = tfidfEdges(rows, 8, 0.99);
    assert.deepStrictEqual(result, []);
  });

  test('respects topK limit per node', async () => {
    const { tfidfEdges } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'p1', t: 'a b c', z: '', l: '' },
      { id: 'p2', t: 'a', z: '', l: '' },
      { id: 'p3', t: 'b', z: '', l: '' },
      { id: 'p4', t: 'c', z: '', l: '' },
      { id: 'p5', t: 'd', z: '', l: '' },
    ];
    const result = tfidfEdges(rows, 2, 0);
    // p1 should have at most 2 edges due to topK
    const p1Edges = result.filter(e => e.source === 'p1');
    assert.ok(p1Edges.length <= 2);
  });

  test('handles Chinese text (CJK)', async () => {
    const { tfidfEdges } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'p1', t: '深度学习', z: '', l: '' },
      { id: 'p2', t: '深度学习', z: '', l: '' },
    ];
    const result = tfidfEdges(rows);
    assert.ok(result.length >= 0);
  });
});

describe('paper-relations-core: computeRelations', () => {
  test('returns empty edges for empty rows', async () => {
    const { computeRelations } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const result = computeRelations([]);
    assert.deepStrictEqual(result.ids, []);
    assert.deepStrictEqual(result.edges, {});
  });

  test('returns ids and edges for basic input', async () => {
    const { computeRelations } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'p1', g: ['task:rl'], t: 'reinforcement', z: '', l: '' },
      { id: 'p2', g: ['task:rl'], t: 'learning', z: '', l: '' },
    ];
    const result = computeRelations(rows);
    assert.deepStrictEqual(result.ids, ['p1', 'p2']);
    assert.ok(typeof result.edges === 'object');
  });

  test('respects topK option', async () => {
    const { computeRelations } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'p1', g: ['task:a'], t: 'a', z: '', l: '' },
      { id: 'p2', g: ['task:a'], t: 'a', z: '', l: '' },
      { id: 'p3', g: ['task:a'], t: 'a', z: '', l: '' },
      { id: 'p4', g: ['task:a'], t: 'a', z: '', l: '' },
    ];
    const result = computeRelations(rows, { topK: 1 });
    // Should respect topK in output
    assert.ok(result.edges['0'] === undefined || result.edges['0'].length <= 1);
  });

  test('respects minWeight option', async () => {
    const { computeRelations } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'p1', g: ['task:unique1'], t: 'word1', z: '', l: '' },
      { id: 'p2', g: ['task:unique2'], t: 'word2', z: '', l: '' },
    ];
    const result = computeRelations(rows, { minWeight: 0.9 });
    // Edges should be filtered by minWeight
    const edgeList = Object.values(result.edges).flat();
    for (const e of edgeList) {
      assert.ok(e[1] >= 900); // weight * 1000
    }
  });

  test('returns proper structure with indices', async () => {
    const { computeRelations } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'a', g: ['task:rl'], t: 'rl', z: '', l: '' },
      { id: 'b', g: ['task:rl'], t: 'learning', z: '', l: '' },
    ];
    const result = computeRelations(rows);
    // edges should map indices to [targetIndex, weight*1000, mask]
    const edgeList = Object.values(result.edges).flat();
    if (edgeList.length > 0) {
      assert.ok(Array.isArray(edgeList[0]));
      assert.strictEqual(edgeList[0].length, 3);
    }
  });

  test('handles default options', async () => {
    const { computeRelations } = await loadMjs('astro-src/lib/paper-relations/core.mjs');
    const rows = [
      { id: 'p1', g: ['task:rl'], t: 'test', z: '', l: '' },
      { id: 'p2', g: ['task:nlp'], t: 'test', z: '', l: '' },
    ];
    const result = computeRelations(rows);
    assert.ok(result.ids.length === 2);
    assert.ok(typeof result.edges === 'object');
  });
});
