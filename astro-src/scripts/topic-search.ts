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
const REPORT_INC_THROTTLE_MS = 8000;
// 报告生成 LLM 重试次数
const REPORT_LLM_RETRY = 2;


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
// 状态机:5 个阶段
// ============================================================================


// ============================================================================
// DOM 渲染

function renderSessionMeta(): void {
  const meta = $('session-meta');
  if (!current) {
    meta.textContent = '尚未开始 — 在下方输入一段研究思路';
    ($('copy-all-btn') as HTMLButtonElement).disabled = true;
    return;
  }
  const subqN = current.subqs.length;
  const candN = Object.values(current.candidatesBySubq).reduce((a, b) => a + b.length, 0);
  const sumN = current.summaries.length;
  const qaN = Object.values(current.chats).reduce((a, b) => a + b.length, 0);
  const ideaPreview = (current.topic || '').slice(0, 50) + ((current.topic || '').length > 50 ? '…' : '');
  meta.textContent =
    `已拆解 ${subqN} 个方向 · 候选 ${candN} 篇 · 已总结 ${sumN} 篇 · 追问 ${qaN} 轮` +
    (ideaPreview ? ` · "${ideaPreview}"` : '');
  ($('copy-all-btn') as HTMLButtonElement).disabled = sumN === 0;
}

function renderInputStage(): void {
  const ta = $<HTMLTextAreaElement>('topic-input');
  ta.value = current?.topic ?? '';
  const btn = $<HTMLButtonElement>('decompose-btn');
  btn.disabled = !ta.value.trim();
  $('input-hint').textContent = current
    ? '已拆解过 — 修改后再次点拆解会覆盖现有子方向。'
    : '提示:思路越具体,拆解出的子方向越精准。';
  renderStageInputSeedsBanner();
}

// 阶段 1 banner:当选了 N > 0 篇参考论文时显示,告诉用户这些论文会被拆解 prompt 看到。
function renderStageInputSeedsBanner(): void {
  const banner = document.getElementById('stage-input-seeds-banner');
  if (!banner) return;
  const countEl = document.getElementById('stage-input-seeds-count');
  const detailEl = document.getElementById('stage-input-seeds-detail');
  const seeds = loadSelection();
  if (seeds.length === 0) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  if (countEl) countEl.textContent = String(seeds.length);
  if (detailEl) {
    // 列首 3 篇标题,多则折叠 (+N)
    const display = seeds.slice(0, 3).map((s) => s.title).join(' · ');
    const more = seeds.length > 3 ? ` +${seeds.length - 3}` : '';
    detailEl.textContent = display ? `${display}${more}` : '';
  }
}

// 只更新 subq-meta 文本(facet 改选时用,不重绘整列)——与 renderSubqStage 里的逻辑一致。
function refreshSubqMeta(): void {
  if (!current) return;
  const subqMeta = document.getElementById('subq-meta');
  if (!subqMeta) return;
  const selectedCount = current.subqs.filter((s) => s.selected).length;
  const facets = current.facets ?? [];
  if (facets.length > 0) {
    const cov = computeFacetCoverage(facets, current.subqs);
    const covered = facets.length - cov.uncoveredFacetIds.length;
    const parts = [`共 ${current.subqs.length} 个,已选 ${selectedCount}`, `维度覆盖 ${covered}/${facets.length}`];
    if (cov.redundantFacetIds.length > 0) parts.push(`${cov.redundantFacetIds.length} 个可能重复`);
    if (cov.unassignedSubqIds.length > 0) parts.push(`${cov.unassignedSubqIds.length} 个未归属`);
    subqMeta.textContent = parts.join(' · ');
  } else {
    subqMeta.textContent = `共 ${current.subqs.length} 个,已选 ${selectedCount}`;
  }
}

// ============================================================================
// 阶段 2:研究维度(facet)面板
// ============================================================================

