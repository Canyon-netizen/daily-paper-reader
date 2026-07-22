// /topic 页面客户端逻辑
//
// 5 阶段状态机:输入 → 拆解 → 搜索 → 总结 → 追问。
// 每个阶段都允许回退/重新触发,localStorage 持久化整个会话。
//
// 复用:
//   - LLM: settings.ts 的 OpenAI 兼容端点(loadSettings / loadProvider)
//   - arXiv 抓取 + 解析: paper-analyzer.ts 的 fetchWithDiagnosis / searchArxiv / parseArxivEntry / fetchArxivPdf
//   - 单篇总结 prompt: paper-analyzer.ts 的 SYSTEM_PROMPT(已 export)
//   - 总结入口 callLLM: paper-analyzer.ts 的 callLLM(已 export,接受可选 statusCb)

import {
  loadSettings,
  getCustomProxy,
  loadHiddenPapers,
  loadSelection,
  isInSelection,
  addToSelection,
  removeFromSelection,
  clearSelection,
  type SelectionItem,
  type LLMConfig,
} from './settings';
import {
  searchArxiv,
  searchArxivById,
  fetchArxivPdf,
  fetchWithDiagnosis,
  callLLM,
} from './paper-analyzer';
import type { ArxivEntry } from './paper-analyzer';
import { callChatCompletion, REASONING_MODEL_PATTERN_WIDE, resolveRoute, type ChatMessage } from '../lib/llm';
import { debounce, canonicalArxivId as canonicalId, escapeHtml } from '../lib/dom-utils';
import {
  buildFacet,
  buildRegenSubQ,
  buildSubQ,
  computeFacetCoverage,
  normalizeAliases,
  normalizeQuery,
  FACET_CATEGORY_LABELS,
  type Candidate,
  type ChatMsg,
  type DecomposeLLMResponse,
  type Facet,
  type FacetCategory,
  type SessionStore,
  type SubQ,
  type SubqRewrite,
  type Summary,
  type TopicDecomposition,
  type TopicReport,
  type TopicReportDimension,
  type TopicReportDimensionPaper,
  type TopicSession,
  type DebateProgress,
  type DebateIdea,
} from '../lib/schemas';
import {
  PAPER_CHAT_SYSTEM,
  REPORT_CHAT_SYSTEM,
  SUBQ_REWRITE_SYSTEM,
  getActiveFacetPrompt,
  getActiveCandPrompt,
  getActiveExplorePrompt,
  getActiveReportPrompt,
} from './topic-search/prompts';
import { uid, runConcurrent } from './topic-search/concurrency';
import { persistSession, deleteSession, trimSessionToLimit, MAX_QA_PER_PAPER, MAX_QA_FOR_REPORT, loadStore, saveStore } from './topic-search/store';
import { callLLMRaw } from './topic-search/llm-call';
// pipeline 模块负责拆解 / 搜索 / 改写 / 总结 / 追问的纯逻辑；chatWithPaper / chatWithReport
// 内部通过 S.getSession() 取当前会话，给 LLM signal 串上 S.getInFlight() 的 abort。
import {
  exploreFromSeeds,
  validateAndRewriteSubqs,
  pdfTextCache,
  prefetchOnePdf,
  summarizeOne,
  SUMMARIZE_CONCURRENCY,
  PDF_PREFETCH_CONCURRENCY,
} from './topic-search/pipeline';
import {
  setStatus,
  setStatusErrorWithAction,
  clearStatus,
  stopInFlight,
  renderBanner,
  clearBanner,
} from './topic-search/status';
import {
  formatEta,
  incrementalReportEnabled,
  triggerIncrementalReportDraft,
  startIncrementalReportTimer,
  stopIncrementalReportTimer,
  buildReportMarkdown,
  reportFileName,
  copyReportAsMarkdown,
  downloadReportAsMarkdown,
  copyAllAsMarkdown,
  generateTopicReport,
} from './topic-search/report-markdown';
import {
  syncCurrent,
  renderAll,
  renderReportStage,
  renderFacetStage,
  renderSubqStage,
  renderCandStage,
  renderSummaryStage,
  renderSessionMeta,
  renderInputStage,
  renderStageInputSeedsBanner,
  addFacet,
  refreshSubqMeta,
  renderReportChat,
  regenerateSummary as renderRegenerateSummary,
  sendChat as renderSendChat,
} from './topic-search/render';
// decomposeIdea / searchForDirection / chatWithPaper / chatWithReport 同属 pipeline 域逻辑,
// 但只在本文件 (orchestrator) 内被 doDecompose / doSearch / sendChat / doSendReportChat 等 action 调用,
// 故不作为公开 re-export,直接走命名 import。
import {
  decomposeIdea,
  searchForDirection,
  chatWithPaper,
  chatWithReport,
  validateSubqHitCount,
} from './topic-search/pipeline';
// getActiveXxxPrompt 是历史公开 API — 从 ./topic-search/prompts 再导出，保持原 import 路径。
export {
  getActiveFacetPrompt,
  getActiveCandPrompt,
  getActiveExplorePrompt,
  getActiveReportPrompt,
} from './topic-search/prompts';
// exploreFromSeeds / validateAndRewriteSubqs 历史上也对外公开过，从 ./topic-search/pipeline 再导出。
export {
  exploreFromSeeds,
  validateAndRewriteSubqs,
} from './topic-search/pipeline';

// ============================================================================
// 类型 + 常量
// ============================================================================

