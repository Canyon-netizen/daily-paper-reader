#!/usr/bin/env node
// astro-src/scripts/agents-few-shot.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/few-shot.ts.
// selectFewShotExamples (同 projectId +3 / 同 type +2 / feedback*10 加权排序) +
// renderFewShotBlock (LLM prompt 块渲染)。

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
    platform: 'neutral',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/few-shot.ts');
const { selectFewShotExamples, renderFewShotBlock } = mod;

const mkP = (id, overrides = {}) => ({
  id,
  round: 1,
  type: 'add_paper',
  title: `T-${id}`,
  rationale: `R-${id}`,
  evidence: { paperIds: [], quotes: [] },
  target: {},
  estimated_effort: 'low',
  risk: 'r',
  created_at: 0,
  ...overrides,
});

// ---------- selectFewShotExamples: 基本 ---
test('selectFewShot: 空 history → []', () => {
  assert.deepEqual(selectFewShotExamples([]), []);
});

test('selectFewShot: 默认 k=3', () => {
  const r = selectFewShotExamples([mkP('a'), mkP('b'), mkP('c'), mkP('d')]);
  assert.equal(r.length, 3);
});

test('selectFewShot: k=0 → []', () => {
  const r = selectFewShotExamples([mkP('a')], { k: 0 });
  assert.deepEqual(r, []);
});

test('selectFewShot: k 负数 → []', () => {
  const r = selectFewShotExamples([mkP('a')], { k: -1 });
  assert.deepEqual(r, []);
});

test('selectFewShot: 返回 FewShotExample 投影', () => {
  const r = selectFewShotExamples([mkP('p1', { title: 'My Title' })]);
  assert.equal(r[0].title, 'My Title');
  assert.equal(r[0].sourceId, 'p1');
  assert.equal(r[0].type, 'add_paper');
});

// ---------- 同 projectId 优先 ---
test('selectFewShot: 同 projectId +3 优先', () => {
  const r = selectFewShotExamples([
    mkP('a', { target: { projectId: 'P' } }),
    mkP('b', { target: {} }),
  ], { projectId: 'P' });
  // a 同 project 加 +3,优先
  assert.equal(r[0].sourceId, 'a');
});

test('selectFewShot: 同 type +2 优先', () => {
  const r = selectFewShotExamples([
    mkP('a', { type: 'create_draft' }),
    mkP('b', { type: 'add_paper' }),
  ], { type: 'create_draft' });
  assert.equal(r[0].sourceId, 'a');
});

test('selectFewShot: 同 project + 同 type 都优先', () => {
  const r = selectFewShotExamples([
    mkP('a', { type: 'add_paper', target: { projectId: 'P' } }),
    mkP('b', { type: 'add_paper', target: {} }),
  ], { projectId: 'P', type: 'add_paper' });
  assert.equal(r[0].sourceId, 'a');
});

// ---------- feedback score ---
test('selectFewShot: 默认 feedbackScore=0.5', () => {
  const r = selectFewShotExamples([mkP('a')]);
  assert.equal(r[0].score, 0.5);
});

test('selectFewShot: feedbackScore 高分优先', () => {
  const r = selectFewShotExamples([
    mkP('low'),
    mkP('high'),
  ], {
    feedbackScoreByProposalId: { low: 0.2, high: 0.9 },
  });
  assert.equal(r[0].sourceId, 'high');
});

test('selectFewShot: minScore 过滤', () => {
  const r = selectFewShotExamples([
    mkP('low'),
    mkP('high'),
  ], {
    minScore: 0.5,
    feedbackScoreByProposalId: { low: 0.2, high: 0.9 },
  });
  // low 被过滤
  assert.equal(r.length, 1);
  assert.equal(r[0].sourceId, 'high');
});

// ---------- tie-breaker (created_at) ---
test('selectFewShot: 同分时 created_at 大的优先', () => {
  const r = selectFewShotExamples([
    mkP('old', { created_at: 100 }),
    mkP('new', { created_at: 200 }),
  ]);
  assert.equal(r[0].sourceId, 'new');
});

// ---------- minScore 边界 ---
test('selectFewShot: minScore=0.5, 缺 feedbackScore → 0.5 兜底通过', () => {
  const r = selectFewShotExamples([mkP('a')], { minScore: 0.5 });
  // feedbackScore 缺 → 0.5 兜底,刚好满足 minScore=0.5
  assert.equal(r.length, 1);
});

