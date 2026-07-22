// topic-search 阶段动作层 —— 从 topic-search.ts 抽出（模块化重构 step 11）。
//
// 5 个阶段的用户触发动作：拆解 / 搜索 / 总结 / 报告生成 / 报告追问 / 应用修改建议。
//
// 状态同步：actions 模块保留本地 let current，render 模块同样持有一份（syncCurrent 同步）。
// 两者指向同一 TopicSession 对象引用；orchestrator 的 init() 一次性把同一 current
// 同步给两边，actions 写入新会话时通过 setCurrent(s) 让 render 也同步看到。

import { loadSettings, loadSelection, type LLMConfig } from '../settings';
import { $, escapeHtml } from '../../lib/dom-utils';
import { canonicalArxivId as canonicalId } from '../../lib/dom-utils';
import type { Candidate, SubQ, Summary, TopicSession } from '../../lib/schemas';
import { decomposeIdea, searchForDirection, summarizeOne, chatWithReport, validateSubqHitCount, SUMMARIZE_CONCURRENCY, PDF_PREFETCH_CONCURRENCY, pdfTextCache, prefetchOnePdf } from './pipeline';
import { setStatus, setStatusErrorWithAction, clearStatus, renderBanner, clearBanner } from './status';
import { generateTopicReport, startIncrementalReportTimer, stopIncrementalReportTimer, formatEta } from './report-markdown';
import { renderAll, renderReportStage, renderReportChat, renderCandStage, renderSessionMeta, renderSummaryStage, renderFacetStage, renderSubqStage, syncCurrent } from './render';
import { runConcurrent } from './concurrency';
import { persistSession, MAX_QA_FOR_REPORT, deleteSession, loadStore, saveStore } from './store';
import { S } from './state';
import { uid } from './concurrency';

/** orchestrator 调用,把当前会话引用同步给本模块。 */
export function setCurrent(s: TopicSession | null): void {
  current = s;
  syncCurrent(s);
}

/** 本模块的 current 与 orchestrator / render 共享同一对象引用。 */
let current: TopicSession | null = null;

async function doGenerateReport(): Promise<void> {
  if (!current) return;
  if (current.summaries.length === 0) {
    setStatus('需要至少 1 篇速览笔记才能生成报告', 'error');
    return;
  }
  const cfg = loadSettings() as LLMConfig;
  if (!cfg.apiKey) {
    renderBanner('请先在 <a href="/settings/">设置</a> 页面填 LLM API Key。');
    return;
  }
  clearBanner();
  ($<HTMLButtonElement>('report-gen-btn')).disabled = true;
  ($('stage-report') as HTMLDetailsElement).open = true;
  S.setInFlight(new AbortController());
  const n = current.summaries.length;
  const startedAt = Date.now();
  setStatus(`📊 正在为 ${n} 篇论文生成主题报告...`);
  let elapsedTick = 0;
  const waitTimer = setInterval(() => {
    elapsedTick += 5;
    setStatus(`📊 正在为 ${n} 篇论文生成主题报告... (已等待 ${elapsedTick}s)`);
  }, 5000);
  try {
    const report = await generateTopicReport(
      current.topic,
      current.summaries,
      cfg,
      current.report ? 'incremental' : 'full',
      current.report,
    );
    current.report = report;
    renderReportStage();
    persistSession(current!);
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    setStatus(
      `✓ 报告完成 · ${report.dimensions.length} 个维度 · ${report.relatedArxivIds.length} 篇论文 · 耗时 ${seconds}s`,
    );
    setTimeout(clearStatus, 2500);
  } catch (e) {
    setStatusErrorWithAction(`生成报告失败: ${(e as Error).message}`, '🔄 重试', () => doGenerateReport());
  } finally {
    clearInterval(waitTimer);
    ($<HTMLButtonElement>('report-gen-btn')).disabled = false;
    S.setInFlight(null);
  }
}

