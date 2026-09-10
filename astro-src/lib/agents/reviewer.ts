/**
 * lib/agents/reviewer.ts — typed mirror of reviewer.mjs (iter #71).
 *
 * Phase A shim pattern(同 export-bundle / paper-compiler / synthesis-pdf /
 * synthesis-diff / evaluator / web-search / pipeline):.mjs 是 runtime 真相源,
 * .ts 只声明 type contract + re-export。
 */

export type ReviewPersona = 'methodologist' | 'engineer' | 'skeptic';
export type ReviewRecommendation = 'accept' | 'weak_accept' | 'revise' | 'weak_reject' | 'reject';
export type ConcernSeverity = 'major' | 'minor';
export type ConcernCategory = 'novelty' | 'soundness' | 'clarity' | 'experiments' | 'writing';

export interface ReviewConcern {
  severity: ConcernSeverity;
  persona: ReviewPersona;
  category: ConcernCategory;
  claim: string;
  detail: string;
}

export interface ReviewScores {
  novelty: number;
  soundness: number;
  clarity: number;
  experiments: number;
  writing: number;
  overall: number;
}

export interface ReviewVerdict {
  draftId: string | null;
  recommendation: ReviewRecommendation;
  scores: ReviewScores;
  concerns: ReviewConcern[];
  summary: string;
  model: string;
  generatedAt: number;
  stub: boolean;
}

export interface ReviewDraftInput {
  title?: string;
  abstract?: string;
  body: string;
  arxivIds?: string[];
}

export interface ReviewCaller {
  callLLM(opts: {
    system: string;
    user: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
  }): Promise<string>;
}

export interface ReviewOpts {
  caller?: ReviewCaller;
  draftId?: string;
  model?: string;
}

export {
  REVIEW_PERSONAS,
  REVIEW_RECOMMENDATIONS,
  reviewDraft,
  formatReviewText,
  toJSON,
} from './reviewer.mjs';
