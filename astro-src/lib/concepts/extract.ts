// astro-src/lib/concepts/extract.ts
//
// R7 G.1.1: 抽取 prompt 升级到 3 阶段。
//
// 三阶段:
//   1. 从 title 抽取 3-5 个核心概念(粒度最粗)
//   2. 从 abstract 抽取 8-12 个 body concepts
//   3. cross-link:基于共现性(同一篇 paper 出现的 concept 互相 link) +
//      父子关系(标题概念 ⊃ body 概念)
//
// 本模块只产出 3 段 prompt + 编排函数(纯函数,不调 LLM)。调用方把
// LLM 返回粘回 → mergeConcepts(...) 合成最终 ConceptRef[]。

export interface ConceptRef {
  /** 概念 slug(小写,kebab-case) */
  slug: string;
  /** 中文/英文显示名 */
  label: string;
  /** 父概念 slug(可选,例如 "transformer" ⊃ "self-attention") */
  parent?: string;
  /** 来源 stage(1 / 2 / 3) */
  sourceStage: 1 | 2 | 3;
  /** 置信度 0..1 */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Stage 1 prompt:title → 3-5 keywords
// ---------------------------------------------------------------------------

export const STAGE1_TITLE_PROMPT = `你是研究领域专家。从论文标题里抽取 3-5 个核心概念。

输入标题: "{title}"

输出 JSON 数组(每条 {slug, label, confidence 0..1}):
- slug: 小写 kebab-case,英文或拼音
- label: 中文或英文显示名(原文术语)

要求:
- 3-5 个,粒度粗(方法大类 / 任务大类),不要过细的子技术
- 输出严格 JSON 数组,不要任何 markdown 包裹`;

// ---------------------------------------------------------------------------
// Stage 2 prompt:abstract → 8-12 body concepts
// ---------------------------------------------------------------------------

export const STAGE2_ABSTRACT_PROMPT = `你是研究领域专家。从论文摘要抽取 8-12 个 body 概念(粒度比标题概念细)。

输入摘要:
{abstract}

输出 JSON 数组(每条 {slug, label, confidence 0..1, parentSlug?: string}):
- slug: 小写 kebab-case
- label: 中文或英文
- parentSlug: 可选,父概念 slug(标题里的核心概念)
- 严格 JSON,不要 markdown 包裹`;

// ---------------------------------------------------------------------------
// Stage 3 prompt:cross-link(共现关系)
// ---------------------------------------------------------------------------

export const STAGE3_CROSSLINK_PROMPT = `基于已抽取的概念列表,推导概念间的 link 关系:

{concepts}

输出 JSON 数组(每条 {from, to, type, weight 0..1}):
- type: "parent_of" | "related_to" | "uses" | "evaluated_on"
- from / to: 概念 slug
- weight: 0..1

严格 JSON 输出`;

// ---------------------------------------------------------------------------
// 渲染 prompt(把变量注入到模板)
// ---------------------------------------------------------------------------

export function renderStage1Prompt(title: string): string {
  return STAGE1_TITLE_PROMPT.replace('{title}', escapeForPrompt(title));
}

export function renderStage2Prompt(abstract: string): string {
  return STAGE2_ABSTRACT_PROMPT.replace('{abstract}', escapeForPrompt(abstract));
}

export function renderStage3Prompt(concepts: readonly ConceptRef[]): string {
  const list = concepts
    .map((c) => `- ${c.slug} (${c.label})${c.parent ? ` ⊃ parent=${c.parent}` : ''}`)
    .join('\n');
  return STAGE3_CROSSLINK_PROMPT.replace('{concepts}', list);
}

function escapeForPrompt(s: string): string {
  // 简单 escape:防止模板字符串里的 { } 误解析
  return s.replace(/[{}]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// 合并 3 阶段结果的纯函数(给 LLM 输出 → ConceptRef[])
// ---------------------------------------------------------------------------

/**
 * 合并 stage 1 + stage 2 + stage 3 cross-link 结果到最终 ConceptRef[]。
 * 行为:
 *   - stage 1 概念保留,parent 不变
 *   - stage 2 概念若有 parentSlug,建立父子
 *   - stage 3 link 中的 parent_of 关系覆盖 / 补充 parent 字段
 *   - 跨 stage 同 slug 合并,confidence 取 max
 */
export function mergeConcepts(
  stage1: readonly ConceptRef[],
  stage2: readonly ConceptRef[],
  stage3Links: readonly { from: string; to: string; type: string; weight?: number }[] = [],
): ConceptRef[] {
  const out = new Map<string, ConceptRef>();

  for (const c of stage1) {
    out.set(c.slug, { ...c, sourceStage: 1 });
  }
  for (const c of stage2) {
    const existing = out.get(c.slug);
    if (existing) {
      out.set(c.slug, {
        ...existing,
        label: c.label || existing.label,
        parent: c.parent || existing.parent,
        confidence: Math.max(existing.confidence, c.confidence),
        sourceStage: 1, // 因为已被 stage1 占
      });
    } else {
      out.set(c.slug, { ...c, sourceStage: 2 });
    }
  }

  // 应用 stage3 的 parent_of 关系
  for (const link of stage3Links) {
    if (link.type !== 'parent_of') continue;
    const child = out.get(link.to);
    if (child) {
      out.set(link.to, {
        ...child,
        parent: link.from,
        confidence: Math.min(1, child.confidence + 0.05),
      });
    }
  }

  return Array.from(out.values()).sort((a, b) => {
    // parent 先(树形排列);同层按 slug
    if (a.parent !== b.parent) return (a.parent || '') < (b.parent || '') ? -1 : 1;
    return a.slug < b.slug ? -1 : 1;
  });
}