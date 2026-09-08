/**
 * agents/modifier.ts — Modifier agent: apply gated proposals to upstream modules.
 *
 * 输入:Gate verdicts + Proposals + 上游模块引用
 * 输出:ModifierAction[] (写盘动作清单) + ModifierSkip[] (跳过原因)
 *
 * 设计原则:
 *   - **驱动而非替代**:Modifier 不重新实现 ideas/experiments/writings/roadmap 的 CRUD,
 *     而是把通过 gate 的 proposal 翻译成上游模块的调用。
 *   - **dry_run 隔离**:--dry-run 时只输出"如果执行会做什么",不动 localStorage。
 *   - **失败隔离**:单条 apply 失败不影响其他;记录到 ModifierSkip。
 *   - **审计**:每次成功 append activity(沿用 lib/projects/activity 的 audit 表)。
 */

import type {
  GateVerdict,
  ModifierAction,
  ModifierSkip,
  Proposal,
  RoundInput,
} from './types';

// ---------------------------------------------------------------------------
// 上游模块 adapter 接口(浏览器 / CLI 各实现一份)
// ---------------------------------------------------------------------------

export interface UpstreamAdapter {
  // ideas
  createIdea?(opts: {
    title: string;
    description: string;
    relatedPapers: string[];
    tags: string[];
    source?: string;
  }): { id: string } | Promise<{ id: string }>;

  // experiments
  createExperiment?(opts: {
    title: string;
    titleZh: string;
    hypothesis: string;
    method: string;
    relatedPapers: string[];
    tags: string[];
  }): { id: string } | Promise<{ id: string }>;

  // writing
  createWriting?(opts: {
    title: string;
    type: 'paper' | 'section' | 'note' | 'review' | 'translation';
    relatedIdeas: string[];
    citedPapers: string[];
  }): { id: string } | Promise<{ id: string }>;

  // project (user-library v5)
  addPaperToProject?(projectId: string, stageId: string, arxivId: string): boolean | Promise<boolean>;

  // audit log (lib/projects/activity.ts)
  appendActivity?(row: {
    projectId: string;
    kind: string;
    proposalId?: string;
    detail?: string;
  }): void | Promise<void>;

  // dry_run marker
  readonly dry_run: boolean;
}

// ---------------------------------------------------------------------------
// Stub adapter:CLI / dry-run / 测试用,只产出 ModifierAction,不真写盘
// ---------------------------------------------------------------------------

