/**
 * tests/test_agents_session_tags.mjs — session 标签纯逻辑守护。
 *
 * iter #20:给 session 加多标签,跨 session 过滤。
 *
 * meta.tags: string[] — 简单字符串数组
 *   - 自动 trim
 *   - 转小写(让 case 不敏感)
 *   - 去重
 *   - 限制每条 ≤ 24 字符,最多 8 个标签
 *
 * localStorage 里 dpr_agents_meta_<sid> 多一个 tags 字段(向后兼容老数据)。
 *
 * 跑法:node tests/test_agents_session_tags.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const META_KEY = (sid) => `dpr_agents_meta_${sid}`;

const MAX_TAGS = 8;
const MAX_TAG_LEN = 24;

function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const trimmed = t.trim().toLowerCase();
    if (!trimmed) continue;
    if (trimmed.length > MAX_TAG_LEN) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function emptyMeta(sid, now = Date.now()) {
  return { sid, title: '', notes: '', createdAt: now, updatedAt: now, tags: [] };
}

function loadMetaFrom(store, sid, now = Date.now()) {
  const raw = store[META_KEY(sid)];
  if (!raw) return emptyMeta(sid, now);
  try {
    const obj = JSON.parse(raw);
    return {
      sid,
      title: typeof obj.title === 'string' ? obj.title : '',
      notes: typeof obj.notes === 'string' ? obj.notes : '',
      createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : now,
      updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : now,
      tags: normalizeTags(obj.tags),
    };
  } catch {
    return emptyMeta(sid, now);
  }
}

function saveMetaTags(store, sid, tags, now = Date.now()) {
  const prev = loadMetaFrom(store, sid, now);
  const next = { ...prev, tags: normalizeTags(tags), updatedAt: now };
  store[META_KEY(sid)] = JSON.stringify(next);
  return next;
}

function parseTagInput(input) {
  // "foo, BAR , baz" → ["foo", "bar", "baz"]
  if (typeof input !== 'string') return [];
  return input.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function filterByTags(sessions, selectedTags) {
  // sessions: [{ sid, tags: string[] }]
  // selectedTags: string[] (empty = show all)
  if (!Array.isArray(selectedTags) || selectedTags.length === 0) return sessions;
  const want = new Set(selectedTags.map((t) => String(t).toLowerCase()));
  return sessions.filter((s) => {
    const have = new Set((s.tags ?? []).map((t) => String(t).toLowerCase()));
    for (const w of want) if (have.has(w)) return true;
    return false;
  });
}

describe('normalizeTags', () => {
  it('returns empty for non-array', () => {
    assert.deepEqual(normalizeTags(null), []);
    assert.deepEqual(normalizeTags(undefined), []);
    assert.deepEqual(normalizeTags('foo'), []);
  });
  it('trims and lowercases', () => {
    assert.deepEqual(normalizeTags(['  Foo  ', 'BAR']), ['foo', 'bar']);
  });
  it('drops empty strings', () => {
    assert.deepEqual(normalizeTags(['', '   ', 'valid']), ['valid']);
  });
  it('deduplicates', () => {
    assert.deepEqual(normalizeTags(['foo', 'FOO', 'Foo']), ['foo']);
  });
  it('ignores non-strings', () => {
    assert.deepEqual(normalizeTags(['foo', 42, null, 'bar']), ['foo', 'bar']);
  });
  it('caps at MAX_TAGS', () => {
    const input = Array.from({ length: 12 }, (_, i) => `t${i}`);
    assert.equal(normalizeTags(input).length, MAX_TAGS);
  });
  it('drops tags exceeding MAX_TAG_LEN', () => {
    const long = 'a'.repeat(MAX_TAG_LEN + 1);
    assert.deepEqual(normalizeTags(['ok', long, 'fine']), ['ok', 'fine']);
  });
});

describe('loadMetaFrom (with tags)', () => {
  it('returns tags=[] for new meta', () => {
    const m = loadMetaFrom({}, 's', 1000);
    assert.deepEqual(m.tags, []);
  });
  it('parses stored tags via normalizeTags', () => {
    const store = { [META_KEY('s')]: JSON.stringify({ tags: ['  Foo  ', 'BAZ', 'foo'] }) };
    const m = loadMetaFrom(store, 's');
    assert.deepEqual(m.tags, ['foo', 'baz']);
  });
  it('omits tags for old meta without tags field', () => {
    const store = { [META_KEY('s')]: JSON.stringify({ title: 'T' }) };
    const m = loadMetaFrom(store, 's');
    assert.deepEqual(m.tags, []);
  });
  it('falls back gracefully on malformed JSON', () => {
    const store = { [META_KEY('s')]: 'garbage' };
    const m = loadMetaFrom(store, 's');
    assert.deepEqual(m.tags, []);
  });
});

describe('saveMetaTags', () => {
  it('writes normalized tags and bumps updatedAt', () => {
    const store = {};
    const m = saveMetaTags(store, 's', ['  Foo ', 'BAR'], 5000);
    assert.deepEqual(m.tags, ['foo', 'bar']);
    assert.equal(m.updatedAt, 5000);
    const reread = JSON.parse(store[META_KEY('s')]);
    assert.deepEqual(reread.tags, ['foo', 'bar']);
  });
  it('preserves other meta fields', () => {
    const store = { [META_KEY('s')]: JSON.stringify({ title: 'T', notes: 'N', createdAt: 100 }) };
    const m = saveMetaTags(store, 's', ['x'], 200);
    assert.equal(m.title, 'T');
    assert.equal(m.notes, 'N');
    assert.equal(m.createdAt, 100);
    assert.equal(m.updatedAt, 200);
  });
});

describe('parseTagInput', () => {
  it('splits comma-separated string into list', () => {
    assert.deepEqual(parseTagInput('foo, bar, baz'), ['foo', 'bar', 'baz']);
  });
  it('trims and drops empty', () => {
    assert.deepEqual(parseTagInput('  foo ,,  bar  ,'), ['foo', 'bar']);
  });
  it('returns empty for empty/non-string', () => {
    assert.deepEqual(parseTagInput(''), []);
    assert.deepEqual(parseTagInput(null), []);
    assert.deepEqual(parseTagInput(123), []);
  });
});

describe('filterByTags', () => {
  const sessions = [
    { sid: 'a', tags: ['foo', 'bar'] },
    { sid: 'b', tags: ['baz'] },
    { sid: 'c', tags: ['foo', 'qux'] },
    { sid: 'd', tags: [] },
  ];

  it('returns all when no tags selected', () => {
    assert.equal(filterByTags(sessions, []).length, 4);
    assert.equal(filterByTags(sessions, null).length, 4);
  });
  it('filters by single tag', () => {
    const r = filterByTags(sessions, ['foo']);
    assert.deepEqual(r.map((s) => s.sid).sort(), ['a', 'c']);
  });
  it('OR semantics across multiple selected tags', () => {
    const r = filterByTags(sessions, ['bar', 'baz']);
    assert.deepEqual(r.map((s) => s.sid).sort(), ['a', 'b']);
  });
  it('case-insensitive', () => {
    const r = filterByTags(sessions, ['FOO']);
    assert.deepEqual(r.map((s) => s.sid).sort(), ['a', 'c']);
  });
  it('sessions with no tags never match (unless empty filter)', () => {
    const r = filterByTags(sessions, ['nonexistent']);
    assert.equal(r.length, 0);  // nobody has 'nonexistent', even d's empty list
    const r2 = filterByTags([{ sid: 'd', tags: [] }, ...sessions], ['foo']);
    assert.ok(!r2.some((s) => s.sid === 'd'), 'd has [] tags, never matches a real tag');
  });
});

describe('end-to-end', () => {
  it('user workflow: type tags → save → filter → find', () => {
    const store = {};
    // 用户输入 "methodology, write-up , methodology" → 去重 + trim + lowercase
    const input = parseTagInput('methodology, write-up , methodology');
    const tags = normalizeTags(input);
    assert.deepEqual(tags, ['methodology', 'write-up']);
    saveMetaTags(store, 'myproj', tags, 1000);

    // 切到 picker 模式
    const meta = loadMetaFrom(store, 'myproj', 1000);
    const sessions = [
      { sid: 'myproj', tags: meta.tags },
      { sid: 'other', tags: ['unrelated'] },
    ];
    const filtered = filterByTags(sessions, ['methodology']);
    assert.deepEqual(filtered.map((s) => s.sid), ['myproj']);
  });
});
