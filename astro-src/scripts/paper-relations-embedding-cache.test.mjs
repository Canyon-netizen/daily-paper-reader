// Test file for embedding-cache.ts pure functions
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

test('embedding-cache: clearEmbeddingCache returns 0 when indexedDB is undefined (Node.js)', async () => {
  const { clearEmbeddingCache } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const result = await clearEmbeddingCache();
  assert.strictEqual(result, 0, 'Should return 0 when indexedDB is not available');
});

test('embedding-cache: embeddingCacheStats returns empty stats when indexedDB is undefined (Node.js)', async () => {
  const { embeddingCacheStats } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const result = await embeddingCacheStats();
  assert.deepStrictEqual(result, { count: 0, oldestAt: 0, newestAt: 0 });
});

test('embedding-cache: readEmbeddingCache returns empty Map when indexedDB is undefined', async () => {
  const { readEmbeddingCache } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const result = await readEmbeddingCache(['2301.12345', '2302.56789'], 'default');
  assert.ok(result instanceof Map);
  assert.strictEqual(result.size, 0);
});

test('embedding-cache: readEmbeddingCache returns empty Map for empty input array', async () => {
  const { readEmbeddingCache } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const result = await readEmbeddingCache([], 'default');
  assert.ok(result instanceof Map);
  assert.strictEqual(result.size, 0);
});

test('embedding-cache: writeEmbeddingCache returns void when indexedDB is undefined', async () => {
  const { writeEmbeddingCache } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const rows = [{ key: '2301.12345|default', vector: [0.1, 0.2], at: Date.now() }];
  const result = await writeEmbeddingCache(rows);
  assert.strictEqual(result, undefined);
});

test('embedding-cache: writeEmbeddingCache returns void for empty array', async () => {
  const { writeEmbeddingCache } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const result = await writeEmbeddingCache([]);
  assert.strictEqual(result, undefined);
});

test('embedding-cache: clearEmbeddingCache returns 0 for multiple calls', async () => {
  const { clearEmbeddingCache } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const result1 = await clearEmbeddingCache();
  const result2 = await clearEmbeddingCache();
  assert.strictEqual(result1, 0);
  assert.strictEqual(result2, 0);
});

test('embedding-cache: embeddingCacheStats returns consistent empty stats', async () => {
  const { embeddingCacheStats } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const result1 = await embeddingCacheStats();
  const result2 = await embeddingCacheStats();
  assert.deepStrictEqual(result1, result2);
  assert.strictEqual(result1.count, 0);
});

test('embedding-cache: readEmbeddingCache with various arxiv id formats', async () => {
  const { readEmbeddingCache } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const ids = ['2312.12345', 'cs/2301.12345', 'hep-th/2301.12345'];
  const result = await readEmbeddingCache(ids, 'default');
  assert.strictEqual(result.size, 0);
});

test('embedding-cache: embeddingCacheStats has correct property types', async () => {
  const { embeddingCacheStats } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const result = await embeddingCacheStats();
  assert.ok(typeof result.count === 'number');
  assert.ok(typeof result.oldestAt === 'number');
  assert.ok(typeof result.newestAt === 'number');
});

test('embedding-cache: writeEmbeddingCache handles rows with empty vector', async () => {
  const { writeEmbeddingCache } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const rows = [{ key: '2301.12345|default', vector: [], at: Date.now() }];
  const result = await writeEmbeddingCache(rows);
  assert.strictEqual(result, undefined);
});

test('embedding-cache: clearEmbeddingCache is idempotent', async () => {
  const { clearEmbeddingCache } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const result1 = await clearEmbeddingCache();
  const result2 = await clearEmbeddingCache();
  const result3 = await clearEmbeddingCache();
  assert.strictEqual(result1, 0);
  assert.strictEqual(result2, 0);
  assert.strictEqual(result3, 0);
});

test('embedding-cache: embeddingCacheStats values are all zero when no IDB', async () => {
  const { embeddingCacheStats } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const result = await embeddingCacheStats();
  assert.strictEqual(result.count, 0);
  assert.strictEqual(result.oldestAt, 0);
  assert.strictEqual(result.newestAt, 0);
});

test('embedding-cache: readEmbeddingCache returns empty map regardless of model name', async () => {
  const { readEmbeddingCache } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const models = ['default', 'custom-model', 'large-v3', ''];
  for (const model of models) {
    const result = await readEmbeddingCache(['2301.12345'], model);
    assert.strictEqual(result.size, 0);
  }
});

test('embedding-cache: writeEmbeddingCache handles various model names', async () => {
  const { writeEmbeddingCache } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const models = ['default', 'custom-model', 'large-v3'];
  for (const model of models) {
    const rows = [{ key: `2301.12345|${model}`, vector: [0.1], at: Date.now() }];
    const result = await writeEmbeddingCache(rows);
    assert.strictEqual(result, undefined);
  }
});

test('embedding-cache: multiple async operations run independently', async () => {
  const { clearEmbeddingCache, embeddingCacheStats, readEmbeddingCache } = await loadTs('astro-src/lib/paper-relations/embedding-cache.ts');
  const [clearResult, statsResult, readResult] = await Promise.all([
    clearEmbeddingCache(),
    embeddingCacheStats(),
    readEmbeddingCache(['2301.12345'], 'default'),
  ]);
  assert.strictEqual(clearResult, 0);
  assert.strictEqual(statsResult.count, 0);
  assert.strictEqual(readResult.size, 0);
});