// 渲染 facet 面板:每个维度一个 chip(label / category / note 可编辑 + subq 计数 + 状态)。
// 无 facets(旧 session / seed 探索 / legacy 数组 fallback)→ 隐藏面板。
// 输入 input 事件只存值 + 刷新计数,不整块重绘(防丢焦点);增删 / 改 category 才全重绘。
function renderFacetStage(): void {
  const panel = document.getElementById('facet-panel');
  if (!panel) return;
  const facets = current?.facets ?? [];
  if (!current || facets.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const cov = computeFacetCoverage(facets, current.subqs);
  const countByFacet = new Map<string, number>();
  for (const sq of current.subqs) {
    if (sq.facetId) countByFacet.set(sq.facetId, (countByFacet.get(sq.facetId) ?? 0) + 1);
  }

  const meta = document.getElementById('facet-meta');
  if (meta) {
    const covered = facets.length - cov.uncoveredFacetIds.length;
    meta.textContent = `${facets.length} 个维度 · 已覆盖 ${covered}`;
  }

  const catOptions = (sel: FacetCategory): string =>
    (Object.keys(FACET_CATEGORY_LABELS) as FacetCategory[])
      .map((c) => `<option value="${c}"${c === sel ? ' selected' : ''}>${escapeHtml(FACET_CATEGORY_LABELS[c])}</option>`)
      .join('');

  const list = document.getElementById('facet-list');
  if (list) {
    list.innerHTML = facets
      .map((f) => {
        const n = countByFacet.get(f.id) ?? 0;
        const uncovered = n === 0;
        const redundant = n > 1;
        let stateCls = '';
        let stateTag = `<span class="topic-facet-chip-count">${n} 个子方向</span>`;
        if (uncovered) {
          stateCls = ' topic-facet-chip--uncovered';
          stateTag = `<span class="topic-facet-chip-count topic-facet-chip-state--warn" title="没有子方向归属此维度">未覆盖</span>`;
        } else if (redundant) {
          stateCls = ' topic-facet-chip--redundant';
          stateTag = `<span class="topic-facet-chip-count topic-facet-chip-state--warn" title="${n} 个子方向挂在同一维度,可能重复">${n} 个 · 可能重复</span>`;
        }
        return `
        <div class="topic-facet-chip${stateCls}" data-id="${escapeHtml(f.id)}">
          <div class="topic-facet-chip-main">
            <input type="text" class="topic-facet-label-input" data-field="label" value="${escapeHtml(f.label)}" placeholder="研究维度名" aria-label="维度名" />
            <select class="topic-facet-cat-select" data-field="category" aria-label="维度分类">${catOptions(f.category)}</select>
            ${stateTag}
            <button type="button" class="topic-btn ghost topic-facet-del" data-act="del-facet" title="删除此维度(关联子方向变为未分配)">✕</button>
          </div>
          <input type="text" class="topic-facet-note-input" data-field="note" value="${escapeHtml(f.note)}" placeholder="一句话说明这个维度在研究什么" aria-label="维度说明" />
        </div>`;
      })
      .join('');

    // 绑定 chip 交互
    list.querySelectorAll<HTMLElement>('.topic-facet-chip').forEach((chip) => {
      const fid = chip.dataset.id!;
      const facet = current!.facets?.find((f) => f.id === fid);
      if (!facet) return;
      // label / note:input 事件只存值,不重绘(防丢焦点);label 改动后 subq 显示会在下次
      // 重绘时按 facetId 查到最新 label,这里同步刷新已归属 subq 的 facetLabel 缓存。
      chip.querySelector<HTMLInputElement>('[data-field="label"]')?.addEventListener('input', (e) => {
        facet.label = (e.target as HTMLInputElement).value.slice(0, 60);
        for (const sq of current!.subqs) if (sq.facetId === fid) sq.facetLabel = facet.label;
        persistSession(current!);
      });
      chip.querySelector<HTMLInputElement>('[data-field="note"]')?.addEventListener('input', (e) => {
        facet.note = (e.target as HTMLInputElement).value.slice(0, 180);
        persistSession(current!);
      });
      // category 改动 → 全重绘(顺带更新分类显示)
      chip.querySelector<HTMLSelectElement>('[data-field="category"]')?.addEventListener('change', (e) => {
        const raw = (e.target as HTMLSelectElement).value;
        facet.category = raw as FacetCategory;
        renderFacetStage();
        persistSession(current!);
      });
      // 删除维度:关联 subq 变为未分配(不删 subq / 候选 / 总结)
      chip.querySelector<HTMLButtonElement>('[data-act="del-facet"]')?.addEventListener('click', () => {
        current!.facets = (current!.facets ?? []).filter((f) => f.id !== fid);
        for (const sq of current!.subqs) {
          if (sq.facetId === fid) {
            sq.facetId = undefined;
            sq.facetLabel = undefined;
          }
        }
        if (current!.facets.length === 0) current!.facets = undefined;
        renderFacetStage();
        renderSubqStage();
        persistSession(current!);
      });
    });
  }

  // coverage 文字提示
  const covEl = document.getElementById('facet-coverage');
  if (covEl) {
    const msgs: string[] = [];
    if (cov.uncoveredFacetIds.length > 0) {
      const names = cov.uncoveredFacetIds
        .map((id) => facets.find((f) => f.id === id)?.label || id)
        .join('、');
      msgs.push(`未覆盖:${names}`);
    }
    if (cov.redundantFacetIds.length > 0) {
      const names = cov.redundantFacetIds
        .map((id) => facets.find((f) => f.id === id)?.label || id)
        .join('、');
      msgs.push(`可能重复:${names}`);
    }
    if (cov.unassignedSubqIds.length > 0) {
      msgs.push(`${cov.unassignedSubqIds.length} 个子方向尚未归属任何维度`);
    }
    if (msgs.length === 0) {
      covEl.className = 'topic-facet-coverage topic-facet-coverage--ok';
      covEl.textContent = `已覆盖全部 ${facets.length} 个维度,未发现明显重复。`;
    } else {
      covEl.className = 'topic-facet-coverage topic-facet-coverage--warning';
      covEl.textContent = msgs.join(' · ') + '(仅提示,不影响搜索;可在下方子方向卡片改归属)';
    }
  }
}

// 阶段 2 底部「添加维度」按钮:新增一个空维度供用户手填。
function addFacet(): void {
  if (!current) return;
  if (!current.facets) current.facets = [];
  current.facets.push(buildFacet({ id: uid('facet'), label: '新维度', category: 'method', note: '' }));
  renderFacetStage();
  renderSubqStage();
  persistSession(current!);
}

function renderSubqStage(): void {
  const list = $('subq-list');
  const subqMeta = $('subq-meta');
  const searchBtn = $<HTMLButtonElement>('search-btn');
  if (!current || current.subqs.length === 0) {
    list.innerHTML = '<div style="color:var(--fg-subtle);font-size:0.88rem">尚未拆解 — 在第 1 步输入思路后点"🔍 拆解思路"。</div>';
    subqMeta.textContent = '尚未拆解';
    searchBtn.disabled = true;
    return;
  }
  const selectedCount = current.subqs.filter((s) => s.selected).length;
  const facets = current.facets ?? [];
  const hasFacets = facets.length > 0;
  // 覆盖自检 → subq-meta 追加摘要
  if (hasFacets) {
    const cov = computeFacetCoverage(facets, current.subqs);
    const covered = facets.length - cov.uncoveredFacetIds.length;
    const parts = [`共 ${current.subqs.length} 个,已选 ${selectedCount}`, `维度覆盖 ${covered}/${facets.length}`];
    if (cov.redundantFacetIds.length > 0) parts.push(`${cov.redundantFacetIds.length} 个可能重复`);
    if (cov.unassignedSubqIds.length > 0) parts.push(`${cov.unassignedSubqIds.length} 个未归属`);
    subqMeta.textContent = parts.join(' · ');
  } else {
    subqMeta.textContent = `共 ${current.subqs.length} 个,已选 ${selectedCount}`;
  }
  searchBtn.disabled = selectedCount === 0;
  // 构造 facet <select> 的 option 列表(仅在有 facets 时展示;无 facets → 旧布局)
  const facetOptionsFor = (sel?: string): string =>
    `<option value=""${!sel ? ' selected' : ''}>未分配维度</option>` +
    facets
      .map(
        (f) =>
          `<option value="${escapeHtml(f.id)}"${sel === f.id ? ' selected' : ''}>${escapeHtml(f.label || f.id)}</option>`,
      )
      .join('');
  list.innerHTML = current.subqs.map((q, i) => {
    const badgeHtml = q.explorationType
      ? `<span class="topic-subq-card-badge topic-subq-card-badge--${escapeHtml(q.explorationType)}" title="迁移范式:${escapeHtml(explorationTypeLabel(q.explorationType))}"><span class="topic-subq-card-badge-dot"></span>${escapeHtml(explorationTypeLabel(q.explorationType))}</span>`
      : '';
    const sourceTag =
      q.source === 'seeds'
        ? `<span class="topic-subq-card-source" title="从已选论文迁移探索">📚 来自已选论文</span>`
        : q.source === 'manual-with-seeds'
          ? `<span class="topic-subq-card-source topic-subq-card-source--seeds" title="拆解时同时参考了你在「添加参考论文」里选的论文">📚 参考论文+主题</span>`
          : '';
    // arXiv 命中标签:hitCount undefined → "验证中...";0 → 红色 0 命中;>=1 → 绿色 N 篇
    let hitTag = '';
    let cardClass = q.selected ? 'selected' : '';
    if (q.hitCount === undefined) {
      hitTag = '<span class="topic-subq-hit topic-subq-hit--pending">arXiv 验证中…</span>';
    } else if (q.hitCount === 0) {
      hitTag = `<span class="topic-subq-hit topic-subq-hit--zero" title="主 query 在 arXiv 上 0 召回,试试改英文关键词或加更多 aliases">⚠ 0 命中</span>`;
      cardClass += ' topic-subq-card--zero-hit';
    } else {
      hitTag = `<span class="topic-subq-hit topic-subq-hit--ok" title="实测 arXiv 前 5 条命中 ${q.hitCount} 篇${q.hitSamples?.length ? '\\n样例:\\n' + q.hitSamples.slice(0, 3).join('\\n') : ''}">arXiv 命中 ${q.hitCount} 篇</span>`;
    }
    return `
    <div class="topic-subq-card ${cardClass}" data-id="${q.id}">
      <input type="checkbox" class="topic-subq-check" ${q.selected ? 'checked' : ''} aria-label="勾选子方向 ${i + 1}" />
      <div class="topic-subq-card-main">
        <div class="topic-subq-card-row">
          <input type="text" class="label-input" value="${escapeHtml(q.label)}" data-field="label" placeholder="子方向标题" />
          ${badgeHtml}
          ${sourceTag}
          ${hitTag}
          <div class="topic-subq-card-actions">
            <button type="button" class="topic-btn ghost" data-act="verify-hit" title="用当前 query 实测 arXiv 命中数">🔬 验证</button>
            <button type="button" class="topic-btn ghost" data-act="regen" title="重新生成此子方向">🔄</button>
            <button type="button" class="topic-btn ghost" data-act="del" title="删除此子方向">✕</button>
          </div>
        </div>
        <div class="topic-subq-card-row">
          <input type="text" class="query-input" value="${escapeHtml(q.query)}" data-field="query" placeholder="arXiv 检索 query(英文)" />
        </div>
        <div class="topic-subq-card-row">
          <input type="text" class="aliases-input" value="${escapeHtml((q.aliases ?? []).join(' '))}" data-field="aliases" placeholder="arXiv 别名(空格分隔,3-5 个真实常见写法)" aria-label="arXiv 别名" />
        </div>
        ${hasFacets ? `<div class="topic-subq-card-row topic-subq-card-facet-row">
          <label class="topic-subq-facet-label">研究维度</label>
          <select class="facet-select" data-field="facetId" aria-label="子方向 ${i + 1} 归属研究维度">${facetOptionsFor(q.facetId)}</select>
        </div>` : ''}
        <textarea data-field="reason" placeholder="为什么这个子方向值得检索">${escapeHtml(q.reason)}</textarea>
      </div>
    </div>
  `;
  }).join('');

  // 绑定交互
  list.querySelectorAll<HTMLElement>('.topic-subq-card').forEach((card) => {
    const id = card.dataset.id!;
    const subq = current!.subqs.find((s) => s.id === id)!;
    card.querySelector<HTMLInputElement>('.topic-subq-check')!.addEventListener('change', (e) => {
      subq.selected = (e.target as HTMLInputElement).checked;
      card.classList.toggle('selected', subq.selected);
      renderSubqStage();
      persistSession(current!);
    });
    card.querySelectorAll<HTMLInputElement>('input[data-field], textarea[data-field]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const field = inp.dataset.field as 'label' | 'query' | 'reason' | 'aliases';
        if (field === 'aliases') {
          // 空格 / 逗号 / 多个空白都当分隔符,空字符串视为清空 aliases。
          const arr = inp.value
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          // 去空去重(避免用户键入空格导致重复)
          subq.aliases = Array.from(new Set(arr));
        } else {
          (subq as any)[field] = inp.value;
        }
        persistSession(current!);
      });
    });
    // facet 归属下拉:改选同步 facetId + facetLabel,只刷新 meta / facet panel 计数,
    // 不整块重绘 subq 列表(避免用户正在编辑其它输入框时丢焦点)。
    card.querySelector<HTMLSelectElement>('.facet-select')?.addEventListener('change', (e) => {
      const fid = (e.target as HTMLSelectElement).value || undefined;
      subq.facetId = fid;
      subq.facetLabel = fid ? current!.facets?.find((f) => f.id === fid)?.label : undefined;
      // 只更新 meta 与 facet 计数/覆盖提示,不重绘卡片
      refreshSubqMeta();
      renderFacetStage();
      persistSession(current!);
    });
    card.querySelector<HTMLButtonElement>('[data-act="del"]')!.addEventListener('click', () => {
      current!.subqs = current!.subqs.filter((s) => s.id !== id);
      delete current!.candidatesBySubq[id];
      current!.summaries = current!.summaries.filter((s) => s.subqId !== id);
      renderFacetStage(); // 删子方向会改变 facet 覆盖计数/未覆盖状态,同步刷新面板
      renderSubqStage();
      renderCandStage();
      renderSummaryStage();
      renderSessionMeta();
      persistSession(current!);
    });
    card.querySelector<HTMLButtonElement>('[data-act="verify-hit"]')!.addEventListener('click', async () => {
      if (!current) return;
      const btn = card.querySelector<HTMLButtonElement>('[data-act="verify-hit"]')!;
      btn.disabled = true;
      setStatus(`🔬 实测 arXiv: ${subq.label}...`);
      try {
        const { count, samples } = await validateSubqHitCount(subq.query);
        subq.hitCount = count;
        subq.hitSamples = samples;
        renderSubqStage();
        persistSession(current!);
        setStatus(count > 0 ? `✓ 命中 ${count} 篇` : '⚠ 0 命中 — 改 query 或加 aliases', count > 0 ? 'success' : '');
      } catch (e) {
        setStatus(`验证失败: ${(e as Error).message}`, 'error');
      } finally {
        btn.disabled = false;
      }
    });
    card.querySelector<HTMLButtonElement>('[data-act="regen"]')!.addEventListener('click', async () => {
      if (!current) return;
      try {
        inFlightController = new AbortController();
        setStatus(`重新生成子方向 ${subq.label}...`);
        const newOne = await decomposeIdea(current.topic);
        if (newOne.subqs.length > 0) {
          // regen 路径走 buildRegenSubQ:label/query/reason 用 LLM 新值;
          // aliases/explorationType/hitCount/hitSamples/facetId 等"用户手动 / 阶段 3 实测"的值
          // 沿用 base(LLM 一次性产出不应覆盖)。这避免了 [[feedback_subq_fields_whitelist]]
          // 在 regen 路径上的字段漏拷。整套 newOne.facets 只用于找 replacement,不覆盖
          // current.facets(用户可能已编辑过维度)。
          const merged = buildRegenSubQ({ base: subq, replacement: newOne.subqs[0] });
          Object.assign(subq, merged);
          renderSubqStage();
          persistSession(current!);
        }
      } catch (e) {
        setStatus(`重新生成失败: ${(e as Error).message}`, 'error');
      } finally {
        clearStatus();
      }
    });
  });
}

