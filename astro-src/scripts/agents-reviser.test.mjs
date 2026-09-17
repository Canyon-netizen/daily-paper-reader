#!/usr/bin/env node
// astro-src/scripts/agents-reviser.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/reviser.mjs.
// reviseDraft (stub mode, 无 LLM caller) +
// formatRevisionText (revision log markdown) +
// toJSON (revision verdict 序列化)。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadMjs(relPath) {
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

const mod = await loadMjs('lib/agents/reviser.mjs');
const { reviseDraft, formatRevisionText, toJSON } = mod;

const mkDraft = (overrides = {}) => ({
  title: 'Test Draft',
  abstract: 'abstract text',
  body: '# Original body\n\nSome content here.',
  ...overrides,
});

const mkVerdict = (concerns = []) => ({ concerns });

const mkConcern = (overrides = {}) => ({
  severity: 'major',
  category: 'clarity',
  detail: 'detail text',
  ...overrides,
});

// ---------- reviseDraft: stub mode ---
test('reviseDraft: 无 caller → stub 模式', async () => {
  const r = await reviseDraft(mkDraft(), mkVerdict([mkConcern()]));
  assert.equal(r.stub, true);
});

test('reviseDraft: caller 但缺 callLLM 方法 → stub', async () => {
  const r = await reviseDraft(mkDraft(), mkVerdict([mkConcern()]), {
    caller: {}, // 无 callLLM 方法
  });
  assert.equal(r.stub, true);
});

test('reviseDraft: stub 返回完整 RevisionVerdict', async () => {
  const r = await reviseDraft(mkDraft(), mkVerdict([mkConcern()]));
  assert.ok(typeof r.body === 'string');
  assert.ok(Array.isArray(r.log));
  assert.ok(typeof r.generatedAt === 'number');
  assert.equal(typeof r.addressedCount, 'number');
  assert.equal(typeof r.partialCount, 'number');
  assert.equal(typeof r.notAddressedCount, 'number');
});

test('reviseDraft: stub 保留 draftId', async () => {
  const r = await reviseDraft(mkDraft(), mkVerdict([mkConcern()]), {
    draftId: 'd-001',
  });
  assert.equal(r.draftId, 'd-001');
});

test('reviseDraft: stub 含 "Revision Notes" 段', async () => {
  const r = await reviseDraft(mkDraft(), mkVerdict([mkConcern()]));
  assert.match(r.body, /Revision Notes/);
});

test('reviseDraft: stub 保留原 body', async () => {
  const draft = mkDraft({ body: '## Original section\n\ntext' });
  const r = await reviseDraft(draft, mkVerdict([mkConcern()]));
  assert.match(r.body, /Original section/);
});

// ---------- stub 策略 ---
test('reviseDraft: minor concern → addressed', async () => {
  const r = await reviseDraft(mkDraft(), mkVerdict([
    mkConcern({ severity: 'minor' }),
  ]));
  assert.equal(r.log[0].status, 'addressed');
  assert.equal(r.addressedCount, 1);
});

test('reviseDraft: major + baseline → addressed', async () => {
  const r = await reviseDraft(mkDraft(), mkVerdict([
    mkConcern({ severity: 'major', detail: 'Missing baseline comparison' }),
  ]));
  assert.equal(r.log[0].status, 'addressed');
});

test('reviseDraft: major + novelty → addressed', async () => {
  const r = await reviseDraft(mkDraft(), mkVerdict([
    mkConcern({ severity: 'major', detail: 'Novelty discussion missing' }),
  ]));
  assert.equal(r.log[0].status, 'addressed');
});

test('reviseDraft: major + 其他 → partial', async () => {
  const r = await reviseDraft(mkDraft(), mkVerdict([
    mkConcern({ severity: 'major', detail: 'Soundness issue unclear' }),
  ]));
  assert.equal(r.log[0].status, 'partial');
  assert.equal(r.partialCount, 1);
});

test('reviseDraft: 多 concerns 计数正确', async () => {
  const r = await reviseDraft(mkDraft(), mkVerdict([
    mkConcern({ severity: 'minor' }),
    mkConcern({ severity: 'major', detail: 'baseline issue' }),
    mkConcern({ severity: 'major', detail: 'novelty issue' }),
    mkConcern({ severity: 'major', detail: 'soundness unclear' }),
  ]));
  assert.equal(r.addressedCount, 3); // minor + baseline + novelty
  assert.equal(r.partialCount, 1); // soundness
  assert.equal(r.log.length, 4);
});

// ---------- 边界 ---
test('reviseDraft: 无 concerns → 空 log', async () => {
  const r = await reviseDraft(mkDraft(), mkVerdict([]));
  assert.equal(r.log.length, 0);
  assert.equal(r.addressedCount, 0);
  assert.equal(r.partialCount, 0);
  assert.equal(r.notAddressedCount, 0);
});

