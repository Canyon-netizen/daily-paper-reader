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
import type { Summary, TopicReport, TopicReportDimension, TopicReportDimensionPaper, TopicSession } from '../../lib/schemas';
import { getActiveReportPrompt } from './prompts';
import { callLLMRaw } from './llm-call';
import { S } from './state';
import { setStatus, clearStatus } from './status';
import { persistSession } from './store';

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
    return {
      name,
      description: d?.description ? truncReport(d.description, 160) : undefined,
      papers,
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
  const relatedSet = new Set<string>();
  for (const d of dims) for (const p of d.papers) relatedSet.add(p.arxivId);
  const related: string[] = [...relatedSet];
  const prevIds = new Set(prev?.relatedArxivIds ?? []);
  return {
    overview: truncReport(obj.overview, 800) || '(未生成总览)',
    dimensions: dims,
    sharedFindings: arrOf('sharedFindings', 8),
    gaps: arrOf('gaps', 6),
    nextSteps: arrOf('nextSteps', 6),
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
        : ''),
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
    lines.push('');
  });
  if (r.sharedFindings.length) {
    lines.push('## 共同发现');
    r.sharedFindings.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  if (r.gaps.length) {
    lines.push('## 研究空白');
    r.gaps.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  if (r.nextSteps.length) {
    lines.push('## 下一步建议');
    r.nextSteps.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  return lines.join('\n');
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