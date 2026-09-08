/**
 * agents/designer.ts — Designer agent: propose next research action.
 *
 * 输入:Project 上下文 + 当前 ideas/experiments/writings/roadmap 状态
 * 输出:Proposal[] (3-8 条候选)
 *
 * 设计原则:
 *   - **聚焦下一步**:不是发明全新研究,是基于已有素材提议"该填哪里"。
 *   - **类型驱动**:output.type ∈ {add_paper, create_draft, experiment_plan,
 *     literature_review, rebuttal},对应上游模块的具体调用。
 *   - **可重入**:同样 input 给两次应该倾向相似 output(LLM 抖动用 retry 兜)。
 *   - **stub 模式**:无 LLM key 时返回占位 proposals,让 CLI /dry-run 跑通全链路。
 */

import type { Proposal, ProposalType, RoundInput } from './types';
import { makeEmptyProposal } from './types';

// ---------------------------------------------------------------------------
// Prompt 模板(中文,与上游 topic-search 的中文 prompt 风格一致)
// ---------------------------------------------------------------------------

const DESIGNER_SYSTEM_PROMPT = `你是一位资深科研合作者,正在帮用户推进研究项目。

# 任务
根据用户的 Project 当前状态 + 候选论文 + 用户目标,提出 3-8 个**下一步可执行**的研究动作。

# 动作类型
- add_paper: 把一篇论文加到 project 的某个阶段
- create_draft: 为 project 创建一个写作草稿(综述/章节/博客)
- experiment_plan: 基于已有 idea 创建结构化实验方案
- literature_review: 把一组论文组织成 literature review 写作
- rebuttal: 针对某个 idea 的弱点写反驳段落

# 输出 JSON 数组,每条:
{
  "type": "add_paper" | "create_draft" | "experiment_plan" | "literature_review" | "rebuttal",
  "title": "一句话标题(中文,< 64 字)",
  "rationale": "1-2 句为什么做这个",
  "evidence": { "paperIds": ["arxivId1", ...], "quotes": ["关键引用"] },
  "target": {
    "projectId": "默认 = 输入 project.id",
    "stageId": "add_paper 目标阶段(可选)",
    "arxivIds": ["add_paper 待加论文"],
    "draftTitle": "create_draft 的标题"
  },
  "estimated_effort": "low" | "medium" | "high",
  "risk": "1 句主要风险"
}

# 约束
- 每条 proposal 必须有 1+ paperIds 支撑(或明确说明为什么不需要)
- 不要提"再读 5 篇论文"这种没产出的动作
- 优先利用已有 ideas/experiments/writings 的素材
- 输出必须是合法 JSON 数组,不要 markdown fence`;

function buildUserPrompt(input: RoundInput): string {
  const { project, candidates, user_goal, project_state } = input;
  const lines: string[] = [];

  lines.push(`## Project\n- id: ${project.id}\n- name: ${project.name}\n- statement: ${project.statement ?? '(none)'}`);
  if (project_state) {
    lines.push(`- 当前阶段数: ${project_state.paper_count} 篇论文, ${project_state.draft_count} 个草稿`);
  }

  if (candidates && candidates.length) {
    lines.push(`\n## 候选论文(${candidates.length})`);
    for (const c of candidates.slice(0, 30)) {
      lines.push(`- ${c.arxivId}: ${c.title}${c.tldr ? ' — ' + c.tldr : ''}`);
    }
  }

  if (user_goal) lines.push(`\n## 用户目标\n${user_goal}`);

  lines.push(`\n请输出 3-8 条 proposals:`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// LLM 调用(沿用 paper-analyzer.ts 的 callLLM 模式)
// ---------------------------------------------------------------------------

export interface LLMCaller {
  callLLM(opts: {
    system: string;
    user: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
  }): Promise<string>;
}

/**
 * 真 LLM 调用的 Designer。
 * 失败重试 1 次;若仍失败,降级到 stub(返回 1 条占位 proposal)。
 */
export async function designerGenerate(
  input: RoundInput,
  caller: LLMCaller,
  opts: { model?: string; maxProposals?: number } = {},
): Promise<Proposal[]> {
  const maxProposals = opts.maxProposals ?? 6;
  const user = buildUserPrompt(input);
  const system = DESIGNER_SYSTEM_PROMPT;

  let raw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      raw = await caller.callLLM({
        system,
        user,
        model: opts.model,
        temperature: 0.7,
        max_tokens: 2048,
      });
      if (raw && raw.trim()) break;
    } catch (err) {
      if (attempt === 1) {
        console.warn('[designer] LLM call failed twice:', err);
        return stubProposals(input, maxProposals);
      }
    }
  }

  const proposals = parseProposals(raw, input.round);
  if (proposals.length === 0) {
    console.warn('[designer] parseProposals returned 0; falling back to stub');
    return stubProposals(input, maxProposals);
  }
  return proposals.slice(0, maxProposals);
}

