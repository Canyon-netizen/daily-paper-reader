import { test, describe } from 'node:test';
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

// Tests for astro-src/lib/types/subq.ts

describe('ALLOWED_EXPLORATION_TYPES', () => {

  test('contains all valid exploration types', async () => {
    const { ALLOWED_EXPLORATION_TYPES } = await loadTs('../astro-src/lib/types/subq.ts');

    assert.ok(ALLOWED_EXPLORATION_TYPES.has('cross_domain'), 'has cross_domain');
    assert.ok(ALLOWED_EXPLORATION_TYPES.has('method_transfer'), 'has method_transfer');
    assert.ok(ALLOWED_EXPLORATION_TYPES.has('reverse'), 'has reverse');
    assert.ok(ALLOWED_EXPLORATION_TYPES.has('combination'), 'has combination');
  });

  test('has exactly 4 exploration types', async () => {
    const { ALLOWED_EXPLORATION_TYPES } = await loadTs('../astro-src/lib/types/subq.ts');
    assert.strictEqual(ALLOWED_EXPLORATION_TYPES.size, 4);
  });

  test('is a Set', async () => {
    const { ALLOWED_EXPLORATION_TYPES } = await loadTs('../astro-src/lib/types/subq.ts');
    assert.ok(ALLOWED_EXPLORATION_TYPES instanceof Set, 'is a Set');
  });

});

