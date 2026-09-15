#!/usr/bin/env node
// astro-src/scripts/library-auto-derive.test.mjs
//
// Tests for library-auto-derive.mjs (R7 D.2.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectTaskTags,
  deriveLibraries,
  walkPapers,
  extractArxivId,
  extractTaskTags,
  TASK_TO_LIB,
} from './library-auto-derive.mjs';

function makePaper(dir, subpath, content) {
  const fullPath = join(dir, subpath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

test('walkPapers skips underscore/assets/topic-seeds dirs', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lad-'));
  makePaper(tmp, 'paper.md', '# body');
  makePaper(tmp, '_drafts/draft.md', '# body');
  makePaper(tmp, 'assets/img.md', '# body');
  makePaper(tmp, 'topic-seeds-game-ai.md', '# body');
  const files = walkPapers(tmp);
  assert.equal(files.length, 1);
  assert.match(files[0], /paper\.md$/);
  rmSync(tmp, { recursive: true });
});

test('extractArxivId: strips version suffix', () => {
  assert.equal(extractArxivId('2401.01234-slug.md'), '2401.01234');
  assert.equal(extractArxivId('2606.06087v1-slug.md'), '2606.06087');
  assert.equal(extractArxivId('2401.01234v12-slug.md'), '2401.01234');
  assert.equal(extractArxivId('not-an-id.md'), null);
  assert.equal(extractArxivId('README.md'), null);
});

test('extractArxivId: handles full path with subdirs', () => {
  // Basename first, then split on '-' (path also contains '-')
  assert.equal(extractArxivId('docs/papers/2025/10/21/2510.18483v1-slug.md'), '2510.18483');
});

test('extractTaskTags: from old tags array format', () => {
  const content = `---
tags: [task:rl, task:mas, foo]
---
# body`;
  const tags = extractTaskTags(content);
  // All task:* tags pass through; foo (no task: prefix) is filtered.
  assert.deepEqual(tags.sort(), ['task:mas', 'task:rl']);
});

test('extractTaskTags: from new categories.task block', () => {
  const content = `---
categories:
  venue: []
  task:
    - rl
    - mas
---
# body`;
  const tags = extractTaskTags(content);
  assert.deepEqual(tags.sort(), ['task:mas', 'task:rl']);
});

test('extractTaskTags: dedupes across both formats', () => {
  const content = `---
tags: [task:rl]
categories:
  task:
    - rl
---
# body`;
  const tags = extractTaskTags(content);
  assert.deepEqual(tags, ['task:rl']);
});

test('extractTaskTags: empty when no frontmatter', () => {
  assert.deepEqual(extractTaskTags('# no fm'), []);
});

test('collectTaskTags: aggregates papers by task tag', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lad-'));
  makePaper(tmp, '2401.01234-a.md', '---\ncategories:\n  task:\n    - rl\n---\n# body');
  makePaper(tmp, '2401.01235-b.md', '---\ncategories:\n  task:\n    - rl\n    - mas\n---\n# body');
  makePaper(tmp, '2401.01236-c.md', '---\ncategories:\n  task:\n    - mas\n---\n# body');
  const tags = collectTaskTags(tmp);
  assert.equal(tags.size, 2);
  assert.equal(tags.get('task:rl').length, 2);
  assert.equal(tags.get('task:mas').length, 2);
  rmSync(tmp, { recursive: true });
});

test('collectTaskTags: skips papers without arxiv-id filename', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lad-'));
  makePaper(tmp, 'README.md', '---\ntags: [task:rl]\n---\n# body');
  makePaper(tmp, 'notarxivid-foo.md', '---\ntags: [task:rl]\n---\n# body');
  makePaper(tmp, '2401.01234-ok.md', '---\ncategories:\n  task:\n    - rl\n---\n# body');
  const tags = collectTaskTags(tmp);
  assert.equal(tags.get('task:rl').length, 1);
  rmSync(tmp, { recursive: true });
});

