// astro-src/lib/library/audience-profiles.ts
//
// Multi-dimensional inclusion standard for user libraries.
// Source of truth: docs/library/inclusion-standard.md
// If this file disagrees with the doc, treat the code as a bug.
//
// Three jobs:
//   1. Define the 4 audience profiles (novice / expert / reviewer / practitioner)
//      with axes, weights, default threshold, and LLM prompt hints.
//   2. Provide getProfile(id) and a default for backwards compatibility.
//   3. Build the prompt addendum injected by scorePaperRelevance() so the LLM
//      scores along the right axes.

export type AudienceProfileId =
  | 'novice'
  | 'expert'
  | 'reviewer'
  | 'practitioner';

export interface AudienceAxis {
  /** Short id used in LLM JSON output, e.g. "novelty" / "pedagogical_clarity". */
  name: string;
  /** Display label (Chinese), surfaced in candidate review UI. */
  label: string;
  /** Weight 0-1, sums to 1.0 within a profile. */
  weight: number;
  /** One-sentence description for the LLM prompt + UI tooltip. */
  description: string;
  /** What 1 means (low signal) — shown in UI legend. */
  lowExample: string;
  /** What 5 means (high signal) — shown in UI legend. */
  highExample: string;
}

export interface LibraryAudienceProfile {
  id: AudienceProfileId;
  label: string;
  description: string;
  defaultThreshold: number;
  axes: AudienceAxis[];
  /** Injected into the LLM system prompt when this profile is active. */
  scopeHints: string;
  /** Rejection hints — surfaced in candidate review panel. */
  antiPatterns: string[];
}

/** Internal: validate that axis weights sum to ~1.0 (within rounding). */
function validateAxes(profile: LibraryAudienceProfile): LibraryAudienceProfile {
  const sum = profile.axes.reduce((acc, a) => acc + a.weight, 0);
  if (Math.abs(sum - 1.0) > 0.01) {
    // eslint-disable-next-line no-console
    console.warn(
      `[audience-profiles] profile ${profile.id} axis weights sum to ${sum.toFixed(3)}, expected ~1.0`,
    );
  }
  return profile;
}

// ---------------------------------------------------------------------------
// The 4 profiles. Keep in sync with docs/library/inclusion-standard.md §2.
// ---------------------------------------------------------------------------

const NOVICE: LibraryAudienceProfile = validateAxes({
  id: 'novice',
  label: '入门小白',
  description:
    '入门读者:需要打基础、建词汇、看懂方法。偏好教学型 / 范式奠基型论文。',
  defaultThreshold: 0.55,
  axes: [
    {
      name: 'pedagogical_clarity',
      label: '教学清晰度',
      weight: 0.3,
      description: '论文是否清晰定义术语、动机明确、有无示例',
      lowExample: '术语堆砌、跳过基础、假设读者已读完前 10 篇',
      highExample: '动机清晰、定义到位、例子充分',
    },
    {
      name: 'foundational_weight',
      label: '奠基性',
      weight: 0.25,
      description: '在被引、范式开创性、是否定义新基准上的权重',
      lowExample: '已知结果的边际改进',
      highExample: '高被引、开创范式或定义新基准',
    },
    {
      name: 'replicability',
      label: '可复现性',
      weight: 0.2,
      description: '是否有公开代码 + 小规模可复现',
      lowExample: '无代码、超参不透明',
      highExample: '代码公开 + 小规模可跑通',
    },
    {
      name: 'tutorial_value',
      label: '教程价值',
      weight: 0.15,
      description: '是否能用作教学材料或综述引子',
      lowExample: '单一方法贡献',
      highExample: '可作为综述/教材引子',
    },
    {
      name: 'cross_disciplinary_accessibility',
      label: '跨学科可达性',
      weight: 0.1,
      description: '跨子领域读者能否进入',
      lowExample: '需要深子领域背景',
      highExample: '桥接到邻近领域',
    },
  ],
  scopeHints:
    '读者画像:入门小白(1年级博士生 / 跨领域入门)。' +
    '优先录取:奠基性 / 教学型 / 高被引综述。' +
    '惩罚:术语密度高、假设读者已读 10 篇前置文献、benchmark 边际改进。',
  antiPatterns: [
    '需要深子领域背景才能读懂',
    '没有代码 / 超参不透明',
    '单一 benchmark +0.5% 改进的论文',
  ],
});

