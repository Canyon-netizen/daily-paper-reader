// topic-search DOM 渲染层 —— 从 topic-search.ts 抽出（模块化重构 step 10）。
//
// /topic 页面 5 个阶段的 DOM 渲染 + 阶段内聊天 / 追问处理。
//
// 状态同步约定：渲染模块保留一个本地 let current（与 orchestrator 模块级的
// let current 共享同一份 TopicSession 对象引用）。actions 模块每次写入新会话
// 后调用 syncCurrent(s) 让本模块的 current 指向同一对象；这样 render 函数
// 体内的「current.foo」语法保持原状，零语法改动。
//
// 这是「性能优先」的 trade-off：避免 100+ 处把 `current.foo` 改成 `S.getSession()?.foo`
// 的写法（且那个写法在 null 检查的边界条件下更啰嗦）。后续若要做更严格的不变式
// 约束（current 不可变），可以再做一轮 push-down。

import { loadSelection, loadSettings, type SelectionItem } from '../settings';
import { $, escapeHtml } from '../../lib/dom-utils';
import { computeFacetCoverage, FACET_CATEGORY_LABELS, type FacetCategory, type TopicReport, type TopicSession } from '../../lib/schemas';
import { setStatus, clearStatus } from './status';
import { chatWithPaper } from './pipeline';
import { persistSession, MAX_QA_PER_PAPER, MAX_QA_FOR_REPORT } from './store';
import { S } from './state';

/** orchestrator 调用此函数把当前会话同步进 render 模块。actions 在 setSession 后调用。 */
export function syncCurrent(s: TopicSession | null): void {
  current = s;
}

// 当前会话引用 — 与 orchestrator 的 current 同步。render 函数只读不写。
let current: TopicSession | null = null;

