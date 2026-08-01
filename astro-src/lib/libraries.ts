// astro-src/lib/libraries.ts
//
// 「公共主题文献库」抽象(对照 Polaris 的 DirectionLibrary / /libraries)。
//
// 设计原则(2026-08-01 用户医正后的架构):
//   - **每个文献库就是一个领域/主题/任务的论文集合**,成员关系由 `categories.task` /
//     `categories.method` 派生(docs/papers/**/*.md frontmatter)。
//   - 文献库**不是**用户手动加的"收藏夹"(那是个人图书馆,走 lib/user-library)。
//   - 不需要 Gist 同步 —— 同一份 docs/papers 在所有人面前是同一份成员关系。
//   - 不需要新建/删除 UI —— 文献库在 lib/libraries.ts 顶部配置表里定义。
//
// 路径布局:
//   /libraries/             卡片流(首页入口)
//   /libraries/<id>/        单库工作台(论文列表 + 概念 + 导出)
//
// 单库工作台 = /papers/ + tag=<libId> 的薄包装 + 顶部描述 + 导出按钮。
// 复用 lib/paper.ts:listPapers + lib/paper-filter.ts:filterByTag。

import type { PaperListItem } from './paper';

export interface Library {
  /** kebab-case,作为 URL 段,如 'rl' / 'llm-agent' / 'alignment' */
  id: string;
  /** 显示名(中英两版,因为站点有 i18n 设想) */
  title: string;
  titleZh: string;
  /** 一句话描述(库是什么、解决什么问题) */
  description: string;
  descriptionZh: string;
  /** 衍生自 frontmatter 哪一类(dim:label 形式) */
  tags: string[];
  /** 主维度,用于顶部 pill 过滤('task' 或 'method',首条 tag 的 dim) */
  dimension: 'task' | 'method';
  /** 谁维护 / 谁推荐(站点权威度) */
  curator: string;
  /** 卡片背景色(从预设 6 色挑一个,与 concepts / conferences 区分) */
  hue: string;
}

/** 站点预置的文献库清单。
 *
 * 挑选规则:
 *   1. 论文数量 >= 6(让卡片有实际内容)
 *   2. task / method 维度有具体方向,不和别的库重叠
 *   3. 覆盖核心 AI / ML 方向(Ralph / CV / NLP / Agents / Alignment)
 *
 * 通过 lib/paper-filter.ts:filterByTag(items, 'task:rl') 派生成员。
 * 新增库:在 LIBRARIES 加一行,不需要新代码路径。 */
export const LIBRARIES: Library[] = [
  {
    id: 'rl',
    title: 'Reinforcement Learning',
    titleZh: '强化学习',
    description: 'RL theory, policy optimization, exploration, value functions. Multi-agent & offline RL included.',
    descriptionZh: '强化学习理论、策略优化、探索与利用、值函数。多智能体与离线 RL 也在内。',
    tags: ['task:rl'],
    dimension: 'task',
    curator: 'DPR',
    hue: 'orange',
  },
  {
    id: 'multi-agent',
    title: 'Multi-Agent Systems',
    titleZh: '多智能体系统',
    description: 'Cooperative / competitive multi-agent, MARL, agent communication, emergent coordination.',
    descriptionZh: '合作 / 竞争多智能体、MARL、智能体通信、涌现协调。',
    tags: ['task:mas'],
    dimension: 'task',
    curator: 'DPR',
    hue: 'cyan',
  },
  {
    id: 'game-ai',
    title: 'Game AI',
    titleZh: '博弈 AI',
    description: 'Game-playing agents, online decision-making, opponent modeling, StarCraft / Honor of Kings / poker.',
    descriptionZh: '博弈代理、在线决策、对手建模,涵盖 StarCraft / 王者荣耀 / 扑克等场景。',
    tags: ['task:game-ai'],
    dimension: 'task',
    curator: 'DPR',
    hue: 'purple',
  },
  {
    id: 'llm-agent',
    title: 'LLM Agents',
    titleZh: '大模型智能体',
    description: 'LLM-driven tool use, planning, code agents, GUI agents, multi-turn reasoning with feedback.',
    descriptionZh: 'LLM 工具调用、规划、代码代理、GUI 代理、多轮反馈推理。',
    tags: ['task:llm-agent', 'task:agent'],
    dimension: 'task',
    curator: 'DPR',
    hue: 'emerald',
  },
  {
    id: 'reasoning',
    title: 'Reasoning & Alignment',
    titleZh: '推理与对齐',
    description: 'Chain-of-thought, RLHF, sycophancy mitigation, mechanistic interpretability, activation steering.',
    descriptionZh: '思维链、RLHF、阿谀抑制、机制可解释性、激活引导。',
    tags: ['task:reasoning', 'method:rlhf'],
    dimension: 'method',
    curator: 'DPR',
    hue: 'amber',
  },
  {
    id: 'robotics',
    title: 'Robotics & Embodied AI',
    titleZh: '机器人与具身智能',
    description: 'Sim-to-real, locomotion, manipulation, world models, skill discovery, vision-language-action.',
    descriptionZh: '虚实迁移、运动控制、操作、世界模型、技能发现、视觉-语言-动作。',
    tags: ['task:robotics', 'task:manipulation', 'task:locomotion'],
    dimension: 'task',
    curator: 'DPR',
    hue: 'rose',
  },
  {
    id: 'computer-vision',
    title: 'Computer Vision',
    titleZh: '计算机视觉',
    description: 'Recognition, generation, self-supervised representation, multimodal perception.',
    descriptionZh: '识别、生成、自监督表征、多模态感知。',
    tags: ['task:vision'],
    dimension: 'task',
    curator: 'DPR',
    hue: 'sky',
  },
];

