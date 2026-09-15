// astro-src/lib/agents/deliverable-format.ts
//
// R7 F.3.1: modifier format-specific —— 给 modifier 一个「目标格式」,
// 按格式套对应的规则(section order / title length / citation style / limit)。
//
// 支持 3 种格式:
//   - arxiv:   预印本,8 sections,abstract ≤ 250 字,无 venue
//   - acl:     NLP 顶会,「Limitations / Ethics / Acknowledgments」必填,
//              references 用 author-year
//   - journal: 期刊,强调 Related Work + Discussion,abstract 可长 (≤ 500)
//
// 设计:不做 LLM 调用 —— 只是规则 + 模板。modifier 的 prompt 用这些规则
// 引导 LLM 按格式输出。

export type DeliverableFormat = 'arxiv' | 'acl' | 'journal';

export interface DeliverableFormatSpec {
  /** 显示名(中文) */
  label: string;
  /** 简短描述(给 UI 展示) */
  description: string;
  /** 期望的章节顺序(主 section list) */
  expectedSections: string[];
  /** abstract 长度上限(字) */
  abstractMaxChars: number;
  /** 是否必须包含 Limitations / Ethics 章节 */
  requiresLimitations: boolean;
  requiresEthics: boolean;
  /** 是否需要 Related Work */
  requiresRelatedWork: boolean;
  /** citation style,影响 references 格式 */
  citationStyle: 'numeric' | 'author-year';
  /** 页数 / 字数上限(可选,论文用) */
  pageLimit?: number;
  /** 备注 */
  notes?: string;
}

export const DELIVERABLE_FORMAT_SPECS: Record<DeliverableFormat, DeliverableFormatSpec> = {
  arxiv: {
    label: 'arXiv 预印本',
    description: '通用预印本格式,适合先发布再投会。8 段标准结构。',
    expectedSections: ['abstract', 'introduction', 'method', 'experiments', 'results', 'discussion', 'conclusion', 'references'],
    abstractMaxChars: 250,
    requiresLimitations: false,
    requiresEthics: false,
    requiresRelatedWork: false,
    citationStyle: 'numeric',
    pageLimit: 12,
    notes: 'preprint,可后续改投会议 / 期刊',
  },
  acl: {
    label: 'ACL 会议',
    description: 'NLP 顶会(ACL / EMNLP / NAACL 等)。需要 Limitations + Ethics。',
    expectedSections: ['abstract', 'introduction', 'related_work', 'method', 'experiments', 'results', 'discussion', 'conclusion', 'limitations', 'ethics', 'references'],
    abstractMaxChars: 250,
    requiresLimitations: true,
    requiresEthics: true,
    requiresRelatedWork: true,
    citationStyle: 'author-year',
    pageLimit: 8,
    notes: 'ACL/EMNLP/NAACL 投稿模板',
  },
  journal: {
    label: '期刊',
    description: '正式期刊投稿,abstract 可更长,Related Work + Discussion 详写。',
    expectedSections: ['abstract', 'introduction', 'related_work', 'method', 'experiments', 'results', 'discussion', 'conclusion', 'references'],
    abstractMaxChars: 500,
    requiresLimitations: false,
    requiresEthics: false,
    requiresRelatedWork: true,
    citationStyle: 'author-year',
    pageLimit: 14,
    notes: '期刊投稿模板,允许较长 abstract',
  },
};

/** 解析字符串到合法 DeliverableFormat;不是则返回 null。 */
export function parseDeliverableFormat(s: unknown): DeliverableFormat | null {
  if (typeof s !== 'string') return null;
  if (s in DELIVERABLE_FORMAT_SPECS) return s as DeliverableFormat;
  return null;
}

/** 把 sections 列表跟 expectedSections 对比,返回缺 / 多 的 section 名。 */
export function diffSections(
  format: DeliverableFormat,
  sections: readonly { id?: string; title: string }[],
): {
  missing: string[];
  extra: string[];
  /** 顺序打分:0..1,1 = 完全匹配 */
  orderScore: number;
} {
  const spec = DELIVERABLE_FORMAT_SPECS[format];
  const expected = new Set(spec.expectedSections.map((s) => s.toLowerCase()));
  const actual = new Set(sections.map((s) => (s.id || s.title).toLowerCase()));

  const missing: string[] = [];
  for (const e of expected) {
    if (!actual.has(e)) missing.push(e);
  }
  const extra: string[] = [];
  for (const a of actual) {
    if (!expected.has(a)) extra.push(a);
  }

  // 顺序打分:LCS-based
  const expSeq = spec.expectedSections.map((s) => s.toLowerCase());
  const actSeq = sections.map((s) => (s.id || s.title).toLowerCase());
  let lcs = 0;
  const m = expSeq.length, n = actSeq.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (expSeq[i - 1] === actSeq[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  lcs = dp[m][n];
  const orderScore = expSeq.length === 0 ? 1 : lcs / expSeq.length;

  return { missing, extra, orderScore };
}

/** 渲染一个「格式校验报告」,UI 可以直接展示。 */
export interface FormatValidationReport {
  format: DeliverableFormat;
  spec: DeliverableFormatSpec;
  diff: ReturnType<typeof diffSections>;
  abstractLengthOk: boolean;
  abstractLength?: number;
}

export function validateAgainstFormat(
  format: DeliverableFormat,
  doc: { abstract?: string; sections: readonly { id?: string; title: string }[] },
): FormatValidationReport {
  const spec = DELIVERABLE_FORMAT_SPECS[format];
  const abstract = doc.abstract?.trim() ?? '';
  const abstractLength = abstract.length;
  const abstractLengthOk = abstractLength > 0 && abstractLength <= spec.abstractMaxChars;
  return {
    format,
    spec,
    diff: diffSections(format, doc.sections),
    abstractLengthOk,
    abstractLength: abstractLength > 0 ? abstractLength : undefined,
  };
}