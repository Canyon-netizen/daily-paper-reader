/**
 * idea-lifecycle.ts — Idea 状态机 + promotion 决策逻辑。
 *
 * 背景:
 *   - 这是 "自动化实验思路发掘" 的状态机实现:每个 idea 在 Elo 辩论中
 *     积累 elo_rating / matches / wins,满足阈值后从 sketch → candidate →
 *     under_review → promoted 逐级晋升。
 *   - 与 elo-debate.ts 配合:跑完 debate stage 后评估是否满足晋升条件,
 *     满足则更新 depth 并记录 promoted_at 时间戳。
 *   - Node CLI runner (scripts/topic-v2-run.mjs) import 本文件的 JS 镜像,
 *     确保浏览器与 Node 使用同一份晋升逻辑。
 *
 * 设计原则:
 *   - **零外部依赖**:纯函数,无副作用,可测试。
 *   - **阈值保守**:false negatives(漏晋升)可恢复(false positives(错晋升)不可逆)。
 *   - **单步晋升**:一次只升一级,防止跳级。
 *
 * 阈值设计(基于 Elo K=32 / 4 轮 / 8-idea Swiss):
 *   - sketch → candidate: elo >= 1232 (约等于对等对手 1 胜),
 *     wins >= 1 (至少赢过一场)
 *   - candidate → under_review: elo >= 1250, matches >= 2, wins >= 1
 *     (需要多场检验,不能靠运气一场论)
 *   - under_review → promoted: elo >= 1280, matches >= 3, wins >= 2,
 *     signals 不含 "limitations" (纯 limitations 信号太 speculative,
 *     需要至少一个正面信号如 novelty/feasibility/gap 才能晋升顶级)
 *
 *   保守理由:
 *     - Elo 波动大,一场胜负可能带来 ±16 Elo
 *     - 顶级 idea (promoted) 代表高置信度可执行方案,错误晋升代价高
 *     - 漏晋升 → 下轮辩论继续,可恢复;错晋升 → 误导后续研究
 */

import type { DebateIdea } from './types/topic';

// ---------------------------------------------------------------------------
// 公开类型
// ---------------------------------------------------------------------------

export type IdeaDepth = 'sketch' | 'candidate' | 'under_review' | 'promoted';

/**
 * Idea 深度的数值顺序,用于防止降级回归。
 * 只允许同层或向更高层晋升,不允许从 promoted 退回 under_review 等。
 */
export const IDEA_DEPTH_ORDER: Record<IdeaDepth, number> = {
  sketch: 0,
  candidate: 1,
  under_review: 2,
  promoted: 3,
};

/**
 * 晋升 gate 阈值配置。
 * 每层升级的最低要求,保守设置以避免 false positives。
 *
 * 阈值设计原理:
 *   - K=32 意味对等对手(~1200)一场胜约 +16 Elo
 *   - 4 轮 Swiss 最多 4 场比赛,好 idea 应在 1232-1264 区间
 *   - promoted 需要最强信号:高 Elo + 多场验证 + 胜率高 + 正面信号
 */
export const GATE_THRESHOLDS = {
  sketchToCandidate: {
    /** 约等于对等对手 2 胜的 Elo,对弱对手 1 胜也可触发 */
    minElo: 1232,
    /** 至少赢过一场,不能靠运气一场论 */
    minWins: 1,
  },
  candidateToUnderReview: {
    /** 需要一定竞争力 */
    minElo: 1250,
    /** 至少参与 2 场,不能一场论 */
    minMatches: 2,
    /** 多场中至少赢 1 场 */
    minWins: 1,
  },
  underReviewToPromoted: {
    /** 高 Elo 才能进 top tier */
    minElo: 1280,
    /** 至少 3 场辩论,验证稳定性 */
    minMatches: 3,
    /** 胜率 66%+ ,必须有竞争力 */
    minWins: 2,
    /** 不能只有 limitations 信号,太 speculative */
    requiresNonLimitationSignal: true,
  },
} as const;

