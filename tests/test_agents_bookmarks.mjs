/**
 * tests/test_agents_bookmarks.mjs — round bookmarks 纯逻辑守护。
 *
 * iter #24:让用户给任意 round 打星标,跨 session 看到所有收藏的 round。
 *
 * localStorage:
 *   dpr_agents_bookmarks_v1 = JSON [{ sid, round, title, addedAt }]
 *
 * 操作:
 *   add / remove / toggle / has / list(按 addedAt desc)
 *
 * 跑法:node tests/test_agents_bookmarks.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const BOOKMARKS_KEY = 'dpr_agents_bookmarks_v1';

function loadBookmarks(store) {
  const raw = store[BOOKMARKS_KEY];
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(isValidBookmark) : [];
  } catch {
    return [];
  }
}

function writeBookmarks(store, list) {
  store[BOOKMARKS_KEY] = JSON.stringify(list);
}

function isValidBookmark(b) {
  return b && typeof b === 'object'
    && typeof b.sid === 'string' && b.sid
    && typeof b.round === 'number' && Number.isFinite(b.round)
    && typeof b.addedAt === 'number';
}

function addBookmark(store, sid, round, title, now = Date.now()) {
  if (!sid || typeof round !== 'number' || !Number.isFinite(round)) {
    throw new Error('sid and round (finite number) required');
  }
  const list = loadBookmarks(store);
  // 已存在则不重复加
  if (list.some((b) => b.sid === sid && b.round === round)) return list;
  list.push({ sid, round, title: title ?? '', addedAt: now });
  writeBookmarks(store, list);
  return list;
}

function removeBookmark(store, sid, round) {
  const list = loadBookmarks(store);
  const next = list.filter((b) => !(b.sid === sid && b.round === round));
  writeBookmarks(store, next);
  return next;
}

function toggleBookmark(store, sid, round, title, now = Date.now()) {
  const list = loadBookmarks(store);
  const exists = list.some((b) => b.sid === sid && b.round === round);
  if (exists) {
    removeBookmark(store, sid, round);
    return false;
  }
  addBookmark(store, sid, round, title, now);
  return true;
}

function hasBookmark(store, sid, round) {
  return loadBookmarks(store).some((b) => b.sid === sid && b.round === round);
}

function listBookmarksSorted(store) {
  return loadBookmarks(store).slice().sort((a, b) => b.addedAt - a.addedAt);
}

describe('loadBookmarks', () => {
  it('returns empty for missing key', () => {
    assert.deepEqual(loadBookmarks({}), []);
  });
  it('parses stored JSON', () => {
    const store = { [BOOKMARKS_KEY]: JSON.stringify([{ sid: 's', round: 1, addedAt: 100 }]) };
    assert.equal(loadBookmarks(store).length, 1);
  });
  it('drops malformed entries', () => {
    const store = { [BOOKMARKS_KEY]: JSON.stringify([
      { sid: 's', round: 1, addedAt: 100 },
      { sid: 42 },  // bad sid type
      { round: 2 },  // missing sid
      { sid: 'y', round: 'x', addedAt: 200 },  // bad round
      'not an object',
      null,
    ]) };
    const list = loadBookmarks(store);
    assert.equal(list.length, 1);
    assert.equal(list[0].sid, 's');
  });
  it('returns empty on malformed JSON', () => {
    const store = { [BOOKMARKS_KEY]: 'bad' };
    assert.deepEqual(loadBookmarks(store), []);
  });
});

describe('addBookmark', () => {
  it('adds a new bookmark', () => {
    const store = {};
    addBookmark(store, 's', 1, 'T1', 100);
    assert.equal(loadBookmarks(store).length, 1);
    assert.equal(loadBookmarks(store)[0].sid, 's');
    assert.equal(loadBookmarks(store)[0].round, 1);
    assert.equal(loadBookmarks(store)[0].title, 'T1');
  });
  it('does not add duplicate', () => {
    const store = {};
    addBookmark(store, 's', 1, 'T1', 100);
    addBookmark(store, 's', 1, 'T1-again', 200);
    const list = loadBookmarks(store);
    assert.equal(list.length, 1);
    assert.equal(list[0].title, 'T1');  // keeps first
  });
  it('allows same sid with different rounds', () => {
    const store = {};
    addBookmark(store, 's', 1, '', 100);
    addBookmark(store, 's', 2, '', 200);
    assert.equal(loadBookmarks(store).length, 2);
  });
  it('throws on missing sid or round', () => {
    // eslint-disable-next-line no-undef
    assert.throws(() => addBookmark({}, undefined, 1, 'T'), /required/);
    assert.throws(() => addBookmark({}, 's', NaN, 'T'), /required/);
  });
});

describe('removeBookmark', () => {
  it('removes existing bookmark', () => {
    const store = {};
    addBookmark(store, 's', 1, '', 100);
    addBookmark(store, 's', 2, '', 200);
    removeBookmark(store, 's', 1);
    const list = loadBookmarks(store);
    assert.equal(list.length, 1);
    assert.equal(list[0].round, 2);
  });
  it('no-op when bookmark missing', () => {
    const store = {};
    addBookmark(store, 's', 1, '', 100);
    removeBookmark(store, 's', 99);
    assert.equal(loadBookmarks(store).length, 1);
  });
});

describe('toggleBookmark', () => {
  it('adds when missing, returns true', () => {
    const store = {};
    assert.equal(toggleBookmark(store, 's', 1, 'T', 100), true);
    assert.equal(loadBookmarks(store).length, 1);
  });
  it('removes when present, returns false', () => {
    const store = {};
    toggleBookmark(store, 's', 1, 'T', 100);
    assert.equal(toggleBookmark(store, 's', 1, 'T', 200), false);
    assert.equal(loadBookmarks(store).length, 0);
  });
});

describe('hasBookmark', () => {
  it('returns true when matching', () => {
    const store = {};
    addBookmark(store, 's', 1, '', 100);
    assert.equal(hasBookmark(store, 's', 1), true);
    assert.equal(hasBookmark(store, 's', 2), false);
    assert.equal(hasBookmark(store, 'other', 1), false);
  });
});

describe('listBookmarksSorted', () => {
  it('sorts by addedAt descending (newest first)', () => {
    const store = {};
    addBookmark(store, 'a', 1, '', 100);
    addBookmark(store, 'b', 1, '', 300);
    addBookmark(store, 'c', 1, '', 200);
    const sorted = listBookmarksSorted(store);
    assert.deepEqual(sorted.map((b) => b.sid), ['b', 'c', 'a']);
  });
  it('does not mutate the stored array', () => {
    const store = {};
    addBookmark(store, 'a', 1, '', 100);
    addBookmark(store, 'b', 1, '', 200);
    const before = loadBookmarks(store);
    listBookmarksSorted(store);
    const after = loadBookmarks(store);
    assert.deepEqual(before.map((b) => b.sid), after.map((b) => b.sid));
  });
});

describe('end-to-end', () => {
  it('user workflow: browse → star → unstar → see list', () => {
    const store = {};
    // 用户 star 几个 round
    toggleBookmark(store, 'acl2026', 3, 'Final approach', 1000);
    toggleBookmark(store, 'cvpr2024', 1, 'Initial idea', 1500);
    toggleBookmark(store, 'acl2026', 5, 'Strong baseline', 2000);
    assert.equal(loadBookmarks(store).length, 3);
    // 取消一个
    toggleBookmark(store, 'cvpr2024', 1, '', 2500);
    assert.equal(loadBookmarks(store).length, 2);
    // 列表按 addedAt desc
    const list = listBookmarksSorted(store);
    assert.deepEqual(list.map((b) => b.sid), ['acl2026', 'acl2026']);
  });
});
