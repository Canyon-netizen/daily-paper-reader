// /lib/idea-lifecycle.mjs — Idea 状态机 + promotion 决策逻辑的 **JavaScript 镜像**。
//
// 重要:这是 astro-src/lib/idea-lifecycle.ts 的 1:1 镜像,
//      目的是让 Node CLI runner (scripts/topic-v2-run.mjs) 在不带 TS 工具链
//      的纯 Node 环境下也能复用同一份晋升逻辑,避免 "两个状态机"。
//
// 单一真相源:idea-lifecycle.ts(浏览器侧,带类型)
//   ↕  行为必须一致
// 镜像文件:idea-lifecycle.mjs(Node CLI 直接 import)
//
// 改任意一个,务必同步另一个。

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const IDEA_DEPTH_ORDER = {
  sketch: 0,
  candidate: 1,
  under_review: 2,
  promoted: 3,
};

export const GATE_THRESHOLDS = {
  sketchToCandidate: {
    minElo: 1232,
    minWins: 1,
  },
  candidateToUnderReview: {
    minElo: 1250,
    minMatches: 2,
    minWins: 1,
  },
  underReviewToPromoted: {
    minElo: 1280,
    minMatches: 3,
    minWins: 2,
    requiresNonLimitationSignal: true,
  },
};

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function parseDepth(idea) {
  const d = idea.depth;
  if (d === 'candidate' || d === 'under_review' || d === 'promoted') {
    return d;
  }
  return 'sketch';
}

function hasNonLimitationSignal(idea) {
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
 * @param {{id: string, depth?: string, elo_rating?: number, matches?: number, wins?: number, signals?: string[]}} idea
 * @returns {{id: string, from: string, to: string, reason: string} | null}
 */
export function evaluatePromotion(idea) {
  const depth = parseDepth(idea);
  const elo = idea.elo_rating ?? 1200;
  const matches = idea.matches ?? 0;
  const wins = idea.wins ?? 0;

  if (depth === 'promoted') {
    return null;
  }

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

  if (depth === 'under_review') {
    const { minElo, minMatches, minWins, requiresNonLimitationSignal } =
      GATE_THRESHOLDS.underReviewToPromoted;

    if (requiresNonLimitationSignal && !hasNonLimitationSignal(idea)) {
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

  return null;
}

/**
 * 应用晋升决策,返回新 idea 对象。
 * @param {Object} idea
 * @param {{id: string, from: string, to: string, reason: string}} decision
 * @returns {Object}
 */
export function applyPromotion(idea, decision) {
  return {
    ...idea,
    depth: decision.to,
    promoted_at: new Date().toISOString(),
  };
}
