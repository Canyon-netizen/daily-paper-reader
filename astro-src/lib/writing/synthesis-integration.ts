// astro-src/lib/writing/synthesis-integration.ts
//
// R7 E.3.2: writing draft ↔ synthesis integration.
//
// Synthesis(由 synthesis-diff / synthesis-pdf 输出)是一份结构化的 markdown 综述。
// 本模块把它「落」到 writing draft ——
//
//   1. importSynthesisToDraft(synthesis, writingId, opts)
//      把 synthesis 的 frontmatter 解析成 draft metadata (title / targetVenue / abstract),
//      body 拆成 sections(按 ## / ### 切),自动推算每个 section 的 suggestedWordCount
//      并加到 writing.sections(若有同 id 则 append 而不是覆盖)。
//
//   2. extractSynthesisRefIds(text) → 给 writing.citedPapers 用。
//      支持 [arXiv:2506.12345] 和 (arXiv:2506.12345) 两种风格。
//
//   3. buildDraftFromSynthesis(synthesis, opts)
//      不依赖 writingId,直接返回 { sections, citedPapers, abstract } 三元组,
//      让 UI 在 create 之前预览。
//
// 纯函数。无 localStorage 副作用。

import type { PaperRef, WritingSection, WritingType } from './types';

/** Frontmatter 解析后的 key-value map */
export interface SynthesisFrontmatter {
  [key: string]: string;
}

/** 提取 --- ... --- frontmatter,返回 { frontmatter, body }。 */
export function stripFrontmatter(text: string): { frontmatter: SynthesisFrontmatter; body: string } {
  const fm: SynthesisFrontmatter = {};
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: fm, body: text };
  const yaml = match[1];
  const body = match[2];
  for (const line of yaml.split('\n')) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    // 去引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[m[1]] = value;
  }
  return { frontmatter: fm, body };
}

/** 把 body 按 ## / ### 切成 sections(顶层 ##,子级 ### 作为子段落不切) */
export function splitIntoSections(body: string, fallbackTitle = '正文'): WritingSection[] {
  const lines = body.split('\n');
  const sections: WritingSection[] = [];
  let current: WritingSection | null = null;
  let buffer: string[] = [];
  function push() {
    if (!current) return;
    current.content = buffer.join('\n').trim();
    current.order = sections.length;
    sections.push(current);
    buffer = [];
  }
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      // flush previous
      if (current) push();
      const title = h2[1].trim();
      current = {
        id: slugify(title),
        title,
        content: '',
        order: 0,
      };
      continue;
    }
    buffer.push(line);
  }
  if (current) push();
  if (sections.length === 0) {
    sections.push({ id: 'body', title: fallbackTitle, content: body.trim(), order: 0 });
  }
  return sections;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'section';
}

/** 从 synthesis body 提取 arxiv id —— 支持 [arXiv:NNNN.NNNNN] 和 (arXiv:NNNN.NNNNN) */
const ARXIV_ID_RE = /arXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?)/gi;

export function extractSynthesisRefIds(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(ARXIV_ID_RE)) {
    const canonical = m[1].replace(/v\d+$/, '');
    ids.add(canonical);
  }
  return [...ids];
}

/** 推算 section suggestedWordCount —— 中英混合,中文按字,英文按词。 */
export function estimateSectionWords(content: string): number {
  if (!content) return 0;
  const en = (content.match(/[a-zA-Z]+/g) || []).length;
  const zh = (content.match(/[一-龥]/g) || []).length;
  return en + zh;
}

/** build 完整 draft spec —— 不写 localStorage */
export interface DraftSpec {
  title: string;
  type: WritingType;
  abstract?: string;
  sections: WritingSection[];
  citedPapers: PaperRef[];
  totalWords: number;
  source: 'synthesis';
  sourceHash: string;
}

export interface BuildDraftFromSynthesisOpts {
  type?: WritingType;
  titleOverride?: string;
  /** 若同 id section 已存在,选择 'append' / 'replace' */
  existingSections?: WritingSection[];
  mergeStrategy?: 'append' | 'replace' | 'skip';
}

/** 算 synthesis 文本的轻量 hash —— 用作 sourceHash(不引 crypto) */
function quickHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

export function buildDraftFromSynthesis(
  synthesis: string,
  opts: BuildDraftFromSynthesisOpts = {},
): DraftSpec {
  const { frontmatter, body } = stripFrontmatter(synthesis);
  const type = opts.type ?? (frontmatter.type as WritingType) ?? 'review';
  const title = opts.titleOverride ?? frontmatter.title ?? 'Untitled Draft';
  const abstract = frontmatter.abstract;
  let sections = splitIntoSections(body, frontmatter.title ?? '正文');
  const strategy = opts.mergeStrategy ?? 'append';
  if (opts.existingSections) {
    const merged: WritingSection[] = [];
    const existingById = new Map(opts.existingSections.map((s) => [s.id, s]));
    for (const s of sections) {
      const prev = existingById.get(s.id);
      if (!prev) {
        merged.push(s);
      } else if (strategy === 'replace' && prev) {
        // replace: 用新内容
        merged.push({ ...s, content: s.content });
      } else if (strategy === 'skip' && prev) {
        // skip: 保留 prev, 不合入新内容
        merged.push(prev);
        continue;
      } else {
        // append:把新内容 append 到原 content 后
        merged.push({
          ...prev,
          content: prev.content
            ? `${prev.content}\n\n${s.content}`
            : s.content,
          title: prev.title || s.title,
        });
      }
    }
    // 保留 existing 中没出现在新 sections 的
    for (const e of opts.existingSections) {
      if (!sections.find((s) => s.id === e.id)) merged.push(e);
    }
    sections = merged;
  }
  const refIds = extractSynthesisRefIds(body);
  const citedPapers: PaperRef[] = refIds.map((arxivId) => ({ arxivId }));
  const totalWords = sections.reduce((s, sec) => s + estimateSectionWords(sec.content), 0);
  return {
    title,
    type,
    abstract,
    sections,
    citedPapers,
    totalWords,
    source: 'synthesis',
    sourceHash: quickHash(synthesis),
  };
}

/** 推一份摘要摘要 —— 取 body 第一段非空文本,限 200 词 */
export function extractSynthesisAbstract(body: string, maxWords = 200): string {
  const paras = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  for (const p of paras) {
    if (p.startsWith('#')) continue;
    const words = estimateSectionWords(p);
    if (words >= 10) {
      return words > maxWords ? `${p.slice(0, maxWords)}…` : p;
    }
  }
  return '';
}

/** 给一个 draft title + synthesis 类型,推荐一个 target venue 标签 */
export function suggestTargetVenue(frontmatter: SynthesisFrontmatter): string | undefined {
  return frontmatter.venue ?? frontmatter.target ?? frontmatter.target_venue;
}