// astro-src/lib/agents/feedback.ts
//
// R7 F.1.4: designer user feedback loop。
//
// 用户对每条 proposal 可以点 👍 / 👎 / 跳过 → 写一条 feedback 记录。
// 这些记录汇总成「历史采纳率」,喂给 confidence.ts (F.1.3) 和 few-shot.ts (F.1.2)。
//
// 设计:
//   - 记录存 localStorage(`dpr_proposal_feedback_v1`),schema 简单:数组
//     每条 { proposalId, projectId, type, vote: 'up' | 'down' | 'skip',
//            createdAt, comment? }
//   - 提供纯函数 helpers:recordFeedback / getFeedback / adoptionRateByType
//   - 提供 module-level SSR-safe wrapper:仅在 window/localStorage 存在时落盘
//
// F.1.4 不直接修改 Proposal,只是在它旁边再开一个 store。整合由调用方负责。

import type { ProposalType } from './types';

/** 一条用户反馈。 */
export interface ProposalFeedback {
  /** proposal.id */
  proposalId: string;
  /** proposal.target.projectId(可选;如果是 project 内反馈,记录它) */
  projectId?: string;
  /** proposal.type —— 冗余存,统计时不用 join */
  type: ProposalType;
  /** up = 采纳/喜欢,down = 拒绝/不喜欢,skip = 没看/略过 */
  vote: 'up' | 'down' | 'skip';
  /** epoch ms */
  createdAt: number;
  /** 可选评论,UI 里用户填的简短说明 */
  comment?: string;
}

/** localStorage key —— 故意不带 schema version 号,数据简单,直接覆盖即可。 */
export const PROPOSAL_FEEDBACK_KEY = 'dpr_proposal_feedback_v1';

/**
 * 记录一条 feedback。如果 proposalId 已存在,vote 会被覆盖(取最新一条)
 * 而不是新增 —— 这样 UI 重复点不会产生重复记录。
 */
export function recordFeedback(
  fb: ProposalFeedback,
  existing: readonly ProposalFeedback[] = [],
): ProposalFeedback[] {
  const filtered = existing.filter((f) => f.proposalId !== fb.proposalId);
  filtered.push(fb);
  return filtered;
}

/** 拿一个 proposal 的最新 feedback(没有则 null)。 */
export function getFeedbackFor(
  proposalId: string,
  feedback: readonly ProposalFeedback[],
): ProposalFeedback | null {
  let latest: ProposalFeedback | null = null;
  for (const f of feedback) {
    if (f.proposalId !== proposalId) continue;
    if (!latest || f.createdAt > latest.createdAt) latest = f;
  }
  return latest;
}

/**
 * 把一组 feedback 汇总成 { [type]: adoption_rate }。
 *   adoption_rate = up_count / (up_count + down_count)
 * skip 不计入分母(只是「没看」,不算采纳也不算拒绝)。
 *
 * type 没有 up/down 时返回 undefined(让 confidence.ts 用 0.5 兜底)。
 */
export function adoptionRateByType(
  feedback: readonly ProposalFeedback[],
): Partial<Record<ProposalType, number>> {
  const stats: Record<ProposalType, { up: number; down: number }> = {} as Record<ProposalType, { up: number; down: number }>;
  for (const f of feedback) {
    if (!stats[f.type]) stats[f.type] = { up: 0, down: 0 };
    if (f.vote === 'up') stats[f.type].up++;
    else if (f.vote === 'down') stats[f.type].down++;
  }
  const out: Partial<Record<ProposalType, number>> = {};
  for (const [type, s] of Object.entries(stats)) {
    const total = s.up + s.down;
    if (total === 0) continue;
    out[type as ProposalType] = s.up / total;
  }
  return out;
}

/**
 * 拿一个 proposalId → vote 的 map,供 few-shot.ts 直接查 score。
 *   vote='up'   → 0.9
 *   vote='down' → 0.1
 *   vote='skip' / 缺失 → 0.5(中性兜底)
 */
export function feedbackScoreByProposalId(
  feedback: readonly ProposalFeedback[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of feedback) {
    const score = f.vote === 'up' ? 0.9 : f.vote === 'down' ? 0.1 : 0.5;
    // 后写覆盖前写(取最新一次 vote)
    out[f.proposalId] = score;
  }
  return out;
}

/**
 * 按 proposalId 分组,计算每条 proposal 收到的票数(用于 UI 批量展示)。
 * 返回 { [proposalId]: { up, down, skip } }
 */
export function tallyVotesByProposalId(
  feedback: readonly ProposalFeedback[],
): Record<string, { up: number; down: number; skip: number }> {
  const out: Record<string, { up: number; down: number; skip: number }> = {};
  for (const f of feedback) {
    if (!out[f.proposalId]) out[f.proposalId] = { up: 0, down: 0, skip: 0 };
    if (f.vote === 'up') out[f.proposalId].up++;
    else if (f.vote === 'down') out[f.proposalId].down++;
    else if (f.vote === 'skip') out[f.proposalId].skip++;
  }
  return out;
}

/**
 * 拿到一组 feedback 的总览统计(给 UI dashboard 用)。
 */
export interface FeedbackSummary {
  total: number;
  up: number;
  down: number;
  skip: number;
  /** up / (up + down),0..1;无投票 → undefined */
  approvalRate?: number;
}

export function summarizeFeedback(feedback: readonly ProposalFeedback[]): FeedbackSummary {
  const summary: FeedbackSummary = { total: feedback.length, up: 0, down: 0, skip: 0 };
  for (const f of feedback) {
    if (f.vote === 'up') summary.up++;
    else if (f.vote === 'down') summary.down++;
    else if (f.vote === 'skip') summary.skip++;
  }
  const totalDecisions = summary.up + summary.down;
  if (totalDecisions > 0) {
    summary.approvalRate = summary.up / totalDecisions;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// localStorage 读写 helper —— 仅在浏览器环境调用;SSR / Node 下 no-op。
// ---------------------------------------------------------------------------

export function loadFeedbackFromStorage(): ProposalFeedback[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PROPOSAL_FEEDBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidFeedback);
  } catch {
    return [];
  }
}

export function saveFeedbackToStorage(feedback: readonly ProposalFeedback[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PROPOSAL_FEEDBACK_KEY, JSON.stringify(feedback));
  } catch {
    /* localStorage 不可用,忽略 */
  }
}

function isValidFeedback(x: unknown): x is ProposalFeedback {
  if (!x || typeof x !== 'object') return false;
  const f = x as Record<string, unknown>;
  return typeof f.proposalId === 'string'
    && typeof f.type === 'string'
    && (f.vote === 'up' || f.vote === 'down' || f.vote === 'skip')
    && typeof f.createdAt === 'number';
}