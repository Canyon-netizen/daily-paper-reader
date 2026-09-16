// astro-src/lib/concepts/draft.ts
//
// R7 G.3.1: concept 创建 UI 的后端逻辑(draft validation + YAML snippet render)。
//
// 这层是纯函数,不依赖文件系统:
//   - validateConceptDraft(draft, existingSlugs) → {errors, warnings}
//   - renderConceptYamlSnippet(draft) → string (YAML array 元素,可直接复制)

export interface ConceptDraft {
  slug: string;
  display_name: string;
  category: string;
  /** 0..1,可选 */
  novelty?: number;
  /** 0..1,可选 */
  centrality?: number;
  /** 父 concept slug,可选 */
  parent?: string;
  /** 引用此概念的 arxiv id 列表(可空 — 还没引用也能先建) */
  arxivIds?: string[];
  /** 备注(目前不写入 frontmatter,只显示在 UI) */
  description?: string;
}

export interface DraftValidation {
  errors: string[];
  warnings: string[];
}

// kebab-case slug:小写字母 + 数字 + 中划线
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// arxiv id:YYMM.NNNNN(vN 可选)
const ARXIV_RE = /^\d{4}\.\d{4,5}(v\d+)?$/;

/** 校验草稿:返回错误 + 警告列表。 */
export function validateConceptDraft(
  draft: ConceptDraft,
  existingSlugs: readonly string[] = [],
): DraftValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // slug
  if (!draft.slug) {
    errors.push('slug 必填');
  } else if (!SLUG_RE.test(draft.slug)) {
    errors.push(`slug 必须是 kebab-case(小写字母/数字/中划线): "${draft.slug}"`);
  } else if (existingSlugs.includes(draft.slug)) {
    errors.push(`slug "${draft.slug}" 已存在,会覆盖现有 concept`);
  }

  // display_name
  if (!draft.display_name) {
    errors.push('显示名必填');
  } else if (draft.display_name.length > 80) {
    warnings.push(`显示名较长(${draft.display_name.length} 字符),考虑精简`);
  }

  // category
  const knownCats = new Set([
    'method', 'problem', 'dataset', 'metric',
    'methodology', 'task', 'other',
  ]);
  if (!draft.category) {
    errors.push('category 必填');
  } else if (!knownCats.has(draft.category)) {
    warnings.push(`category "${draft.category}" 非标准值,标准: ${[...knownCats].join(', ')}`);
  }

  // novelty / centrality
  if (draft.novelty !== undefined) {
    if (!Number.isFinite(draft.novelty)) errors.push('novelty 必须是数字');
    else if (draft.novelty < 0 || draft.novelty > 1) errors.push('novelty 必须在 0..1');
  }
  if (draft.centrality !== undefined) {
    if (!Number.isFinite(draft.centrality)) errors.push('centrality 必须是数字');
    else if (draft.centrality < 0 || draft.centrality > 1) errors.push('centrality 必须在 0..1');
  }

  // parent
  if (draft.parent && !SLUG_RE.test(draft.parent)) {
    warnings.push(`parent slug "${draft.parent}" 不是 kebab-case`);
  } else if (draft.parent && existingSlugs.length > 0 && !existingSlugs.includes(draft.parent)) {
    warnings.push(`parent slug "${draft.parent}" 在现有 concept 中找不到,确认是否要先建父节点`);
  }

  // arxiv ids
  if (draft.arxivIds && draft.arxivIds.length > 0) {
    for (const id of draft.arxivIds) {
      if (!ARXIV_RE.test(id)) {
        warnings.push(`arxiv id 格式可疑: "${id}"(期望 YYMM.NNNNN 或 YYMM.NNNNNvN)`);
      }
    }
  }

  return { errors, warnings };
}

/** 把 draft 渲染成 YAML 数组片段(单条 — 直接贴在 concepts: [...] 下)。
 *
 *  输出形如:
 *    - slug: activation-steering
 *      display_name: Activation Steering
 *      category: method
 *      novelty: 0.8
 *      centrality: 0.7
 *
 *  如果有 arxivIds,会附带 `paper_ids:` 段:
 *    - slug: ...
 *      ...
 *      paper_ids:
 *        - 2506.12345
 */
export function renderConceptYamlSnippet(draft: ConceptDraft): string {
  const lines: string[] = [];
  lines.push(`- slug: ${draft.slug || '<slug>'}`);
  lines.push(`  display_name: ${yamlString(draft.display_name || '<display_name>')}`);
  lines.push(`  category: ${draft.category || 'method'}`);

  if (draft.novelty !== undefined && Number.isFinite(draft.novelty)) {
    lines.push(`  novelty: ${draft.novelty}`);
  }
  if (draft.centrality !== undefined && Number.isFinite(draft.centrality)) {
    lines.push(`  centrality: ${draft.centrality}`);
  }
  if (draft.parent) {
    lines.push(`  parent: ${draft.parent}`);
  }
  if (draft.arxivIds && draft.arxivIds.length > 0) {
    lines.push(`  paper_ids:`);
    for (const id of draft.arxivIds) {
      lines.push(`    - ${id}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// internal
// ---------------------------------------------------------------------------

/** YAML 字符串:含特殊字符的用双引号 + 转义;否则直接输出。 */
function yamlString(s: string): string {
  if (s === '') return '""';
  // 含特殊字符 → 引号
  if (/[:#&*?|<>=!%@`,{}\[\]\n"]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}