// ---------------------------------------------------------------------------
// JSON 解析(健壮版,沿用 method-debate 的 4 策略)
// ---------------------------------------------------------------------------

function parseProposals(raw: string, round: number): Proposal[] {
  // 1. 直接 parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 2. 剥 markdown fence
    const m = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (m) {
      try { parsed = JSON.parse(m[1]); } catch { /* fall through */ }
    }
  }
  // 3. 找第一个 [ 到匹配的 ]
  if (!parsed) {
    const i = raw.indexOf('[');
    if (i >= 0) {
      let depth = 0, j = i;
      for (; j < raw.length; j++) {
        if (raw[j] === '[') depth++;
        else if (raw[j] === ']') { depth--; if (depth === 0) break; }
      }
      if (depth === 0) {
        try { parsed = JSON.parse(raw.slice(i, j + 1)); } catch { /* */ }
      }
    }
  }
  // 4. 单 object 包成 array
  if (!parsed && raw.trim().startsWith('{')) {
    try { parsed = [JSON.parse(raw)]; } catch { /* */ }
  }

  if (!Array.isArray(parsed)) return [];
  const now = Date.now();
  return parsed
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x, idx) => normalizeProposal(x, round, now, idx));
}

function normalizeProposal(
  raw: Record<string, unknown>,
  round: number,
  now: number,
  idx: number,
): Proposal {
  const base = makeEmptyProposal(round);
  base.id = `p_${round}_${idx}_${Math.random().toString(36).slice(2, 8)}`;
  base.type = (['add_paper', 'create_draft', 'experiment_plan', 'literature_review', 'rebuttal'] as ProposalType[])
    .includes(raw.type as ProposalType) ? (raw.type as ProposalType) : 'add_paper';
  base.title = String(raw.title ?? '(untitled)').slice(0, 120);
  base.rationale = String(raw.rationale ?? '').slice(0, 500);
  base.estimated_effort = (['low', 'medium', 'high'] as const)
    .includes(raw.estimated_effort as 'low' | 'medium' | 'high')
      ? (raw.estimated_effort as 'low' | 'medium' | 'high') : 'medium';
  base.risk = String(raw.risk ?? '').slice(0, 200);

  if (raw.evidence && typeof raw.evidence === 'object') {
    const e = raw.evidence as Record<string, unknown>;
    base.evidence.paperIds = Array.isArray(e.paperIds)
      ? e.paperIds.map((x) => String(x)).slice(0, 20)
      : [];
    base.evidence.quotes = Array.isArray(e.quotes)
      ? e.quotes.map((x) => String(x)).slice(0, 5)
      : [];
  }
  if (raw.target && typeof raw.target === 'object') {
    const t = raw.target as Record<string, unknown>;
    base.target = {
      projectId: typeof t.projectId === 'string' ? t.projectId : undefined,
      stageId: typeof t.stageId === 'string' ? t.stageId : undefined,
      arxivIds: Array.isArray(t.arxivIds) ? t.arxivIds.map((x) => String(x)).slice(0, 20) : undefined,
      draftTitle: typeof t.draftTitle === 'string' ? t.draftTitle : undefined,
    };
  }
  base.created_at = now;
  return base;
}

// ---------------------------------------------------------------------------
// Stub:无 LLM key 时返回 1 条占位 proposal,让 round 跑通完整骨架
// ---------------------------------------------------------------------------

function stubProposals(input: RoundInput, maxProposals: number): Proposal[] {
  const stub: Proposal = {
    ...makeEmptyProposal(input.round),
    id: `p_${input.round}_stub_${Math.random().toString(36).slice(2, 6)}`,
    type: 'literature_review',
    title: '【dry-run】 整理已有论文到 literature review',
    rationale: 'LLM 不可用(stub mode);占位 proposal 让 round 跑通骨架。',
    evidence: {
      paperIds: input.candidates?.slice(0, 5).map((c) => c.arxivId) ?? [],
      quotes: [],
    },
    target: {
      projectId: input.project.id,
      draftTitle: `${input.project.name} — Literature Review (dry-run)`,
    },
    estimated_effort: 'low',
    risk: 'dry-run;无副作用',
    created_at: Date.now(),
  };
  return [stub].slice(0, maxProposals);
}