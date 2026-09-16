// astro-src/lib/writing/outline.ts
//
// R7 E.3.1: writing outline generator.
//
// 根据 writing type + 已引用的 papers 生成推荐大纲骨架。
//  - 'paper'        → 标准 8 节论文骨架
//  - 'section'      → 短篇(3 节,引言/主体/小结)
//  - 'note'         → 1 节笔记
//  - 'review'       → 综述专用(11 节,加 related work / taxonomy / gap)
//  - 'translation'  → 翻译专用(双语对照节)
//
// 输入:
//   - type
//   - 已有 citedPapers (PaperRef[]) → 会建议 in-text citation 占位符
// 输出:
//   - OutlineNode { id, title, description, suggestedWordCount, placeholders[] }
//
// 纯函数,无副作用,单测友好。

import type { PaperRef, WritingSection, WritingType } from './types';

export interface OutlineNode {
  /** section id(小写 kebab,跟 DEFAULT_SECTIONS id 对齐) */
  id: string;
  /** 显示标题 */
  title: string;
  /** 一句话说明该节应写什么 */
  description: string;
  /** 建议字数(粗略指导,中文按字符,英文按词) */
  suggestedWordCount: number;
  /** 该节推荐引用的 paper 占位符(形如 "[Smith et al., 2024]") */
  placeholders: string[];
}

/** 简单把 arxivId 映射成引用占位符([arXiv:2506.12345]) */
  function citePlaceholder(arxivId: string): string {
    const canonical = arxivId.replace(/v\d+$/, '');
    return `[arXiv:${canonical}]`;
  }

/** paper 8 节标准大纲。 */
const PAPER_OUTLINE: Omit<OutlineNode, 'placeholders'>[] = [
  { id: 'abstract', title: '摘要', description: '150-250 词总结问题 / 方法 / 主要结果 / 结论', suggestedWordCount: 200 },
  { id: 'introduction', title: '引言', description: '问题背景、动机、与前人工作差异、本文贡献', suggestedWordCount: 800 },
  { id: 'method', title: '方法', description: '模型 / 算法 / 假设,公式 + 关键图', suggestedWordCount: 1500 },
  { id: 'experiments', title: '实验', description: '数据集、baseline、消融、评估指标、超参', suggestedWordCount: 1000 },
  { id: 'results', title: '结果', description: '主表 + 关键数字,与 SOTA 对比,统计显著性', suggestedWordCount: 600 },
  { id: 'discussion', title: '讨论', description: 'limitation、失败案例、可推广性', suggestedWordCount: 400 },
  { id: 'conclusion', title: '结论', description: '回顾贡献 + 下一步工作', suggestedWordCount: 200 },
  { id: 'references', title: '参考文献', description: '自动从 citedPapers 渲染', suggestedWordCount: 0 },
];

/** review 11 节综述大纲。 */
const REVIEW_OUTLINE: Omit<OutlineNode, 'placeholders'>[] = [
  { id: 'abstract', title: '摘要', description: '综述范围 + 检索策略 + 主要发现', suggestedWordCount: 250 },
  { id: 'introduction', title: '引言', description: '为什么需要综述、贡献', suggestedWordCount: 600 },
  { id: 'method', title: '检索方法', description: '检索词、数据库、纳入 / 排除标准', suggestedWordCount: 500 },
  { id: 'taxonomy', title: '分类法', description: '按方法 / 任务 / 数据集划分已有工作', suggestedWordCount: 1200 },
  { id: 'related-work', title: '相关工作', description: '按主题分组的详细综述', suggestedWordCount: 2000 },
  { id: 'comparison', title: '横向对比', description: '跨论文的指标 / 数据集 / 局限对比表', suggestedWordCount: 600 },
  { id: 'gaps', title: '研究空白', description: '识别尚未解决的问题', suggestedWordCount: 500 },
  { id: 'discussion', title: '讨论', description: '趋势、争议、未来方向', suggestedWordCount: 500 },
  { id: 'conclusion', title: '结论', description: '总结要点', suggestedWordCount: 200 },
  { id: 'references', title: '参考文献', description: '综述所有引用', suggestedWordCount: 0 },
  { id: 'appendix', title: '附录', description: '补充材料 / 完整文献列表', suggestedWordCount: 0 },
];