test('deriveLibraries: honors minPapers threshold', () => {
  const taskToPapers = new Map([
    ['task:rl', ['a', 'b', 'c', 'd', 'e']],
    ['task:mas', ['x', 'y']],  // below default 5
    ['task:llm-agent', ['1', '2', '3', '4', '5', '6']],
  ]);
  const out = deriveLibraries(taskToPapers, { minPapers: 5 });
  assert.equal(Object.keys(out).length, 2);
  assert.ok(out.auto_rl);
  assert.ok(out['auto_llm-agent']);
  assert.equal(out.auto_rl.name, '强化学习');
  assert.equal(out.auto_rl.hue, 'emerald');
  assert.equal(out.auto_rl.autoDerived, true);
  assert.equal(out.auto_rl.sourceTask, 'task:rl');
});

test('deriveLibraries: papers field uses { arxivId: { status, addedAt } }', () => {
  const taskToPapers = new Map([
    ['task:rl', ['2401.01234', '2401.05678']],
  ]);
  const out = deriveLibraries(taskToPapers, { minPapers: 1 });
  const papers = out.auto_rl.papers;
  assert.ok(papers['2401.01234']);
  assert.equal(papers['2401.01234'].status, 'candidate');
  assert.match(papers['2401.01234'].addedAt, /^\d{4}-\d{2}-\d{2}$/);
});

test('deriveLibraries: empty input -> empty output', () => {
  const out = deriveLibraries(new Map(), { minPapers: 1 });
  assert.deepEqual(out, {});
});

test('CLI: --dry-run writes to stdout', async () => {
  const { spawnSync } = await import('node:child_process');
  const tmp = mkdtempSync(join(tmpdir(), 'lad-cli-'));
  writeFileSync(join(tmp, '2401.01234-a.md'), '---\ncategories:\n  task:\n    - rl\n---\n# body');
  writeFileSync(join(tmp, '2401.01235-b.md'), '---\ncategories:\n  task:\n    - rl\n---\n# body');
  const r = spawnSync('node', [
    'astro-src/scripts/library-auto-derive.mjs',
    `--root=${tmp}`,
    '--dry-run',
    '--min-papers=2',
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(out.libraries.auto_rl, `libraries: ${JSON.stringify(Object.keys(out.libraries))}`);
  rmSync(tmp, { recursive: true });
});

test('CLI: writes to --out path', async () => {
  const { spawnSync } = await import('node:child_process');
  const { existsSync, readFileSync, unlinkSync } = await import('node:fs');
  const tmp = mkdtempSync(join(tmpdir(), 'lad-cli-'));
  const outDir = mkdtempSync(join(tmpdir(), 'lad-out-'));
  writeFileSync(join(tmp, '2401.01234-a.md'), '---\ncategories:\n  task:\n    - rl\n---\n# body');
  const outPath = join(outDir, 'auto.json');
  const r = spawnSync('node', [
    'astro-src/scripts/library-auto-derive.mjs',
    `--root=${tmp}`,
    `--out=${outPath}`,
    '--min-papers=1',
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.ok(existsSync(outPath));
  const parsed = JSON.parse(readFileSync(outPath, 'utf8'));
  assert.ok(parsed.libraries.auto_rl);
  unlinkSync(outPath);
  rmSync(tmp, { recursive: true });
  rmSync(outDir, { recursive: true });
});

test('CLI: missing --root gives clear message and exits 1', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('node', [
    'astro-src/scripts/library-auto-derive.mjs',
    '--root=/nonexistent/path',
    '--dry-run',
  ], { encoding: 'utf8' });
  // walkPapers returns [] when dir missing, so no crash, just no output
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(Object.keys(out.libraries).length, 0);
});

test('TASK_TO_LIB: known tasks have name + hue + statement', () => {
  for (const [task, cfg] of Object.entries(TASK_TO_LIB)) {
    assert.ok(cfg.name, `${task} missing name`);
    assert.ok(cfg.hue, `${task} missing hue`);
    assert.ok(cfg.statement, `${task} missing statement`);
  }
});