async function doSendReportChat(): Promise<void> {
  if (!current?.report) {
    setStatus('需要先有报告才能追问 — 请先生成报告', 'error');
    return;
  }
  const input = document.querySelector<HTMLInputElement>('[data-role="report-chat-body"] .topic-chat-input input');
  if (!input) return;
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  if (!current.reportChats) current.reportChats = [];
  current.reportChats.push({ role: 'user', content: q, ts: Date.now() });
  if (current.reportChats.length > MAX_QA_FOR_REPORT) {
    current.reportChats = current.reportChats.slice(-MAX_QA_FOR_REPORT);
  }
  renderReportChat();
  persistSession(current!);

  const sendBtn = document.querySelector<HTMLButtonElement>('[data-act="send-report-chat"]');
  if (sendBtn) sendBtn.disabled = true;
  setStatus('💬 报告追问中...');
  try {
    S.setInFlight(new AbortController());
    const a = await chatWithReport(
      current.report,
      current.topic,
      current.summaries,
      q,
      current.reportChats.slice(0, -1),
    );
    current.reportChats.push({ role: 'assistant', content: a, ts: Date.now() });
    if (current.reportChats.length > MAX_QA_FOR_REPORT) {
      current.reportChats = current.reportChats.slice(-MAX_QA_FOR_REPORT);
    }
    renderReportChat();
    persistSession(current!);
    setStatus('✓ 追问完成', 'success');
    setTimeout(clearStatus, 1500);
  } catch (e) {
    setStatusErrorWithAction(`追问失败: ${(e as Error).message}`, '🔄 重试', () => doSendReportChat());
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    S.setInFlight(null);
  }
}

function doClearReportChat(): void {
  if (!current) return;
  if (!current.reportChats || current.reportChats.length === 0) return;
  if (!confirm('清空报告追问历史?此操作不可撤销。')) return;
  current.reportChats = [];
  renderReportChat();
  persistSession(current!);
  setStatus('✓ 已清空报告追问', 'success');
  setTimeout(clearStatus, 1500);
}

async function doApplyReportSuggestion(): Promise<void> {
  if (!current?.report) return;
  if (!current.reportChats || current.reportChats.length < 2) {
    setStatus('没有可应用的修改建议 — 先在追问里要求模型给出修改建议', 'error');
    return;
  }
  const lastAssistant = [...current.reportChats].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) {
    setStatus('找不到最近一轮模型回复', 'error');
    return;
  }
  const isSuggestion = /(修改建议|建议[:：]|建议如下|^[\s\S]*?(改写|调整|把.+改成|把.+换|删除|加上|重排|改.+为))/m.test(lastAssistant.content)
    || /^[「『]/.test(lastAssistant.content.trim());
  if (!isSuggestion) {
    setStatus('最近一轮不是「修改建议」格式,无法应用 — 请明确告诉模型「请给修改建议」', 'error');
    return;
  }
  if (!confirm('将基于最近一轮「修改建议」重新生成报告?原报告会作为 prevDimensions 被复用/扩展。')) return;
  const cfg = loadSettings() as LLMConfig;
  if (!cfg.apiKey) {
    renderBanner('请先在 <a href="/settings/">设置</a> 页面填 LLM API Key。');
    return;
  }
  clearBanner();
  S.setInFlight(new AbortController());
  ($<HTMLButtonElement>('report-gen-btn')).disabled = true;
  setStatus('🔄 正在按修改建议重生成报告...');
  try {
    const topicWithNotes =
      current.topic +
      '\n\n【用户上一轮提出的修改建议 — 请基于这些建议重写报告(走 incremental 模式)】\n' +
      lastAssistant.content;
    const newReport = await generateTopicReport(
      topicWithNotes,
      current.summaries,
      cfg,
      'incremental',
      current.report,
    );
    current.report = newReport;
    renderReportStage();
    persistSession(current!);
    setStatus(`✓ 报告已按建议重生成 · ${newReport.dimensions.length} 个维度 · ${newReport.relatedArxivIds.length} 篇`, 'success');
    setTimeout(clearStatus, 2500);
  } catch (e) {
    setStatusErrorWithAction(`应用建议失败: ${(e as Error).message}`, '🔄 重试', () => doApplyReportSuggestion());
  } finally {
    ($<HTMLButtonElement>('report-gen-btn')).disabled = false;
    S.setInFlight(null);
  }
}

