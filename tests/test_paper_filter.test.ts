// tests/test_paper_filter.test.ts — Stage 10 谓词单元测试。
//
// 跑法: bun test tests/test_paper_filter.test.ts
//
// 覆盖 7 个谓词 + applyLibraryFilters 组合:
//   - 空 author / venue 不过滤
//   - filterByAuthor 大小写不敏感
//   - filterByVenue 精确匹配(ICML 不命中 ICML 2025)
//   - filterByYearRange 空 date 跳过;from/to 任一为空
//   - filterByStarred 走 snapshot.starred
//   - filterByReadingStatus unread 视为默认;passing reading/read 精确
//   - filterByHasNote 长度 > 0 才算;空串不进 snapshot.notes
//   - filterByUserTag kind+label 都须匹配;重复 tag 去重不影响结果
//   - applyLibraryFilters 多维 AND 组合

import { describe, it, expect } from 'bun:test';
import type { PaperListItem } from '../astro-src/lib/paper';
import type { ReadingStatus, UserLibrarySnapshot } from '../astro-src/lib/user-library/types';
import {
  filterByAuthor,
  filterByVenue,
  filterByYearRange,
  filterByStarred,
  filterByReadingStatus,
  filterByHasNote,
  filterByUserTag,
  applyLibraryFilters,
} from '../astro-src/lib/paper-filter';

function paper(over: Partial<PaperListItem>): PaperListItem {
  return {
    id: over.id || 'p1',
    arxivId: over.arxivId || '2607.00001',
    canonicalArxivId: over.canonicalArxivId || '2607.00001',
    slug: over.slug || 'p1',
    yearMonth: over.yearMonth || '2026-07',
    day: over.day || '01',
    ...over,
  };
}

function emptySnap(): UserLibrarySnapshot {
  return {
    hidden: new Set(),
    starred: new Set(),
    status: new Map(),
    notes: new Map(),
    userTags: new Map(),
  };
}

describe('filterByAuthor', () => {
  it('empty author → no filter', () => {
    const items = [paper({ authors: 'Alice' })];
    expect(filterByAuthor(items, '')).toBe(items);
    expect(filterByAuthor(items, '   ')).toBe(items);
  });

  it('case-insensitive substring', () => {
    const items = [
      paper({ id: 'a', authors: 'Alice Smith' }),
      paper({ id: 'b', authors: 'Bob' }),
    ];
    expect(filterByAuthor(items, 'alice').map((p) => p.id)).toEqual(['a']);
    expect(filterByAuthor(items, 'SMITH').map((p) => p.id)).toEqual(['a']);
    expect(filterByAuthor(items, 'nobody')).toEqual([]);
  });

  it('empty authors field → never matches', () => {
    expect(filterByAuthor([paper({ authors: '' })], 'x')).toEqual([]);
    expect(filterByAuthor([paper({})], 'x')).toEqual([]);
  });
});

describe('filterByVenue', () => {
  it('empty venue → no filter', () => {
    const items = [paper({ categories: { venue: ['ICML 2025'], task: [], method: [], type: [] } })];
    expect(filterByVenue(items, '')).toBe(items);
  });

  it('exact match — "ICML" must NOT match "ICML 2025"', () => {
    const items = [
      paper({ id: 'a', categories: { venue: ['ICML 2025'], task: [], method: [], type: [] } }),
      paper({ id: 'b', categories: { venue: ['NeurIPS 2024'], task: [], method: [], type: [] } }),
      paper({ id: 'c', categories: { venue: ['ICML'], task: [], method: [], type: [] } }),
    ];
    expect(filterByVenue(items, 'ICML 2025').map((p) => p.id)).toEqual(['a']);
    expect(filterByVenue(items, 'ICML').map((p) => p.id)).toEqual(['c']);
    expect(filterByVenue(items, 'NeurIPS 2024').map((p) => p.id)).toEqual(['b']);
  });

  it('paper without categories → excluded', () => {
    const items = [paper({ id: 'a' })];
    expect(filterByVenue(items, 'ICML 2025')).toEqual([]);
  });
});