// explorationType → 中文显示名。给 renderSubqStage 用。
function explorationTypeLabel(t: SubQ['explorationType']): string {
  switch (t) {
    case 'cross_domain': return '跨域迁移';
    case 'method_transfer': return '方法借鉴';
    case 'reverse': return '反向工程';
    case 'combination': return '组合创新';
    default: return '';
  }
}

function renderCandStage(): void {
  const wrap = $('cand-list');
  const meta = $('cand-meta');
  const summarizeBtn = $<HTMLButtonElement>('summarize-btn');
  const summarizeTopBtn = $<HTMLButtonElement>('summarize-top-btn');
  const summarizeAllBtn = $<HTMLButtonElement>('summarize-all-btn');
  const filterCandBtn = $<HTMLButtonElement>('filter-cand-btn');
  if (!current || Object.keys(current.candidatesBySubq).length === 0) {
    wrap.innerHTML = '<div style="color:var(--fg-subtle);font-size:0.88rem">尚未搜索 — 在第 2 步勾选子方向后点"📚 搜索论文"。</div>';
    meta.textContent = '尚未搜索';
    summarizeBtn.disabled = true;
    summarizeTopBtn.disabled = true;
    summarizeAllBtn.disabled = true;
    filterCandBtn.disabled = true;
    return;
  }
  const allCands: Candidate[] = [];
  for (const list of Object.values(current.candidatesBySubq)) allCands.push(...list);
  const selected = allCands.filter((c) => c.selected).length;
  summarizeBtn.disabled = selected === 0;
  summarizeTopBtn.disabled = selected === 0;
  summarizeAllBtn.disabled = selected === 0;
  // 「总结全部」按钮显示实际待总结数(去重后的 selected 数)
  summarizeAllBtn.textContent = `🚀 总结全部 (${selected})`;
  // AI 筛按钮:候选数 ≥ 10 才启用(太少没意义)
  filterCandBtn.disabled = allCands.length < 10;
  // 全局「全部展开/收起」:展开的 group 数 = sum(expanded[id] === true);默认折叠。
  // 整个 stage 至少有一个 group,这个判断才有意义。
  const subqIds = Object.keys(current.candidatesBySubq);
  const expandedCount = subqIds.filter((id) => current!.candGroupExpanded?.[id] === true).length;
  const allExpanded = expandedCount === subqIds.length && subqIds.length > 0;
  meta.innerHTML = `共 ${allCands.length} 篇候选,已选 ${selected}` +
    (subqIds.length > 0
      ? ` · <a href="#" data-act="expand-all-grps" style="margin-left:0.4rem">${allExpanded ? '全部收起' : '全部展开'}</a>`
      : '');
  summarizeBtn.disabled = selected === 0;

  // 按 subq 分组渲染 — 即使某个子方向 0 命中也要显示,这样用户能看到"哪些没搜到"
  // 渲染 seeds group(独立于子方向,带 [📚 参考论文] 徽章表示这是用户主动选的)
  const seedsRendered = renderSeedsCandidateGroup();
  wrap.innerHTML =
    current.subqs
      .filter((q) => current!.candidatesBySubq[q.id] !== undefined)
      .map((q) => renderCandidateGroupFor(q.id))
      .join('') + seedsRendered;

  // 绑定
  wrap.querySelectorAll<HTMLElement>('.topic-candidate-item').forEach((row) => {
    const ax = row.dataset.arxiv!;
    const cb = row.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    cb.addEventListener('change', () => {
      for (const list of Object.values(current!.candidatesBySubq)) {
        for (const c of list) if (c.arxivId === ax) c.selected = cb.checked;
      }
      row.classList.toggle('selected', cb.checked);
      renderCandStage(); // 刷新 meta
      persistSession(current!);
    });
  });
  wrap.querySelectorAll<HTMLElement>('.topic-candidate-group').forEach((grp) => {
    const subqId = grp.dataset.subq!;
    const list = current!.candidatesBySubq[subqId] || [];
    const toggleAll = grp.querySelector<HTMLElement>('[data-act="toggle-all"]');
    if (!toggleAll) return; // 0 命中子方向没有"全选/全不选"链接
    toggleAll.addEventListener('click', (e) => {
      e.preventDefault();
      const allSelected = list.every((c) => c.selected);
      for (const c of list) c.selected = !allSelected;
      renderCandStage();
      persistSession(current!);
    });
    // group header 点击折叠/展开 — 仅命中>0 的 group 才有意义(0 命中已显示 emptyHint)
    const header = grp.querySelector<HTMLElement>('[data-act="toggle-grp"]');
    header?.addEventListener('click', (e) => {
      // 点 "全选/全不选" 链接时不应该触发折叠,链接自己阻止冒泡即可;这里再保险一次
      if ((e.target as HTMLElement).closest('[data-act="toggle-all"]')) return;
      if (!current!.candGroupExpanded) current!.candGroupExpanded = {};
      current!.candGroupExpanded[subqId] = !(current!.candGroupExpanded[subqId] === true);
      renderCandStage();
      persistSession(current!);
    });
  });
  // 全局「全部展开/收起」:链接嵌在 #cand-meta.innerHTML 里,这里绑事件。
  $('cand-meta').querySelector<HTMLElement>('[data-act="expand-all-grps"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!current!.candGroupExpanded) current!.candGroupExpanded = {};
    const target = !allExpanded; // 当前全部展开 → 点一下 = 全部收起
    for (const id of subqIds) current!.candGroupExpanded[id] = target;
    renderCandStage();
    persistSession(current!);
  });
}

