// topic-search 主题报告生成 + Markdown 序列化 —— 从 topic-search.ts 抽出（模块化重构 step 9）。
//
// 阶段 5（主题报告）相关：构造 prompt / 调 LLM / 规范化解析 / 增量更新定时器 /
// 把报告（或整份会话）拼成 Markdown 字符串给「复制/下载」。
//
// 当前会话读写走 S.getSession()；DOM 写入走本地小 helper（步骤 10 render 提取时
// 再合并持有者）。

import { loadSettings, type LLMConfig } from '../settings';
import { canonicalArxivId as canonicalId } from '../../lib/dom-utils';
import { resolveRoute } from '../../lib/llm';
import type {
  Summary,
  TopicReport,
  TopicReportDimension,
  TopicReportDimensionPaper,
  TopicReportFrontierDirection,
  TopicSession,
} from '../../lib/schemas';
import type { ResearchApproach } from '../../lib/types/topic';
import type { ResourceTier } from '../../lib/types/resource-tier';
import { getActiveReportPrompt } from './prompts';
import { callLLMRaw } from './llm-call';
import { S } from './state';
import { setStatus, clearStatus } from './status';
import { persistSession } from './store';

const RESOURCE_TIER_ENUM: ReadonlyArray<ResourceTier> = [
  'api_only',
  'single_gpu',
  'multi_gpu',
  'cluster',
  'tpu_pod',
  'unknown',
];

function normalizeResourceTier(raw: unknown): ResourceTier {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (RESOURCE_TIER_ENUM as readonly string[]).includes(s)
    ? (s as ResourceTier)
    : 'unknown';
}

function normalizeResearchApproach(raw: any): ResearchApproach | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const idea = truncReport(raw.idea, 80);
  if (!idea) return undefined;
  const pipeline: string[] = [];
  if (Array.isArray(raw.pipeline)) {
    for (const step of raw.pipeline) {
      const t = truncReport(step, 40);
      if (t) pipeline.push(t);
      if (pipeline.length >= 5) break;
    }
  }
  if (pipeline.length < 2) return undefined;
  const difficultyRaw = typeof raw.difficulty === 'string' ? raw.difficulty.toLowerCase() : '';
  const difficulty: ResearchApproach['difficulty'] =
    difficultyRaw === 'low' || difficultyRaw === 'medium' || difficultyRaw === 'high'
      ? difficultyRaw
      : 'medium';
  const weeksRaw = Number(raw.estimatedTimeWeeks);
  const estimatedTimeWeeks =
    Number.isFinite(weeksRaw) && weeksRaw >= 1 && weeksRaw <= 52 ? Math.round(weeksRaw) : undefined;
  const tiedNextStep =
    typeof raw.tiedNextStep === 'string' && raw.tiedNextStep.trim()
      ? raw.tiedNextStep.trim().slice(0, 40)
      : undefined;
  return { idea, pipeline, difficulty, estimatedTimeWeeks, tiedNextStep };
}

// 主题报告增量追加节流（同 session 内 N 篇并发完成时，8 秒内最多触发 1 次）。
export const REPORT_INC_THROTTLE_MS = 8000;
// 报告生成 LLM 重试次数。
export const REPORT_LLM_RETRY = 2;

// 把秒数格式化为人类可读:75s / 1m 23s / 1h 5m
export function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
}

// 把字符串截到 max 字符,空值返回空串。
function truncReport(s: string | undefined, max: number): string {
  const v = (s ?? '').trim();
  if (!v) return '';
  return v.length > max ? v.slice(0, max) + '…' : v;
}

