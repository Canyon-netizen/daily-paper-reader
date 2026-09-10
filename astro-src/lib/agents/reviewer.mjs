/**
 * lib/agents/reviewer.mjs — Paper-Reviewer agent (iter #71).
 *
 * 背景:
 *   现有 feedback.ts 评的是"proposal"(一个研究动作好不好)。
 *   全文写完后,需要另一个维度的反馈:"这篇论文草稿能不能投稿?
 *   审稿人会说什么?major/minor concerns 有哪些?"
 *
 *   iter #71 加 Reviewer agent:对 1 篇 draft md 做 simulated peer review,
 *   输出结构化 ReviewVerdict(major/minor concerns + overall_score +
 *   recommendation ∈ accept | revise | reject)。
 *
 *   跟 Sakana AI Scientist v2 的 Reviewer 阶段对齐:
 *     Sakana: "LLM-as-reviewer" 对生成的 paper 给反馈
 *     DPR   : Reviewer agent(p_simulate_peer_review stage)
 *
 * 设计原则(同 evaluator / paper-compiler / pipeline / web-search):
 *   - 纯函数:无 IO;LLM 通过 caller 注入,失败降级 stub
 *   - 输出字节级稳定:ReviewVerdict JSON schema 固定
 *   - 双 surface 共享:
 *     pipeline.mjs 跑 p_simulate_peer_review stage  ┐
 *     /agents/<sid>/review/ (browser)             ┴─ import reviewer.mjs
 *
 * MVP:3-persona 评审(methodologist / engineer / skeptic — 与 feedback 复用
 * 同一组 persona,保证 DPR 整体视角一致)。
 */

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const REVIEW_PERSONAS = Object.freeze(['methodologist', 'engineer', 'skeptic']);

export const REVIEW_RECOMMENDATIONS = Object.freeze(['accept', 'weak_accept', 'revise', 'weak_reject', 'reject']);

// ---------------------------------------------------------------------------
// 类型契约(纯 JS 注释,JSDoc-style)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ReviewConcern
 * @property {'major' | 'minor'} severity
 * @property {'methodologist' | 'engineer' | 'skeptic'} persona
 * @property {string} category    e.g. 'novelty', 'soundness', 'clarity', 'experiments', 'writing'
 * @property {string} claim       引用 / 定位(draft 的哪一段)
 * @property {string} detail      具体担心 + 改进建议
 */

/**
 * @typedef {Object} ReviewScores
 * @property {number} novelty       0-10
 * @property {number} soundness     0-10
 * @property {number} clarity       0-10
 * @property {number} experiments   0-10
 * @property {number} writing       0-10
 * @property {number} overall       0-10(上述 5 项加权平均)
 */

/**
 * @typedef {Object} ReviewVerdict
 * @property {string} draftId           引用的 draft id(可选)
 * @property {string} recommendation    accept | weak_accept | revise | weak_reject | reject
 * @property {ReviewScores} scores
 * @property {ReviewConcern[]} concerns
 * @property {string} summary           ≤ 300 字总评
 * @property {string} model             用的 LLM model id(debug 用)
 * @property {number} generatedAt       epoch ms
 * @property {boolean} stub             true = LLM 未调用,纯本地生成
 */

// ---------------------------------------------------------------------------
// Prompt 模板
// ---------------------------------------------------------------------------