// LLMConfig 来自 ./settings, 不再本地定义. 见 ./settings:7.

// 总 sessions 字节上限(留 ~1MB 给别的 key)
// 单会话字节上限
// 主题报告增量追加节流(同 session 内 N 篇并发完成时,8 秒内最多触发 1 次)
// 报告生成 LLM 重试次数


// AI 筛论文入口:从 candidatesBySubq 全集中选 M 篇最相关。
async function filterCandidatesByLLM(targetN: number): Promise<void> {
  if (!current) return;
  // 收集所有候选(去重,保留第一条;过 hidden)
  const hidden = new Set(loadHiddenPapers());
  const allEntries: Array<{ cand: Candidate; subqId: string }> = [];
  for (const [subqId, list] of Object.entries(current.candidatesBySubq)) {
    for (const c of list) {
      if (hidden.has(c.arxivId)) continue;
      allEntries.push({ cand: c, subqId });
    }
  }
  // 同一篇跨子方向只算一次,保留首条 subqId
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
    // 已经 <= M 篇,直接全选
    for (const e of unique) e.cand.selected = true;
    // 清掉同 subq 内不在 unique 列表的勾选
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
  inFlightController = new AbortController();
  setStatus(`🤖 AI 筛论文中:从 ${unique.length} 篇候选选最相关的 ${targetN} 篇...`);

  // 拼 userPrompt:每篇一个 block(标题 + 摘要前 200 字 + 来自子方向)
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

  let raw = '';
  let arr: any[] = [];
  const MAX = 2;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      // 筛论文是重任务:输入含 N 篇候选(常 100-300)的标题+摘要,推理模型的
      // <think> 逐篇分析会很长。给足 8000 初始预算(callLLMRaw 内部再按
      // finish_reason=length 自动加倍到 16000),避免思考吃光预算导致正文为空。
      // PR-3:stage=topic_cand(筛候选)。
      const candRoute = resolveRoute('topic_cand');
      raw = await callLLMRaw(getActiveCandPrompt(), userPrompt, { ...cfg, model: candRoute.model }, true, 8000);
    } catch (e) {
      if (attempt >= MAX) {
        setStatusErrorWithAction(`AI 筛论文失败: ${(e as Error).message}`, '🔄 重试', () => filterCandidatesByLLM(targetN));
        inFlightController = null;
        return;
      }
      continue;
    }
    try {
      arr = JSON.parse(raw);
    } catch {
      if (attempt >= MAX) {
        setStatusErrorWithAction(`AI 筛论文返回不是 JSON: ${raw.slice(0, 100)}`, '🔄 重试', () => filterCandidatesByLLM(targetN));
        inFlightController = null;
        return;
      }
      continue;
    }
    if (Array.isArray(arr) && arr.length > 0) break;
  }
  // 把 LLM 选出的 arxivId 转成 Set
  const picked = new Set<string>();
  for (const item of arr) {
    const id = String(item.arxivId ?? '').trim();
    if (id) picked.add(canonicalId(id));
  }
  if (picked.size === 0) {
    setStatusErrorWithAction('AI 没选出任何论文', '🔄 重试', () => filterCandidatesByLLM(targetN));
    inFlightController = null;
    return;
  }

  // 应用勾选:在 picked 里的设 true,其他全 false
  for (const e of allEntries) {
    e.cand.selected = picked.has(canonicalId(e.cand.arxivId));
  }
  renderCandStage();
  persistSession(current!);
  inFlightController = null; // 先置空,再报成功 — 否则 setStatus 会误判为「仍在飞」而挂 spinner/停止按钮
  setStatus(`✓ AI 筛论文完成:从 ${unique.length} 篇中选了 ${picked.size} 篇。点「🚀 总结选中论文」开始总结。`, 'success');
}

// ============================================================================
// 工具函数
// ============================================================================

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};


// ============================================================================
// 当前会话状态(模块作用域)
// ============================================================================

let current: TopicSession | null = null;
let inFlightController: AbortController | null = null;
// ============================================================================
// ============================================================================
// 阶段动作(用户触发)
// ============================================================================

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
  inFlightController = new AbortController();
  const n = current.summaries.length;
  const startedAt = Date.now();
  setStatus(`📊 正在为 ${n} 篇论文生成主题报告...`);
  // 等计时器:报告生成是单次 LLM 调用 + 最多 2 次重试,30s-3min 没中间反馈,
  // 状态条加个「已等待 X 秒」让用户知道还活着。
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
    inFlightController = null;
  }
}

