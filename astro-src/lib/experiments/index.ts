// astro-src/lib/experiments/index.ts
//
// Data access for structured experiments.

import type { Experiment, ExperimentDigest, ExperimentStatus } from './types';

/** 全局实验清单.
 *
 * 对照 Polaris ExperimentsPage:
 *   - 实验是结构化的 hypothesis/method/variables/results 设计
 *   - 可关联多篇论文
 *   - 有状态流转: planning → running → completed/failed/paused
 *
 * 新增实验:在 EXPERIMENTS 加一条,不需要新代码路径。 */
export const EXPERIMENTS: Experiment[] = [
  {
    id: 'ablation-llm-scale',
    title: 'Ablation Study: LLM Scaling Laws in Instruction Tuning',
    titleZh: '消融实验:指令微调中 LLM  Scaling Laws',
    hypothesis: 'Model performance in instruction tuning follows a predictable scaling law, with diminishing returns beyond 70B parameters.',
    hypothesisZh: '指令微调中模型性能遵循可预测的 scaling law,在超过 70B 参数后收益递减。',
    method: 'Fine-tune 1B/3B/7B/70B models on the same instruction dataset. Evaluate on HumanEval, MBPP, and MMLU.',
    methodZh: '在同一指令数据集上微调 1B/3B/7B/70B 模型。在 HumanEval、MBPP 和 MMLU 上评估。',
    variables: [
      { name: 'Model Size', type: 'independent', description: 'Number of parameters', values: ['1B', '3B', '7B', '70B'] },
      { name: 'HumanEval Score', type: 'dependent', description: 'Code generation accuracy' },
      { name: 'Training Compute', type: 'controlled', description: 'FLOPs per token' },
    ],
    expectedResults: '70B outperforms 7B by 15% on HumanEval, but 70B to 400B shows only 5% improvement.',
    expectedResultsZh: '70B 在 HumanEval 上比 7B 高 15%,但 70B 到 400B 只有 5% 提升。',
    actualResults: 'Confirmed: 70B achieves 45% on HumanEval vs 7B at 28%. Scaling plateaus at 70B as predicted.',
    actualResultsZh: '已确认:70B 在 HumanEval 上达到 45%,7B 为 28%。如预测在 70B 达到平台期。',
    status: 'completed',
    relatedPapers: ['2310.02992', '2305.13245'],
    tags: ['ablation', 'scaling', 'instruction-tuning'],
    createdAt: '2026-01-15',
    updatedAt: '2026-06-20',
    owner: 'DPR',
  },
  {
    id: 'model-comparison-gpt4o-vs-sonnet',
    title: 'Model Comparison: GPT-4o vs Claude Sonnet 3.5 on Code Reasoning',
    titleZh: '模型对比:GPT-4o vs Claude Sonnet 3.5 代码推理能力',
    hypothesis: 'Claude Sonnet 3.5 outperforms GPT-4o on complex code reasoning tasks requiring multi-step reasoning.',
    hypothesisZh: 'Claude Sonnet 3.5 在需要多步推理的复杂代码推理任务上优于 GPT-4o。',
    method: 'Run both models on 500 LeetCode hard problems. Measure pass rate, time to solution, and explanation quality.',
    methodZh: '在 500 道 LeetCode 困难题上运行两个模型。测量通过率、解决时间和解释质量。',
    variables: [
      { name: 'Model', type: 'independent', description: 'GPT-4o vs Claude Sonnet 3.5', values: ['GPT-4o', 'Claude Sonnet 3.5'] },
      { name: 'Pass Rate', type: 'dependent', description: 'Percentage of problems solved correctly' },
      { name: 'Explanation Quality', type: 'dependent', description: 'Human-rated clarity and correctness' },
    ],
    expectedResults: 'Claude Sonnet 3.5 achieves 15% higher pass rate on dynamic programming problems.',
    expectedResultsZh: 'Claude Sonnet 3.5 在动态规划问题上实现高 15% 的通过率。',
    actualResults: 'Claude Sonnet 3.5: 62% pass rate vs GPT-4o: 51%. DP tasks show 18% gap.',
    actualResultsZh: 'Claude Sonnet 3.5:62% 通过率 vs GPT-4o:51%。DP 任务显示 18% 差距。',
    status: 'completed',
    relatedPapers: [],
    tags: ['model-comparison', 'code-generation', 'benchmark'],
    createdAt: '2026-02-10',
    updatedAt: '2026-07-15',
    owner: 'DPR',
  },
  {
    id: 'user-study-rag-accuracy',
    title: 'User Study: RAG Accuracy in Research Paper Q&A',
    titleZh: '用户研究:RAG 在科研论文问答中的准确性',
    hypothesis: 'RAG with 5 relevant documents achieves 80% factual accuracy in paper Q&A, dropping to 60% with 10 documents due to noise.',
    hypothesisZh: 'RAG 使用 5 篇相关文档在论文问答中达到 80% 事实准确性,增加到 10 篇文档时因噪声降到 60%。',
    method: 'Recruit 20 researchers. Each asks 10 questions about ArXiv papers. Compare answers with/without RAG, varying document count.',
    methodZh: '招募 20 名研究人员。每人针对 ArXiv 论文提出 10 个问题。对比有/无 RAG 的答案,改变文档数量。',
    variables: [
      { name: 'Document Count', type: 'independent', description: 'Number of retrieved documents', values: ['3', '5', '10', '15'] },
      { name: 'Factual Accuracy', type: 'dependent', description: 'Percentage of correct factual claims' },
      { name: 'User Satisfaction', type: 'dependent', description: '1-5 rating of answer helpfulness' },
    ],
    expectedResults: 'Peak accuracy at 5 documents, degradation beyond 7 due to irrelevant context.',
    expectedResultsZh: '5 篇文档时准确率最高,超过 7 篇因无关上下文导致下降。',
    status: 'running',
    relatedPapers: ['2401.12345', '2402.01234'],
    tags: ['user-study', 'rag', 'qa', 'accuracy'],
    createdAt: '2026-05-01',
    updatedAt: '2026-09-01',
    owner: 'DPR',
  },
  {
    id: 'prompt-engineering-chain-of-thought',
    title: 'Prompt Engineering: Chain-of-Thought Variations',
    titleZh: '提示工程:思维链变体对比',
    hypothesis: 'Explicit step-by-step CoT prompting improves accuracy by 10%+ on math reasoning compared to simple "think step by step".',
    hypothesisZh: '显式分步 CoT 提示相比简单的"think step by step"在数学推理上提高准确率 10% 以上。',
    method: 'Test 5 CoT variants on GSM8K and MATH datasets: simple, explicit steps, intermediate results, self-consistency, tree search.',
    methodZh: '在 GSM8K 和 MATH 数据集上测试 5 种 CoT 变体:简单、显式步骤、中间结果、自一致性、树搜索。',
    variables: [
      { name: 'CoT Variant', type: 'independent', description: 'Type of chain-of-thought prompt', values: ['simple', 'explicit-steps', 'intermediate', 'self-consistency', 'tree-search'] },
      { name: 'Accuracy', type: 'dependent', description: 'Correct answer percentage' },
    ],
    expectedResults: 'Explicit steps and self-consistency outperform simple CoT by 10-15%.',
    expectedResultsZh: '显式步骤和自一致性比简单 CoT 优 10-15%。',
    status: 'completed',
    relatedPapers: ['2201.11903', '2210.03493'],
    tags: ['prompt-engineering', 'cot', 'reasoning', 'math'],
    createdAt: '2026-03-20',
    updatedAt: '2026-08-10',
    owner: 'DPR',
  },
  {
    id: 'hyperparameter-learning-rate-llm',
    title: 'Hyperparameter Study: Optimal Learning Rate for LLM Fine-tuning',
    titleZh: '超参数研究:LLM 微调的最优学习率',
    hypothesis: 'The optimal learning rate for LLM fine-tuning is 1e-5, with significant performance drop below 1e-6 and above 1e-4.',
    hypothesisZh: 'LLM 微调的最优学习率是 1e-6 以下和 1e-4 以上显著下降。',
    method: 'Grid search learning rates: 1e-7 to 1e-3 on 7B model. Evaluate on downstream tasks after 3 epochs.',
    methodZh: '在 7B 模型上进行学习率网格搜索:1e-7 到 1e-3。3 个 epoch 后在下游任务上评估。',
    variables: [
      { name: 'Learning Rate', type: 'independent', description: 'Learning rate values', values: ['1e-7', '1e-6', '1e-5', '1e-4', '1e-3'] },
      { name: 'Validation Loss', type: 'dependent', description: 'Loss on held-out set' },
      { name: 'Task Accuracy', type: 'dependent', description: 'Downstream task performance' },
    ],
    expectedResults: 'Peak at 1e-5, U-shaped curve with sharp degradation at extremes.',
    expectedResultsZh: '1e-5 处最优,极端值处呈 U 型曲线急剧下降。',
    actualResults: 'Confirmed optimal at 1e-5. Loss plateau at 1e-6, divergence at 1e-3.',
    actualResultsZh: '已确认 1e-5 最优。1e-6 损失平台期,1e-3 发散。',
    status: 'completed',
    relatedPapers: ['2303.08466'],
    tags: ['hyperparameter', 'fine-tuning', 'learning-rate'],
    createdAt: '2026-04-05',
    updatedAt: '2026-07-30',
    owner: 'DPR',
  },
];

const BY_ID = new Map<string, Experiment>(EXPERIMENTS.map((e) => [e.id, e]));

export function getExperiment(id: string): Experiment | null {
  return BY_ID.get(id) || null;
}

/** 获取实验摘要列表.
 *
 * @param items 可选,传入论文列表以计算相关论文数
 */
export function buildExperimentDigests(): ExperimentDigest[] {
  return EXPERIMENTS.map((e) => ({
    experiment: e,
    paperCount: e.relatedPapers.length,
    latestDate: e.updatedAt,
  }));
}

/** 按状态过滤实验 */
export function filterByStatus(status: ExperimentStatus | 'all'): Experiment[] {
  if (status === 'all') return EXPERIMENTS;
  return EXPERIMENTS.filter((e) => e.status === status);
}

/** 按标签过滤实验 */
export function filterByTag(tag: string): Experiment[] {
  return EXPERIMENTS.filter((e) => e.tags.includes(tag));
}