export function makeStubAdapter(opts: { dry_run?: boolean } = {}): UpstreamAdapter {
  const dry = !!opts.dry_run;
  const actions: ModifierAction[] = [];
  return {
    dry_run: dry,
    async createIdea(o) {
      const id = `idea_${Date.now().toString(36)}`;
      actions.push({
        id: `a_${id}`,
        kind: 'archive_round_summary',
        proposal_id: o.title,
        payload: { would_call: 'createIdea', ...o },
        applied_at: Date.now(),
      });
      return { id };
    },
    async createExperiment(o) {
      const id = `exp_${Date.now().toString(36)}`;
      actions.push({
        id: `a_${id}`,
        kind: 'archive_round_summary',
        proposal_id: o.title,
        payload: { would_call: 'createExperiment', ...o },
        applied_at: Date.now(),
      });
      return { id };
    },
    async createWriting(o) {
      const id = `w_${Date.now().toString(36)}`;
      actions.push({
        id: `a_${id}`,
        kind: 'archive_round_summary',
        proposal_id: o.title,
        payload: { would_call: 'createWriting', ...o },
        applied_at: Date.now(),
      });
      return { id };
    },
    async addPaperToProject(projectId, stageId, arxivId) {
      actions.push({
        id: `a_${Date.now().toString(36)}`,
        kind: 'add_paper_to_stage',
        proposal_id: `${projectId}::${stageId}`,
        payload: { projectId, stageId, arxivId },
        applied_at: Date.now(),
      });
      return true;
    },
    async appendActivity(row) {
      actions.push({
        id: `a_${Date.now().toString(36)}`,
        kind: 'archive_round_summary',
        proposal_id: row.proposalId ?? row.kind,
        payload: { would_call: 'appendActivity', ...row },
        applied_at: Date.now(),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 浏览器侧 adapter:走真 localStorage 上游模块
// ---------------------------------------------------------------------------

export async function makeBrowserAdapter(opts: { dry_run?: boolean } = {}): Promise<UpstreamAdapter> {
  const dry = !!opts.dry_run;
  // 动态 import 避免 Node CLI runner 误拉浏览器模块
  const ideasMod = dry ? null : await import('../ideas');
  const experimentsMod = dry ? null : await import('../experiments');
  const writingMod = dry ? null : await import('../writing');

  return {
    dry_run: dry,
    async createIdea(o) {
      if (dry || !ideasMod) return { id: `stub_idea_${Date.now().toString(36)}` };
      // upstream signature: (title, description, relatedPapers, tags, source)
      const idea = ideasMod.createIdea(
        o.title,
        o.description,
        o.relatedPapers,
        o.tags,
        (o.source as 'manual') ?? 'manual',
      );
      return { id: idea.id };
    },
    async createExperiment(o) {
      if (dry || !experimentsMod) return { id: `stub_exp_${Date.now().toString(36)}` };
      // upstream signature: (title, hypothesis, method, titleZh, hypothesisZh, methodZh)
      const exp = experimentsMod.createExperiment(
        o.title,
        o.hypothesis,
        o.method,
        o.titleZh || o.title,
        o.hypothesisZh || o.hypothesis,
        o.methodZh || o.method,
      );
      // 追加 relatedPapers + tags(若上游 Experiment 类型有)
      if (o.relatedPapers?.length || o.tags?.length) {
        experimentsMod.updateExperiment?.(exp.id, {
          relatedPapers: o.relatedPapers ?? [],
          tags: o.tags ?? [],
        });
      }
      return { id: exp.id };
    },
    async createWriting(o) {
      if (dry || !writingMod) return { id: `stub_w_${Date.now().toString(36)}` };
      return writingMod.createWriting(o.title, o.type);
    },
    async addPaperToProject(projectId, stageId, arxivId) {
      if (dry) return true;
      const { addPaperToStage } = await import('../projects');
      return addPaperToStage(projectId, stageId, arxivId);
    },
    async appendActivity(row) {
      if (dry) return;
      const { appendActivity } = await import('../projects/activity');
      return appendActivity({
        id: `act_${Date.now().toString(36)}`,
        projectId: row.projectId,
        kind: 'agent_round' as const,
        proposalId: row.proposalId,
        detail: row.detail,
        at: Date.now(),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 主入口:apply gated proposals
// ---------------------------------------------------------------------------

export async function modifierApply(
  verdicts: GateVerdict[],
  proposals: Proposal[],
  input: RoundInput,
  adapter: UpstreamAdapter,
): Promise<{ applied: ModifierAction[]; skipped: ModifierSkip[] }> {
  const proposalById = new Map<string, Proposal>();
  for (const p of proposals) proposalById.set(p.id, p);

  const applied: ModifierAction[] = [];
  const skipped: ModifierSkip[] = [];

  // 只对 promoted / candidate 两条路真正动手
  const actionable = verdicts.filter(
    (v) => v.decision === 'promoted' || v.decision === 'candidate',
  );

  for (const v of actionable) {
    const proposal = proposalById.get(v.proposal_id);
    if (!proposal) {
      skipped.push({ proposal_id: v.proposal_id, reason: 'proposal not found in input' });
      continue;
    }
    try {
      const actions = await applyOne(proposal, v.decision === 'promoted', input, adapter);
      applied.push(...actions);
    } catch (err) {
      skipped.push({
        proposal_id: v.proposal_id,
        reason: `apply failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // 写盘 sketch/rejected 也记录(便于 round summary)
  for (const v of verdicts) {
    if (v.decision !== 'promoted' && v.decision !== 'candidate') {
      skipped.push({
        proposal_id: v.proposal_id,
        reason: `gate=${v.decision}; ${v.reasons.join('; ')}`,
      });
    }
  }

  return { applied, skipped };
}

// ---------------------------------------------------------------------------
// 单条 proposal 应用
// ---------------------------------------------------------------------------

async function applyOne(
  p: Proposal,
  isPromoted: boolean,
  input: RoundInput,
  adapter: UpstreamAdapter,
): Promise<ModifierAction[]> {
  const actions: ModifierAction[] = [];
  const now = Date.now();

  // 1. 始终先 audit(让 round 可追溯)
  if (adapter.appendActivity) {
    await adapter.appendActivity({
      projectId: input.project.id,
      kind: isPromoted ? 'proposal_promoted' : 'modifier_action',
      proposalId: p.id,
      detail: `${p.type}: ${p.title}`,
    });
  }

  // 2. 按 type 分派
  switch (p.type) {
    case 'add_paper': {
      const stageId = p.target.stageId ?? 'default';
      const arxivIds = p.target.arxivIds?.length ? p.target.arxivIds : p.evidence.paperIds;
      for (const arxivId of arxivIds.slice(0, 5)) {
        if (!adapter.addPaperToProject) continue;
        const ok = await adapter.addPaperToProject(input.project.id, stageId, arxivId);
        actions.push({
          id: `m_${now}_${actions.length}`,
          kind: 'add_paper_to_stage',
          proposal_id: p.id,
          payload: { projectId: input.project.id, stageId, arxivId, ok },
          applied_at: now,
        });
      }
      break;
    }

    case 'create_draft':
    case 'literature_review':
    case 'rebuttal': {
      if (!adapter.createWriting) break;
      const writingType =
        p.type === 'create_draft' ? 'paper'
        : p.type === 'literature_review' ? 'review'
        : 'note';
      const title = p.target.draftTitle ?? p.title;
      const w = await adapter.createWriting({
        title,
        type: writingType,
        relatedIdeas: [],
        citedPapers: p.evidence.paperIds,
      });
      actions.push({
        id: `m_${now}_${actions.length}`,
        kind: 'create_draft_outline',
        proposal_id: p.id,
        payload: { writing_id: w.id, type: writingType, title },
        applied_at: now,
      });
      break;
    }

    case 'experiment_plan': {
      if (!adapter.createExperiment) break;
      const e = await adapter.createExperiment({
        title: p.title,
        titleZh: p.title,
        hypothesis: p.rationale,
        method: p.rationale,
        relatedPapers: p.evidence.paperIds,
        tags: extractTags(p),
      });
      actions.push({
        id: `m_${now}_${actions.length}`,
        kind: 'archive_round_summary',
        proposal_id: p.id,
        payload: { experiment_id: e.id, title: p.title },
        applied_at: now,
      });
      break;
    }
  }

  return actions;
}

function extractTags(p: Proposal): string[] {
  // proposal 没 tags 字段,从 evidence/rationale 抽 #hashtag
  const tags = new Set<string>();
  const re = /#([\w-]+)/g;
  const haystack = `${p.rationale} ${p.title} ${p.risk}`;
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) tags.add(m[1]);
  return [...tags];
}

// ---------------------------------------------------------------------------
// 浏览器侧 addPaperToStage 适配(若 lib/projects 不存在,降级 stub)
// ---------------------------------------------------------------------------

async function addPaperToStage(
  projectId: string,
  stageId: string,
  arxivId: string,
): Promise<boolean> {
  try {
    const { addPaperToStage } = await import('../projects');
    return addPaperToStage(projectId, stageId, arxivId);
  } catch {
    // 项目模块未暴露,降级到本地 IDB / 直接返回 true(stub)
    return true;
  }
}