const REVIEWER_SYSTEM_PROMPT = `你是一位资深科研论文审稿人,负责评估一篇研究论文草稿。

# 任务
按 5 个维度打分(每项 0-10)+ 列出 major/minor concerns + 给 1 个最终 recommendation。

# 5 个评分维度
1. **Novelty**(新颖性):相对已有工作,贡献点是否新?是否避开了"reinventing the wheel"?
2. **Soundness**(方法严谨性):方法 / 实验 / 理论推导是否可证伪?baseline / 消融是否完整?
3. **Clarity**(表达清晰度):图 / 表 / 段落组织是否清楚?符号是否一致?符号表是否齐?
4. **Experiments**(实验完整性):数据集 / 评估指标 / 显著性检验 / 复现信息是否够?
5. **Writing**(写作质量):英文/中文是否流畅?逻辑衔接是否自然?语法错误多不多?

# Recommendation 取值
- accept:      整体 ≥ 8.0,可以直接接受
- weak_accept: 整体 7.0-7.9,小修后接收
- revise:      整体 5.5-6.9,需要补实验 / 改写,大修后再审
- weak_reject: 整体 4.0-5.4,贡献不够 / 方法有硬伤
- reject:      整体 < 4.0,显著低于领域 baseline

# Concerns
每条 concern 包含:
- severity: major(必须修) | minor(建议修)
- persona: methodologist | engineer | skeptic(从哪个视角发现)
- category: novelty | soundness | clarity | experiments | writing
- claim: "<引用草稿片段,10-50 字>"
- detail: "<具体担心 + 改进建议,30-120 字>"

# 输出 JSON,无 markdown fence
{
  "scores": { "novelty": <0-10>, "soundness": <0-10>, "clarity": <0-10>, "experiments": <0-10>, "writing": <0-10> },
  "recommendation": "accept" | "weak_accept" | "revise" | "weak_reject" | "reject",
  "concerns": [
    { "severity": "major|minor", "persona": "<persona>", "category": "<category>", "claim": "<quote>", "detail": "<detail>" }
  ],
  "summary": "<≤ 300 字总评>"
}

# 约束
- 至少 1 条 major concern(revise 推荐时)
- 至少 1 条 minor concern
- summary 必须包含"如果作者只能改 1 件事,改什么"的回答
- 不要讨好;即使文章看起来 OK,也要找至少 1 个真实弱点`;

function buildUserPrompt(draft) {
  const meta = [];
  if (draft.title) meta.push(`标题: ${draft.title}`);
  if (draft.abstract) meta.push(`摘要: ${draft.abstract.slice(0, 800)}`);
  if (draft.arxivIds && draft.arxivIds.length) meta.push(`参考文献 arXiv id: ${draft.arxivIds.join(', ')}`);

  return `## 论文草稿(待审稿)
${meta.join('\n')}

## 正文
${(draft.body || '').slice(0, 6000)}${(draft.body || '').length > 6000 ? '\n\n[... truncated for length; assume remaining sections follow the same quality ...]' : ''}

请输出 JSON 评审结果:`;
}

// ---------------------------------------------------------------------------
// LLM Caller 接口(同 feedback / designer 的 LLMCaller)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LLMCaller
 * @property {(opts: { system: string, user: string, model?: string, temperature?: number, max_tokens?: number }) => Promise<string>} callLLM
 */

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 评审 1 篇论文草稿。
 *
 * @param {{ title?: string, abstract?: string, body: string, arxivIds?: string[] }} draft
 * @param {Object} [opts]
 * @param {LLMCaller} [opts.caller]   不传则走 stub mode
 * @param {string} [opts.draftId]     用于把 verdict 关联回某条 draft 记录
 * @param {string} [opts.model]       LLM model id
 * @returns {Promise<ReviewVerdict>}
 */
export async function reviewDraft(draft, opts = {}) {
  const generatedAt = Date.now();
  const model = opts.model || '(default)';

  if (!opts.caller || typeof opts.caller.callLLM !== 'function') {
    return stubReview(draft, opts.draftId, model, generatedAt);
  }

  let raw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      raw = await opts.caller.callLLM({
        system: REVIEWER_SYSTEM_PROMPT,
        user: buildUserPrompt(draft),
        model,
        temperature: 0.3,
        max_tokens: 2500,
      });
      if (raw && raw.trim()) break;
    } catch (err) {
      if (attempt === 1) {
        console.warn('[reviewer] LLM call failed twice, falling back to stub:', err);
        return stubReview(draft, opts.draftId, model, generatedAt);
      }
    }
  }

  const parsed = parseReviewResponse(raw);
  if (!parsed) {
    console.warn('[reviewer] parseReviewResponse failed, falling back to stub');
    return stubReview(draft, opts.draftId, model, generatedAt);
  }
  return finalizeVerdict(parsed, opts.draftId, model, generatedAt, /* stub */ false);
}

