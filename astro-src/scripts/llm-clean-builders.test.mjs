#!/usr/bin/env node
// astro-src/scripts/llm-clean-builders.test.mjs
//
// Tests for R7 polish: astro-src/lib/llm-clean/builders.ts + types/subq.ts.
// Inlines the ALLOWED_* constants and computeFacetCoverage since the
// esbuild-externalize path doesn't work with relative imports inside
// data-URL modules (see notes in paper-relations-jaccard test).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- inline ALLOWED_FACET_CATEGORIES (lib/types/facet.ts) --------------
const ALLOWED_FACET_CATEGORIES = new Set([
  'method',
  'data_task',
  'structure_property',
  'application_transfer',
  'evaluation_benchmark',
]);
const FACET_CATEGORY_LABELS = {
  method: '方法路线',
  data_task: '数据与任务',
  structure_property: '结构与性质',
  application_transfer: '应用与迁移',
  evaluation_benchmark: '评测与基准',
};

// --- inline ALLOWED_EXPLORATION_TYPES (lib/types/subq.ts) --------------
const ALLOWED_EXPLORATION_TYPES = new Set([
  'cross_domain',
  'method_transfer',
  'reverse',
  'combination',
]);

// --- inline clampText + normalizeQuery + normalizeAliases -------------
function normalizeAliasToken(raw) {
  if (typeof raw !== 'string') return '';
  const t = raw.trim();
  if (!t) return '';
  return t.replace(/[^A-Za-z0-9 \-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeAliases(rawAliases, primaryQuery) {
  if (!Array.isArray(rawAliases)) return [];
  const seen = new Set();
  const out = [];
  const primaryClean = normalizeAliasToken(primaryQuery).toLowerCase();
  for (const a of rawAliases) {
    const t = normalizeAliasToken(a);
    if (!t) continue;
    const key = t.toLowerCase();
    if (key === primaryClean) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function normalizeQuery(q) {
  if (typeof q !== 'string') return '';
  let s = q.replace(/[一-鿿]+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/[^A-Za-z0-9 \-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const toks = s.split(' ').filter(Boolean);
  if (toks.length > 6) s = toks.slice(0, 6).join(' ');
  return s;
}

function clampText(s, max) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// --- inline buildSubQ (verbatim) ---------------------------------------
function buildSubQ(input) {
  const cleanedQuery = normalizeQuery(input.query);
  const out = {
    id: input.id,
    label: String(input.label ?? '').slice(0, 60),
    query: cleanedQuery || (typeof input.query === 'string' ? input.query.trim() : ''),
    reason: String(input.reason ?? '').trim(),
    selected: input.selected !== false,
    source: input.source,
    explorationType: (() => {
      const raw = String(input.explorationType ?? '').trim().toLowerCase();
      return ALLOWED_EXPLORATION_TYPES.has(raw) ? raw : undefined;
    })(),
    aliases:
      input.aliases !== undefined
        ? normalizeAliases(input.aliases, cleanedQuery)
        : undefined,
    hitCount: typeof input.hitCount === 'number' ? input.hitCount : undefined,
    hitSamples: Array.isArray(input.hitSamples)
      ? input.hitSamples.filter((s) => typeof s === 'string')
      : undefined,
    searchError: input.searchError ? String(input.searchError) : undefined,
    facetId: (() => {
      const t = String(input.facetId ?? '').trim().slice(0, 64);
      return t || undefined;
    })(),
    facetLabel: (() => {
      const t = String(input.facetLabel ?? '').trim().slice(0, 60);
      return t || undefined;
    })(),
  };
  return out;
}

// --- inline buildRegenSubQ (verbatim) ---------------------------------
function buildRegenSubQ(args) {
  const { base, replacement } = args;
  const keepAliases =
    base.aliases && base.aliases.length > 0
      ? base.aliases
      : replacement.aliases ?? base.aliases;
  return buildSubQ({
    id: base.id,
    label: replacement.label,
    query: replacement.query || base.query,
    reason: replacement.reason ?? base.reason,
    selected: base.selected,
    source: base.source,
    explorationType: replacement.explorationType ?? base.explorationType,
    aliases: keepAliases,
    hitCount: base.hitCount,
    hitSamples: base.hitSamples,
    searchError: base.searchError,
    facetId: base.facetId ?? replacement.facetId,
    facetLabel: base.facetLabel ?? replacement.facetLabel,
  });
}

// --- inline buildFacet (verbatim) -------------------------------------
function buildFacet(input) {
  const rawCat = String(input.category ?? '').trim().toLowerCase();
  const category = ALLOWED_FACET_CATEGORIES.has(rawCat) ? rawCat : 'method';
  return {
    id: String(input.id ?? '').trim().slice(0, 64),
    label: String(input.label ?? '').trim().slice(0, 60),
    category: category in FACET_CATEGORY_LABELS ? category : 'method',
    note: clampText(input.note, 180),
  };
}

// --- inline computeFacetCoverage (verbatim) ----------------------------
function computeFacetCoverage(facets, subqs) {
  const facetIds = new Set(facets.map((f) => f.id));
  const countByFacet = new Map();
  const unassignedSubqIds = [];
  for (const sq of subqs) {
    if (sq.facetId && facetIds.has(sq.facetId)) {
      countByFacet.set(sq.facetId, (countByFacet.get(sq.facetId) ?? 0) + 1);
    } else {
      unassignedSubqIds.push(sq.id);
    }
  }
  const uncoveredFacetIds = [];
  const redundantFacetIds = [];
  for (const f of facets) {
    const n = countByFacet.get(f.id) ?? 0;
    if (n === 0) uncoveredFacetIds.push(f.id);
    else if (n > 1) redundantFacetIds.push(f.id);
  }
  return { uncoveredFacetIds, redundantFacetIds, unassignedSubqIds };
}

// ============== TESTS ==============

// ---------- buildSubQ ----------
test('buildSubQ: 最小合法 input', () => {
  const r = buildSubQ({ id: 'q1', label: 'foo', query: 'rl', reason: 'r' });
  assert.equal(r.id, 'q1');
  assert.equal(r.label, 'foo');
  assert.equal(r.query, 'rl');
  assert.equal(r.reason, 'r');
  assert.equal(r.selected, true);
});

test('buildSubQ: selected 显式 false', () => {
  const r = buildSubQ({ id: 'q1', label: 'l', query: 'q', reason: 'r', selected: false });
  assert.equal(r.selected, false);
});

test('buildSubQ: label 截前 60 char', () => {
  const r = buildSubQ({ id: 'q1', label: 'a'.repeat(100), query: 'q', reason: 'r' });
  assert.equal(r.label.length, 60);
});

test('buildSubQ: explorationType 非法 → undefined', () => {
  const r = buildSubQ({
    id: 'q1', label: 'l', query: 'q', reason: 'r',
    explorationType: 'invalid',
  });
  assert.equal(r.explorationType, undefined);
});

test('buildSubQ: explorationType cross_domain', () => {
  const r = buildSubQ({
    id: 'q1', label: 'l', query: 'q', reason: 'r',
    explorationType: 'cross_domain',
  });
  assert.equal(r.explorationType, 'cross_domain');
});

test('buildSubQ: aliases 经 normalizeAliases', () => {
  const r = buildSubQ({
    id: 'q1', label: 'l', query: 'rl', reason: 'r',
    aliases: ['reinforcement', 'RL', 'cv'],
  });
  // 'RL' lower == 'rl' (主 query) → 去掉
  assert.deepEqual(r.aliases, ['reinforcement', 'cv']);
});

test('buildSubQ: hitCount 非 number → undefined', () => {
  const r = buildSubQ({
    id: 'q1', label: 'l', query: 'q', reason: 'r',
    hitCount: '5',
  });
  assert.equal(r.hitCount, undefined);
});

test('buildSubQ: hitSamples 过滤非 string', () => {
  const r = buildSubQ({
    id: 'q1', label: 'l', query: 'q', reason: 'r',
    hitSamples: ['a', 123, null, 'b'],
  });
  assert.deepEqual(r.hitSamples, ['a', 'b']);
});

test('buildSubQ: searchError 空字符串 → undefined', () => {
  const r = buildSubQ({
    id: 'q1', label: 'l', query: 'q', reason: 'r',
    searchError: '',
  });
  assert.equal(r.searchError, undefined);
});

test('buildSubQ: searchError 非空 → 保留', () => {
  const r = buildSubQ({
    id: 'q1', label: 'l', query: 'q', reason: 'r',
    searchError: 'arxiv timeout',
  });
  assert.equal(r.searchError, 'arxiv timeout');
});

test('buildSubQ: facetId 空 → undefined', () => {
  const r = buildSubQ({
    id: 'q1', label: 'l', query: 'q', reason: 'r',
    facetId: '',
  });
  assert.equal(r.facetId, undefined);
});

test('buildSubQ: facetLabel 截前 60', () => {
  const r = buildSubQ({
    id: 'q1', label: 'l', query: 'q', reason: 'r',
    facetLabel: 'x'.repeat(100),
  });
  assert.equal(r.facetLabel.length, 60);
});

// ---------- buildRegenSubQ ----------
test('buildRegenSubQ: label/query/reason 用 replacement', () => {
  const base = { id: 'q1', label: 'old', query: 'old-q', reason: 'old-r', selected: true };
  const repl = { id: 'q1', label: 'new', query: 'new-q', reason: 'new-r', selected: true };
  const r = buildRegenSubQ({ base, replacement: repl });
  assert.equal(r.label, 'new');
  assert.equal(r.query, 'new-q');
  assert.equal(r.reason, 'new-r');
});

test('buildRegenSubQ: 保留 base.aliases (用户手动改的)', () => {
  const base = { id: 'q1', label: 'l', query: 'q', reason: 'r', selected: true, aliases: ['manual'] };
  const repl = { id: 'q1', label: 'l', query: 'q', reason: 'r', selected: true, aliases: ['auto'] };
  const r = buildRegenSubQ({ base, replacement: repl });
  assert.deepEqual(r.aliases, ['manual']);
});

test('buildRegenSubQ: base.aliases 空 → 用 replacement.aliases', () => {
  const base = { id: 'q1', label: 'l', query: 'q', reason: 'r', selected: true };
  const repl = { id: 'q1', label: 'l', query: 'q', reason: 'r', selected: true, aliases: ['auto'] };
  const r = buildRegenSubQ({ base, replacement: repl });
  assert.deepEqual(r.aliases, ['auto']);
});

test('buildRegenSubQ: selected 来自 base (不被 LLM 覆盖)', () => {
  const base = { id: 'q1', label: 'l', query: 'q', reason: 'r', selected: false };
  const repl = { id: 'q1', label: 'l', query: 'q', reason: 'r', selected: true };
  const r = buildRegenSubQ({ base, replacement: repl });
  assert.equal(r.selected, false);
});

test('buildRegenSubQ: facetId 优先 base', () => {
  const base = { id: 'q1', label: 'l', query: 'q', reason: 'r', selected: true, facetId: 'f-base' };
  const repl = { id: 'q1', label: 'l', query: 'q', reason: 'r', selected: true, facetId: 'f-new' };
  const r = buildRegenSubQ({ base, replacement: repl });
  assert.equal(r.facetId, 'f-base');
});

// ---------- buildFacet ----------
test('buildFacet: 最小 input', () => {
  const r = buildFacet({ id: 'f1', label: 'foo' });
  assert.equal(r.id, 'f1');
  assert.equal(r.label, 'foo');
  assert.equal(r.category, 'method');
});

test('buildFacet: 合法 category', () => {
  const r = buildFacet({ id: 'f1', label: 'l', category: 'data_task' });
  assert.equal(r.category, 'data_task');
});

test('buildFacet: 非法 category → method', () => {
  const r = buildFacet({ id: 'f1', label: 'l', category: 'unknown' });
  assert.equal(r.category, 'method');
});

test('buildFacet: id/label 截断', () => {
  const r = buildFacet({ id: 'x'.repeat(100), label: 'y'.repeat(100) });
  assert.equal(r.id.length, 64);
  assert.equal(r.label.length, 60);
});

test('buildFacet: note clampText (180)', () => {
  const r = buildFacet({ id: 'f', label: 'l', note: 'a'.repeat(200) });
  assert.ok(r.note.length <= 181);
  assert.ok(r.note.endsWith('…'));
});

test('buildFacet: id 空白 → ""', () => {
  const r = buildFacet({ id: '   ', label: 'l' });
  assert.equal(r.id, '');
});

// ---------- computeFacetCoverage ----------
test('computeFacetCoverage: 空 → 三空数组', () => {
  const r = computeFacetCoverage([], []);
  assert.deepEqual(r, {
    uncoveredFacetIds: [],
    redundantFacetIds: [],
    unassignedSubqIds: [],
  });
});

test('computeFacetCoverage: facet 没 subq 归属 → uncovered', () => {
  const facets = [{ id: 'f1', label: 'F1', category: 'method', note: '' }];
  const subqs = [{ id: 'q1', label: 'l', query: 'q', reason: 'r', selected: true }];
  const r = computeFacetCoverage(facets, subqs);
  assert.deepEqual(r.uncoveredFacetIds, ['f1']);
  assert.deepEqual(r.unassignedSubqIds, ['q1']);
});

test('computeFacetCoverage: facet 多 subq → redundant', () => {
  const facets = [{ id: 'f1', label: 'F1', category: 'method', note: '' }];
  const subqs = [
    { id: 'q1', label: 'l', query: 'q', reason: 'r', selected: true, facetId: 'f1' },
    { id: 'q2', label: 'l', query: 'q', reason: 'r', selected: true, facetId: 'f1' },
  ];
  const r = computeFacetCoverage(facets, subqs);
  assert.deepEqual(r.redundantFacetIds, ['f1']);
});

test('computeFacetCoverage: subq.facetId 非法 → unassigned', () => {
  const facets = [{ id: 'f1', label: 'F1', category: 'method', note: '' }];
  const subqs = [
    { id: 'q1', label: 'l', query: 'q', reason: 'r', selected: true, facetId: 'f-bad' },
  ];
  const r = computeFacetCoverage(facets, subqs);
  assert.deepEqual(r.unassignedSubqIds, ['q1']);
});

test('computeFacetCoverage: 全部正确归属 → 三空', () => {
  const facets = [
    { id: 'f1', label: 'F1', category: 'method', note: '' },
    { id: 'f2', label: 'F2', category: 'data_task', note: '' },
  ];
  const subqs = [
    { id: 'q1', label: 'l', query: 'q', reason: 'r', selected: true, facetId: 'f1' },
    { id: 'q2', label: 'l', query: 'q', reason: 'r', selected: true, facetId: 'f2' },
  ];
  const r = computeFacetCoverage(facets, subqs);
  assert.deepEqual(r.uncoveredFacetIds, []);
  assert.deepEqual(r.redundantFacetIds, []);
  assert.deepEqual(r.unassignedSubqIds, []);
});

test('computeFacetCoverage: 混合 uncovered + redundant + unassigned', () => {
  const facets = [
    { id: 'f1', label: 'F1', category: 'method', note: '' },
    { id: 'f2', label: 'F2', category: 'data_task', note: '' },
    { id: 'f3', label: 'F3', category: 'structure_property', note: '' },
  ];
  const subqs = [
    { id: 'q1', label: 'l', query: 'q', reason: 'r', selected: true, facetId: 'f1' },
    { id: 'q2', label: 'l', query: 'q', reason: 'r', selected: true, facetId: 'f1' },
    { id: 'q3', label: 'l', query: 'q', reason: 'r', selected: true, facetId: 'f-bad' },
  ];
  const r = computeFacetCoverage(facets, subqs);
  assert.deepEqual(r.uncoveredFacetIds.sort(), ['f2', 'f3']);
  assert.deepEqual(r.redundantFacetIds, ['f1']);
  assert.deepEqual(r.unassignedSubqIds, ['q3']);
});