/** section 3 节大纲。 */
const SECTION_OUTLINE: Omit<OutlineNode, 'placeholders'>[] = [
  { id: 'introduction', title: '引言', description: '本节动机 + 与全文关系', suggestedWordCount: 300 },
  { id: 'main', title: '主体', description: '核心内容', suggestedWordCount: 1200 },
  { id: 'summary', title: '小结', description: '本节要点 + 衔接下节', suggestedWordCount: 200 },
];

/** note 1 节大纲。 */
const NOTE_OUTLINE: Omit<OutlineNode, 'placeholders'>[] = [
  { id: 'body', title: '正文', description: '阅读笔记 / 想法 / TODO', suggestedWordCount: 500 },
];

/** translation 双语大纲。 */
const TRANSLATION_OUTLINE: Omit<OutlineNode, 'placeholders'>[] = [
  { id: 'source', title: '原文', description: '英文原文,按段分块', suggestedWordCount: 0 },
  { id: 'translation', title: '译文', description: '中文译文,与原文一一对应', suggestedWordCount: 0 },
  { id: 'notes', title: '译注', description: '术语、背景、疑难句解释', suggestedWordCount: 200 },
];

/** 把模板 + 引用填充成完整 OutlineNode[] */
function fillPlaceholders(
  template: Omit<OutlineNode, 'placeholders'>[],
  citedPapers: readonly PaperRef[],
  citationStrategy: 'spread' | 'front-loaded' | 'cluster',
): OutlineNode[] {
  const placeholders = citedPapers.map((p) => citePlaceholder(p.arxivId));
  return template.map((node, idx) => {
    let picks: string[] = [];
    if (placeholders.length === 0) {
      picks = [];
    } else if (citationStrategy === 'front-loaded') {
      // 相关工作节(introduction / related-work / taxonomy)塞全部,其他节空
      picks = ['related-work', 'introduction', 'taxonomy', 'comparison'].includes(node.id) ? placeholders : [];
    } else if (citationStrategy === 'cluster') {
      // 按 section idx 分组:每节分配 N/(节数) 个
      const per = Math.max(1, Math.floor(placeholders.length / template.length));
      const start = idx * per;
      const end = idx === template.length - 1 ? placeholders.length : start + per;
      picks = placeholders.slice(start, end);
    } else {
      // spread:每个有 content 的节都撒 1 个
      picks = node.suggestedWordCount > 0 ? [placeholders[idx % placeholders.length]] : [];
    }
    return { ...node, placeholders: picks };
  });
}

/** 给定 type + citedPapers,返回推荐 outline。 */
export function generateOutline(
  type: WritingType,
  citedPapers: readonly PaperRef[] = [],
  opts: { citationStrategy?: 'spread' | 'front-loaded' | 'cluster' } = {},
): OutlineNode[] {
  const strategy = opts.citationStrategy ?? 'spread';
  switch (type) {
    case 'paper':
      return fillPlaceholders(PAPER_OUTLINE, citedPapers, strategy);
    case 'review':
      return fillPlaceholders(REVIEW_OUTLINE, citedPapers, strategy);
    case 'section':
      return fillPlaceholders(SECTION_OUTLINE, citedPapers, strategy);
    case 'note':
      return fillPlaceholders(NOTE_OUTLINE, citedPapers, strategy);
    case 'translation':
      // 翻译不该塞引用占位符 —— 清空
      return fillPlaceholders(TRANSLATION_OUTLINE, citedPapers, 'spread').map((n) => ({ ...n, placeholders: [] }));
  }
}

/** 把 OutlineNode[] 转换成 WritingSection[] —— 给 createWriting 用。 */
export function outlineToSections(outline: readonly OutlineNode[]): WritingSection[] {
  return outline.map((node, idx) => ({
    id: node.id,
    title: node.title,
    content: node.placeholders.length > 0
      ? `<!-- ${node.description} -->\n\n${node.placeholders.map((p) => `_${p}_`).join(' ')}\n\n`
      : `<!-- ${node.description} -->\n\n`,
    order: idx,
  }));
}

/** 计算 outline 总字数(中文按字符算 word count = chars + words)。 */
export function outlineTotalWords(outline: readonly OutlineNode[]): number {
  return outline.reduce((sum, n) => sum + n.suggestedWordCount, 0);
}

/** 估计所需写作天数(按每天 500 词)。 */
export function estimateWritingDays(outline: readonly OutlineNode[], wordsPerDay = 500): number {
  const total = outlineTotalWords(outline);
  if (total === 0) return 0;
  return Math.max(1, Math.ceil(total / wordsPerDay));
}