/** 晋升决策结果。 */
export interface PromotionDecision {
  /** Idea ID。 */
  id: string;
  /** 晋升前深度。 */
  from: IdeaDepth;
  /** 晋升后深度。 */
  to: IdeaDepth;
  /** 决策原因,用于 digest 记录。 */
  reason: string;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 解析 idea.depth 字段,默认 sketch。
 * 确保向后兼容:旧 JSON 无 depth 字段视为 sketch。
 */
function parseDepth(idea: DebateIdea): IdeaDepth {
  const d = idea.depth;
  if (d === 'candidate' || d === 'under_review' || d === 'promoted') {
    return d;
  }
  return 'sketch';
}

/**
 * 检查 idea 是否满足非 limitations 信号要求。
 * 只有当 signals 数组包含非 "limitations" 的元素时才返回 true。
 * 如果 signals 为空或仅含 "limitations",返回 false。
 */
function hasNonLimitationSignal(idea: DebateIdea): boolean {
  const signals = idea.signals;
  if (!signals || !Array.isArray(signals) || signals.length === 0) {
    return false;
  }
  return signals.some((s) => s !== 'limitations');
}

// ---------------------------------------------------------------------------
// 核心逻辑
// ---------------------------------------------------------------------------

/**
 * 评估单个 idea 是否满足晋升条件。
 *   - 只检查下一级,不跨级
 *   - 返回 PromotionDecision 或 null(已到顶或不满条件)
 *
 * 决策顺序:
 *   1. sketch → candidate: 满足 minElo + minWins?
 *   2. candidate → under_review: 满足 minElo + minMatches + minWins?
 *   3. under_review → promoted: 满足 minElo + minMatches + minWins + 非 limitations?
 *
 * @param idea 辩论后的 idea(已更新 elo_rating / matches / wins)
 * @returns 晋升决策或 null
 */
export function evaluatePromotion(idea: DebateIdea): PromotionDecision | null {
  const depth = parseDepth(idea);
  const elo = idea.elo_rating ?? 1200;
  const matches = idea.matches ?? 0;
  const wins = idea.wins ?? 0;

  // 已到顶级,不再晋升
  if (depth === 'promoted') {
    return null;
  }

  // sketch → candidate
  if (depth === 'sketch') {
    const { minElo, minWins } = GATE_THRESHOLDS.sketchToCandidate;
    if (elo >= minElo && wins >= minWins) {
      return {
        id: idea.id,
        from: 'sketch',
        to: 'candidate',
        reason: `elo ${elo} >= ${minElo}, wins ${wins} >= ${minWins}`,
      };
    }
    return null;
  }

  // candidate → under_review
  if (depth === 'candidate') {
    const { minElo, minMatches, minWins } = GATE_THRESHOLDS.candidateToUnderReview;
    if (elo >= minElo && matches >= minMatches && wins >= minWins) {
      return {
        id: idea.id,
        from: 'candidate',
        to: 'under_review',
        reason: `elo ${elo} >= ${minElo}, matches ${matches} >= ${minMatches}, wins ${wins} >= ${minWins}`,
      };
    }
    return null;
  }

  // under_review → promoted
  if (depth === 'under_review') {
    const { minElo, minMatches, minWins, requiresNonLimitationSignal } =
      GATE_THRESHOLDS.underReviewToPromoted;

    if (requiresNonLimitationSignal && !hasNonLimitationSignal(idea)) {
      // 有 limitations 信号但不满足非 limitations 要求,不晋升
      return null;
    }

    if (elo >= minElo && matches >= minMatches && wins >= minWins) {
      const signalInfo = requiresNonLimitationSignal
        ? `, signals=${JSON.stringify(idea.signals || [])}`
        : '';
      return {
        id: idea.id,
        from: 'under_review',
        to: 'promoted',
        reason: `elo ${elo} >= ${minElo}, matches ${matches} >= ${minMatches}, wins ${wins} >= ${minWins}${signalInfo}`,
      };
    }
    return null;
  }

  // 兜底:未知 depth 视为不可晋升
  return null;
}

/**
 * 应用晋升决策,返回新 idea 对象。
 * 不修改原输入,只返回带新 depth 和 promoted_at 的拷贝。
 *
 * @param idea 原始 idea
 * @param decision 晋升决策
 * @returns 新 idea 对象
 */
export function applyPromotion(idea: DebateIdea, decision: PromotionDecision): DebateIdea {
  return {
    ...idea,
    depth: decision.to,
    promoted_at: new Date().toISOString(),
  };
}
