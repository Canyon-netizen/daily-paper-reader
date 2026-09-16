#!/usr/bin/env node
// astro-src/scripts/venue.test.mjs
//
// Tests for R7 polish: astro-src/lib/venue.ts.

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

const mod = await loadTs('lib/venue.ts');
const { extractVenue, venueLabel } = mod;

test('extractVenue: 空 → 空 venue', () => {
  assert.deepEqual(extractVenue(undefined), { venue: '', accepted: false });
  assert.deepEqual(extractVenue(null), { venue: '', accepted: false });
  assert.deepEqual(extractVenue(''), { venue: '', accepted: false });
  assert.deepEqual(extractVenue('   '), { venue: '', accepted: false });
});

test('extractVenue: arxiv → 空 venue', () => {
  assert.deepEqual(extractVenue('arxiv'), { venue: '', accepted: false });
});

test('extractVenue: biorxiv → 空 venue', () => {
  assert.deepEqual(extractVenue('biorxiv'), { venue: '', accepted: false });
});

test('extractVenue: icml_openreview → ICML (无年, accepted=false)', () => {
  const r = extractVenue('icml_openreview');
  assert.equal(r.venue, 'ICML');
  assert.equal(r.accepted, false);
});

test('extractVenue: 6 个会议标签都识别', () => {
  for (const src of ['aaai', 'acl', 'emnlp', 'iclr_openreview', 'icml_openreview', 'neurips_openreview']) {
    const r = extractVenue(src);
    assert.ok(r.venue.length > 0, `${src} should have venue`);
    assert.equal(r.accepted, false);
  }
});

test('extractVenue: tagged "ICML-2025-Accepted" → ICML 2025 + accepted=true', () => {
  const r = extractVenue('ICML-2025-Accepted');
  assert.equal(r.venue, 'ICML 2025');
  assert.equal(r.accepted, true);
});

test('extractVenue: tagged "ICML-2025-Public" → accepted=false', () => {
  const r = extractVenue('ICML-2025-Public');
  assert.equal(r.venue, 'ICML 2025');
  assert.equal(r.accepted, false);
});

test('extractVenue: tagged "NEURIPS-2024-Poster" → NeurIPS 2024 + accepted=true', () => {
  // [A-Z]+ 只吃大写;NeurIPS 含小写 → 只有 NEURIPS (全大写) 匹配
  const r = extractVenue('NEURIPS-2024-Poster');
  assert.equal(r.venue, 'NeurIPS 2024');
  assert.equal(r.accepted, true);
});

test('extractVenue: tagged "NeurIPS-2024-Poster" (mixed) → 走 plain path (空 venue)', () => {
  // [A-Z]+ 不吃 e/u/r → 只匹配 N,taggedMatch 失败
  const r = extractVenue('NeurIPS-2024-Poster');
  assert.equal(r.venue, '');
});

test('extractVenue: tagged "ICML-2025-Oral" → accepted=true', () => {
  const r = extractVenue('ICML-2025-Oral');
  assert.equal(r.venue, 'ICML 2025');
  assert.equal(r.accepted, true);
});

test('extractVenue: tagged "ICML-2025-Spotlight" → accepted=true', () => {
  const r = extractVenue('ICML-2025-Spotlight');
  assert.equal(r.accepted, true);
});

test('extractVenue: tagged 但 tag 不在白名单 → 空 venue', () => {
  // 形如 "UNKNOWN-2025-Accepted" → tag 不匹配任何会议
  const r = extractVenue('UNKNOWN-2025-Accepted');
  assert.equal(r.venue, '');
});

test('extractVenue: tagged 格式不符 (无 year) → 走 plain path', () => {
  // "ICML-Accepted" → taggedMatch 失败,plain source 不存在 "ICML-Accepted"
  const r = extractVenue('ICML-Accepted');
  assert.equal(r.venue, '');
});

test('extractVenue: 小写 tagged (icml-2025-Accepted) → 走 plain path', () => {
  // pattern 不匹配 (开头不是 [A-Z]+) → plain lookup "icml-2025-Accepted" 不在 keys → 空
  const r = extractVenue('icml-2025-Accepted');
  assert.equal(r.venue, '');
});

test('extractVenue: 大写 NeurIPS 全大写', () => {
  const r = extractVenue('NEURIPS-2024-Accepted');
  assert.equal(r.venue, 'NeurIPS 2024');
  assert.equal(r.accepted, true);
});

test('venueLabel: 非会议源 → 空数组', () => {
  assert.deepEqual(venueLabel('arxiv'), []);
});

test('venueLabel: 会议源 → 单元素数组', () => {
  assert.deepEqual(venueLabel('icml_openreview'), ['ICML']);
});

test('venueLabel: tagged → 单元素数组', () => {
  assert.deepEqual(venueLabel('ICML-2025-Accepted'), ['ICML 2025']);
});

test('venueLabel: undefined → []', () => {
  assert.deepEqual(venueLabel(undefined), []);
});
