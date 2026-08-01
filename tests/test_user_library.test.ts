// tests/test_user_library.test.ts
//
// User-library store 单元测试(Stage 1 验收)。
//
// 覆盖:稀疏写入 / 字段清空让 entry 消失 / canonical id 归一 / updatedAt 盖戳 /
// 配额失败显式返回 / 单事件源 / corrupt JSON 兜底 / replaceUserLibrary 一次事件。
//
// 跑法: bun test tests/test_user_library.test.ts

import { describe, it, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';

let store: typeof import('../astro-src/lib/user-library/store');
let events: typeof import('../astro-src/lib/events');
let arxiv: typeof import('../astro-src/lib/arxiv');

beforeEach(async () => {
  const win = new Window();
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = win.document;
  (globalThis as Record<string, unknown>).localStorage = win.localStorage;
  (globalThis as Record<string, unknown>).CustomEvent = win.CustomEvent;
  // 每个 case 重新 import,确保 store 模块在新的 localStorage 下工作
  const sId = require.resolve('../astro-src/lib/user-library/store');
  delete require.cache[sId];
  const eId = require.resolve('../astro-src/lib/events');
  delete require.cache[eId];
  store = await import('../astro-src/lib/user-library/store');
  events = await import('../astro-src/lib/events');
  arxiv = await import('../astro-src/lib/arxiv');
});

describe('user-library/store', () => {
  it('empty localStorage → empty doc', () => {
    expect(store.loadUserLibrary()).toEqual({ schemaVersion: 1, papers: {} });
  });

  it('toggleStar on unversioned id', () => {
    const r = store.toggleStar('2305.16291');
    expect(r).toEqual({ ok: true, changed: true });
    expect(store.isStarred('2305.16291')).toBe(true);
  });

  it('canonical id acts as the storage key', () => {
    // 用 setStarred 两次都 true(不是 toggleStar,后者会取消第一次)
    store.setStarred('2607.00483v1', true);
    store.setStarred('2607.00483v2', true);
    expect(store.isStarred('2607.00483v1')).toBe(true);
    expect(store.isStarred('2607.00483v2')).toBe(true);
    expect(Object.keys(store.loadUserLibrary().papers)).toEqual(['2607.00483']);
  });

  it('toggleStar on v1 then v2 flips the shared entry (true toggle semantics)', () => {
    store.toggleStar('2607.00483v1'); // star
    expect(store.isStarred('2607.00483')).toBe(true);
    store.toggleStar('2607.00483v2'); // unstar (same canonical → already starred → toggle off)
    expect(store.isStarred('2607.00483')).toBe(false);
    expect(store.loadUserLibrary().papers).toEqual({});
  });

  it('canonicalArxivId helper', () => {
    expect(arxiv.canonicalArxivId('2607.00483V2')).toBe('2607.00483');
    expect(arxiv.canonicalArxivId('2607.00483')).toBe('2607.00483');
    expect(arxiv.canonicalArxivId('')).toBe('');
    expect(arxiv.canonicalArxivId('  2607.00483v1  ')).toBe('2607.00483');
  });

  it('updatedAt is stamped by the private commit funnel', () => {
    store.toggleStar('2607.00483');
    const t1 = store.loadUserLibrary().papers['2607.00483'].updatedAt;
    expect(t1).toBeGreaterThan(0);

    store.setReadingStatus('2607.00483', 'reading');
    const t2 = store.loadUserLibrary().papers['2607.00483'].updatedAt;
    expect(t2).toBeGreaterThanOrEqual(t1);
  });

  it('clearing every field deletes the entry (sparse storage)', () => {
    store.toggleStar('2607.00483');
    expect(Object.keys(store.loadUserLibrary().papers)).toEqual(['2607.00483']);

    const r = store.setStarred('2607.00483', false);
    expect(r).toEqual({ ok: true, changed: true });
    expect(store.loadUserLibrary().papers).toEqual({});
  });

  it('setReadingStatus("unread") removes the field', () => {
    store.setReadingStatus('2607.00483', 'reading');
    expect(store.getReadingStatus('2607.00483')).toBe('reading');
    store.setReadingStatus('2607.00483', 'read');
    expect(store.getReadingStatus('2607.00483')).toBe('read');
    store.setReadingStatus('2607.00483', 'unread');
    expect(store.getReadingStatus('2607.00483')).toBe('unread');
    expect(store.loadUserLibrary().papers).toEqual({});
  });

  it('setUserNote("") deletes the note only when other fields also empty', () => {
    store.setUserNote('2607.00483', 'hello');
    store.toggleStar('2607.00483');
    store.setUserNote('2607.00483', '');
    expect(store.loadUserLibrary().papers['2607.00483'].starred).toBe(true);
    expect(store.loadUserLibrary().papers['2607.00483'].note).toBeUndefined();
    store.setStarred('2607.00483', false);
    expect(store.loadUserLibrary().papers).toEqual({});
  });

  it('whitespace-only note is treated as empty', () => {
    store.setUserNote('2607.00483', '   \n\n  ');
    expect(store.hasUserNote('2607.00483')).toBe(false);
    expect(store.loadUserLibrary().papers).toEqual({});
  });

  it('softDelete -> restoreFromTrash is a round-trip', () => {
    store.toggleStar('2607.00483');
    store.softDelete('2607.00483', 'manual');
    expect(store.isTrashed('2607.00483')).toBe(true);
    expect(store.isStarred('2607.00483')).toBe(true);
    store.restoreFromTrash('2607.00483');
    expect(store.isTrashed('2607.00483')).toBe(false);
    expect(store.isStarred('2607.00483')).toBe(true);
  });

  it('purgeUserPaperState deletes everything for that paper', () => {
    store.setUserNote('2607.00483', 'long note here');
    store.setReadingStatus('2607.00483', 'reading');
    store.toggleStar('2607.00483');
    store.purgeUserPaperState('2607.00483');
    expect(store.loadUserLibrary().papers).toEqual({});
  });

  it('listStarred / listWithNotes / listTrashed are consistent', () => {
    store.toggleStar('2607.00001');
    store.toggleStar('2607.00002');
    store.setUserNote('2607.00003', 'n');
    store.softDelete('2607.00004');
    expect(store.listStarred().sort()).toEqual(['2607.00001', '2607.00002']);
    expect(store.listWithNotes()).toEqual(['2607.00003']);
    expect(store.listTrashed()).toEqual(['2607.00004']);
  });

  it('QuotaExceededError is surfaced, not swallowed', () => {
    // 用一个替换的 localStorage 对象覆盖 happy-dom 的实例,happy-dom 的
    // setItem 不会抛,必须用自定义类强制抛错。
    const failingStore = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    (globalThis as Record<string, unknown>).localStorage = failingStore;
    // store 内部用 typeof !== 'undefined' 判定,所以这个 mock 不会被静默跳过
    const r = store.toggleStar('2607.00483');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('quota');
  });

  it('corrupt JSON in localStorage → empty doc, does not throw', () => {
    localStorage.setItem('dpr_user_library_v1', '{not json');
    expect(store.loadUserLibrary()).toEqual({ schemaVersion: 1, papers: {} });
  });

  it('wrong schemaVersion is dropped', () => {
    localStorage.setItem(
      'dpr_user_library_v1',
      JSON.stringify({ schemaVersion: 99, papers: { x: { updatedAt: 1 } } }),
    );
    expect(store.loadUserLibrary()).toEqual({ schemaVersion: 1, papers: {} });
  });

  it('single emit source: one write -> one event', () => {
    let count = 0;
    const off = events.onDprUserLibraryChange(window, () => { count++; });
    store.toggleStar('2607.00483');
    expect(count).toBe(1);
    store.toggleStar('2607.00483'); // toggle off
    expect(count).toBe(2);
    // 不可改变的写入不增
    store.setReadingStatus('2607.00483', 'unread');
    expect(count).toBe(2);
    off();
  });

  it('replaceUserLibrary fires exactly one event for many ids', () => {
    let count = 0;
    const off = events.onDprUserLibraryChange(window, () => { count++; });
    store.replaceUserLibrary({
      schemaVersion: 1,
      papers: {
        '2607.00001': { updatedAt: 1, starred: true },
        '2607.00002': { updatedAt: 2, readingStatus: 'read' },
        '2607.00003': { updatedAt: 3, note: 'x' },
      },
    });
    expect(count).toBe(1);
    expect(store.listStarred()).toEqual(['2607.00001']);
    off();
  });

  it('clearUserLibrary wipes everything', () => {
    store.toggleStar('2607.00001');
    store.setUserNote('2607.00002', 'x');
    store.clearUserLibrary();
    expect(store.loadUserLibrary()).toEqual({ schemaVersion: 1, papers: {} });
  });

  it('no change -> no event', () => {
    let count = 0;
    const off = events.onDprUserLibraryChange(window, () => { count++; });
    store.setReadingStatus('2607.00483', 'unread'); // 已经是默认
    expect(count).toBe(0);
    expect(store.loadUserLibrary().papers).toEqual({});
    off();
  });

  it('setStarred(false) when not starred is a no-op', () => {
    let count = 0;
    const off = events.onDprUserLibraryChange(window, () => { count++; });
    const r = store.setStarred('2607.00483', false);
    expect(r).toEqual({ ok: true, changed: false });
    expect(count).toBe(0);
    off();
  });
});

// ★ user-library/gist 测试模块已删除: 2026-07-31 取消 Gist 同步后,
// 导出(BibTeX / CSL-JSON / Obsidian ZIP)走 tests/test_export_bibtex.test.ts,
// 不再走 user-library/gist 路径。