describe('filterByYearRange', () => {
  it('from/to both null/undefined → no filter', () => {
    const items = [paper({ date: '2025-01-01' })];
    expect(filterByYearRange(items, {})).toBe(items);
    expect(filterByYearRange(items, { from: undefined, to: undefined })).toBe(items);
  });

  it('from only — inclusive lower bound', () => {
    const items = [
      paper({ id: 'a', date: '2024-12-31' }),
      paper({ id: 'b', date: '2025-01-01' }),
      paper({ id: 'c', date: '2025-06-15' }),
    ];
    expect(filterByYearRange(items, { from: 2025 }).map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('to only — inclusive upper bound', () => {
    const items = [
      paper({ id: 'a', date: '2024-06-15' }),
      paper({ id: 'b', date: '2025-12-31' }),
      paper({ id: 'c', date: '2026-01-01' }),
    ];
    expect(filterByYearRange(items, { to: 2025 }).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('both — closed interval', () => {
    const items = [
      paper({ id: 'a', date: '2024-12-31' }),
      paper({ id: 'b', date: '2025-01-01' }),
      paper({ id: 'c', date: '2026-01-01' }),
    ];
    expect(filterByYearRange(items, { from: 2025, to: 2025 }).map((p) => p.id)).toEqual(['b']);
  });

  it('empty / missing date is excluded (matches filterBySinceDays semantics)', () => {
    const items = [
      paper({ id: 'a', date: '' }),
      paper({ id: 'b' }),
      paper({ id: 'c', date: '2025-05-05' }),
    ];
    expect(filterByYearRange(items, { from: 2024 }).map((p) => p.id)).toEqual(['c']);
  });
});

describe('filterByStarred', () => {
  it('empty snapshot.starred → no filter', () => {
    const items = [paper({ canonicalArxivId: '2607.00001' })];
    expect(filterByStarred(items, emptySnap())).toBe(items);
  });

  it('snapshot.starred acts as whitelist by canonical id', () => {
    const items = [
      paper({ id: 'a', canonicalArxivId: '2607.00001' }),
      paper({ id: 'b', canonicalArxivId: '2607.00002' }),
      paper({ id: 'c', canonicalArxivId: '2607.00003' }),
    ];
    const snap: UserLibrarySnapshot = {
      ...emptySnap(),
      starred: new Set(['2607.00001', '2607.00003']),
    };
    expect(filterByStarred(items, snap).map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('paper without canonicalArxivId → excluded', () => {
    const items = [paper({ id: 'a', canonicalArxivId: '' })];
    const snap: UserLibrarySnapshot = { ...emptySnap(), starred: new Set(['']) };
    expect(filterByStarred(items, snap)).toEqual([]);
  });
});

describe('filterByReadingStatus', () => {
  it('"unread" + empty snapshot → no filter (default value)', () => {
    const items = [paper({ canonicalArxivId: '2607.00001' })];
    expect(filterByReadingStatus(items, 'unread', emptySnap())).toBe(items);
  });

  it('"reading" exact match', () => {
    const items = [
      paper({ id: 'a', canonicalArxivId: '2607.00001' }),
      paper({ id: 'b', canonicalArxivId: '2607.00002' }),
      paper({ id: 'c', canonicalArxivId: '2607.00003' }),
    ];
    const snap: UserLibrarySnapshot = {
      ...emptySnap(),
      status: new Map<string, ReadingStatus>([
        ['2607.00002', 'reading'],
        ['2607.00003', 'read'],
      ]),
    };
    expect(filterByReadingStatus(items, 'reading', snap).map((p) => p.id)).toEqual(['b']);
    expect(filterByReadingStatus(items, 'read', snap).map((p) => p.id)).toEqual(['c']);
    expect(filterByReadingStatus(items, 'unread', snap).map((p) => p.id)).toEqual(['a']);
  });
});

describe('filterByHasNote', () => {
  it('empty snapshot.notes → no filter', () => {
    const items = [paper({ canonicalArxivId: '2607.00001' })];
    expect(filterByHasNote(items, emptySnap())).toBe(items);
  });

  it('only entries with non-empty notes are in snapshot.notes (Map.has semantics)', () => {
    const items = [
      paper({ id: 'a', canonicalArxivId: '2607.00001' }),
      paper({ id: 'b', canonicalArxivId: '2607.00002' }),
      paper({ id: 'c', canonicalArxivId: '2607.00003' }),
    ];
    const snap: UserLibrarySnapshot = {
      ...emptySnap(),
      notes: new Map([['2607.00002', 'real notes here']]),
    };
    expect(filterByHasNote(items, snap).map((p) => p.id)).toEqual(['b']);
  });

  it('empty-string entries must NOT be in snapshot.notes (handled by snapshot)', () => {
    // snapshot builder is responsible for stripping; verify predicate matches via .has()
    const items = [paper({ canonicalArxivId: '2607.00001' })];
    const snap: UserLibrarySnapshot = {
      ...emptySnap(),
      notes: new Map(), // empty string must not appear
    };
    expect(filterByHasNote(items, snap)).toBe(items);
  });
});

describe('filterByUserTag', () => {
  it('empty kind/label → no filter', () => {
    const items = [paper({ canonicalArxivId: '2607.00001' })];
    expect(filterByUserTag(items, '', 'foo', emptySnap())).toBe(items);
    expect(filterByUserTag(items, 'topic', '', emptySnap())).toBe(items);
  });

  it('kind + label must both match', () => {
    const items = [
      paper({ id: 'a', canonicalArxivId: '2607.00001' }),
      paper({ id: 'b', canonicalArxivId: '2607.00002' }),
    ];
    const snap: UserLibrarySnapshot = {
      ...emptySnap(),
      userTags: new Map([
        ['2607.00001', [{ kind: 'topic', label: 'rl' }, { kind: 'status', label: 'to-read' }]],
        ['2607.00002', [{ kind: 'topic', label: 'cv' }]],
      ]),
    };
    expect(filterByUserTag(items, 'topic', 'rl', snap).map((p) => p.id)).toEqual(['a']);
    expect(filterByUserTag(items, 'topic', 'cv', snap).map((p) => p.id)).toEqual(['b']);
    expect(filterByUserTag(items, 'topic', 'nope', snap)).toEqual([]);
    expect(filterByUserTag(items, 'wrong', 'rl', snap)).toEqual([]);
  });

  it('duplicate tags within a paper do not affect result', () => {
    const items = [paper({ canonicalArxivId: '2607.00001' })];
    const snap: UserLibrarySnapshot = {
      ...emptySnap(),
      userTags: new Map([
        ['2607.00001', [
          { kind: 'topic', label: 'rl' },
          { kind: 'topic', label: 'rl' },
          { kind: 'topic', label: 'rl' },
        ]],
      ]),
    };
    expect(filterByUserTag(items, 'topic', 'rl', snap)).toEqual(items);
  });
});

describe('applyLibraryFilters', () => {
  it('AND-composes all 7 dimensions, empty opts = noop', () => {
    const items = [paper({ canonicalArxivId: '2607.00001', authors: 'X', date: '2025-01-01' })];
    expect(applyLibraryFilters(items, emptySnap(), {})).toBe(items);
  });

  it('starred 5 + reading 2 + note 1 → hasNote returns 1, starred returns 5', () => {
    // 5 starred: 2607.00001..2607.00005
    // 2 reading: 2607.00006, 2607.00007
    // 1 with note: 2607.00008
    const items = Array.from({ length: 8 }, (_, i) => paper({
      id: `p${i + 1}`,
      canonicalArxivId: `2607.0000${i + 1}`,
    }));
    const snap: UserLibrarySnapshot = {
      ...emptySnap(),
      starred: new Set(['2607.00001', '2607.00002', '2607.00003', '2607.00004', '2607.00005']),
      status: new Map<string, ReadingStatus>([
        ['2607.00006', 'reading'],
        ['2607.00007', 'reading'],
      ]),
      notes: new Map([['2607.00008', 'real note content']]),
    };
    expect(filterByStarred(items, snap)).toHaveLength(5);
    expect(filterByReadingStatus(items, 'reading', snap)).toHaveLength(2);
    expect(filterByHasNote(items, snap)).toHaveLength(1);
  });

  it('venue filter narrows the list', () => {
    const items = [
      paper({ id: 'a', categories: { venue: ['ICML 2025'], task: [], method: [], type: [] } }),
      paper({ id: 'b', categories: { venue: ['NeurIPS 2024'], task: [], method: [], type: [] } }),
      paper({ id: 'c', categories: { venue: ['ICML 2025', 'Workshop'], task: [], method: [], type: [] } }),
    ];
    const out = applyLibraryFilters(items, emptySnap(), { venue: 'ICML 2025' });
    expect(out.map((p) => p.id).sort()).toEqual(['a', 'c']);
  });
});