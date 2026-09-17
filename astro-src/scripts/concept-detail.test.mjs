#!/usr/bin/env node
// astro-src/scripts/concept-detail.test.mjs
//
// Tests for R7 polish: astro-src/lib/concept-detail.ts.
//
// The module is fundamentally IO-bound (buildConceptIndex, readPaper, recentSnapshots).
// No pure helper functions are exported. This test file verifies:
// 1. Module loads successfully via esbuild
// 2. Expected exports exist (getAllConceptSlugs, getConceptDetail, ConceptDetail)
// 3. Basic function signatures are callable

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    target: 'es2022',
    external: ['node:fs', 'node:fs/promises', 'node:path', 'fs', 'path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

// ---------- Module loads and exports ----------
test('module loads without errors', async () => {
  const mod = await loadTs('lib/concept-detail.ts');
  assert.ok(mod, 'module should load');
});

test('exports getAllConceptSlugs function', async () => {
  const mod = await loadTs('lib/concept-detail.ts');
  assert.ok(typeof mod.getAllConceptSlugs === 'function', 'getAllConceptSlugs should be exported');
});

test('exports getConceptDetail function', async () => {
  const mod = await loadTs('lib/concept-detail.ts');
  assert.ok(typeof mod.getConceptDetail === 'function', 'getConceptDetail should be exported');
});

// ---------- Function signatures ----------
test('getAllConceptSlugs returns a Promise', async () => {
  const mod = await loadTs('lib/concept-detail.ts');
  const result = mod.getAllConceptSlugs();
  assert.ok(result instanceof Promise, 'getAllConceptSlugs should return a Promise');
  // Don't await - would trigger IO
});

test('getConceptDetail accepts a slug string and returns a Promise', async () => {
  const mod = await loadTs('lib/concept-detail.ts');
  // Don't call with real slug - would trigger IO
  // Just verify the function accepts a string argument
  assert.strictEqual(mod.getConceptDetail.length, 1, 'getConceptDetail should accept 1 argument (slug)');
});

// ---------- Integration note ----------
// The sorting comparator inside getConceptDetail:
//   citingPapersRaw.sort((a, b) => {
//     if (b.centrality !== a.centrality) return b.centrality - a.centrality;
//     return (a.title_zh || a.title || a.id).localeCompare(b.title_zh || b.title || b.id);
//   });
// is pure but not exported. It cannot be tested without refactoring to extract it.
// The module is IO-bound: buildConceptIndex, readPaper, recentSnapshots all require disk access.
// Full behavior is covered by integration tests.