const EXPERT: LibraryAudienceProfile = validateAxes({
  id: 'expert',
  label: '深耕专家',
  description:
    '深耕读者:要看新机制、新理论、严谨实验。偏好真正推进 SoTA 的工作。',
  defaultThreshold: 0.75,
  axes: [
    {
      name: 'novelty',
      label: '新颖度',
      weight: 0.3,
      description: '是否引入新机制 / 新理论 / 新结果',
      lowExample: '对已知工作的重新打包',
      highExample: '引入新机制 / 理论 / 结果',
    },
    {
      name: 'empirical_rigor',
      label: '实验严谨度',
      weight: 0.2,
      description: 'baseline / 消融 / 统计检验的完备性',
      lowExample: '缺 baseline、无消融',
      highExample: '完整 baseline + 消融 + 统计检验',
    },
    {
      name: 'theoretical_depth',
      label: '理论深度',
      weight: 0.15,
      description: '是否给出可证明的界 / 收敛 / 可辨识性',
      lowExample: '纯启发、无分析',
      highExample: '可证明的界 / 收敛 / 可辨识性',
    },
    {
      name: 'open_problem_connection',
      label: '开放问题关联',
      weight: 0.15,
      description: '是否正面攻坚已知难题',
      lowExample: '解决玩具 / 小众问题',
      highExample: '正面攻坚已知难题',
    },
    {
      name: 'replicability',
      label: '可复现性',
      weight: 0.1,
      description: '代码 + 数据 + 超参透明度',
      lowExample: '闭源、超参不透明',
      highExample: '代码 + 数据 + 清晰超参',
    },
    {
      name: 'writing_precision',
      label: '写作精确度',
      weight: 0.1,
      description: '结论是否克制、有无过度声明',
      lowExample: '结论含糊、过度声明',
      highExample: '结论精确、克制的不确定性',
    },
  ],
  scopeHints:
    '读者画像:深耕领域专家(3年级以上博士生 / 博士后 / 资深研究员)。' +
    '优先录取:改变思考方式的论文(新机制、新理论、新视角)。' +
    '惩罚:benchmark 追逐而无机理解释、纯工程组合而无新洞见。',
  antiPatterns: [
    '唯一贡献是把已知方法换个 benchmark 跑一遍',
    '没有 ablation 也没有 failure case',
    '理论贡献模糊,只靠 empirical 结果',
  ],
});

const REVIEWER: LibraryAudienceProfile = validateAxes({
  id: 'reviewer',
  label: '专业审稿人',
  description:
    '审稿视角:要查方法、查基线、查消融、查过度声明。会按顶会标准审。',
  defaultThreshold: 0.65,
  axes: [
    {
      name: 'methodological_soundness',
      label: '方法严谨度',
      weight: 0.25,
      description: '实验设计是否合理、结论是否有证据支撑',
      lowExample: '方法设计有缺陷 / 结论无证据',
      highExample: '方法严谨、结论有证据',
    },
    {
      name: 'novelty_vs_prior_art',
      label: '相对新颖度',
      weight: 0.2,
      description: '相对最相近工作的差异化',
      lowExample: '他处已有、漏引',
      highExample: '相对最相近工作有清晰差异化',
    },
    {
      name: 'reproducibility',
      label: '可复现性',
      weight: 0.15,
      description: '代码 / 超参 / 算力披露',
      lowExample: '无代码、setup 不清',
      highExample: '代码 + 超参 + 算力披露',
    },
    {
      name: 'claim_calibration',
      label: '结论克制度',
      weight: 0.15,
      description: '结论与证据是否匹配、有无过度声明',
      lowExample: '过度声明("solves X")',
      highExample: '结论与证据匹配、承认不确定性',
    },
    {
      name: 'clarity',
      label: '写作清晰度',
      weight: 0.1,
      description: '结构清晰、图用得好',
      lowExample: '含糊、难跟读',
      highExample: '结构清晰、图用得好',
    },
    {
      name: 'ethical_review',
      label: '伦理 / 安全',
      weight: 0.1,
      description: '是否讨论 bias / safety / dual-use',
      lowExample: '忽略 bias / safety',
      highExample: '讨论 limitation、伦理、安全',
    },
    {
      name: 'significance',
      label: '贡献显著性',
      weight: 0.05,
      description: '对领域的实质性推进',
      lowExample: '琐碎 / 小众',
      highExample: '实质性推进领域',
    },
  ],
  scopeHints:
    '读者画像:专业论文审稿人(领域主席 / 资深审稿)。' +
    '按顶会标准审:标注缺 baseline、缺 ablation、过度声明。' +
    '奖励经得起推敲的工作,惩罚纯工程堆叠。',
  antiPatterns: [
    '声称 SOTA 但缺 baseline 对比',
    '关键 ablation 缺失',
    '只换数据集 / 换 backbone,声称方法突破',
  ],
});

