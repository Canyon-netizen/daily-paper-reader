/**
 * tests/test_agents_session_meta.mjs — session metadata (title/notes) 纯逻辑守护。
 *
 * iter #14:让用户给 session 起个友好名字 + 写自由 notes。
 *
 * localStorage shape:
 *   key:   dpr_agents_meta_<sid>
 *   value: JSON { title: string, notes: string, createdAt: number, updatedAt: number }
 *
 * 这里测纯函数(loadMeta / saveMeta / formatSessionLabel / mergeMeta),不碰 DOM。
 *
 * 跑法:node tests/test_agents_session_meta.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 镜像 index.astro 里的纯函数
const META_KEY = (sid) => `dpr_agents_meta_${sid}`;

function emptyMeta(sid, now = Date.now()) {
  return { sid, title: '', notes: '', createdAt: now, updatedAt: now };
}

function loadMetaFrom(store, sid, now = Date.now()) {
  const raw = store[META_KEY(sid)];
  if (!raw) return emptyMeta(sid, now);
  try {
    const obj = JSON.parse(raw);
    // 容错:缺字段时用空值兜底,但保留 createdAt 不变(以便用户知道首次创建时间)
    return {
      sid,
      title: typeof obj.title === 'string' ? obj.title : '',
      notes: typeof obj.notes === 'string' ? obj.notes : '',
      createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : now,
      updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : now,
    };
  } catch {
    return emptyMeta(sid, now);
  }
}

function saveMeta(store, sid, patch, now = Date.now()) {
  const prev = loadMetaFrom(store, sid, now);
  const next = {
    ...prev,
    ...(patch.title !== undefined ? { title: String(patch.title) } : {}),
    ...(patch.notes !== undefined ? { notes: String(patch.notes) } : {}),
    updatedAt: now,
  };
  store[META_KEY(sid)] = JSON.stringify(next);
  return next;
}

function formatSessionLabel(sid, meta, roundCount, appliedCount) {
  const title = meta.title.trim();
  const tag = title ? `📝 ${title}` : sid;
  if (roundCount === 0) return tag;
  const r = `${roundCount} round${roundCount === 1 ? '' : 's'}`;
  return `${tag} · ${r} · ${appliedCount} applied`;
}

describe('loadMetaFrom', () => {
  it('returns empty meta for missing key', () => {
    const m = loadMetaFrom({}, 's1', 1000);
    assert.equal(m.sid, 's1');
    assert.equal(m.title, '');
    assert.equal(m.notes, '');
    assert.equal(m.createdAt, 1000);
  });

  it('parses stored JSON correctly', () => {
    const store = { [META_KEY('s2')]: JSON.stringify({ title: 'X', notes: 'hello', createdAt: 100, updatedAt: 200 }) };
    const m = loadMetaFrom(store, 's2', 999);
    assert.equal(m.title, 'X');
    assert.equal(m.notes, 'hello');
    assert.equal(m.createdAt, 100);  // 不被 now 覆盖
    assert.equal(m.updatedAt, 200);
  });

  it('tolerates malformed JSON', () => {
    const store = { [META_KEY('s3')]: 'not-json' };
    const m = loadMetaFrom(store, 's3', 500);
    assert.equal(m.title, '');
    assert.equal(m.createdAt, 500);  // now 当作 createdAt
  });

  it('falls back to empty string for missing fields', () => {
    const store = { [META_KEY('s4')]: JSON.stringify({}) };
    const m = loadMetaFrom(store, 's4', 700);
    assert.equal(m.title, '');
    assert.equal(m.notes, '');
  });

  it('rejects non-string title/notes (defensive)', () => {
    const store = { [META_KEY('s5')]: JSON.stringify({ title: 42, notes: null }) };
    const m = loadMetaFrom(store, 's5');
    assert.equal(m.title, '');
    assert.equal(m.notes, '');
  });
});

describe('saveMeta', () => {
  it('creates meta on first save', () => {
    const store = {};
    const m = saveMeta(store, 'new', { title: 'hello' }, 1000);
    assert.equal(m.title, 'hello');
    assert.equal(m.notes, '');
    assert.equal(m.createdAt, 1000);
    assert.equal(m.updatedAt, 1000);
    // 落盘
    assert.ok(store[META_KEY('new')]);
    const reread = JSON.parse(store[META_KEY('new')]);
    assert.equal(reread.title, 'hello');
  });

  it('preserves createdAt on subsequent saves', () => {
    const store = {};
    saveMeta(store, 's', { title: 'a' }, 100);
    const m2 = saveMeta(store, 's', { title: 'b', notes: 'n' }, 200);
    assert.equal(m2.title, 'b');
    assert.equal(m2.notes, 'n');
    assert.equal(m2.createdAt, 100);  // 不变
    assert.equal(m2.updatedAt, 200);  // 推进
  });

  it('partial patch — only update provided fields', () => {
    const store = {};
    saveMeta(store, 's', { title: 'T', notes: 'N1' }, 100);
    const m2 = saveMeta(store, 's', { notes: 'N2' }, 200);
    assert.equal(m2.title, 'T');     // 没动
    assert.equal(m2.notes, 'N2');    // 改了
  });

  it('coerces non-string title/notes to string (defensive)', () => {
    const store = {};
    // 用空对象绕过类型检查——这里直接走字符串化路径
    const m = saveMeta(store, 's', { title: 42, notes: true }, 100);
    assert.equal(m.title, '42');
    assert.equal(m.notes, 'true');
  });
});

describe('formatSessionLabel', () => {
  it('shows sid when no title', () => {
    const label = formatSessionLabel('20260429', { title: '', notes: '' }, 0, 0);
    assert.equal(label, '20260429');
  });
  it('shows 📝 title when present', () => {
    const label = formatSessionLabel('20260429', { title: 'Paper ACL' }, 0, 0);
    assert.equal(label, '📝 Paper ACL');
  });
  it('trims whitespace-only title back to sid', () => {
    const label = formatSessionLabel('20260429', { title: '   ' }, 0, 0);
    assert.equal(label, '20260429');
  });
  it('appends round count and applied', () => {
    const label = formatSessionLabel('s', { title: 'X' }, 5, 12);
    assert.equal(label, '📝 X · 5 rounds · 12 applied');
  });
  it('singular "round" for count=1', () => {
    const label = formatSessionLabel('s', { title: 'X' }, 1, 0);
    assert.equal(label, '📝 X · 1 round · 0 applied');
  });
});

describe('integration', () => {
  it('full lifecycle: empty → set title → set notes → reformat', () => {
    const store = {};
    const now0 = 1000;

    // 首次访问 → empty
    let m = loadMetaFrom(store, 'myproj', now0);
    assert.equal(m.title, '');
    assert.equal(m.createdAt, now0);

    // 设标题(此时 createdAt = save timestamp,因为是第一次落盘)
    m = saveMeta(store, 'myproj', { title: 'ACL review' }, now0 + 1);
    assert.equal(m.title, 'ACL review');
    assert.equal(m.createdAt, now0 + 1);

    // 加 notes — createdAt 不变
    m = saveMeta(store, 'myproj', { notes: 'tried 3 rounds, stuck on R2' }, now0 + 2);
    assert.equal(m.title, 'ACL review');
    assert.equal(m.notes, 'tried 3 rounds, stuck on R2');
    assert.equal(m.createdAt, now0 + 1);  // 不变
    assert.equal(m.updatedAt, now0 + 2);  // 推进

    // 用 picker 渲染
    const label = formatSessionLabel('myproj', m, 3, 5);
    assert.equal(label, '📝 ACL review · 3 rounds · 5 applied');

    // 模拟刷新页面:从 localStorage 重新读
    const reloaded = loadMetaFrom(store, 'myproj', now0 + 100);
    assert.equal(reloaded.title, 'ACL review');
    assert.equal(reloaded.notes, 'tried 3 rounds, stuck on R2');
    assert.equal(reloaded.createdAt, now0 + 1);  // 不变
  });
});