// 手工规范化 LLM 输出的报告。失败边界都兜底成空串。
function normalizeReportTopic(obj: any, prev: TopicReport | undefined, mode: 'full' | 'incremental'): TopicReport | null {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.dimensions)) return null;
  const normDim = (d: any): TopicReportDimension | null => {
    const name = String(d?.name ?? '').trim().slice(0, 30);
    if (!name) return null;
    const papers: TopicReportDimensionPaper[] = [];
    if (Array.isArray(d?.papers)) {
      for (const p of d.papers) {
        const id = canonicalId(String(p?.arxivId ?? '').trim());
        const key = truncReport(p?.key, 120);
        if (!id || !key) continue;
        const role = truncReport(p?.role, 24) || '相关';
        papers.push({
          arxivId: id,
          role,
          key,
          method: p?.method ? truncReport(p.method, 120) : undefined,
          result: p?.result ? truncReport(p.result, 120) : undefined,
          note: p?.note ? truncReport(p.note, 120) : undefined,
        });
      }
    }
    if (papers.length === 0) return null;
    const researchApproach = normalizeResearchApproach(d?.researchApproach);
    return {
      name,
      description: d?.description ? truncReport(d.description, 160) : undefined,
      papers,
      researchApproach,
    };
  };
  const dims: TopicReportDimension[] = [];
  for (const d of obj.dimensions.slice(0, 6)) {
    const n = normDim(d);
    if (n) dims.push(n);
  }
  if (dims.length === 0) return null;
  const arrOf = (k: string, max: number): string[] => {
    if (!Array.isArray(obj[k])) return [];
    const out: string[] = [];
    for (const s of obj[k]) {
      if (typeof s !== 'string') continue;
      const t = truncReport(s, 120);
      if (t) out.push(t);
      if (out.length >= max) break;
    }
    return out;
  };

  // nextSteps(目标 5):支持旧 string[] 与新对象 schema。
  // 旧 session 缓存了 string[],在 normalize 入口自动迁移成 {id, text, ...}
  const nextSteps: Array<{ id: string; text: string; tiedDimensionName?: string }> = [];
  if (Array.isArray(obj.nextSteps)) {
    for (let i = 0; i < obj.nextSteps.length && nextSteps.length < 6; i++) {
      const s = obj.nextSteps[i];
      if (typeof s === 'string') {
        const t = truncReport(s, 120);
        if (t) nextSteps.push({ id: `ns_${nextSteps.length + 1}`, text: t });
      } else if (s && typeof s === 'object') {
        const text = truncReport(s.text ?? s, 120);
        if (!text) continue;
        const id = typeof s.id === 'string' && s.id.trim()
          ? s.id.trim().slice(0, 40)
          : `ns_${nextSteps.length + 1}`;
        const tiedDimensionName =
          typeof s.tiedDimensionName === 'string' && s.tiedDimensionName.trim()
            ? s.tiedDimensionName.trim().slice(0, 30)
            : undefined;
        nextSteps.push({ id, text, tiedDimensionName });
      }
    }
  }
  const relatedSet = new Set<string>();
  for (const d of dims) for (const p of d.papers) relatedSet.add(p.arxivId);
  const related: string[] = [...relatedSet];

  // frontierDirections(目标 3):独立数组,只收 LLM 给的 ≥1 关联论文 + name 非空的
  const frontierArr: TopicReportFrontierDirection[] = [];
  if (Array.isArray(obj.frontierDirections)) {
    for (const f of obj.frontierDirections) {
      const name = truncReport(f?.name, 24);
      if (!name) continue;
      const description = truncReport(f?.description, 80) || '';
      const ids: string[] = [];
      if (Array.isArray(f?.paperArxivIds)) {
        for (const raw of f.paperArxivIds) {
          const id = canonicalId(String(raw ?? '').trim());
          if (id) ids.push(id);
        }
      }
      // 关联论文必须 ≥1:没有就丢弃(避免空架子)
      if (ids.length === 0) continue;
      frontierArr.push({ name, description, paperArxivIds: ids });
      if (frontierArr.length >= 4) break;
    }
  }

  const prevIds = new Set(prev?.relatedArxivIds ?? []);
  return {
    overview: truncReport(obj.overview, 800) || '(未生成总览)',
    dimensions: dims,
    methodsComparison: obj.methodsComparison ? truncReport(obj.methodsComparison, 600) : undefined,
    sharedFindings: arrOf('sharedFindings', 8),
    gaps: arrOf('gaps', 6),
    nextSteps,
    frontierDirections: frontierArr,
    resourceTier: normalizeResourceTier(obj.resourceTier),
    generatedAt: Date.now(),
    relatedArxivIds: related,
    incrementallyAddedArxivIds:
      mode === 'incremental' ? related.filter((id) => !prevIds.has(id)) : undefined,
  };
}

