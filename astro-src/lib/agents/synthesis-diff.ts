/**
 * lib/agents/synthesis-diff.ts — typed mirror of synthesis-diff.mjs (iter #66).
 *
 * Phase A shim pattern(同 export-bundle / paper-compiler / synthesis-pdf)。
 */

export interface SynthesisDiffInput {
  idx: number;
  raw: string;
}

export interface StripFrontmatterResult {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface SynthesisDiffMeta {
  titleA: string | null;
  titleB: string | null;
  generatedAtA: string | null;
  generatedAtB: string | null;
  modelA: string | null;
  modelB: string | null;
  roundsSynthesizedA: number | null;
  roundsSynthesizedB: number | null;
  deliverablesReferencedA: number | null;
  deliverablesReferencedB: number | null;
  uniquePapersA: number | null;
  uniquePapersB: number | null;
}

export interface SynthesisDiffMetaDelta {
  generatedAtDeltaMs: number | null;
  roundsSynthesizedDelta: number | null;
  deliverablesReferencedDelta: number | null;
  uniquePapersDelta: number | null;
  modelChanged: boolean;
  titleChanged: boolean;
}

export interface SynthesisDiffBody {
  wordCountA: number;
  wordCountB: number;
  wordCountDelta: number;
  topicsAdded: string[];
  topicsRemoved: string[];
  topicsShared: string[];
  refsRefIdsAdded: string[];
  refsRefIdsRemoved: string[];
  refsRefIdsShared: string[];
  similarity: number;
}

export interface SynthesisDiffStats {
  topicsAdded: number;
  topicsRemoved: number;
  topicsShared: number;
  refsAdded: number;
  refsRemoved: number;
  refsShared: number;
  similarity: number;
}

export interface SynthesisDiff {
  idxA: number;
  idxB: number;
  meta: SynthesisDiffMeta;
  metaDelta: SynthesisDiffMetaDelta;
  body: SynthesisDiffBody | null;
  stats: SynthesisDiffStats;
}

export interface DiffSynthesesOpts {
  includeBody?: boolean;
}

export {
  stripFrontmatter,
  extractSynthesisTopics,
  extractSynthesisRefIds,
  countWords,
  diffSyntheses,
  formatSynthesisDiffText,
} from './synthesis-diff.mjs';