async function doDecompose(): Promise<void> {
  if (!current) return;
  const ta = $<HTMLTextAreaElement>('topic-input');
  const idea = ta.value.trim();
  if (!idea) return;
  const cfg = loadSettings() as LLMConfig;
  if (!cfg.apiKey) {
    renderBanner('请先在 <a href="/settings/">设置</a> 页面填 LLM API Key。');
    return;
  }
  clearBanner();
  S.setInFlight(new AbortController());
  setStatus('🔍 拆解思路中...');
  ($<HTMLButtonElement>('decompose-btn')).disabled = true;
  try {
    const seeds = loadSelection();
    const decomposition = await decomposeIdea(idea, seeds);
    current.topic = idea;
    current.subqs = decomposition.subqs;
    current.facets = decomposition.facets.length > 0 ? decomposition.facets : undefined;
    current.referenceSeedArxivIds = seeds.map((s) => canonicalId(s.arxivId));
    current.candidatesBySubq = {};
    current.summaries = [];
    current.chats = {};
    current.report = undefined;
    ($('stage-subqs') as HTMLDetailsElement).open = true;
    renderAll();
    persistSession(current!);
    const seedNote = seeds.length > 0 ? ` · 已参考 ${seeds.length} 篇已选论文` : '';
    const facetNote = current.facets ? ` · ${current.facets.length} 个研究维度` : '';
    setStatus(`✓ 已拆解为 ${decomposition.subqs.length} 个子方向${facetNote}${seedNote}`, 'success');
    setTimeout(clearStatus, 2000);
  } catch (e) {
    setStatusErrorWithAction(`拆解失败: ${(e as Error).message}`, '🔄 重试', () => doDecompose());
  } finally {
    ($<HTMLButtonElement>('decompose-btn')).disabled = false;
    S.setInFlight(null);
  }
}