export async function generateTopicReport(
  topic: string,
  summaries: Summary[],
  cfg: LLMConfig,
  mode: 'full' | 'incremental',
  prev?: TopicReport,
): Promise<TopicReport> {
  if (summaries.length === 0) {
    throw new Error('需要至少 1 篇已总结论文才能生成报告');
  }

  // 每篇拼块,字段截断 600 防 prompt 过长。
  const blocks: string[] = [];
  summaries.forEach((s, i) => {
    const r = s.summary;
    const lines: string[] = [`[论文 ${i + 1}] arXiv:${s.arxivId}`];
    if (r.title) lines.push(`标题: ${r.title}${r.title_en ? ' / ' + r.title_en : ''}`);
    lines.push(`TLDR: ${truncReport(r.tldr, 600)}`);
    if (r.motivation) lines.push(`动机: ${truncReport(r.motivation, 600)}`);
    if (r.method) lines.push(`方法: ${truncReport(r.method, 600)}`);
    if (r.result) lines.push(`结果: ${truncReport(r.result, 600)}`);
    if (r.conclusion) lines.push(`结论: ${truncReport(r.conclusion, 600)}`);
    if (r.context) lines.push(`主题语境: ${truncReport(r.context, 600)}`);
    // 添加结构化的方法对比数据
    if (r.method_pros_cons && Object.keys(r.method_pros_cons).length > 0) {
      const methodPairs = Object.entries(r.method_pros_cons).map(([method, { pros, cons }]) => {
        return `${method}: pros=[${pros.join(', ')}], cons=[${cons.join(', ')}]`;
      });
      lines.push(`方法对比: ${methodPairs.join('; ')}`);
    }
    if (r.method_comparison) lines.push(`方法总结: ${truncReport(r.method_comparison, 600)}`);
    blocks.push(lines.join('\n'));
  });
  const papersContext = blocks.join('\n\n');

  let incrementalSection = '';
  if (mode === 'incremental' && prev) {
    const prevDims = prev.dimensions
      .map((d) => `  - ${d.name}: ${d.description ?? '(无描述)'} (含 ${d.papers.length} 篇)`)
      .join('\n');
    incrementalSection =
      `\n\n【增量模式】本会话之前已经基于 ${prev.relatedArxivIds.length} 篇论文生成过报告;` +
      `当前再整合全部 ${summaries.length} 篇。请复用 / 扩展 prevDimensions,只在确实无法归入时才新增维度。\n\n` +
      `prevDimensions:\n${prevDims}\n`;
  }

  const userPrompt =
    `研究主题: ${topic}\n\n` +
    `论文速览 (${summaries.length} 篇):\n"""\n${papersContext}\n"""` +
    incrementalSection +
    `\n请输出 JSON 对象,字段严格遵循 system prompt 定义:`;

  // 2 次重试,网络/LLM 报错和 JSON 解析失败都重试一次(沿用 exploreFromSeeds 模式)
  let lastErr = '';
  for (let attempt = 1; attempt <= REPORT_LLM_RETRY; attempt++) {
    try {
      // 主题报告也是重任务:输入含 M 篇速览,输出多维度 JSON 对象。给 8000 初始预算。
      // PR-3:stage=topic_report(主题报告)。
      const reportRoute = resolveRoute('topic_report');
      const raw = await callLLMRaw(getActiveReportPrompt(), userPrompt, { ...cfg, model: reportRoute.model }, true, 8000);
      try {
        const obj = JSON.parse(raw);
        const report = normalizeReportTopic(obj, prev, mode);
        if (report) return report;
        lastErr = '维度数组为空';
      } catch (e) {
        lastErr = `JSON 解析失败: ${(e as Error).message}`;
      }
    } catch (e) {
      lastErr = (e as Error).message;
    }
    if (attempt < REPORT_LLM_RETRY) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`主题报告生成失败 (${lastErr || '未知原因'})`);
}