const PRACTITIONER: LibraryAudienceProfile = validateAxes({
  id: 'practitioner',
  label: '工业实践者',
  description:
    '工业视角:关心能落地吗、成本多少、能 ship 吗。偏好诚实算力 + 干净代码。',
  defaultThreshold: 0.6,
  axes: [
    {
      name: 'production_readiness',
      label: '生产就绪度',
      weight: 0.25,
      description: '能否用合理工程投入部署',
      lowExample: '只跑通学术 demo',
      highExample: '合理工程投入可部署',
    },
    {
      name: 'cost_efficiency',
      label: '成本 / 效率',
      weight: 0.2,
      description: '训练 / 推理成本',
      lowExample: '1000-GPU 训练 / 单卡无法跑',
      highExample: '单卡 / 单节点可复现',
    },
    {
      name: 'latency_throughput',
      label: '延迟 / 吞吐',
      weight: 0.15,
      description: '是否报告了延迟 / 吞吐',
      lowExample: '未测延迟 / 不可用',
      highExample: '报告数字、具 SoTA 竞争力',
    },
    {
      name: 'integration_complexity',
      label: '集成复杂度',
      weight: 0.15,
      description: '依赖是否标准生态',
      lowExample: '需要自造 infra',
      highExample: 'PyTorch + HF 等标准栈',
    },
    {
      name: 'robustness',
      label: '鲁棒性',
      weight: 0.15,
      description: '分布外 / 边界 case 是否测过',
      lowExample: '分布偏移下脆弱',
      highExample: '测过 OOD + edge case',
    },
    {
      name: 'oss_quality',
      label: '开源质量',
      weight: 0.1,
      description: '代码仓、测试、CI、文档',
      lowExample: '代码 dump、无文档',
      highExample: '干净仓库 + 测试 + 例子 + CI',
    },
  ],
  scopeHints:
    '读者画像:工业实践者(研究工程师 / 应用科学家)。' +
    '优先录取:我能真正部署的工作。' +
    '惩罚:只在 OpenAI-scale 才 work、算力要求含糊、代码仓脏。',
  antiPatterns: [
    '只在大规模集群跑过、单卡无法复现',
    '算力要求含糊(只说 "trained on ...")',
    '代码无 README / 无 example / 无测试',
  ],
});

// ---------------------------------------------------------------------------
// Registry + accessors.
// ---------------------------------------------------------------------------

export const AUDIENCE_PROFILES: Record<AudienceProfileId, LibraryAudienceProfile> = {
  novice: NOVICE,
  expert: EXPERT,
  reviewer: REVIEWER,
  practitioner: PRACTITIONER,
};

export const AUDIENCE_PROFILE_IDS: AudienceProfileId[] = [
  'novice',
  'expert',
  'reviewer',
  'practitioner',
];

export function getAudienceProfile(
  id: AudienceProfileId | string | undefined | null,
): LibraryAudienceProfile | null {
  if (!id) return null;
  return AUDIENCE_PROFILES[id as AudienceProfileId] ?? null;
}

/** Build the LLM prompt addendum for a profile (or empty if none). */
export function buildAudiencePromptAddendum(
  profile: LibraryAudienceProfile | null,
): string {
  if (!profile) return '';
  const axesBlock = profile.axes
    .map(
      (a) =>
        `- ${a.name} (weight ${a.weight.toFixed(2)}): ${a.description}`,
    )
    .join('\n');
  return [
    `读者画像:${profile.label} — ${profile.description}`,
    `默认阈值:${profile.defaultThreshold} (0-1)`,
    `打分维度:\n${axesBlock}`,
    `范围提示:${profile.scopeHints}`,
    `反模式(命中应扣分):${profile.antiPatterns.join('; ')}`,
    '输出 JSON 时,除 score / reason / tldr 外,加上 axes 字段: { axis_name: 1-5 整数 }',
  ].join('\n');
}

/** Resolve the effective threshold for a library given its definition. */
export function resolveLibraryThreshold(args: {
  profile: LibraryAudienceProfile | null;
  userThreshold: number | undefined;
}): number {
  if (typeof args.userThreshold === 'number' && args.userThreshold >= 0) {
    return args.userThreshold;
  }
  return args.profile?.defaultThreshold ?? 0.5;
}
