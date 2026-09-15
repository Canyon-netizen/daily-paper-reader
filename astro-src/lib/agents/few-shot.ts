// astro-src/lib/agents/few-shot.ts
//
// R7 F.1.2: designer few-shot from history.
//
// 从历史 proposals 数组里挑出 K 条「示范性」样本,作为 LLM prompt 的
// few-shot 例子。挑选策略:
//
//   1. 同 projectId 优先(同一个 project 的 proposal 上下文最相关)
//   2. 同 type 次之(同动作类型的 rationale 结构最相近)
//   3. 评分/采纳率高的优先(由 user feedback loop F.1.4 写入的
//      `feedbackScore` 字段,0-1;高分 = 用户更喜欢)
//   4. 最近的优先(同分时 created_at 大的优先)
//
// 设计成纯函数 + 不依赖 LLM;调用方拿到结果后拼到 prompt。
//
// 关键约束:
//   - 输出顺序稳定:同输入 → 同输出(避免 LLM 抖动用 retry 时的随机性)
//   - 上限 K(默认 3),多了反而稀释信号

import type { Proposal, ProposalType } from './types';

/** few-shot 用的最小投影 —— 把整条 proposal 压成 prompt 里能直接引用的形式。 */
export interface FewShotExample {
  type: ProposalType;
  title: string;
  rationale: string;
  estimated_effort: 'low' | 'medium' | 'high';
  risk: string;
  /** 用来排序的分数,0-1。LMM / user feedback 高分高排。 */
  score: number;
  /** 调试用:来源 proposal 的 id */
  sourceId: string;
}

/**
 * 输入:
 *   - history:     全部历史 proposals(不限于本 round / 本 project)
 *   - options:     { projectId?, type?, k=3, minScore=0 }
 *
 * 输出:长度 ≤ k 的数组,顺序 = 优先级。
 */
export function selectFewShotExamples(
  history: readonly Proposal[],
  opts: {
    projectId?: string;
    type?: ProposalType;
    k?: number;
    minScore?: number;
    feedbackScoreByProposalId?: Record<string, number>;
  } = {},
): FewShotExample[] {
  const k = opts.k ?? 3;
  const minScore = opts.minScore ?? 0;
  if (history.length === 0 || k <= 0) return [];

  const feedbackScore = opts.feedbackScoreByProposalId ?? {};
  const candidates: { example: FewShotExample; score: number }[] = [];

  for (const p of history) {
    const fbScore = typeof feedbackScore[p.id] === 'number' ? feedbackScore[p.id] : 0.5;
    if (fbScore < minScore) continue;
    const example: FewShotExample = {
      type: p.type,
      title: p.title,
      rationale: p.rationale,
      estimated_effort: p.estimated_effort,
      risk: p.risk,
      score: fbScore,
      sourceId: p.id,
    };
    // 加权打分:同 project +3、同 type +2、feedback 越高越好
    let score = fbScore * 10;
    if (opts.projectId && p.target?.projectId === opts.projectId) score += 3;
    if (opts.type && p.type === opts.type) score += 2;
    candidates.push({ example, score });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // tie-breaker:created_at 大的优先(更新)
    const aP = history.find((h) => h.id === a.example.sourceId);
    const bP = history.find((h) => h.id === b.example.sourceId);
    return (bP?.created_at ?? 0) - (aP?.created_at ?? 0);
  });

  return candidates.slice(0, k).map((c) => c.example);
}

/** 把 few-shot 数组渲染成 LLM prompt 的示例块。 */
export function renderFewShotBlock(examples: readonly FewShotExample[]): string {
  if (examples.length === 0) return '';
  const lines: string[] = ['# 示例(按优先级排序)', ''];
  for (const [i, ex] of examples.entries()) {
    lines.push(`## Example ${i + 1}`);
    lines.push(`\`\`\`json`);
    lines.push(JSON.stringify({
      type: ex.type,
      title: ex.title,
      rationale: ex.rationale,
      estimated_effort: ex.estimated_effort,
      risk: ex.risk,
    }, null, 2));
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}