const BY_ID = new Map<string, Library>(LIBRARIES.map((l) => [l.id, l]));

export function getLibrary(id: string): Library | null {
  return BY_ID.get(id) || null;
}

/** 给全部论文 + 文献库清单,产出"库 → 论文数 / 概念数 / 最近更新 / 最近 3 篇"映射。
 *
 * 字段对齐 Polaris LibrariesPage 卡片的 4 个数字:
 *   - paperCount  : "91 篇论文"
 *   - conceptCount: "60 个概念"
 *   - latestDate  : "更新于 08-01"
 *   - recentIds   : (暂未在卡片显示,但供详情页用)
 *
 * 不带任何 IO(纯 listPapers 派生),SSR 安全。
 *
 * @param items 论文全集(从 listPapers({dedup:true}) 拉来的 PaperListItem[])
 *             字段展开:title / title_zh / date / categories / concepts?(custom)
 */
export interface LibraryDigest {
  library: Library;
  paperCount: number;
  conceptCount: number;
  latestDate: string;     // YYYY-MM-DD 或 ''
  recentIds: string[];
}

export function buildLibraryDigests(items: PaperListItem[]): LibraryDigest[] {
  const out: LibraryDigest[] = [];
  for (const lib of LIBRARIES) {
    const matched = items.filter((p) => flattenTags(p).some((t) => lib.tags.includes(t)));
    if (matched.length === 0) continue;  // 0 篇就跳过,不显示空卡
    const sorted = matched.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    // 概念去重计数:从 PaperListItem.concepts(Stage 9 派生)的 slug Set。
    const conceptSlugs = new Set<string>();
    for (const p of matched) {
      const cs = p.concepts;
      if (!Array.isArray(cs)) continue;
      for (const c of cs) if (c?.slug) conceptSlugs.add(c.slug);
    }
    out.push({
      library: lib,
      paperCount: matched.length,
      conceptCount: conceptSlugs.size,
      latestDate: sorted[0]?.date || '',
      recentIds: sorted.slice(0, 3).map((p) => p.id),
    });
  }
  return out;
}

function flattenTags(p: PaperListItem): string[] {
  if (!p.categories) return [];
  const out: string[] = [];
  const cats = p.categories as Record<string, string[] | undefined>;
  for (const dim of ['venue', 'task', 'method', 'type'] as const) {
    for (const label of cats[dim] || []) out.push(`${dim}:${label}`);
  }
  return out;
}

/** 给定库 id 拉它全部成员。
 *  这是单库工作台的核心:listPapers(items) → filter items by lib.tags。
 *
 *  替代方案:直接传 lib.tags 给 paper-filter.ts:filterByTag,但 filterByTag
 *  只支持单 tag,不能多 tag OR。这里手动 filter,行为等价于 filterByTag 任一命中。 */
export function selectLibraryPapers(items: PaperListItem[], lib: Library): PaperListItem[] {
  return items.filter((p) => flattenTags(p).some((t) => lib.tags.includes(t)));
}