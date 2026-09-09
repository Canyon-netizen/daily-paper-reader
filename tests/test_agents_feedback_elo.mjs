/**
 * tests/test_agents_feedback_elo.mjs — Feedback Elo 配对守护。
 *
 * 守护 runEloRounds 内部状态:
 *   - winner='a' → stA.wins++ 且 stA.elo 上升
 *   - winner='b' → stB.wins++ 且 stB.elo 上升
 *   - winner='tie' → 双方 elo / wins 不变
 *
 * 历史回归:之前曾有 "verdict === 'a'" 把对象当字符串比较,导致 wins 永远 0。
 * 这套测试保证这个 bug 不会再回来。
 *
 * 跑法:node --import tsx tests/test_agents_feedback_elo.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const feedback = await import('../astro-src/lib/agents/feedback.ts');

describe('feedbackEvaluate Elo contract', () => {
  function makeStubCaller(opts) {
    const { judgeWinner = 'a', score = 9 } = opts ?? {};
    return {
      async callLLM({ system, user }) {
        if (system.includes('资深科研合作者')) {
          return JSON.stringify([
            { type: 'literature_review', title: 'A', rationale: 'A',
              evidence: { paperIds: [] }, target: {}, estimated_effort: 'low', risk: 'low' },
            { type: 'literature_review', title: 'B', rationale: 'B',
              evidence: { paperIds: [] }, target: {}, estimated_effort: 'low', risk: 'low' },
          ]);
        }
        if (user && user.includes('winner (a/b/tie)')) {
          return JSON.stringify({ winner: judgeWinner, reason: 'stub' });
        }
        return JSON.stringify({ score });
      },
    };
  }

  function baseInput() {
    return {
      project: { id: 'x', name: 'x', statement: 't' },
      candidates: [],
      user_goal: 't',
      project_state: { paper_count: 0, draft_count: 0 },
      round: 1,
    };
  }

  it('judgePair winner=a raises stA.elo and increments stA.wins', async () => {
    const caller = makeStubCaller({ judgeWinner: 'a' });
    const proposals = [
      { id: 'pa', type: 'literature_review', title: 'A', rationale: 'A',
        evidence: { paperIds: [] }, target: {}, estimated_effort: 'low', risk: 'low' },
      { id: 'pb', type: 'literature_review', title: 'B', rationale: 'B',
        evidence: { paperIds: [] }, target: {}, estimated_effort: 'low', risk: 'low' },
    ];
    const cs = await feedback.feedbackEvaluate(proposals, baseInput(), caller, { model: 'stub', judgeRounds: 1 });
    const pa = cs.find(c => c.proposal_id === 'pa');
    const pb = cs.find(c => c.proposal_id === 'pb');
    assert.equal(pa.wins, 1, 'pa should have 1 win');
    assert.equal(pb.wins, 0, 'pb should have 0 wins');
    assert.ok(pa.elo > 1200, `pa.elo should rise > 1200, got ${pa.elo}`);
    assert.ok(pb.elo < 1200, `pb.elo should fall < 1200, got ${pb.elo}`);
    assert.equal(pa.matches, 1);
    assert.equal(pb.matches, 1);
  });

  it('judgePair winner=b raises stB.elo and increments stB.wins', async () => {
    const caller = makeStubCaller({ judgeWinner: 'b' });
    const proposals = [
      { id: 'pa', type: 'literature_review', title: 'A', rationale: 'A',
        evidence: { paperIds: [] }, target: {}, estimated_effort: 'low', risk: 'low' },
      { id: 'pb', type: 'literature_review', title: 'B', rationale: 'B',
        evidence: { paperIds: [] }, target: {}, estimated_effort: 'low', risk: 'low' },
    ];
    const cs = await feedback.feedbackEvaluate(proposals, baseInput(), caller, { model: 'stub', judgeRounds: 1 });
    const pa = cs.find(c => c.proposal_id === 'pa');
    const pb = cs.find(c => c.proposal_id === 'pb');
    assert.equal(pa.wins, 0);
    assert.equal(pb.wins, 1);
    assert.ok(pa.elo < 1200);
    assert.ok(pb.elo > 1200);
  });

  it('judgePair winner=tie keeps elo + wins unchanged', async () => {
    const caller = makeStubCaller({ judgeWinner: 'tie' });
    const proposals = [
      { id: 'pa', type: 'literature_review', title: 'A', rationale: 'A',
        evidence: { paperIds: [] }, target: {}, estimated_effort: 'low', risk: 'low' },
      { id: 'pb', type: 'literature_review', title: 'B', rationale: 'B',
        evidence: { paperIds: [] }, target: {}, estimated_effort: 'low', risk: 'low' },
    ];
    const cs = await feedback.feedbackEvaluate(proposals, baseInput(), caller, { model: 'stub', judgeRounds: 1 });
    const pa = cs.find(c => c.proposal_id === 'pa');
    const pb = cs.find(c => c.proposal_id === 'pb');
    assert.equal(pa.wins, 0);
    assert.equal(pb.wins, 0);
    assert.equal(pa.elo, 1200);
    assert.equal(pb.elo, 1200);
    assert.equal(pa.matches, 1);
    assert.equal(pb.matches, 1);
  });
});