describe('computeFacetCoverage', () => {

  test('returns empty arrays for empty inputs', async () => {
    const { computeFacetCoverage } = await loadTs('../astro-src/lib/types/subq.ts');

    const result = computeFacetCoverage([], []);

    assert.deepStrictEqual(result.uncoveredFacetIds, []);
    assert.deepStrictEqual(result.redundantFacetIds, []);
    assert.deepStrictEqual(result.unassignedSubqIds, []);
  });

  test('detects uncovered facets', async () => {
    const { computeFacetCoverage } = await loadTs('../astro-src/lib/types/subq.ts');

    const facets = [
      { id: 'f1', label: 'Facet 1', category: 'method', note: '' },
      { id: 'f2', label: 'Facet 2', category: 'data_task', note: '' },
    ];
    const subqs = [
      { id: 's1', label: 'SubQ 1', query: 'q1', reason: 'r1', selected: true, facetId: 'f1' },
    ];

    const result = computeFacetCoverage(facets, subqs);

    assert.deepStrictEqual(result.uncoveredFacetIds, ['f2']);
    assert.deepStrictEqual(result.redundantFacetIds, []);
    assert.deepStrictEqual(result.unassignedSubqIds, []);
  });

  test('detects redundant facets (more than 1 subq)', async () => {
    const { computeFacetCoverage } = await loadTs('../astro-src/lib/types/subq.ts');

    const facets = [
      { id: 'f1', label: 'Facet 1', category: 'method', note: '' },
    ];
    const subqs = [
      { id: 's1', label: 'SubQ 1', query: 'q1', reason: 'r1', selected: true, facetId: 'f1' },
      { id: 's2', label: 'SubQ 2', query: 'q2', reason: 'r2', selected: true, facetId: 'f1' },
    ];

    const result = computeFacetCoverage(facets, subqs);

    assert.deepStrictEqual(result.uncoveredFacetIds, []);
    assert.deepStrictEqual(result.redundantFacetIds, ['f1']);
    assert.deepStrictEqual(result.unassignedSubqIds, []);
  });

  test('detects unassigned subqs (no facetId)', async () => {
    const { computeFacetCoverage } = await loadTs('../astro-src/lib/types/subq.ts');

    const facets = [
      { id: 'f1', label: 'Facet 1', category: 'method', note: '' },
    ];
    const subqs = [
      { id: 's1', label: 'SubQ 1', query: 'q1', reason: 'r1', selected: true },
      { id: 's2', label: 'SubQ 2', query: 'q2', reason: 'r2', selected: true, facetId: 'f1' },
    ];

    const result = computeFacetCoverage(facets, subqs);

    assert.deepStrictEqual(result.uncoveredFacetIds, []);
    assert.deepStrictEqual(result.redundantFacetIds, []);
    assert.deepStrictEqual(result.unassignedSubqIds, ['s1']);
  });

  test('detects unassigned subqs (invalid facetId)', async () => {
    const { computeFacetCoverage } = await loadTs('../astro-src/lib/types/subq.ts');

    const facets = [
      { id: 'f1', label: 'Facet 1', category: 'method', note: '' },
    ];
    const subqs = [
      { id: 's1', label: 'SubQ 1', query: 'q1', reason: 'r1', selected: true, facetId: 'nonexistent' },
    ];

    const result = computeFacetCoverage(facets, subqs);

    assert.deepStrictEqual(result.uncoveredFacetIds, ['f1']);
    assert.deepStrictEqual(result.redundantFacetIds, []);
    assert.deepStrictEqual(result.unassignedSubqIds, ['s1']);
  });

  test('handles multiple facets with mixed coverage', async () => {
    const { computeFacetCoverage } = await loadTs('../astro-src/lib/types/subq.ts');

    const facets = [
      { id: 'f1', label: 'Facet 1', category: 'method', note: '' },
      { id: 'f2', label: 'Facet 2', category: 'data_task', note: '' },
      { id: 'f3', label: 'Facet 3', category: 'structure_property', note: '' },
    ];
    const subqs = [
      { id: 's1', label: 'SubQ 1', query: 'q1', reason: 'r1', selected: true, facetId: 'f1' },
      { id: 's2', label: 'SubQ 2', query: 'q2', reason: 'r2', selected: true, facetId: 'f1' },
      { id: 's3', label: 'SubQ 3', query: 'q3', reason: 'r3', selected: true, facetId: 'f2' },
    ];

    const result = computeFacetCoverage(facets, subqs);

    assert.deepStrictEqual(result.uncoveredFacetIds, ['f3']);
    assert.deepStrictEqual(result.redundantFacetIds, ['f1']);
    assert.deepStrictEqual(result.unassignedSubqIds, []);
  });

  test('handles all subqs unassigned', async () => {
    const { computeFacetCoverage } = await loadTs('../astro-src/lib/types/subq.ts');

    const facets = [
      { id: 'f1', label: 'Facet 1', category: 'method', note: '' },
    ];
    const subqs = [
      { id: 's1', label: 'SubQ 1', query: 'q1', reason: 'r1', selected: true },
      { id: 's2', label: 'SubQ 2', query: 'q2', reason: 'r2', selected: true },
    ];

    const result = computeFacetCoverage(facets, subqs);

    assert.deepStrictEqual(result.uncoveredFacetIds, ['f1']);
    assert.deepStrictEqual(result.redundantFacetIds, []);
    assert.deepStrictEqual(result.unassignedSubqIds, ['s1', 's2']);
  });

  test('handles all facets perfectly covered', async () => {
    const { computeFacetCoverage } = await loadTs('../astro-src/lib/types/subq.ts');

    const facets = [
      { id: 'f1', label: 'Facet 1', category: 'method', note: '' },
      { id: 'f2', label: 'Facet 2', category: 'data_task', note: '' },
    ];
    const subqs = [
      { id: 's1', label: 'SubQ 1', query: 'q1', reason: 'r1', selected: true, facetId: 'f1' },
      { id: 's2', label: 'SubQ 2', query: 'q2', reason: 'r2', selected: true, facetId: 'f2' },
    ];

    const result = computeFacetCoverage(facets, subqs);

    assert.deepStrictEqual(result.uncoveredFacetIds, []);
    assert.deepStrictEqual(result.redundantFacetIds, []);
    assert.deepStrictEqual(result.unassignedSubqIds, []);
  });

  test('handles facet with exactly 1 subq (not redundant)', async () => {
    const { computeFacetCoverage } = await loadTs('../astro-src/lib/types/subq.ts');

    const facets = [
      { id: 'f1', label: 'Facet 1', category: 'method', note: '' },
    ];
    const subqs = [
      { id: 's1', label: 'SubQ 1', query: 'q1', reason: 'r1', selected: true, facetId: 'f1' },
    ];

    const result = computeFacetCoverage(facets, subqs);

    assert.deepStrictEqual(result.uncoveredFacetIds, []);
    assert.deepStrictEqual(result.redundantFacetIds, []);
    assert.deepStrictEqual(result.unassignedSubqIds, []);
  });

});

describe('Type exports', () => {

  // Note: TypeScript types (SubQExplorationType, SubQSource, SubQ, etc.)
  // are not available at runtime after esbuild bundling.
  // They exist in source but are stripped during compilation.

});
