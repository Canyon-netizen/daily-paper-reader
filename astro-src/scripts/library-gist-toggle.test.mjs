#!/usr/bin/env node
// astro-src/scripts/library-gist-toggle.test.mjs
//
// Tests for D.1.5 per-library Gist sync helpers in astro-src/lib/user-libraries/gist.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTsModule(relPath) {
  // bundle so that relative imports (../arxiv, ./store) resolve
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    external: [],
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTsModule('lib/user-libraries/gist.ts');
const {
  serializeLibraryForGist,
  mergeLibraryFromGist,
  getLibraryGistEnabled,
  setLibraryGistEnabled,
  getLibraryGistId,
  setLibraryGistId,
} = mod;

const baseLib = {
  id: 'lib-1',
  name: 'Test',
  statement: 's',
  hue: 'cyan',
  paperIds: ['2401.01234'],
  categories: [],
  inclusionKeywords: [],
  exclusionKeywords: [],
  rubric: [],
  papers: {},
  conceptOverrides: {},
  createdAt: 1000,
  updatedAt: 2000,
};

const baseDoc = {
  schemaVersion: 5,
  libraries: { 'lib-1': baseLib },
};

// ----- serializeLibraryForGist -----

test('serializeLibraryForGist: extracts single lib block', () => {
  const block = serializeLibraryForGist(baseDoc, 'lib-1');
  assert.ok(block);
  // schemaVersion is whatever USER_LIBRARIES_SCHEMA_VERSION is (currently 5)
  assert.ok([2, 5].includes(block.schemaVersion), `unexpected ${block.schemaVersion}`);
  assert.deepEqual(Object.keys(block.items), ['lib-1']);
});

test('serializeLibraryForGist: returns null for missing lib', () => {
  const block = serializeLibraryForGist(baseDoc, 'lib-missing');
  assert.equal(block, null);
});

// ----- mergeLibraryFromGist -----

test('mergeLibraryFromGist: adds new lib', () => {
  const block = {
    schemaVersion: 5,
    items: {
      'lib-2': { ...baseLib, id: 'lib-2', name: 'New', updatedAt: 500 },
    },
  };
  const { merged, wasNew } = mergeLibraryFromGist(baseDoc, block);
  assert.equal(wasNew, true);
  assert.ok(merged.libraries['lib-2']);
  assert.ok(merged.libraries['lib-1']);  // 旧的仍在
});

test('mergeLibraryFromGist: skips if local newer', () => {
  const block = {
    schemaVersion: 5,
    items: { 'lib-1': { ...baseLib, name: 'Stale', updatedAt: 100 } }, // older
  };
  const { merged, wasNew } = mergeLibraryFromGist(baseDoc, block);
  assert.equal(wasNew, false);
  assert.equal(merged.libraries['lib-1'].name, 'Test');  // kept local
});

test('mergeLibraryFromGist: overwrites if remote newer', () => {
  const block = {
    schemaVersion: 5,
    items: { 'lib-1': { ...baseLib, name: 'Newer', updatedAt: 9999 } },
  };
  const { merged } = mergeLibraryFromGist(baseDoc, block);
  assert.equal(merged.libraries['lib-1'].name, 'Newer');
});

test('mergeLibraryFromGist: empty block is no-op', () => {
  const block = { schemaVersion: 5, items: {} };
  const { merged, wasNew } = mergeLibraryFromGist(baseDoc, block);
  assert.equal(wasNew, false);
  assert.deepEqual(merged.libraries, baseDoc.libraries);
});

// ----- localStorage helpers -----

const HAS_LS = typeof globalThis.localStorage !== 'undefined';

test('localStorage: gist enabled toggle round-trip', { skip: !HAS_LS }, () => {
  const libId = `test-${Date.now()}-${Math.random()}`;
  assert.equal(getLibraryGistEnabled(libId), false);
  setLibraryGistEnabled(libId, true);
  assert.equal(getLibraryGistEnabled(libId), true);
  setLibraryGistEnabled(libId, false);
  assert.equal(getLibraryGistEnabled(libId), false);
});

test('localStorage: gist id round-trip', { skip: !HAS_LS }, () => {
  const libId = `test-id-${Date.now()}`;
  assert.equal(getLibraryGistId(libId), null);
  setLibraryGistId(libId, 'abc123def');
  assert.equal(getLibraryGistId(libId), 'abc123def');
  setLibraryGistId(libId, null);
  assert.equal(getLibraryGistId(libId), null);
});

test('localStorage: enabled/id are independent keys', { skip: !HAS_LS }, () => {
  const libId = `test-indep-${Date.now()}`;
  setLibraryGistEnabled(libId, true);
  setLibraryGistId(libId, 'gist-xyz');
  assert.equal(getLibraryGistEnabled(libId), true);
  assert.equal(getLibraryGistId(libId), 'gist-xyz');
  setLibraryGistEnabled(libId, false);
  // enabling off doesn't clear the gist id
  assert.equal(getLibraryGistId(libId), 'gist-xyz');
  // cleanup
  setLibraryGistId(libId, null);
});

// 验证 fallback 在没有 localStorage 的环境里也安全
test('localStorage helpers are no-op without storage', () => {
  // 临时把 localStorage 替换为抛错对象
  const orig = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => { throw new Error('no LS'); }, setItem: () => { throw new Error('no LS'); }, removeItem: () => { throw new Error('no LS'); } },
    configurable: true,
  });
  try {
    const libId = 'no-ls-test';
    assert.equal(getLibraryGistEnabled(libId), false);
    assert.equal(getLibraryGistId(libId), null);
    setLibraryGistEnabled(libId, true);  // 不抛
    setLibraryGistId(libId, 'x');        // 不抛
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: orig, configurable: true });
  }
});