#!/usr/bin/env node
// astro-src/scripts/paper-relations-tfidf.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-relations/tfidf.ts computeTfIdfEdges.
// 不能直接 esbuild load — 引 ../paper (relative, data URL 无法 resolve)。
// inline computeTfIdfEdges + tokenize + termFreq + topKEdges,源做参考。

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- inline 源 lib/paper-relations/tfidf.ts + edges-util.ts -------------

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/u)
    .filter((t) => t.length > 1);
}

function termFreq(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

function topKEdges(edges, k) {
  if (!k || k <= 0) return edges;
  const bySource = new Map();
  for (const e of edges) {
    const arr = bySource.get(e.source);
    if (arr) arr.push(e);
    else bySource.set(e.source, [e]);
  }
  const out = [];
  for (const arr of bySource.values()) {
    arr.sort((a, b) => b.weight - a.weight);
    for (const e of arr.slice(0, k)) out.push(e);
  }
  return out;
}

function computeTfIdfEdges(papers, topK = 8, minWeight = 0) {
  if (papers.length < 2) return [];
  const docs = papers.map((p) => {
    const text = [p.title || '', p.title_zh || '', p.tldr || ''].join(' ');
    return tokenize(text);
  });
  const df = new Map();
  for (const tokens of docs) {
    const seen = new Set();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  const N = papers.length;
  const vectors = docs.map((tokens) => {
    const tf = termFreq(tokens);
    const v = new Map();
    let norm2 = 0;
    for (const [term, count] of tf) {
      const idf = Math.log(1 + N / (df.get(term) || 1));
      const w = count * idf;
      v.set(term, w);
      norm2 += w * w;
    }
    const norm = Math.sqrt(norm2);
    if (norm > 0) for (const [term, w] of v) v.set(term, w / norm);
    return v;
  });
  const out = [];
  for (let i = 0; i < N; i++) {
    const vi = vectors[i];
    if (vi.size === 0) continue;
    const acc = new Map();
    for (const [term, w] of vi) {
      for (let j = 0; j < N; j++) {
        const vj = vectors[j];
        const wj = vj.get(term);
        if (wj === undefined) continue;
        acc.set(j, (acc.get(j) || 0) + w * wj);
      }
    }
    for (const [j, sim] of acc) {
      if (j === i) continue;
      if (sim < minWeight) continue;
      out.push({
        source: papers[i].id,
        target: papers[j].id,
        weight: sim,
        type: 'tfidf',
        sharedTags: [],
      });
    }
  }
  return topKEdges(out, topK);
}

// ---------- computeTfIdfEdges ----------
test('computeTfIdfEdges: 0 paper → []', () => {
  assert.deepEqual(computeTfIdfEdges([]), []);
});

test('computeTfIdfEdges: 1 paper → [] (不足 2)', () => {
  assert.deepEqual(computeTfIdfEdges([{ id: 'a', title: 'foo' }]), []);
});

test('computeTfIdfEdges: 2 papers 共享词 → 边', () => {
  const r = computeTfIdfEdges([
    { id: 'a', title: 'transformer attention', tldr: 'attention' },
    { id: 'b', title: 'attention', tldr: '' },
  ]);
  assert.equal(r.length, 2); // a→b, b→a
  assert.equal(r[0].type, 'tfidf');
  assert.equal(r[0].sharedTags.length, 0);
});

test('computeTfIdfEdges: 完全无共享词 → 0 边', () => {
  const r = computeTfIdfEdges([
    { id: 'a', title: 'transformer', tldr: '' },
    { id: 'b', title: 'reinforcement learning', tldr: '' },
  ]);
  // 共享词少,可能边权重 < minWeight
  assert.equal(r.length, 0);
});

test('computeTfIdfEdges: 边字段', () => {
  const r = computeTfIdfEdges([
    { id: 'a', title: 'transformer attention', tldr: '' },
    { id: 'b', title: 'attention transformer', tldr: '' },
  ]);
  assert.equal(r[0].source, 'a');
  assert.equal(r[0].target, 'b');
  assert.ok(typeof r[0].weight === 'number');
});

test('computeTfIdfEdges: weight > 0', () => {
  const r = computeTfIdfEdges([
    { id: 'a', title: 'foo bar', tldr: '' },
    { id: 'b', title: 'foo bar', tldr: '' },
  ]);
  assert.ok(r[0].weight > 0);
});

test('computeTfIdfEdges: 自相似度 (i===j) 被跳过', () => {
  // 验证: 不会创建 self-loop
  const r = computeTfIdfEdges([
    { id: 'a', title: 'foo bar', tldr: '' },
    { id: 'b', title: 'foo bar', tldr: '' },
  ]);
  for (const e of r) {
    assert.notEqual(e.source, e.target);
  }
});

test('computeTfIdfEdges: topK 限制每个 source 最多 k 条', () => {
  const papers = Array.from({ length: 10 }, (_, i) => ({
    id: 'p' + i,
    title: 'common common common word',
    tldr: '',
  }));
  const r = computeTfIdfEdges(papers, 3);
  // 每个 source 最多 3 条边
  const bySource = new Map();
  for (const e of r) {
    const arr = bySource.get(e.source) || [];
    arr.push(e);
    bySource.set(e.source, arr);
  }
  for (const arr of bySource.values()) {
    assert.ok(arr.length <= 3);
  }
});

test('computeTfIdfEdges: minWeight 过滤低权重', () => {
  const r = computeTfIdfEdges(
    [
      { id: 'a', title: 'foo bar', tldr: '' },
      { id: 'b', title: 'foo bar', tldr: '' },
    ],
    8,
    1.5, // 高阈值
  );
  assert.equal(r.length, 0); // 没边达到 1.5
});

test('computeTfIdfEdges: minWeight=0 包含所有边', () => {
  const r = computeTfIdfEdges(
    [
      { id: 'a', title: 'foo bar', tldr: '' },
      { id: 'b', title: 'foo bar', tldr: '' },
    ],
    8,
    0,
  );
  assert.equal(r.length, 2); // a→b, b→a
});

test('computeTfIdfEdges: 包含 title_zh', () => {
  const r = computeTfIdfEdges([
    { id: 'a', title: '', title_zh: '机器学习 模型', tldr: '' },
    { id: 'b', title: '', title_zh: '模型 深度学习', tldr: '' },
  ]);
  // 共享 "模型" → 有边
  assert.ok(r.length >= 1);
});

test('computeTfIdfEdges: title + title_zh + tldr 合并', () => {
  const r = computeTfIdfEdges([
    { id: 'a', title: 'foo', title_zh: 'transformer', tldr: 'transformer' },
    { id: 'b', title: '', title_zh: '', tldr: 'transformer' },
  ]);
  assert.ok(r.length >= 1);
});

test('computeTfIdfEdges: 单字符 token 被过滤', () => {
  // source: filter t.length > 1 → 单字符词丢弃
  const r = computeTfIdfEdges([
    { id: 'a', title: 'a b', tldr: '' },
    { id: 'b', title: 'a b', tldr: '' },
  ]);
  // 'a', 'b' 都是 1 字符 → 过滤 → 空词表 → 0 边
  assert.equal(r.length, 0);
});

test('computeTfIdfEdges: 大小写不敏感', () => {
  const r = computeTfIdfEdges([
    { id: 'a', title: 'TRANSFORMER', tldr: '' },
    { id: 'b', title: 'transformer', tldr: '' },
  ]);
  assert.ok(r.length >= 1);
});

test('computeTfIdfEdges: 3 papers 都共享 → 多边', () => {
  const r = computeTfIdfEdges([
    { id: 'a', title: 'foo bar', tldr: '' },
    { id: 'b', title: 'foo bar', tldr: '' },
    { id: 'c', title: 'foo bar', tldr: '' },
  ]);
  // 3*2 = 6 边(每对都有 a→b, a→c, b→a, b→c, c→a, c→b)
  assert.equal(r.length, 6);
});

test('computeTfIdfEdges: topKEdges 限制总边数', () => {
  const papers = Array.from({ length: 10 }, (_, i) => ({
    id: 'p' + i, title: 'common word' + i, tldr: '',
  }));
  const r = computeTfIdfEdges(papers, 2);
  // 每 paper 1 unique word + 1 shared "common"
  // paper i 与 9 others 各 1 条边,topK=2 保留 2 → 10 sources × 2 = 20
  assert.equal(r.length, 20);
});