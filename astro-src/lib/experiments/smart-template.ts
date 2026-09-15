// astro-src/lib/experiments/smart-template.ts
//
// R7 E.2.1: SMART hypothesis template.
//
// SMART = Specific / Measurable / Achievable / Relevant / Time-bound.
// 用户点击按钮,把模板填进 textarea,然后在每个章节里填具体内容。
//
// 设计要点:
//   - 模板里所有占位都用 `[方括号]`,方便 IDE / 用户一眼识别要改的位置
//   - 中文标签,匹配站点其他 hypothesis UI(中文 hypothesis)
//   - 包含「Hypothesis Statement」总结行,确保写完后能提炼成一句话
//
// 用法:
//   const text = renderSmartHypothesisTemplate();
//   textarea.value = text;

export const SMART_HYPOTHESIS_MARKDOWN = `## SMART Hypothesis

### Specific(具体)
[明确描述要验证的因果关系 / 现象 / 边界条件]

### Measurable(可测量)
- 自变量:[变量 1] / [变量 2]
- 因变量:[度量 1] / [度量 2]
- 评估指标:[例如 accuracy、F1、human eval 等]

### Achievable(可实现)
- 数据来源:[数据集 / 论文 / 现有 corpus]
- 现有条件:[算力 / 人力 / 时间预算]
- 关键技术风险:[列出 1-2 个最可能堵住的点]

### Relevant(相关)
- 上游研究意义:[与哪些 paper / 项目 / 你的 thesis 相关]
- 下游应用:[验证成功后能解锁什么]

### Time-bound(有时限)
- 预期完成时间:[例如 4 周]
- 里程碑:[M1: … / M2: … / M3: …]

## Hypothesis Statement
[用一句话陈述可证伪的假设,例如:"在 X 数据集上,Y 方法相对 baseline Z 在指标 W 上提升 ≥ 5%。"]
`;

/** 拿 SMART 模板原文(纯字符串,UI 直接写入 textarea)。 */
export function renderSmartHypothesisTemplate(): string {
  return SMART_HYPOTHESIS_MARKDOWN;
}

/**
 * 把模板套到一个目标(form / fieldMap)上 —— 跟 idea-templates 的
 * applyIdeaTemplate 同样的双形态签名。
 *
 * 默认 selector 是 `#exp-hypothesis`(astro-src/pages/experiments/index.astro 里
 * 已存在的字段)。找不到时直接返回 ok=false,让 UI 走 fallback。
 */
export function applySmartHypothesisTemplate(
  target: HTMLFormElement | { hypothesis?: HTMLTextAreaElement | null; hypothesisZh?: HTMLTextAreaElement | null } | null | undefined,
  opts: { alsoFillZh?: boolean } = {},
): { applied: boolean; reason?: string } {
  if (!target) return { applied: false, reason: 'no target' };

  const text = renderSmartHypothesisTemplate();

  let hypEl: HTMLTextAreaElement | null = null;
  let hypZhEl: HTMLTextAreaElement | null = null;
  if (typeof (target as HTMLFormElement).querySelector === 'function') {
    const form = target as HTMLFormElement;
    hypEl = form.querySelector<HTMLTextAreaElement>('#exp-hypothesis, [name="hypothesis"]');
    if (opts.alsoFillZh) {
      hypZhEl = form.querySelector<HTMLTextAreaElement>('#exp-hypothesis-zh, [name="hypothesisZh"]');
    }
  } else {
    const fields = target as { hypothesis?: HTMLTextAreaElement | null; hypothesisZh?: HTMLTextAreaElement | null };
    hypEl = fields.hypothesis ?? null;
    if (opts.alsoFillZh) hypZhEl = fields.hypothesisZh ?? null;
  }

  if (!hypEl && !hypZhEl) {
    return { applied: false, reason: 'no hypothesis field found' };
  }
  // 只有空才填,避免覆盖用户已经写好的内容
  if (hypEl && !hypEl.value) hypEl.value = text;
  if (hypZhEl && !hypZhEl.value) {
    // 中文 hypothesis 给一个简短引导版本
    hypZhEl.value = '## 实验假设(中文)\n\n[用 1-2 句话概括 SMART 各章节要点,最终落到一句可证伪的陈述]';
  }
  return { applied: true };
}