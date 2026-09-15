#!/usr/bin/env node
// astro-src/scripts/idea-status.test.mjs
//
// Tests for R7 E.1.2 (saveIdeaVersion) + E.1.3 (status transitions).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load multiple TS modules into one bundle to share types and avoid CJS issues
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

const types = await loadTs('lib/ideas/types.ts');
const idx = await loadTs('lib/ideas/index.ts');

const { IDEA_STATUS_TRANSITIONS, canTransitionIdeaStatus, createIdeaData } = types;
const { saveIdeaVersion, transitionIdeaStatus, nextStatusesFor } = idx;

// ----- E.1.3: transition map -----

test('IDEA_STATUS_TRANSITIONS: covers all 4 statuses', () => {
  for (const s of ['draft', 'active', 'promoted', 'archived']) {
    assert.ok(Array.isArray(IDEA_STATUS_TRANSITIONS[s]), `missing ${s}`);
  }
});

test('IDEA_STATUS_TRANSITIONS: draft cannot jump to promoted', () => {
  assert.ok(!IDEA_STATUS_TRANSITIONS.draft.includes('promoted'));
});

test('IDEA_STATUS_TRANSITIONS: promoted can revert to active', () => {
  assert.ok(IDEA_STATUS_TRANSITIONS.promoted.includes('active'));
});

test('canTransitionIdeaStatus: same-state is not allowed', () => {
  for (const s of ['draft', 'active', 'promoted', 'archived']) {
    assert.equal(canTransitionIdeaStatus(s, s), false);
  }
});

test('canTransitionIdeaStatus: legal transitions return true', () => {
  assert.equal(canTransitionIdeaStatus('draft', 'active'), true);
  assert.equal(canTransitionIdeaStatus('active', 'promoted'), true);
  assert.equal(canTransitionIdeaStatus('archived', 'draft'), true);
});

test('canTransitionIdeaStatus: illegal transitions return false', () => {
  assert.equal(canTransitionIdeaStatus('draft', 'promoted'), false);
  assert.equal(canTransitionIdeaStatus('promoted', 'draft'), false);
  assert.equal(canTransitionIdeaStatus('archived', 'promoted'), false);
});

// ----- createIdeaData seeds v1 -----

test('createIdeaData: seeds versions[0] = v1', () => {
  const i = createIdeaData('Test', 'desc', [], ['x']);
  assert.ok(Array.isArray(i.versions));
  assert.equal(i.versions.length, 1);
  assert.equal(i.versions[0].version, 1);
  assert.equal(i.currentVersion, 1);
  assert.equal(i.versions[0].status, 'draft');
});

// ----- saveIdeaVersion -----
// 由于 saveIdeaVersion 内部依赖 window + localStorage,在没有 DOM 的 node
// 环境会直接 return null。把它 mock 起来:

const STORE = new Map();
globalThis.window = globalThis.window || globalThis;
globalThis.localStorage = {
  getItem: (k) => (STORE.has(k) ? STORE.get(k) : null),
  setItem: (k, v) => STORE.set(k, String(v)),
  removeItem: (k) => STORE.delete(k),
  clear: () => STORE.clear(),
};

import('node:fs').then(() => {});
// seed an idea
const seeded = createIdeaData('Original title', 'Original desc');
STORE.set('dpr_ideas_v1', JSON.stringify({ schemaVersion: 2, ideas: { [seeded.id]: seeded } }));

test('saveIdeaVersion: bumps version and appends snapshot', () => {
  const snap = saveIdeaVersion(seeded.id, { description: 'Updated desc' });
  assert.ok(snap);
  assert.equal(snap.version, 2);
  assert.equal(snap.description, 'Updated desc');
  assert.equal(snap.title, 'Original title'); // 没改 title,保持原值
  assert.equal(snap.status, 'draft');
});

test('saveIdeaVersion: keeps older versions in array', () => {
  const doc = JSON.parse(STORE.get('dpr_ideas_v1'));
  const idea = doc.ideas[seeded.id];
  assert.ok(idea.versions.length >= 2);
  assert.equal(idea.versions[0].version, 1);
  assert.equal(idea.versions[idea.versions.length - 1].version, idea.currentVersion);
});

test('saveIdeaVersion: returns null for missing id', () => {
  assert.equal(saveIdeaVersion('not-a-real-id', { title: 'X' }), null);
});

test('saveIdeaVersion: changeNote is recorded', () => {
  const snap = saveIdeaVersion(seeded.id, { changeNote: 'manual edit' });
  assert.ok(snap);
  assert.equal(snap.changeNote, 'manual edit');
});

// ----- transitionIdeaStatus -----

test('transitionIdeaStatus: legal transition (draft → active)', () => {
  const r = transitionIdeaStatus(seeded.id, 'active', 'start exploring');
  assert.ok(r);
  assert.equal(r.from, 'draft');
  assert.equal(r.to, 'active');
  assert.equal(r.idea.status, 'active');
});

test('transitionIdeaStatus: illegal transition (active → draft) is rejected', () => {
  const r = transitionIdeaStatus(seeded.id, 'draft');
  assert.equal(r, null);
});

test('transitionIdeaStatus: writes a snapshot with new status', () => {
  transitionIdeaStatus(seeded.id, 'promoted', 'validated!');
  const doc = JSON.parse(STORE.get('dpr_ideas_v1'));
  const idea = doc.ideas[seeded.id];
  const lastSnap = idea.versions[idea.versions.length - 1];
  assert.equal(lastSnap.status, 'promoted');
  assert.match(lastSnap.changeNote, /validated/);
});

test('transitionIdeaStatus: missing idea returns null', () => {
  assert.equal(transitionIdeaStatus('does-not-exist', 'active'), null);
});

// ----- nextStatusesFor -----

test('nextStatusesFor: from draft returns [active, archived]', () => {
  // 先把 idea 拨回 draft
  const r = transitionIdeaStatus(seeded.id, 'archived'); // promoted → archived OK
  assert.ok(r);
  // archived → draft OK
  const r2 = transitionIdeaStatus(seeded.id, 'draft');
  assert.ok(r2);
  const nexts = nextStatusesFor(seeded.id);
  assert.deepEqual(nexts.sort(), ['active', 'archived']);
});

test('nextStatusesFor: missing id returns empty array', () => {
  assert.deepEqual(nextStatusesFor('nope'), []);
});