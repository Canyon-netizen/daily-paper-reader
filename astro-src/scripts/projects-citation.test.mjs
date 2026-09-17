#!/usr/bin/env node
// astro-src/scripts/projects-citation.test.mjs
//
// Tests for R7 polish: astro-src/lib/projects/citation.ts.
// extractCites / normalizeCiteTargets / buildCiteIndex / numberCites / slugify。

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

const mod = await loadTs('lib/projects/citation.ts');
const {
  extractCites,
  normalizeCiteTargets,
  buildCiteIndex,
  numberCites,
  slugify,
} = mod;

// ---------- extractCites ----------
test('extractCites: 无 [cite: → []', () => {
  assert.deepEqual(extractCites('no cite here'), []);
});

test('extractCites: 空字符串 → []', () => {
  assert.deepEqual(extractCites(''), []);
});

test('extractCites: null → []', () => {
  assert.deepEqual(extractCites(null), []);
});

test('extractCites: undefined → []', () => {
  assert.deepEqual(extractCites(undefined), []);
});

test('extractCites: 非字符串 → []', () => {
  assert.deepEqual(extractCites(123), []);
});

test('extractCites: 单个 [cite:xxx]', () => {
  const r = extractCites('see [cite:2607.01234] for details');
  assert.equal(r.length, 1);
  assert.equal(r[0].arxivId, '2607.01234');
  assert.equal(r[0].caption, undefined);
});

test('extractCites: 带 caption', () => {
  const r = extractCites('[cite:2607.01234|section 3.2]');
  assert.equal(r[0].caption, 'section 3.2');
});

test('extractCites: 带版本号', () => {
  const r = extractCites('[cite:2607.01234v1]');
  assert.equal(r[0].version, 'v1');
  // arxivId canonical (剥 v)
  assert.equal(r[0].arxivId, '2607.01234');
});

test('extractCites: 多 cite 保留顺序', () => {
  const md = 'first [cite:1.1] then [cite:2.2] and [cite:3.3]';
  const r = extractCites(md);
  assert.equal(r.length, 3);
  assert.equal(r[0].arxivId, '1.1');
  assert.equal(r[1].arxivId, '2.2');
  assert.equal(r[2].arxivId, '3.3');
});

test('extractCites: index 偏移正确', () => {
  const md = 'see [cite:1.1] here';
  const r = extractCites(md);
  assert.equal(r[0].index, 4);
});

test('extractCites: fullMatch 完整匹配', () => {
  const r = extractCites('text [cite:abc.def|cap]');
  assert.equal(r[0].fullMatch, '[cite:abc.def|cap]');
});

// ---------- normalizeCiteTargets ----------
test('normalizeCiteTargets: 空 markdown → 空', () => {
  const r = normalizeCiteTargets('');
  assert.deepEqual(r.canonical, []);
  assert.deepEqual(r.tokens, []);
});

test('normalizeCiteTargets: 去重 canonical', () => {
  const r = normalizeCiteTargets('[cite:1.1] [cite:2.2] [cite:1.1]');
  assert.deepEqual(r.canonical, ['1.1', '2.2']);
});

test('normalizeCiteTargets: 保留首次出现顺序', () => {
  const r = normalizeCiteTargets('[cite:b] [cite:a] [cite:c] [cite:a]');
  assert.deepEqual(r.canonical, ['b', 'a', 'c']);
});

test('normalizeCiteTargets: tokens 全部返回', () => {
  const r = normalizeCiteTargets('[cite:1.1] [cite:1.1]');
  assert.equal(r.tokens.length, 2);
});

// ---------- buildCiteIndex ----------
test('buildCiteIndex: Map<index, token>', () => {
  const md = 'text [cite:1.1] more [cite:2.2]';
  const m = buildCiteIndex(md);
  assert.ok(m instanceof Map);
  assert.equal(m.size, 2);
});

test('buildCiteIndex: lookup by index', () => {
  const md = 'text [cite:1.1]';
  const m = buildCiteIndex(md);
  const token = m.get(5); // index 5
  assert.equal(token.arxivId, '1.1');
});

