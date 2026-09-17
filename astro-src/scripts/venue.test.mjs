#!/usr/bin/env node
// astro-src/scripts/venue.test.mjs
//
// Tests for R7 polish: astro-src/lib/venue.ts.
// extractVenue + venueLabel — pure functions, no deps.

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

// ---------- extractVenue: empty / nullish ----------
test('extractVenue: undefined → { venue: "", accepted: false }', () => {
  assert.deepEqual(extractVenue(undefined), { venue: '', accepted: false });
});

test('extractVenue: null → { venue: "", accepted: false }', () => {
  assert.deepEqual(extractVenue(null), { venue: '', accepted: false });
});

test('extractVenue: 空字符串 → { venue: "", accepted: false }', () => {
  assert.deepEqual(extractVenue(''), { venue: '', accepted: false });
});

test('extractVenue: 纯空格 → { venue: "", accepted: false }', () => {
  assert.deepEqual(extractVenue('   '), { venue: '', accepted: false });
});

// ---------- extractVenue: 非会议源 ----------
test('extractVenue: arxiv → 空', () => {
  assert.deepEqual(extractVenue('arxiv'), { venue: '', accepted: false });
});

test('extractVenue: biorxiv → 空', () => {
  assert.deepEqual(extractVenue('biorxiv'), { venue: '', accepted: false });
});

test('extractVenue: medrxiv → 空', () => {
  assert.deepEqual(extractVenue('medrxiv'), { venue: '', accepted: false });
});

test('extractVenue: 未知源 → 空', () => {
  assert.deepEqual(extractVenue('mystery-source'), { venue: '', accepted: false });
});

// ---------- extractVenue: 纯会议源(无 tag) ----------
test('extractVenue: icml_openreview → ICML (无年, accepted=false)', () => {
  assert.deepEqual(extractVenue('icml_openreview'), { venue: 'ICML', accepted: false });
});

test('extractVenue: iclr_openreview → ICLR', () => {
  assert.deepEqual(extractVenue('iclr_openreview'), { venue: 'ICLR', accepted: false });
});

test('extractVenue: aaai → AAAI', () => {
  assert.deepEqual(extractVenue('aaai'), { venue: 'AAAI', accepted: false });
});

test('extractVenue: acl → ACL', () => {
  assert.deepEqual(extractVenue('acl'), { venue: 'ACL', accepted: false });
});

test('extractVenue: emnlp → EMNLP', () => {
  assert.deepEqual(extractVenue('emnlp'), { venue: 'EMNLP', accepted: false });
});

test('extractVenue: 连字符 icml-openreview (非已知 key) → 空', () => {
  // 源码 keys 用 underscore 不是 dash
  assert.deepEqual(extractVenue('icml-openreview'), { venue: '', accepted: false });
});

test('extractVenue: 大写 key (ICML_OPENREVIEW) → ICML', () => {
  // 'ICML_OPENREVIEW'.toLowerCase() === 'icml_openreview' → 命中
  assert.deepEqual(extractVenue('ICML_OPENREVIEW'), { venue: 'ICML', accepted: false });
});

// ---------- extractVenue: tagged ----------
test('extractVenue: ICML-2025-Accepted → ICML 2025 + accepted', () => {
  assert.deepEqual(extractVenue('ICML-2025-Accepted'), { venue: 'ICML 2025', accepted: true });
});

test('extractVenue: ICLR-2024-Public → ICLR 2024', () => {
  const r = extractVenue('ICLR-2024-Public');
  assert.equal(r.venue, 'ICLR 2024');
});

test('extractVenue: 状态 Rejected → accepted=false', () => {
  const r = extractVenue('ICML-2025-Rejected');
  assert.equal(r.venue, 'ICML 2025');
  assert.equal(r.accepted, false);
});

test('extractVenue: 状态 Oral (uppercase tag NEURIPS-2024-Oral) → accepted=true', () => {
  // tagged 正则要求 [A-Z]+ 全大写 → "NEURIPS" 而非 "NeurIPS"
  assert.equal(extractVenue('NEURIPS-2024-Oral').accepted, true);
});

test('extractVenue: 状态 Spotlight → accepted=true', () => {
  assert.equal(extractVenue('AAAI-2025-Spotlight').accepted, true);
});

test('extractVenue: 状态 Poster → accepted=true', () => {
  assert.equal(extractVenue('ACL-2024-Poster').accepted, true);
});

test('extractVenue: 未知 status → accepted=false', () => {
  assert.equal(extractVenue('ICML-2025-FooBar').accepted, false);
});

test('extractVenue: tagged 全小写 (icml-2025-accepted) → 不识别', () => {
  // tagged 正则 [A-Z]+ 不匹配小写;小写形式也不在 keys
  assert.equal(extractVenue('icml-2025-accepted').venue, '');
});

test('extractVenue: tagged 未知会议 (FOO-2025-Accepted) → 空', () => {
  assert.deepEqual(extractVenue('FOO-2025-Accepted'), { venue: '', accepted: false });
});

test('extractVenue: tagged 数字位含前导 0 (ICML-02025-Accepted)', () => {
  // \d{4} 严格要求 4 位 → 不匹配 → fallback 到纯 source 不识别 → 空
  const r = extractVenue('ICML-02025-Accepted');
  assert.equal(r.venue, '');
});

test('extractVenue: tagged 大写会议名 (NEURIPS-2024-Accepted) → 识别', () => {
  assert.equal(extractVenue('NEURIPS-2024-Accepted').venue, 'NeurIPS 2024');
});

test('extractVenue: tagged 数字不匹配 \d{4} (ICML-25-Accepted) → fallback', () => {
  // \d{4} 不匹配 → fallback 到 CONFERENCE_SOURCE_LABELS[lowercase]
  // 'iclml-25-accepted' 不在里面 → 空
  const r = extractVenue('ICML-25-Accepted');
  assert.equal(r.venue, '');
});

test('extractVenue: tagged 末尾无 -Status (ICML-2025)', () => {
  // '^([A-Z]+)-(\d{4})-(.+)$' 不匹配(缺第三段) → fallback 空
  const r = extractVenue('ICML-2025');
  assert.equal(r.venue, '');
});

// ---------- venueLabel ----------
test('venueLabel: ICML-2025-Accepted → ["ICML 2025"]', () => {
  assert.deepEqual(venueLabel('ICML-2025-Accepted'), ['ICML 2025']);
});

test('venueLabel: icml_openreview → ["ICML"]', () => {
  assert.deepEqual(venueLabel('icml_openreview'), ['ICML']);
});

test('venueLabel: arxiv → []', () => {
  assert.deepEqual(venueLabel('arxiv'), []);
});

test('venueLabel: undefined → []', () => {
  assert.deepEqual(venueLabel(undefined), []);
});

test('venueLabel: null → []', () => {
  assert.deepEqual(venueLabel(null), []);
});

test('venueLabel: 空字符串 → []', () => {
  assert.deepEqual(venueLabel(''), []);
});

test('venueLabel: 返回数组 (string[] 不是 string)', () => {
  assert.ok(Array.isArray(venueLabel('ICML-2025-Accepted')));
});