// ---------------------------------------------------------------------------
// JSON 解析(健壮版,与 designer/feedback 一致)
// ---------------------------------------------------------------------------

function parseReviewResponse(raw) {
  if (typeof raw !== 'string') return null;
  let parsed = null;
  // 1. 直接 parse
  try { parsed = JSON.parse(raw); } catch { /* */ }
  // 2. 剥 markdown fence
  if (!parsed) {
    const m = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (m) { try { parsed = JSON.parse(m[1]); } catch { /* */ } }
  }
  // 3. 找第一个 { 到匹配 }
  if (!parsed) {
    const i = raw.indexOf('{');
    if (i >= 0) {
      let depth = 0, j = i;
      for (; j < raw.length; j++) {
        if (raw[j] === '{') depth++;
        else if (raw[j] === '}') { depth--; if (depth === 0) break; }
      }
      if (depth === 0) {
        try { parsed = JSON.parse(raw.slice(i, j + 1)); } catch { /* */ }
      }
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed;
}

function finalizeVerdict(parsed, draftId, model, generatedAt, stub) {
  const obj = /** @type {Record<string, any>} */ (parsed);
  const scores = normalizeScores(obj.scores);
  const concerns = normalizeConcerns(obj.concerns);
  const recommendation = normalizeRecommendation(obj.recommendation, scores.overall);
  const summary = String(obj.summary || '').slice(0, 600);

  return {
    draftId: draftId || null,
    recommendation,
    scores,
    concerns,
    summary,
    model,
    generatedAt,
    stub: !!stub,
  };
}

function normalizeScores(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  const clamp = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 5;
    return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
  };
  const novelty     = clamp(r.novelty);
  const soundness   = clamp(r.soundness);
  const clarity     = clamp(r.clarity);
  const experiments = clamp(r.experiments);
  const writing     = clamp(r.writing);
  const overall     = Math.round(((novelty + soundness + clarity + experiments + writing) / 5) * 10) / 10;
  return { novelty, soundness, clarity, experiments, writing, overall };
}

function normalizeConcerns(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const c of raw.slice(0, 12)) {
    if (!c || typeof c !== 'object') continue;
    const severity = c.severity === 'major' || c.severity === 'minor' ? c.severity : 'minor';
    const persona = REVIEW_PERSONAS.includes(c.persona) ? c.persona : 'methodologist';
    const category = ['novelty', 'soundness', 'clarity', 'experiments', 'writing'].includes(c.category)
      ? c.category : 'clarity';
    const claim = String(c.claim || '').slice(0, 200);
    const detail = String(c.detail || '').slice(0, 500);
    if (!detail) continue;
    out.push({ severity, persona, category, claim, detail });
  }
  // 至少 1 major + 1 minor
  const hasMajor = out.some((c) => c.severity === 'major');
  const hasMinor = out.some((c) => c.severity === 'minor');
  if (!hasMajor && out.length > 0) {
    out[0].severity = 'major';
  } else if (!hasMajor && out.length === 0) {
    out.push({
      severity: 'major', persona: 'methodologist',
      category: 'soundness', claim: '(no quote)', detail: '审稿未给出 major concern;placeholder.',
    });
  }
  if (!hasMinor) {
    out.push({
      severity: 'minor', persona: 'engineer',
      category: 'clarity', claim: '(no quote)', detail: '建议补充符号表与数据集版本号。',
    });
  }
  return out;
}

function normalizeRecommendation(raw, overall) {
  if (REVIEW_RECOMMENDATIONS.includes(raw)) return raw;
  // fallback:根据 overall 推
  if (overall >= 8.0) return 'accept';
  if (overall >= 7.0) return 'weak_accept';
  if (overall >= 5.5) return 'revise';
  if (overall >= 4.0) return 'weak_reject';
  return 'reject';
}

// ---------------------------------------------------------------------------
// Stub Review — 无 LLM 时的占位(让 pipeline dry-run 跑通)
// ---------------------------------------------------------------------------