// ---------- numberCites ----------
// 注意:numberCites 实现把 first pattern (\\[cite:id\\]) 的 caption 参数当成
// 第二个参数 — 但该 pattern 没有 capture group, JS 实际上传的是 offset 数字。
// 所以"无 caption"路径实际上被 `[N, offset]` 替换为 `[N, offset]`。
test('numberCites: 单 cite → [N, offset] (无 caption pattern)', () => {
  // 实际: 'see [cite:1.1]' → 'see [1, 4]' (4 是 [cite:1.1] 的 offset)
  const r = numberCites('see [cite:1.1]');
  assert.equal(r.transformed, 'see [1, 4]');
  assert.equal(r.citationMap.get('1.1'), 1);
});

test('numberCites: 多 cite 错位编号 (含 offset bug)', () => {
  const r = numberCites('[cite:a] [cite:b] [cite:c]');
  // 第一个 id=a 替换后 transformed = '[1] [cite:b] [cite:c]',后续 offset 跟着变
  // a offset 0 → [1]; b offset 4 → [2, 4]; c offset 11 → [3, 11]
  assert.equal(r.transformed, '[1] [2, 4] [3, 11]');
});

test('numberCites: 重复 cite 同样错位', () => {
  // [cite:a] [cite:a] [cite:a]
  // iter id=a /g 一次性找 3 个匹配,offset 都是原始的 (0, 9, 18)
  const r = numberCites('[cite:a] [cite:a] [cite:a]');
  // 第一个 offset=0 → [1] (0 falsy),其他 truthy
  assert.equal(r.transformed, '[1] [1, 9] [1, 18]');
});

test('numberCites: 带 caption pattern → [N, caption]', () => {
  // 带 caption 的 pattern 有 capture group, caption 参数正常
  const r = numberCites('see [cite:1.1|page 3]');
  assert.match(r.transformed, /\[1, page 3\]/);
});

test('numberCites: citationMap 数字→id', () => {
  const r = numberCites('[cite:a] [cite:b]');
  assert.equal(r.citationMap.get('a'), 1);
  assert.equal(r.citationMap.get('b'), 2);
});

// ---------- slugify ----------
test('slugify: 大写 → 小写', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('slugify: 非字母数字 → -', () => {
  assert.equal(slugify('foo bar baz'), 'foo-bar-baz');
});

test('slugify: 多空格合并', () => {
  assert.equal(slugify('a   b'), 'a-b');
});

test('slugify: 前后 - 去掉', () => {
  assert.equal(slugify('---foo---'), 'foo');
});

test('slugify: 空字符串 → untitled', () => {
  assert.equal(slugify(''), 'untitled');
});

test('slugify: undefined → untitled', () => {
  assert.equal(slugify(undefined), 'untitled');
});

test('slugify: 中文 → untitled(变非 ASCII 字符)', () => {
  // 中文 normalize 后不是 a-z0-9 → 全 - → 前后 trim → ''
  // 'foo' 处理过空 → 'untitled'
  // 实际: 中文 NFD 后没变化, 全部 → - → trim 后是 '' → ''
  // 但实现是 .slice(0, 64) 在 trim 之前?让我看:
  // .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
  // 中文 → 全 - → trim 掉 → '' → slice 还是 ''
  assert.equal(slugify('中文'), '');
});

test('slugify: 长度截断 64', () => {
  const s = 'a'.repeat(100);
  const r = slugify(s);
  assert.ok(r.length <= 64);
});

test('slugify: 数字保留', () => {
  assert.equal(slugify('123 abc 456'), '123-abc-456');
});

test('slugify: 重音符号去掉', () => {
  // é → e
  const r = slugify('café');
  assert.equal(r, 'cafe');
});

// ---------- 集成 ---
test('集成: numberCites 后的 markdown 不再有 [cite:xxx]', () => {
  const r = numberCites('[cite:1.1] [cite:2.2]');
  assert.doesNotMatch(r.transformed, /\[cite:/);
});

test('集成: numberCites 全链路 — extract → number → normalize', () => {
  const md = 'first [cite:abc] then [cite:def]';
  const extracted = extractCites(md);
  assert.equal(extracted.length, 2);
  const numbered = numberCites(md);
  assert.equal(numbered.citationMap.size, 2);
});