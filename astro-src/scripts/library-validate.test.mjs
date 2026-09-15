#!/usr/bin/env node
// astro-src/scripts/library-validate.test.mjs
//
// Tests for library-validate.mjs (R7 D.2.1 + D.2.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  validateLibrary,
  validateLibraries,
  buildCorpusIndex,
  scoreLibraryAnchors,
  validateAnchors,
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

// ----- D.2.2: anchor quality scoring -----

function makePaperFile(dir, arxivId, score) {
  const content = `---
arxivId: "${arxivId}"
score: ${score}
date: 2026-01-15
---

# Title

Body.
`;
  const slug = `${arxivId}-some-slug`;
  const subdir = join(dir, arxivId.split('.')[0]);
  mkdirSync(subdir, { recursive: true });
  writeFileSync(join(subdir, `${slug}.md`), content);
  return join(subdir, `${slug}.md`);
}

test('buildCorpusIndex: indexes arxiv-id from filename', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'corpus-'));
  makePaperFile(tmp, '2401.01234', '0.7');
  makePaperFile(tmp, '2402.05678', '0.8');
  const idx = buildCorpusIndex(tmp);
  assert.equal(idx.size, 2);
  assert.ok(idx.has('2401.01234'));
  assert.ok(idx.has('2402.05678'));
});

test('buildCorpusIndex: skips underscore, assets, topic-seeds', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'corpus-'));
  makePaperFile(tmp, '2401.01234', '0.7');
  mkdirSync(join(tmp, '_drafts'), { recursive: true });
  writeFileSync(join(tmp, '_drafts', '9999.99999-draft.md'), '---\nscore: 0.5\n---\n');
  mkdirSync(join(tmp, 'assets'), { recursive: true });
  writeFileSync(join(tmp, 'assets', 'image.md'), 'irrelevant');
  const idx = buildCorpusIndex(tmp);
  assert.equal(idx.size, 1);
  assert.ok(idx.has('2401.01234'));
});

test('scoreLibraryAnchors: all included papers exist & have reasonable score', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'corpus-'));
  makePaperFile(tmp, '2401.01234', '0.7');
  makePaperFile(tmp, '2402.05678', '0.8');
  const idx = buildCorpusIndex(tmp);
  const lib = {
    papers: {
      '2401.01234': { status: 'included' },
      '2402.05678': { status: 'included' },
      '2403.00000': { status: 'candidate' }, // not counted
    },
  };
  const r = scoreLibraryAnchors(lib, idx);
  assert.equal(r.includedCount, 2);
  assert.equal(r.highQualityCount, 2);
  assert.equal(r.ratio, 1);
});

test('scoreLibraryAnchors: missing paper file counts as low quality', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'corpus-'));
  makePaperFile(tmp, '2401.01234', '0.7');
  const idx = buildCorpusIndex(tmp);
  const lib = {
    papers: {
      '2401.01234': { status: 'included' },
      '9999.99999': { status: 'included' }, // not in corpus
    },
  };
  const r = scoreLibraryAnchors(lib, idx);
  assert.equal(r.includedCount, 2);
  assert.equal(r.highQualityCount, 1);
  assert.equal(r.ratio, 0.5);
});

test('scoreLibraryAnchors: extreme score counted as low quality', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'corpus-'));
  makePaperFile(tmp, '2401.01234', '0.01'); // too low
  makePaperFile(tmp, '2402.05678', '0.99'); // too high
  const idx = buildCorpusIndex(tmp);
  const lib = {
    papers: {
      '2401.01234': { status: 'included' },
      '2402.05678': { status: 'included' },
    },
  };
  const r = scoreLibraryAnchors(lib, idx);
  assert.equal(r.highQualityCount, 0);
});

test('scoreLibraryAnchors: 0..10 scale also handled', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'corpus-'));
  makePaperFile(tmp, '2401.01234', '7'); // 0..10 scale, reasonable
  makePaperFile(tmp, '2402.05678', '0.5'); // 0..10 scale but extreme (<0.5)
  const idx = buildCorpusIndex(tmp);
  const lib = {
    papers: {
      '2401.01234': { status: 'included' },
      '2402.05678': { status: 'included' },
    },
  };
  const r = scoreLibraryAnchors(lib, idx);
  // scale 7 > 1 → 0..10. threshold: 0.05*10=0.5 → 7 ok; 0.5 also ok (boundary)
  assert.equal(r.highQualityCount, 2);
});

test('scoreLibraryAnchors: empty library has ratio 1', () => {
  const idx = new Map();
  const r = scoreLibraryAnchors({ papers: {} }, idx);
  assert.equal(r.includedCount, 0);
  assert.equal(r.ratio, 1);
});

test('validateAnchors: returns per-library results', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'corpus-'));
  makePaperFile(tmp, '2401.01234', '0.7');
  const idx = buildCorpusIndex(tmp);
  const doc = {
    libraries: {
      a: { papers: { '2401.01234': { status: 'included' } } },
      b: { papers: {} },
    },
  };
  const r = validateAnchors(doc, idx);
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].includedCount, 1);
  assert.equal(r.results[0].highQualityCount, 1);
  assert.equal(r.results[1].includedCount, 0);
});

test('CLI: --quality reports anchor scores', async () => {
  const { spawnSync } = await import('node:child_process');
  const corpusTmp = mkdtempSync(join(tmpdir(), 'corpus-cli-'));
  mkdirSync(join(corpusTmp, '2401'), { recursive: true });
  writeFileSync(join(corpusTmp, '2401', '2401.01234-slug.md'), '---\nscore: 0.7\n---\nbody\n');
  const libTmp = mkdtempSync(join(tmpdir(), 'lib-cli-'));
  const libPath = join(libTmp, 'libs.json');
  writeFileSync(libPath, JSON.stringify({
    libraries: {
      a: {
        name: 'Test', statement: 's', hue: 'cyan',
        categories: [], rubric: [], stages: [], drafts: [],
        papers: { '2401.01234': { status: 'included' } },
      },
    },
  }));
  const r = spawnSync('node', [
    'astro-src/scripts/library-validate.mjs', '--quality', `--path=${libPath}`, `--root=${corpusTmp}`,
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  assert.match(r.stdout, /D\.2\.2 anchor quality/);
  assert.match(r.stdout, /1\/1 included/);
});