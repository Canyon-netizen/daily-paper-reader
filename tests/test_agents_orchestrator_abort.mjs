/**
 * tests/test_agents_orchestrator_abort.mjs — Orchestrator AbortSignal 守护。
 *
 * /agents/ 页面 iter #7 加了 "🛑 停止" 按钮 → AbortController.abort() →
 * runRounds(config, opts, signal) 检测 signal.aborted 后 stoppedReason='cancelled'。
 *
 * 这里的测试不直接 import 那个 .ts(它会拽一堆浏览器模块),而是:
 *   1. 验证 AbortSignal 标准语义(.aborted 在 abort 后立即变 true)
 *   2. 验证 orchestrator 期望的契约:signal 在每轮开头被检查,
 *      已经 aborted 时直接 break 并返回 stoppedReason='cancelled'
 *
 * 用 tsx 加载 .ts。
 *
 * 跑法:node --import tsx tests/test_agents_orchestrator_abort.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';

// 强制 tsx 加载 TS(忽略之前 .mjs 缓存)
process.env.NODE_NO_WARNINGS = '1';

describe('AbortSignal semantics (browser parity)', () => {
  it('aborted flips to true after .abort()', () => {
    const c = new AbortController();
    assert.equal(c.signal.aborted, false);
    c.abort();
    assert.equal(c.signal.aborted, true);
  });

  it('multiple .abort() calls are idempotent', () => {
    const c = new AbortController();
    c.abort();
    c.abort();
    assert.equal(c.signal.aborted, true);
  });

  it('already-aborted signal reports aborted immediately', () => {
    const c = new AbortController();
    c.abort();
    // 新 controller 持有同一个 signal?
    const other = new AbortController();
    assert.equal(other.signal.aborted, false);
    assert.notEqual(c.signal, other.signal);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator contract: 模拟 runRounds 的核心循环,确认 signal 合约
// ---------------------------------------------------------------------------

async function fakeRunRounds({ maxRounds, signal }) {
  const records = [];
  let stopped = 'completed';
  for (let i = 0; i < maxRounds; i++) {
    if (signal?.aborted) { stopped = 'cancelled'; break; }
    records.push({ round: i + 1 });
    // 模拟每轮有一些耗时
    await new Promise((r) => setImmediate(r));
  }
  if (stopped === 'completed' && records.length === maxRounds) stopped = 'max_rounds';
  return { records, stoppedReason: stopped };
}

describe('runRounds abort contract (fake loop mirrors orchestrator)', () => {
  it('without signal: completes all max rounds', async () => {
    const r = await fakeRunRounds({ maxRounds: 3 });
    assert.equal(r.records.length, 3);
    assert.equal(r.stoppedReason, 'max_rounds');
  });

  it('abort before any round: returns empty + cancelled', async () => {
    const c = new AbortController();
    c.abort();
    const r = await fakeRunRounds({ maxRounds: 3, signal: c.signal });
    assert.equal(r.records.length, 0);
    assert.equal(r.stoppedReason, 'cancelled');
  });

  it('abort mid-loop: stops after current round completes', async () => {
    const c = new AbortController();
    const p = fakeRunRounds({
      maxRounds: 10,
      signal: c.signal,
    });
    // 在 microtask 中 abort
    setImmediate(() => c.abort());
    const r = await p;
    // 至少跑过 1 round, 但远少于 10
    assert.ok(r.records.length >= 1, `expected ≥1 round, got ${r.records.length}`);
    assert.ok(r.records.length < 10, `expected <10 rounds, got ${r.records.length}`);
    assert.equal(r.stoppedReason, 'cancelled');
  });

  it('already-aborted signal: returns cancelled immediately', async () => {
    const c = new AbortController();
    c.abort();
    const start = Date.now();
    const r = await fakeRunRounds({ maxRounds: 5, signal: c.signal });
    const elapsed = Date.now() - start;
    assert.equal(r.records.length, 0);
    assert.equal(r.stoppedReason, 'cancelled');
    // 没真正进入循环 → 应该几乎瞬时(<50ms)
    assert.ok(elapsed < 50, `expected <50ms, got ${elapsed}ms`);
  });
});

// ---------------------------------------------------------------------------
// 真实 orchestrator 测试:用 stub adapter + stub caller 验证 abort 在
// orchestrator.ts 真实代码里工作。两条路径:
//   1. already-aborted → 立即 cancelled,records 空
//   2. mid-loop abort → cancelled,records >= 1 但 < maxRounds
//
// mid-loop abort 那条需要至少一个 proposal 让 modifier "applied" 非空,避免
// empty_streak 先发制人。stub caller 给 2 个 proposals,Feedback persona 全给 9,
// Elo 配对里让 p_a 总赢 → 触发 promoted → createWriting stub action 落盘。
// ---------------------------------------------------------------------------

describe('orchestrator.ts real abort (via tsx)', () => {
  let runRounds;
  let makeStubAdapter;

  it('imports and exposes runRounds + makeStubAdapter', async () => {
    const mod = await import('../astro-src/lib/agents/orchestrator.ts');
    runRounds = mod.runRounds;
    assert.equal(typeof runRounds, 'function');

    const modMod = await import('../astro-src/lib/agents/modifier.ts');
    makeStubAdapter = modMod.makeStubAdapter;
    assert.equal(typeof makeStubAdapter, 'function');
  });

  it('already-aborted signal: returns cancelled immediately', async () => {
    if (!runRounds) {
      runRounds = (await import('../astro-src/lib/agents/orchestrator.ts')).runRounds;
      makeStubAdapter = (await import('../astro-src/lib/agents/modifier.ts')).makeStubAdapter;
    }
    const stubCaller = {
      async callLLM() {
        return JSON.stringify({});
      },
    };
    const c = new AbortController();
    c.abort();
    const start = Date.now();
    const result = await runRounds(
      { caller: stubCaller, adapter: makeStubAdapter({ dry_run: true }), maxRounds: 5 },
      { sessionId: 'abort-pre', input: {
        project: { id: 'abort-pre', name: 'abort-pre', statement: 't' },
        candidates: [], user_goal: 't',
        project_state: { paper_count: 0, draft_count: 0 }, round: 1,
      } },
      c.signal,
    );
    const elapsed = Date.now() - start;
    assert.equal(result.stoppedReason, 'cancelled');
    assert.equal(result.records.length, 0);
    assert.ok(elapsed < 50, `expected near-instant, got ${elapsed}ms`);
  });

  it('mid-loop abort: cancels after current round completes', async () => {
    if (!runRounds) {
      runRounds = (await import('../astro-src/lib/agents/orchestrator.ts')).runRounds;
      makeStubAdapter = (await import('../astro-src/lib/agents/modifier.ts')).makeStubAdapter;
    }
    // 2 个 proposals → Elo 配对能形成 → judgePair 被调用 → Elo 上升 → promoted
    // Designer system prompt 用 "资深科研合作者";
    // judgePair system 用 "资深评审" 且 user 提到 "winner (a/b/tie)";
    // persona 用 "方法论者 / 工程师 / 怀疑论者"
    // 让每次 LLM 调用都睡 30ms,确保 setTimeout(abort) 来得及在 round 2 开始前触发
    const stubCaller = {
      async callLLM({ system, user }) {
        await new Promise((r) => setTimeout(r, 30));
        if (system.includes('资深科研合作者')) {
          // Designer: 返回 2 个 proposals
          return JSON.stringify([
            { type: 'literature_review', title: 'A', rationale: 'A',
              evidence: { paperIds: [] }, target: {}, estimated_effort: 'low', risk: 'low' },
            { type: 'literature_review', title: 'B', rationale: 'B',
              evidence: { paperIds: [] }, target: {}, estimated_effort: 'low', risk: 'low' },
          ]);
        }
        if (user && user.includes('winner (a/b/tie)')) {
          return JSON.stringify({ winner: 'a', reason: 'A better' });
        }
        return JSON.stringify({ score: 9 });
      },
    };

    // maxEmptyRounds 设很大,避免 empty_streak 先触发;让 abort 当唯一停机原因
    const c = new AbortController();
    const p = runRounds(
      { caller: stubCaller, adapter: makeStubAdapter({ dry_run: true }), maxRounds: 8, maxEmptyRounds: 100 },
      {
        sessionId: 'abort-mid',
        input: {
          project: { id: 'abort-mid', name: 'abort-mid', statement: 't' },
          candidates: [], user_goal: 't',
          project_state: { paper_count: 0, draft_count: 0 },
          round: 1,
        },
      },
      c.signal,
    );
    // round 1 会跑很久(每次 LLM 调用 30ms),等 ~50ms 后 abort
    setTimeout(() => c.abort(), 50);
    const result = await p;
    assert.equal(result.stoppedReason, 'cancelled');
    assert.ok(result.records.length >= 1, `expected ≥1 record, got ${result.records.length}`);
    assert.ok(result.records.length < 8, `expected <8 records, got ${result.records.length}`);
  });
});
