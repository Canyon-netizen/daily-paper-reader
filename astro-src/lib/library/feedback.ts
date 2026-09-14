// astro-src/lib/library/feedback.ts
//
// Library feedback collection — lightweight in-browser telemetry for
// library operations. Records what the user does + occasional asks, so
// the multi-dimensional inclusion standard can be calibrated against
// actual user behavior.
//
// Storage:
//   localStorage key: 'dpr_library_feedback_v1'
//   schemaVersion: 1
//   shape: { schemaVersion, entries: FeedbackEntry[] }
//
// Design choices (per docs/library/inclusion-standard.md §5):
//   - 零网络请求,完全本地,符合 DPR 单人静态站约束
//   - FIFO 截断 5000 条,避免 localStorage 配额撑爆
//   - 不写 IP / UA / 等任何 PII
//   - 用户可在 /settings/ 一键清空
//   - 导出按钮:导出 JSON,便于用户在 Discord / GitHub 提反馈
//
// 与 dpr_user_libraries_v1 / dpr_user_library_v1 完全解耦 —— 后两者
// 是用户态真值,feedback 是审计/改进信号。混在一起会让 Gist 同步逻辑
// 复杂化。

import { canonicalArxivId } from '../arxiv';
import { emitDprLibraryFeedback } from '../events/bus';

export type FeedbackKind =
  | 'library_created'
  | 'library_deleted'
  | 'library_profile_changed'
  | 'library_threshold_changed'
  | 'paper_included'
  | 'paper_excluded'
  | 'paper_marked_irrelevant'
  | 'candidate_score_too_low'
  | 'candidate_score_too_high'
  | 'paper_reading_status_changed'
  | 'feedback_note';

export interface FeedbackEntry {
  id: string;
  kind: FeedbackKind;
  /** epoch ms */
  at: number;
  /** For library-scoped events. */
  libraryId?: string;
  /** canonical arxiv id, for paper-scoped events. */
  arxivId?: string;
  /** Numeric payload (e.g. LLM score, threshold). */
  value?: number;
  /** Free text payload (e.g. user note). Capped to 500 chars at write site. */
  text?: string;
  /** Snapshot of profile at the time, for retroactive analysis. */
  audienceProfile?: 'novice' | 'expert' | 'reviewer' | 'practitioner';
}

export interface LibraryFeedbackDoc {
  schemaVersion: 1;
  entries: FeedbackEntry[];
}

const STORAGE_KEY = 'dpr_library_feedback_v1';
const MAX_ENTRIES = 5000;
const MAX_TEXT = 500;

function readDoc(): LibraryFeedbackDoc {
  if (typeof localStorage === 'undefined') {
    return { schemaVersion: 1, entries: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { schemaVersion: 1, entries: [] };
    const parsed = JSON.parse(raw) as Partial<LibraryFeedbackDoc>;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
      return { schemaVersion: 1, entries: [] };
    }
    return { schemaVersion: 1, entries: parsed.entries };
  } catch {
    return { schemaVersion: 1, entries: [] };
  }
}

function writeDoc(doc: LibraryFeedbackDoc): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // FIFO 截断
    if (doc.entries.length > MAX_ENTRIES) {
      doc.entries = doc.entries.slice(doc.entries.length - MAX_ENTRIES);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // quota or serialization error — drop silently, telemetry must not break UX
  }
}

function makeId(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

/**
 * Record one feedback entry. Safe to call from anywhere; failures are swallowed.
 *
 * @example
 *   recordFeedback({ kind: 'paper_excluded', libraryId, arxivId, value: 0.62, text: 'off-topic' });
 */
export function recordFeedback(
  args: Omit<FeedbackEntry, 'id' | 'at'> & { at?: number },
): void {
  const entry: FeedbackEntry = {
    id: makeId(),
    at: args.at ?? Date.now(),
    kind: args.kind,
    libraryId: args.libraryId,
    arxivId: args.arxivId ? canonicalArxivId(args.arxivId) : undefined,
    value: typeof args.value === 'number' ? args.value : undefined,
    text:
      typeof args.text === 'string'
        ? args.text.slice(0, MAX_TEXT)
        : undefined,
    audienceProfile: args.audienceProfile,
  };
  const doc = readDoc();
  doc.entries.push(entry);
  writeDoc(doc);
  // 广播(让 settings 页面刷新角标);失败不阻断主流程
  try {
    emitDprLibraryFeedback(document, {
      kind: entry.kind,
      libraryId: entry.libraryId,
      arxivId: entry.arxivId,
      entryId: entry.id,
    });
  } catch {
    /* swallow — telemetry must never break UX */
  }
}

/** Read all entries (read-only copy). */
export function listFeedback(): FeedbackEntry[] {
  return readDoc().entries.slice();
}

/** Clear all feedback. Returns the number of entries removed. */
export function clearFeedback(): number {
  const doc = readDoc();
  const n = doc.entries.length;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* swallow */
    }
  }
  return n;
}

/**
 * Export feedback as JSON string for sharing (Discord / GitHub issue).
 * Includes a small header so recipients can identify what they're seeing.
 */
export function exportFeedbackJson(): string {
  const doc = readDoc();
  return JSON.stringify(
    {
      ...doc,
      exportedAt: new Date().toISOString(),
      note:
        'DPR library feedback log. No PII. ' +
        'Open https://github.com/<repo>/issues to share.',
    },
    null,
    2,
  );
}

/** Aggregate counts by kind, useful for settings UI badge. */
export function countByKind(): Record<FeedbackKind, number> {
  const empty: Record<FeedbackKind, number> = {
    library_created: 0,
    library_deleted: 0,
    library_profile_changed: 0,
    library_threshold_changed: 0,
    paper_included: 0,
    paper_excluded: 0,
    paper_marked_irrelevant: 0,
    candidate_score_too_low: 0,
    candidate_score_too_high: 0,
    paper_reading_status_changed: 0,
    feedback_note: 0,
  };
  for (const e of readDoc().entries) {
    empty[e.kind] = (empty[e.kind] ?? 0) + 1;
  }
  return empty;
}