// ============================================================================
// 报告追问 / 修改建议(阶段 5 chat)
// ============================================================================

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
    inFlightController = new AbortController();
    const a = await chatWithReport(
      current.report,
      current.topic,
      current.summaries,
      q,
      current.reportChats.slice(0, -1), // 不含本轮 user 消息
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
    inFlightController = null;
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

// 用户点「应用最近一轮修改建议并重新生成报告」
// 实现:从最近一轮 assistant 消息中抽取 user 在前面要求的修改建议,作为 userNotes 拼进
//       generateTopicReport 的 prompt(走 'incremental' 模式保留 prevDimensions),让 LLM
//       基于建议重写报告。如果最近一轮 assistant 并不是修改建议(只是普通回答),则提示用户。
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
  // 启发式:assistant 消息以「修改建议」「建议:」或含「改」/「调整」/「重写」等动词开头 → 视为修改建议。
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
  inFlightController = new AbortController();
  ($<HTMLButtonElement>('report-gen-btn')).disabled = true;
  setStatus('🔄 正在按修改建议重生成报告...');
  try {
    // 把建议拼到 topic 后面,作为 userNotes 带入 prompt
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
    inFlightController = null;
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
  inFlightController = new AbortController();
  setStatus('🔍 拆解思路中...');
  ($<HTMLButtonElement>('decompose-btn')).disabled = true;
  try {
    // 用户在 modal 里选的论文一并喂给 LLM(同时支持 ?from=selection 入口,会
    // 跳过手动 textarea 走 doExploreFromSeeds 单独路径,这里不会与它冲突)。
    const seeds = loadSelection();
    const decomposition = await decomposeIdea(idea, seeds);
    current.topic = idea;
    current.subqs = decomposition.subqs;
    current.facets = decomposition.facets.length > 0 ? decomposition.facets : undefined;
    // 记录拆解时参考了的论文 ID(用于阶段 5 报告剔除重复时参考,以及
    // UI 提示"这些论文作为前提"),不参与后续逻辑判定。
    current.referenceSeedArxivIds = seeds.map((s) => canonicalId(s.arxivId));
    // 清掉旧的候选/总结(主题变了)
    current.candidatesBySubq = {};
    current.summaries = [];
    current.chats = {};
    // 主题报告也跟着清:旧报告基于上一次的总结,但主题/参考论文变了,旧报告过期
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
    inFlightController = null;
  }
}

async function doSearch(): Promise<void> {
  if (!current) return;
  const selected = current.subqs.filter((q) => q.selected);
  if (selected.length === 0) return;
  ($<HTMLButtonElement>('search-btn')).disabled = true;
  inFlightController = new AbortController();
  setStatus(`📚 搜索 ${selected.length} 个子方向...`);
  // 清空旧候选
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
  // 统计命中情况
  const totalCands = Object.values(current.candidatesBySubq).reduce((a, b) => a + b.length, 0);
  const subqsSearched = Object.values(current.candidatesBySubq).filter((l) => l !== undefined).length;
  const subqsHit = Object.values(current.candidatesBySubq).filter((l) => (l || []).length > 0).length;
  // 收集 searchForDirection 失败的子方向错误信息(主 query 抛错时附在 subq.searchError)
  const failedDetails = result.err.map((e) => {
    const sq = e.item as SubQ;
    const detail = sq.searchError ? `\n  · ${sq.label}: ${sq.searchError}` : `\n  · ${sq.label}: ${(e.error as Error).message.slice(0, 120)}`;
    return detail;
  }).join('');
  if (result.err.length > 0) {
    const msg = result.err.map((e) => (e.error as Error).message).join('; ');
    if (totalCands === 0) {
      // 完全没拿到论文 — 提示重试 + 给出失败详情
      setStatusErrorWithAction(`所有子方向都未命中(代理或网络问题): ${msg.slice(0, 100)}${failedDetails}`, '🔄 重试', () => doSearch());
    } else {
      setStatus(`部分子方向失败${failedDetails ? ` — 详情:${failedDetails}` : ''},共拿到 ${totalCands} 篇候选`, 'error');
      setTimeout(clearStatus, 3000);
    }
  } else if (totalCands === 0) {
    // 搜索成功但 0 命中 — 提示用户改 query
    setStatusErrorWithAction(`搜索完成但 ${subqsSearched} 个子方向都未命中论文。可能是 query 太冷门,试试改英文关键词。`, '🔄 重新搜索', () => doSearch());
  } else {
    setStatus(`✓ ${subqsHit}/${subqsSearched} 个子方向命中,共 ${totalCands} 篇候选`, 'success');
    setTimeout(clearStatus, 1500);
  }
  // 把当前会话里用户主动选的"参考论文"作为虚拟候选注入到 candidatesBySubq['__seeds__']
  // — 用户手动从 modal 加进来的论文,默认勾上,渲染时打 [📚 参考论文] 徽章,
  // 最终进入阶段 4 总结 + 阶段 5 报告。用 '__seeds__' 当 key 区分于子方向 group,
  // 阶段 4 在 doSummarize 选 candidates 时也读取。
  if (current.referenceSeedArxivIds && current.referenceSeedArxivIds.length > 0) {
    const seeds = loadSelection();
    const seedCands: Candidate[] = seeds
      .filter((s) => current!.referenceSeedArxivIds!.includes(canonicalId(s.arxivId)))
      .map((s) => {
        // 构造一个虚拟 ArxivEntry。论文库里的 SelectionItem 是带 selection
        // 摘要的; arXiv API 那条代码路径走 fetchArxivPdf + callLLM(SYSTEM_PROMPT
        // 单篇 prompt), entry 字段至少要 arxivId / title / summary 齐全。
        const summary =
          [s.method, s.result].filter(Boolean).join('\n').trim() ||
          s.tldr ||
          '(参考论文无摘要,只能基于标题与 TLDR 总结)';
        const entry: ArxivEntry = {
          id: `https://arxiv.org/abs/${s.arxivId}`,
          arxivId: s.arxivId,
          title: s.title,
          authors: [],
          summary,
          published: '',
          updated: '',
          pdfUrl: `https://arxiv.org/pdf/${s.arxivId}.pdf`,
        };
        return { arxivId: s.arxivId, entry, selected: true };
      });
    current.candidatesBySubq['__seeds__'] = seedCands;
    // seeds 默认选上后, 用户可以手动取消勾选(走与 arXiv 候选一样的 UI)
    // 这里注意 selected 已经设 true, 后面用户改 UI 会改同一个 selected
  }
  ($<HTMLButtonElement>('search-btn')).disabled = false;
  ($('stage-candidates') as HTMLDetailsElement).open = true;
  renderCandStage();
  renderSessionMeta();
  persistSession(current!);
  inFlightController = null;
}

async function doSummarize(limit?: number): Promise<void> {
  if (!current) return;
  // 收集所有勾选的候选
  const picks: Array<{ cand: Candidate; subqId: string }> = [];
  for (const [subqId, list] of Object.entries(current.candidatesBySubq)) {
    for (const c of list) if (c.selected) picks.push({ cand: c, subqId });
  }
  if (picks.length === 0) return;
  // 去重(同一篇可能来自多个子方向):保留第一条
  const seen = new Set<string>();
  const unique = picks.filter((p) => {
    const k = canonicalId(p.cand.arxivId);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // top-N 限制:用户论文多时(>100)默认只总结前 N 篇,避免几小时等待;
  // limit = undefined 或 0 = 总结全部;limit = N = 只总结前 N 篇。
  // 排序按 arXiv id 升序(新论文 id 数字更大,放在后面 — 但保持稳定)。
  // 实际排序:candidates 已经按 searchForDirection 的 query+alias 命中顺序排过,
  // 这里直接截前 N 篇,保留命中顺序作为「重要度」近似。
  const totalCandidates = unique.length;
  if (limit && limit > 0 && limit < unique.length) {
    unique.length = limit;
  }
  const totalToSummarize = unique.length;

  // 清掉旧总结(只清这批论文的)
  const ids = new Set(unique.map((p) => p.cand.arxivId));
  current.summaries = current.summaries.filter((s) => !ids.has(s.arxivId));
  // 同步清掉这些 paper 的追问(可选:保留,但 user 可能觉得混乱)
  for (const id of ids) delete current.chats[id];

  ($<HTMLButtonElement>('summarize-btn')).disabled = true;
  ($<HTMLButtonElement>('summarize-top-btn'))?.setAttribute('disabled', 'true');
  ($<HTMLButtonElement>('summarize-all-btn'))?.setAttribute('disabled', 'true');
  inFlightController = new AbortController();
  ($('stage-summaries') as HTMLDetailsElement).open = true;

  // ETA 计算:用前 3 篇的平均耗时做样本,推断剩余。论文很多时(>50)立刻有样本;
  // 论文少时(<5)用 25s 默认估计。
  const startedAt = Date.now();
  const sampleDurations: number[] = [];

  const limitDesc = limit && limit < totalCandidates ? `前 ${totalToSummarize}/${totalCandidates} 篇` : `${totalToSummarize} 篇`;
  setStatus(`🚀 总结 ${limitDesc}(并发 LLM ${SUMMARIZE_CONCURRENCY} + PDF 预热 ${PDF_PREFETCH_CONCURRENCY},流水线)...`);

  // 心跳定时器:LLM 慢时(单篇 30-60s)onProgress 很久不触发,状态条文本
  // 不变 → 用户以为卡住。每 2s 强制刷一次状态条,显示已用时间 + 当前
  // 预热池状态(用 setStatus 重渲染会被 inFlightController 检测逻辑
  // 自动附 ⏹ 停止按钮,顺手做也加在这里)。
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

  // 阶段 1+2 流水线:PDF 预热和 LLM 总结并发跑(不阻塞等所有 PDF 下完再开 LLM)。
  // 启动一个独立的后台任务跑 PDF 预热(PDF_PREFETCH_CONCURRENCY=6 路并发),
  // LLM 主任务(SUMMARIZE_CONCURRENCY=4 路)同时从 pdfTextCache 拿 text。
  // 每篇 LLM 完成时,顺手把还没预热的 PDF 加入预热队列(由 LLM 阶段的 worker 触发)。
  pdfTextCache.clear();
  // 启动合并式增量报告定时器:每 8s 检查"自从上次报告以来新加了 ≥1 篇",是则触发
  // 一次增量 LLM(避免 4 路 worker 各自触发 LLM 把配额打爆)。
  startIncrementalReportTimer(current);
  // 后台预热任务:fire-and-forget。不 await,跟 LLM 主任务并发。
  void (async () => {
    try {
      await runConcurrent(unique, PDF_PREFETCH_CONCURRENCY, async ({ cand }) => {
        // 如果 cache 里没 pending/ready(可能被 LLM 抢先同步预热过),跳过
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

  // LLM 阶段:4 路并发跑 summarizeOne。summarizeOne 内部会从 pdfTextCache 拿 text,
  // 拿不到就阻塞同步预热这一篇(预热池同时在跑别的,基本不会撞车)。
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
        // 实时统计预热状态
        const readyN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'ready').length;
        const pendingN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'pending').length;
        const failN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'failed').length;
        let eta = '';
        // ETA 算法:样本 ≥ 5 后用中位数(比均值更稳,不被一两篇异常拖偏),
        // 并且 `remain × median / CONCURRENCY` 上限 6h 防止估算炸(7.7s/篇 × 391 剩 / 4 路
        // = 12.5 分钟,但样本里有 5s 和 60s 混着时均值会跳)。样本 < 5 时只显示已用时间。
        if (sampleDurations.length >= 5) {
          const sorted = [...sampleDurations].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          const remain = Math.max(0, total - d);
          // elapsed / d 给出真实吞吐(秒/篇),比 median/CONCURRENCY 更准(因为
          // LLM 4 路 + PDF 6 路 实际串了 PDF,吞吐不会无限逼近 4×LLM 速度)
          const observedTput = elapsed / Math.max(d, 1); // 秒/篇
          let etaSec = Math.round(observedTput * remain);
          // 钳制:大于 6 小时显示「>6h」提示用户中断
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
        // 节流 persistSession:每 5 篇 + 最后 1 篇才写 localStorage,避免 LLM 完成
        // 太频繁时 JSON.stringify + localStorage.setItem 阻塞主线程(主线程挂起
        // 表现为「界面卡住」)
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
          // 增量报告由合并式定时器统一处理(避免 4 路 worker 各自
          // 触发 LLM)。doSummarize 启动时调用 startIncrementalReportTimer。
        } else if (err) {
          console.warn('[topic] summarize failed:', err.message);
        }
      },
    );
  } finally {
    // 任何路径下都清心跳和 controller,避免定时器泄漏
    clearInterval(heartbeat);
    inFlightController = null;
  }

  // 停掉合并式增量报告定时器(doSummarize 结束 = 任务完成,不再触发增量)
  stopIncrementalReportTimer();

  // 等待后台预热结束(避免 cache 在 LLM 完成后被 clear 时还有 pending)。
  // 给预热最多 60s grace period,超时也不阻塞。
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

  // 阶段 1 + 2 都已完成,清 PDF 缓存
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


function startNewSession(): void {
  if (current && (current.subqs.length > 0 || current.summaries.length > 0)) {
    if (!confirm('确定要新建会话?当前会话的论文和追问会被清空(已写入 localStorage 的旧会话可手动清除)。')) return;
  }
  if (current) deleteSession(current);
  current = null;
  ($<HTMLTextAreaElement>('topic-input')).value = '';
  clearBanner();
  clearStatus();
  renderAll();
}

// ============================================================================
// 基于已选论文(seed papers)的迁移探索 — 由 ?from=selection URL 触发入口
// ============================================================================

// 注入"📚 基于已选 N 篇论文探索"卡片到 #seeds-pill-slot(#stage-input 之前)
function renderSeedsPill(seeds: SelectionItem[]): void {
  const slot = document.getElementById('seeds-pill-slot');
  if (!slot || seeds.length === 0) return;
  slot.innerHTML = `
    <div class="seeds-pill" id="seeds-pill">
      <div class="seeds-pill-icon">📚</div>
      <div class="seeds-pill-body">
        <div class="seeds-pill-title">基于已选 ${seeds.length} 篇论文探索</div>
        <div class="seeds-pill-desc">跳过手动输入思路,模型会读取每篇的 TLDR/方法/结果,生成 4-6 个迁移/探索方向(跨域迁移 / 方法借鉴 / 反向工程 / 组合创新)。</div>
      </div>
      <button type="button" class="topic-btn primary seeds-pill-btn" id="seeds-explore-btn">🚀 开始迁移探索</button>
    </div>
  `;
  document.getElementById('seeds-explore-btn')?.addEventListener('click', () => doExploreFromSeeds());
}

// 隐藏"来自已选论文"入口卡片(在迁移探索完成后调用,避免重复触发)
function hideSeedsPill(): void {
  const slot = document.getElementById('seeds-pill-slot');
  if (slot) slot.innerHTML = '';
}

async function doExploreFromSeeds(): Promise<void> {
  const seeds = loadSelection();
  if (seeds.length === 0) {
    setStatus('已选论文为空,请先在论文详情页加入选集', 'error');
    return;
  }
  const cfg = loadSettings() as LLMConfig;
  if (!cfg.apiKey) {
    renderBanner('请先在 <a href="/settings/">设置</a> 页面填 LLM API Key。');
    return;
  }

  // 当前会话已经有内容 → 二次确认(沿用 startNewSession 的提示风格)
  if (current && (current.subqs.length > 0 || current.summaries.length > 0)) {
    if (!confirm(`开始迁移探索会清空当前会话的 ${current.subqs.length} 个子方向和 ${current.summaries.length} 篇已总结论文,确定吗?`)) {
      return;
    }
  }

  // 创建全新会话(不弹 startNewSession 的 confirm,因为上面已经问过了)
  if (current) deleteSession(current);
  current = {
    id: uid('ts'),
    topic: `基于 ${seeds.length} 篇已选论文的迁移探索`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    subqs: [],
    candidatesBySubq: {},
    summaries: [],
    chats: {},
  };
  {
    const store2 = loadStore();
    store2.currentId = current.id;
    store2.sessions[current.id] = current;
    saveStore(store2);
  }
  // 把 textarea 同步成新 topic(给用户反馈)
  const ta = $<HTMLTextAreaElement>('topic-input');
  ta.value = current.topic;
  ($<HTMLButtonElement>('decompose-btn')).disabled = true;

  hideSeedsPill();
  clearBanner();
  inFlightController = new AbortController();
  setStatus(`🌱 基于 ${seeds.length} 篇已选论文生成迁移方向...`);

  try {
    const subqs = await exploreFromSeeds(seeds, cfg);
    if (subqs.length === 0) {
      throw new Error('LLM 未返回任何迁移方向');
    }
    current.subqs = subqs;
    ($('stage-subqs') as HTMLDetailsElement).open = true;
    renderAll();
    persistSession(current!);
    setStatus(`✓ 已生成 ${subqs.length} 个迁移方向,勾选后搜索 arXiv`, 'success');
    setTimeout(clearStatus, 2000);
  } catch (e) {
    setStatusErrorWithAction(`迁移探索失败: ${(e as Error).message}`, '🔄 重试', () => doExploreFromSeeds());
  } finally {
    inFlightController = null;
  }
}

// ============================================================================
// Modal 状态:📚 添加参考论文
// ============================================================================

let modalOpen = false;

function openAddSeedsModal(): void {
  const modal = document.getElementById('add-seeds-modal');
  if (!modal) return;
  renderAddSeedsModalList();
  // 不清空搜索框 / 不重置结果区 — 用户上次关 modal 时的状态保持,除非他手动输入
  modal.classList.remove('topic-hidden');
  modalOpen = true;
  document.getElementById('add-seeds-search-input')?.focus();
}

function closeAddSeedsModal(): void {
  const modal = document.getElementById('add-seeds-modal');
  if (!modal) return;
  modal.classList.add('topic-hidden');
  modalOpen = false;
}

function renderAddSeedsModalList(): void {
  const wrap = document.getElementById('add-seeds-list');
  if (!wrap) return;
  const items = loadSelection();
  if (items.length === 0) {
    wrap.innerHTML =
      '<div class="topic-modal-empty">还没有参考论文 — 上方输入论文标题搜索,或展开「已知 arXiv ID」直接添加。</div>';
    return;
  }
  wrap.innerHTML = items
    .map(
      (it) => `
    <div class="topic-modal-list-item" data-arxiv="${escapeHtml(it.arxivId)}">
      <span class="topic-modal-list-badge">已加入</span>
      <a href="/papers/${encodeURIComponent(it.arxivId)}/" target="_blank" rel="noopener" class="topic-link topic-modal-list-id">
        arXiv:${escapeHtml(it.arxivId)}
      </a>
      <span class="topic-modal-list-title">${escapeHtml(it.title)}</span>
      <button type="button" class="topic-btn ghost topic-modal-list-remove" data-act="remove" title="从参考列表移除">✕</button>
    </div>`,
    )
    .join('');
  wrap.querySelectorAll<HTMLElement>('.topic-modal-list-item').forEach((row) => {
    const ax = row.dataset.arxiv!;
    row.querySelector<HTMLButtonElement>('[data-act="remove"]')!.addEventListener('click', () => {
      removeFromSelection(ax);
    });
  });
}

function updateSeedsCounter(): void {
  const chip = document.getElementById('seeds-counter-chip');
  const nEl = document.getElementById('seeds-counter-n');
  if (!chip || !nEl) return;
  const n = loadSelection().length;
  nEl.textContent = String(n);
  chip.hidden = n === 0;
  const modalCount = document.getElementById('add-seeds-count');
  if (modalCount) modalCount.textContent = String(n);
  // 阶段 1 banner 也要随 selection 变化(增/减论文都该立刻反映)
  renderStageInputSeedsBanner();
}

async function submitAddSeedsUrl(_form: HTMLFormElement): Promise<void> {
  const input = document.getElementById('add-seeds-url-input') as HTMLInputElement | null;
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) {
    input.focus();
    return;
  }
  const m = raw.match(/(\d{4}\.\d{4,5})(v\d+)?/);
  if (!m) {
    setStatus(`无法从 "${raw}" 识别 arXiv ID`, 'error');
    return;
  }
  try {
    setStatus(`📥 正在获取 arXiv:${m[1]} 的元数据...`);
    const entries = await searchArxivById(m[1]);
    if (!entries.length) throw new Error('未找到该论文');
    const e = entries[0];
    // 用 arXiv abstract 作为 tldr 占位 — exploreFromSeeds 的 useful filter
    // 会因 method 缺失而跳过,所以"从 URL 加"只适合作为显示/复制种子,
    // 想用作迁移探索种子请从论文库选。
    addToSelection({
      arxivId: e.arxivId,
      title: e.title,
      tldr: e.summary.slice(0, 400),
      method: '',
      result: '',
      tags: [],
      addedAt: Date.now(),
    });
    input.value = '';
    setStatus(`✓ 已加入 arXiv:${e.arxivId}`, 'success');
    setTimeout(clearStatus, 1500);
  } catch (err) {
    setStatus(`获取失败: ${(err as Error).message}`, 'error');
  }
}

// ============================================================================
// 标题搜索:联网 arXiv,debounce + 结果渲染
// ============================================================================

// 复用 paper-analyzer.ts 已 export 的 searchArxiv(mode: 'title' 默认就是标题语义)。
// 前端再叠一层简单的 token 排序:标题真的命中查询 token 的条目排前面。
function rankArxivResults(entries: ArxivEntry[], query: string): ArxivEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const score = (e: ArxivEntry): number => {
    const t = e.title.toLowerCase();
    let s = 0;
    for (const tok of tokens) {
      if (t.includes(tok)) s += 10;
      if (t.startsWith(tok)) s += 5;
      if (e.summary.toLowerCase().includes(tok)) s += 1;
    }
    return s;
  };
  return [...entries].sort((a, b) => score(b) - score(a));
}

let arxivSearchAbort: AbortController | null = null;
let arxivSearchSeq = 0; // 竞态:只保留最后一次的结果,旧的渲染请求全部丢弃

async function searchArxivByTitle(query: string): Promise<ArxivEntry[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  if (arxivSearchAbort) arxivSearchAbort.abort();
  arxivSearchAbort = new AbortController();
  const seq = ++arxivSearchSeq;
  try {
    // paper-analyzer.ts 已 export searchArxiv(query, { mode: 'title' }),默认就是 ti: 语义
    const entries = await searchArxiv(q, { dedupeLatestVersion: true });
    if (seq !== arxivSearchSeq) return []; // 用户已经输入了更新的 query,丢掉
    return rankArxivResults(entries, q);
  } catch (e) {
    if ((e as Error).name === 'AbortError') return [];
    throw e;
  }
}

function renderArxivSearchResults(entries: ArxivEntry[]): void {
  const wrap = document.getElementById('add-seeds-search-results');
  if (!wrap) return;
  if (!entries.length) {
    wrap.innerHTML =
      '<div class="topic-modal-search-empty">未命中 — 试试更短的关键词、英文术语、或下方的「已知 arXiv ID」直接添加。</div>';
    return;
  }
  wrap.innerHTML = entries
    .slice(0, 12)
    .map((e) => {
      const id = canonicalId(e.arxivId);
      const already = isInSelection(id);
      const btnText = already ? '✓ 已加入' : '➕ 加入';
      return `
    <div class="topic-modal-search-item" data-arxiv="${escapeHtml(e.arxivId)}">
      <div class="topic-modal-search-item-main">
        <div class="topic-modal-search-item-title">${escapeHtml(e.title)}</div>
        <div class="topic-modal-search-item-meta">
          <span class="topic-modal-search-item-id">arXiv:${escapeHtml(e.arxivId)}</span>
          <span class="topic-modal-search-item-authors">${escapeHtml(e.authors.slice(0, 3).join(', ') + (e.authors.length > 3 ? ' …' : ''))}</span>
          <span class="topic-modal-search-item-date">${escapeHtml(e.published.slice(0, 10))}</span>
        </div>
        <div class="topic-modal-search-item-summary">${escapeHtml(e.summary.slice(0, 220))}${e.summary.length > 220 ? '…' : ''}</div>
      </div>
      <button type="button" class="topic-btn primary topic-modal-search-item-add" data-act="add"${already ? ' disabled' : ''}>${btnText}</button>
    </div>`;
    })
    .join('');
  wrap.querySelectorAll<HTMLElement>('.topic-modal-search-item').forEach((row) => {
    const ax = row.dataset.arxiv!;
    row.querySelector<HTMLButtonElement>('[data-act="add"]')!.addEventListener('click', () => {
      addSearchResultToSelection(ax);
    });
  });
}

function addSearchResultToSelection(arxivId: string): void {
  const wrap = document.getElementById('add-seeds-search-results');
  if (!wrap) return;
  // 让用户能看到当前已选 — 通过 loadSelection 检测重复
  if (isInSelection(arxivId)) {
    setStatus(`arXiv:${arxivId} 已在参考列表中`, '');
    setTimeout(clearStatus, 1500);
    return;
  }
  // arxivId 形如 1706.03762v7,canonicalId 会去掉 v# 后缀。
  const canonId = canonicalId(arxivId);
  // 直接从当前渲染结果里读 entry 元数据 — 不必再走 searchArxivById 拿。
  const card = wrap.querySelector<HTMLElement>(
    `.topic-modal-search-item[data-arxiv="${CSS.escape(arxivId)}"]`,
  );
  const title = card?.querySelector('.topic-modal-search-item-title')?.textContent?.trim() || canonId;
  const sumText = card?.querySelector('.topic-modal-search-item-summary')?.textContent?.trim() || '';
  addToSelection({
    arxivId: canonId,
    title,
    tldr: sumText.slice(0, 400),
    method: '',
    result: '',
    tags: [],
    addedAt: Date.now(),
  });
  setStatus(`✓ 已加入 arXiv:${canonId}`, 'success');
  setTimeout(clearStatus, 1500);
  // 屏蔽重复添加 — 把按钮 disabled
  if (card) {
    const btn = card.querySelector<HTMLButtonElement>('[data-act="add"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '✓ 已加入';
    }
  }
}

// 搜索输入:debounce 250ms。沿用 paper-analyzer 已有的 searchArxiv()。
function setupAddSeedsSearch(): void {
  const input = document.getElementById('add-seeds-search-input') as HTMLInputElement | null;
  if (!input) return;
  const debounceMs = 250;
  let timer: number | undefined;
  input.addEventListener('input', () => {
    const v = input.value;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try {
        if (v.trim().length < 3) {
          const wrap = document.getElementById('add-seeds-search-results');
          if (wrap) wrap.innerHTML = '';
          return;
        }
        const wrapEl = document.getElementById('add-seeds-search-results');
        if (wrapEl) wrapEl.innerHTML = '<div class="topic-modal-search-empty">🔍 正在搜索...</div>';
        const entries = await searchArxivByTitle(v);
        renderArxivSearchResults(entries);
      } catch (e) {
        const wrapEl = document.getElementById('add-seeds-search-results');
        if (wrapEl) {
          wrapEl.innerHTML = `<div class="topic-modal-search-empty topic-modal-search-error">搜索失败: ${escapeHtml((e as Error).message)}</div>`;
        }
      }
    }, debounceMs);
  });
}

