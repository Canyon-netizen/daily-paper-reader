/**
 * tests/test_agents_search.mjs — session 全局搜索纯逻辑守护。
 *
 * iter #22:在 picker 上方加搜索框,live 过滤 sid / title / notes / tag。
 *
 * 规则:
 *   - case-insensitive substring match
 *   - 任一字段命中即匹配
 *   - 空 query → 返回全部
 *   - 多个 keyword(空格分隔)是 AND
 *
 * 跑法:node tests/test_agents_search.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function searchSessions(sessions, query) {
  if (!query || !query.trim()) return sessions;
  // 多 keyword AND
  const keywords = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return sessions;
  return sessions.filter((s) => {
    const haystack = [
      s.sid ?? '',
      s.title ?? '',
      s.notes ?? '',
      ...(s.tags ?? []),
    ].join(' ').toLowerCase();
    return keywords.every((kw) => haystack.includes(kw));
  });
}

function highlight(text, query) {
  if (!query || !query.trim()) return text;
  const keywords = query.trim().split(/\s+/).filter(Boolean);
  let result = text;
  for (const kw of keywords) {
    if (!kw) continue;
    const re = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    result = result.replace(re, '<mark>$1</mark>');
  }
  return result;
}

describe('searchSessions', () => {
  const sessions = [
    { sid: 'acl2026', title: 'ACL paper review', notes: 'transformer architectures', tags: ['methodology'] },
    { sid: 'cvpr2024', title: 'CVPR contrastive', notes: 'self-supervised', tags: ['write-up', 'methodology'] },
    { sid: 'old', title: 'data exploration', notes: 'look at embedding', tags: ['eda'] },
    { sid: 'empty', title: '', notes: '', tags: [] },
  ];

  it('returns all for empty query', () => {
    assert.equal(searchSessions(sessions, '').length, 4);
    assert.equal(searchSessions(sessions, '   ').length, 4);
    assert.equal(searchSessions(sessions, null).length, 4);
  });
  it('matches sid substring', () => {
    const r = searchSessions(sessions, 'acl');
    assert.deepEqual(r.map((s) => s.sid), ['acl2026']);
  });
  it('matches title substring', () => {
    const r = searchSessions(sessions, 'contrastive');
    assert.deepEqual(r.map((s) => s.sid), ['cvpr2024']);
  });
  it('matches notes substring', () => {
    const r = searchSessions(sessions, 'embedding');
    assert.deepEqual(r.map((s) => s.sid), ['old']);
  });
  it('matches tag substring', () => {
    const r = searchSessions(sessions, 'eda');
    assert.deepEqual(r.map((s) => s.sid), ['old']);
  });
  it('case-insensitive', () => {
    const r = searchSessions(sessions, 'ACL');
    assert.deepEqual(r.map((s) => s.sid), ['acl2026']);
    const r2 = searchSessions(sessions, 'METHODOLOGY');
    assert.equal(r2.length, 2);  // both methodology-tagged
  });
  it('multi-keyword AND', () => {
    // "methodology write-up" → only cvpr2024 has both
    const r = searchSessions(sessions, 'methodology write-up');
    assert.deepEqual(r.map((s) => s.sid), ['cvpr2024']);
  });
  it('whitespace-separated tokens', () => {
    const r = searchSessions(sessions, '   transformer   architectures   ');
    assert.deepEqual(r.map((s) => s.sid), ['acl2026']);
  });
  it('empty session matches empty result for non-empty query', () => {
    const r = searchSessions(sessions, 'foo');
    assert.equal(r.length, 0);
  });
  it('handles sessions with missing fields', () => {
    const sparse = [{ sid: 'x' }, { sid: 'y', title: null, notes: undefined, tags: null }];
    const r = searchSessions(sparse, 'x');
    assert.deepEqual(r.map((s) => s.sid), ['x']);
  });
});

describe('highlight', () => {
  it('returns text unchanged when no query', () => {
    assert.equal(highlight('hello world', ''), 'hello world');
    assert.equal(highlight('hello world', null), 'hello world');
  });
  it('wraps matches in <mark>', () => {
    assert.equal(highlight('hello world', 'world'), 'hello <mark>world</mark>');
  });
  it('case-insensitive highlight', () => {
    assert.equal(highlight('Hello WORLD', 'world'), 'Hello <mark>WORLD</mark>');
  });
  it('multi-keyword highlight', () => {
    const out = highlight('foo bar baz', 'foo baz');
    assert.equal(out, '<mark>foo</mark> bar <mark>baz</mark>');
  });
  it('escapes regex special chars in keyword', () => {
    const out = highlight('use dot.notation', '.');
    assert.equal(out, 'use dot<mark>.</mark>notation');
  });
});
