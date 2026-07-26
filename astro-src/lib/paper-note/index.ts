// /lib/paper-note/index.ts — 公开 API barrel。

export { renderDeepDiveMarkdown } from './render';
export {
  buildFrontmatter,
  slugifyTitle,
} from './frontmatter';
export {
  buildSpeedReadBody,
  buildDeepDiveBanner,
  buildMarkdownNote,
  buildCombinedNote,
} from './body';

export type {
  NoteAnalysisInput,
  DeepDiveMeta,
} from './types';