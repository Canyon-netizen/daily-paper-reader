// astro-src/lib/writing/templates.ts
//
// Pre-built writing templates for quick document creation.

export interface WritingTemplate {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  /** Pre-filled structure */
  sections: Array<{
    title: string;
    titleZh: string;
    placeholder: string;
    placeholderZh: string;
    order: number;
  }>;
  type: string;
}

export const writingTemplates: WritingTemplate[] = [
  {
    id: 'workshop-paper',
    name: 'Workshop Paper (4-page ACM format)',
    nameZh: '工作论文 (4页ACM格式)',
    description: 'Short workshop paper following ACM SIGCHI format',
    descriptionZh: '遵循ACM SIGCHI格式的短工作论文',
    sections: [
      {
        title: 'Abstract',
        titleZh: '摘要',
        placeholder: 'Write a concise abstract (150-250 words) summarizing the problem, approach, and results.',
        placeholderZh: '撰写简洁的摘要（150-250字），总结问题、方法和结果。',
        order: 1,
      },
      {
        title: 'Introduction',
        titleZh: '引言',
        placeholder: 'Motivate the problem, state contributions, and outline paper structure.',
        placeholderZh: '阐述问题动机，声明贡献，并概述论文结构。',
        order: 2,
      },
      {
        title: 'Related Work',
        titleZh: '相关工作',
        placeholder: 'Discuss prior work and differentiate your approach.',
        placeholderZh: '讨论先前工作并区分你的方法。',
        order: 3,
      },
      {
        title: 'Method',
        titleZh: '方法',
        placeholder: 'Describe your approach in detail with technical depth.',
        placeholderZh: '详细描述你的方法，具有技术深度。',
        order: 4,
      },
      {
        title: 'Experiments',
        titleZh: '实验',
        placeholder: 'Present experimental setup, datasets, baselines, and results.',
        placeholderZh: '展示实验设置、数据集、基线和结果。',
        order: 5,
      },
      {
        title: 'Conclusion',
        titleZh: '结论',
        placeholder: 'Summarize findings, limitations, and future work.',
        placeholderZh: '总结发现、局限性和未来工作。',
        order: 6,
      },
    ],
    type: 'paper',
  },
  {
    id: 'blog-post',
    name: 'Blog Post',
    nameZh: '博客文章',
    description: 'Technical blog post for sharing insights and tutorials',
    descriptionZh: '用于分享见解和教程的技术博客文章',
    sections: [
      {
        title: 'Hook',
        titleZh: '开场',
        placeholder: 'Grab attention with an interesting fact, question, or story.',
        placeholderZh: '用有趣的事实、问题或故事吸引注意力。',
        order: 1,
      },
      {
        title: 'Background',
        titleZh: '背景',
        placeholder: 'Explain the context and necessary background for readers.',
        placeholderZh: '为读者解释背景和必要的背景知识。',
        order: 2,
      },
      {
        title: 'Main Content',
        titleZh: '主要内容',
        placeholder: 'Share your insights, tutorial, or analysis.',
        placeholderZh: '分享你的见解、教程或分析。',
        order: 3,
      },
      {
        title: 'Code Examples',
        titleZh: '代码示例',
        placeholder: 'Include runnable code snippets to illustrate concepts.',
        placeholderZh: '包含可运行的代码片段以说明概念。',
        order: 4,
      },
      {
        title: 'Conclusion',
        titleZh: '结论',
        placeholder: 'Summarize key takeaways and suggest next steps.',
        placeholderZh: '总结关键要点并建议后续步骤。',
        order: 5,
      },
    ],
    type: 'note',
  },
  {
    id: 'research-proposal',
    name: 'Research Proposal',
    nameZh: '研究提案',
    description: 'Formal research proposal for funding or academic purposes',
    descriptionZh: '用于资助或学术目的的正式研究提案',
    sections: [
      {
        title: 'Problem Statement',
        titleZh: '问题陈述',
        placeholder: 'Clearly define the problem you aim to solve and its significance.',
        placeholderZh: '清晰定义你要解决的问题及其重要性。',
        order: 1,
      },
      {
        title: 'Motivation',
        titleZh: '动机',
        placeholder: 'Explain why this problem matters and who benefits.',
        placeholderZh: '解释为什么这个问题重要，谁受益。',
        order: 2,
      },
      {
        title: 'Objectives',
        titleZh: '目标',
        placeholder: 'List specific, measurable objectives for the project.',
        placeholderZh: '列出项目的具体、可衡量目标。',
        order: 3,
      },
      {
        title: 'Methodology',
        titleZh: '方法论',
        placeholder: 'Describe your research approach and technical plan.',
        placeholderZh: '描述你的研究方法和技术计划。',
        order: 4,
      },
      {
        title: 'Timeline',
        titleZh: '时间表',
        placeholder: 'Outline key milestones and deliverables.',
        placeholderZh: '概述关键里程碑和交付物。',
        order: 5,
      },
      {
        title: 'Expected Impact',
        titleZh: '预期影响',
        placeholder: 'Describe the potential outcomes and contributions.',
        placeholderZh: '描述潜在的成果和贡献。',
        order: 6,
      },
      {
        title: 'Resources Required',
        titleZh: '所需资源',
        placeholder: 'List compute, data, and other resource needs.',
        placeholderZh: '列出计算、数据和其他资源需求。',
        order: 7,
      },
    ],
    type: 'paper',
  },
];

/** Get template by ID */
export function getWritingTemplate(id: string): WritingTemplate | undefined {
  return writingTemplates.find((t) => t.id === id);
}
