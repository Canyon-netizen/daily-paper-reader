#!/usr/bin/env node
// astro-src/scripts/experiments-cross-link.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/cross-link.ts.
// linkExperimentToIdea / unlinkExperiment / getLinkedIdea / getLinkedExperiments /
// getAllLinkedIdeas / clearAllLinks — bidirectional experiment ↔ idea 链接,
// 用 localStorage mock 注入。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

// ---------- localStorage mock BEFORE loading module ----------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
};

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

const mod = await loadTs('lib/experiments/cross-link.ts');
const {
  linkExperimentToIdea,
  unlinkExperiment,
  getLinkedIdea,
  getLinkedExperiments,
  getAllLinkedIdeas,
  clearAllLinks,
} = mod;

const reset = () => {
  store.clear();
  clearAllLinks();
};

// ---------- linkExperimentToIdea ----------
test('linkExperimentToIdea: 首次链接 → true', () => {
  reset();
  assert.equal(linkExperimentToIdea('e1', 'i1'), true);
  assert.equal(getLinkedIdea('e1'), 'i1');
});

test('linkExperimentToIdea: 同步更新反向索引', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  assert.deepEqual(getLinkedExperiments('i1'), ['e1']);
});

test('linkExperimentToIdea: 重复链接同 ideaId → 不重复 push', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  linkExperimentToIdea('e1', 'i1');
  assert.deepEqual(getLinkedExperiments('i1'), ['e1']);
});

test('linkExperimentToIdea: 同一 experiment 换 idea → 反向索引迁移', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  linkExperimentToIdea('e1', 'i2');
  // experiment1 现在指向 i2
  assert.equal(getLinkedIdea('e1'), 'i2');
  // i1 的反向索引应清空 (空数组被删)
  assert.equal(getLinkedExperiments('i1').length, 0);
  // i2 的反向索引含 e1
  assert.deepEqual(getLinkedExperiments('i2'), ['e1']);
});

test('linkExperimentToIdea: 同一 idea 链接多个 experiments', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  linkExperimentToIdea('e2', 'i1');
  linkExperimentToIdea('e3', 'i1');
  assert.deepEqual(getLinkedExperiments('i1'), ['e1', 'e2', 'e3']);
});

test('linkExperimentToIdea: 不同 idea 不同 experiments', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  linkExperimentToIdea('e2', 'i2');
  assert.equal(getLinkedIdea('e1'), 'i1');
  assert.equal(getLinkedIdea('e2'), 'i2');
  assert.deepEqual(getLinkedExperiments('i1'), ['e1']);
  assert.deepEqual(getLinkedExperiments('i2'), ['e2']);
});

// ---------- unlinkExperiment ----------
test('unlinkExperiment: 已存在链接 → true', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  assert.equal(unlinkExperiment('e1', 'i1'), true);
  assert.equal(getLinkedIdea('e1'), null);
});

test('unlinkExperiment: 反向索引也清掉', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  unlinkExperiment('e1', 'i1');
  assert.deepEqual(getLinkedExperiments('i1'), []);
});

test('unlinkExperiment: 不存在的 link → false', () => {
  reset();
  // 没有任何链接
  assert.equal(unlinkExperiment('e1', 'i1'), false);
});

test('unlinkExperiment: experiment 链接到不同 idea → false', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  // e1 实际指向 i1,但传 i2
  assert.equal(unlinkExperiment('e1', 'i2'), false);
  // e1 仍然指向 i1
  assert.equal(getLinkedIdea('e1'), 'i1');
});

test('unlinkExperiment: 部分 idea 反向索引保留', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  linkExperimentToIdea('e2', 'i1');
  unlinkExperiment('e1', 'i1');
  assert.deepEqual(getLinkedExperiments('i1'), ['e2']);
});

// ---------- getLinkedIdea ----------
test('getLinkedIdea: 未链接 → null', () => {
  reset();
  assert.equal(getLinkedIdea('e-none'), null);
});

test('getLinkedIdea: 已链接 → ideaId', () => {
  reset();
  linkExperimentToIdea('e1', 'i-abc');
  assert.equal(getLinkedIdea('e1'), 'i-abc');
});

// ---------- getLinkedExperiments ----------
test('getLinkedExperiments: 无 → []', () => {
  reset();
  assert.deepEqual(getLinkedExperiments('i-none'), []);
});

test('getLinkedExperiments: 多个 → 数组', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  linkExperimentToIdea('e2', 'i1');
  linkExperimentToIdea('e3', 'i1');
  assert.deepEqual(getLinkedExperiments('i1'), ['e1', 'e2', 'e3']);
});

// ---------- getAllLinkedIdeas ----------
test('getAllLinkedIdeas: 空 → []', () => {
  reset();
  assert.deepEqual(getAllLinkedIdeas(), []);
});

test('getAllLinkedIdeas: 含多个 idea', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  linkExperimentToIdea('e2', 'i2');
  linkExperimentToIdea('e3', 'i1');
  const all = getAllLinkedIdeas().sort();
  assert.deepEqual(all, ['i1', 'i2']);
});

test('getAllLinkedIdeas: 全部清空后 → []', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  unlinkExperiment('e1', 'i1');
  assert.deepEqual(getAllLinkedIdeas(), []);
});

// ---------- clearAllLinks ----------
test('clearAllLinks: 清空所有链接', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  linkExperimentToIdea('e2', 'i2');
  clearAllLinks();
  assert.equal(getLinkedIdea('e1'), null);
  assert.equal(getLinkedIdea('e2'), null);
  assert.deepEqual(getAllLinkedIdeas(), []);
});

test('clearAllLinks: 清空后再链接 → 正常', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  clearAllLinks();
  linkExperimentToIdea('e2', 'i2');
  assert.equal(getLinkedIdea('e1'), null);
  assert.equal(getLinkedIdea('e2'), 'i2');
});

// ---------- 持久化 (localStorage) ---
test('cross-link: 链接写入 localStorage', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  const raw = store.get('dpr_experiment_idea_links_v1');
  assert.ok(typeof raw === 'string');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.experimentToIdea.e1, 'i1');
  assert.deepEqual(parsed.ideaToExperiments.i1, ['e1']);
});

// ---------- 损坏 JSON → fallback ---
test('cross-link: 损坏 JSON → 默认空链接', () => {
  store.set('dpr_experiment_idea_links_v1', '{not valid json');
  // 损坏时 getStorage 返回默认空对象
  assert.equal(getLinkedIdea('e1'), null);
  assert.deepEqual(getLinkedExperiments('i1'), []);
});

// ---------- 集成 ---
test('cross-link: 完整生命周期 link → unlink → link → clearAll', () => {
  reset();
  linkExperimentToIdea('e1', 'i1');
  assert.equal(getLinkedIdea('e1'), 'i1');
  unlinkExperiment('e1', 'i1');
  assert.equal(getLinkedIdea('e1'), null);
  linkExperimentToIdea('e1', 'i2');
  assert.equal(getLinkedIdea('e1'), 'i2');
  clearAllLinks();
  assert.equal(getLinkedIdea('e1'), null);
});