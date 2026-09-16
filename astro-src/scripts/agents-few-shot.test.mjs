#!/usr/bin/env node
// astro-src/scripts/agents-few-shot.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/few-shot.ts.

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
    external: ['../user-libraries/types', '../../user-libraries/types'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/few-shot.ts');
const { selectFewShotExamples, renderFewShotBlock } = mod;

// ---------- selectFewShotExamples ----------
test('selectFewShotExamples: 空 history → []', () => {
  assert.deepEqual(selectFewShotExamples([]), []);
});

test('selectFewShotExamples: k=0 → []', () => {
  const history = [{ id: '1', type: 'add_paper', title: 't', rationale: 'r', estimated_effort: 'low', risk: 'r', target: {}, created_at: 1 }];
  assert.deepEqual(selectFewShotExamples(history, { k: 0 }), []);
});

test('selectFewShotExamples: 默认 k=3', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({
    id: 'p' + i,
    type: 'add_paper',
    title: 't' + i,
    rationale: 'r',
    estimated_effort: 'low',
    risk: '',
    target: {},
    created_at: i,
  }));
  const r = selectFewShotExamples(history);
  assert.equal(r.length, 3);
});

test('selectFewShotExamples: 同 projectId 优先', () => {
  const history = [
    { id: '1', type: 'add_paper', title: 'a', rationale: 'r', estimated_effort: 'low', risk: '', target: { projectId: 'X' }, created_at: 1 },
    { id: '2', type: 'add_paper', title: 'b', rationale: 'r', estimated_effort: 'low', risk: '', target: { projectId: 'Y' }, created_at: 1 },
    { id: '3', type: 'add_paper', title: 'c', rationale: 'r', estimated_effort: 'low', risk: '', target: { projectId: 'X' }, created_at: 1 },
  ];
  const r = selectFewShotExamples(history, { projectId: 'X' });
  // 1,3 同 project 优先 (+3),2 不优先
  assert.equal(r.length, 3);
  assert.equal(r[0].sourceId, '1');
  assert.equal(r[1].sourceId, '3');
  assert.equal(r[2].sourceId, '2');
});

test('selectFewShotExamples: 同 type 次之', () => {
  const history = [
    { id: '1', type: 'add_paper', title: 'a', rationale: 'r', estimated_effort: 'low', risk: '', target: {}, created_at: 1 },
    { id: '2', type: 'create_draft', title: 'b', rationale: 'r', estimated_effort: 'low', risk: '', target: {}, created_at: 1 },
    { id: '3', type: 'add_paper', title: 'c', rationale: 'r', estimated_effort: 'low', risk: '', target: {}, created_at: 1 },
  ];
  const r = selectFewShotExamples(history, { type: 'add_paper' });
  // 1,3 同 type 优先 (+2)
  assert.equal(r[0].sourceId, '1');
  assert.equal(r[1].sourceId, '3');
  assert.equal(r[2].sourceId, '2');
});

test('selectFewShotExamples: feedbackScore 越高越好', () => {
  const history = [
    { id: '1', type: 'add_paper', title: 'a', rationale: 'r', estimated_effort: 'low', risk: '', target: {}, created_at: 1 },
    { id: '2', type: 'add_paper', title: 'b', rationale: 'r', estimated_effort: 'low', risk: '', target: {}, created_at: 1 },
  ];
  const r = selectFewShotExamples(history, {
    feedbackScoreByProposalId: { 1: 0.9, 2: 0.1 },
  });
  assert.equal(r[0].sourceId, '1');
  assert.equal(r[1].sourceId, '2');
});

test('selectFewShotExamples: feedbackScore 默认 0.5', () => {
  const history = [
    { id: '1', type: 'add_paper', title: 'a', rationale: 'r', estimated_effort: 'low', risk: '', target: {}, created_at: 1 },
  ];
  const r = selectFewShotExamples(history);
  assert.equal(r[0].score, 0.5);
});

test('selectFewShotExamples: minScore 过滤', () => {
  const history = [
    { id: '1', type: 'add_paper', title: 'a', rationale: 'r', estimated_effort: 'low', risk: '', target: {}, created_at: 1 },
    { id: '2', type: 'add_paper', title: 'b', rationale: 'r', estimated_effort: 'low', risk: '', target: {}, created_at: 1 },
  ];
  const r = selectFewShotExamples(history, {
    feedbackScoreByProposalId: { 1: 0.9, 2: 0.1 },
    minScore: 0.5,
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].sourceId, '1');
});

