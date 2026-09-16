#!/usr/bin/env node
// astro-src/scripts/llm-route.test.mjs
//
// Tests for R7 polish: astro-src/lib/llm/route.ts stage → LLM route resolver.

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
    external: ['../../scripts/settings', '../settings', './settings'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/llm/route.ts');
const { resolveRoute, invalidateRouteCache } = mod;

test('resolveRoute: analyzer_system', () => {
  invalidateRouteCache();
  const r = resolveRoute('analyzer_system');
  assert.equal(r.provider, 'deepseek');
  assert.equal(r.model, 'deepseek-chat');
  assert.equal(r.temperature, 0.2);
});

test('resolveRoute: analyzer_deepdive 流式', () => {
  invalidateRouteCache();
  const r = resolveRoute('analyzer_deepdive');
  assert.equal(r.isStream, true);
});

test('resolveRoute: library_relevance 用 reasoner 模型', () => {
  invalidateRouteCache();
  const r = resolveRoute('library_relevance');
  assert.equal(r.model, 'deepseek-reasoner');
});

test('resolveRoute: topic_report 流式', () => {
  invalidateRouteCache();
  const r = resolveRoute('topic_report');
  assert.equal(r.isStream, true);
});

test('resolveRoute: 未知 stage 回退 default', () => {
  invalidateRouteCache();
  const r = resolveRoute('unknown-stage-xyz');
  assert.equal(r.provider, 'deepseek');
  assert.equal(r.model, 'deepseek-chat');
});

test('resolveRoute: 60s TTL 缓存', async () => {
  invalidateRouteCache();
  const r1 = resolveRoute('analyzer_system');
  const r2 = resolveRoute('analyzer_system');
  // 同一对象(缓存命中)
  assert.equal(r1, r2);
});

test('invalidateRouteCache: 清空后下次重新计算', () => {
  resolveRoute('analyzer_system');
  invalidateRouteCache();
  const r = resolveRoute('analyzer_system');
  assert.ok(r);
});

test('resolveRoute: library_figure 用 gemini', () => {
  invalidateRouteCache();
  const r = resolveRoute('library_figure');
  assert.equal(r.model, 'gemini-2.5-pro');
});

test('resolveRoute: elo.debate 高温度(辩论)', () => {
  invalidateRouteCache();
  const r = resolveRoute('elo.debate');
  assert.equal(r.temperature, 0.7);
});

test('resolveRoute: enrich', () => {
  invalidateRouteCache();
  const r = resolveRoute('enrich');
  assert.equal(r.model, 'gemini-3-flash-preview');
});

test('resolveRoute: 所有 stage 有 temperature 字段', () => {
  invalidateRouteCache();
  const stages = [
    'enrich',
    'analyzer_system',
    'analyzer_deepdive',
    'topic_facet',
    'topic_summary',
    'topic_report',
    'topic_cand',
    'topic_explore',
    'topic_chat',
    'topic_report_chat',
    'library_compile',
    'library_relevance',
    'library_concept_def',
    'library_figure',
    'library_digest',
    'library_digest_synth',
    'library_trend',
    'library_chat',
    'paper.method_debate',
    'paper.deep_extract',
    'topic.debate',
    'elo.debate',
    'default',
  ];
  for (const s of stages) {
    const r = resolveRoute(s);
    assert.equal(typeof r.temperature, 'number', `${s} 应有 temperature`);
    assert.ok(r.temperature >= 0 && r.temperature <= 1, `${s} 温度在 [0,1]`);
  }
});

test('resolveRoute: temperature 在合理范围', () => {
  invalidateRouteCache();
  const r = resolveRoute('default');
  assert.ok(r.temperature >= 0);
  assert.ok(r.temperature <= 1);
});