export function incrementalReportEnabled(): boolean {
  const cb = document.getElementById('report-incremental-toggle') as HTMLInputElement | null;
  return !!cb?.checked;
}

// 增量追加入口。同 session 内 8 秒最多触发 1 次,防止 N 篇并发完成时连环 LLM 调用。
export async function triggerIncrementalReportDraft(s: TopicSession): Promise<void> {
  if (!s.report || s.summaries.length === 0) return;
  const incKey = '__reportIncLastTs__';
  const last = (s as unknown as Record<string, number>)[incKey] ?? 0;
  const now = Date.now();
  if (now - last < REPORT_INC_THROTTLE_MS) return;
  (s as unknown as Record<string, number>)[incKey] = now;
  try {
    const cfg = loadSettings() as LLMConfig;
    if (!cfg.apiKey) return;
    setStatus(`📊 正在增量更新报告(共 ${s.summaries.length} 篇)...`);
    const newReport = await generateTopicReport(s.topic, s.summaries, cfg, 'incremental', s.report);
    s.report = newReport;
    // renderReportStage 由 ./render 提供（在步骤 10 引入）。此处保留为回调以避免循环依赖：
    (window as unknown as { __renderReportStage?: () => void }).__renderReportStage?.();
    persistSession(s);
    setStatus(`✓ 报告已增量更新 · ${newReport.dimensions.length} 个维度`, 'success');
    setTimeout(clearStatus, 2000);
  } catch (e) {
    // 增量失败静默 — 不要打断总结流程
    console.warn('[topic] incremental report draft failed:', (e as Error).message);
    clearStatus();
  }
}

// 合并式增量报告触发:同一 doSummarize 阶段内多篇同时完成时,只触发
// 一次增量报告(避免每篇 worker 各自触发 LLM,4 路并发变 4 路 LLM 并发
// 加 N 次增量 LLM 调用,把 LLM 配额打爆)。
// 机制:setInterval 每 2s 检查一次"距上次报告以来是否新加了 ≥1 篇",
// 是则触发增量报告。否则不触发。任务结束后 clearInterval。
let reportIncTimer: ReturnType<typeof setInterval> | null = null;
let reportIncLastCount = 0;
export function startIncrementalReportTimer(s: TopicSession): void {
  stopIncrementalReportTimer();
  reportIncLastCount = s.summaries.length;
  if (!s.report) return; // 没报告就不启动定时器(用户还没点「生成报告」)
  reportIncTimer = setInterval(async () => {
    if (!incrementalReportEnabled()) return;
    if (s.summaries.length === reportIncLastCount) return; // 没人完成
    if (!s.report) return;
    const cur = s.summaries.length;
    reportIncLastCount = cur;
    try {
      const cfg = loadSettings() as LLMConfig;
      if (!cfg.apiKey) return;
      setStatus(`📊 正在增量更新报告(共 ${cur} 篇)...`);
      const newReport = await generateTopicReport(s.topic, s.summaries, cfg, 'incremental', s.report);
      s.report = newReport;
      (window as unknown as { __renderReportStage?: () => void }).__renderReportStage?.();
      persistSession(s);
      setStatus(`✓ 报告已增量更新 · ${newReport.dimensions.length} 个维度`, 'success');
      setTimeout(clearStatus, 2000);
    } catch (e) {
      console.warn('[topic] incremental report draft failed:', (e as Error).message);
      clearStatus();
    }
  }, REPORT_INC_THROTTLE_MS);
}
export function stopIncrementalReportTimer(): void {
  if (reportIncTimer) {
    clearInterval(reportIncTimer);
    reportIncTimer = null;
  }
}

