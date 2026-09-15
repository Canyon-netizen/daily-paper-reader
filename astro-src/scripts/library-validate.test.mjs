#!/usr/bin/env node
// astro-src/scripts/library-validate.test.mjs
//
// Tests for library-validate.mjs (R7 D.2.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  validateLibrary,
  validateLibraries,
} from './library-validate.mjs';

const validLibrary = {
  id: 'lib-1',
  name: 'Trustworthy Agents',
  statement: 'Decision-making under uncertainty for LLM agents',
  hue: 'cyan',
  categories: [{ id: 'c1', label: 'safety' }],
  rubric: [{ id: 'r1', label: 'reasoning' }],
  papers: {
    '2401.01234': { status: 'candidate', addedAt: '2026-09-01' },
    '2402.05678': { status: 'included', addedAt: '2026-09-02' },
  },
  stages: [],
  drafts: [],
  createdAt: '2026-09-01',
  updatedAt: '2026-09-15',
};

test('valid library passes', () => {
  const r = validateLibrary(validLibrary, 'lib-1');
  assert.equal(r.errors.length, 0, r.errors.join('; '));
});

test('missing required fields are reported', () => {
  const r = validateLibrary({ id: 'x', name: 'X' }, 'x');
  // missing: statement, hue, categories, rubric, papers, stages, drafts
  assert.ok(r.errors.length >= 5, `got ${r.errors.length} errors: ${r.errors.join('; ')}`);
  assert.ok(r.errors.some((e) => e.includes('statement')));
  assert.ok(r.errors.some((e) => e.includes('papers')));
});

test('name length out of [1, 32] flagged', () => {
  const tooShort = { ...validLibrary, name: '' };
  const tooLong = { ...validLibrary, name: 'a'.repeat(33) };
  assert.ok(validateLibrary(tooShort, 'a').errors.some((e) => e.includes('name length')));
  assert.ok(validateLibrary(tooLong, 'a').errors.some((e) => e.includes('name length')));
  // boundary
  assert.equal(validateLibrary({ ...validLibrary, name: 'a' }, 'a').errors.filter((e) => e.includes('name length')).length, 0);
  assert.equal(validateLibrary({ ...validLibrary, name: 'a'.repeat(32) }, 'a').errors.filter((e) => e.includes('name length')).length, 0);
});

test('hue must be in 7-color palette', () => {
  const ok = validateLibrary({ ...validLibrary, hue: 'orange' }, 'a');
  assert.equal(ok.errors.filter((e) => e.includes('hue')).length, 0);

  const bad = validateLibrary({ ...validLibrary, hue: 'magenta' }, 'a');
  assert.ok(bad.errors.some((e) => e.includes('hue')));
});

test('paper status enum validated', () => {
  const bad = validateLibrary({
    ...validLibrary,
    papers: { '2401.01234': { status: 'maybe' } },
  }, 'a');
  assert.ok(bad.errors.some((e) => e.includes('status invalid')));
});

test('arxivId format checked', () => {
  const bad = validateLibrary({
    ...validLibrary,
    papers: { 'not-an-id': { status: 'candidate' } },
  }, 'a');
  assert.ok(bad.errors.some((e) => e.includes('invalid paper arxivId')));

  // 4-digit year, 4-5 digit month-seq
  const ok = validateLibrary({
    ...validLibrary,
    papers: { '2401.01234': { status: 'candidate' }, '2501.12345': { status: 'included' } },
  }, 'a');
  assert.equal(ok.errors.filter((e) => e.includes('arxivId')).length, 0);
});

test('categories and rubric must be arrays', () => {
  const bad = validateLibrary({
    ...validLibrary,
    categories: 'not-an-array',
    rubric: 42,
  }, 'a');
  assert.ok(bad.errors.some((e) => e.includes('categories must be array')));
  assert.ok(bad.errors.some((e) => e.includes('rubric must be array')));
});

test('stages and drafts must be arrays', () => {
  const bad = validateLibrary({
    ...validLibrary,
    stages: 'wrong',
    drafts: { 0: 'wrong' },
  }, 'a');
  assert.ok(bad.errors.some((e) => e.includes('stages must be array')));
  assert.ok(bad.errors.some((e) => e.includes('drafts must be array')));
});

test('validateLibraries: missing top-level "libraries"', () => {
  const r = validateLibraries({});
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('libraries')));
});

test('validateLibraries: returns one result per library', () => {
  const r = validateLibraries({
    libraries: {
      a: validLibrary,
      b: { ...validLibrary, id: 'lib-2', name: 'Other' },
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 2);
});

test('validateLibraries: aggregates failures across libraries', () => {
  const r = validateLibraries({
    libraries: {
      good: validLibrary,
      bad: { id: 'bad', name: 'Bad' }, // missing many fields
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].errors.length, 0);
  assert.ok(r.results[1].errors.length >= 5);
});

test('validateLibraries: malformed doc', () => {
  const r = validateLibraries(null);
  assert.equal(r.ok, false);

  const r2 = validateLibraries({ __parse_error: 'unexpected token' });
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes('parse error')));
});

test('CLI: validates file from --path', async () => {
  const { spawnSync } = await import('node:child_process');
  const tmp = mkdtempSync(join(tmpdir(), 'lib-val-'));
  const path = join(tmp, 'libs.json');
  writeFileSync(path, JSON.stringify({ libraries: { a: validLibrary } }));
  const r = spawnSync('node', ['astro-src/scripts/library-validate.mjs', '--check', `--path=${path}`], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stdout, /scanning 1 libraries/);
  assert.match(r.stdout, /failed: 0/);
});

test('CLI: missing file gives informative message', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('node', ['astro-src/scripts/library-validate.mjs', '--check', '--path=/nonexistent.json'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, 'missing file should NOT exit 1 without --ci');
  assert.match(r.stdout, /file not found/);
  assert.match(r.stdout, /localStorage/);
});

test('CLI: --ci exits 1 on missing file', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('node', ['astro-src/scripts/library-validate.mjs', '--ci', '--path=/nonexistent.json'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
});

test('CLI: --json emits JSON', async () => {
  const { spawnSync } = await import('node:child_process');
  const tmp = mkdtempSync(join(tmpdir(), 'lib-val-'));
  const path = join(tmp, 'libs.json');
  writeFileSync(path, JSON.stringify({ libraries: { a: validLibrary } }));
  const r = spawnSync('node', ['astro-src/scripts/library-validate.mjs', '--json', `--path=${path}`], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.results.length, 1);
});