// 渲染一个子方向的候选 group(独立 helper 拆分出来,避免 renderCandStage 内联一个
// 超大 lambda + 嵌套 .map 触发 TS 类型推断错误:topic-candidate-item--seed 的 seed
// group 视觉差异化在此 path 上做不出来,所以独立 helper 拆出来)
function renderCandidateGroupFor(subqId: string): string {
  const allList = current!.candidatesBySubq[subqId] || [];
  const hidden = new Set(loadHiddenPapers());
  const list = allList.filter((c) => !hidden.has(c.arxivId));
  const grpSelected = list.filter((c) => c.selected).length;
  const subq = current!.subqs.find((q) => q.id === subqId);
  const label = subq?.label ?? subqId;
  // 默认折叠:用户研究主题时常有 80+ 篇候选,一次性全展开视觉密度太大;
  // 折叠状态从 current.candGroupExpanded 读,缺省视为折叠(老 session / 第一次搜索)。
  const expanded = current!.candGroupExpanded?.[subqId] === true;
  // 让用户能看出"是哪个 query / alias 拯救了命中"。aliases 留空或主 query 没
  // 别名时仅展示 query,保持视觉简洁。
  const queryLine = subq && (subq.query || (subq.aliases ?? []).length > 0)
    ? `<div class="topic-candidate-group-query">
        query: <code>${escapeHtml(subq.query || '')}</code>${
          (subq.aliases ?? []).length > 0
            ? ` <span class="topic-candidate-group-aliases">· 别名: ${subq.aliases!.map((a) => escapeHtml(a)).join(', ')}</span>`
            : ''
        }
      </div>`
    : '';
  const emptyHint = list.length === 0 && allList.length > 0
    ? `<div style="padding:0.7rem 0.9rem;color:var(--fg-subtle);font-size:0.85rem">该子方向下 ${allList.length} 篇候选全部被隐藏。可在 设置页"已隐藏论文"面板 恢复。</div>`
    : list.length === 0
      ? `<div style="padding:0.7rem 0.9rem;color:var(--fg-subtle);font-size:0.85rem">未命中任何论文。可能是 query 太冷门,试试改 query 或换个角度重检索。</div>`
      : '';
  const metaHtml = list.length === 0
    ? `0 命中${allList.length > 0 ? ` (${allList.length} 篇已隐藏)` : ''}`
    : `${grpSelected}/${list.length} 已选 · <a href="#" data-act="toggle-all">${grpSelected === list.length ? '全不选' : '全选'}</a>`;
  const itemsHtml = list.map((c) => `
            <div class="topic-candidate-item ${c.selected ? 'selected' : ''}" data-arxiv="${escapeHtml(c.arxivId)}">
              <input type="checkbox" ${c.selected ? 'checked' : ''} aria-label="勾选论文 ${escapeHtml(c.entry.title)}" />
              <div class="topic-candidate-main">
                <div class="topic-candidate-title">${escapeHtml(c.entry.title)}</div>
                <div class="topic-candidate-meta">arXiv:${escapeHtml(c.arxivId)} · ${escapeHtml((c.entry.published || '').slice(0, 10))} · ${c.entry.authors.length} 位作者</div>
                <div class="topic-candidate-summary">${escapeHtml(c.entry.summary)}</div>
              </div>
              <div></div>
            </div>
          `).join('');
  const chevron = expanded ? '▾' : '▸';
  return `
    <div class="topic-candidate-group ${expanded ? 'expanded' : 'collapsed'}" data-subq="${subqId}">
      <div class="topic-candidate-group-header" data-act="toggle-grp">
        <div class="topic-candidate-group-title"><span class="topic-candidate-group-chevron">${chevron}</span> 📂 ${escapeHtml(label)}</div>
        <div class="topic-candidate-group-meta">${metaHtml}</div>
      </div>
      ${queryLine}
      ${list.length === 0 ? emptyHint : expanded ? `<div class="topic-candidate-list">${itemsHtml}</div>` : ''}
    </div>`;
}

