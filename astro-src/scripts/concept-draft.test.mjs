#!/usr/bin/env node
// astro-src/scripts/concept-draft.test.mjs
//
// Tests for R7 G.3.1 concept draft validation + YAML rendering.

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

const mod = await loadTs('lib/concepts/draft.ts');
const { validateConceptDraft, renderConceptYamlSnippet } = mod;

// ----- validateConceptDraft -----

test('validateConceptDraft: 完整合法 → 无 error', () => {
  const r = validateConceptDraft({
    slug: 'activation-steering',
    display_name: 'Activation Steering',
    category: 'method',
    novelty: 0.8,
    centrality: 0.7,
  });
  assert.deepEqual(r.errors, []);
});

test('validateConceptDraft: 缺 slug → error', () => {
  const r = validateConceptDraft({
    slug: '', display_name: 'X', category: 'method',
  });
  assert.ok(r.errors.some((e) => e.includes('slug')));
});

test('validateConceptDraft: 非 kebab slug → error', () => {
  const r = validateConceptDraft({
    slug: 'BadSlug', display_name: 'X', category: 'method',
  });
  assert.ok(r.errors.some((e) => e.includes('kebab')));
});

test('validateConceptDraft: 已存在 slug → error', () => {
  const r = validateConceptDraft({
    slug: 'transformer', display_name: 'X', category: 'method',
  }, ['transformer', 'attention']);
  assert.ok(r.errors.some((e) => e.includes('已存在')));
});

test('validateConceptDraft: 缺 display_name → error', () => {
  const r = validateConceptDraft({
    slug: 'x', display_name: '', category: 'method',
  });
  assert.ok(r.errors.some((e) => e.includes('显示名')));
});

test('validateConceptDraft: 非标准 category → warning(非 error)', () => {
  const r = validateConceptDraft({
    slug: 'x', display_name: 'X', category: 'unknown',
  });
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.includes('非标准')));
});

test('validateConceptDraft: novelty 越界 → error', () => {
  const r = validateConceptDraft({
    slug: 'x', display_name: 'X', category: 'method', novelty: 1.5,
  });
  assert.ok(r.errors.some((e) => e.includes('novelty')));
});

test('validateConceptDraft: parent 不存在 → warning', () => {
  const r = validateConceptDraft({
    slug: 'x', display_name: 'X', category: 'method', parent: 'missing-parent',
  }, ['transformer']);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.includes('parent')));
});

test('validateConceptDraft: arxiv id 格式错 → warning', () => {
  const r = validateConceptDraft({
    slug: 'x', display_name: 'X', category: 'method',
    arxivIds: ['bad-id', '2506.12345'],
  });
  assert.ok(r.warnings.some((w) => w.includes('bad-id')));
  assert.equal(r.warnings.filter((w) => w.includes('2506.12345')).length, 0);
});

// ----- renderConceptYamlSnippet -----

test('renderConceptYamlSnippet: 基本字段', () => {
  const y = renderConceptYamlSnippet({
    slug: 'activation-steering',
    display_name: 'Activation Steering',
    category: 'method',
    novelty: 0.8,
    centrality: 0.7,
  });
  assert.match(y, /slug: activation-steering/);
  assert.match(y, /display_name: Activation Steering/);
  assert.match(y, /category: method/);
  assert.match(y, /novelty: 0\.8/);
});

test('renderConceptYamlSnippet: 含 arxivIds 输出 paper_ids', () => {
  const y = renderConceptYamlSnippet({
    slug: 'x', display_name: 'X', category: 'method',
    arxivIds: ['2506.12345', '2506.67890'],
  });
  assert.match(y, /paper_ids:/);
  assert.match(y, /- 2506\.12345/);
  assert.match(y, /- 2506\.67890/);
});

test('renderConceptYamlSnippet: parent 输出', () => {
  const y = renderConceptYamlSnippet({
    slug: 'self-attention', display_name: 'Self-Attention',
    category: 'method', parent: 'transformer',
  });
  assert.match(y, /parent: transformer/);
});

test('renderConceptYamlSnippet: 含特殊字符的 display_name 加引号', () => {
  const y = renderConceptYamlSnippet({
    slug: 'x', display_name: 'Foo: Bar', category: 'method',
  });
  assert.match(y, /display_name: "Foo: Bar"/);
});

test('renderConceptYamlSnippet: 空 draft 用占位符', () => {
  const y = renderConceptYamlSnippet({
    slug: '', display_name: '', category: 'method',
  });
  assert.match(y, /slug: <slug>/);
  // display_name 占位符可能被引号包裹(<>字符触发)
  assert.match(y, /display_name.*display_name/);
});

test('renderConceptYamlSnippet: 不输出空字段', () => {
  const y = renderConceptYamlSnippet({
    slug: 'x', display_name: 'X', category: 'method',
  });
  assert.ok(!y.includes('novelty:'));
  assert.ok(!y.includes('centrality:'));
  assert.ok(!y.includes('parent:'));
  assert.ok(!y.includes('paper_ids:'));
});