async function doSearch(): Promise<void> {
  if (!current) return;
  const selected = current.subqs.filter((q) => q.selected);
  if (selected.length === 0) return;
  ($<HTMLButtonElement>('search-btn')).disabled = true;
  S.setInFlight(new AbortController());
  setStatus(`📚 搜索 ${selected.length} 个子方向...`);
  for (const q of selected) current.candidatesBySubq[q.id] = [];
  renderCandStage();

  let done = 0;
  const result = await runConcurrent(
    selected,
    SUMMARIZE_CONCURRENCY,
    async (q) => {
      const cands = await searchForDirection(q);
      current!.candidatesBySubq[q.id] = cands;
      return cands.length;
    },
    (d, total) => {
      done = d;
      setStatus(`📚 搜索中 ${done}/${total} ...`);
      renderCandStage();
      persistSession(current!);
    },
  );
  const totalCands = Object.values(current.candidatesBySubq).reduce((a, b) => a + b.length, 0);
  const subqsSearched = Object.values(current.candidatesBySubq).filter((l) => l !== undefined).length;
  const subqsHit = Object.values(current.candidatesBySubq).filter((l) => (l || []).length > 0).length;
  const failedDetails = result.err.map((e) => {
    const sq = e.item as SubQ;
    const detail = sq.searchError ? `\n  · ${sq.label}: ${sq.searchError}` : `\n  · ${sq.label}: ${(e.error as Error).message.slice(0, 120)}`;
    return detail;
  }).join('');
  if (result.err.length > 0) {
    const msg = result.err.map((e) => (e.error as Error).message).join('; ');
    if (totalCands === 0) {
      setStatusErrorWithAction(`所有子方向都未命中(代理或网络问题): ${msg.slice(0, 100)}${failedDetails}`, '🔄 重试', () => doSearch());
    } else {
      setStatus(`部分子方向失败${failedDetails ? ` — 详情:${failedDetails}` : ''},共拿到 ${totalCands} 篇候选`, 'error');
      setTimeout(clearStatus, 3000);
    }
  } else if (totalCands === 0) {
    setStatusErrorWithAction(`搜索完成但 ${subqsSearched} 个子方向都未命中论文。可能是 query 太冷门,试试改英文关键词。`, '🔄 重新搜索', () => doSearch());
  } else {
    setStatus(`✓ ${subqsHit}/${subqsSearched} 个子方向命中,共 ${totalCands} 篇候选`, 'success');
    setTimeout(clearStatus, 1500);
  }
  // 注入种子候选
  if (current.referenceSeedArxivIds && current.referenceSeedArxivIds.length > 0) {
    const seeds = loadSelection();
    const seedCands: Candidate[] = seeds
      .filter((s) => current!.referenceSeedArxivIds!.includes(canonicalId(s.arxivId)))
      .map((s) => {
        const summary =
          [s.method, s.result].filter(Boolean).join('\n').trim() ||
          s.tldr ||
          '(参考论文无摘要,只能基于标题与 TLDR 总结)';
        const entry = {
          id: `https://arxiv.org/abs/${s.arxivId}`,
          arxivId: s.arxivId,
          title: s.title,
          authors: [] as string[],
          summary,
          published: '',
          updated: '',
          pdfUrl: `https://arxiv.org/pdf/${s.arxivId}.pdf`,
        };
        return { arxivId: s.arxivId, entry, selected: true };
      });
    current.candidatesBySubq['__seeds__'] = seedCands;
  }
  ($<HTMLButtonElement>('search-btn')).disabled = false;
  ($('stage-candidates') as HTMLDetailsElement).open = true;
  renderCandStage();
  renderSessionMeta();
  persistSession(current!);
  S.setInFlight(null);
}

