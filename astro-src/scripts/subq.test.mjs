#!/usr/bin/env node
// astro-src/scripts/subq.test.mjs
//
// Tests for R7 polish: astro-src/lib/types/subq.ts computeFacetCoverage + ALLOWED_EXPLORATION_TYPES.

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
    platform: 'neutral',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/types/subq.ts');
const { computeFacetCoverage, ALLOWED_EXPLORATION_TYPES } = mod;

test('computeFacetCoverage: 全部覆盖', () => {
  const facets = [
    { id: 'f1', label: '方法', category: 'method', note: '' },
    { id: 'f2', label: '任务', category: 'data_task', note: '' },
  ];
  const subqs = [
    { id: 'q1', facetId: 'f1' },
    { id: 'q2', facetId: 'f2' },
  ];
  const cov = computeFacetCoverage(facets, subqs);
  assert.deepEqual(cov.uncoveredFacetIds, []);
  assert.deepEqual(cov.redundantFacetIds, []);
  assert.deepEqual(cov.unassignedSubqIds, []);
});

test('computeFacetCoverage: 有 uncovered facet', () => {
  const facets = [
    { id: 'f1', label: 'a', category: 'method', note: '' },
    { id: 'f2', label: 'b', category: 'data_task', note: '' },
  ];
  const subqs = [{ id: 'q1', facetId: 'f1' }];
  const cov = computeFacetCoverage(facets, subqs);
  assert.deepEqual(cov.uncoveredFacetIds, ['f2']);
  assert.deepEqual(cov.redundantFacetIds, []);
});

test('computeFacetCoverage: 有 redundant facet(>1 subq)', () => {
  const facets = [{ id: 'f1', label: 'a', category: 'method', note: '' }];
  const subqs = [
    { id: 'q1', facetId: 'f1' },
    { id: 'q2', facetId: 'f1' },
  ];
  const cov = computeFacetCoverage(facets, subqs);
  assert.deepEqual(cov.uncoveredFacetIds, []);
  assert.deepEqual(cov.redundantFacetIds, ['f1']);
});

test('computeFacetCoverage: 有 unassigned subq', () => {
  const facets = [{ id: 'f1', label: 'a', category: 'method', note: '' }];
  const subqs = [
    { id: 'q1', facetId: 'f1' },
    { id: 'q2', facetId: '' },
    { id: 'q3', facetId: 'unknown' }, // 未知 facet
  ];
  const cov = computeFacetCoverage(facets, subqs);
  assert.deepEqual(cov.unassignedSubqIds.sort(), ['q2', 'q3']);
});

test('computeFacetCoverage: 空 facets', () => {
  const cov = computeFacetCoverage([], [{ id: 'q1', facetId: '' }]);
  // 所有 subq 都算 unassigned
  assert.equal(cov.unassignedSubqIds.length, 1);
  assert.deepEqual(cov.uncoveredFacetIds, []);
});

test('computeFacetCoverage: 空 subqs', () => {
  const facets = [{ id: 'f1', label: 'a', category: 'method', note: '' }];
  const cov = computeFacetCoverage(facets, []);
  assert.deepEqual(cov.uncoveredFacetIds, ['f1']);
  assert.deepEqual(cov.redundantFacetIds, []);
  assert.deepEqual(cov.unassignedSubqIds, []);
});

test('computeFacetCoverage: 综合场景', () => {
  const facets = [
    { id: 'f1', label: 'a', category: 'method', note: '' },
    { id: 'f2', label: 'b', category: 'data_task', note: '' },
    { id: 'f3', label: 'c', category: 'structure_property', note: '' },
  ];
  const subqs = [
    { id: 'q1', facetId: 'f1' },
    { id: 'q2', facetId: 'f1' }, // redundant for f1
    { id: 'q3', facetId: 'unknown' }, // unassigned
    { id: 'q4', facetId: 'f2' },
    // f3 无 subq → uncovered
  ];
  const cov = computeFacetCoverage(facets, subqs);
  assert.deepEqual(cov.uncoveredFacetIds, ['f3']);
  assert.deepEqual(cov.redundantFacetIds, ['f1']);
  assert.deepEqual(cov.unassignedSubqIds, ['q3']);
});

test('ALLOWED_EXPLORATION_TYPES: 4 个探索类型', () => {
  assert.equal(ALLOWED_EXPLORATION_TYPES.size, 4);
  assert.ok(ALLOWED_EXPLORATION_TYPES.has('cross_domain'));
  assert.ok(ALLOWED_EXPLORATION_TYPES.has('method_transfer'));
  assert.ok(ALLOWED_EXPLORATION_TYPES.has('reverse'));
  assert.ok(ALLOWED_EXPLORATION_TYPES.has('combination'));
});

test('ALLOWED_EXPLORATION_TYPES: 未知类型不在', () => {
  assert.ok(!ALLOWED_EXPLORATION_TYPES.has('auto'));
  assert.ok(!ALLOWED_EXPLORATION_TYPES.has('manual'));
  assert.ok(!ALLOWED_EXPLORATION_TYPES.has(''));
});