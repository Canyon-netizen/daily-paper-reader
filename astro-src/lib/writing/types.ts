// /lib/writing/types.ts — Writing module TypeScript types.
//
// Types derived from design-final.md:
//   - WritingType: 'paper' | 'section' | 'note' | 'review' | 'translation'
//   - WritingStatus: 'draft' | 'review' | 'final'
//   - Writing: main interface with sections, citations, versions

/** Reference to a paper by canonical arXiv ID (no /vN suffix) */
export interface PaperRef {
  arxivId: string;
  context?: string;  // Why this paper is relevant (for UI)
}

export type WritingType = 'paper' | 'section' | 'note' | 'review' | 'translation';
export type WritingStatus = 'draft' | 'review' | 'final' | 'submitted' | 'accepted' | 'rejected' | 'published';

export interface WritingSection {
  id: string;
  title: string;
  content: string;  // markdown
  order: number;
}

export interface WritingVersion {
  content: string;
  savedAt: number;
}

export interface Writing {
  /** kebab-case slug */
  id: string;
  /** Title */
  title: string;
  /** Writing type */
  type: WritingType;
  /** Status */
  status: WritingStatus;
  /** Target venue (journal/conference/blog name) */
  targetVenue?: string;
  /** Abstract */
  abstract?: string;
  /** Section structure */
  sections: WritingSection[];
  /** Cited paper IDs (canonical arxiv IDs) */
  citedPapers: PaperRef[];
  /** Related idea IDs */
  relatedIdeas: string[];
  /** Related experiment IDs */
  relatedExperiments: string[];
  /** Word count (auto-calculated) */
  wordCount: number;
  /** Version history */
  versions: WritingVersion[];
  createdAt: number;
  updatedAt: number;
}

export interface WritingsDoc {
  schemaVersion: 1;
  writings: Record<string, Writing>;
}

// Status display helpers
export const WRITING_STATUS_LABELS: Record<WritingStatus, string> = {
  draft: '草稿',
  review: '审核中',
  final: '已完成',
  submitted: '已提交',
  accepted: '已接收',
  rejected: '已拒绝',
  published: '已发表',
};

export const WRITING_TYPE_LABELS: Record<WritingType, string> = {
  paper: '论文',
  section: '章节',
  note: '笔记',
  review: '综述',
  translation: '翻译',
};

// Default section structure for new writings
export const DEFAULT_SECTIONS: WritingSection[] = [
  { id: 'abstract', title: '摘要', content: '', order: 0 },
  { id: 'introduction', title: '引言', content: '', order: 1 },
  { id: 'method', title: '方法', content: '', order: 2 },
  { id: 'experiments', title: '实验', content: '', order: 3 },
  { id: 'results', title: '结果', content: '', order: 4 },
  { id: 'discussion', title: '讨论', content: '', order: 5 },
  { id: 'conclusion', title: '结论', content: '', order: 6 },
  { id: 'references', title: '参考文献', content: '', order: 7 },
];
