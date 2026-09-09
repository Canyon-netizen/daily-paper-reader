/**
 * tests/test_agents_candidates_lib.mjs — candidates 库函数守护。
 *
 * 覆盖 buildCandidatesFromLibrary:
 *   1. 空 paperIds → []
 *   2. 正常 library + paper lookup → 顺序 / 字段 / 中文优先
 *   3. maxPapers 截断
 *   4. skipMissing:true → 跳过缺失论文
 *   5. skipMissing:false(默认)→ 用 "(missing) <id>" 占位
 *   6. paper lookup 抛错 → 走 missing 分支
 *   7. paperLookup async → 正确 await
 *
 * 跑法:node tests/test_agents_candidates_lib.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidatesFromLibrary } from '../astro-src/lib/agents/candidates.mjs';

const sampleLibrary = {
  id: 'lib-test',
  name: 'Test Library',
  statement: 'unit test',
  paperIds: ['2401.00001v1', '2401.00002v1', '2401.00003v1'],
};

function fakeLookup(map) {
  return async (id) => map[id] ?? null;
}

describe('buildCandidatesFromLibrary', () => {
  it('returns [] when library has no paperIds', async () => {
    const out = await buildCandidatesFromLibrary(
      { paperIds: [] },
      fakeLookup({}),
    );
    assert.deepEqual(out, []);
  });

  it('builds candidates in input order with title + tldr', async () => {
    const lookup = fakeLookup({
      '2401.00001v1': { title: 'Paper One', tldr: 'one tldr' },
      '2401.00002v1': { title: 'Paper Two', tldr: 'two tldr' },
      '2401.00003v1': { title: 'Paper Three' },
    });
    const out = await buildCandidatesFromLibrary(sampleLibrary, lookup);
    assert.equal(out.length, 3);
    assert.deepEqual(out[0], { arxivId: '2401.00001v1', title: 'Paper One', tldr: 'one tldr' });
    assert.deepEqual(out[1], { arxivId: '2401.00002v1', title: 'Paper Two', tldr: 'two tldr' });
    assert.deepEqual(out[2], { arxivId: '2401.00003v1', title: 'Paper Three' }); // no tldr
  });

  it('prefers Chinese title_zh / tldr_zh when present', async () => {
    const lookup = fakeLookup({
      '2401.00001v1': { title: 'English', title_zh: '中文', tldr: 'en', tldr_zh: '中文 tldr' },
    });
    const out = await buildCandidatesFromLibrary({ paperIds: ['2401.00001v1'] }, lookup);
    assert.equal(out[0].title, '中文');
    assert.equal(out[0].tldr, '中文 tldr');
  });

  it('caps results at maxPapers', async () => {
    const lookup = fakeLookup({
      '2401.00001v1': { title: 'A' },
      '2401.00002v1': { title: 'B' },
      '2401.00003v1': { title: 'C' },
    });
    const out = await buildCandidatesFromLibrary(sampleLibrary, lookup, { maxPapers: 2 });
    assert.equal(out.length, 2);
    assert.equal(out[1].title, 'B');
  });

  it('skipMissing: true drops missing papers', async () => {
    const lookup = fakeLookup({ '2401.00001v1': { title: 'A' } });
    const out = await buildCandidatesFromLibrary(sampleLibrary, lookup, { skipMissing: true });
    assert.equal(out.length, 1);
    assert.equal(out[0].arxivId, '2401.00001v1');
  });

  it('default (skipMissing: false) keeps missing papers with placeholder', async () => {
    const lookup = fakeLookup({ '2401.00001v1': { title: 'A' } });
    const out = await buildCandidatesFromLibrary(sampleLibrary, lookup);
    assert.equal(out.length, 3);
    assert.match(out[1].title, /^\(missing\) 2401\.00002v1$/);
    assert.match(out[2].title, /^\(missing\) 2401\.00003v1$/);
  });

  it('handles paperLookup throwing', async () => {
    const lookup = async () => { throw new Error('disk fail'); };
    const out = await buildCandidatesFromLibrary({ paperIds: ['x', 'y'] }, lookup);
    assert.equal(out.length, 2);
    assert.match(out[0].title, /^\(missing\) x$/);
  });

  it('supports async paperLookup', async () => {
    const lookup = async (id) => {
      await new Promise((r) => setTimeout(r, 1));
      return { title: `Title for ${id}` };
    };
    const out = await buildCandidatesFromLibrary(
      { paperIds: ['a', 'b'] },
      lookup,
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].title, 'Title for a');
    assert.equal(out[1].title, 'Title for b');
  });
});
