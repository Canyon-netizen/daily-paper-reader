#!/usr/bin/env node
// astro-src/scripts/audience-profiles.test.mjs
//
// Tests for R7 polish: astro-src/lib/library/audience-profiles.ts audience profile helpers.

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

const mod = await loadTs('lib/library/audience-profiles.ts');
const {
  AUDIENCE_PROFILES,
  AUDIENCE_PROFILE_IDS,
  getAudienceProfile,
  suggestAudienceProfile,
  buildAudiencePromptAddendum,
  resolveLibraryThreshold,
} = mod;

test('AUDIENCE_PROFILES: 4 个 profile', () => {
  const keys = Object.keys(AUDIENCE_PROFILES);
  assert.ok(keys.includes('novice'));
  assert.ok(keys.includes('expert'));
  assert.ok(keys.includes('reviewer'));
  assert.ok(keys.includes('practitioner'));
});

test('AUDIENCE_PROFILES: 每个 profile 有 label + axes + defaultThreshold', () => {
  for (const [id, p] of Object.entries(AUDIENCE_PROFILES)) {
    assert.ok(p.label && p.label.length > 0, `${id} 有 label`);
    assert.ok(Array.isArray(p.axes) && p.axes.length > 0, `${id} 有 axes`);
    assert.equal(typeof p.defaultThreshold, 'number', `${id} 有 defaultThreshold`);
  }
});

test('AUDIENCE_PROFILES: axes weight 之和 ≈ 1', () => {
  for (const [id, p] of Object.entries(AUDIENCE_PROFILES)) {
    const sum = p.axes.reduce((s, a) => s + a.weight, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.01, `${id} weight 总和 ≈ 1, got ${sum}`);
  }
});

test('AUDIENCE_PROFILE_IDS: 4 个 id', () => {
  assert.equal(AUDIENCE_PROFILE_IDS.length, 4);
});

test('getAudienceProfile: 找到', () => {
  const p = getAudienceProfile('novice');
  assert.ok(p);
  assert.equal(p.id, 'novice');
});

test('getAudienceProfile: 找不到 → null', () => {
  assert.equal(getAudienceProfile('unknown'), null);
  assert.equal(getAudienceProfile(''), null);
});

test('suggestAudienceProfile: 空输入 → null', () => {
  assert.equal(suggestAudienceProfile({}), null);
  assert.equal(suggestAudienceProfile({ statement: '' }), null);
  assert.equal(suggestAudienceProfile({ statement: '   ' }), null);
});

test('suggestAudienceProfile: 命中 reviewer(评审/基线)', () => {
  const id = suggestAudienceProfile({ statement: '基线对比 评审实验' });
  assert.equal(id, 'reviewer');
});

test('suggestAudienceProfile: 命中 practitioner(部署/工业)', () => {
  const id = suggestAudienceProfile({ statement: '工业部署 生产实践 延迟优化' });
  assert.equal(id, 'practitioner');
});

test('suggestAudienceProfile: 命中 novice(入门/科普)', () => {
  const id = suggestAudienceProfile({ statement: '入门教程 通俗易懂 基础知识' });
  assert.equal(id, 'novice');
});

test('suggestAudienceProfile: keywords 数组也参与', () => {
  const id = suggestAudienceProfile({ keywords: ['baseline', 'benchmark', 'reviewer'] });
  assert.equal(id, 'reviewer');
});

test('suggestAudienceProfile: 单信号不足 → null(<2 hits)', () => {
  // "基线" 1 hit → 不够
  assert.equal(suggestAudienceProfile({ statement: '基线对比' }), null);
});

test('suggestAudienceProfile: 大小写不敏感', () => {
  const id = suggestAudienceProfile({ statement: 'BENCHMARK BASELINE REVIEWER' });
  assert.equal(id, 'reviewer');
});

test('buildAudiencePromptAddendum: null → ""', () => {
  assert.equal(buildAudiencePromptAddendum(null), '');
});

test('buildAudiencePromptAddendum: 有效 profile', () => {
  const p = AUDIENCE_PROFILES.novice;
  const out = buildAudiencePromptAddendum(p);
  assert.ok(out.includes(p.label));
  assert.ok(out.includes(p.description));
  assert.ok(out.includes(String(p.defaultThreshold)));
  // axes 出现
  assert.ok(p.axes.every((a) => out.includes(a.name)));
});

test('resolveLibraryThreshold: 显式 userThreshold 优先', () => {
  const p = AUDIENCE_PROFILES.expert;
  const t = resolveLibraryThreshold({ profile: p, userThreshold: 0.8 });
  assert.equal(t, 0.8);
});

test('resolveLibraryThreshold: 缺省时用 profile.defaultThreshold', () => {
  const p = AUDIENCE_PROFILES.expert;
  const t = resolveLibraryThreshold({ profile: p, userThreshold: undefined });
  assert.equal(t, p.defaultThreshold);
});

test('resolveLibraryThreshold: 负 userThreshold 当作未设', () => {
  const p = AUDIENCE_PROFILES.expert;
  const t = resolveLibraryThreshold({ profile: p, userThreshold: -1 });
  assert.equal(t, p.defaultThreshold);
});

test('resolveLibraryThreshold: profile + undefined userThreshold 兜底 0.5', () => {
  const t = resolveLibraryThreshold({ profile: null, userThreshold: undefined });
  assert.equal(t, 0.5);
});