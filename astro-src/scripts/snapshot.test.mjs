#!/usr/bin/env node
// astro-src/scripts/snapshot.test.mjs
//
// Tests for R7 I.2.3 snapshot utilities.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlinkSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(__dirname, '__snapshots__');

// 确保目录存在
if (!existsSync(SNAPSHOT_DIR)) {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

async function loadTs(relPath) {
  const result = await await import('esbuild').then((esbuild) =>
    esbuild.build({
      entryPoints: [join(__dirname, '..', relPath)],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      write: false,
      target: 'es2022',
    }),
  );
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/test-utils/snapshot.ts');
const { assertSnapshot, serializeForSnapshot, listSnapshots, deleteSnapshot } = mod;

// 清理函数
function cleanup(name) {
  const path = join(SNAPSHOT_DIR, `${name}.json`);
  if (existsSync(path)) unlinkSync(path);
}

test('serializeForSnapshot: stable ordering', () => {
  const obj = { z: 1, a: 2, m: 3 };
  const ser1 = serializeForSnapshot(obj);
  const ser2 = serializeForSnapshot(obj);
  assert.equal(ser1, ser2);
  assert.match(ser1, /"a": 2/);
  assert.match(ser1, /"m": 3/);
  assert.match(ser1, /"z": 1/);
  // keys should be sorted
  assert.ok(ser1.indexOf('"a"') < ser1.indexOf('"m"'));
  assert.ok(ser1.indexOf('"m"') < ser1.indexOf('"z"'));
});

test('assertSnapshot: creates new snapshot on first run', () => {
  const name = 'test-first-run';
  cleanup(name);

  const result = assertSnapshot(name, { foo: 'bar' });
  assert.equal(result.passed, true);
  assert.ok(result.message.includes('created'));

  // cleanup
  cleanup(name);
});

test('assertSnapshot: matches existing snapshot', () => {
  const name = 'test-match';
  cleanup(name);

  // create
  assertSnapshot(name, { hello: 'world' }, { update: true });

  // match
  const result = assertSnapshot(name, { hello: 'world' });
  assert.equal(result.passed, true);
  assert.ok(result.message.includes('matched'));

  // cleanup
  cleanup(name);
});

test('assertSnapshot: fails on mismatch', () => {
  const name = 'test-mismatch';
  cleanup(name);

  // create
  assertSnapshot(name, { hello: 'world' }, { update: true });

  // mismatch
  const result = assertSnapshot(name, { hello: 'different' });
  assert.equal(result.passed, false);
  assert.ok(result.message.includes('mismatch'));

  // cleanup
  cleanup(name);
});

test('assertSnapshot: update flag overwrites', () => {
  const name = 'test-update';
  cleanup(name);

  // create
  assertSnapshot(name, { v: 1 }, { update: true });
  // update
  const result = assertSnapshot(name, { v: 2 }, { update: true });
  assert.equal(result.passed, true);
  assert.ok(result.message.includes('updated'));

  // cleanup
  cleanup(name);
});

test('listSnapshots: returns array of snapshot names', () => {
  const name1 = 'test-list-1';
  const name2 = 'test-list-2';
  cleanup(name1);
  cleanup(name2);

  assertSnapshot(name1, { x: 1 }, { update: true });
  assertSnapshot(name2, { y: 2 }, { update: true });

  const list = listSnapshots();
  assert.ok(Array.isArray(list));
  assert.ok(list.includes(name1));
  assert.ok(list.includes(name2));

  // cleanup
  cleanup(name1);
  cleanup(name2);
});

test('deleteSnapshot: removes snapshot file', () => {
  const name = 'test-delete';
  cleanup(name);

  assertSnapshot(name, { toDelete: true }, { update: true });
  assert.ok(existsSync(join(SNAPSHOT_DIR, `${name}.json`)));

  deleteSnapshot(name);
  assert.ok(!existsSync(join(SNAPSHOT_DIR, `${name}.json`)));
});
