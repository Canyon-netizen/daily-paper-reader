/**
 * tests/test_agents_report.mjs — 实验报告 markdown 生成器纯逻辑守护。
 *
 * iter #18:把一个 session 拼成单份 markdown 报告,方便分享/存档。
 * 结构:
 *   # <title or sid>
 *   <notes>
 *
 *   ## 📋 元数据
 *   - sid / 创建 / 最近编辑 / round 数 / applied 数 / 总 token
 *
 *   ## 📊 per-round 表格
 *   | R | proposals | promoted | applied | avg score | avg Elo | tokens |
 *
 *   ## 📈 diff 概览(每轮 vs 上轮 score delta)
 *
 *   ## ⭐ 实际写入 Top N(按 applied 标题聚合)
 *
 *   ## 📝 详细 rounds
 *   ### Round 1
 *   ... gate / applied 列表
 *
 * 跑法:node tests/test_agents_report.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function buildReport(input) {
  const { sid, meta, rounds } = input;
  const title = (meta?.title ?? '').trim() || sid;
  const lines = [];

  lines.push(`# ${title}`);
  lines.push('');
  if (meta?.notes?.trim()) {
    lines.push(meta.notes.trim());
    lines.push('');
  }

  // 元数据
  const createdAt = meta?.createdAt ? new Date(meta.createdAt).toISOString() : '—';
  const updatedAt = meta?.updatedAt ? new Date(meta.updatedAt).toISOString() : '—';
  const totalApplied = rounds.reduce((a, r) => a + (r.modifier?.applied?.length ?? 0), 0);
  const totalTokens = rounds.reduce((a, r) => a + (r.feedback?.total_tokens ?? 0), 0);
  lines.push('## 📋 元数据');
  lines.push('');
  lines.push(`- **sid**: \`${sid}\``);
  lines.push(`- **创建**: ${createdAt}`);
  lines.push(`- **最近编辑**: ${updatedAt}`);
  lines.push(`- **rounds**: ${rounds.length}`);
  lines.push(`- **applied 总数**: ${totalApplied}`);
  lines.push(`- **tokens 估算**: ${totalTokens}`);
  lines.push('');

  // per-round 表
  lines.push('## 📊 per-round 概览');
  lines.push('');
  lines.push('| Round | Proposals | Promoted | Applied | Avg Score | Avg Elo | Tokens |');
  lines.push('|------:|----------:|---------:|--------:|----------:|--------:|-------:|');
  function avgScores(r) {
    const cs = r.feedback?.critiques ?? [];
    if (cs.length === 0) return null;
    return cs.reduce((a, c) => a + c.total, 0) / cs.length;
  }
  function avgElo(r) {
    const cs = r.feedback?.critiques ?? [];
    if (cs.length === 0) return null;
    return cs.reduce((a, c) => a + c.elo, 0) / cs.length;
  }
  for (const r of rounds) {
    const sc = avgScores(r);
    const elo = avgElo(r);
    lines.push([
      `R${r.round}`,
      r.designer?.proposals?.length ?? 0,
      r.gate?.promoted?.length ?? 0,
      r.modifier?.applied?.length ?? 0,
      sc === null ? '—' : sc.toFixed(2),
      elo === null ? '—' : elo.toFixed(0),
      r.feedback?.total_tokens ?? 0,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');

  // diff 概览
  lines.push('## 📈 score delta (vs 上轮)');
  lines.push('');
  const deltas = [];
  for (let i = 0; i < rounds.length; i++) {
    const curr = rounds[i];
    const prev = i > 0 ? rounds[i - 1] : null;
    const cs = avgScores(curr);
    const ps = prev ? avgScores(prev) : null;
    const delta = ps === null || cs === null ? null : cs - ps;
    deltas.push({ round: curr.round, delta });
  }
  const nonNull = deltas.filter((d) => d.delta !== null);
  if (nonNull.length > 0) {
    lines.push('| Round | Δ score |');
    lines.push('|------:|--------:|');
    for (const d of deltas) {
      if (d.delta === null) continue;
      const sign = d.delta > 0 ? '+' : '';
      lines.push(`R${d.round} | ${sign}${d.delta.toFixed(2)} |`);
    }
    lines.push('');
  } else {
    lines.push('_只有一轮,无对比_');
    lines.push('');
  }

  // 实际写入 Top N
  lines.push('## ⭐ 实际写入 (按出现频次)');
  lines.push('');
  const appliedCounts = new Map();
  for (const r of rounds) {
    for (const a of (r.modifier?.applied ?? [])) {
      const title = a.payload?.title
        ?? r.designer?.proposals?.find((p) => p.id === a.proposal_id)?.title
        ?? a.proposal_id;
      appliedCounts.set(title, (appliedCounts.get(title) ?? 0) + 1);
    }
  }
  if (appliedCounts.size > 0) {
    const sorted = [...appliedCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [t, n] of sorted) {
      lines.push(`- (${n}×) ${t}`);
    }
    lines.push('');
  } else {
    lines.push('_本 session 无任何写入_');
    lines.push('');
  }

  // 详细 rounds
  lines.push('## 📝 详细 rounds');
  lines.push('');
  for (const r of rounds) {
    lines.push(`### Round ${r.round}`);
    lines.push('');
    lines.push(`- 时间: ${new Date(r.started_at).toISOString()} → ${new Date(r.finished_at).toISOString()}`);
    lines.push(`- proposals: ${r.designer?.proposals?.length ?? 0}, applied: ${r.modifier?.applied?.length ?? 0}, skipped: ${r.modifier?.skipped?.length ?? 0}`);
    const sc = avgScores(r);
    if (sc !== null) lines.push(`- avg score: ${sc.toFixed(2)}`);
    if (r.gate) {
      const buckets = [
        ['promoted', r.gate.promoted?.length ?? 0],
        ['candidate', r.gate.candidate?.length ?? 0],
        ['sketch', r.gate.sketch?.length ?? 0],
        ['rejected', r.gate.rejected?.length ?? 0],
      ];
      lines.push(`- gate: ${buckets.map(([k, n]) => `${k}=${n}`).join(', ')}`);
    }
    lines.push('');
    if (r.modifier?.applied?.length) {
      lines.push('**Applied**:');
      for (const a of r.modifier.applied) {
        const title = a.payload?.title
          ?? r.designer?.proposals?.find((p) => p.id === a.proposal_id)?.title
          ?? a.proposal_id;
        const kind = a.kind ? ` [${a.kind}]` : '';
        lines.push(`- ${title}${kind}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function mkProposal(id, title) {
  return { id, title };
}

function mkRec(round, opts = {}) {
  const proposals = (opts.proposals ?? []).map((p) =>
    typeof p === 'string' ? mkProposal(p, p) : p,
  );
  const applied = (opts.applied ?? []).map((a) => {
    if (typeof a === 'string') {
      const p = proposals.find((pp) => pp.title === a);
      return { proposal_id: p?.id ?? a, kind: 'create_draft_outline', payload: { title: a } };
    }
    return a;
  });
  const critiques = (opts.critiques ?? []).map((total, i) => ({
    proposal_id: proposals[i]?.id ?? `p${i}`,
    total,
    elo: opts.elo ?? 1200,
  }));
  return {
    round,
    started_at: opts.started_at ?? 1000,
    finished_at: opts.finished_at ?? 2000,
    designer: { proposals },
    feedback: {
      critiques,
      total_tokens: opts.tokens ?? 0,
    },
    gate: {
      promoted: opts.promoted ?? [],
      candidate: [], sketch: [], rejected: [],
    },
    modifier: { applied, skipped: [] },
  };
}

describe('buildReport', () => {
  it('uses sid as title when meta.title is empty', () => {
    const md = buildReport({ sid: 'my-proj', meta: {}, rounds: [] });
    assert.ok(md.startsWith('# my-proj\n'), 'first line should be H1 with sid');
  });
  it('uses meta.title when present', () => {
    const md = buildReport({ sid: 'my-proj', meta: { title: 'ACL review' }, rounds: [] });
    assert.ok(md.startsWith('# ACL review\n'));
  });
  it('renders notes block if present', () => {
    const md = buildReport({ sid: 's', meta: { notes: 'tried aggressive preset' }, rounds: [] });
    assert.ok(md.includes('tried aggressive preset'));
  });
  it('omits notes block if empty', () => {
    const md = buildReport({ sid: 's', meta: {}, rounds: [] });
    assert.ok(!md.includes('tried'));
  });
  it('shows metadata section with all fields', () => {
    const md = buildReport({
      sid: 's',
      meta: { createdAt: 1700000000000, updatedAt: 1700000999000 },
      rounds: [],
    });
    assert.ok(md.includes('## 📋 元数据'));
    assert.ok(md.includes('`s`'));
    assert.ok(md.includes('2023-11-14'));
    assert.ok(md.includes('- **rounds**: 0'));
    assert.ok(md.includes('- **applied 总数**: 0'));
    assert.ok(md.includes('- **tokens 估算**: 0'));
  });
  it('per-round table has all 7 columns', () => {
    const rounds = [
      mkRec(1, { proposals: ['A'], applied: [], critiques: [5], tokens: 2000, promoted: [] }),
      mkRec(2, { proposals: ['B', 'C'], applied: ['B'], critiques: [7], tokens: 3000, promoted: ['B'] }),
    ];
    const md = buildReport({ sid: 's', meta: {}, rounds });
    assert.ok(md.includes('| Round | Proposals | Promoted | Applied | Avg Score | Avg Elo | Tokens |'));
    assert.ok(md.includes('| R1 | 1 | 0 | 0 | 5.00 | 1200 | 2000 |'));
    assert.ok(md.includes('| R2 | 2 | 1 | 1 | 7.00 | 1200 | 3000 |'));
  });
  it('score delta section: only rounds 2+ show delta', () => {
    const rounds = [
      mkRec(1, { critiques: [4] }),
      mkRec(2, { critiques: [6] }),
      mkRec(3, { critiques: [5] }),
    ];
    const md = buildReport({ sid: 's', meta: {}, rounds });
    assert.ok(md.includes('R2 | +2.00'));
    assert.ok(md.includes('R3 | -1.00'));
    // R1 shouldn't appear in delta section — find the section and check
    const deltaStart = md.indexOf('## 📈 score delta');
    const nextSection = md.indexOf('## ⭐', deltaStart);
    const deltaSection = md.slice(deltaStart, nextSection);
    assert.ok(!deltaSection.includes('R1 |'), `R1 leaked into delta: ${deltaSection}`);
  });
  it('score delta says "only one round" when rounds.length===1', () => {
    const md = buildReport({ sid: 's', meta: {}, rounds: [mkRec(1, { critiques: [5] })] });
    assert.ok(md.includes('_只有一轮,无对比_'));
  });
  it('top applied sorts by frequency', () => {
    const rounds = [
      mkRec(1, { applied: ['A', 'B'] }),
      mkRec(2, { applied: ['A', 'B', 'B'] }),
    ];
    const md = buildReport({ sid: 's', meta: {}, rounds });
    const idxA = md.indexOf('(2×) A');
    const idxB = md.indexOf('(3×) B');
    assert.ok(idxA > 0 && idxB > 0);
    assert.ok(idxB < idxA, 'higher count should appear first');
  });
  it('top applied truncated to top 10', () => {
    const rounds = [mkRec(1, {
      applied: Array.from({ length: 15 }, (_, i) => `T${i}`),
    })];
    const md = buildReport({ sid: 's', meta: {}, rounds });
    const match = md.match(/^- \(\d×\) /gm);
    assert.ok(match && match.length <= 10, `expected <=10 entries, got ${match?.length}`);
  });
  it('detailed rounds section lists applied titles', () => {
    const rounds = [
      mkRec(1, { proposals: ['Contrastive loss'], applied: [{ proposal_id: 'p1', kind: 'create_draft_outline', payload: { title: 'Add contrastive loss' } }] }),
    ];
    const md = buildReport({ sid: 's', meta: {}, rounds });
    assert.ok(md.includes('### Round 1'));
    assert.ok(md.includes('- Add contrastive loss [create_draft_outline]'));
  });
  it('handles rounds with no critiques gracefully (— in cells)', () => {
    const rounds = [mkRec(1, { proposals: [], critiques: [] })];
    const md = buildReport({ sid: 's', meta: {}, rounds });
    assert.ok(md.includes('| R1 | 0 | 0 | 0 | — | — | 0 |'));
  });
  it('empty session yields a valid report', () => {
    const md = buildReport({ sid: 'empty', meta: {}, rounds: [] });
    assert.ok(md.length > 0);
    assert.ok(md.includes('# empty'));
    assert.ok(md.includes('- **rounds**: 0'));
    assert.ok(md.includes('_本 session 无任何写入_'));
  });
});
