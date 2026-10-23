/**
 * agents-paperclip-skill-source.test.mjs — iter #74
 *
 * Run: node --test astro-src/scripts/agents-paperclip-skill-source.test.mjs
 *
 * 覆盖两件事:
 *   1. Paperclip 源本身(纯函数 + 预取)
 *   2. loader 的接入(远端优先 / 本地兜底)
 *
 * 治理相关的断言是重点:
 *   - 只读 agent 的 pin(已批准版本);没有 pin 就当"没有已批准版本"
 *   - 绝不用 company_skill.currentVersionId 兜底 —— 那是"最新写入",
 *     可能只是 learning agent 提了个没人审的提案
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = await import('../lib/agents/paperclip-skill-source.mjs');
const loader = await import('../lib/agents/skill-context-loader.mjs');

const COMPANY = 'a5512fef-389f-487a-9509-12615c4f09ab';
const SKILL_KEY = `company/${COMPANY}/delivery-methodology`;
const SKILL_ID = 'b23eb40f-c349-4467-92a2-fde8c2e52911';
const AGENT_ID = '23988f5f-5cfb-4ada-8584-a09d2d4248c4';
const APPROVED = 'df9c0af1-930f-4fc1-a705-ca6b01a6bd67';
const LATEST_WRITTEN = '4ce47491-1a92-47eb-8b36-1cbf22f347b9';

const FILES = [
  { path: 'references/evidence-and-attribution.md', content: 'evidence rules' },
  { path: 'SKILL.md', content: '# Delivery methodology\n\nread the state first' },
];

// ---------------------------------------------------------------------------
// 测试替身
// ---------------------------------------------------------------------------

/** 一个假的 Paperclip 实例:pin 指哪版就返回哪版 */
function fakePaperclip({ pinnedVersionId = APPROVED, currentVersionId = LATEST_WRITTEN } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const json = (body, ok = true) => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    });
    if (url.includes('/api/agents/') && url.endsWith('/skills')) {
      return json({
        desiredSkillEntries: pinnedVersionId ? [{ key: SKILL_KEY, versionId: pinnedVersionId }] : [],
        entries: [],
      });
    }
    if (url.includes('/api/companies/') && url.endsWith('/skills')) {
      return json([
        { id: SKILL_ID, key: SKILL_KEY, currentVersionId },
        { id: 'other', key: `company/${COMPANY}/other`, currentVersionId: null },
      ]);
    }
    if (url.includes('/versions/')) {
      const versionId = url.split('/versions/')[1];
      return json({
        id: versionId,
        fileInventory: versionId === APPROVED
          ? FILES
          : [{ path: 'SKILL.md', content: '# the rejected drill version' }],
      });
    }
    return json({ error: 'not found' }, false);
  };
  return { fetchImpl, calls };
}

const ENV = {
  PAPERCLIP_API_URL: 'http://127.0.0.1:3100',
  PAPERCLIP_SKILL_AGENT_ID: AGENT_ID,
  PAPERCLIP_SKILL_KEY: SKILL_KEY,
};

let tmp;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dpr-paperclip-skill-'));
});

