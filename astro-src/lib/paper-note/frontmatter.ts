// /lib/paper-note/frontmatter.ts — 把 AnalysisResult + ArxivEntry 拼成 markdown frontmatter 行。
//
// 字段顺序与 docs/20260625-20260704/*.md 保持一致(参见 sample 2606.26474v1)。
// 修改一处字段,glance 与 combined 两份笔记都会一起跟着走。
//
// 集中理由:
//   - paper-analyzer.ts 3000+ 行,frontmatter 拼装是 100% 纯函数逻辑,
//     抽出让 buildMarkdownNote / buildCombinedNote 留作 orchestrator;
//   - 同时让 Python 端 src/6.generate_docs.py:build_categories_dict 的 shape 对照
//     单元化,跨端字段对齐时只改这一处。

import type { ArxivEntry } from '../arxiv-entry';
import type { NoteAnalysisInput } from './types';
import { buildCategories, type Categories } from '../schemas';
import {
  categoriesToYamlInline as renderCategoriesYamlInline,
} from '../taxonomies';
import { stripTitleMarkup } from '../title';

/** 把含特殊字符(: , # 等)的字符串安全 YAML 引用:反斜杠 / 双引号 / 换行 全部转义。 */
function yamlStr(s: string): string {
  return `"${(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

/**
 * 拼 frontmatter 行数组(每行 string 或 null,null 字段会被 caller filter 掉)。
 *
 * 返回类型 `Array<string | null>` 允许 null 字段占位;`buildMarkdownNote / buildCombinedNote`
 * 在 caller 侧做 `.filter((l): l is string => l !== null)`。
 *
 * 字段集与 docs 取样保持向后兼容:
 *   - title / title_plain / authors / date / generated_at
 *   - pdf / categories(score=7.0 占位, source:arxiv, selection_source:web_analyzer)
 *   - score / evidence / tldr / motivation / method / result / conclusion / context
 */
export function buildFrontmatter(
  r: NoteAnalysisInput,
  entry: ArxivEntry | null,
  now: string,
): Array<string | null> {
  const arxivId = entry?.arxivId || '';
  const pdfUrl = entry?.pdfUrl || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : '');
  const cats: Categories = (r.categories && !Array.isArray(r.categories))
    ? (r.categories as Categories)
    : buildCategories({});
  const titleEn = r.title_en || r.title || '(untitled)';
  const titlePlain = stripTitleMarkup(titleEn);
  return [
    '---',
    `title: ${yamlStr(titleEn)}`,
    // 纯文本标题:仅当与原值不同时 emit(避免冗余)
    titlePlain && titlePlain !== titleEn ? `title_plain: ${yamlStr(titlePlain)}` : null,
    r.authors ? `authors: ${yamlStr(r.authors)}` : null,
    arxivId ? `date: ${(entry?.published || now).slice(0, 10)}` : null,
    `generated_at: ${yamlStr(now)}`,
    pdfUrl ? `pdf: ${yamlStr(pdfUrl)}` : null,
    `categories: ${renderCategoriesYamlInline(cats)}`,
    `score: 7.0`,
    r.motivation ? `evidence: ${yamlStr(r.motivation.slice(0, 60))}` : null,
    r.tldr ? `tldr: ${yamlStr(r.tldr)}` : null,
    'source: arxiv',
    'selection_source: web_analyzer',
    r.motivation ? `motivation: ${yamlStr(r.motivation)}` : null,
    r.method ? `method: ${yamlStr(r.method)}` : null,
    r.result ? `result: ${yamlStr(r.result)}` : null,
    r.conclusion ? `conclusion: ${yamlStr(r.conclusion)}` : null,
    r.context ? `context: ${yamlStr(r.context)}` : null,
    '---',
  ];
}

/**
 * slugify — 把 title 转 URL-safe kebab-case;无 ASCII 字串时回退用 arxivId。
 *
 * 与 lib/title.ts::paperPlainTitle 的差别:
 *   - paperPlainTitle:剥 markdown / inline TeX 留"人可读"标题(中文也保);
 *   - slugifyTitle:纯 ascii 化做 URL/filename 用,中文会丢失。
 */
export function slugifyTitle(title: string, arxivId: string): string {
  // arxivId 已经含版本号 + 短 hash,适合作为 slug 主干
  // 如果需要更"人类可读"的标题 slug,可以再附加 title 的 ascii 化短串
  const ascii = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  if (ascii) return ascii;
  // fallback:纯 ascii kebab-case,只保留 [a-z0-9],把 "." 和 "v" 都替换成 "-"
  // (yml 校验 ^[a-z0-9-]{1,80}$ 不允许 ".",而 arxivId 形如 2606.30015v1 含点和 v)
  return arxivId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'paper';
}