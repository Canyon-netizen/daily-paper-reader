#!/usr/bin/env node
// astro-src/scripts/snapshot.test.mjs
//
// Tests for R7 I.2.3 snapshot utilities.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(__dirname, '__snapshots__');

// 确保目录存在
if (!existsSync(SNAPSHOT_DIR)) {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

// ----- inline implementation -----

function getSnapshotPath(name) {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
  return join(SNAPSHOT_DIR, `${safeName}.json`);
}

function serializeForSnapshot(value) {
  return JSON.stringify(value, Object.keys(value).sort(), 2);
}

function readSnapshot(name) {
  const path = getSnapshotPath(name);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function writeSnapshot(name, value) {
  if (!existsSync(SNAPSHOT_DIR)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
  const path = getSnapshotPath(name);
  writeFileSync(path, value, 'utf-8');
}

function assertSnapshot(name, value, opts = {}) {
  const serialized = serializeForSnapshot(value);
  const existing = readSnapshot(name);

  if (opts.update) {
    writeSnapshot(name, serialized);
    return { passed: true, message: `Snapshot updated: ${name}` };
  }

  if (existing === null) {
    writeSnapshot(name, serialized);
    return { passed: true, message: `Snapshot created: ${name}` };
  }

  if (serialized === existing) {
    return { passed: true, message: `Snapshot matched: ${name}` };
  }

  return {
    passed: false,
    message: `Snapshot mismatch: ${name}\nExpected:\n${existing}\n\nActual:\n${serialized}`,
  };
}

function listSnapshots() {
  if (!existsSync(SNAPSHOT_DIR)) return [];
  try {
    return readdirSync(SNAPSHOT_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  } catch {
    return [];
  }
}

function deleteSnapshot(name) {
  const path = getSnapshotPath(name);
  try {
    unlinkSync(path);
  } catch {
    // ignore
  }
}

// ----- tests -----

function cleanup(name) {
  const path = getSnapshotPath(name);
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
  assert.ok(ser1.indexOf('"a"') < ser1.indexOf('"m"'));
  assert.ok(ser1.indexOf('"m"') < ser1.indexOf('"z"'));
});

test('assertSnapshot: creates new snapshot on first run', () => {
  const name = 'test-first-run';
  cleanup(name);

  const result = assertSnapshot(name, { foo: 'bar' });
  assert.equal(result.passed, true);
  assert.ok(result.message.includes('created'));

  cleanup(name);
});

test('assertSnapshot: matches existing snapshot', () => {
  const name = 'test-match';
  cleanup(name);

  assertSnapshot(name, { hello: 'world' }, { update: true });
  const result = assertSnapshot(name, { hello: 'world' });
  assert.equal(result.passed, true);
  assert.ok(result.message.includes('matched'));

  cleanup(name);
});

test('assertSnapshot: fails on mismatch', () => {
  const name = 'test-mismatch';
  cleanup(name);

  assertSnapshot(name, { hello: 'world' }, { update: true });
  const result = assertSnapshot(name, { hello: 'different' });
  assert.equal(result.passed, false);
  assert.ok(result.message.includes('mismatch'));

  cleanup(name);
});

test('assertSnapshot: update flag overwrites', () => {
  const name = 'test-update';
  cleanup(name);

  assertSnapshot(name, { v: 1 }, { update: true });
  const result = assertSnapshot(name, { v: 2 }, { update: true });
  assert.equal(result.passed, true);
  assert.ok(result.message.includes('updated'));

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

  cleanup(name1);
  cleanup(name2);
});

test('deleteSnapshot: removes snapshot file', () => {
  const name = 'test-delete';
  cleanup(name);

  assertSnapshot(name, { toDelete: true }, { update: true });
  assert.ok(existsSync(getSnapshotPath(name)));

  deleteSnapshot(name);
  assert.ok(!existsSync(getSnapshotPath(name)));
});