after(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

describe('parsePaperclipSkillKey', () => {
  test('parses company/<uuid>/<slug>', () => {
    assert.deepStrictEqual(source.parsePaperclipSkillKey(SKILL_KEY), {
      companyId: COMPANY,
      slug: 'delivery-methodology',
    });
  });
  test('rejects other shapes', () => {
    for (const bad of ['', 'paperclipai/paperclip/complain', 'company/x/y', null, undefined]) {
      assert.strictEqual(source.parsePaperclipSkillKey(bad), null, `input=${bad}`);
    }
  });
});

describe('pickPinnedVersionId', () => {
  test('returns the pinned version', () => {
    const snapshot = { desiredSkillEntries: [{ key: SKILL_KEY, versionId: APPROVED }] };
    assert.strictEqual(source.pickPinnedVersionId(snapshot, SKILL_KEY), APPROVED);
  });
  test('returns null when nothing is pinned', () => {
    assert.strictEqual(source.pickPinnedVersionId({ desiredSkillEntries: [] }, SKILL_KEY), null);
  });
  test('ignores other skills', () => {
    const snapshot = { desiredSkillEntries: [{ key: `company/${COMPANY}/other`, versionId: APPROVED }] };
    assert.strictEqual(source.pickPinnedVersionId(snapshot, SKILL_KEY), null);
  });
});

describe('pickSkillIdByKey', () => {
  test('finds the skill in a plain array', () => {
    assert.strictEqual(source.pickSkillIdByKey([{ id: SKILL_ID, key: SKILL_KEY }], SKILL_KEY), SKILL_ID);
  });
  test('finds the skill in an items envelope', () => {
    assert.strictEqual(
      source.pickSkillIdByKey({ items: [{ id: SKILL_ID, key: SKILL_KEY }] }, SKILL_KEY),
      SKILL_ID,
    );
  });
  test('returns null for an unknown key', () => {
    assert.strictEqual(source.pickSkillIdByKey([{ id: SKILL_ID, key: SKILL_KEY }], 'company/x/y'), null);
  });
});

describe('selectVersionFiles', () => {
  test('keeps SKILL.md and references, sorted, drops the rest', () => {
    const out = source.selectVersionFiles([
      { path: 'references/b.md', content: 'b' },
      { path: 'SKILL.md', content: 'a' },
      { path: 'scripts/run.sh', content: 'x' },
      { path: 'references/a.bin', content: 'y', encoding: 'base64' },
      { path: 'references/empty.md', content: '' },
    ]);
    assert.deepStrictEqual(out.map((f) => f.path), ['SKILL.md', 'references/b.md']);
  });
  test('tolerates garbage input', () => {
    assert.deepStrictEqual(source.selectVersionFiles(null), []);
    assert.deepStrictEqual(source.selectVersionFiles('nope'), []);
  });
});

describe('computeSkillFilesSha256', () => {
  test('is stable for the same file set', () => {
    const a = source.computeSkillFilesSha256(FILES);
    const b = source.computeSkillFilesSha256([...FILES].reverse());
    assert.strictEqual(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });
  test('changes when the content changes', () => {
    const a = source.computeSkillFilesSha256(FILES);
    const b = source.computeSkillFilesSha256([
      { path: 'SKILL.md', content: '# Delivery methodology\n\nread the state twice' },
      FILES[0],
    ]);
    assert.notStrictEqual(a, b);
  });
  test('changes when a file is added', () => {
    const a = source.computeSkillFilesSha256(FILES);
    const b = source.computeSkillFilesSha256([...FILES, { path: 'references/extra.md', content: 'x' }]);
    assert.notStrictEqual(a, b);
  });
});

describe('buildSkillCache / parseSkillCache', () => {
  test('builds a cache with the sha256 of the file set', () => {
    const cache = source.buildSkillCache({
      key: SKILL_KEY, skillId: SKILL_ID, versionId: APPROVED, files: FILES,
      fetchedAt: '2026-10-22T00:00:00.000Z',
    });
    assert.strictEqual(cache.versionId, APPROVED);
    assert.strictEqual(cache.sha256, source.computeSkillFilesSha256(FILES));
    assert.strictEqual(cache.files.length, 2);
  });
  test('parses a valid cache and rejects garbage', () => {
    const cache = source.buildSkillCache({
      key: SKILL_KEY, skillId: SKILL_ID, versionId: APPROVED, files: FILES, fetchedAt: 'now',
    });
    assert.strictEqual(source.parseSkillCache(JSON.stringify(cache)).versionId, APPROVED);
    assert.strictEqual(source.parseSkillCache('not json'), null);
    assert.strictEqual(source.parseSkillCache('{"versionId":null,"files":[]}'), null);
    assert.strictEqual(source.parseSkillCache(''), null);
  });
});

describe('readSkillCache / writeSkillCache', () => {
  test('round trips through a file', () => {
    const path = join(tmp, 'cache.json');
    const cache = source.buildSkillCache({
      key: SKILL_KEY, skillId: SKILL_ID, versionId: APPROVED, files: FILES, fetchedAt: 'now',
    });
    assert.strictEqual(source.writeSkillCache(path, cache), true);
    assert.strictEqual(source.readSkillCache(path).versionId, APPROVED);
  });
  test('returns null for a missing file', () => {
    assert.strictEqual(source.readSkillCache(join(tmp, 'nope.json')), null);
  });
  test('returns null for a corrupt file', () => {
    const path = join(tmp, 'broken.json');
    writeFileSync(path, '{oops', 'utf8');
    assert.strictEqual(source.readSkillCache(path), null);
  });
});

describe('isSkillCacheFresh', () => {
  const now = Date.parse('2026-10-22T00:00:00.000Z');
  test('fresh inside the ttl', () => {
    const cache = { fetchedAt: '2026-10-22T00:00:00.000Z' };
    assert.strictEqual(source.isSkillCacheFresh(cache, 60_000, now + 30_000), true);
  });
  test('stale outside the ttl', () => {
    const cache = { fetchedAt: '2026-10-22T00:00:00.000Z' };
    assert.strictEqual(source.isSkillCacheFresh(cache, 60_000, now + 120_000), false);
  });
  test('a zero ttl never counts as fresh', () => {
    const cache = { fetchedAt: '2026-10-22T00:00:00.000Z' };
    assert.strictEqual(source.isSkillCacheFresh(cache, 0, now), false);
  });
});

describe('parseStageList / stageUsesPaperclipSkill', () => {
  test('parses a comma separated list', () => {
    assert.deepStrictEqual(source.parseStageList('draft, review'), ['draft', 'review']);
  });
  test('an empty list means every stage', () => {
    assert.strictEqual(source.parseStageList(''), null);
    assert.strictEqual(source.stageUsesPaperclipSkill({ files: [] }, 'draft', null), true);
  });
  test('a list restricts the stages', () => {
    assert.strictEqual(source.stageUsesPaperclipSkill({ files: [] }, 'draft', ['draft']), true);
    assert.strictEqual(source.stageUsesPaperclipSkill({ files: [] }, 'review', ['draft']), false);
  });
});

describe('findApprovedFileForStage', () => {
  const cache = source.buildSkillCache({
    key: SKILL_KEY, skillId: SKILL_ID, versionId: APPROVED,
    files: [
      { path: 'references/writing-paper.md', content: 'the approved writing guide' },
      { path: 'SKILL.md', content: 'the approved summary' },
    ],
    fetchedAt: 'now',
  });
  test('matches on the file name', () => {
    assert.strictEqual(
      source.findApprovedFileForStage(cache, 'writing-paper.md').content,
      'the approved writing guide',
    );
  });
  test('returns null when the approved version has no such file', () => {
    assert.strictEqual(source.findApprovedFileForStage(cache, 'reviewer-mindset.md'), null);
  });
  test('tolerates a missing cache', () => {
    assert.strictEqual(source.findApprovedFileForStage(null, 'writing-paper.md'), null);
  });
});

describe('truncateSkillText', () => {
  test('keeps short text as is', () => {
    assert.strictEqual(source.truncateSkillText('short', 100), 'short');
  });
  test('truncates long text and marks it', () => {
    const out = source.truncateSkillText('x'.repeat(50), 10);
    assert.ok(out.startsWith('x'.repeat(10)));
    assert.match(out, /truncated/);
  });
});

describe('renderSkillCacheBlock', () => {
  const cache = source.buildSkillCache({
    key: SKILL_KEY, skillId: SKILL_ID, versionId: APPROVED, files: FILES, fetchedAt: 'now',
  });
  test('renders the summary with version and sha256', () => {
    const out = source.renderSkillCacheBlock(cache, 'draft');
    assert.match(out, /^\[方法论上下文 · paperclip skill=delivery-methodology/);
    assert.ok(out.includes(APPROVED));
    assert.ok(out.includes(cache.sha256));
    assert.ok(out.includes('read the state first'));
  });
  test('stays empty when the stage is not enabled', () => {
    assert.strictEqual(source.renderSkillCacheBlock(cache, 'review', { stages: ['draft'] }), '');
  });
  test('stays empty without a cache', () => {
    assert.strictEqual(source.renderSkillCacheBlock(null, 'draft'), '');
  });
});

// ---------------------------------------------------------------------------
// 预取
// ---------------------------------------------------------------------------

describe('prefetchPaperclipSkill', () => {
  test('fetches the pinned version', async () => {
    const { fetchImpl } = fakePaperclip();
    const result = await source.prefetchPaperclipSkill({
      fetchImpl, env: ENV, now: new Date('2026-10-22T00:00:00.000Z'),
    });
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.cache.versionId, APPROVED);
    assert.strictEqual(result.cache.skillId, SKILL_ID);
    assert.strictEqual(result.cache.files.length, 2);
  });

  test('no pin means no approved version - it never falls back to currentVersionId', async () => {
    const { fetchImpl, calls } = fakePaperclip({ pinnedVersionId: null });
    const result = await source.prefetchPaperclipSkill({
      fetchImpl, env: ENV, now: new Date('2026-10-22T00:00:00.000Z'),
    });
    assert.strictEqual(result.status, 'no-pin');
    assert.strictEqual(result.cache, null);
    assert.ok(!calls.some((url) => url.includes('/versions/')), 'must not read any version');
  });

  test('is disabled without configuration', async () => {
    const result = await source.prefetchPaperclipSkill({ fetchImpl: async () => ({}), env: {} });
    assert.strictEqual(result.status, 'disabled');
  });

  test('reports a broken key', async () => {
    const result = await source.prefetchPaperclipSkill({
      fetchImpl: async () => ({}), env: { ...ENV, PAPERCLIP_SKILL_KEY: 'nonsense' },
    });
    assert.strictEqual(result.status, 'error');
    assert.match(result.error, /PAPERCLIP_SKILL_KEY/);
  });

  test('reports a transport failure', async () => {
    const result = await source.prefetchPaperclipSkill({
      fetchImpl: async () => { throw new Error('connection refused'); },
      env: ENV,
    });
    assert.strictEqual(result.status, 'error');
    assert.match(result.error, /connection refused/);
  });
});

describe('refreshPaperclipSkillCache', () => {
  test('writes the cache and reuses it inside the ttl', async () => {
    const path = join(tmp, 'refresh.json');
    const env = { ...ENV, PAPERCLIP_SKILL_CACHE: path, PAPERCLIP_SKILL_TTL_MS: '600000' };
    const { fetchImpl, calls } = fakePaperclip();
    const now = new Date('2026-10-22T00:00:00.000Z');

    const first = await source.refreshPaperclipSkillCache({ fetchImpl, env, now });
    assert.strictEqual(first.status, 'ok');
    assert.strictEqual(first.cached, false);
    assert.ok(existsSync(path));

    const second = await source.refreshPaperclipSkillCache({ fetchImpl, env, now });
    assert.strictEqual(second.cached, true);
    assert.strictEqual(calls.length, 3, 'the second call must not hit the network again');
  });
});

// ---------------------------------------------------------------------------
// loader 接入
// ---------------------------------------------------------------------------

describe('skill-context-loader with the Paperclip source', () => {
  const cache = source.buildSkillCache({
    key: SKILL_KEY, skillId: SKILL_ID, versionId: APPROVED,
    files: [
      { path: 'references/writing-paper.md', content: 'the approved writing guide' },
      { path: 'SKILL.md', content: 'the approved summary' },
    ],
    fetchedAt: 'now',
  });

  test('without a cache the stage context is exactly the local one', () => {
    const out = loader.loadSkillContext('draft', { cache: null });
    assert.match(out, /^\[方法论上下文 · stage=draft\]/);
    assert.match(out, /### writing-paper\.md/);
    assert.doesNotMatch(out, /paperclip skill=/);
    assert.doesNotMatch(out, /已批准版本/);
  });

  test('with a cache the approved summary is injected', () => {
    const out = loader.loadSkillContext('draft', { cache });
    assert.match(out, /\[方法论上下文 · paperclip skill=delivery-methodology/);
    assert.ok(out.includes(APPROVED));
    assert.ok(out.includes(cache.sha256));
    assert.ok(out.includes('the approved summary'));
  });

  test('the approved document wins over the local one', () => {
    const out = loader.loadSkillContext('draft', { cache });
    assert.ok(out.includes('the approved writing guide'));
    assert.doesNotMatch(out, /writing-paper\.md\n(?!\n?the approved writing guide)/);
    const local = readFileSync(join('docs/research-skills', 'writing-paper.md'), 'utf8');
    assert.ok(!out.includes(local.slice(0, 120)), 'the local document must not be injected any more');
  });

  test('a stage that is not enabled gets no Paperclip block', () => {
    const out = loader.loadSkillContext('draft', { cache, stages: ['review'] });
    assert.doesNotMatch(out, /paperclip skill=/);
  });
});
