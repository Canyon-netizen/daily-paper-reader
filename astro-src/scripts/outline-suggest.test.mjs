#!/usr/bin/env node
// astro-src/scripts/outline-suggest.test.mjs
//
// Tests for R7 WP.2: suggestOutlineForType.

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
    platform: 'node',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/writing/outline.ts');
const { suggestOutlineForType, generateOutline } = mod;

test('suggestOutlineForType paper: 8 节 + 空 placeholders', () => {
  const o = suggestOutlineForType('paper');
  assert.equal(o.length, 8);
  assert.equal(o[0].id, 'abstract');
  assert.equal(o[7].id, 'references');
  for (const n of o) {
    assert.ok(Array.isArray(n.placeholders));
    assert.equal(n.placeholders.length, 0, `${n.id} should have empty placeholders`);
  }
});

test('suggestOutlineForType review: 11 节 + 空 placeholders', () => {
  const o = suggestOutlineForType('review');
  assert.equal(o.length, 11);
  for (const n of o) {
    assert.equal(n.placeholders.length, 0);
  }
  assert.ok(o.find((n) => n.id === 'related-work'));
  assert.ok(o.find((n) => n.id === 'taxonomy'));
  assert.ok(o.find((n) => n.id === 'gaps'));
});

test('suggestOutlineForType section: 3 节', () => {
  const o = suggestOutlineForType('section');
  assert.equal(o.length, 3);
  for (const n of o) {
    assert.equal(n.placeholders.length, 0);
  }
});

test('suggestOutlineForType note: 1 节', () => {
  const o = suggestOutlineForType('note');
  assert.equal(o.length, 1);
  assert.equal(o[0].id, 'body');
  assert.equal(o[0].placeholders.length, 0);
});

test('suggestOutlineForType translation: 3 节', () => {
  const o = suggestOutlineForType('translation');
  assert.equal(o.length, 3);
  for (const n of o) {
    assert.equal(n.placeholders.length, 0);
  }
});

test('suggestOutlineForType 等价于 generateOutline(type, [])', () => {
  const types = ['paper', 'review', 'section', 'note', 'translation'];
  for (const t of types) {
    const suggested = suggestOutlineForType(t);
    const generated = generateOutline(t, []);
    assert.equal(suggested.length, generated.length, `${t}: length mismatch`);
    for (let i = 0; i < suggested.length; i++) {
      assert.equal(suggested[i].id, generated[i].id, `${t}: id mismatch at ${i}`);
      assert.equal(suggested[i].placeholders.length, generated[i].placeholders.length, `${t}: placeholders mismatch at ${i}`);
    }
  }
});
