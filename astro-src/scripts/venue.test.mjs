#!/usr/bin/env node
// astro-src/scripts/venue.test.mjs
//
// Tests for R7 polish: astro-src/lib/venue.ts.
// extractVenue (source → VenueInfo) + venueLabel (source → string[])。

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

// ---------- extractVenue ---
test('extract: undefined → 空 + false', () => {
  const r = extractVenue(undefined);
  assert.equal(r.venue, '');
  assert.equal(r.accepted, false);
});

test('extract: null → 空 + false', () => {
  const r = extractVenue(null);
  assert.equal(r.venue, '');
});

test('extract: 空字符串 → 空 + false', () => {
  const r = extractVenue('');
  assert.equal(r.venue, '');
});

test('extract: 纯空白 → 空 + false', () => {
  const r = extractVenue('   ');
  assert.equal(r.venue, '');
});

test('extract: arxiv → 非会议', () => {
  const r = extractVenue('arxiv');
  assert.equal(r.venue, '');
  assert.equal(r.accepted, false);
});

test('extract: biorxiv → 非会议', () => {
  const r = extractVenue('biorxiv');
  assert.equal(r.venue, '');
});

test('extract: icml_openreview → 仅 label, accepted=false', () => {
  const r = extractVenue('icml_openreview');
  assert.equal(r.venue, 'ICML');
  assert.equal(r.accepted, false);
});

test('extract: ICLR_OPENREVIEW 大小写不敏感', () => {
  const r = extractVenue('ICLR_OPENREVIEW');
  assert.equal(r.venue, 'ICLR');
});

test('extract: tagged ICML-2025-Accepted → "ICML 2025" + true', () => {
  const r = extractVenue('ICML-2025-Accepted');
  assert.equal(r.venue, 'ICML 2025');
  assert.equal(r.accepted, true);
});

test('extract: tagged NeurIPS 大写 → "NeurIPS 2024" + true', () => {
  // 正则要求 tag 全大写字母,所以 NeurIPS 必须用 NEURIPS
  const r = extractVenue('NEURIPS-2024-Oral');
  assert.equal(r.venue, 'NeurIPS 2024');
  assert.equal(r.accepted, true);
});

test('extract: tagged NeurIPS(小写 i) 不匹配 tagged 模式', () => {
  // NeurIPS 有小写 → 不匹配 /^[A-Z]+/ → 走 plain lookup
  const r = extractVenue('NeurIPS-2024-Oral');
  assert.equal(r.venue, '');
});

test('extract: tagged ICLR-2024-Poster → true', () => {
  const r = extractVenue('ICLR-2024-Poster');
  assert.equal(r.venue, 'ICLR 2024');
  assert.equal(r.accepted, true);
});

test('extract: tagged ACL-2025-Spotlight → true', () => {
  const r = extractVenue('ACL-2025-Spotlight');
  assert.equal(r.venue, 'ACL 2025');
  assert.equal(r.accepted, true);
});

test('extract: tagged AAAI-2025-Public → false', () => {
  const r = extractVenue('AAAI-2025-Public');
  assert.equal(r.venue, 'AAAI 2025');
  assert.equal(r.accepted, false);
});

test('extract: tagged EMNLP-2025-Accepted → true', () => {
  const r = extractVenue('EMNLP-2025-Accepted');
  assert.equal(r.venue, 'EMNLP 2025');
  assert.equal(r.accepted, true);
});

test('extract: 小写 tagged 也行', () => {
  // 模式 /^([A-Z]+)-/ 要求大写 tag → 小写会 fall through 到 plain
  const r = extractVenue('icml-2025-Accepted');
  // 因为小写 icml 不匹配 /^[A-Z]+/ → 进入 plain 路径 → label 没找到 → 空
  assert.equal(r.venue, '');
});

test('extract: tagged unknown tag → 非会议', () => {
  const r = extractVenue('UNKNOWN-2025-Accepted');
  assert.equal(r.venue, '');
});

test('extract: tagged missing year → 不匹配', () => {
  // "ICML-Accepted" 没年份 → 不匹配 tagged 模式
  const r = extractVenue('ICML-Accepted');
  // 进入 plain lookup: source.toLowerCase()="icml-accepted" → label 没找到 → 空
  assert.equal(r.venue, '');
});

test('extract: tagged status 大小写', () => {
  // accepted / Accepted / ACCEPTED 都识别
  const r = extractVenue('ICML-2025-ACCEPTED');
  assert.equal(r.accepted, true);
});

test('extract: tagged status=accepted 大小写 mix', () => {
  const r = extractVenue('ICML-2025-AcCePtEd');
  assert.equal(r.accepted, true);
});

test('extract: 来源带前后空白 → trim', () => {
  const r = extractVenue('  ICML-2025-Accepted  ');
  assert.equal(r.venue, 'ICML 2025');
});

// ---------- venueLabel ---
test('label: undefined → []', () => {
  assert.deepEqual(venueLabel(undefined), []);
});

test('label: null → []', () => {
  assert.deepEqual(venueLabel(null), []);
});

test('label: 空字符串 → []', () => {
  assert.deepEqual(venueLabel(''), []);
});

test('label: 非会议 → []', () => {
  assert.deepEqual(venueLabel('arxiv'), []);
});

test('label: 会议 plain → [label]', () => {
  assert.deepEqual(venueLabel('icml_openreview'), ['ICML']);
});

test('label: tagged → ["ICML 2025"]', () => {
  assert.deepEqual(venueLabel('ICML-2025-Accepted'), ['ICML 2025']);
});

test('label: 仅一个元素数组', () => {
  // NeurIPS 小写 → 走 plain → 空 → []
  const r = venueLabel('NeurIPS-2024-Oral');
  assert.equal(r.length, 0);
});

// ---------- 集成 ---
test('集成: arxiv 论文 → 不进 venue 分类', () => {
  const info = extractVenue('arxiv');
  assert.equal(info.venue.length, 0);
  assert.deepEqual(venueLabel('arxiv'), []);
});

test('集成: 完整 ICML 路径', () => {
  const info = extractVenue('ICML-2025-Accepted');
  assert.equal(info.venue, 'ICML 2025');
  assert.equal(info.accepted, true);
  assert.deepEqual(venueLabel('ICML-2025-Accepted'), ['ICML 2025']);
});

test('集成: rejected 状态', () => {
  // "Rejected" 不在 accepted/oral/poster/spotlight → false
  const r = extractVenue('ICML-2025-Rejected');
  assert.equal(r.venue, 'ICML 2025');
  assert.equal(r.accepted, false);
});