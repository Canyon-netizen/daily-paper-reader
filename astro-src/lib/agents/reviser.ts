/**
 * lib/agents/reviser.ts — typed mirror of reviser.mjs (iter #71).
 *
 * Phase A shim pattern(同 export-bundle / paper-compiler / synthesis-pdf /
 * synthesis-diff / evaluator / web-search / pipeline / reviewer):.mjs 是
 * runtime 真相源,.ts 只声明 type contract + re-export。
 */

import type { ReviewVerdict } from './reviewer';

export type RevisionStatus = 'addressed' | 'partial' | 'not_addressed';

export interface RevisionLogEntry {
  concernIdx: number;
  severity: 'major' | 'minor';
  category: string;
  status: RevisionStatus;
  change: string;
}

export interface RevisionVerdict {
  draftId: string | null;
  body: string;
  log: RevisionLogEntry[];
  addressedCount: number;
  partialCount: number;
  notAddressedCount: number;
  generatedAt: number;
  stub: boolean;
}

export interface RevisionOpts {
  caller?: {
    callLLM(opts: {
      system: string;
      user: string;
      model?: string;
      temperature?: number;
      max_tokens?: number;
    }): Promise<string>;
  };
  draftId?: string;
  model?: string;
}

export {
  reviseDraft,
  formatRevisionText,
  toJSON,
} from './reviser.mjs';