// 渲染"📚 参考论文"group(用户在 modal 加的论文),带 [📚 你选的] 徽章
function renderSeedsCandidateGroup(): string {
  const list = current!.candidatesBySubq['__seeds__'] || [];
  if (list.length === 0) return '';
  const hidden = new Set(loadHiddenPapers());
  const visList = list.filter((c) => !hidden.has(c.arxivId));
  if (visList.length === 0) return '';
  const sel = visList.filter((c) => c.selected).length;
  const itemsHtml = visList.map((c) => `
            <div class="topic-candidate-item ${c.selected ? 'selected topic-candidate-item--seed' : 'topic-candidate-item--seed'}" data-arxiv="${escapeHtml(c.arxivId)}">
              <input type="checkbox" ${c.selected ? 'checked' : ''} aria-label="勾选论文 ${escapeHtml(c.entry.title)}" />
              <div class="topic-candidate-main">
                <div class="topic-candidate-title">${escapeHtml(c.entry.title)}</div>
                <div class="topic-candidate-meta">arXiv:${escapeHtml(c.arxivId)} <span class="topic-candidate-seed-tag">📚 你选的</span></div>
                <div class="topic-candidate-summary">${escapeHtml(c.entry.summary)}</div>
              </div>
            </div>
          `).join('');
  return `
    <div class="topic-candidate-group topic-candidate-group--seeds" data-subq="__seeds__">
      <div class="topic-candidate-group-header" data-act="toggle-grp">
        <div class="topic-candidate-group-title">
          <span class="topic-candidate-group-badge topic-candidate-group-badge--seeds" title="你在「添加参考论文」里选的论文">📚 参考论文</span>
        </div>
        <div class="topic-candidate-group-meta">${sel}/${visList.length} 已选 · <a href="#" data-act="toggle-all">${sel === visList.length ? '全不选' : '全选'}</a></div>
      </div>
      <div class="topic-candidate-list">${itemsHtml}</div>
    </div>`;
}

