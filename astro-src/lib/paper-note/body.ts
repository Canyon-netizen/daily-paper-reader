// /lib/paper-note/body.ts — 速读 / 精读 .md 正文生成。
//
// buildMarkdownNote  → 仅速读(frontmatter + TLDR + 动机 / 方法 / 结果 / 结论 / 主题语境)
// buildCombinedNote  → 速读 + 精读全文(用 --- 分隔的 ## 深度精读 章节)
//
// 与 Python 端 save-paper.yml:286-292 旧版的格式对齐,方便以后 backend
// 写出的 .md 和 web 写出的 .md 在文档结构上一致。

import type { ArxivEntry } from '../arxiv-entry';
import type { NoteAnalysisInput, DeepDiveMeta } from './types';
import { buildFrontmatter } from './frontmatter';

/** 速读正文块(TLDR / Abstract / 动机/方法/结果/结论/主题语境)。 */
export function buildSpeedReadBody(r: NoteAnalysisInput, entry: ArxivEntry | null): string {
  const bodyParts: string[] = [];
  if (r.tldr) bodyParts.push(`## TLDR\n${r.tldr}`);
  if (entry?.summary) bodyParts.push(`## Abstract\n${entry.summary}`);
  if (r.motivation) bodyParts.push(`## 动机\n${r.motivation}`);
  if (r.method) bodyParts.push(`## 方法\n${r.method}`);
  if (r.result) bodyParts.push(`## 结果\n${r.result}`);
  if (r.conclusion) bodyParts.push(`## 结论\n${r.conclusion}`);
  if (r.context) bodyParts.push(`## 主题语境\n${r.context}`);
  return bodyParts.length ? '\n' + bodyParts.join('\n\n') + '\n' : '';
}

/**
 * 精读 banner(显示在 `## 深度精读` 标题正下方,告诉读者这篇精读是哪个 model 生成的、
 * 是否截断过 PDF)。
 * truncated 时给个"前 N%"提示;N 按 model context window 算出的可用字符占 PDF 总字符的比例
 * —— 跟 save-paper.yml 拼 deep_block 时的 truncate_note 公式保持一致。
 */
export function buildDeepDiveBanner(d: DeepDiveMeta): string {
  let truncateNote = '全文';
  if (d.truncated) {
    const availableChars = Math.min(800_000, d.contextTokens * 3 - 16_000 * 3);
    const pct = d.pdfChars > 0 ? Math.round((availableChars / d.pdfChars) * 100) : 0;
    truncateNote = `前 ${pct}%`;
  }
  const modelLine = d.usedModel ? ' · 模型: ' + d.usedModel : '';
  return `> 基于 PDF 全文生成${modelLine} · ${truncateNote}\n\n`;
}

/** 完整速读 .md(frontmatter + 速读正文)。 */
export function buildMarkdownNote(r: NoteAnalysisInput, entry: ArxivEntry | null): string {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const fm = buildFrontmatter(r, entry, now);
  const body = buildSpeedReadBody(r, entry);
  return fm.filter((l): l is string => l !== null).join('\n') + '\n' + body + '\n';
}

/**
 * combined .md:frontmatter + 速读四段 + Abstract + 精读全文。
 * 跟旧 "📥 save 精读" 路径对比:不再依赖"先点过 📤" — 一次完成。
 */
export function buildCombinedNote(
  r: NoteAnalysisInput,
  entry: ArxivEntry,
  deepDive: DeepDiveMeta,
): string {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const fm = buildFrontmatter(r, entry, now);
  const speedRead = buildSpeedReadBody(r, entry).trimEnd();
  // 精读章节用 `---` 分隔,跟旧 save-paper.yml 写入时的格式一致(append-deepdive 步骤里
  // 拼的是 '\n\n---\n\n## 深度精读\n\n' + banner + deep)。
  const banner = buildDeepDiveBanner(deepDive);
  const deepSection = `\n\n---\n\n## 深度精读\n\n${banner}${deepDive.markdown}\n`;
  return fm.filter((l): l is string => l !== null).join('\n')
    + '\n' + speedRead
    + deepSection;
}