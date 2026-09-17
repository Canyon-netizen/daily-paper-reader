import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true, format: 'esm', platform: 'node',
    write: false, target: 'es2022',
    external: ['node:fs', 'node:fs/promises', 'node:path', 'fs', 'path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

// Tests for astro-src/lib/experiments/aggregate.ts
test('aggregateMetrics returns zeros for empty array', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([]);
  assert.strictEqual(result.mean, 0);
  assert.strictEqual(result.median, 0);
  assert.strictEqual(result.stddev, 0);
  assert.strictEqual(result.min, 0);
  assert.strictEqual(result.max, 0);
  assert.strictEqual(result.count, 0);
});

test('aggregateMetrics computes correct mean', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([10, 20, 30]);
  assert.strictEqual(result.mean, 20);
});

test('aggregateMetrics computes correct median for odd count', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([1, 3, 5, 7, 9]);
  assert.strictEqual(result.median, 5);
});

test('aggregateMetrics computes correct median for even count', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([1, 3, 5, 7]);
  assert.strictEqual(result.median, 4);
});

test('aggregateMetrics computes correct stddev for population', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  // Values: 2, 4, 4, 4, 5, 5, 7, 9
  // Mean = 5, variance = ((3^2 + 1^2 + 1^2 + 1^2 + 0 + 0 + 2^2 + 4^2)/8) = (9+1+1+1+0+0+4+16)/8 = 32/8 = 4
  // stddev = sqrt(4) = 2
  const result = aggregateMetrics([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.strictEqual(result.stddev, 2);
});

test('aggregateMetrics computes correct min', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([5, 2, 8, 1, 9]);
  assert.strictEqual(result.min, 1);
});

test('aggregateMetrics computes correct max', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([5, 2, 8, 1, 9]);
  assert.strictEqual(result.max, 9);
});

test('aggregateMetrics returns correct count', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([1, 2, 3, 4, 5]);
  assert.strictEqual(result.count, 5);
});

test('aggregateMetrics handles single element', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([42]);
  assert.strictEqual(result.mean, 42);
  assert.strictEqual(result.median, 42);
  assert.strictEqual(result.stddev, 0);
  assert.strictEqual(result.min, 42);
  assert.strictEqual(result.max, 42);
  assert.strictEqual(result.count, 1);
});

test('aggregateMetrics rounds to 6 decimal places', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([1, 2]);
  // Mean = 1.5, should be rounded to 6 decimal places
  assert.strictEqual(result.mean, 1.5);
});

test('aggregateMetrics handles negative numbers', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([-5, -1, 0, 3, 8]);
  assert.strictEqual(result.mean, 1);
  assert.strictEqual(result.min, -5);
  assert.strictEqual(result.max, 8);
});

test('aggregateMetrics handles all same values', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([5, 5, 5, 5]);
  assert.strictEqual(result.mean, 5);
  assert.strictEqual(result.median, 5);
  assert.strictEqual(result.stddev, 0);
});

test('formatAggregation returns "No data" for empty result', async () => {
  const { formatAggregation, aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([]);
  const formatted = formatAggregation(result);
  assert.strictEqual(formatted, 'No data');
});

test('formatAggregation formats correctly', async () => {
  const { formatAggregation, aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([1, 2, 3, 4, 5]);
  const formatted = formatAggregation(result);
  assert.ok(formatted.includes('n=5'));
  assert.ok(formatted.includes('mean='));
  assert.ok(formatted.includes('median='));
  assert.ok(formatted.includes('stddev='));
  assert.ok(formatted.includes('range='));
});

test('aggregateMetrics handles large numbers', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([1000000, 2000000, 3000000]);
  assert.strictEqual(result.mean, 2000000);
});

test('aggregateMetrics handles decimal values', async () => {
  const { aggregateMetrics } = await loadTs('../astro-src/lib/experiments/aggregate.ts');
  const result = aggregateMetrics([0.1, 0.2, 0.3]);
  assert.strictEqual(result.mean, 0.2);
});
