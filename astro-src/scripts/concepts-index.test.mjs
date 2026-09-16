#!/usr/bin/env node
// astro-src/scripts/concepts-index.test.mjs
//
// Tests for R7 polish: astro-src/lib/concepts-index.ts normalizeConceptList.
// 不能直接 esbuild load — 链上 js-yaml (externalize 失败 in data URL) +
// concept-disk.mjs (node:fs)。inline 算法,源做参考。

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- inline normalizeConceptList (lib/concepts-index.ts:39) -----------
function normalizeConceptList(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      arr = JSON.parse(s);
    } catch {
      try {
        arr = JSON.parse(s.replace(/\\"/g, '"'));
      } catch {
        return [];
      }
    }
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const obj = item;
    const slug = typeof obj.slug === 'string' ? obj.slug.trim() : '';
    const displayName = typeof obj.display_name === 'string' ? obj.display_name.trim() : '';
    if (!slug || !displayName) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    const category = typeof obj.category === 'string' ? obj.category.trim() : 'other';
    const novelty = typeof obj.novelty === 'number' && Number.isFinite(obj.novelty) ? obj.novelty : undefined;
    const centrality = typeof obj.centrality === 'number' && Number.isFinite(obj.centrality) ? obj.centrality : undefined;
    out.push({
      slug,
      display_name: displayName,
      category,
      novelty,
      centrality,
    });
  }
  return out;
}

test('normalizeConceptList: null → []', () => {
  assert.deepEqual(normalizeConceptList(null), []);
  assert.deepEqual(normalizeConceptList(undefined), []);
});

test('normalizeConceptList: 空字符串 → []', () => {
  assert.deepEqual(normalizeConceptList(''), []);
  assert.deepEqual(normalizeConceptList('   '), []);
});

test('normalizeConceptList: 非数组 → []', () => {
  assert.deepEqual(normalizeConceptList({}), []);
  assert.deepEqual(normalizeConceptList(123), []);
});

test('normalizeConceptList: 标准 list 输入', () => {
  const r = normalizeConceptList([
    { slug: 'rl', display_name: 'Reinforcement Learning', category: 'method', novelty: 0.8, centrality: 0.5 },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].slug, 'rl');
  assert.equal(r[0].display_name, 'Reinforcement Learning');
  assert.equal(r[0].category, 'method');
  assert.equal(r[0].novelty, 0.8);
  assert.equal(r[0].centrality, 0.5);
});

test('normalizeConceptList: JSON 字符串输入', () => {
  const r = normalizeConceptList(JSON.stringify([
    { slug: 'cv', display_name: 'CV' },
  ]));
  assert.equal(r.length, 1);
  assert.equal(r[0].slug, 'cv');
});

test('normalizeConceptList: invalid JSON → []', () => {
  assert.deepEqual(normalizeConceptList('not json'), []);
});

test('normalizeConceptList: 缺 slug → 跳过', () => {
  const r = normalizeConceptList([{ display_name: 'X' }]);
  assert.deepEqual(r, []);
});

test('normalizeConceptList: 缺 display_name → 跳过', () => {
  const r = normalizeConceptList([{ slug: 'x' }]);
  assert.deepEqual(r, []);
});

test('normalizeConceptList: 空 slug → 跳过', () => {
  const r = normalizeConceptList([{ slug: '   ', display_name: 'X' }]);
  assert.deepEqual(r, []);
});

test('normalizeConceptList: 同 paper 内重复 slug 去重', () => {
  const r = normalizeConceptList([
    { slug: 'rl', display_name: 'RL' },
    { slug: 'rl', display_name: 'RL v2' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].display_name, 'RL');
});

test('normalizeConceptList: novelty 非 number → undefined', () => {
  const r = normalizeConceptList([{ slug: 'a', display_name: 'A', novelty: '0.5' }]);
  assert.equal(r[0].novelty, undefined);
});

test('normalizeConceptList: novelty NaN → undefined', () => {
  const r = normalizeConceptList([{ slug: 'a', display_name: 'A', novelty: NaN }]);
  assert.equal(r[0].novelty, undefined);
});

test('normalizeConceptList: category 缺 → other', () => {
  const r = normalizeConceptList([{ slug: 'a', display_name: 'A' }]);
  assert.equal(r[0].category, 'other');
});

test('normalizeConceptList: category 空白 → 空字符串 (不 fallback)', () => {
  // source: 单纯 trim,空字符串 → '' 而非 'other'
  const r = normalizeConceptList([{ slug: 'a', display_name: 'A', category: '   ' }]);
  assert.equal(r[0].category, '');
});

test('normalizeConceptList: centrality Infinity → undefined', () => {
  const r = normalizeConceptList([{ slug: 'a', display_name: 'A', centrality: Infinity }]);
  assert.equal(r[0].centrality, undefined);
});

test('normalizeConceptList: slug/displayName 裁剪空白', () => {
  const r = normalizeConceptList([{ slug: '  rl  ', display_name: '  RL  ' }]);
  assert.equal(r[0].slug, 'rl');
  assert.equal(r[0].display_name, 'RL');
});

test('normalizeConceptList: 数组中含非对象 → 跳过', () => {
  const r = normalizeConceptList([
    null,
    'string',
    123,
    { slug: 'a', display_name: 'A' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].slug, 'a');
});

test('normalizeConceptList: JSON 二次尝试 (转义)', () => {
  // 转义后字符串解析为 [{"slug":"a","display_name":"A"}]
  const escaped = String.raw`[{\"slug\":\"a\",\"display_name\":\"A\"}]`;
  const r = normalizeConceptList(escaped);
  assert.equal(r.length, 1);
  assert.equal(r[0].slug, 'a');
});