async function doSummarize(limit?: number): Promise<void> {
  if (!current) return;
  const picks: Array<{ cand: Candidate; subqId: string }> = [];
  for (const [subqId, list] of Object.entries(current.candidatesBySubq)) {
    for (const c of list) if (c.selected) picks.push({ cand: c, subqId });
  }
  if (picks.length === 0) return;
  const seen = new Set<string>();
  const unique = picks.filter((p) => {
    const k = canonicalId(p.cand.arxivId);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const totalCandidates = unique.length;
  if (limit && limit > 0 && limit < unique.length) {
    unique.length = limit;
  }
  const totalToSummarize = unique.length;

  const ids = new Set(unique.map((p) => p.cand.arxivId));
  current.summaries = current.summaries.filter((s) => !ids.has(s.arxivId));
  for (const id of ids) delete current.chats[id];

  ($<HTMLButtonElement>('summarize-btn')).disabled = true;
  ($<HTMLButtonElement>('summarize-top-btn'))?.setAttribute('disabled', 'true');
  ($<HTMLButtonElement>('summarize-all-btn'))?.setAttribute('disabled', 'true');
  S.setInFlight(new AbortController());
  ($('stage-summaries') as HTMLDetailsElement).open = true;

  const startedAt = Date.now();
  const sampleDurations: number[] = [];

  const limitDesc = limit && limit < totalCandidates ? `前 ${totalToSummarize}/${totalCandidates} 篇` : `${totalToSummarize} 篇`;
  setStatus(`🚀 总结 ${limitDesc}(并发 LLM ${SUMMARIZE_CONCURRENCY} + PDF 预热 ${PDF_PREFETCH_CONCURRENCY},流水线)...`);

  const heartbeat = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const readyN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'ready').length;
    const pendingN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'pending').length;
    const failN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'failed').length;
    const completed = current?.summaries.length ?? 0;
    const prefetchInfo = ` · PDF 预热 ${readyN}/${totalToSummarize} ready` +
      (pendingN > 0 ? ` · ${pendingN} 下载中` : '') +
      (failN > 0 ? ` · ${failN} 失败` : '');
    setStatus(`🚀 总结 ${limitDesc} · 已用 ${formatEta(elapsed)} · 完成 ${completed}/${totalToSummarize}${prefetchInfo}`);
  }, 2000);

  pdfTextCache.clear();
  startIncrementalReportTimer(current);
  void (async () => {
    try {
      await runConcurrent(unique, PDF_PREFETCH_CONCURRENCY, async ({ cand }) => {
        if (pdfTextCache.has(cand.entry.arxivId)) {
          const cur = pdfTextCache.get(cand.entry.arxivId)!;
          if (cur.status !== 'pending') return;
        }
        await prefetchOnePdf(cand.entry);
      });
    } catch (e) {
      console.warn('[topic] prefetch background loop failed:', e);
    }
  })();

  let result: { ok: Array<{ item: { cand: Candidate; subqId: string }; result: Summary }>; err: Array<{ item: { cand: Candidate; subqId: string }; error: Error }> };
  try {
    result = await runConcurrent(
      unique,
      SUMMARIZE_CONCURRENCY,
      async ({ cand, subqId }) => {
        const t0 = Date.now();
        const sum = await summarizeOne(cand.entry, subqId);
        const dt = Date.now() - t0;
        sampleDurations.push(dt);
        return sum;
      },
      (d, total) => {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        const readyN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'ready').length;
        const pendingN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'pending').length;
        const failN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'failed').length;
        let eta = '';
        if (sampleDurations.length >= 5) {
          const sorted = [...sampleDurations].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          const remain = Math.max(0, total - d);
          const observedTput = elapsed / Math.max(d, 1);
          let etaSec = Math.round(observedTput * remain);
          if (etaSec > 6 * 3600) {
            eta = ` · 已用 ${formatEta(elapsed)} · 预计 >6h(建议 ⏹ 停止,用「总结前 20 篇」)`;
          } else {
            eta = ` · 已用 ${formatEta(elapsed)} · 预计还需 ${formatEta(etaSec)}`;
          }
        } else if (d > 0) {
          eta = ` · 已用 ${formatEta(elapsed)} · 采样中(还需 ${5 - sampleDurations.length} 篇)`;
        }
        const prefetchInfo = ` · PDF 预热 ${readyN}/${total} ready` +
          (pendingN > 0 ? ` · ${pendingN} 下载中` : '') +
          (failN > 0 ? ` · ${failN} 失败` : '');
        setStatus(`🚀 总结 ${limitDesc}... ${d}/${total}${eta}${prefetchInfo}`);
        renderSummaryStage();
        renderSessionMeta();
        if (d % 5 === 0 || d === total) {
          persistSession(current!);
        }
      },
      (_item, _idx, sum, err) => {
        if (sum && current) {
          current.summaries.push(sum);
          renderSummaryStage();
          renderSessionMeta();
          persistSession(current!);
          renderReportStage();
        } else if (err) {
          console.warn('[topic] summarize failed:', err.message);
        }
      },
    );
  } finally {
    clearInterval(heartbeat);
    S.setInFlight(null);
  }

  stopIncrementalReportTimer();

  await new Promise((resolve) => {
    const deadline = Date.now() + 60_000;
    const tick = () => {
      const stillPending = Array.from(pdfTextCache.values()).some((v) => v.status === 'pending');
      if (!stillPending || Date.now() > deadline) {
        resolve(undefined);
        return;
      }
      setTimeout(tick, 500);
    };
    tick();
  });

  const finalPrefetchFailed = Array.from(pdfTextCache.values()).filter((v) => v.status === 'failed').length;
  pdfTextCache.clear();
  if (result.err.length > 0) {
    setStatus(`部分总结失败(${result.err.length}/${totalToSummarize}): ${result.err[0].error.message.slice(0, 100)}${result.err.length > 1 ? ` …` : ''}`, 'error');
  } else {
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    setStatus(`✓ ${limitDesc}总结完成 · 耗时 ${formatEta(seconds)}`, 'success');
    setTimeout(clearStatus, 2000);
  }
  ($<HTMLButtonElement>('summarize-btn')).disabled = false;
  ($<HTMLButtonElement>('summarize-top-btn'))?.removeAttribute('disabled');
  ($<HTMLButtonElement>('summarize-all-btn'))?.removeAttribute('disabled');
  renderSummaryStage();
  renderSessionMeta();
  persistSession(current!);
}