function stubReview(draft, draftId, model, generatedAt) {
  const bodyLen = (draft.body || '').length;
  const arxivCount = Array.isArray(draft.arxivIds) ? draft.arxivIds.length : 0;
  // 给一个"刚好到 revise 阈值"的分数,dry-run 时让 pipeline 推进
  const novelty = 6.5;
  const soundness = 6.0;
  const clarity = 7.0;
  const experiments = bodyLen > 1000 ? 6.5 : 5.5;
  const writing = 6.5;
  const overall = Math.round(((novelty + soundness + clarity + experiments + writing) / 5) * 10) / 10;

  return {
    draftId: draftId || null,
    recommendation: 'revise',
    scores: { novelty, soundness, clarity, experiments, writing, overall },
    concerns: [
      {
        severity: 'major', persona: 'methodologist',
        category: 'soundness',
        claim: '方法章节对 baseline 的假设过强,未讨论公平比较的边界条件。',
        detail: '【dry-run】 建议在 §3.2 补充 1 段对 baseline 适用边界的讨论,引用至少 2 篇相关工作。',
      },
      {
        severity: 'major', persona: 'skeptic',
        category: 'novelty',
        claim: `仅 ${arxivCount} 篇 arxiv ref 支撑贡献点,与现有 survey 重叠度未量化。`,
        detail: '【dry-run】 建议加 1 个 "novelty vs related work" 表,明确点对点对比的差异。',
      },
      {
        severity: 'minor', persona: 'engineer',
        category: 'experiments',
        claim: '实验部分未给出复现用的随机种子与硬件配置。',
        detail: '【dry-run】 在 §4.1 末尾补 1 段 reproducibility appendix(seed / commit / GPU)。',
      },
      {
        severity: 'minor', persona: 'methodologist',
        category: 'clarity',
        claim: '符号表缺失,变量 r 与 R 含义需读者推断。',
        detail: '【dry-run】 在 §1 末尾加 Notation 表;r / R / N / L 等 8 个符号。',
      },
    ],
    summary: '【dry-run】 草稿覆盖方法 / 实验 / 写作基本完整;主要弱点是 baseline 比较的公平性讨论与 novelty-vs-related-work 表。建议大修后重投。',
    model: model + ' (stub)',
    generatedAt,
    stub: true,
  };
}

// ---------------------------------------------------------------------------
// formatReviewText(verdict) — CLI / UI 友好的 markdown 文本
// ---------------------------------------------------------------------------

export function formatReviewText(verdict) {
  if (!verdict) return '(empty review)';
  const lines = [];
  lines.push(`# Paper Review`);
  lines.push('');
  lines.push(`- **Recommendation**: ${verdict.recommendation}`);
  lines.push(`- **Overall**: ${verdict.scores.overall} / 10`);
  lines.push(`- **Scores**: novelty=${verdict.scores.novelty} soundness=${verdict.scores.soundness} clarity=${verdict.scores.clarity} experiments=${verdict.scores.experiments} writing=${verdict.scores.writing}`);
  if (verdict.stub) lines.push(`- **Mode**: stub (no LLM call)`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push(verdict.summary || '(none)');
  lines.push('');
  lines.push(`## Concerns (${verdict.concerns.length})`);
  for (const c of verdict.concerns) {
    lines.push(`### [${c.severity.toUpperCase()}] ${c.category} (${c.persona})`);
    if (c.claim) lines.push(`> ${c.claim}`);
    lines.push(c.detail);
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// toJSON(verdict) — 序列化(供 --json CLI / 浏览器 fetch)
// ---------------------------------------------------------------------------

export function toJSON(verdict) {
  if (!verdict) return null;
  return {
    draftId: verdict.draftId,
    recommendation: verdict.recommendation,
    scores: verdict.scores,
    concerns: verdict.concerns,
    summary: verdict.summary,
    model: verdict.model,
    generatedAt: verdict.generatedAt,
    stub: !!verdict.stub,
  };
}
