#!/usr/bin/env node
// astro-src/scripts/relevance.test.mjs
//
// Tests for R7 polish: astro-src/lib/library/relevance.ts parseRelevanceFromText.
//
// 该模块导入 settings/prompt-pack/llm-chat 等浏览器侧依赖,esbuild 拉不到 localStorage,
// 故此处把纯函数 parseRelevanceFromText 内联,只跑逻辑回归(和源实现保持一致)。

import { test } from 'node:test';
import assert from 'node:assert/strict';

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function tryParseRelevanceObject(raw, profile) {
  try {
    const obj = JSON.parse(raw);
    if (typeof obj.score !== 'number' || typeof obj.tldr !== 'string') return null;
    let axes;
    if (profile && obj.axes && typeof obj.axes === 'object') {
      axes = {};
      for (const a of profile.axes) {
        const v = obj.axes[a.name];
        if (typeof v === 'number') {
          const clamped = Math.max(1, Math.min(5, Math.round(v)));
          axes[a.name] = clamped;
        }
      }
      if (Object.keys(axes).length === 0) axes = undefined;
    }
    return {
      score: clamp01(obj.score),
      reason: String(obj.reason || ''),
      tldr: obj.tldr.trim(),
      ...(axes ? { axes } : {}),
    };
  } catch {
    return null;
  }
}

function parseRelevanceFromText(text, profile = null) {
  if (!text) return null;
  try {
    const direct = tryParseRelevanceObject(text, profile);
    if (direct) return direct;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return tryParseRelevanceObject(text.slice(start, end + 1), profile);
  } catch {
    return null;
  }
}

test('parseRelevanceFromText: 空字符串 → null', () => {
  assert.equal(parseRelevanceFromText(''), null);
});

test('parseRelevanceFromText: 直接 JSON', () => {
  const text = '{"score": 0.8, "reason": "high relevance", "tldr": "a paper"}';
  const r = parseRelevanceFromText(text);
  assert.ok(r);
  assert.equal(r.score, 0.8);
  assert.equal(r.reason, 'high relevance');
  assert.equal(r.tldr, 'a paper');
});

test('parseRelevanceFromText: 含 reasoning 残渣 + JSON', () => {
  const text = 'Some thinking...\n{"score": 0.5, "reason": "ok", "tldr": "tldr"}';
  const r = parseRelevanceFromText(text);
  assert.ok(r);
  assert.equal(r.score, 0.5);
});

test('parseRelevanceFromText: 夹紧 score 到 [0,1]', () => {
  const r1 = parseRelevanceFromText('{"score": 1.5, "tldr": "x"}');
  assert.equal(r1.score, 1);
  const r2 = parseRelevanceFromText('{"score": -0.5, "tldr": "x"}');
  assert.equal(r2.score, 0);
});

test('parseRelevanceFromText: score=null → null(typeof 检查拦截)', () => {
  // typeof null !== 'number',所以源实现直接 return null,不算 NaN。
  assert.equal(parseRelevanceFromText('{"score": null, "tldr": "x"}'), null);
});

test('parseRelevanceFromText: 缺 score → null', () => {
  assert.equal(parseRelevanceFromText('{"reason": "x", "tldr": "x"}'), null);
});

test('parseRelevanceFromText: 缺 tldr → null', () => {
  assert.equal(parseRelevanceFromText('{"score": 0.5, "reason": "x"}'), null);
});

test('parseRelevanceFromText: tldr trim', () => {
  const r = parseRelevanceFromText('{"score": 0.5, "tldr": "  spaced  "}');
  assert.equal(r.tldr, 'spaced');
});

test('parseRelevanceFromText: 无 reason → 空字符串', () => {
  const r = parseRelevanceFromText('{"score": 0.5, "tldr": "x"}');
  assert.equal(r.reason, '');
});

test('parseRelevanceFromText: 非 JSON 文本 → null', () => {
  assert.equal(parseRelevanceFromText('random gibberish'), null);
});

test('parseRelevanceFromText: 无 { 区间 → null', () => {
  assert.equal(parseRelevanceFromText('no braces here'), null);
});

test('parseRelevanceFromText: 不完整 JSON(无闭合 }) → null', () => {
  assert.equal(parseRelevanceFromText('{"score": 0.5, "tldr":'), null);
});

test('parseRelevanceFromText: score 是 string → null', () => {
  assert.equal(parseRelevanceFromText('{"score": "0.5", "tldr": "x"}'), null);
});

test('parseRelevanceFromText: tldr 是 number → null', () => {
  assert.equal(parseRelevanceFromText('{"score": 0.5, "tldr": 42}'), null);
});

test('parseRelevanceFromText: profile 提供时夹紧 axes 到 1-5', () => {
  const profile = {
    id: 'novice',
    label: 'novice',
    description: '',
    axes: [
      { name: 'clarity', weight: 0.5, description: '' },
      { name: 'depth', weight: 0.5, description: '' },
    ],
    defaultThreshold: 0.5,
  };
  const text = '{"score": 0.5, "tldr": "x", "axes": {"clarity": 4, "depth": 7}}';
  const r = parseRelevanceFromText(text, profile);
  assert.ok(r.axes);
  assert.equal(r.axes.clarity, 4);
  assert.equal(r.axes.depth, 5); // clamp
});

test('parseRelevanceFromText: axes 小于 1 夹紧到 1', () => {
  const profile = {
    id: 'novice',
    label: 'novice',
    description: '',
    axes: [{ name: 'clarity', weight: 1, description: '' }],
    defaultThreshold: 0.5,
  };
  const text = '{"score": 0.5, "tldr": "x", "axes": {"clarity": 0}}';
  const r = parseRelevanceFromText(text, profile);
  assert.equal(r.axes.clarity, 1);
});

test('parseRelevanceFromText: axes 四舍五入', () => {
  const profile = {
    id: 'novice',
    label: 'novice',
    description: '',
    axes: [{ name: 'clarity', weight: 1, description: '' }],
    defaultThreshold: 0.5,
  };
  const text = '{"score": 0.5, "tldr": "x", "axes": {"clarity": 3.4}}';
  const r = parseRelevanceFromText(text, profile);
  assert.equal(r.axes.clarity, 3); // round(3.4) = 3
});

test('parseRelevanceFromText: 无 profile 时不读 axes', () => {
  const text = '{"score": 0.5, "tldr": "x", "axes": {"clarity": 4}}';
  const r = parseRelevanceFromText(text);
  assert.equal(r.axes, undefined);
});

test('parseRelevanceFromText: axes 为空对象 → undefined', () => {
  const profile = {
    id: 'novice',
    label: 'novice',
    description: '',
    axes: [{ name: 'clarity', weight: 1, description: '' }],
    defaultThreshold: 0.5,
  };
  const text = '{"score": 0.5, "tldr": "x", "axes": {}}';
  const r = parseRelevanceFromText(text, profile);
  assert.equal(r.axes, undefined);
});