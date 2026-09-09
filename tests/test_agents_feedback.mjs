/**
 * tests/test_agents_feedback.mjs — agents/feedback.mjs 关键路径守护。
 *
 * 覆盖:
 *   1. feedbackEvaluate + 真 LLM judge → 至少 1 个 proposal 的 matches > 0
 *   2. feedbackEvaluate + 抛错的 LLM → fallback 到 tie,wins/matches 不增
 *   3. judgePair 解析失败(LLM 返回非 JSON)→ fallback
 *
 * 用 node:test 跑(Node 20+ 自带);亦可被 bun test 兼容导入。
 *   node tests/test_agents_feedback.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackEvaluate } from '../astro-src/lib/agents/feedback.mjs';
import { ELO_INITIAL } from '../astro-src/lib/elo-debate.mjs';

// ---------------------------------------------------------------------------
// 测试用 caller 工厂
// ---------------------------------------------------------------------------

/** 总是返回指定 JSON 的 caller */
function fixedCaller(json) {
  return {
    async callLLM({ system }) {
      if (system.includes('方法论者') || system.includes('工程师') || system.includes('怀疑论者')) {
        return JSON.stringify({ score: 6, critique: '(test persona)' });
      }
      // judge system prompt
      return typeof json === 'string' ? json : JSON.stringify(json);
    },
  };
}

/** 模拟"非 JSON 输出"的 caller */
function malformedCaller() {
  return {
    async callLLM({ system }) {
      if (system.includes('方法论者') || system.includes('工程师') || system.includes('怀疑论者')) {
        return JSON.stringify({ score: 6, critique: '(test persona)' });
      }
      return 'this is not JSON at all, sorry';
    },
  };
}

/** 模拟 LLM 抛错的 caller */
function failingCaller() {
  return {
    async callLLM({ system }) {
      if (system.includes('方法论者') || system.includes('工程师') || system.includes('怀疑论者')) {
        return JSON.stringify({ score: 6, critique: '(test persona)' });
      }
      throw new Error('network down');
    },
  };
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makeProposal(id, title, effort = 'low') {
  return {
    id,
    round: 1,
    type: 'add_paper',
    title,
    rationale: `(test rationale for ${title})`,
    evidence: { paperIds: ['2401.00001'], quotes: [] },
    target: { projectId: 'test' },
    estimated_effort: effort,
    risk: '(test risk)',
    created_at: Date.now(),
  };
}

const input = {
  project: { id: 'test', name: 'test', statement: 'test project' },
  candidates: [],
  user_goal: '(test)',
  round: 1,
};

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe('feedbackEvaluate (real LLM judge path)', () => {
  it('produces critiques for ≥2 proposals with non-zero matches', async () => {
    const proposals = [
      makeProposal('p_a', '读 2 篇 LLM agent 论文', 'low'),
      makeProposal('p_b', '做 1 个 multi-agent benchmark', 'high'),
    ];
    const caller = fixedCaller({ winner: 'a', reason: 'p_a cheaper + more grounded' });
    const critiques = await feedbackEvaluate(proposals, input, caller, { judgeRounds: 1 });

    assert.equal(critiques.length, 2);
    for (const c of critiques) {
      assert.ok(c.proposal_id, 'proposal_id should be set');
      assert.ok(c.total > 0, 'total should be > 0');
      assert.ok(c.elo > ELO_INITIAL - 50, `elo ${c.elo} should be near initial`);
      assert.ok(c.elo < ELO_INITIAL + 50, `elo ${c.elo} should be near initial`);
    }
    const withMatches = critiques.filter((c) => c.matches >= 1);
    assert.ok(withMatches.length >= 1, 'at least one proposal should have matches >= 1 after 1 Swiss round');
  });

  it('falls back to tie when LLM throws', async () => {
    const proposals = [
      makeProposal('p_x', 'fallback test x'),
      makeProposal('p_y', 'fallback test y'),
    ];
    const caller = failingCaller();
    const critiques = await feedbackEvaluate(proposals, input, caller, { judgeRounds: 2 });

    assert.equal(critiques.length, 2);
    for (const c of critiques) {
      assert.equal(c.elo, ELO_INITIAL, 'elo should stay at initial on tie-only fallback');
      assert.equal(c.wins, 0, 'wins should be 0 on tie-only fallback');
    }
  });

  it('falls back to tie when LLM returns malformed JSON', async () => {
    const proposals = [
      makeProposal('p_m1', 'malformed test 1'),
      makeProposal('p_m2', 'malformed test 2'),
    ];
    const caller = malformedCaller();
    const critiques = await feedbackEvaluate(proposals, input, caller, { judgeRounds: 1 });

    assert.equal(critiques.length, 2);
    for (const c of critiques) {
      assert.equal(c.elo, ELO_INITIAL);
    }
  });

  it('handles single proposal without running Elo (proposals.length < 2)', async () => {
    const proposals = [makeProposal('p_alone', 'lone proposal')];
    const caller = fixedCaller({ winner: 'a', reason: '(unused)' });
    const critiques = await feedbackEvaluate(proposals, input, caller, { judgeRounds: 1 });
    assert.equal(critiques.length, 1);
    assert.equal(critiques[0].matches, 0);
    assert.equal(critiques[0].elo, ELO_INITIAL);
  });
});