// 单篇论文命中实测(子方向面板的🔬按钮)
async function doVerifyHit(sid: string): Promise<void> {
  if (!current) return;
  const subq = current.subqs.find((q) => q.id === sid);
  if (!subq) return;
  const card = document.querySelector<HTMLElement>(`.subq-card[data-sid="${sid}"]`);
  const btn = card?.querySelector<HTMLButtonElement>('[data-act="verify-hit"]');
  if (btn) btn.disabled = true;
  setStatus(`🔬 实测 arXiv: ${subq.label}...`);
  try {
    const { count, samples } = await validateSubqHitCount(subq.query);
    subq.hitCount = count;
    subq.hitSamples = samples;
    renderSubqStage();
    persistSession(current!);
    setStatus(count > 0 ? `✓ 命中 ${count} 篇` : '⚠ 0 命中 — 改 query 或加 aliases', count > 0 ? 'success' : '');
  } catch (e) {
    setStatus(`实测失败: ${(e as Error).message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// 阶段 3.5:AI 筛论文入口(从所有候选中选最相关的 N 篇)
async function filterCandidatesByLLM(targetN: number): Promise<void> {
  if (!current) return;
  const hidden = new Set((await import('../settings')).loadHiddenPapers());
  const allEntries: Array<{ cand: Candidate; subqId: string }> = [];
  for (const [subqId, list] of Object.entries(current.candidatesBySubq)) {
    for (const c of list) {
      if (hidden.has(c.arxivId)) continue;
      allEntries.push({ cand: c, subqId });
    }
  }
  const seen = new Set<string>();
  const unique = allEntries.filter((e) => {
    const k = canonicalId(e.cand.arxivId);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length === 0) {
    setStatus('没有候选论文可筛选', 'error');
    return;
  }
  if (unique.length <= targetN) {
    for (const e of unique) e.cand.selected = true;
    for (const e of allEntries) {
      if (!unique.some((u) => u.cand.arxivId === e.cand.arxivId)) e.cand.selected = false;
    }
    renderCandStage();
    setStatus(`✓ 候选 ${unique.length} 篇,已全部勾选`, 'success');
    return;
  }
  const cfg = loadSettings() as LLMConfig;
  if (!cfg.apiKey) {
    renderBanner('请先在 <a href="/settings/">设置</a> 页面填 LLM API Key。');
    return;
  }
  clearBanner();
  S.setInFlight(new AbortController());
  setStatus(`🤖 AI 筛论文中:从 ${unique.length} 篇候选选最相关的 ${targetN} 篇...`);

  const blocks: string[] = [];
  unique.forEach((e, i) => {
    const subq = current!.subqs.find((q) => q.id === e.subqId);
    const label = subq?.label ?? '?';
    blocks.push(
      `[${i + 1}] arXiv:${e.cand.arxivId} (子方向: ${label})\n` +
      `标题: ${e.cand.entry.title}\n` +
      `摘要: ${(e.cand.entry.summary || '').slice(0, 200).replace(/\s+/g, ' ')}`,
    );
  });
  const userPrompt =
    `研究主题: ${current.topic}\n\n` +
    `请从以下 ${unique.length} 篇候选中选最相关的 ${targetN} 篇:\n\n` +
    blocks.join('\n\n') +
    `\n\n请输出 JSON 数组,严格 ${targetN} 个元素:`;

  // 通过 ./llm-call.callLLMRaw + ./prompts.getActiveCandPrompt + resolveRoute
  const { callLLMRaw } = await import('./llm-call');
  const { getActiveCandPrompt } = await import('./prompts');
  const { resolveRoute } = await import('../../lib/llm');
  let raw = '';
  let arr: any[] = [];
  const MAX = 2;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      const candRoute = resolveRoute('topic_cand');
      raw = await callLLMRaw(getActiveCandPrompt(), userPrompt, { ...cfg, model: candRoute.model }, true, 8000);
    } catch (e) {
      if (attempt >= MAX) {
        setStatusErrorWithAction(`AI 筛论文失败: ${(e as Error).message}`, '🔄 重试', () => filterCandidatesByLLM(targetN));
        S.setInFlight(null);
        return;
      }
      continue;
    }
    try {
      arr = JSON.parse(raw);
    } catch {
      if (attempt >= MAX) {
        setStatusErrorWithAction(`AI 筛论文返回不是 JSON: ${raw.slice(0, 100)}`, '🔄 重试', () => filterCandidatesByLLM(targetN));
        S.setInFlight(null);
        return;
      }
      continue;
    }
    if (Array.isArray(arr) && arr.length > 0) break;
  }
  const picked = new Set<string>();
  for (const item of arr) {
    const id = String(item.arxivId ?? '').trim();
    if (id) picked.add(canonicalId(id));
  }
  if (picked.size === 0) {
    setStatusErrorWithAction('AI 没选出任何论文', '🔄 重试', () => filterCandidatesByLLM(targetN));
    S.setInFlight(null);
    return;
  }
  for (const e of allEntries) {
    e.cand.selected = picked.has(canonicalId(e.cand.arxivId));
  }
  renderCandStage();
  persistSession(current!);
  S.setInFlight(null);
  setStatus(`✓ AI 筛论文完成:从 ${unique.length} 篇中选了 ${picked.size} 篇。点「🚀 总结选中论文」开始总结。`, 'success');
}

function startNewSession(): void {
  if (current && (current.subqs.length > 0 || current.summaries.length > 0)) {
    if (!confirm('确定要新建会话?当前会话的论文和追问会被清空(已写入 localStorage 的旧会话可手动清除)。')) return;
  }
  if (current) deleteSession(current);
  setCurrent(null);
  ($<HTMLTextAreaElement>('topic-input')).value = '';
  clearBanner();
  clearStatus();
  renderAll();
}

function ensureSession(): void {
  if (current) return;
  const store = loadStore();
  if (store.currentId && store.sessions[store.currentId]) {
    setCurrent(store.sessions[store.currentId]);
    setStatus('✓ 已恢复上次会话', 'success');
    setTimeout(clearStatus, 1500);
  } else {
    const newSession: TopicSession = {
      id: uid('ts'),
      topic: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      subqs: [],
      candidatesBySubq: {},
      summaries: [],
      chats: {},
    };
    setCurrent(newSession);
    const store2 = loadStore();
    store2.currentId = newSession.id;
    store2.sessions[newSession.id] = newSession;
    saveStore(store2);
  }
}

export {
  doGenerateReport,
  doSendReportChat,
  doClearReportChat,
  doApplyReportSuggestion,
  doDecompose,
  doSearch,
  doSummarize,
  doVerifyHit,
  filterCandidatesByLLM,
  startNewSession,
  ensureSession,
};

// 重新导出 store 模块的常用函数,方便 leaves 一站式 import
export { persistSession, deleteSession, loadStore, saveStore } from './store';