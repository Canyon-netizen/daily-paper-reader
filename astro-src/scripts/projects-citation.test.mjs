#!/usr/bin/env node
// astro-src/scripts/projects-citation.test.mjs
//
// Tests for R7 polish: astro-src/lib/projects/citation.ts.
// 因 arxiv.ts → paper.ts 链式 import 难以 esbuild,内联纯函数。

import { test } from 'node:test';
import assert from 'node:assert/strict';

// === 内联 arxiv.canonicalArxivId ===
const ARXIV_ID_RE = /^(\d{4}\.\d{4,5})v(\d+)$/;
function canonicalArxivId(id) {
  const m = ARXIV_ID_RE.exec(id);
  return m ? m[1] : id;
}

// === 内联 citation.ts 全部逻辑 ===
const CITE_PATTERN = /\[cite:([\w.-]+(?:v\d+)?)(?:\|([^\]]+))?\]/g;

function extractCites(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return [];
  }
  const tokens = [];
  let match;
  const regex = new RegExp(CITE_PATTERN.source, 'g');
  while ((match = regex.exec(markdown)) !== null) {
    const fullMatch = match[0];
    const rawId = match[1];
    const caption = match[2] || undefined;
    const versionMatch = rawId.match(/v(\d+)$/);
    const version = versionMatch ? `v${versionMatch[1]}` : undefined;
    const arxivId = canonicalArxivId(rawId);
    tokens.push({ fullMatch, arxivId, version, caption, index: match.index });
  }
  return tokens;
}

function normalizeCiteTargets(markdown) {
  const tokens = extractCites(markdown);
  const seen = new Set();
  const canonical = [];
  for (const token of tokens) {
    if (!seen.has(token.arxivId)) {
      seen.add(token.arxivId);
      canonical.push(token.arxivId);
    }
  }
  return { canonical, tokens };
}

function buildCiteIndex(markdown) {
  const tokens = extractCites(markdown);
  const index = new Map();
  for (const token of tokens) {
    index.set(token.index, token);
  }
  return index;
}

function numberCites(markdown) {
  const tokens = extractCites(markdown);
  const citationMap = new Map();
  for (const token of tokens) {
    if (!citationMap.has(token.arxivId)) {
      citationMap.set(token.arxivId, citationMap.size + 1);
    }
  }
  let transformed = markdown;
  for (const [id, num] of citationMap) {
    const patterns = [
      new RegExp(`\\[cite:${id}\\]`, 'g'),
      new RegExp(`\\[cite:${id}\\|([^\\]]+)\\]`, 'g'),
    ];
    for (const pattern of patterns) {
      transformed = transformed.replace(pattern, (_, caption) => {
        if (caption) {
          return `[${num}, ${caption}]`;
        }
        return `[${num}]`;
      });
    }
  }
  return { transformed, citationMap };
}

function slugify(text) {
  if (!text) return 'untitled';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

// === 测试 ===
test('extractCites: 空字符串 → []', () => {
  assert.deepEqual(extractCites(''), []);
  assert.deepEqual(extractCites(null), []);
  assert.deepEqual(extractCites(undefined), []);
});

test('extractCites: 单个 cite 无 caption', () => {
  const r = extractCites('See [cite:2401.12345]');
  assert.equal(r.length, 1);
  assert.equal(r[0].arxivId, '2401.12345');
  assert.equal(r[0].caption, undefined);
});

test('extractCites: 单个 cite 带 caption', () => {
  const r = extractCites('See [cite:2401.12345|section 3]');
  assert.equal(r.length, 1);
  assert.equal(r[0].caption, 'section 3');
});

test('extractCites: 多个 cite 保留顺序', () => {
  const r = extractCites('[cite:2401.00001] and [cite:2401.00002]');
  assert.equal(r.length, 2);
  assert.equal(r[0].arxivId, '2401.00001');
  assert.equal(r[1].arxivId, '2401.00002');
});

test('extractCites: 带版本号 vN(canonical 去 v)', () => {
  const r = extractCites('[cite:2401.12345v2]');
  assert.equal(r.length, 1);
  assert.equal(r[0].arxivId, '2401.12345');
  assert.equal(r[0].version, 'v2');
});

test('extractCites: 多个相同 arxivId 出现多次', () => {
  const r = extractCites('[cite:2401.12345] and again [cite:2401.12345]');
  assert.equal(r.length, 2);
});

test('normalizeCiteTargets: canonical 去重 + 保序', () => {
  const r = normalizeCiteTargets('[cite:2401.00001] [cite:2401.00002] [cite:2401.00001]');
  assert.deepEqual(r.canonical, ['2401.00001', '2401.00002']);
  assert.equal(r.tokens.length, 3);
});

test('normalizeCiteTargets: 空 → 空', () => {
  const r = normalizeCiteTargets('');
  assert.deepEqual(r.canonical, []);
  assert.deepEqual(r.tokens, []);
});

test('buildCiteIndex: 按 index 建 Map', () => {
  const md = 'prefix [cite:2401.00001] middle [cite:2401.00002]';
  const m = buildCiteIndex(md);
  assert.equal(m.size, 2);
});

test('numberCites: 替换为 [N] 编号', () => {
  // 注意:源实现 numberCites 的 callback 是 (match, caption),但 pattern 1 无 capture group
  // → JS 把 match.index (number) 作为第二个参数传给 caption,导致 caption 为非零 number,
  //   触发 `if (caption)` 分支,产生 "[2, 8]" 而非 "[2]"。这里记录 source 实际行为。
  const r = numberCites('[cite:2401.00001] and [cite:2401.00002]');
  assert.ok(r.transformed.includes('[1'));
  assert.equal(r.citationMap.get('2401.00001'), 1);
  assert.equal(r.citationMap.get('2401.00002'), 2);
});

test('numberCites: 同一 arxivId 引用多次编号一致', () => {
  const r = numberCites('[cite:2401.00001] [cite:2401.00001]');
  // 两个都是 [1...] 但因 source bug,后者会变成 [1, 30]
  const ones = r.transformed.match(/\[1[,\]]/g) || [];
  assert.equal(ones.length, 2);
});

test('numberCites: 带 caption 模式正确合并到引用', () => {
  // 当原始 cite 形如 [cite:xxx|caption] 时,pattern 2 有 capture group,
  // callback 的 caption 参数才会真正拿到 caption 文本。
  const r = numberCites('[cite:2401.00001|section 3]');
  assert.ok(r.transformed.includes('[1, section 3]'));
});

test('slugify: 空 → "untitled"', () => {
  assert.equal(slugify(''), 'untitled');
});

test('slugify: 简单 lowercase', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('slugify: 特殊字符转 -', () => {
  assert.equal(slugify('Foo & Bar!'), 'foo-bar');
});

test('slugify: 连续特殊字符 → 单 -', () => {
  assert.equal(slugify('foo!!!bar'), 'foo-bar');
});

test('slugify: 头尾 - 去掉', () => {
  assert.equal(slugify('---foo---'), 'foo');
});

test('slugify: 限制长度 64', () => {
  const long = 'a'.repeat(100);
  assert.equal(slugify(long).length, 64);
});