export function renderSessionMeta(): void {
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

export function renderInputStage(): void {
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
export function renderStageInputSeedsBanner(): void {
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
export function refreshSubqMeta(): void {
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

// 渲染 facet 面板:每个维度一个 chip(label / category / note 可编辑 + subq 计数 + 状态)。
export function renderFacetStage(): void {
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
        const stateBadge = uncovered
          ? `<span class="facet-badge uncovered">未覆盖</span>`
          : redundant
            ? `<span class="facet-badge redundant">可能重复 (${n})</span>`
            : `<span class="facet-badge ok">✓</span>`;
        if (uncovered) stateCls = 'uncovered';
        else if (redundant) stateCls = 'redundant';
        return `
          <div class="facet-card ${stateCls}" data-fid="${escapeHtml(f.id)}">
            <div class="facet-card-header">
              <input type="text" class="facet-label" value="${escapeHtml(f.label)}" data-edit="label" data-fid="${escapeHtml(f.id)}">
              <select class="facet-category" data-edit="category" data-fid="${escapeHtml(f.id)}">${catOptions(f.category)}</select>
              ${stateBadge}
              <button type="button" class="topic-btn ghost facet-del" data-act="delete-facet" data-fid="${escapeHtml(f.id)}" title="删除维度">✕</button>
            </div>
            <textarea class="facet-note" rows="1" placeholder="(一句话说明这个维度在研究什么)" data-edit="note" data-fid="${escapeHtml(f.id)}">${escapeHtml(f.note ?? '')}</textarea>
            <div class="facet-card-foot">
              <span class="facet-subq-count">${n} 个子方向</span>
            </div>
          </div>
        `;
      })
      .join('');
  }

  const covEl = document.getElementById('facet-coverage');
  if (covEl) {
    if (cov.unassignedSubqIds.length === 0 && cov.redundantFacetIds.length === 0) {
      covEl.textContent = '✓ 所有子方向都已正确归属到维度';
      covEl.className = 'facet-coverage ok';
    } else {
      const parts: string[] = [];
      if (cov.unassignedSubqIds.length > 0) parts.push(`${cov.unassignedSubqIds.length} 个子方向未归属维度`);
      if (cov.redundantFacetIds.length > 0) parts.push(`${cov.redundantFacetIds.length} 个维度有多个子方向(可能重复)`);
      covEl.textContent = parts.join(' · ');
      covEl.className = 'facet-coverage warn';
    }
  }
}

// 阶段 2 底部「添加维度」按钮:新增一个空维度供用户手填。
export function addFacet(): void {
  if (!current) return;
  const f = {
    id: `f_user_${Date.now().toString(36)}`,
    label: '新维度',
    category: 'method' as FacetCategory,
    note: '',
  };
  current.facets = [...(current.facets ?? []), f];
  renderFacetStage();
  refreshSubqMeta();
  persistSession(current);
}

// 阶段 2 主体:子方向列表 + 命中实测 / alias 编辑 / 删除。
export function renderSubqStage(): void {
  const list = document.getElementById('subq-list');
  const empty = document.getElementById('subq-empty');
  if (!current) {
    if (list) list.innerHTML = '';
    if (empty) empty.hidden = false;
    refreshSubqMeta();
    return;
  }
  if (empty) empty.hidden = current.subqs.length > 0;
  if (!list) return;
  // 只在结构变化(增删 / 来源)时全量重绘,简单编辑(label / query)只更新值。
  // 这里为简化统一全量重绘,后续性能瓶颈再优化。
  list.innerHTML = current.subqs.map((sq, idx) => {
    const isSeeds = sq.source === 'seeds';
    const hitBadge =
      sq.hitCount === undefined
        ? ''
        : sq.hitCount > 0
          ? `<span class="hit-badge hit-ok">✓ ${sq.hitCount}</span>`
          : `<span class="hit-badge hit-zero" title="${escapeHtml(sq.searchError ?? '0 召回') }">⚠ 0</span>`;
    const exploreBadge = isSeeds && sq.explorationType
      ? `<span class="explore-badge" data-type="${escapeHtml(sq.explorationType)}">${escapeHtml(explorationTypeLabel(sq.explorationType))}</span>`
      : '';
    return `
      <div class="subq-card" data-sid="${escapeHtml(sq.id)}">
        <div class="subq-card-header">
          <span class="subq-idx">#${idx + 1}</span>
          <input type="text" class="subq-label" value="${escapeHtml(sq.label)}" data-edit="subq-label" data-sid="${escapeHtml(sq.id)}">
          ${hitBadge}
          ${exploreBadge}
          <button type="button" class="topic-btn ghost subq-del" data-act="del-subq" data-sid="${escapeHtml(sq.id)}" title="删除">✕</button>
        </div>
        <div class="subq-card-body">
          <div class="subq-row">
            <label>主 query:</label>
            <input type="text" class="subq-query" value="${escapeHtml(sq.query)}" data-edit="subq-query" data-sid="${escapeHtml(sq.id)}">
            <button type="button" class="topic-btn ghost subq-verify" data-act="verify-hit" data-sid="${escapeHtml(sq.id)}" title="实测 arXiv 命中">🔬</button>
          </div>
          <div class="subq-row">
            <label>aliases:</label>
            <textarea class="subq-aliases" rows="1" placeholder="(逗号分隔)" data-edit="subq-aliases" data-sid="${escapeHtml(sq.id)}">${escapeHtml((sq.aliases ?? []).join(', '))}</textarea>
          </div>
          <div class="subq-row subq-reason">
            <label>说明:</label>
            <span>${escapeHtml(sq.reason ?? '')}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
  refreshSubqMeta();
}

function explorationTypeLabel(t: NonNullable<ReturnType<typeof getSubqExplorationType>>): string {
  switch (t) {
    case 'cross_domain': return '跨域迁移';
    case 'method_transfer': return '方法借鉴';
    case 'reverse': return '反向工程';
    case 'combination': return '组合创新';
  }
}

// 类型 helper — 仅用于 explorationTypeLabel 推断
type SubqExplorationType = 'cross_domain' | 'method_transfer' | 'reverse' | 'combination';
function getSubqExplorationType(): SubqExplorationType | null { return null; }

export function renderCandStage(): void {
  const list = document.getElementById('cand-list');
  const empty = document.getElementById('cand-empty');
  if (!current) {
    if (list) list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = Object.values(current.candidatesBySubq).some((arr) => arr.length > 0);
  if (!list) return;
  // 合并种子探索 subqs(seeds-based, 父 subqId 为空字符串)的候选放在最前面
  const seedsBasedSubqs = current.subqs.filter((sq) => sq.source === 'seeds');
  const seedsBlock = seedsBasedSubqs.length > 0
    ? renderSeedsCandidateGroup()
    : '';
  const blocks = current.subqs
    .filter((sq) => sq.source !== 'seeds')
    .map((sq) => renderCandidateGroupFor(sq.id))
    .join('');
  list.innerHTML = seedsBlock + blocks;
}

export function renderCandidateGroupFor(subqId: string): string {
  const sq = current?.subqs.find((q) => q.id === subqId);
  if (!sq) return '';
  const cands = current?.candidatesBySubq[subqId] ?? [];
  const isSeeds = sq.source === 'seeds';
  const headerLabel = isSeeds ? `🌱 种子探索: ${escapeHtml(sq.label)}` : escapeHtml(sq.label);
  const items = cands.map((c) => `
    <label class="cand-row" data-arxiv="${escapeHtml(c.arxivId)}">
      <input type="checkbox" data-act="cand-toggle" data-subq="${escapeHtml(subqId)}" data-arxiv="${escapeHtml(c.arxivId)}" ${c.selected ? 'checked' : ''}>
      <span class="cand-title">${escapeHtml(c.entry.title)}</span>
      <span class="cand-id">arXiv:${escapeHtml(c.arxivId)}</span>
    </label>
  `).join('');
  const aiBtn = isSeeds ? '' : `<button type="button" class="topic-btn ghost cand-ai-btn" data-act="ai-filter-cand" data-subq="${escapeHtml(subqId)}">🤖 AI 筛论文</button>`;
  return `
    <fieldset class="cand-group" data-subq="${escapeHtml(subqId)}">
      <legend>${headerLabel} <span class="cand-count">(${cands.filter((c) => c.selected).length}/${cands.length})</span> ${aiBtn}</legend>
      ${items || '<div class="cand-empty">(无候选 — 可能是搜索失败或 query 太冷门)</div>'}
    </fieldset>
  `;
}

export function renderSeedsCandidateGroup(): string {
  if (!current) return '';
  const seedsBasedSubqs = current.subqs.filter((sq) => sq.source === 'seeds');
  if (seedsBasedSubqs.length === 0) return '';
  const sections = seedsBasedSubqs.map((sq) => renderCandidateGroupFor(sq.id)).join('');
  return `<fieldset class="cand-group seeds-based"><legend>🌱 基于已选论文探索</legend>${sections}</fieldset>`;
}

export function renderSummaryStage(): void {
  const list = document.getElementById('summary-list');
  const empty = document.getElementById('summary-empty');
  if (!current) {
    if (list) list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = current.summaries.length > 0;
  if (!list) return;
  list.innerHTML = current.summaries.map((s) => {
    const qaN = (current!.chats[s.arxivId] ?? []).length;
    return `
      <article class="topic-summary-card" data-arxiv="${escapeHtml(s.arxivId)}">
        <header class="topic-summary-header">
          <h3>${escapeHtml(s.summary.title || s.arxivId)}</h3>
          <span class="topic-summary-id">arXiv:${escapeHtml(s.arxivId)}</span>
          <span class="topic-summary-qa">${qaN} 轮追问</span>
          <button type="button" class="topic-btn ghost" data-act="regen-summary" data-arxiv="${escapeHtml(s.arxivId)}" title="重新生成">🔄</button>
        </header>
        <div class="topic-summary-body">
          <p><strong>TLDR:</strong> ${escapeHtml(s.summary.tldr)}</p>
          <details><summary>动机</summary><p>${escapeHtml(s.summary.motivation)}</p></details>
          <details><summary>方法</summary><p>${escapeHtml(s.summary.method)}</p></details>
          <details><summary>结果</summary><p>${escapeHtml(s.summary.result)}</p></details>
          <details><summary>结论</summary><p>${escapeHtml(s.summary.conclusion)}</p></details>
          ${s.summary.context ? `<details><summary>主题语境</summary><p>${escapeHtml(s.summary.context)}</p></details>` : ''}
        </div>
        <footer class="topic-summary-chat">
          <span class="chat-hint">本地仅保留最近 ${MAX_QA_PER_PAPER} 轮</span>
          <div class="topic-chat-thread" data-thread="${escapeHtml(s.arxivId)}">
            ${renderChatHistoryFor(s.arxivId)}
          </div>
          <form class="topic-chat-form" data-form="${escapeHtml(s.arxivId)}">
            <input type="text" placeholder="对这篇论文提问..." data-act="chat-input" data-arxiv="${escapeHtml(s.arxivId)}" autocomplete="off">
            <button type="submit" class="topic-btn primary">发送</button>
          </form>
        </footer>
      </article>
    `;
  }).join('');
}

function renderChatHistoryFor(arxivId: string): string {
  const msgs = current?.chats[arxivId] ?? [];
  return msgs.map((m) => `
    <div class="chat-msg chat-${escapeHtml(m.role)}">
      <div class="chat-role">${m.role === 'user' ? '你' : 'AI'}</div>
      <div class="chat-content">${escapeHtml(m.content)}</div>
    </div>
  `).join('');
}

// 重新生成单篇总结
export async function regenerateSummary(arxivId: string): Promise<void> {
  // 由 ./actions 暴露同名入口调用实际逻辑；此处作为 wiring 占位（仅 UI 触发）
  (window as unknown as { __regenerateSummary?: (id: string) => Promise<void> }).__regenerateSummary?.(arxivId);
}

// 单篇论文追问 — 表单提交
export async function sendChat(card: HTMLElement): Promise<void> {
  (window as unknown as { __sendChat?: (c: HTMLElement) => Promise<void> }).__sendChat?.(card);
}

export function renderReportToHTML(r: TopicReport, referenceSeeds?: SelectionItem[]): string {
  const dimBlocks = r.dimensions.map((d) => `
    <section class="report-dim">
      <h3>${escapeHtml(d.name)}</h3>
      ${d.description ? `<p class="report-dim-desc">${escapeHtml(d.description)}</p>` : ''}
      <ul class="report-dim-papers">
        ${d.papers.map((p) => `
          <li>
            <strong>arXiv:${escapeHtml(p.arxivId)}</strong>
            <span class="report-role">${escapeHtml(p.role)}</span>
            <span class="report-key">${escapeHtml(p.key)}</span>
            ${p.method ? `<div class="report-method">方法: ${escapeHtml(p.method)}</div>` : ''}
            ${p.result ? `<div class="report-result">结果: ${escapeHtml(p.result)}</div>` : ''}
            ${p.note ? `<div class="report-note">注: ${escapeHtml(p.note)}</div>` : ''}
          </li>
        `).join('')}
      </ul>
    </section>
  `).join('');
  return `
    <div class="report-block">
      <header class="report-header">
        <h2>主题报告</h2>
        <div class="report-meta">生成于 ${new Date(r.generatedAt).toLocaleString()} · 整合 ${r.relatedArxivIds.length} 篇论文</div>
      </header>
      <section class="report-overview">
        <h3>总览</h3>
        <p>${escapeHtml(r.overview)}</p>
      </section>
      <section class="report-dims">
        <h3>横向对比</h3>
        ${dimBlocks}
      </section>
      ${r.sharedFindings.length ? `<section class="report-shared"><h3>共同发现</h3><ul>${r.sharedFindings.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul></section>` : ''}
      ${r.gaps.length ? `<section class="report-gaps"><h3>研究空白</h3><ul>${r.gaps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul></section>` : ''}
      ${r.nextSteps.length ? `<section class="report-next"><h3>下一步建议</h3><ul>${r.nextSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul></section>` : ''}
      ${referenceSeeds ? `<section class="report-seeds"><h3>参考论文 (${referenceSeeds.length} 篇)</h3><ul>${referenceSeeds.map((s) => `<li>arXiv:${escapeHtml(s.arxivId)} — ${escapeHtml(s.title)}</li>`).join('')}</ul></section>` : ''}
    </div>
  `;
}

export function renderReportNextStepsHTML(): string {
  const r = current?.report;
  if (!r || !r.nextSteps.length) return '';
  return `
    <section class="report-next-steps">
      <h3>建议下一步</h3>
      <ol>${r.nextSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
      <div class="report-next-actions">
        <button type="button" class="topic-btn ghost" data-act="regenerate-report">🔄 重新生成</button>
        <button type="button" class="topic-btn ghost" data-act="copy-report-md">📋 复制 Markdown</button>
        <button type="button" class="topic-btn ghost" data-act="download-report-md">💾 下载 Markdown</button>
      </div>
    </section>
  `;
}

export function renderReportStage(): void {
  const out = document.getElementById('report-out');
  if (!out) return;
  const r = current?.report;
  if (!current || !r) {
    out.innerHTML = '<p class="report-empty">还没有报告 — 至少总结 1 篇论文后才能生成。</p>';
    return;
  }
  out.innerHTML = renderReportToHTML(r);
  bindReportNextStepsActions(out);
  renderReportChat();
}

export function bindReportNextStepsActions(out: HTMLElement): void {
  out.querySelectorAll('[data-act="regenerate-report"]').forEach((el) => {
    el.addEventListener('click', () => {
      (window as unknown as { __doGenerateReport?: () => Promise<void> }).__doGenerateReport?.();
    });
  });
  out.querySelectorAll('[data-act="copy-report-md"]').forEach((el) => {
    el.addEventListener('click', () => {
      (window as unknown as { __copyReportAsMarkdown?: () => void }).__copyReportAsMarkdown?.();
    });
  });
  out.querySelectorAll('[data-act="download-report-md"]').forEach((el) => {
    el.addEventListener('click', () => {
      (window as unknown as { __downloadReportAsMarkdown?: () => void }).__downloadReportAsMarkdown?.();
    });
  });
}

export function renderReportChat(): void {
  const out = document.getElementById('report-chat-thread');
  if (!out) return;
  if (!current) { out.innerHTML = ''; return; }
  const msgs = current.reportChats ?? [];
  const recent = msgs.slice(-MAX_QA_FOR_REPORT);
  out.innerHTML = recent.map((m) => `
    <div class="chat-msg chat-${escapeHtml(m.role)}">
      <div class="chat-role">${m.role === 'user' ? '你' : 'AI'}</div>
      <div class="chat-content">${escapeHtml(m.content)}</div>
    </div>
  `).join('');
}

export function renderAll(): void {
  syncCurrent(S.getSession());
  renderSessionMeta();
  renderInputStage();
  renderFacetStage();
  renderSubqStage();
  renderCandStage();
  renderSummaryStage();
  renderReportStage();
  renderDebateStageSafe();
}

export function renderDebateStageSafe(): void {
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
    title: s.summary?.title || s.title || s.arxivId,
    elo_rating: 1200,
  }));
  if (ideas.length < 2) {
    const meta = document.getElementById('debate-meta');
    if (meta) meta.textContent = '至少需要 2 篇速览笔记才能辩论';
    return;
  }
  import('../topic-search-v2')
    .then((mod) => mod.renderDebateStage(current!.id, ideas))
    .then(() => {
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
      const linkEl = document.getElementById('debate-detail-link') as HTMLAnchorElement | null;
      if (linkEl && current) {
        const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
        linkEl.href = `${base}/topics/${encodeURIComponent(current.id)}/debate/`;
        linkEl.hidden = false;
      }
    })
    .catch((e) => console.warn('[topic.v2] renderDebateStage skipped:', e));
}

// 暴露给 orchestrator + report-markdown 的 window 回调占位（步骤 11 actions 抽出后改回直接 import）
(window as unknown as { __renderReportStage?: () => void }).__renderReportStage = () => renderReportStage();