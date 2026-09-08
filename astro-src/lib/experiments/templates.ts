// astro-src/lib/experiments/templates.ts
//
// Pre-built experiment templates for quick experiment creation.

export interface ExperimentTemplate {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  /** Pre-filled fields */
  title: string;
  titleZh: string;
  hypothesis: string;
  hypothesisZh: string;
  method: string;
  methodZh: string;
  expectedResults: string;
  expectedResultsZh: string;
  variables: Array<{
    name: string;
    type: 'independent' | 'dependent' | 'controlled';
    description: string;
    values?: string[];
  }>;
  tags: string[];
}

export const experimentTemplates: ExperimentTemplate[] = [
  {
    id: 'ablation-study',
    name: 'Ablation Study',
    nameZh: '消融实验',
    description: 'Remove or modify individual components to understand their contribution',
    descriptionZh: '移除或修改各个组件以理解其贡献',
    title: 'Ablation Study: [Component Name]',
    titleZh: '消融实验：',
    hypothesis: 'Removing [component X] will [increase/decrease] [metric Y] by [Z]%',
    hypothesisZh: '移除[组件X]将使[指标Y]提高/降低[Z]%',
    method: '1. Train baseline model with all components\n2. Remove/disable component X\n3. Compare performance on [dataset] using [metric]\n4. Control for: compute budget, training steps, random seed',
    methodZh: '1. 使用所有组件训练基线模型\n2. 移除/禁用组件X\n3. 在[数据集]上使用[指标]比较性能\n4. 控制：计算预算、训练步数、随机种子',
    expectedResults: 'Performance drop of Z% when [component X] is removed',
    expectedResultsZh: '移除[组件X]后性能下降Z%',
    variables: [
      {
        name: 'Component X',
        type: 'independent',
        description: 'The component being ablated',
        values: ['Present', 'Absent'],
      },
      {
        name: 'Performance Metric',
        type: 'dependent',
        description: 'Primary metric to measure',
      },
      {
        name: 'Compute Budget',
        type: 'controlled',
        description: 'Training compute kept constant across conditions',
      },
    ],
    tags: ['ablation', 'analysis', 'architecture'],
  },
  {
    id: 'hyperparameter-sweep',
    name: 'Hyperparameter Sweep',
    nameZh: '超参数搜索',
    description: 'Systematically search over hyperparameter values to find optimal configuration',
    descriptionZh: '系统地搜索超参数值以找到最佳配置',
    title: 'Hyperparameter Sweep: [Hyperparameter Name]',
    titleZh: '超参数搜索：',
    hypothesis: '[Hyperparameter] in range [A, B] will achieve optimal performance at [value C]',
    hypothesisZh: '[超参数]在范围[A, B]内将在[值C]处达到最佳性能',
    method: '1. Define hyperparameter search space\n2. Use [grid/random/bayesian] search\n3. Train models on [dataset]\n4. Evaluate on [validation set]\n5. Report best configuration and learning curve',
    methodZh: '1. 定义超参数搜索空间\n2. 使用[网格/随机/贝叶斯]搜索\n3. 在[数据集]上训练模型\n4. 在[验证集]上评估\n5. 报告最佳配置和学习曲线',
    expectedResults: 'Optimal [hyperparameter] value at [C] with [X]% improvement over baseline',
    expectedResultsZh: '最佳[超参数]值为[C]，比基线提高[X]%',
    variables: [
      {
        name: 'Hyperparameter X',
        type: 'independent',
        description: 'The hyperparameter being tuned',
        values: ['Range of values tested'],
      },
      {
        name: 'Validation Performance',
        type: 'dependent',
        description: 'Primary metric on validation set',
      },
      {
        name: 'Training Steps',
        type: 'controlled',
        description: 'Fixed number of training steps',
      },
      {
        name: 'Random Seed',
        type: 'controlled',
        description: 'Fixed seed for reproducibility',
      },
    ],
    tags: ['hyperparameter', 'optimization', 'tuning'],
  },
  {
    id: 'user-study',
    name: 'User Study',
    nameZh: '用户研究',
    description: 'Collect human feedback to evaluate system performance or user experience',
    descriptionZh: '收集人类反馈以评估系统性能或用户体验',
    title: 'User Study: [System/Feature Name]',
    titleZh: '用户研究：',
    hypothesis: '[User population] will prefer [treatment] over [control] by [X]%',
    hypothesisZh: '[用户群体]将更喜欢[实验组]而非[对照组]，比例[X]%',
    method: '1. Define study protocol and consent process\n2. Recruit N participants from [population]\n3. Randomize participants into groups\n4. Collect [qualitative/quantitative] feedback\n5. Analyze with [statistical test]',
    methodZh: '1. 定义研究方案和知情同意流程\n2. 从[群体]招募N名参与者\n3. 将参与者随机分组\n4. 收集[定性/定量]反馈\n5. 使用[统计检验]分析',
    expectedResults: '[Treatment] group shows X% improvement in [metric] with statistical significance p<0.05',
    expectedResultsZh: '[实验组]在[指标]上显示X%提高，统计显著性p<0.05',
    variables: [
      {
        name: 'Condition',
        type: 'independent',
        description: 'Treatment vs control condition',
        values: ['Treatment', 'Control'],
      },
      {
        name: 'User Rating/Preference',
        type: 'dependent',
        description: 'Primary user feedback metric',
      },
      {
        name: 'User Background',
        type: 'controlled',
        description: 'Participant demographics or expertise level',
      },
    ],
    tags: ['user-study', 'human-feedback', 'evaluation'],
  },
  {
    id: 'ab-test',
    name: 'A/B Test',
    nameZh: 'A/B 测试',
    description: 'Compare two system variants in production or controlled environment',
    descriptionZh: '在生产环境或受控环境中比较两个系统变体',
    title: 'A/B Test: [Feature/Model Name]',
    titleZh: 'A/B 测试：',
    hypothesis: 'Variant [B] will outperform Variant [A] by [X]% on [metric]',
    hypothesisZh: '变体[B]将在[指标]上比变体[A]表现更好，提高[X]%',
    method: '1. Define success metrics and guardrail metrics\n2. Implement both variants\n3. Split traffic [X%/Y%] between variants\n4. Run for [N] days with minimum sample size\n5. Perform statistical significance test',
    methodZh: '1. 定义成功指标和护栏指标\n2. 实现两个变体\n3. 按[X%/Y%]比例分配流量\n4. 运行[N]天，最小样本量\n5. 进行统计显著性检验',
    expectedResults: 'Variant B shows X% improvement with p<0.05, no degradation in guardrail metrics',
    expectedResultsZh: '变体B显示X%提高，p<0.05，护栏指标无下降',
    variables: [
      {
        name: 'System Variant',
        type: 'independent',
        description: 'A/B test condition',
        values: ['Control (A)', 'Treatment (B)'],
      },
      {
        name: 'Primary Metric',
        type: 'dependent',
        description: 'Main success metric',
      },
      {
        name: 'Traffic Split',
        type: 'controlled',
        description: 'Percentage of users in each group',
      },
    ],
    tags: ['a-b-test', 'production', 'online-evaluation'],
  },
];

/** Get template by ID */
export function getExperimentTemplate(id: string): ExperimentTemplate | undefined {
  return experimentTemplates.find((t) => t.id === id);
}