export function buildReportMarkdown(): string | null {
  const cur = S.getSession();
  if (!cur?.report) return null;
  const r = cur.report;
  const lines: string[] = [];
  lines.push(`# 主题报告: ${cur.topic || '(主题探索)'}`);
  lines.push('');
  lines.push(
    `> 生成于 ${new Date(r.generatedAt).toLocaleString()} · 整合 ${r.relatedArxivIds.length} 篇论文` +
      (r.incrementallyAddedArxivIds && r.incrementallyAddedArxivIds.length
        ? ` · 本次新增 ${r.incrementallyAddedArxivIds.length} 篇`
        : '') +
      ` · 算力档位: ${r.resourceTier ?? 'unknown'}`,
  );
  lines.push('');
  lines.push('## 主题总览');
  lines.push(r.overview);
  lines.push('');
  lines.push('## 论文横向对比');
  r.dimensions.forEach((d) => {
    lines.push(`### ${d.name}`);
    if (d.description) lines.push(`*${d.description}*`);
    lines.push('');
    d.papers.forEach((p) => {
      lines.push(`- **arXiv:${p.arxivId}** — *${p.role}* — ${p.key}`);
      if (p.method) lines.push(`  - 方法: ${p.method}`);
      if (p.result) lines.push(`  - 结果: ${p.result}`);
      if (p.note) lines.push(`  - 注: ${p.note}`);
    });
    if (d.researchApproach) {
      const ra = d.researchApproach;
      lines.push('');
      lines.push(`#### 研究思路`);
      lines.push(`- **核心思路**: ${ra.idea}`);
      lines.push(`- **实施步骤**: ${ra.pipeline.map((step, i) => `${i + 1}. ${step}`).join(' · ')}`);
      lines.push(`- **难度**: ${ra.difficulty}${ra.estimatedTimeWeeks ? ` · 预估 ${ra.estimatedTimeWeeks} 周` : ''}${ra.tiedNextStep ? ` · 对应建议 \`${ra.tiedNextStep}\`` : ''}`);
    }
    lines.push('');
  });

  // 方法对比综览 + 每篇论文的方法 pros/cons
  const hasMethodData = r.methodsComparison || (cur?.summaries.some((s) => s.summary.method_pros_cons && Object.keys(s.summary.method_pros_cons).length > 0));
  if (hasMethodData) {
    lines.push('## 方法对比综览');
    if (r.methodsComparison) {
      lines.push(r.methodsComparison);
      lines.push('');
    }
    // 逐篇列出 method_pros_cons
    if (cur?.summaries) {
      const papersWithMethods = cur.summaries.filter(
        (s) => s.summary.method_pros_cons && Object.keys(s.summary.method_pros_cons).length > 0,
      );
      if (papersWithMethods.length > 0) {
        lines.push('### 各论文方法详析');
        papersWithMethods.forEach((s) => {
          lines.push(`**arXiv:${s.arxivId}**`);
          const mpc = s.summary.method_pros_cons!;
          Object.entries(mpc).forEach(([method, { pros, cons }]) => {
            lines.push(`- **${method}**: `);
            if (pros.length > 0) lines.push(`  - 优点: ${pros.join(', ')}`);
            if (cons.length > 0) lines.push(`  - 缺点: ${cons.join(', ')}`);
          });
          lines.push('');
        });
      }
    }
  }

  if (r.sharedFindings.length) {
    lines.push('## 共同发现');
    r.sharedFindings.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  // 前沿方向(目标 3):显式结构化方向,独立于 gaps
  if (r.frontierDirections && r.frontierDirections.length) {
    lines.push('## 前沿方向');
    r.frontierDirections.forEach((f) => {
      lines.push(`- **${f.name}** — ${f.description || '(无说明)'}`);
      if (f.paperArxivIds.length) {
        lines.push(`  - 关联: arXiv:${f.paperArxivIds.join(', arXiv:')}`);
      }
    });
    lines.push('');
  }
  if (r.gaps.length) {
    lines.push('## 研究空白');
    r.gaps.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  if (r.nextSteps.length) {
    lines.push('## 下一步建议');
    r.nextSteps.forEach((s) => {
      lines.push(`<a name="nextstep-${escapeMarkdownAnchor(s.id)}"></a>`);
      const tie = s.tiedDimensionName ? ` _(对应维度: ${s.tiedDimensionName})_` : '';
      lines.push(`- **[${s.id}]** ${s.text}${tie}`);
    });
    lines.push('');
  }
  return lines.join('\n');
}

/** Markdown anchor 不允许部分字符,做简易清理;不保证 Markdown 完美,只防报错。 */
function escapeMarkdownAnchor(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function copyReportAsMarkdown(): void {
  const md = buildReportMarkdown();
  if (!md) return;
  navigator.clipboard.writeText(md).then(
    () => setStatus('✓ 报告已复制为 Markdown', 'success'),
    () => setStatus('复制失败,请手动选择', 'error'),
  );
}

// 文件名:主题报告-<topic 安全 slug>-<YYYYMMDD-HHmmss>.md
export function reportFileName(): string {
  const topicSlug = (S.getSession()?.topic || '主题探索')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .slice(0, 40)
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'topic';
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `主题报告-${topicSlug}-${stamp}.md`;
}

export function downloadReportAsMarkdown(): void {
  const md = buildReportMarkdown();
  if (!md) return;
  try {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reportFileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus('✓ 报告已下载', 'success');
    setTimeout(clearStatus, 2000);
  } catch (e) {
    setStatus(`下载失败: ${(e as Error).message}`, 'error');
  }
}

export function copyAllAsMarkdown(): void {
  const cur = S.getSession();
  if (!cur || cur.summaries.length === 0) return;
  const lines: string[] = [];
  lines.push(`# ${cur.topic || '(主题探索)'}`);
  lines.push('');
  lines.push(`> 生成于 ${new Date().toISOString()},共 ${cur.summaries.length} 篇论文`);
  lines.push('');
  lines.push('## 子方向');
  for (const q of cur.subqs) {
    lines.push(`- **${q.label}**: \`${q.query}\` — ${q.reason}`);
  }
  lines.push('');
  lines.push('## 论文速览');
  for (const s of cur.summaries) {
    lines.push(`### ${s.summary.title || s.arxivId}`);
    if (s.summary.title_en) lines.push(`*${s.summary.title_en}*`);
    lines.push(`arXiv: ${s.arxivId}`);
    if (s.summary.tldr) lines.push(`\n**TLDR**: ${s.summary.tldr}`);
    if (s.summary.motivation) lines.push(`\n**动机**: ${s.summary.motivation}`);
    if (s.summary.method) lines.push(`\n**方法**: ${s.summary.method}`);
    if (s.summary.result) lines.push(`\n**结果**: ${s.summary.result}`);
    if (s.summary.conclusion) lines.push(`\n**结论**: ${s.summary.conclusion}`);
    if (s.summary.context) lines.push(`\n**主题语境**: ${s.summary.context}`);
    lines.push('');
  }
  const md = lines.join('\n');
  navigator.clipboard.writeText(md).then(
    () => setStatus('✓ 已复制全部为 Markdown', 'success'),
    () => setStatus('复制失败,请手动选择', 'error'),
  );
}