#!/usr/bin/env node
// astro-src/scripts/library-export.test.mjs
//
// Tests for R7 LP.6 library export to JSON.

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

const mod = await loadTs('lib/libraries/export.ts');
const { libraryToJson, libraryToJsonString, parseLibraryExport } = mod;

const mockLibrary = {
  id: 'my-library',
  name: 'My Library',
  description: 'A collection of papers',
  tags: ['ml', 'nlp'],
  paperCount: 42,
};

test('libraryToJson: adds schema version and timestamp', () => {
  const result = libraryToJson(mockLibrary);

  assert.ok(result.schemaVersion, 'Should have schema version');
  assert.ok(result.exportedAt, 'Should have exportedAt');
  assert.ok(result.library, 'Should have library');
});

test('libraryToJson: preserves library data', () => {
  const result = libraryToJson(mockLibrary);

  assert.equal(result.library.id, 'my-library');
  assert.equal(result.library.name, 'My Library');
  assert.equal(result.library.paperCount, 42);
});

test('libraryToJsonString: produces valid JSON', () => {
  const jsonString = libraryToJsonString(mockLibrary);

  const parsed = JSON.parse(jsonString);
  assert.equal(parsed.library.id, 'my-library');
});

test('libraryToJsonString: can disable pretty printing', () => {
  const compact = libraryToJsonString(mockLibrary, false);
  const pretty = libraryToJsonString(mockLibrary, true);

  assert.ok(compact.length < pretty.length);
});

test('parseLibraryExport: parses valid export', () => {
  const jsonString = libraryToJsonString(mockLibrary);
  const parsed = parseLibraryExport(jsonString);

  assert.ok(parsed !== null);
  assert.equal(parsed.id, 'my-library');
  assert.equal(parsed.name, 'My Library');
});

test('parseLibraryExport: returns null for invalid JSON', () => {
  const result = parseLibraryExport('not valid json');
  assert.equal(result, null);
});

test('parseLibraryExport: returns null for missing fields', () => {
  const result = parseLibraryExport('{"foo": "bar"}');
  assert.equal(result, null);
});
