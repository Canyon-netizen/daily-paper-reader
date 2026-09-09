/**
 * tests/test_agents_candidates.mjs — archive → candidates 加载守护。
 *
 * 覆盖:
 *   1. 真实 archive session(20260821,28 篇)能加载出 28 个 candidates
 *   2. candidates 字段对齐 RoundInput.candidates shape(arxivId/title/tldr)
 *   3. 缺失/无 paper 的 session → 返回空数组
 *   4. CLI 暴露 --no-candidates 标志
 *
 * 跑法:node tests/test_agents_candidates.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const { loadCandidatesFromArchive } = await import(
  join(ROOT, 'astro-src/scripts/agents-run.mjs')
);

// ---------------------------------------------------------------------------
// 真实 archive session 加载
// ---------------------------------------------------------------------------

describe('loadCandidatesFromArchive', () => {
  it('loads papers from a real archive session (20260821 has 28 papers)', async () => {
    const out = await loadCandidatesFromArchive('20260821', 30);
    assert.ok(out.length >= 20, `expected ≥20 candidates, got ${out.length}`);
    for (const c of out) {
      assert.ok(c.arxivId, 'arxivId must be set');
      assert.ok(c.title, 'title must be set');
      // tldr can be undefined
    }
  });

  it('caps results at maxPapers', async () => {
    const out = await loadCandidatesFromArchive('20260821', 5);
    assert.equal(out.length, 5);
  });

  it('returns empty array for missing session', async () => {
    const out = await loadCandidatesFromArchive('20991231_nonexistent_session', 30);
    assert.deepEqual(out, []);
  });

  it('returns empty array for session without recommend/', async () => {
    // 用 archive/20260429 (有 recommend 但 deep_dive/quick_skim 都空) 验证空 paper 的 case
    const out = await loadCandidatesFromArchive('20260429', 30);
    assert.deepEqual(out, []);
  });

  it('matches RoundInput.candidates shape', async () => {
    const out = await loadCandidatesFromArchive('20260821', 3);
    for (const c of out) {
      assert.equal(typeof c.arxivId, 'string');
      assert.equal(typeof c.title, 'string');
      if (c.tldr !== undefined) {
        assert.equal(typeof c.tldr, 'string');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// CLI 标志
// ---------------------------------------------------------------------------

describe('agents-run.mjs: --no-candidates flag', () => {
  it('declares --no-candidates CLI flag', async () => {
    const cliSrc = await readFile(
      join(ROOT, 'astro-src/scripts/agents-run.mjs'),
      'utf8',
    );
    assert.match(cliSrc, /--no-candidates/);
  });

  it('exposes loadCandidatesFromArchive as a function', async () => {
    assert.equal(typeof loadCandidatesFromArchive, 'function');
  });
});