// ============================================================================
// Init
// ============================================================================

function ensureSession(): void {
  if (current) return;
  const store = loadStore();
  if (store.currentId && store.sessions[store.currentId]) {
    current = store.sessions[store.currentId];
    setStatus('✓ 已恢复上次会话', 'success');
    setTimeout(clearStatus, 1500);
  } else {
    current = {
      id: uid('ts'),
      topic: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      subqs: [],
      candidatesBySubq: {},
      summaries: [],
      chats: {},
    };
    const store2 = loadStore();
    store2.currentId = current.id;
    store2.sessions[current.id] = current;
    saveStore(store2);
  }
}

function init(): void {
  // 主题页自己管 selection 弹层,与 paper-selection.ts 的浮动 action-bar 重复,
  // 且会自指跳到 /topic/?from=selection。打标记让 paper-selection.ts 跳过。
  document.body.dataset.noSelectionBar = '';

  // 检查 LLM key
  const cfg = loadSettings() as LLMConfig;
  if (!cfg.apiKey) {
    renderBanner('⚠️ 你还没填 LLM API Key,先去 <a href="/settings/">设置</a> 页面填一下。');
  }

  ensureSession();
  renderAll();

  // 监听输入 → 拆解按钮 enable
  $<HTMLTextAreaElement>('topic-input').addEventListener('input', (e) => {
    const v = (e.target as HTMLTextAreaElement).value.trim();
    ($<HTMLButtonElement>('decompose-btn')).disabled = !v;
    if (current) {
      current.topic = (e.target as HTMLTextAreaElement).value;
      persistSession(current);
    }
  });

  // 主按钮
  $<HTMLButtonElement>('decompose-btn').addEventListener('click', doDecompose);
  $<HTMLButtonElement>('search-btn').addEventListener('click', doSearch);
  $<HTMLButtonElement>('summarize-btn').addEventListener('click', () => doSummarize());
  // top-N 按钮:论文多时只总结前 20 篇,避免长时间等待(用户可继续追加).
  $<HTMLButtonElement>('summarize-top-btn').addEventListener('click', () => doSummarize(20));
  // 总结全部:不传 limit(走 unique.length 全量).
  $<HTMLButtonElement>('summarize-all-btn').addEventListener('click', () => doSummarize());
  // 阶段 3.5:AI 筛论文 → 从所有候选中选最相关的 30 篇
  $<HTMLButtonElement>('filter-cand-btn').addEventListener('click', () => filterCandidatesByLLM(30));
  $<HTMLButtonElement>('subq-add-btn').addEventListener('click', () => {
    if (!current) return;
    current.subqs.push({
      id: uid('q'),
      label: '新子方向',
      query: '',
      reason: '',
      selected: true,
    });
    renderFacetStage(); // 新子方向未归属任何维度,刷新面板的"未归属"提示
    renderSubqStage();
    persistSession(current!);
  });
  // 阶段 2:添加研究维度(facet)
  document.getElementById('facet-add-btn')?.addEventListener('click', () => addFacet());

  // 顶栏
  $<HTMLButtonElement>('new-session-btn').addEventListener('click', startNewSession);
  $<HTMLButtonElement>('copy-all-btn').addEventListener('click', copyAllAsMarkdown);

  // 阶段 1:📚 添加参考论文弹层
  $<HTMLButtonElement>('add-seeds-btn').addEventListener('click', openAddSeedsModal);
  document.getElementById('stage-input-seeds-edit')?.addEventListener('click', openAddSeedsModal);
  document.getElementById('add-seeds-modal')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.dataset.act === 'close-mask' || target.dataset.act === 'close-modal') {
      closeAddSeedsModal();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOpen) closeAddSeedsModal();
  });
  document.getElementById('add-seeds-clear-all')?.addEventListener('click', () => {
    const items = loadSelection();
    if (items.length === 0) return;
    if (items.length >= 3 && !confirm(`确定清空已选 ${items.length} 篇参考论文?`)) return;
    clearSelection();
  });
  document.getElementById('add-seeds-url-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitAddSeedsUrl(e.currentTarget as HTMLFormElement);
  });
  setupAddSeedsSearch();
  document.addEventListener('paper-selection-change', () => {
    updateSeedsCounter();
    if (modalOpen) renderAddSeedsModalList();
  });

  // 阶段 5:报告按钮 + 增量开关
  $<HTMLButtonElement>('report-gen-btn').addEventListener('click', doGenerateReport);
  $<HTMLButtonElement>('report-copy-btn').addEventListener('click', copyReportAsMarkdown);
  $<HTMLButtonElement>('report-download-btn').addEventListener('click', downloadReportAsMarkdown);
  $<HTMLInputElement>('report-incremental-toggle').addEventListener('change', (e) => {
    setStatus(
      (e.target as HTMLInputElement).checked
        ? '✓ 已开启增量更新 — 后续每篇速览完成会自动刷新报告'
        : '已关闭增量更新',
      '',
    );
    setTimeout(clearStatus, 1800);
  });

  // ?from=selection 入口 — 在 stage 1 之前注入"📚 基于已选 N 篇论文探索"卡片
  // 用 try/catch 包裹,避免 seeds 相关 bug 影响主页面
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('from') === 'selection') {
      // 清除 URL 上的 from=selection,避免刷新页面时再次注入
      try {
        const url = new URL(location.href);
        url.searchParams.delete('from');
        history.replaceState(null, '', url.toString());
      } catch { /* ignore */ }
      const seeds = loadSelection();
      if (seeds.length > 0) {
        renderSeedsPill(seeds);
      }
    }
  } catch (e) {
    console.warn('[topic] 注入已选论文入口失败:', (e as Error).message);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}