#!/usr/bin/env node
// astro-src/scripts/agents-skill-context-loader.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/skill-context-loader.ts pure parts.
// loadSkillContext 依赖 node:fs 读盘,跳过;测纯查询/常量。

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
    external: ['node:fs', 'node:path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/skill-context-loader.ts');
const {
  STAGE_TO_SKILL,
  SKILL_DOCS_ROOT,
  SKILL_DOC_MAX_CHARS,
  listSkillDocsForStage,
  resetSkillContextCache,
} = mod;

// ---------- 常量 ----------
test('SKILL_DOCS_ROOT: 相对路径 docs/research-skills', () => {
  assert.equal(SKILL_DOCS_ROOT, 'docs/research-skills');
});

test('SKILL_DOC_MAX_CHARS: 3000', () => {
  assert.equal(SKILL_DOC_MAX_CHARS, 3000);
});

test('STAGE_TO_SKILL: 6 个 stage', () => {
  assert.equal(Object.keys(STAGE_TO_SKILL).length, 6);
});

test('STAGE_TO_SKILL: ideation → defining-research-question.md', () => {
  assert.deepEqual(STAGE_TO_SKILL.ideation, ['defining-research-question.md']);
});

test('STAGE_TO_SKILL: literature → 2 docs', () => {
  assert.equal(STAGE_TO_SKILL.literature.length, 2);
});

test('STAGE_TO_SKILL: experiment → 1 doc', () => {
  assert.equal(STAGE_TO_SKILL.experiment.length, 1);
});

test('STAGE_TO_SKILL: draft → writing-paper.md', () => {
  assert.deepEqual(STAGE_TO_SKILL.draft, ['writing-paper.md']);
});

test('STAGE_TO_SKILL: review → 2 docs', () => {
  assert.equal(STAGE_TO_SKILL.review.length, 2);
});

test('STAGE_TO_SKILL: revise → writing-rebuttal.md', () => {
  assert.deepEqual(STAGE_TO_SKILL.revise, ['writing-rebuttal.md']);
});

// ---------- listSkillDocsForStage ----------
test('listSkillDocsForStage: ideation → array copy', () => {
  const r = listSkillDocsForStage('ideation');
  assert.deepEqual(r, ['defining-research-question.md']);
});

test('listSkillDocsForStage: 返回新数组 (不共享引用)', () => {
  const r1 = listSkillDocsForStage('ideation');
  const r2 = listSkillDocsForStage('ideation');
  assert.notEqual(r1, r2); // 不同引用
  assert.deepEqual(r1, r2);
});

test('listSkillDocsForStage: 修改返回不影响 STAGE_TO_SKILL', () => {
  const r = listSkillDocsForStage('ideation');
  r.push('extra.md');
  assert.deepEqual(STAGE_TO_SKILL.ideation, ['defining-research-question.md']);
});

test('listSkillDocsForStage: literature', () => {
  const r = listSkillDocsForStage('literature');
  assert.ok(r.includes('how-to-lit-review.md'));
  assert.ok(r.includes('how-to-read-paper.md'));
});

// ---------- resetSkillContextCache ----------
test('resetSkillContextCache: 不抛错', () => {
  // 模块加载时 cache 可能是空的;reset 也只是 clear
  assert.doesNotThrow(() => resetSkillContextCache());
});

test('resetSkillContextCache: 多次调用安全', () => {
  assert.doesNotThrow(() => {
    resetSkillContextCache();
    resetSkillContextCache();
  });
});