test('selectFewShot: minScore=0.6, feedbackScore 缺 → 兜底 0.5 不过滤', () => {
  const r = selectFewShotExamples([mkP('a')], { minScore: 0.6 });
  // 0.5 < 0.6 → 被过滤
  assert.equal(r.length, 0);
});

// ---------- k 限制 ---
test('selectFewShot: k=1 只取最高分', () => {
  const r = selectFewShotExamples([
    mkP('a', { type: 'create_draft', target: { projectId: 'P' } }),
    mkP('b'),
    mkP('c'),
  ], { projectId: 'P', type: 'create_draft', k: 1 });
  assert.equal(r.length, 1);
  assert.equal(r[0].sourceId, 'a');
});

test('selectFewShot: history < k → 全部返回', () => {
  const r = selectFewShotExamples([mkP('a'), mkP('b')], { k: 5 });
  assert.equal(r.length, 2);
});

// ---------- 输出稳定性 ---
test('selectFewShot: 同输入 → 同输出', () => {
  const hist = [
    mkP('a', { type: 'create_draft', target: { projectId: 'P' }, created_at: 100 }),
    mkP('b', { created_at: 200 }),
  ];
  const opts = { projectId: 'P', type: 'create_draft' };
  const r1 = selectFewShotExamples(hist, opts);
  const r2 = selectFewShotExamples(hist, opts);
  assert.deepEqual(r1, r2);
});

// ---------- renderFewShotBlock ---
test('renderFewShotBlock: 空 → ""', () => {
  assert.equal(renderFewShotBlock([]), '');
});

test('renderFewShotBlock: 单 example 含 json block', () => {
  const ex = [{
    type: 'add_paper',
    title: 'T',
    rationale: 'R',
    estimated_effort: 'low',
    risk: 'r',
    score: 0.5,
    sourceId: 'p1',
  }];
  const r = renderFewShotBlock(ex);
  assert.match(r, /# 示例/);
  assert.match(r, /## Example 1/);
  assert.match(r, /```json/);
  assert.match(r, /```/);
});

test('renderFewShotBlock: 含 type/title/rationale/effort/risk', () => {
  const r = renderFewShotBlock([{
    type: 'create_draft',
    title: 'Draft Title',
    rationale: 'Why this draft',
    estimated_effort: 'medium',
    risk: 'main risk',
    score: 0.8,
    sourceId: 'p1',
  }]);
  assert.match(r, /"type": "create_draft"/);
  assert.match(r, /"title": "Draft Title"/);
  assert.match(r, /"rationale": "Why this draft"/);
  assert.match(r, /"estimated_effort": "medium"/);
  assert.match(r, /"risk": "main risk"/);
});

test('renderFewShotBlock: 不含 score/sourceId', () => {
  const r = renderFewShotBlock([{
    type: 'add_paper',
    title: 'T',
    rationale: 'R',
    estimated_effort: 'low',
    risk: 'r',
    score: 0.9,
    sourceId: 'should_not_appear',
  }]);
  // score/sourceId 不在 render 字段
  assert.ok(!r.includes('score'));
  assert.ok(!r.includes('sourceId'));
  assert.ok(!r.includes('should_not_appear'));
});

test('renderFewShotBlock: 多 example → "## Example N"', () => {
  const ex1 = { type: 'add_paper', title: 'A', rationale: 'r1', estimated_effort: 'low', risk: 'x', score: 0.5, sourceId: 'p1' };
  const ex2 = { type: 'cite_paper', title: 'B', rationale: 'r2', estimated_effort: 'high', risk: 'y', score: 0.7, sourceId: 'p2' };
  const r = renderFewShotBlock([ex1, ex2]);
  assert.match(r, /## Example 1/);
  assert.match(r, /## Example 2/);
  assert.match(r, /"type": "cite_paper"/);
});

// ---------- 集成 ---
test('集成: selectFewShot + renderFewShotBlock end-to-end', () => {
  const hist = [
    mkP('a', { type: 'create_draft', target: { projectId: 'P' } }),
    mkP('b'),
  ];
  const examples = selectFewShotExamples(hist, { projectId: 'P', k: 1 });
  assert.equal(examples.length, 1);
  const r = renderFewShotBlock(examples);
  assert.match(r, /# 示例/);
  assert.match(r, /create_draft/);
});