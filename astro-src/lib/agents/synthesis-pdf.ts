/**
 * lib/agents/synthesis-pdf.ts — typed mirror of synthesis-pdf.mjs (iter #63).
 *
 * Phase A shim pattern(.mjs is runtime source of truth,.ts is typed mirror
 * via re-export)。详情参考 docs/agents-workflow.md §5 + iter #54 引入的
 * mjs/ts 双 surface 共享模式(同 export-bundle / paper-compiler)。
 */

export interface SynthesisPdfMeta {
  session_id?: string;
  goal?: string;
  [key: string]: unknown;
}

export interface SynthesisInput {
  idx: number;
  raw: string;
}

export interface BuildPdfBundleInput {
  meta?: SynthesisPdfMeta | null;
  syntheses?: SynthesisInput[];
  generatedAt?: string;
}

export interface BundleSynthesis {
  idx: number;
  title: string;
  generatedAt: string;
  model: string | null;
  roundsSynthesized: number | null;
  deliverablesReferenced: number | null;
  uniquePapers: number | null;
  body: string;
  html: string;
}

export interface PdfBundle {
  sessionId: string;
  title: string;
  goal: string;
  generatedAt: string;
  meta: SynthesisPdfMeta | null;
  syntheses: BundleSynthesis[];
  stats: { syntheses: number; totalHtmlBytes: number };
}

export interface FormatPdfHtmlOpts {
  cssVariant?: 'academic' | 'compact' | 'presentation';
}

export interface StripFrontmatterResult {
  frontmatter: Record<string, unknown>;
  body: string;
}

export {
  buildPdfBundle,
  formatPdfHtml,
  buildPdfFileName,
  stripFrontmatter,
} from './synthesis-pdf.mjs';