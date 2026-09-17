#!/usr/bin/env node
// astro-src/scripts/agents-skill-context-loader.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/skill-context-loader.ts.
// SKILL_DOCS_ROOT / SKILL_DOC_MAX_CHARS / STAGE_TO_SKILL 常量 +
// loadSkillContext (FS 读取 + 截断 + 缓存 + graceful 错误处理) +
// resetSkillContextCache +
// listSkillDocsForStage。

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
    external: ['node:fs', 'node:path', 'fs', 'path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/skill-context-loader.ts');
const {
  SKILL_DOCS_ROOT,
  SKILL_DOC_MAX_CHARS,
  STAGE_TO_SKILL,
  loadSkillContext,
  resetSkillContextCache,
  listSkillDocsForStage,
} = mod;

// ---------- 常量 ---
test('SKILL_DOCS_ROOT: 默认值', () => {
  assert.equal(SKILL_DOCS_ROOT, 'docs/research-skills');
});

test('SKILL_DOC_MAX_CHARS: 默认 3000', () => {
  assert.equal(SKILL_DOC_MAX_CHARS, 3000);
});

test('STAGE_TO_SKILL: 含 6 个 stage', () => {
  const keys = Object.keys(STAGE_TO_SKILL);
  assert.equal(keys.length, 6);
  assert.ok(keys.includes('ideation'));
  assert.ok(keys.includes('literature'));
  assert.ok(keys.includes('experiment'));
  assert.ok(keys.includes('draft'));
  assert.ok(keys.includes('review'));
  assert.ok(keys.includes('revise'));
});

test('STAGE_TO_SKILL: 每个 stage 含至少 1 个 doc', () => {
  for (const k of Object.keys(STAGE_TO_SKILL)) {
    assert.ok(STAGE_TO_SKILL[k].length >= 1, `${k} empty`);
  }
});

test('STAGE_TO_SKILL: literature 有 2 个 docs', () => {
  assert.equal(STAGE_TO_SKILL.literature.length, 2);
});

// ---------- listSkillDocsForStage ---
test('listSkillDocsForStage: ideation → 1 个 doc', () => {
  assert.equal(listSkillDocsForStage('ideation').length, 1);
});

test('listSkillDocsForStage: 返回副本', () => {
  const r1 = listSkillDocsForStage('ideation');
  r1.push('extra');
  const r2 = listSkillDocsForStage('ideation');
  assert.notEqual(r2.length, r1.length);
});

// ---------- loadSkillContext: graceful ---
test('loadSkillContext: stage=ideation 含方法论上下文', () => {
  resetSkillContextCache();
  const r = loadSkillContext('ideation');
  // defining-research-question.md 当前存在
  assert.match(r, /\[方法论上下文 · stage=ideation\]/);
  assert.match(r, /### defining-research-question\.md/);
});

test('loadSkillContext: cache hit → 同结果', () => {
  resetSkillContextCache();
  const r1 = loadSkillContext('ideation');
  const r2 = loadSkillContext('ideation');
  assert.equal(r1, r2);
});

test('loadSkillContext: reset → 重新读', () => {
  resetSkillContextCache();
  loadSkillContext('ideation');
  resetSkillContextCache();
  // 第二次 reset 后再调,cache 应清空
  const r = loadSkillContext('ideation');
  assert.match(r, /方法论上下文/);
});

test('loadSkillContext: 多文件 stage 拼接多个 "###"', () => {
  resetSkillContextCache();
  const r = loadSkillContext('literature');
  // literature 含 2 个 doc,应有 2 个 "### xxx.md" 或 WARN 行
  const matches = r.match(/### /g);
  assert.ok(matches.length >= 2);
});

// ---------- 截断 ---
test('SKILL_DOC_MAX_CHARS: 常量是 3000', () => {
  assert.equal(SKILL_DOC_MAX_CHARS, 3000);
});

test('loadSkillContext: 不抛错', () => {
  resetSkillContextCache();
  const r = loadSkillContext('literature');
  assert.ok(typeof r === 'string');
  assert.ok(r.length > 0);
});

// ---------- 未知 stage ---
test('loadSkillContext: 未知 stage → 返回 "" (TypeScript 阻止但运行时兜底)', () => {
  resetSkillContextCache();
  // 运行时绕过 TS 类型,直接传字符串
  const r = loadSkillContext('unknown_stage');
  // STAGE_TO_SKILL['unknown_stage'] 是 undefined → files = [] → 返回 ''
  assert.equal(r, '');
});

// ---------- 集成 ---
test('集成: 多 stage 独立 cache', () => {
  resetSkillContextCache();
  const a = loadSkillContext('ideation');
  const b = loadSkillContext('literature');
  assert.match(a, /stage=ideation/);
  assert.match(b, /stage=literature/);
});