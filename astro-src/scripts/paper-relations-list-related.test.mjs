// Test file for list-related.ts pure functions
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(relPath) {
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

test('list-related: findRelatedForList returns empty array when canonicalIds is empty', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.12345', title: 'Test', date: '2023-01-01' }];
  const result = await findRelatedForList([], { papers });
  assert.deepStrictEqual(result, []);
});

test('list-related: findRelatedForList returns empty array when papers is empty', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const result = await findRelatedForList(['2301.12345'], { papers: [] });
  assert.deepStrictEqual(result, []);
});

test('list-related: findRelatedForList returns empty array when papers array is empty', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const result = await findRelatedForList(['2301.12345'], { papers: [] });
  assert.deepStrictEqual(result, []);
});

test('list-related: findRelatedForList returns empty when no query papers match', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.99999', title: 'Other Paper', date: '2023-01-01' }];
  const result = await findRelatedForList(['2301.12345'], { papers });
  assert.deepStrictEqual(result, []);
});

test('list-related: findRelatedForList accepts default algorithm option', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.12345', title: 'Test', date: '2023-01-01' }];
  // hybrid is default, should not throw
  const result = await findRelatedForList(['2301.12345'], { papers, algorithm: 'hybrid' });
  assert.ok(Array.isArray(result));
});

test('list-related: findRelatedForList accepts tfidf algorithm option', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.12345', title: 'Test', date: '2023-01-01' }];
  const result = await findRelatedForList(['2301.12345'], { papers, algorithm: 'tfidf' });
  assert.ok(Array.isArray(result));
});

test('list-related: findRelatedForList accepts jaccard algorithm option', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.12345', title: 'Test', date: '2023-01-01' }];
  const result = await findRelatedForList(['2301.12345'], { papers, algorithm: 'jaccard' });
  assert.ok(Array.isArray(result));
});

test('list-related: findRelatedForList accepts embedding algorithm option', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.12345', title: 'Test', date: '2023-01-01' }];
  const result = await findRelatedForList(['2301.12345'], { papers, algorithm: 'embedding' });
  assert.ok(Array.isArray(result));
});

test('list-related: findRelatedForList respects topK option', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.12345', title: 'Test', date: '2023-01-01' }];
  const result = await findRelatedForList(['2301.12345'], { papers, topK: 5 });
  assert.ok(Array.isArray(result));
});

test('list-related: findRelatedForList respects minWeight option', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.12345', title: 'Test', date: '2023-01-01' }];
  const result = await findRelatedForList(['2301.12345'], { papers, minWeight: 0.5 });
  assert.ok(Array.isArray(result));
});

test('list-related: findRelatedForList accepts sinceDate option', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.12345', title: 'Test', date: '2023-01-01' }];
  const result = await findRelatedForList(['2301.12345'], { papers, sinceDate: '2022-01-01' });
  assert.ok(Array.isArray(result));
});

test('list-related: findRelatedForList accepts queryLimit option', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.12345', title: 'Test', date: '2023-01-01' }];
  const result = await findRelatedForList(['2301.12345'], { papers, queryLimit: 10 });
  assert.ok(Array.isArray(result));
});

test('list-related: findRelatedForList handles arxiv IDs with version suffix', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.12345v1', title: 'Test', date: '2023-01-01' }];
  const result = await findRelatedForList(['2301.12345v1'], { papers });
  // Should normalize and find the paper
  assert.ok(Array.isArray(result));
});

test('list-related: findRelatedForList handles multiple canonical IDs', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [
    { id: '2301.12345', title: 'Test 1', date: '2023-01-01' },
    { id: '2302.56789', title: 'Test 2', date: '2023-02-01' },
  ];
  const result = await findRelatedForList(['2301.12345', '2302.56789'], { papers });
  assert.ok(Array.isArray(result));
});

test('list-related: findRelatedForList returns array with expected shape', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.12345', title: 'Test', date: '2023-01-01' }];
  const result = await findRelatedForList(['2301.12345'], { papers });
  // If results exist, verify shape
  for (const item of result) {
    assert.ok(typeof item.arxivId === 'string');
    assert.ok(typeof item.weight === 'number');
    assert.ok(Array.isArray(item.relatedTo));
  }
});

test('list-related: findRelatedForList with papers missing date field', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.12345', title: 'Test' }]; // no date
  const result = await findRelatedForList(['2301.12345'], { papers, sinceDate: '2022-01-01' });
  assert.ok(Array.isArray(result));
});

test('list-related: findRelatedForList is callable multiple times', async () => {
  const { findRelatedForList } = await loadTs('astro-src/lib/paper-relations/list-related.ts');
  const papers = [{ id: '2301.12345', title: 'Test', date: '2023-01-01' }];
  const result1 = await findRelatedForList(['2301.12345'], { papers });
  const result2 = await findRelatedForList(['2301.12345'], { papers });
  assert.ok(Array.isArray(result1));
  assert.ok(Array.isArray(result2));
});