test('selectFewShotExamples: 同分时 created_at 大的优先', () => {
  const history = [
    { id: '1', type: 'add_paper', title: 'a', rationale: 'r', estimated_effort: 'low', risk: '', target: {}, created_at: 1 },
    { id: '2', type: 'add_paper', title: 'b', rationale: 'r', estimated_effort: 'low', risk: '', target: {}, created_at: 100 },
  ];
  const r = selectFewShotExamples(history);
  // 同分 → tie-breaker:2 较新
  assert.equal(r[0].sourceId, '2');
});

test('selectFewShotExamples: 输出顺序稳定 (同输入 → 同输出)', () => {
  const history = [
    { id: '1', type: 'add_paper', title: 'a', rationale: 'r', estimated_effort: 'low', risk: '', target: { projectId: 'X' }, created_at: 1 },
    { id: '2', type: 'add_paper', title: 'b', rationale: 'r', estimated_effort: 'low', risk: '', target: {}, created_at: 2 },
  ];
  const r1 = selectFewShotExamples(history, { projectId: 'X' });
  const r2 = selectFewShotExamples(history, { projectId: 'X' });
  assert.deepEqual(r1.map((e) => e.sourceId), r2.map((e) => e.sourceId));
});

test('selectFewShotExamples: 输出上限 k', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({
    id: 'p' + i,
    type: 'add_paper',
    title: 't' + i,
    rationale: 'r',
    estimated_effort: 'low',
    risk: '',
    target: {},
    created_at: i,
  }));
  const r = selectFewShotExamples(history, { k: 5 });
  assert.equal(r.length, 5);
});

test('selectFewShotExamples: FewShotExample 字段完整', () => {
  const history = [{
    id: '1',
    type: 'add_paper',
    title: 'My Title',
    rationale: 'why',
    estimated_effort: 'high',
    risk: 'some risk',
    target: {},
    created_at: 1,
  }];
  const r = selectFewShotExamples(history);
  assert.equal(r[0].type, 'add_paper');
  assert.equal(r[0].title, 'My Title');
  assert.equal(r[0].rationale, 'why');
  assert.equal(r[0].estimated_effort, 'high');
  assert.equal(r[0].risk, 'some risk');
  assert.equal(r[0].sourceId, '1');
});

// ---------- renderFewShotBlock ----------
test('renderFewShotBlock: 空 → 空串', () => {
  assert.equal(renderFewShotBlock([]), '');
});

test('renderFewShotBlock: 含 # 示例 header', () => {
  const r = renderFewShotBlock([{
    type: 'add_paper',
    title: 't',
    rationale: 'r',
    estimated_effort: 'low',
    risk: '',
    score: 0.5,
    sourceId: '1',
  }]);
  assert.ok(r.includes('# 示例'));
});

test('renderFewShotBlock: ## Example N 编号', () => {
  const ex = {
    type: 'add_paper', title: 't', rationale: 'r',
    estimated_effort: 'low', risk: '', score: 0.5, sourceId: '1',
  };
  const r = renderFewShotBlock([ex, ex, ex]);
  assert.ok(r.includes('## Example 1'));
  assert.ok(r.includes('## Example 2'));
  assert.ok(r.includes('## Example 3'));
});

test('renderFewShotBlock: JSON code 块', () => {
  const r = renderFewShotBlock([{
    type: 'add_paper',
    title: 't',
    rationale: 'r',
    estimated_effort: 'low',
    risk: '',
    score: 0.5,
    sourceId: '1',
  }]);
  assert.ok(r.includes('```json'));
  assert.ok(r.includes('```'));
  assert.ok(r.includes('"type": "add_paper"'));
});

test('renderFewShotBlock: score / sourceId 不出现在 JSON 内', () => {
  const r = renderFewShotBlock([{
    type: 'add_paper',
    title: 't',
    rationale: 'r',
    estimated_effort: 'low',
    risk: '',
    score: 0.99,
    sourceId: 'abc',
  }]);
  // JSON.stringify 只含 5 个字段,不暴露 score/sourceId
  assert.ok(!r.includes('"score"'));
  assert.ok(!r.includes('"sourceId"'));
});