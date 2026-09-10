/**
 * lib/agents/export-bundle.ts — Typed mirror of export-bundle.mjs (iter #60)
 *
 * 与项目 Phase A shim 策略一致:.ts 是类型层 + 重新 export 运行时(.mjs);
 * Node CLI + 浏览器 ESM 都直接 import .mjs 拿实现,避免双重实现 drift。
 *
 * 设计:
 *   - 类型定义(SessionMeta / RoundRecord / ExportBundle 等)集中在本文件
 *   - 运行时函数 buildExportBundle / formatExportMarkdown 通过 re-export
 *     从 .mjs 镜像 import,保证单一真相源
 *   - TS caller (orchestrator.ts / 未来的 evaluator agent 等) 可用:
 *       import { buildExportBundle, formatExportMarkdown, type ExportBundle }
 *         from '../agents/export-bundle';
 *
 * 跑法:node --test tests/test_agents_export_bundle_ts.mjs
 */

// ---------------------------------------------------------------------------
// 类型:export bundle 数据契约
// ---------------------------------------------------------------------------

export interface SessionMeta {
  session_id: string;
  goal?: string;
  created_at?: number;
  rounds_requested?: number | null;
  preset?: 'conservative' | 'balanced' | 'aggressive';
  dry_run?: boolean;
  [k: string]: unknown;
}

export interface RoundRecordSummary {
  round: number;
  started_at?: number;
  finished_at?: number;
  designer: {
    proposals: Array<{
      id?: string;
      title?: string;
      type?: string;
      rationale?: string;
      estimated_effort?: 'low' | 'medium' | 'high';
      risk?: string;
      [k: string]: unknown;
    }>;
    model?: string;
  };
  feedback: {
    critiques: Array<{
      proposal_id: string;
      total?: number;
      elo?: number;
      matches?: number;
      wins?: number;
      [k: string]: unknown;
    }>;
    judge_calls?: number;
    total_tokens?: number;
  };
  gate: {
    promoted?: string[];
    candidate?: string[];
    sketch?: string[];
    rejected?: string[];
  };
  modifier: {
    applied: Array<{
      kind: string;
      proposal_id: string;
      [k: string]: unknown;
    }>;
    skipped?: Array<{ proposal_id: string; reason: string }>;
  };
}

export interface SynthesisItem {
  idx: number;
  raw: string;
}

export interface ExportBundleStats {
  rounds: number;
  proposals: number;
  applied: number;
  syntheses: number;
  hasDigest: boolean;
}

export interface ExportBundle {
  sessionId: string;
  generatedAt: string;
  meta: SessionMeta | null;
  rounds: RoundRecordSummary[];
  syntheses: SynthesisItem[];
  digest: string | null;
  stats: ExportBundleStats;
}

export interface ExportBundleInput {
  meta?: SessionMeta | null;
  rounds?: RoundRecordSummary[];
  syntheses?: SynthesisItem[];
  digest?: string | null;
}

// ---------------------------------------------------------------------------
// 运行时:从 .mjs 镜像 re-export(单一真相源,无 drift 风险)
// ---------------------------------------------------------------------------

export { buildExportBundle, formatExportMarkdown } from './export-bundle.mjs';