test('reviseDraft: 缺 verdict.concerns → 不抛', async () => {
  const r = await reviseDraft(mkDraft(), {});
  assert.ok(Array.isArray(r.log));
});

test('reviseDraft: 缺 verdict → 不抛', async () => {
  const r = await reviseDraft(mkDraft(), null);
  assert.ok(Array.isArray(r.log));
});

// ---------- formatRevisionText ---
test('formatRevisionText: null → "(empty revision)"', () => {
  assert.equal(formatRevisionText(null), '(empty revision)');
});

test('formatRevisionText: 含计数', () => {
  const r = formatRevisionText({
    addressedCount: 2, partialCount: 1, notAddressedCount: 0,
    log: [], stub: true,
  });
  assert.match(r, /Addressed.*2/);
  assert.match(r, /Partial.*1/);
  assert.match(r, /Not addressed.*0/);
});

test('formatRevisionText: stub 模式提示', () => {
  const r = formatRevisionText({
    addressedCount: 0, partialCount: 0, notAddressedCount: 0,
    log: [], stub: true,
  });
  assert.match(r, /stub/i);
});

test('formatRevisionText: 非 stub 不显示 stub 行', () => {
  const r = formatRevisionText({
    addressedCount: 0, partialCount: 0, notAddressedCount: 0,
    log: [], stub: false,
  });
  assert.ok(!r.includes('Mode'));
});

test('formatRevisionText: per-concern log 行', () => {
  const r = formatRevisionText({
    addressedCount: 1, partialCount: 1, notAddressedCount: 1,
    log: [
      { concernIdx: 0, severity: 'minor', category: 'clarity', status: 'addressed', change: 'done' },
      { concernIdx: 1, severity: 'major', category: 'soundness', status: 'partial', change: 'half' },
      { concernIdx: 2, severity: 'major', category: 'novelty', status: 'not_addressed', change: 'no' },
    ],
    stub: false,
  });
  assert.match(r, /Per-concern log/);
  assert.match(r, /✓/); // addressed
  assert.match(r, /~/); // partial
  assert.match(r, /✗/); // not_addressed
});

test('formatRevisionText: 显示 severity + category + change', () => {
  const r = formatRevisionText({
    addressedCount: 1, partialCount: 0, notAddressedCount: 0,
    log: [
      { concernIdx: 0, severity: 'major', category: 'experiments', status: 'addressed', change: 'added baselines' },
    ],
    stub: false,
  });
  assert.match(r, /\[major\]/);
  assert.match(r, /experiments/);
  assert.match(r, /added baselines/);
});

// ---------- toJSON ---
test('toJSON: null → null', () => {
  assert.equal(toJSON(null), null);
});

test('toJSON: undefined → null', () => {
  assert.equal(toJSON(undefined), null);
});

test('toJSON: 序列化为 plain object', () => {
  const rev = {
    draftId: 'd1',
    body: 'body text',
    log: [{ concernIdx: 0, severity: 'major', category: 'clarity', status: 'addressed', change: 'c' }],
    addressedCount: 1,
    partialCount: 0,
    notAddressedCount: 0,
    generatedAt: 1000,
    stub: 1, // truthy
  };
  const r = toJSON(rev);
  assert.equal(r.draftId, 'd1');
  assert.equal(r.body, 'body text');
  assert.equal(r.stub, true); // !!1 → true
});

test('toJSON: stub 字段转为 bool', () => {
  const r = toJSON({
    draftId: null, body: '', log: [],
    addressedCount: 0, partialCount: 0, notAddressedCount: 0,
    generatedAt: 0, stub: 0,
  });
  assert.equal(r.stub, false);
});

test('toJSON: 字段完整', () => {
  const rev = {
    draftId: 'd1', body: 'b', log: [],
    addressedCount: 1, partialCount: 2, notAddressedCount: 3,
    generatedAt: 9999, stub: false,
  };
  const r = toJSON(rev);
  assert.ok('draftId' in r);
  assert.ok('body' in r);
  assert.ok('log' in r);
  assert.ok('addressedCount' in r);
  assert.ok('partialCount' in r);
  assert.ok('notAddressedCount' in r);
  assert.ok('generatedAt' in r);
  assert.ok('stub' in r);
});

// ---------- 集成 ---
test('集成: stub revise → format → toJSON', async () => {
  const rev = await reviseDraft(mkDraft(), mkVerdict([
    mkConcern({ severity: 'minor' }),
    mkConcern({ severity: 'major', detail: 'baseline' }),
  ]));
  const text = formatRevisionText(rev);
  const json = toJSON(rev);
  assert.match(text, /Paper Revision/);
  assert.equal(json.stub, true);
  assert.ok(json.body.length > 0);
});