function renderSummaryStage(): void {
  const list = $('summary-list');
  const meta = $('summ-meta');
  if (!current || current.summaries.length === 0) {
    list.innerHTML = '<div style="color:var(--fg-subtle);font-size:0.88rem">尚未总结 — 在第 3 步勾选论文后点"🚀 总结选中论文"。</div>';
    meta.textContent = '尚未总结';
    return;
  }
  const hiddenSet = new Set(loadHiddenPapers());
  const visibleSummaries = current.summaries.filter((s) => !hiddenSet.has(s.arxivId));
  meta.textContent = `已总结 ${current.summaries.length} 篇${
    visibleSummaries.length < current.summaries.length ? ` (${current.summaries.length - visibleSummaries.length} 篇已隐藏)` : ''
  }`;
  if (visibleSummaries.length === 0) {
    list.innerHTML = '<div style="color:var(--fg-subtle);font-size:0.88rem">已总结的论文全部被隐藏。可在 设置页"已隐藏论文"面板 恢复。</div>';
    return;
  }
  list.innerHTML = visibleSummaries.map((s) => {
    let entry: ArxivEntry | undefined;
    for (const clist of Object.values(current!.candidatesBySubq)) {
      const f = clist.find((c) => c.arxivId === s.arxivId);
      if (f) { entry = f.entry; break; }
    }
    const subq = current!.subqs.find((q) => q.id === s.subqId);
    const r = s.summary;
    const noteHtml = (label: string, content: string): string => content
      ? `<div class="topic-summary-note"><div class="topic-summary-note-label">${label}</div><div class="topic-summary-note-text">${escapeHtml(content).replace(/\n/g, '<br>')}</div></div>`
      : '';
    return `
      <article class="topic-summary-card" data-arxiv="${escapeHtml(s.arxivId)}">
        <header class="topic-summary-card-header">
          <h3 class="topic-summary-title">${escapeHtml(r.title || entry?.title || s.arxivId)}</h3>
          ${r.title_en ? `<p class="topic-summary-title-en">${escapeHtml(r.title_en)}</p>` : ''}
          <div class="topic-summary-meta">
            <span>arXiv:${escapeHtml(s.arxivId)}</span>
            ${subq ? `<span>· 来自子方向:${escapeHtml(subq.label)}</span>` : ''}
            ${entry?.authors.length ? `<span>· ${entry.authors.length} 位作者</span>` : ''}
          </div>
        </header>
        <div class="topic-summary-body">
          ${r.tldr ? `<div class="topic-summary-tldr"><div class="topic-summary-tldr-label">TL;DR</div><div class="topic-summary-tldr-text">${escapeHtml(r.tldr)}</div></div>` : ''}
          <div class="topic-summary-notes">
            ${noteHtml('动机', r.motivation)}
            ${noteHtml('方法', r.method)}
            ${noteHtml('结果', r.result)}
            ${noteHtml('结论', r.conclusion)}
          </div>
          ${r.context ? `<div class="topic-summary-context"><div class="topic-summary-context-label">主题语境</div><div class="topic-summary-context-text">${escapeHtml(r.context)}</div></div>` : ''}
        </div>
        <div class="topic-summary-actions">
          <button type="button" class="topic-btn ghost" data-act="regen">🔄 重新生成</button>
          <button type="button" class="topic-btn ghost" data-act="toggle-chat">💬 追问 / 收起</button>
        </div>
        <div class="topic-summary-status topic-hidden" data-role="status"></div>
        <div class="topic-chat topic-hidden" data-role="chat">
          <div class="topic-chat-history" data-role="history"></div>
          <div class="topic-chat-input">
            <input type="text" placeholder="问点什么…例如:它的方法有什么局限?" />
            <button type="button" class="topic-btn primary" data-act="send-chat">发送</button>
          </div>
          <div class="topic-chat-foot">
            <span>本地仅保留最近 ${MAX_QA_PER_PAPER} 轮</span>
            <button type="button" class="topic-btn ghost" data-act="clear-chat">清空本轮追问</button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  // 绑定每篇的操作
  list.querySelectorAll<HTMLElement>('.topic-summary-card').forEach((card) => {
    const ax = card.dataset.arxiv!;
    card.querySelector<HTMLButtonElement>('[data-act="regen"]')!.addEventListener('click', () => regenerateSummary(ax));
    card.querySelector<HTMLButtonElement>('[data-act="toggle-chat"]')!.addEventListener('click', () => {
      const chat = card.querySelector<HTMLElement>('[data-role="chat"]')!;
      chat.classList.toggle('topic-hidden');
      if (!chat.classList.contains('topic-hidden')) {
        renderChatHistory(card);
        chat.querySelector<HTMLInputElement>('input[type=text]')!.focus();
      }
    });
    card.querySelector<HTMLButtonElement>('[data-act="send-chat"]')!.addEventListener('click', () => sendChat(card));
    card.querySelector<HTMLInputElement>('.topic-chat-input input')!.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendChat(card); }
    });
    card.querySelector<HTMLButtonElement>('[data-act="clear-chat"]')!.addEventListener('click', () => {
      if (!confirm('确定要清空这篇论文的所有追问历史吗?')) return;
      delete current!.chats[ax];
      renderChatHistory(card);
      renderSessionMeta();
      persistSession(current!);
    });
  });
}

function renderChatHistory(card: HTMLElement): void {
  if (!current) return;
  const ax = card.dataset.arxiv!;
  const history = card.querySelector<HTMLElement>('[data-role="history"]')!;
  const msgs = current.chats[ax] ?? [];
  if (msgs.length === 0) {
    history.innerHTML = '<div class="topic-chat-empty">还没有追问 — 输入问题开始多轮对话</div>';
    return;
  }
  history.innerHTML = msgs.map((m) => `
    <div class="topic-chat-msg ${m.role}">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
  `).join('');
  history.scrollTop = history.scrollHeight;
}

function setSummaryStatus(card: HTMLElement, msg: string, error = false): void {
  const status = card.querySelector<HTMLElement>('[data-role="status"]')!;
  status.classList.remove('topic-hidden');
  status.classList.toggle('error', error);
  status.textContent = msg;
}

async function regenerateSummary(arxivId: string): Promise<void> {
  if (!current) return;
  const sum = current.summaries.find((s) => s.arxivId === arxivId);
  if (!sum) return;
  let entry: ArxivEntry | undefined;
  for (const list of Object.values(current.candidatesBySubq)) {
    const f = list.find((c) => c.arxivId === arxivId);
    if (f) { entry = f.entry; break; }
  }
  if (!entry) {
    setStatus(`找不到论文 ${arxivId} 的元数据,无法重新生成`, 'error');
    return;
  }
  const card = document.querySelector<HTMLElement>(`.topic-summary-card[data-arxiv="${arxivId}"]`);
  if (!card) return;
  try {
    inFlightController = new AbortController();
    setSummaryStatus(card, '⏳ 正在重新生成...');
    const newSum = await summarizeOne(entry, sum.subqId);
    sum.summary = newSum.summary;
    sum.generatedAt = Date.now();
    renderSummaryStage();
    renderSessionMeta();
    persistSession(current!);
  } catch (e) {
    setSummaryStatus(card, `✗ 重新生成失败: ${(e as Error).message}`, true);
  } finally {
    inFlightController = null;
  }
}

async function sendChat(card: HTMLElement): Promise<void> {
  if (!current) return;
  const ax = card.dataset.arxiv!;
  const input = card.querySelector<HTMLInputElement>('.topic-chat-input input')!;
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  if (!current.chats[ax]) current.chats[ax] = [];
  current.chats[ax].push({ role: 'user', content: q, ts: Date.now() });
  // 截断到上限
  if (current.chats[ax].length > MAX_QA_PER_PAPER) {
    current.chats[ax] = current.chats[ax].slice(-MAX_QA_PER_PAPER);
  }
  renderChatHistory(card);
  renderSessionMeta();
  persistSession(current!);

  setSummaryStatus(card, '⏳ 思考中...');
  try {
    inFlightController = new AbortController();
    const a = await chatWithPaper(ax, q);
    current.chats[ax].push({ role: 'assistant', content: a, ts: Date.now() });
    if (current.chats[ax].length > MAX_QA_PER_PAPER) {
      current.chats[ax] = current.chats[ax].slice(-MAX_QA_PER_PAPER);
    }
    renderChatHistory(card);
    renderSessionMeta();
    persistSession(current!);
    const status = card.querySelector<HTMLElement>('[data-role="status"]')!;
    status.classList.add('topic-hidden');
  } catch (e) {
    setSummaryStatus(card, `✗ 追问失败: ${(e as Error).message}`, true);
  } finally {
    inFlightController = null;
  }
}

// ============================================================================
// 阶段 5:主题报告渲染
// ============================================================================

function renderReportToHTML(r: TopicReport, referenceSeeds?: SelectionItem[]): string {
  const dimsHTML = r.dimensions
    .map(
      (d) => `
    <details class="topic-report-dim" open>
      <summary class="topic-report-dim-header">
        <strong>${escapeHtml(d.name)}</strong>
        <span class="topic-report-dim-count">${d.papers.length} 篇</span>
      </summary>
      ${d.description ? `<div class="topic-report-dim-desc">${escapeHtml(d.description)}</div>` : ''}
      <ul class="topic-report-dim-papers">
        ${d.papers
          .map(
            (p) => `
          <li>
            <a href="/papers/${encodeURIComponent(p.arxivId)}/" class="topic-link" target="_blank" rel="noopener">arXiv:${escapeHtml(p.arxivId)}</a>
            <span class="topic-report-dim-role">${escapeHtml(p.role)}</span>
            — ${escapeHtml(p.key)}
            ${p.method ? `<div class="topic-report-dim-meta">方法: ${escapeHtml(p.method)}</div>` : ''}
            ${p.result ? `<div class="topic-report-dim-meta">结果: ${escapeHtml(p.result)}</div>` : ''}
            ${p.note ? `<div class="topic-report-dim-meta">注: ${escapeHtml(p.note)}</div>` : ''}
          </li>`,
          )
          .join('')}
      </ul>
    </details>`,
    )
    .join('');
  const section = (title: string, items: string[]): string =>
    !items.length
      ? ''
      : `<section class="topic-report-section"><h3>${escapeHtml(title)}</h3><ul>${items
          .map((s) => `<li>${escapeHtml(s)}</li>`)
          .join('')}</ul></section>`;
  // 用户在 modal 主动选的参考论文 — 在主题总览之前独立罗列,只做索引层(不参与
  // LLM 报告归纳),让用户清楚"这 N 篇是参考论文,主题报告基于 arXiv 搜 + 这 N 篇"
  const seedsHTML = referenceSeeds && referenceSeeds.length > 0
    ? `<section class="topic-report-seeds">
        <h3>📚 参考论文 (${referenceSeeds.length})</h3>
        <ul class="topic-report-seeds-list">
          ${referenceSeeds
            .map(
              (s) => `<li>
                <a href="/papers/${encodeURIComponent(s.arxivId)}/" target="_blank" rel="noopener">arXiv:${escapeHtml(s.arxivId)}</a>
                — ${escapeHtml(s.title)}
                ${s.tldr ? `<div style="color:var(--fg-subtle);font-size:0.85rem;margin-top:0.2rem">${escapeHtml(s.tldr.slice(0, 220))}${s.tldr.length > 220 ? '…' : ''}</div>` : ''}
              </li>`,
            )
            .join('')}
        </ul>
      </section>`
    : '';
  return `
    ${seedsHTML}
    <section class="topic-report-section">
      <h3>主题总览</h3>
      <p>${escapeHtml(r.overview).replace(/\n/g, '<br>')}</p>
    </section>
    <section class="topic-report-section">
      <h3>论文横向对比</h3>
      ${dimsHTML}
    </section>
    ${section('共同发现', r.sharedFindings)}
    ${section('研究空白', r.gaps)}
    ${section('下一步建议', r.nextSteps)}
    ${renderReportNextStepsHTML()}
  `;
}

// 报告生成完后的「下一步」操作面板:导出 / 重新生成 / 补论文增量更新 / 追问报告
function renderReportNextStepsHTML(): string {
  return `
    <section class="topic-report-next-steps">
      <h3>👉 下一步可以做什么</h3>
      <p class="topic-report-next-steps-hint">报告已经生成。下面是常见的几种后续操作,挑一个继续:</p>
      <div class="topic-report-next-steps-actions">
        <button type="button" class="topic-btn primary" data-act="report-dl">💾 下载报告 .md</button>
        <button type="button" class="topic-btn ghost" data-act="report-copy">📋 复制为 Markdown</button>
        <button type="button" class="topic-btn ghost" data-act="report-regen">🔄 用相同速览重新生成报告</button>
        <button type="button" class="topic-btn ghost" data-act="report-add-more">➕ 去阶段 3 补论文(完成后会触发增量更新)</button>
        <button type="button" class="topic-btn ghost" data-act="report-edit-topic">↩ 改思路重新探索(回到阶段 1)</button>
      </div>
      <div class="topic-report-chat" data-role="report-chat">
        <div class="topic-report-chat-head">
          <button type="button" class="topic-btn ghost" data-act="toggle-report-chat">💬 追问 / 修改报告</button>
          <span class="topic-report-chat-hint">围绕这份报告提问,或让模型给出修改建议后点「应用此修改」</span>
        </div>
        <div class="topic-chat topic-hidden" data-role="report-chat-body">
          <div class="topic-chat-history" data-role="report-chat-history"></div>
          <div class="topic-chat-input">
            <input type="text" placeholder="例如:为什么把 ASE 归到「表征学习」? / 把共同发现第 2 条改得更具体" />
            <button type="button" class="topic-btn primary" data-act="send-report-chat">发送</button>
          </div>
          <div class="topic-chat-foot">
            <span>本地仅保留最近 ${MAX_QA_FOR_REPORT} 轮</span>
            <button type="button" class="topic-btn ghost" data-act="apply-report-suggestion">📥 应用最近一轮「修改建议」并重新生成报告</button>
            <button type="button" class="topic-btn ghost" data-act="clear-report-chat">清空追问</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderReportStage(): void {
  const meta = $('report-meta');
  const out = $('report-output');
  const genBtn = $<HTMLButtonElement>('report-gen-btn');
  const copyBtn = $<HTMLButtonElement>('report-copy-btn');
  const dlBtn = $<HTMLButtonElement>('report-download-btn');
  const n = current?.summaries.length ?? 0;
  if (!current || n === 0) {
    meta.textContent = '需要先有至少 1 篇速览';
    genBtn.disabled = true;
    copyBtn.disabled = true;
    dlBtn.disabled = true;
    out.innerHTML = '<div class="topic-empty">尚未总结 — 在第 4 步完成速览后再来生成报告。</div>';
    return;
  }
  genBtn.disabled = false;
  if (!current.report) {
    meta.textContent = '尚未生成';
    copyBtn.disabled = true;
    dlBtn.disabled = true;
    out.innerHTML = `<div class="topic-empty">点击"📊 生成报告"开始基于 ${n} 篇速览整合主题报告。</div>`;
    return;
  }
  const r = current.report;
  const incNote = r.incrementallyAddedArxivIds?.length
    ? ` · 本次 +${r.incrementallyAddedArxivIds.length}`
    : '';
  // 从 selection 过滤出当前会话 referenceSeedArxivIds 包含的论文,作为报告里
  // "参考论文" group 的输入(用户在 modal 主动选的,不被 LLM 归纳)
  const refIds = new Set(current.referenceSeedArxivIds ?? []);
  const refSeeds = refIds.size > 0 ? loadSelection().filter((s) => refIds.has(canonicalId(s.arxivId))) : [];
  const refNote = refSeeds.length > 0 ? ` · ${refSeeds.length} 篇参考论文` : '';
  meta.textContent = `已生成 · ${r.dimensions.length} 个维度 · ${r.relatedArxivIds.length} 篇${incNote}${refNote}`;
  copyBtn.disabled = false;
  dlBtn.disabled = false;
  out.innerHTML = renderReportToHTML(r, refSeeds);
  // 阶段 5 报告生成后:绑「下一步」面板 + 报告追问 chat 事件
  bindReportNextStepsActions(out);
  renderReportChat();
}

// 把「下一步」面板里的按钮 / 报告追问 chat 控件事件一次性绑好。
// out.innerHTML 每次 renderReportStage 都会被重写,所以每次重渲染后都要重新绑一次。
function bindReportNextStepsActions(out: HTMLElement): void {
  out.querySelector<HTMLButtonElement>('[data-act="report-dl"]')?.addEventListener('click', () => downloadReportAsMarkdown());
  out.querySelector<HTMLButtonElement>('[data-act="report-copy"]')?.addEventListener('click', () => copyReportAsMarkdown());
  out.querySelector<HTMLButtonElement>('[data-act="report-regen"]')?.addEventListener('click', () => doGenerateReport());
  out.querySelector<HTMLButtonElement>('[data-act="report-add-more"]')?.addEventListener('click', () => {
    ($('stage-candidates') as HTMLDetailsElement).open = true;
    ($('stage-candidates') as HTMLDetailsElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('📚 去阶段 3 勾选/搜索新论文,完成后回这里会自动增量更新报告');
  });
  out.querySelector<HTMLButtonElement>('[data-act="report-edit-topic"]')?.addEventListener('click', () => {
    ($('stage-input') as HTMLDetailsElement).open = true;
    ($('stage-input') as HTMLDetailsElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('↩ 回到阶段 1 改思路,点「🔍 拆解思路」会重新跑后续阶段');
  });

  const toggleBtn = out.querySelector<HTMLButtonElement>('[data-act="toggle-report-chat"]');
  const chatBody = out.querySelector<HTMLElement>('[data-role="report-chat-body"]');
  toggleBtn?.addEventListener('click', () => {
    if (!chatBody) return;
    chatBody.classList.toggle('topic-hidden');
    if (!chatBody.classList.contains('topic-hidden')) {
      // 展开时自动滚动到 chat 区域
      chatBody.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  const sendBtn = out.querySelector<HTMLButtonElement>('[data-act="send-report-chat"]');
  const input = out.querySelector<HTMLInputElement>('[data-role="report-chat-body"] .topic-chat-input input');
  const doSend = () => void doSendReportChat();
  sendBtn?.addEventListener('click', doSend);
  input?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); doSend(); }
  });
  out.querySelector<HTMLButtonElement>('[data-act="clear-report-chat"]')?.addEventListener('click', () => doClearReportChat());
  out.querySelector<HTMLButtonElement>('[data-act="apply-report-suggestion"]')?.addEventListener('click', () => doApplyReportSuggestion());
}

function renderReportChat(): void {
  if (!current) return;
  const historyEl = document.querySelector<HTMLElement>('[data-role="report-chat-history"]');
  if (!historyEl) return;
  const msgs = current.reportChats ?? [];
  if (msgs.length === 0) {
    historyEl.innerHTML = '<div class="topic-chat-empty">还没有追问 — 输入问题开始,或要求模型给「修改建议」</div>';
    return;
  }
  historyEl.innerHTML = msgs.map((m) => `
    <div class="topic-chat-msg ${m.role}">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
  `).join('');
  historyEl.scrollTop = historyEl.scrollHeight;
}

function renderAll(): void {
  renderSessionMeta();
  renderInputStage();
  renderFacetStage();
  renderSubqStage();
  renderCandStage();
  renderSummaryStage();
  // PR-6: 可选 Elo 辩论 stage（默认 disabled,topic.v2.enabled=true 才走）
  // renderDebateStage 在 topic-search-v2.ts 内导出,实现细节看那里。
  // 此处不阻塞 v1 流程：dynamic import 失败 / enabled=false 都直接跳过。
  renderDebateStageSafe();
  renderReportStage();
  updateSeedsCounter();
}

/** PR-6: 动态 import 包装,默认 enabled=false 时 noop,失败不抛。
 *
 * v2 renderDebateStage 是 fire-and-forget：内部自己跑 Elo + 写 localStorage + 可视化。
 * 我们的接入点只确保：(1) 启用检查；(2) 调用安全；(3) 同步 TopicSession.debateProgress。
 */
function renderDebateStageSafe(): void {
  if (!current) return;
  const cfg = (loadSettings() as unknown as { topic?: { v2?: { enabled?: boolean } } }) || {};
  if (!cfg.topic?.v2?.enabled) {
    // 关闭辩论 stage 容器 + 隐藏 #stage-debate
    const stage = document.getElementById('stage-debate');
    if (stage) (stage as HTMLDetailsElement).hidden = true;
    return;
  }
  // 显示 stage 4.5 容器
  const stage = document.getElementById('stage-debate');
  if (stage) (stage as HTMLDetailsElement).hidden = false;

  // 从 current.summaries 抽出 idea-like 输入(每个 summary 视作一个 idea 候选)
  //   关键修复:Summary interface 没有顶层 title(在 summary.title),取自 s.summary.title。
  const ideas = (current.summaries || []).map((s: any) => ({
    id: s.arxivId,
    title: s.summary?.title || s.title || s.arxivId,  // 修复:之前取 s.title 为 undefined
    elo_rating: 1200,
  }));
  if (ideas.length < 2) {
    // 至少 2 篇才能辩论
    const meta = document.getElementById('debate-meta');
    if (meta) meta.textContent = '至少需要 2 篇速览笔记才能辩论';
    return;
  }
  import('./topic-search-v2')
    .then((mod) => mod.renderDebateStage(current!.id, ideas))
    .then(() => {
      // v2 renderDebateStage 内部已写 localStorage(顶层 store.debateProgress);
      // 这里把该字段同步到 current!.debateProgress 让 TopicSession 保持一致。
      try {
        const raw = localStorage.getItem('dpr_topic_session_v1');
        if (raw) {
          const store = JSON.parse(raw);
          const dp = store.debateProgress || (store.sessions && store.sessions[store.currentId]?.debateProgress);
          if (dp && current) current.debateProgress = dp;
        }
      } catch (e) {
        console.warn('[topic.v2] failed to sync debateProgress back to current session:', e);
      }
      // PR-6 v2: 显示 "打开完整辩论页" 链接,href 填当前 session id
      const linkEl = document.getElementById('debate-detail-link') as HTMLAnchorElement | null;
      if (linkEl && current) {
        const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
        linkEl.href = `${base}/topics/${encodeURIComponent(current.id)}/debate/`;
        linkEl.hidden = false;
      }
    })
    .catch((e) => console.warn('[topic.v2] renderDebateStage skipped:', e));
}

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

// 把秒数格式化为人类可读:75s / 1m 23s / 1h 5m
function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
}

// ============================================================================
// 主题报告(阶段 5):topic + 已总结论文 → 结构化中文报告
// ============================================================================

// 把字符串截到 max 字符,空值返回空串。复用 exploreFromSeeds 的 trunc 风格(topic-search.ts:480)。
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

async function generateTopicReport(
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

function incrementalReportEnabled(): boolean {
  const cb = document.getElementById('report-incremental-toggle') as HTMLInputElement | null;
  return !!cb?.checked;
}

// 增量追加入口。同 session 内 8 秒最多触发 1 次,防止 N 篇并发完成时连环 LLM 调用。
async function triggerIncrementalReportDraft(s: TopicSession): Promise<void> {
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
    renderReportStage();
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
function startIncrementalReportTimer(s: TopicSession): void {
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
      renderReportStage();
      persistSession(s);
      setStatus(`✓ 报告已增量更新 · ${newReport.dimensions.length} 个维度`, 'success');
      setTimeout(clearStatus, 2000);
    } catch (e) {
      console.warn('[topic] incremental report draft failed:', (e as Error).message);
      clearStatus();
    }
  }, REPORT_INC_THROTTLE_MS);
}
function stopIncrementalReportTimer(): void {
  if (reportIncTimer) {
    clearInterval(reportIncTimer);
    reportIncTimer = null;
  }
}

function buildReportMarkdown(): string | null {
  if (!current?.report) return null;
  const r = current.report;
  const lines: string[] = [];
  lines.push(`# 主题报告: ${current.topic || '(主题探索)'}`);
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

function copyReportAsMarkdown(): void {
  const md = buildReportMarkdown();
  if (!md) return;
  navigator.clipboard.writeText(md).then(
    () => setStatus('✓ 报告已复制为 Markdown', 'success'),
    () => setStatus('复制失败,请手动选择', 'error'),
  );
}

// 文件名:主题报告-<topic 安全 slug>-<YYYYMMDD-HHmmss>.md
function reportFileName(): string {
  const topicSlug = (current?.topic || '主题探索')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .slice(0, 40)
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'topic';
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `主题报告-${topicSlug}-${stamp}.md`;
}

function downloadReportAsMarkdown(): void {
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

function copyAllAsMarkdown(): void {
  if (!current || current.summaries.length === 0) return;
  const lines: string[] = [];
  lines.push(`# ${current.topic || '(主题探索)'}`);
  lines.push('');
  lines.push(`> 生成于 ${new Date().toISOString()},共 ${current.summaries.length} 篇论文`);
  lines.push('');
  lines.push('## 子方向');
  for (const q of current.subqs) {
    lines.push(`- **${q.label}**: \`${q.query}\` — ${q.reason}`);
  }
  lines.push('');
  lines.push('## 论文速览');
  for (const s of current.summaries) {
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