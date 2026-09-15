// 客户端脚本:用户文献库(复数 libraries)UI 全套。
//
// 对照 Polaris LibrariesPage / NewLibraryModal / LibraryPicker / LibraryDetailPage
// 的行为,跑在浏览器单页模式下:打开/关闭弹窗、提交新建、删除、改名、
// 「+ 加进文献库」多选弹层。
//
// 设计原则(沿用 lib/user-libraries/store.ts:commit() 的单一写入漏斗):
//   - 写操作 100% 走 store.ts 的 mutator(createLibrary / renameLibrary /
//     deleteLibrary / addPaperToLibrary / removePaperFromLibrary),不绕道;
//   - 监听 dpr:user-libraries-change 事件统一重渲,避免漏改;
//   - SSR 期无 localStorage → store 全部返回空 doc,事件不触发;
//     DOM 应当显示空状态 + 提示「在浏览器里创建」,由用户决定是否新建。
//
// 不依赖任何外部库;vanilla TS(沿用 scripts/paper-hide.ts 等老脚本风格)。

import { canonicalArxivId } from '../lib/arxiv';
import { onDprUserLibrariesChange } from '../lib/events';
import {
  AUDIENCE_PROFILES,
  type AudienceProfileId,
} from '../lib/library/audience-profiles';
import { recordFeedback } from '../lib/library/feedback';
import {
  addLibraryAnchor,
  addPaperToLibrary,
  bulkRemovePapersFromLibrary,
  bulkSetPaperStatus,
  createLibrary,
  deleteLibrary,
  getUserLibrary,
  listLibrariesContainingPaper,
  listLibrariesContainingPaperDetailed,
  listUserLibraries,
  removeLibraryAnchor,
  removeLibraryConceptOverride,
  removePaperFromLibrary,
  renameLibrary,
  setLibraryArchived,
  setLibraryConceptOverride,
  setLibraryPaperMeta,
  setLibraryVisibility,
  updateLibraryDefinition,
  defaultLibraryDefinition,
  type LibraryAnchor,
  type LibraryConceptOverride,
  type LibraryHue,
  type LibraryPaperMeta,
  type LibraryPaperStatus,
  type LibraryRubricItem,
  type UserLibrary,
  LIBRARY_HUES,
} from '../lib/user-libraries';
import { showToast } from './toast';

const HUE_LIST: readonly LibraryHue[] = LIBRARY_HUES;

// ----------------------------------------------------------------
// 工具
// ----------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 把候选列表渲染到 ingest mount 里(供 runIngestFlow 和 runFindSimilar 共用)。
 *  - checkbox 多选 + 顶部 全选/全不选/纳入选中
 *  - 行内 ✓ 纳入 / ⏭ 跳过 / 📝 备注 / arXiv 链接
 *  - 自动 wire 全部 handlers(操作 cache 通过 dataset.candidates 传)
 *  - mount 是 ingest 面板的根元素 */
function renderCandidateList(
  mount: HTMLElement,
  libId: string,
  candidates: Array<{ cx: string; arxivId: string; title: string; authors: string[]; abstract: string; date: string; score: number; novelty?: number; reason: string; inLibrary: boolean }>,
  threshold: number,
  daysBack: number,
): void {
  mount.innerHTML = `
    <div class="lib-ingest-panel">
      <div class="lib-ingest-header">
        <h3>🛰️ Ingest · 候选 ${candidates.length} 篇(阈值 ${threshold.toFixed(2)} · ${daysBack} 天)</h3>
        <p class="muted">按相关度×(1+0.3×新颖性)倒序。新颖性越高越靠前。点「✓ 纳入」加进 paperIds;勾选多个后用顶部「✓ 纳入选中(N)」批量处理。</p>
        <div class="lib-ingest-batch">
          <button type="button" class="btn btn-soft btn-sm" data-ingest-batch="check-all">☑ 全选</button>
          <button type="button" class="btn btn-soft btn-sm" data-ingest-batch="uncheck-all">☐ 全不选</button>
          <button type="button" class="btn btn-primary btn-sm" data-ingest-batch="include-checked">✓ 纳入选中(<span data-ingest-checked-count>0</span>)</button>
          <button type="button" class="btn btn-soft btn-sm" data-ingest-batch="include-top" data-threshold="0.7">✓ 批量纳入 ≥ 0.70</button>
          <button type="button" class="btn btn-soft btn-sm" data-ingest-batch="include-top" data-threshold="0.5">✓ 批量纳入 ≥ 0.50</button>
          <button type="button" class="btn btn-ghost btn-sm" data-ingest-batch="hide">关闭面板</button>
        </div>
      </div>
      <div class="lib-ingest-list">
        ${candidates.map((c, idx) => `
          <div class="lib-ingest-row" data-cx="${escapeHtml(c.cx)}">
            <div class="lib-ingest-meta">
              <input type="checkbox" class="lib-ingest-check" data-ingest-check data-cx="${escapeHtml(c.cx)}" aria-label="选中候选 ${idx + 1}" />
              <span class="lib-ingest-score s-${c.score >= 0.7 ? 'h' : c.score >= 0.55 ? 'm' : 'l'}">${c.score.toFixed(2)}</span>
              <span class="lib-ingest-id">${escapeHtml(c.arxivId)}</span>
              <span class="lib-ingest-date">${escapeHtml(c.date || '—')}</span>
            </div>
            <div class="lib-ingest-title">${escapeHtml(c.title)}</div>
            <div class="lib-ingest-authors">${escapeHtml(c.authors.slice(0, 5).join(', '))}${c.authors.length > 5 ? ` +${c.authors.length - 5}` : ''}</div>
            ${c.reason ? `<div class="lib-ingest-reason">${escapeHtml(c.reason)}</div>` : ''}
            <div class="lib-ingest-actions">
              <button type="button" class="btn btn-primary btn-sm" data-ingest-action="include" data-cx="${escapeHtml(c.cx)}" data-idx="${idx}">✓ 纳入</button>
              <button type="button" class="btn btn-ghost btn-sm" data-ingest-action="skip" data-cx="${escapeHtml(c.cx)}" data-idx="${idx}">⏭ 跳过</button>
              <button type="button" class="btn btn-ghost btn-sm" data-ingest-action="note" data-cx="${escapeHtml(c.cx)}" data-idx="${idx}" title="为这次打分写一条备注(写入反馈日志,用于校准画像)">📝 备注</button>
              <a class="btn btn-ghost btn-sm" href="https://arxiv.org/abs/${encodeURIComponent(c.arxivId.replace(/v\d+$/, ''))}" target="_blank" rel="noopener">🔗 arXiv</a>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  // 缓存 candidates 到 dataset
  mount.querySelector<HTMLElement>('.lib-ingest-panel')!.dataset.candidates = JSON.stringify(
    candidates.map((c) => ({ cx: c.cx, arxivId: c.arxivId, score: c.score, reason: c.reason })),
  );

  // 同步 checkbox 计数
  const updateCheckedCount = () => {
    const n = mount.querySelectorAll<HTMLInputElement>('[data-ingest-check]:checked').length;
    const el = mount.querySelector<HTMLElement>('[data-ingest-checked-count]');
    if (el) el.textContent = String(n);
  };
  mount.querySelectorAll<HTMLInputElement>('[data-ingest-check]').forEach((cb) => {
    cb.addEventListener('change', updateCheckedCount);
  });

  // 行内动作
  mount.querySelectorAll<HTMLButtonElement>('[data-ingest-action]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = btn.dataset.ingestAction;
      const cx = btn.dataset.cx || '';
      const panel = mount.querySelector<HTMLElement>('.lib-ingest-panel');
      const cached = JSON.parse(panel?.dataset.candidates || '[]') as Array<{ cx: string; arxivId: string; score: number; reason: string }>;
      const cand = cached.find((x) => x.cx === cx);
      if (!cand) return;
      if (action === 'include') {
        // 动态 import 避免冷启动膨胀
        const { commitCandidateAsIncluded } = await import('./library-ingest');
        commitCandidateAsIncluded(libId, {
          cx: cand.cx, arxivId: cand.arxivId, score: cand.score, reason: cand.reason,
          title: '', authors: [], abstract: '', date: '', inLibrary: false,
        });
        showToast(`已纳入 ${cand.arxivId}`, 'ok');
        btn.closest<HTMLElement>('.lib-ingest-row')?.remove();
      } else if (action === 'skip') {
        btn.closest<HTMLElement>('.lib-ingest-row')?.remove();
      } else if (action === 'note') {
        const note = window.prompt(
          `为 ${cand.arxivId}(LLM 打分 ${cand.score.toFixed(2)})写一条备注:\n` +
          `会写入反馈日志,用于校准画像打分偏差。最多 500 字。`,
          '',
        );
        if (note === null) return;
        const trimmed = note.trim().slice(0, 500);
        if (!trimmed) {
          showToast('备注为空,未写入', 'info');
          return;
        }
        const currentLib = getUserLibrary(libId);
        recordFeedback({
          kind: 'feedback_note',
          libraryId: libId,
          arxivId: cand.arxivId,
          value: cand.score,
          text: trimmed,
          audienceProfile: currentLib?.definition?.audienceProfile,
        });
        showToast(`✓ 备注已记录(${trimmed.length} 字)`, 'ok');
      }
    });
  });

  // 批量动作
  mount.querySelectorAll<HTMLButtonElement>('[data-ingest-batch]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const action = btn.dataset.ingestBatch;
      const { commitCandidateAsIncluded } = await import('./library-ingest');
      if (action === 'hide') {
        mount.innerHTML = '';
        return;
      }
      if (action === 'check-all') {
        mount.querySelectorAll<HTMLInputElement>('[data-ingest-check]').forEach((cb) => { cb.checked = true; });
        updateCheckedCount();
        return;
      }
      if (action === 'uncheck-all') {
        mount.querySelectorAll<HTMLInputElement>('[data-ingest-check]').forEach((cb) => { cb.checked = false; });
        updateCheckedCount();
        return;
      }
      if (action === 'include-checked') {
        const panel = mount.querySelector<HTMLElement>('.lib-ingest-panel');
        const cached = JSON.parse(panel?.dataset.candidates || '[]') as Array<{ cx: string; arxivId: string; score: number; reason: string }>;
        const checkedCxs = new Set(
          Array.from(mount.querySelectorAll<HTMLInputElement>('[data-ingest-check]:checked'))
            .map((cb) => cb.dataset.cx || '').filter(Boolean),
        );
        let n = 0;
        for (const cand of cached) {
          if (!checkedCxs.has(cand.cx)) continue;
          commitCandidateAsIncluded(libId, {
            cx: cand.cx, arxivId: cand.arxivId, score: cand.score, reason: cand.reason,
            title: '', authors: [], abstract: '', date: '', inLibrary: false,
          });
          n++;
          const row = mount.querySelector<HTMLElement>(`.lib-ingest-row[data-cx="${cand.cx}"]`);
          row?.remove();
        }
        showToast(`批量纳入选中 ${n} 篇`, 'ok');
        updateCheckedCount();
        renderUserLibraryDetail();
        return;
      }
      if (action === 'include-top') {
        const thr = parseFloat(btn.dataset.threshold || '0.7');
        const panel = mount.querySelector<HTMLElement>('.lib-ingest-panel');
        const cached = JSON.parse(panel?.dataset.candidates || '[]') as Array<{ cx: string; arxivId: string; score: number; reason: string }>;
        let n = 0;
        for (const cand of cached) {
          if (cand.score < thr) break;
          commitCandidateAsIncluded(libId, {
            cx: cand.cx, arxivId: cand.arxivId, score: cand.score, reason: cand.reason,
            title: '', authors: [], abstract: '', date: '', inLibrary: false,
          });
          n++;
        }
        showToast(`批量纳入 ${n} 篇`, 'ok');
        renderUserLibraryDetail();
        openIngestPanel(libId);
      }
    });
  });
}

/** Ingest 面板入口。点击 Govern tab「启动 Ingest」按钮触发。
 *  - 动态 import library-ingest 模块(避免冷启动 bundle 膨胀)
 *  - 调 runIngest(),把候选列表渲染到 #lib-ingest-mount
 *  - 每条候选三个动作:候选 / 纳入 / 跳过 */
async function openIngestPanel(libId: string): Promise<void> {
  const mount = document.getElementById('lib-ingest-mount');
  if (!mount) {
    showToast('找不到 ingest 容器', 'error');
    return;
  }
  // 锁住按钮 + 显示 loading
  mount.innerHTML = `
    <div class="lib-ingest-panel">
      <div class="lib-ingest-header">
        <h3>🛰️ Ingest · 调优参数</h3>
        <p class="muted">改完点「▶ 启动」即跑;不改动直接启动也行。</p>
      </div>
      <div class="lib-ingest-settings">
        <label class="lib-ingest-setting">
          阈值 ≥ <input type="number" min="0" max="1" step="0.05" value="${lib.definition?.relevanceThreshold ?? 0.5}" data-ingest-threshold title="LLM 打分低于此值的论文不入候选。0.5 = 默认(主要内容在这个方向);0.3 = 宽松(顺便提到也收);0.75 = 严格(只收贴库)" />
          <span class="muted">(LLM 打分低于此值的论文不入候选;hover 看推荐值)</span>
        </label>
        <label class="lib-ingest-setting">
          时间窗 <input type="number" min="7" max="365" step="1" value="30" data-ingest-daysback />
          <span class="muted">天(经典论文补录建议设 90-180)</span>
        </label>
        <label class="lib-ingest-setting">
          最多候选 <input type="number" min="10" max="100" step="10" value="50" data-ingest-max />
          <span class="muted">篇</span>
        </label>
        <button type="button" class="btn btn-primary btn-sm" data-ingest-run>▶ 启动 Ingest</button>
        <button type="button" class="btn btn-soft btn-sm" data-ingest-find-similar title="用本库已有论文的标题去 arXiv 扩搜,不调 LLM,快速补充候选">🔍 找相似</button>
      </div>
      <div class="lib-ingest-progress" data-ingest-progress hidden>
        <div class="lib-ingest-progress-bar"><div class="lib-ingest-progress-fill" data-ingest-progress-fill style="width:0%"></div></div>
        <span data-ingest-status>准备中…</span>
      </div>
    </div>
  `;
  const statusEl = mount.querySelector<HTMLElement>('[data-ingest-status]');
  const fillEl = mount.querySelector<HTMLElement>('[data-ingest-progress-fill]');
  const progressEl = mount.querySelector<HTMLElement>('[data-ingest-progress]');
  const setStatus = (s: string) => { if (statusEl) statusEl.textContent = s; };
  const setProgress = (pct: number) => { if (fillEl) fillEl.style.width = `${Math.round(pct)}%`; };

  // 启动按钮:从 UI 读参数 → 跑
  const runBtn = mount.querySelector<HTMLButtonElement>('[data-ingest-run]');
  runBtn?.addEventListener('click', () => runIngestFlow());

  // 「🔍 找相似」按钮 — 拿本库已有论文的标题去 arXiv 扩搜,不调 LLM,3-5s 出结果
  const findSimilarBtn = mount.querySelector<HTMLButtonElement>('[data-ingest-find-similar]');
  findSimilarBtn?.addEventListener('click', () => runFindSimilar());
  async function runFindSimilar(): Promise<void> {
    if (findSimilarBtn) findSimilarBtn.disabled = true;
    if (progressEl) progressEl.hidden = false;
    setStatus('找相似:从本库论文标题拼查询…');
    setProgress(10);
    try {
      // 取本库论文
      const currentLib = getUserLibrary(libId);
      if (!currentLib) throw new Error('library 不存在');
      const cxs = new Set(currentLib.paperIds);
      const myPapers = allPapers.filter((p) => cxs.has(p.canonicalArxivId || p.id));
      if (myPapers.length === 0) {
        showToast('库内还没有论文,先用「▶ 启动 Ingest」或「➕ 加进此库」', 'info');
        return;
      }
      // 取 5 篇最有代表性的(按 score,无 score 则按 date)
      const withScore = myPapers
        .map((p) => ({ p, s: (p as any).relevanceScore ?? (p as any).score ?? 0 }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 5);
      // 抽 3-5 个核心短语(title 的名词短语提取太重,这里取 title 前 4 个英文单词 OR 第一个中文字段)
      const tokens: string[] = [];
      for (const { p } of withScore) {
        const t = (p.title || p.title_zh || '').trim();
        if (!t) continue;
        // 简单:英文字符 ≥ 50% 就用前 4 个单词;否则取前 8 个汉字
        const en = t.replace(/[^A-Za-z\s]/g, '').trim();
        if (en.length / Math.max(1, t.length) > 0.5) {
          tokens.push(...en.split(/\s+/).slice(0, 4).filter((w) => w.length > 2));
        } else {
          tokens.push(t.slice(0, 8));
        }
      }
      const uniqTokens = Array.from(new Set(tokens)).slice(0, 6);
      if (uniqTokens.length === 0) throw new Error('本库论文无有效标题可抽词');

      setStatus(`找相似:用 ${uniqTokens.length} 个本库关键词搜 arXiv…`);
      setProgress(30);
      // 直接调 arXiv API,跟 fetchArxivCandidates 同结构
      const query = uniqTokens.map((k) => `ti:"${k.replace(/"/g, '')}" OR abs:"${k.replace(/"/g, '')}"`).join(' OR ');
      const now = new Date();
      const past = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 天窗,找相似更广
      const fmt = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 13);
      const dateFilter = `submittedDate:[${fmt(past)} TO ${fmt(now)}]`;
      const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`(${query}) AND ${dateFilter}`)}&max_results=40&sortBy=submittedDate&sortOrder=descending`;
      const proxyUrl = (typeof localStorage !== 'undefined' && localStorage.getItem('dpr_cors_proxy_v1')) || '';
      const fetchUrl = proxyUrl ? `${proxyUrl.replace(/\/+$/, '')}/${url}` : url;
      const resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error(`arXiv API HTTP ${resp.status}`);
      const xml = await resp.text();
      // 简单 XML 解析(复用 library-ingest 的 parseArxivList 思路)
      const entries = xml.split(/<entry>/).slice(1).map((raw) => {
        const block = raw.split(/<\/entry>/)[0] || raw;
        const idMatch = block.match(/<id>([^<]+)<\/id>/);
        const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
        const summaryMatch = block.match(/<summary>([\s\S]*?)<\/summary>/);
        const publishedMatch = block.match(/<published>([^<]+)<\/published>/);
        const authorBlocks = block.match(/<author>\s*<name>([^<]+)<\/name>\s*<\/author>/g) || [];
        const arxivId = idMatch ? (idMatch[1].split('/').pop() || '') : '';
        if (!arxivId || !titleMatch) return null;
        const cx = arxivId.replace(/v\d+$/, '');
        return {
          cx,
          arxivId,
          title: titleMatch[1].trim().replace(/\s+/g, ' '),
          authors: authorBlocks.map((b) => (b.match(/<name>([^<]+)<\/name>/) || [])[1] || '').filter(Boolean),
          abstract: summaryMatch ? summaryMatch[1].trim().replace(/\s+/g, ' ') : '',
          date: publishedMatch ? publishedMatch[1].slice(0, 10) : '',
        };
      }).filter((e): e is NonNullable<typeof e> => e !== null);

      // 去重 + 去掉已在库内的
      const seen = new Set<string>();
      const inLib = new Set(currentLib.paperIds);
      const fresh = entries.filter((e) => {
        if (seen.has(e.cx)) return false;
        seen.add(e.cx);
        return !inLib.has(e.cx);
      });
      setProgress(100);
      if (fresh.length === 0) {
        mount.innerHTML = `
          <div class="lib-ingest-panel">
            <h3>🔍 找相似 · 0 篇新候选</h3>
            <p class="muted">用本库 ${withScore.length} 篇代表性论文的标题在 arXiv 最近 90 天里没找到新论文。</p>
            <p class="muted">建议:①调整这些论文的 inScope②补几个包括关键词③用「▶ 启动 Ingest」按完整关键词搜。</p>
            <button type="button" class="btn btn-soft btn-sm" data-ingest-retry>← 调优重试</button>
          </div>
        `;
        mount.querySelector<HTMLButtonElement>('[data-ingest-retry]')?.addEventListener('click', () => openIngestPanel(libId));
        return;
      }
      // 直接复用 candidate 渲染(无 LLM score 时默认 0.5 占位 + 0 标记,让用户手动勾)
      const candidates = fresh.map((e) => ({
        ...e,
        score: 0.5,
        reason: '🔍 找相似:基于本库论文标题匹配(未走 LLM 打分)',
        inLibrary: false,
      }));
      renderCandidateList(mount, libId, candidates, threshold, 90);
      const { persistCandidatesAsCandidate } = await import('./library-ingest');
      persistCandidatesAsCandidate(libId, candidates);
      showToast(`找相似:拉回 ${candidates.length} 篇候选`, 'ok');
    } catch (e) {
      setStatus(`找相似失败:${(e as Error).message || String(e)}`);
      showToast(`找相似失败:${(e as Error).message}`, 'error');
    } finally {
      if (findSimilarBtn) findSimilarBtn.disabled = false;
    }
  }
  async function runIngestFlow(): Promise<void> {
    const thrEl = mount.querySelector<HTMLInputElement>('[data-ingest-threshold]');
    const daysEl = mount.querySelector<HTMLInputElement>('[data-ingest-daysback]');
    const maxEl = mount.querySelector<HTMLInputElement>('[data-ingest-max]');
    const threshold = thrEl ? Math.max(0, Math.min(1, parseFloat(thrEl.value) || 0.5)) : 0.5;
    const daysBack = daysEl ? Math.max(7, Math.min(365, parseInt(daysEl.value, 10) || 30)) : 30;
    const maxResults = maxEl ? Math.max(10, Math.min(100, parseInt(maxEl.value, 10) || 50)) : 50;
    if (runBtn) runBtn.disabled = true;
    if (progressEl) progressEl.hidden = false;
    setStatus('加载 ingest 模块…');
    setProgress(5);
    const { runIngest, persistCandidatesAsCandidate } = await import('./library-ingest');

    setStatus(`拉 arXiv 候选(${daysBack}天 / 上限 ${maxResults} 篇)…`);
    setProgress(15);
    try {
      const candidates = await runIngest(libId, {
        daysBack,
        maxResults,
        threshold,
        onProgress: (p) => {
          setProgress(p.pct);
          setStatus(p.message);
        },
      });
      setProgress(100);
      if (candidates.length === 0) {
        mount.innerHTML = `
          <div class="lib-ingest-panel">
            <h3>🛰️ Ingest 完成 · 没找到合适的论文</h3>
            <p class="muted">arXiv 在 ${daysBack} 天内没找到 ≥ ${threshold.toFixed(2)} 分的论文。</p>
            <p class="muted"><strong>先试这个(成功率最高):</strong></p>
            <ol style="margin: 0.5rem 0; padding-left: 1.2rem;">
              <li>点「🔍 找相似」按钮,用你已纳入的论文标题搜,3-5 秒出候选</li>
              <li>把阈值降到 <code>0.30</code>,多收一些进来再慢慢挑</li>
              <li>补几个你熟悉的论文关键词(如 RLHF / agent / preference optimization)</li>
            </ol>
            <button type="button" class="btn btn-soft btn-sm" data-ingest-retry>← 调参数重跑</button>
          </div>
        `;
        mount.querySelector<HTMLButtonElement>('[data-ingest-retry]')?.addEventListener('click', () => openIngestPanel(libId));
        return;
      }

      // 写候选状态(走 candidate,不直接进 paperIds)
      persistCandidatesAsCandidate(libId, candidates);
      showToast(`拉回 ${candidates.length} 篇候选(已写入 candidate 状态)`, 'ok');

      // 渲染候选列表(checkbox 多选已支持)
      renderCandidateList(mount, libId, candidates, threshold, daysBack);
      showToast(`排序已更新:相关度×(1+0.3×新颖性),新颖论文会靠前`, 'info');
    } catch (e) {
      setStatus(`失败:${(e as Error).message || String(e)}`);
      showToast(`Ingest 失败:${(e as Error).message}`, 'error');
      if (runBtn) runBtn.disabled = false;
    }
  }
  // 触发首次渲染(用户可调整后再点启动,或直接启动)
}

/** AI 访谈流 —— 引导用户三步生成 statement。
 *  每步:LLM 给建议 → 用户可编辑 → 「下一题」commit 进 history。 */
async function runInterviewFlow(
  modal: HTMLElement,
  panel: HTMLElement,
): Promise<void> {
  const { runInterviewStep, summarizeInterview } = await import('./library-statement-interview');
  type StepId = 'topic' | 'subtopic' | 'audience';
  const steps: StepId[] = ['topic', 'subtopic', 'audience'];
  const history: { id: StepId; question: string; answer: string; suggestion: string; rationale: string }[] = [];
  let current = 0;
  // 实时读 modal 里的文献库名称 —— 用户改 name 输入框就同步给 LLM
  const readLibraryName = () => modal.querySelector<HTMLInputElement>('[data-modal-name]')?.value.trim() || '';

  function renderStep(): void {
    const stepId = steps[current];
    if (!stepId) {
      // 完结:综合
      const summary = summarizeInterview(history);
      panel.innerHTML = `
        <h4>✅ 访谈完成</h4>
        <p class="muted">基于你的回答,推荐 statement:</p>
        <blockquote class="lib-interview-suggestion">${escapeHtml(summary.statement)}</blockquote>
        <p class="muted">推荐分类:${summary.categories.map((c) => `<span class="lib-tag">${escapeHtml(c)}</span>`).join('')}</p>
        <p class="muted">推荐关键词(include):${summary.inclusionKeywords.map((k) => `<span class="lib-tag include">${escapeHtml(k)}</span>`).join('')}</p>
        <div class="lib-interview-actions">
          <button type="button" class="btn btn-primary btn-sm" data-interview-apply>应用到表单</button>
          <button type="button" class="btn btn-ghost btn-sm" data-interview-restart>重新开始</button>
        </div>
      `;
      panel.querySelector('[data-interview-apply]')?.addEventListener('click', () => {
        // 写到 modal
        const stmtTA = modal.querySelector<HTMLTextAreaElement>('[data-modal-statement]');
        if (stmtTA && summary.statement) stmtTA.value = summary.statement;
        const controls = controlsByModal.get(modal);
        if (controls && summary.inclusionKeywords.length > 0) {
          controls.inclusion.loadFrom(summary.inclusionKeywords);
        }
        if (controls && summary.exclusionKeywords.length > 0) {
          controls.exclusion.loadFrom(summary.exclusionKeywords);
        }
        if (controls && summary.categories.length > 0) {
          controls.categories.loadFrom(summary.categories);
        }
        showToast('已应用 statement / 关键词 / 分类', 'ok');
        panel.hidden = true;
      });
      panel.querySelector('[data-interview-restart]')?.addEventListener('click', () => {
        history.length = 0;
        current = 0;
        renderStep();
      });
      return;
    }

    panel.innerHTML = `
      <div class="lib-interview-head">
        <h4>🎤 AI 访谈:把方向说清楚</h4>
        <button type="button" class="btn-icon" data-interview-cancel title="关闭" aria-label="关闭">×</button>
      </div>
      <p class="muted lib-interview-sub">这段描述既用来自动挑论文,也用来给论文打分 —— 写得越具体,收得越准。</p>
      <div class="lib-interview-progress" data-interview-progress>
        <div class="lib-interview-progress-bar"><div class="lib-interview-progress-fill" style="width:${((current) / steps.length) * 100}%"></div></div>
        <span>${current + 1} / ${steps.length}</span>
      </div>
      <div class="lib-interview-q" data-interview-question></div>
      <div class="lib-interview-options" data-interview-options>
        <div class="lib-interview-options-loading"><span class="lib-spinner"></span> 正在生成候选…</div>
      </div>
      <div class="lib-interview-other">
        <label class="muted">其他(自己写,可与上面同时选)</label>
        <textarea class="lib-interview-other-ta" rows="2" placeholder="补充这个环节的具体内容…" data-interview-other></textarea>
      </div>
      <div class="lib-interview-rationale" data-interview-suggestion hidden></div>
      <div class="lib-interview-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-interview-cancel>取消</button>
        <button type="button" class="btn btn-primary btn-sm" data-interview-next ${current === steps.length - 1 ? 'data-interview-finish' : ''}>${current === steps.length - 1 ? '✓ 完成' : '下一步'}</button>
      </div>
    `;
    const qEl = panel.querySelector<HTMLElement>('[data-interview-question]');
    const qName = readLibraryName() || '这个库';
    if (qEl) qEl.textContent = stepId === 'topic'
      ? `「${qName}」打算跟踪哪个大致研究方向?`
      : stepId === 'subtopic'
      ? `「${qName}」主要想回答哪些核心子问题?`
      : `「${qName}」这个库的论文,打算用来做什么?`;

    const optionsEl = panel.querySelector<HTMLElement>('[data-interview-options]');
    const otherTA = panel.querySelector<HTMLTextAreaElement>('[data-interview-other]');
    const sugEl = panel.querySelector<HTMLElement>('[data-interview-suggestion]');

    const renderOptions = (list: string[], rationale?: string) => {
      if (!optionsEl) return;
      if (!list || list.length === 0) {
        optionsEl.innerHTML = '<div class="muted">未生成候选 —— 下方「其他」自写你的方向。</div>';
      } else {
        optionsEl.innerHTML = list
          .map((c, i) => `
            <label class="lib-interview-option">
              <input type="checkbox" data-opt-idx="${i}">
              <span>${escapeHtml(c)}</span>
            </label>
          `).join('');
        optionsEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((cb) => {
          cb.addEventListener('change', () => {
            const anyChecked = optionsEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked').length > 0;
            if (anyChecked && rationale && sugEl) {
              sugEl.innerHTML = `<em class="muted">${escapeHtml(rationale)}</em>`;
              sugEl.hidden = false;
            }
          });
        });
      }
    };

    const runOptionsGen = async () => {
      if (optionsEl) {
        optionsEl.innerHTML = '<div class="lib-interview-options-loading"><span class="lib-spinner"></span> 正在生成候选…</div>';
      }
      try {
        const r = await runInterviewStep(stepId, history.map((h) => ({
          ...h,
          answer: h.answer || (otherTA?.value.trim() || ''),
        })), '', readLibraryName());
        renderOptions(r.candidates || [], r.rationale);
      } catch (err) {
        if (optionsEl) optionsEl.innerHTML = `
          <div class="lib-interview-options-error">
            <div class="muted error">⚠️ 生成失败:${escapeHtml((err as Error).message)}</div>
            <button type="button" class="btn btn-soft btn-sm" data-interview-retry>🔄 重试</button>
            <span class="muted">或用下方「其他」自写。</span>
          </div>
        `;
        optionsEl.querySelector('[data-interview-retry]')?.addEventListener('click', () => {
          void runOptionsGen();
        });
      }
    };

    // 首屏自动生成候选
    void runOptionsGen();

    panel.querySelector('[data-interview-cancel]')?.addEventListener('click', () => {
      panel.hidden = true;
      panel.innerHTML = '';
    });

    panel.querySelector('[data-interview-next], [data-interview-finish]')?.addEventListener('click', () => {
      // 收集勾选的 options + 其他 textarea,组合成最终回答
      const checkedTexts: string[] = [];
      optionsEl?.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked').forEach((cb) => {
        const lbl = cb.closest('.lib-interview-option');
        const span = lbl?.querySelector('span');
        const text = span?.textContent?.trim();
        if (text) checkedTexts.push(text);
      });
      const other = otherTA?.value.trim() || '';
      const combined = [...checkedTexts, other ? `其他:${other}` : ''].filter(Boolean).join(' | ');
      const ans = combined || '(未填)';
      history[current] = {
        id: stepId,
        question: qEl?.textContent || '',
        answer: ans,
        suggestion: '',
        rationale: sugEl?.textContent || '',
      };
      current += 1;
      renderStep();
    });
  }
  renderStep();
}

/** 渲染 string[] 列表(govern tab 用);空数组 fallback 到 empty 文案。 */
function renderList(items: string[] | undefined, empty: string): string {
  if (!items || items.length === 0) return `<em class="empty">${escapeHtml(empty)}</em>`;
  return `<ul class="govern-list">${items.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;
}

/** Polaris library_papers.status → UI badge。
 *  - candidate  = LLM 还没打分
 *  - scored     = LLM 打分完,等用户确认
 *  - included   = 已纳入(membership 默认值)
 *  - excluded   = 用户/打分剔除
 *  - trashed    = 回收站 */
function renderStatusBadge(status: string): string {
  const map: Record<string, { label: string; emoji: string; cls: string }> = {
    candidate: { label: '候选', emoji: '🕐', cls: 'badge-candidate' },
    scored:    { label: '已打分', emoji: '⭐', cls: 'badge-scored' },
    included:  { label: '已纳入', emoji: '✓', cls: 'badge-included' },
    excluded:  { label: '已剔除', emoji: '✗', cls: 'badge-excluded' },
    trashed:   { label: '回收站', emoji: '🗑', cls: 'badge-trashed' },
  };
  const m = map[status];
  if (!m) return '';
  return `<span class="row-status ${m.cls}">${m.emoji} ${m.label}</span>`;
}

/** 极简 markdown → HTML(Digest 显示用,不需要 fig/table 替换)。 */
/** 渲染 Polaris 风格 wiki 5 节中文 markdown 为 HTML(简化版)。
 *  Polaris 顺序:TL;DR / 研究背景与动机 / 方法 / 实验与结果 / 讨论与可借鉴点。
 *  不引外部 markdown 解析器 —— 标题 / 段落 / 列表 / **粗** / *斜* / `code` / [[wikilink]] 就够。
 *
 *  跳过 wiki 里所有 ## TL;DR 段 —— 详情面板已有 tldr-card(来自论文 frontmatter tldr)。
 *  否则用户会看到 TL;DR 出现 N 次(语义重复)。老翻译批次可能重复写了 5 节,
 *  所以用 /g 去掉所有 TL;DR 块,从 ## 研究背景与动机 之类开始。 */
function renderWikiMarkdown(md: string): string {
  md = md.replace(
    /^## TL;DR\s*\n+[\s\S]*?(?=\n## (研究背景与动机|背景|方法|实验|结果|讨论|缺点|结论))/gm,
    '',
  );
  const esc = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const lines = esc.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let inList = false;
  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join(' ').trim();
    if (text) out.push(`<p>${inline(text)}</p>`);
    para = [];
  };
  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };
  const inline = (s: string) =>
    s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
     .replace(/\*([^*]+)\*/g, '<em>$1</em>')
     .replace(/`([^`]+)`/g, '<code>$1</code>')
     .replace(/\[\[([^\]]+)\]\]/g, (_m, n) => `<span class="wikilink">[[${escapeHtml(String(n))}]]</span>`);
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (l.startsWith('## ')) { flushPara(); closeList(); out.push(`<h2>${inline(l.slice(3))}</h2>`); continue; }
    if (l.startsWith('### ')) { flushPara(); closeList(); out.push(`<h3>${inline(l.slice(4))}</h3>`); continue; }
    if (l.startsWith('- ')) { flushPara(); if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(l.slice(2))}</li>`); continue; }
    if (l === '') { flushPara(); closeList(); continue; }
    para.push(l);
  }
  flushPara();
  closeList();
  return out.join('\n');
}

function renderDigestMarkdown(md: string): string {
  // escape first
  const esc = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // 段(以空行切)+ 行内(**粗** / *斜*)
  const lines = esc.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let inList = false;
  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join(' ').trim();
    if (text) out.push(`<p>${inline(text)}</p>`);
    para = [];
  };
  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };
  const inline = (s: string) =>
    s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
     .replace(/\*([^*]+)\*/g, '<em>$1</em>')
     .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (l.startsWith('## ')) { flushPara(); closeList(); out.push(`<h2>${inline(l.slice(3))}</h2>`); continue; }
    if (l.startsWith('### ')) { flushPara(); closeList(); out.push(`<h3>${inline(l.slice(4))}</h3>`); continue; }
    if (l.startsWith('- ')) { flushPara(); if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(l.slice(2))}</li>`); continue; }
    if (l === '') { flushPara(); closeList(); continue; }
    para.push(l);
  }
  flushPara();
  closeList();
  return out.join('\n');
}

/** 渲染 digest mount:当前 digest + 历史 list。 */
function renderDigestMount(
  mount: HTMLElement,
  current: { markdown: string; paperCount: number; id: string; generatedAt: number; model: string; depth?: 'daily' | 'academic' } | null,
  history: Array<{ id: string; paperCount: number; generatedAt: number }>,
): void {
  const cur = current
    ? `
      <article class="digest-article ${current.depth === 'academic' ? 'digest-article-academic' : 'digest-article-daily'}">
        <header class="digest-article-head">
          <span class="digest-date">${escapeHtml(current.id)}</span>
          <span class="digest-depth-badge ${current.depth === 'academic' ? 'badge-academic' : 'badge-daily'}">${current.depth === 'academic' ? '📑 学术综述(IMRaD)' : '📰 日报'}</span>
          <span class="digest-stats">${current.paperCount} 篇 · 模型 ${escapeHtml(current.model)} · ${new Date(current.generatedAt).toLocaleString('zh-CN')}</span>
        </header>
        <div class="digest-body">${renderDigestMarkdown(current.markdown)}</div>
      </article>
    `
    : `<p class="muted">还没有 digest。点上方按钮生成。</p>`;
  const hist = history.length > 1
    ? `
      <details class="digest-history">
        <summary>历史(${history.length - 1} 份)</summary>
        <ul>
          ${history.filter((h) => !current || h.id !== current.id).slice(0, 10).map((h) => `
            <li>
              <button type="button" class="linklike" data-digest-open="${escapeHtml(h.id)}">${escapeHtml(h.id)}</button>
              <span class="muted"> · ${h.paperCount} 篇</span>
            </li>
          `).join('')}
        </ul>
      </details>
    `
    : '';
  mount.innerHTML = cur + hist;
}

/** 同步读 listDigests(避免 button click handler 里再 import 一遍) */
function listDigestsSnapshot(libId: string): Array<{ id: string; paperCount: number; generatedAt: number }> {
  const out: Array<{ id: string; paperCount: number; generatedAt: number }> = [];
  const prefix = `dpr_library_digest_v1:${libId}:`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(prefix)) continue;
    try {
      const d = JSON.parse(localStorage.getItem(k) || '') as { id: string; paperCount: number; generatedAt: number; markdown: string };
      if (d && d.markdown) out.push(d);
    } catch { /* ignore */ }
  }
  out.sort((a, b) => (b.id || '').localeCompare(a.id || ''));
  return out;
}

function fmtDateShort(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear().toString().slice(2)}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function baseHref(): string {
  // 静态站 BASE_URL 可能为空 / 或带尾 /;统一 strip
  const raw = (document.querySelector('base')?.getAttribute('href')) || '/';
  return raw.replace(/\/+$/, '') || '';
}

function url(path: string): string {
  return baseHref() + path;
}

function getApiResultMessage(res: { ok: boolean; reason?: string }): string {
  if (res.ok) return '';
  switch (res.reason) {
    case 'quota': return '浏览器存储已满,无法保存。请清理一些旧的笔记或高亮后再试。';
    case 'unavailable': return '浏览器不支持本地存储(localStorage 不可用)。';
    case 'invalid': return '字段校验失败:名称和方向描述都不能为空,长度也不能超限。';
    default: return `操作失败:${res.reason || '未知原因'}`;
  }
}

// ----------------------------------------------------------------
// 「我的文献库」section 渲染(给首页 / /libraries/ 用)
// ----------------------------------------------------------------

interface SectionRefs {
  section: HTMLElement;
  grid: HTMLElement;
  empty: HTMLElement | null;
  counter: HTMLElement | null;
  filter?: { activeType: 'all' | 'public' | 'personal' };
}

function renderUserLibraryCard(lib: UserLibrary): string {
  const detailUrl = url(`/libraries/?id=${encodeURIComponent(lib.id)}`);
  const titleEsc = escapeHtml(lib.name);
  const stmtEsc = escapeHtml(lib.statement);
  const created = fmtDateShort(lib.createdAt);
  return `
    <a class="library-card hue-${escapeHtml(lib.hue)}"
       href="${escapeHtml(detailUrl)}"
       data-lib-id="${escapeHtml(lib.id)}"
       data-lib-type="personal"
       data-dim="user">
      <h2 class="lib-title">
        <span class="lib-title-row">
          <span class="lib-name" title="${titleEsc}">${titleEsc}</span>
          <span class="lib-type-badge lib-type-badge--personal">个人</span>
        </span>
        <span class="lib-count">${lib.paperIds.length} 篇</span>
      </h2>
      <p class="lib-statement">${stmtEsc}</p>
      <div class="lib-stats">
        <span><strong>${lib.paperIds.length}</strong> 篇论文</span>
        <span>创建于 ${created}</span>
      </div>
      <div class="lib-meta">
        <span class="lib-type-badge lib-mine-badge">⭐ 我的</span>
        <button type="button"
                class="lib-action-btn lib-action-btn--danger"
                data-lib-action="delete"
                data-lib-id="${escapeHtml(lib.id)}"
                aria-label="删除文献库"
                title="删除文献库">🗑</button>
      </div>
    </a>
  `;
}

function renderUserLibrariesSection(refs: SectionRefs): void {
  const all = listUserLibraries();
  // 归档过滤:active 库才进默认卡片墙(隐藏 archived 防止首页噪音)
  const libs = all.filter((l) => l.definition?.cadence !== 'archived');
  const archived = all.filter((l) => l.definition?.cadence === 'archived');

  const counter = refs.counter;
  if (counter) {
    counter.textContent = archived.length > 0
      ? `${libs.length} 个(${archived.length} 已归档)`
      : `${libs.length} 个`;
  }

  if (libs.length === 0 && archived.length === 0) {
    if (refs.empty) {
      refs.empty.style.display = '';
      refs.grid.style.display = 'none';
    } else {
      refs.grid.innerHTML = `
        <div class="libraries-empty">
          <div class="libraries-empty-icon">📂</div>
          <h3 class="libraries-empty-title">还没有个人文献库</h3>
          <p class="libraries-empty-desc">
            在这里新建一个文献库,把你想精读 / 反复查阅的论文收在一起。
            存在浏览器里,跨设备同步走 Gist。
          </p>
          <button type="button" class="btn btn-primary" data-open-new-library>➕ 新建文献库</button>
        </div>
      `;
    }
    return;
  }

  if (refs.empty) refs.empty.style.display = 'none';
  refs.grid.style.display = '';
  refs.grid.innerHTML = libs.map(renderUserLibraryCard).join('');
  // 归档区(若有)
  if (archived.length > 0) {
    refs.grid.insertAdjacentHTML(
      'beforeend',
      `<details class="user-lib-archived">
        <summary>📦 已归档库(${archived.length} 个)</summary>
        <div class="user-lib-archived-grid">${archived.map(renderUserLibraryCard).join('')}</div>
      </details>`,
    );
  }

  // 过滤:如果 section 配了 type filter,只显示匹配项
  if (refs.filter) {
    const want = refs.filter.activeType;
    refs.grid.querySelectorAll<HTMLElement>('.library-card').forEach((el) => {
      const t = el.dataset.libType || 'personal';
      const show = want === 'all' || (want === 'public' ? t === 'public' : t === 'personal');
      el.style.display = show ? '' : 'none';
    });
  }
}

function setupUserLibrariesSection(): void {
  const sections = document.querySelectorAll<HTMLElement>('[data-user-libraries-section]');
  if (sections.length === 0) return;

  sections.forEach((section) => {
    const grid = section.querySelector<HTMLElement>('[data-user-libraries-grid]');
    const empty = section.querySelector<HTMLElement>('[data-user-libraries-empty]');
    const counter = section.querySelector<HTMLElement>('[data-user-libraries-counter]');
    if (!grid) return;

    const refs: SectionRefs = { section, grid, empty, counter };

    // 第一次渲染
    renderUserLibrariesSection(refs);

    // 监听事件,重渲整段
    const off = onDprUserLibrariesChange(window, () => renderUserLibrariesSection(refs));
    // Astro page-load 切换时不需要解绑(单页 reload 全部清掉)
    void off;

    // 删除按钮(事件代理)
    section.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-lib-action="delete"]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.libId || '';
      const lib = listUserLibraries().find((l) => l.id === id);
      if (!lib) return;
      const ok = window.confirm(
        `确定删除文献库「${lib.name}」吗?\n\n库内的论文不会从 docs 里删除,只是从你的收藏夹里移除。\n此操作不可撤销。`,
      );
      if (!ok) return;
      const res = deleteLibrary(id);
      if (!res.ok) {
        showToast(getApiResultMessage(res), 'error');
      } else {
        showToast(`已删除「${lib.name}」`, 'ok');
      }
    });
  });
}

// ----------------------------------------------------------------
// 「+ 新建文献库」按钮 + 弹窗(对照 Polaris NewLibraryModal)
// ----------------------------------------------------------------

function openModal(modal: HTMLElement): void {
  modal.style.display = 'flex';
  // 焦点放到 name input
  const nameInput = modal.querySelector<HTMLInputElement>('[data-modal-name]');
  setTimeout(() => nameInput?.focus(), 30);
}

/** 把字符串列表绑到一个「输入框 + 已选 tag」控件上,负责:
 *  - 在 tagListEl 里渲染当前 items(可删除)
 *  - 同步到 hidden input(JSON 字符串)
 *  - 处理 input 的回车 / 逗号 / 「+ 添加」按钮
 *  - 暴露 reset() 清空内部状态(closeModal 调用)
 *
 *  onChange 在 items 变更后调用,用于刷新 chip 状态等。 */
function bindListInput(
  modal: HTMLElement,
  opts: {
    listKey: 'categories' | 'inclusion' | 'exclusion' | 'rubric';
    presetAttr?: string; // 对 categories:preset chip 的 selector
  },
): { tags: string[]; refresh: () => void; reset: () => void; loadFrom: (items: string[]) => void; rubric: LibraryRubricItem[] } {
  const isRubric = opts.listKey === 'rubric';
  const input = modal.querySelector<HTMLInputElement>(
    isRubric ? '[data-rubric-input]' : `[data-${opts.listKey === 'categories' ? 'categories' : opts.listKey === 'inclusion' ? 'incl' : 'excl'}-input]`,
  )!;
  const addBtn = modal.querySelector<HTMLButtonElement>(
    isRubric ? '[data-rubric-add]' : `[data-${opts.listKey === 'categories' ? 'categories' : opts.listKey === 'inclusion' ? 'incl' : 'excl'}-add]`,
  );
  const tagListEl = modal.querySelector<HTMLElement>(
    isRubric ? '[data-rubric-rows]' : `[data-${opts.listKey === 'categories' ? 'categories' : opts.listKey === 'inclusion' ? 'incl' : 'excl'}-tags]`,
  )!;
  const hidden = modal.querySelector<HTMLInputElement>(
    isRubric ? '[data-modal-rubric]' : `[data-modal-${opts.listKey === 'categories' ? 'categories' : opts.listKey === 'inclusion' ? 'incl' : 'excl'}]`,
  )!;

  // rubric 用对象数组;其它用字符串数组。
  let strItems: string[] = [];
  let rubricItems: LibraryRubricItem[] = [];

  function commit(): void {
    hidden.value = isRubric ? JSON.stringify(rubricItems) : JSON.stringify(strItems);
    if (opts.presetAttr && !isRubric) {
      // 同步 preset chip 的 active 态(categories)
      const presets = modal.querySelectorAll<HTMLElement>(`[data-cat-preset]`);
      presets.forEach((chip) => {
        const v = chip.dataset.catPreset || '';
        chip.classList.toggle('active', strItems.includes(v));
      });
    }
  }

  function render(): void {
    const items = isRubric ? rubricItems.map((r) => r.name) : strItems;
    if (items.length === 0) {
      tagListEl.innerHTML = '<span class="lib-tag-empty">— 暂未添加 —</span>';
      commit();
      return;
    }
    tagListEl.innerHTML = items
      .map(
        (label, idx) =>
          `<span class="lib-tag">${escapeHtml(label)}<button type="button" class="lib-tag-x" data-rm="${idx}" aria-label="删除 ${escapeHtml(label)}">×</button></span>`,
      )
      .join('');
    commit();
  }

  function addOne(raw: string): boolean {
    const v = raw.trim().replace(/\s+/g, ' ');
    if (!v) return false;
    if (isRubric) {
      if (rubricItems.some((r) => r.name.toLowerCase() === v.toLowerCase())) return false;
      rubricItems.push({ name: v.slice(0, 32) });
    } else {
      if (strItems.some((s) => s.toLowerCase() === v.toLowerCase())) return false;
      strItems.push(v.slice(0, 32));
    }
    render();
    return true;
  }

  function addManyFromInput(): void {
    // 支持中英文逗号 + 空格切分,粘多词进来一次添加多个
    const raw = input.value;
    if (!raw.trim()) return;
    const parts = raw.split(/[,,]+/).map((s) => s.trim()).filter(Boolean);
    let added = 0;
    for (const p of parts) {
      if (addOne(p)) added++;
    }
    input.value = '';
  }

  // input 行为:回车 / 逗号提交,失焦不提交
  input.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter' || k === ',') {
      e.preventDefault();
      addManyFromInput();
    }
  });
  // 中文输入法 IME 阶段不应当吞回车,但这里 input.value 已经能拿到文字了,
  // 简单起见,IME 状态下走「compositionend 之后回车会立即被 keydown 接收」
  // —— 现代浏览器对 keydown Enter 在 IME 期间会带 keyCode 229 但 key 名仍是 Enter,
  // 我们用 inputType 粗略防御:compositionend 之后再清值。
  input.addEventListener('compositionend', () => {
    // 不主动 add(让用户回车显式确认),只是确保状态同步
    void input.value;
  });
  addBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    addManyFromInput();
    input.focus();
  });

  // 删除 tag
  tagListEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>('[data-rm]');
    if (!btn) return;
    e.preventDefault();
    const idx = Number(btn.dataset.rm || '-1');
    if (!Number.isFinite(idx) || idx < 0) return;
    if (isRubric) rubricItems.splice(idx, 1);
    else strItems.splice(idx, 1);
    render();
  });

  // categories preset chip 点击
  if (opts.presetAttr) {
    modal.querySelectorAll<HTMLElement>(`[data-cat-preset]`).forEach((chip) => {
      // 同一节点多次 bindListInput 时避免重复绑(closeModal 会再调一次)
      if ((chip as unknown as { __bound?: boolean }).__bound) return;
      (chip as unknown as { __bound?: boolean }).__bound = true;
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        const v = chip.dataset.catPreset || '';
        if (!v) return;
        if (strItems.includes(v)) {
          strItems = strItems.filter((s) => s !== v);
        } else {
          strItems.push(v);
        }
        render();
      });
    });
  }

  render();
  return {
    get tags() { return strItems.slice(); },
    get rubric() { return rubricItems.slice(); },
    refresh: render,
    reset: () => {
      strItems = [];
      rubricItems = [];
      input.value = '';
      render();
    },
    loadFrom: (items: string[]) => {
      strItems = isRubric ? [] : items.slice();
      rubricItems = isRubric ? items.slice().map((name) => ({ name: name.slice(0, 32) })) : [];
      input.value = '';
      render();
    },
  };
}

interface ModalControls {
  categories: ReturnType<typeof bindListInput>;
  inclusion: ReturnType<typeof bindListInput>;
  exclusion: ReturnType<typeof bindListInput>;
  rubric: ReturnType<typeof bindListInput>;
}

interface AnchorControl {
  get: () => LibraryAnchor[];
  reset: () => void;
  loadFrom: (anchors: LibraryAnchor[]) => void;
}

/** 锚点论文控件。Polaris LibraryDefinition.anchors 在 P8a JSONB 里,
 *  UI 上需要可增可删。每行 kind badge + value + 可选 note + 删除。 */
function bindAnchorControl(modal: HTMLElement): AnchorControl {
  const rowsEl = modal.querySelector<HTMLElement>('[data-anchor-rows]')!;
  const kindSel = modal.querySelector<HTMLSelectElement>('[data-anchor-kind]')!;
  const valueInput = modal.querySelector<HTMLInputElement>('[data-anchor-value]')!;
  const addBtn = modal.querySelector<HTMLButtonElement>('[data-anchor-add]')!;

  let items: LibraryAnchor[] = [];

  function render(): void {
    if (items.length === 0) {
      rowsEl.innerHTML = '<span class="lib-tag-empty">— 暂未添加锚点 —</span>';
      return;
    }
    rowsEl.innerHTML = items
      .map(
        (a, idx) => `
        <div class="lib-anchor-row" data-idx="${idx}">
          <span class="kind-badge kind-${a.kind}">${escapeHtml(a.kind)}</span>
          <span class="value">${escapeHtml(a.value)}</span>
          ${a.note ? `<span class="note">${escapeHtml(a.note)}</span>` : ''}
          <button type="button" class="lib-anchor-rm" aria-label="删除锚点">×</button>
        </div>
      `,
      )
      .join('');
    rowsEl.querySelectorAll<HTMLButtonElement>('.lib-anchor-rm').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest<HTMLElement>('.lib-anchor-row');
        const idx = Number(row?.dataset.idx);
        if (Number.isFinite(idx)) {
          items.splice(idx, 1);
          render();
        }
      });
    });
  }

  function add(): void {
    const kind = (kindSel.value === 'arxiv' || kindSel.value === 'doi' || kindSel.value === 'free')
      ? kindSel.value
      : 'free';
    const v = valueInput.value.trim();
    if (!v) return;
    if (items.some((a) => a.kind === kind && a.value.toLowerCase() === v.toLowerCase())) {
      showToast('已存在相同锚点', 'info');
      return;
    }
    if (items.length >= 32) {
      showToast('锚点最多 32 条', 'error');
      return;
    }
    // 询问 note(prompt) — Polaris 留 note 字段;可选。
    const note = window.prompt('这个锚点为什么相关?(可选,1-100 字)')?.trim() || undefined;
    items.push({ kind, value: v.slice(0, 200), ...(note ? { note: note.slice(0, 100) } : {}) });
    valueInput.value = '';
    render();
  }

  addBtn.addEventListener('click', add);
  valueInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });

  render();
  return {
    get: () => items.slice(),
    reset: () => {
      items = [];
      render();
      valueInput.value = '';
    },
    loadFrom: (anchors) => {
      items = anchors.slice();
      render();
    },
  };
}

/** 在弹窗上装好四个 list 控件并 reset 到空态。返回 handlers 让 caller 在 reset/close 时复用。 */
function setupModalControls(modal: HTMLElement): ModalControls {
  bindProfilePicker(modal);
  bindModalQuickActions(modal);
  return {
    categories: bindListInput(modal, { listKey: 'categories', presetAttr: 'data-cat-preset' }),
    inclusion: bindListInput(modal, { listKey: 'inclusion' }),
    exclusion: bindListInput(modal, { listKey: 'exclusion' }),
    rubric: bindListInput(modal, { listKey: 'rubric' }),
  };
}

/** 弹窗快捷动作(2026-09-14 小白视角 P0-2/P0-3):
 *  - 阈值快捷按钮「宽松 0.30 / 入门 0.55 / 专家 0.75 / 严格 0.80」
 *  - 画像选择「不确定?看决策树」→ 展开决策表
 *
 *  设计:与 bindProfilePicker 解耦,各自管各自的 DOM 子集。 */
function bindModalQuickActions(modal: HTMLElement): void {
  const thresholdInput = modal.querySelector<HTMLInputElement>('[data-modal-threshold]');
  modal.querySelectorAll<HTMLButtonElement>('[data-threshold-quick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = parseFloat(btn.dataset.thresholdQuick || '');
      if (!Number.isFinite(v) || !thresholdInput) return;
      thresholdInput.value = String(v);
      // 视觉反馈:被点击的按钮高亮一下
      modal.querySelectorAll<HTMLButtonElement>('[data-threshold-quick]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  const helpBtn = modal.querySelector<HTMLButtonElement>('[data-profile-help]');
  const decision = modal.querySelector<HTMLElement>('[data-profile-decision]');
  helpBtn?.addEventListener('click', () => {
    if (!decision) return;
    decision.hidden = !decision.hidden;
    if (helpBtn) helpBtn.textContent = decision.hidden ? '不确定?看决策树 →' : '收起决策树 ↑';
  });

  // 2026-09-14 一句话生成 panel(用户原话「建库操作要足够简单」)
  // 单次 LLM 调用产出 statement + 关键词 + 排除词 + 分类,比 3 步访谈摩擦更小
  const singleshotBtn = modal.querySelector<HTMLButtonElement>('[data-modal-singleshot]');
  const singleshotPanel = modal.querySelector<HTMLElement>('[data-singleshot-panel]');
  const singleshotInput = modal.querySelector<HTMLTextAreaElement>('[data-singleshot-input]');
  const singleshotRun = modal.querySelector<HTMLButtonElement>('[data-singleshot-run]');
  const singleshotCancel = modal.querySelector<HTMLButtonElement>('[data-singleshot-cancel]');
  const singleshotPreview = modal.querySelector<HTMLElement>('[data-singleshot-preview]');
  const interviewPanel = modal.querySelector<HTMLElement>('[data-interview-panel]');
  // 互斥:点 singleshot 时收起 3 步访谈
  singleshotBtn?.addEventListener('click', () => {
    if (!singleshotPanel) return;
    singleshotPanel.hidden = false;
    if (interviewPanel) interviewPanel.hidden = true;
    setTimeout(() => singleshotInput?.focus(), 30);
  });
  singleshotCancel?.addEventListener('click', () => {
    if (singleshotPanel) singleshotPanel.hidden = true;
    if (singleshotPreview) { singleshotPreview.hidden = true; singleshotPreview.innerHTML = ''; }
    if (singleshotInput) singleshotInput.value = '';
  });
  singleshotRun?.addEventListener('click', async () => {
    const freeText = singleshotInput?.value.trim() || '';
    const libName = modal.querySelector<HTMLInputElement>('[data-modal-name]')?.value.trim() || '';
    if (!freeText) {
      showToast('先写一句描述,再点生成', 'info');
      return;
    }
    if (singleshotRun) singleshotRun.disabled = true;
    if (singleshotPreview) {
      singleshotPreview.hidden = false;
      singleshotPreview.innerHTML = '<div class="lib-singleshot-loading"><span class="lib-spinner"></span> 1 次 LLM 调用生成中…</div>';
    }
    try {
      const { runInterviewSingleShot } = await import('./library-statement-interview');
      const result = await runInterviewSingleShot(freeText, libName);
      // 渲染预览 + 应用按钮
      const incTags = result.inclusionKeywords.map((k: string) => `<span class="lib-tag include">${escapeHtml(k)}</span>`).join('');
      const excTags = result.exclusionKeywords.map((k: string) => `<span class="lib-tag exclude">${escapeHtml(k)}</span>`).join('');
      const catTags = result.categories.map((c: string) => `<span class="lib-tag">${escapeHtml(c)}</span>`).join('');
      if (singleshotPreview) {
        singleshotPreview.innerHTML = `
          <div class="lib-singleshot-result">
            ${result.rationale ? `<p class="muted">💡 ${escapeHtml(result.rationale)}</p>` : ''}
            <h5>statement(80-150 字)</h5>
            <blockquote class="lib-interview-suggestion">${escapeHtml(result.statement || '(空)')}</blockquote>
            <h5>包括关键词</h5>
            <div class="lib-tag-list">${incTags || '<em class="muted">(无)</em>'}</div>
            <h5>排除关键词</h5>
            <div class="lib-tag-list">${excTags || '<em class="muted">(无)</em>'}</div>
            <h5>arXiv 分类</h5>
            <div class="lib-tag-list">${catTags || '<em class="muted">(无)</em>'}</div>
            <div class="lib-singleshot-apply">
              <button type="button" class="btn btn-primary btn-sm" data-singleshot-apply>应用到表单</button>
            </div>
          </div>
        `;
        const applyBtn = singleshotPreview.querySelector<HTMLButtonElement>('[data-singleshot-apply]');
        applyBtn?.addEventListener('click', () => {
          const stmtTA = modal.querySelector<HTMLTextAreaElement>('[data-modal-statement]');
          if (stmtTA && result.statement) stmtTA.value = result.statement;
          const controls = controlsByModal.get(modal);
          if (controls && result.inclusionKeywords.length > 0) {
            controls.inclusion.loadFrom(result.inclusionKeywords);
          }
          if (controls && result.exclusionKeywords.length > 0) {
            controls.exclusion.loadFrom(result.exclusionKeywords);
          }
          if (controls && result.categories.length > 0) {
            controls.categories.loadFrom(result.categories);
          }
          showToast('已应用 statement / 关键词 / 分类', 'ok');
          if (singleshotPanel) singleshotPanel.hidden = true;
          if (singleshotPreview) { singleshotPreview.hidden = true; singleshotPreview.innerHTML = ''; }
          if (singleshotInput) singleshotInput.value = '';
        });
      }
    } catch (err) {
      if (singleshotPreview) {
        singleshotPreview.innerHTML = `<p class="muted error">⚠️ 生成失败:${escapeHtml((err as Error).message)}<br>可改写描述重试,或关闭直接手填。</p>`;
      }
    } finally {
      if (singleshotRun) singleshotRun.disabled = false;
    }
  });

  // 2026-09-14 fallback:旧浏览器(Chrome <119 / FF <88 / Safari <16)不支持
  // :user-invalid,所以用 JS 在用户首次失焦时给 required input 加 .is-touched
  // class,触发 CSS 红框。新浏览器优先用 :user-invalid(无需 JS)。
  if (typeof modal.matches !== 'function' || !CSS.supports('selector(:user-invalid)')) {
    modal.querySelectorAll<HTMLInputElement>('.lib-input[required], .lib-textarea[required]').forEach((el) => {
      el.addEventListener('blur', () => el.classList.add('is-touched'), { once: true });
    });
  }
}

function closeModal(modal: HTMLElement): void {
  modal.style.display = 'none';
  // 清 edit 模式
  delete modal.dataset.editId;
  const titleEl = modal.querySelector<HTMLElement>('#new-library-modal-title');
  if (titleEl) titleEl.textContent = '新建文献库';
  const submitBtn = modal.querySelector<HTMLButtonElement>('[data-modal-submit]');
  if (submitBtn) submitBtn.textContent = '创建个人文献库';
  // 清空 + 重置状态
  const form = modal.querySelector<HTMLFormElement>('form');
  form?.reset();
  // 重置 hue 默认 emerald
  modal.querySelectorAll<HTMLElement>('.lib-hue-chip').forEach((el) => {
    el.classList.toggle('active', el.dataset.hue === 'emerald');
  });
  // 清错误态
  modal.querySelectorAll<HTMLElement>('.lib-field-error').forEach((el) => (el.textContent = ''));
  modal.querySelectorAll<HTMLElement>('.lib-input--error, .lib-textarea--error').forEach((el) =>
    el.classList.remove('lib-input--error', 'lib-textarea--error'),
  );
  // 复位 list 控件:每次 closeModal 复用同一组 controls(避免重复 bind),
  // 这里只清内部数组 + 重渲染。preset chip 的 active 态通过
  // controls.categories.refresh() 内部 commit() 同步清掉。
  const controls = controlsByModal.get(modal);
  if (controls) {
    controls.categories.reset();
    controls.inclusion.reset();
    controls.exclusion.reset();
    controls.rubric.reset();
  }
  // 锚点控件
  const anchorCtl = anchorControlByModal.get(modal);
  if (anchorCtl) anchorCtl.reset();
  // 清空 P8a 多行文本
  modal.querySelectorAll<HTMLTextAreaElement>('[data-modal-goals],[data-modal-in-scope],[data-modal-out-of-scope],[data-modal-questions]').forEach((el) => {
    el.value = '';
  });
  // 重置 select 默认值
  const visSel = modal.querySelector<HTMLSelectElement>('[data-modal-visibility]');
  if (visSel) visSel.value = 'personal';
  const cadSel = modal.querySelector<HTMLSelectElement>('[data-modal-cadence]');
  if (cadSel) cadSel.value = 'manual';
  const thresholdInput = modal.querySelector<HTMLInputElement>('[data-modal-threshold]');
  if (thresholdInput) thresholdInput.value = '0.8';
  // 重置读者画像:清 active + 清 hidden
  modal.querySelectorAll<HTMLElement>('[data-profile-card]').forEach((el) => el.classList.remove('active'));
  const profileHidden = modal.querySelector<HTMLInputElement>('[data-modal-profile]');
  if (profileHidden) profileHidden.value = '';
}

/** 同一 modal 节点在不同打开轮次复用同一组 controls;
 *  关闭时全部清空 + reset。 */
const controlsByModal = new WeakMap<HTMLElement, ModalControls>();
const anchorControlByModal = new WeakMap<HTMLElement, AnchorControl>();

function bindHuePicker(modal: HTMLElement): void {
  const chips = modal.querySelectorAll<HTMLElement>('.lib-hue-chip');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const hidden = modal.querySelector<HTMLInputElement>('[data-modal-hue]');
      if (hidden) hidden.value = chip.dataset.hue || 'emerald';
    });
  });
}

/** 读者画像卡片选择 —— 点击切换 active 态,自动同步默认值到 threshold input。
 *
 * 设计:点了某张卡 → 阈值 input 自动覆盖成 profile.defaultThreshold(可手改,
 * 手改后再点别的卡才会再次覆盖)。这样既给"懒人"一个开箱即用的体验,
 * 也给"高级用户"留 override 路径。 */
function bindProfilePicker(modal: HTMLElement): void {
  const cards = modal.querySelectorAll<HTMLElement>('[data-profile-card]');
  const hidden = modal.querySelector<HTMLInputElement>('[data-modal-profile]');
  const thresholdInput = modal.querySelector<HTMLInputElement>('[data-modal-threshold]');
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.profileCard as AudienceProfileId | undefined;
      if (!id || !hidden) return;
      cards.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      hidden.value = id;
      // 同步默认阈值(用户没手改过才覆盖;这里简化为"点了就覆盖",UX 直接)
      const profile = AUDIENCE_PROFILES[id];
      if (profile && thresholdInput) {
        thresholdInput.value = String(profile.defaultThreshold);
      }
    });
  });
}

/** 多行文本 → string[];空串丢,空白折叠,长度限制,maxItems 兜底。 */
function parseSentences(raw: string, maxItems: number, maxLen: number): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\n+/)) {
    const v = line.trim().replace(/\s+/g, ' ');
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v.slice(0, maxLen));
    if (out.length >= maxItems) break;
  }
  return out;
}

/** 把 library 现有 definition 回填到 modal(编辑模式) */
function fillModalFromLibrary(modal: HTMLElement, lib: UserLibrary): void {
  // 基础
  const nameInput = modal.querySelector<HTMLInputElement>('[data-modal-name]');
  if (nameInput) nameInput.value = lib.name;
  const stmt = modal.querySelector<HTMLTextAreaElement>('[data-modal-statement]');
  if (stmt) stmt.value = lib.statement;
  const hueInput = modal.querySelector<HTMLInputElement>('[data-modal-hue]');
  if (hueInput) hueInput.value = lib.hue;
  modal.querySelectorAll<HTMLElement>('.lib-hue-chip').forEach((el) => {
    el.classList.toggle('active', el.dataset.hue === lib.hue);
  });

  // visibility + cadence
  const visSel = modal.querySelector<HTMLSelectElement>('[data-modal-visibility]');
  if (visSel) visSel.value = lib.visibility || 'personal';
  const cadSel = modal.querySelector<HTMLSelectElement>('[data-modal-cadence]');
  const def = lib.definition || defaultLibraryDefinition(lib.statement);
  if (cadSel) cadSel.value = def.cadence;
  // 编辑模式回填:已有值优先,没有就 0.8
  const thresholdInput = modal.querySelector<HTMLInputElement>('[data-modal-threshold]');
  if (thresholdInput) thresholdInput.value = String(def.relevanceThreshold ?? 0.8);

  // 读者画像:已有 → 高亮对应卡片;无 → 全空(走 legacy)
  const profileId = def.audienceProfile;
  const profileHidden = modal.querySelector<HTMLInputElement>('[data-modal-profile]');
  if (profileHidden) profileHidden.value = profileId || '';
  modal.querySelectorAll<HTMLElement>('[data-profile-card]').forEach((el) => {
    el.classList.toggle('active', el.dataset.profileCard === profileId);
  });

  // P8a 字段
  const goalsTA = modal.querySelector<HTMLTextAreaElement>('[data-modal-goals]');
  if (goalsTA) goalsTA.value = def.goals.join('\n');
  const inScopeTA = modal.querySelector<HTMLTextAreaElement>('[data-modal-in-scope]');
  if (inScopeTA) inScopeTA.value = def.inScope.join('\n');
  const outScopeTA = modal.querySelector<HTMLTextAreaElement>('[data-modal-out-of-scope]');
  if (outScopeTA) outScopeTA.value = def.outOfScope.join('\n');
  const questionsTA = modal.querySelector<HTMLTextAreaElement>('[data-modal-questions]');
  if (questionsTA) questionsTA.value = def.questions.join('\n');
}

/** 编辑模式:把 library.definition.anchors + 已加入 paperIds 之外的 arxiv-id
 *  显示在锚点控件里。Polaris 实际只把「外部种子论文」放 anchors,library 内
 *  已有论文由 paperIds 自动 included。 */
function openEditLibraryModal(modal: HTMLElement, libId: string): boolean {
  const lib = getUserLibrary(libId);
  if (!lib) {
    showToast(`找不到文献库 ${libId.slice(0, 8)}`, 'error');
    return false;
  }
  // 标题切到「编辑」
  const titleEl = modal.querySelector<HTMLElement>('#new-library-modal-title');
  if (titleEl) titleEl.textContent = `编辑「${lib.name}」`;
  const submitBtn = modal.querySelector<HTMLButtonElement>('[data-modal-submit]');
  if (submitBtn) submitBtn.textContent = '保存修改';

  // 标 edit 模式
  modal.dataset.editId = libId;

  fillModalFromLibrary(modal, lib);

  // 控制依赖(创建阶段 setupModalControls 已经 bind;close 时 reset)
  const controls = controlsByModal.get(modal);
  if (controls) {
    controls.categories.loadFrom?.(lib.categories);
    controls.inclusion.loadFrom?.(lib.inclusionKeywords);
    controls.exclusion.loadFrom?.(lib.exclusionKeywords);
    controls.rubric.loadFrom?.(lib.rubric.map((r) => r.name));
  }
  // anchors 控件(创建阶段已 bind;现在 load)
  const anchorCtl = anchorControlByModal.get(modal);
  if (anchorCtl) {
    anchorCtl.loadFrom(lib.definition?.anchors || []);
  } else {
    // 没 bind(SSR 后没初始化过):补一次 bind 然后 load
    const ctl = bindAnchorControl(modal);
    ctl.loadFrom(lib.definition?.anchors || []);
    anchorControlByModal.set(modal, ctl);
  }
  modal.style.display = 'flex';
  const nameInput = modal.querySelector<HTMLInputElement>('[data-modal-name]');
  setTimeout(() => nameInput?.focus(), 30);
  return true;
}

function setupNewLibraryModal(): void {
  const modal = document.querySelector<HTMLElement>('[data-new-library-modal]');
  if (!modal) return;

  // 关闭
  modal.querySelectorAll<HTMLElement>('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(modal));
  });

  // 初始化 list 控件
  controlsByModal.set(modal, setupModalControls(modal));
  // 初始化 anchors 控件(只 bind 一次)
  if (!anchorControlByModal.has(modal)) {
    anchorControlByModal.set(modal, bindAnchorControl(modal));
  }

  // 打开:全局所有 [data-open-new-library] 触发
  document.querySelectorAll<HTMLElement>('[data-open-new-library]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 切到「新建」态
      delete modal.dataset.editId;
      const titleEl = modal.querySelector<HTMLElement>('#new-library-modal-title');
      if (titleEl) titleEl.textContent = '新建文献库';
      const submitBtn = modal.querySelector<HTMLButtonElement>('[data-modal-submit]');
      if (submitBtn) submitBtn.textContent = '创建个人文献库';
      openModal(modal);
    });
  });

  // 编辑:任意位置 [data-edit-library="<id>"]
  document.querySelectorAll<HTMLElement>('[data-edit-library]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.editLibrary || '';
      if (!id) return;
      openEditLibraryModal(modal, id);
    });
  });

  // D.1.2: 7 个库 seed template —— 在 NewLibraryModal 顶部的一排 chip 按钮。
  // 点一下用模板预填 name / statement / keywords(关键词进 hidden inclusionKeywords)。
  const LIBRARY_TEMPLATES: Record<string, { name: string; statement: string; keywords?: string[] }> = {
    'rl':           { name: '强化学习',     statement: 'RL 理论、策略优化、探索与利用。',     keywords: ['reinforcement learning', 'PPO', 'DQN'] },
    'llm-agent':    { name: 'LLM Agent',    statement: '工具调用、规划、代码代理。',         keywords: ['LLM', 'agent', 'tool use'] },
    'game-ai':      { name: '博弈 AI',      statement: '博弈代理、在线决策。',              keywords: ['game', 'MCTS'] },
    'multi-agent':  { name: '多智能体',     statement: '合作 / 竞争多智能体系统。',          keywords: ['multi-agent', 'MARL'] },
    'reasoning':    { name: '推理与对齐',   statement: '思维链、RLHF、机制可解释。',         keywords: ['CoT', 'RLHF'] },
    'robotics':     { name: '机器人',       statement: '虚实迁移、运动控制。',              keywords: ['robotics', 'sim-to-real'] },
    'alignment':    { name: '对齐可解释',   statement: '引导向量、潜空间干预。',            keywords: ['steering', 'interpretability'] },
  };
  document.querySelectorAll<HTMLElement>('[data-template]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tpl = LIBRARY_TEMPLATES[btn.dataset.template || ''];
      if (!tpl) return;
      const nameEl = modal.querySelector<HTMLInputElement>('[data-modal-name]');
      const stmtEl = modal.querySelector<HTMLTextAreaElement>('[data-modal-statement]');
      if (nameEl) nameEl.value = tpl.name;
      if (stmtEl) stmtEl.value = tpl.statement;
      // inclusionKeywords 在高级折叠里;如果有 input 把它填上
      const kwEl = modal.querySelector<HTMLInputElement>('[data-modal-keywords]');
      if (kwEl && tpl.keywords) kwEl.value = tpl.keywords.join(', ');
    });
  });

  // D.1.3: library merge 检测 —— 用户在 name / statement 里输入时,实时计算
  // 与现有库的 Jaccard 相似度,>= 0.5 时显示「⚠️ 这与已有库 X 重复」提示。
  // 用字符 unigram + 分词 unigram 合并做相似度,容忍中英混排。
  const mergeWarn = document.createElement('div');
  mergeWarn.className = 'lib-merge-warning';
  mergeWarn.hidden = true;
  const nameField = modal.querySelector<HTMLElement>('[data-modal-name]')?.closest('.lib-field');
  if (nameField) nameField.appendChild(mergeWarn);

  function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const uni = a.size + b.size - inter;
    return uni === 0 ? 0 : inter / uni;
  }

  function tokens(text: string): Set<string> {
    const out = new Set<string>();
    // word-level tokens (中英都吃)
    for (const w of text.toLowerCase().split(/[\s,;.()\[\]{}'"\/]+/)) {
      if (w.length >= 2) out.add(w);
    }
    // 字符 bigram (中文友好)
    const cleaned = text.toLowerCase().replace(/\s+/g, '');
    for (let i = 0; i < cleaned.length - 1; i++) {
      out.add(cleaned.slice(i, i + 2));
    }
    return out;
  }

  function checkMerge(): { name: string; score: number }[] {
    const nameInput = modal.querySelector<HTMLInputElement>('[data-modal-name]');
    const stmtInput = modal.querySelector<HTMLTextAreaElement>('[data-modal-statement]');
    const candidate = `${nameInput?.value || ''} ${stmtInput?.value || ''}`.trim();
    if (candidate.length < 3) return [];
    const t = tokens(candidate);
    const out: { name: string; score: number }[] = [];
    const editingId = modal.dataset.editId;
    for (const lib of Object.values(listUserLibraries())) {
      if (lib.id === editingId) continue; // 编辑自己不算重复
      const lt = tokens(`${lib.name} ${lib.statement || ''}`);
      const score = jaccard(t, lt);
      if (score >= 0.5) out.push({ name: lib.name, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  function renderMergeWarning(): void {
    const matches = checkMerge();
    if (matches.length === 0) {
      mergeWarn.hidden = true;
      mergeWarn.textContent = '';
      return;
    }
    mergeWarn.hidden = false;
    mergeWarn.innerHTML = `⚠️ 与已有库可能重复:<br>${matches
      .map((m) => `<span class="lib-merge-row">${escapeHtml(m.name)} <em>(${(m.score * 100).toFixed(0)}%)</em></span>`)
      .join('<br>')}`;
  }

  modal.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-modal-name], [data-modal-statement]')
    .forEach((el) => el.addEventListener('input', renderMergeWarning));

  // D.1.1: 「从论文创建库」一键按钮 — 论文页 [data-create-library-from-paper]
  // 打开 modal,把论文 title/tldr 预填进 name/statement,并把论文设为第一个 anchor paper。
  document.querySelectorAll<HTMLElement>('[data-create-library-from-paper]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const arxivId = btn.dataset.createLibraryFromPaper || '';
      // 切到「新建」态
      delete modal.dataset.editId;
      const titleEl = modal.querySelector<HTMLElement>('#new-library-modal-title');
      if (titleEl) titleEl.textContent = '新建文献库';
      const submitBtn = modal.querySelector<HTMLButtonElement>('[data-modal-submit]');
      if (submitBtn) submitBtn.textContent = '创建个人文献库';
      openModal(modal);
      // 预填 name / statement / anchor paper —— 用论文 frontmatter 的 title_zh
      // / title / tldr。失败兜底:留空。
      const paperEl = arxivId
        ? document.querySelector<HTMLElement>(`[data-paper-summary="${arxivId}"]`)
        : null;
      const title = paperEl?.dataset.paperTitle || '';
      const tldr = paperEl?.dataset.paperTldr || '';
      const nameEl = modal.querySelector<HTMLInputElement>('[data-modal-name]');
      const stmtEl = modal.querySelector<HTMLTextAreaElement>('[data-modal-statement]');
      const anchorEl = modal.querySelector<HTMLInputElement>('[data-modal-anchor]');
      if (nameEl) nameEl.value = (title || arxivId).slice(0, 32);
      if (stmtEl) stmtEl.value = tldr.slice(0, 200);
      if (anchorEl) anchorEl.value = arxivId;
    });
  });

  // 同步默认 hue 到 hidden input
  const initialActive = modal.querySelector<HTMLElement>('.lib-hue-chip.active');
  const initialHue = (initialActive?.dataset.hue as LibraryHue) || 'emerald';
  const hueInput = modal.querySelector<HTMLInputElement>('[data-modal-hue]');
  if (hueInput) hueInput.value = initialHue;

  // hue picker
  bindHuePicker(modal);

  // AI 访谈 — 点击「🎤 AI 帮我写」展开三步访谈,自动填回 statement / keywords / categories
  const interviewPanel = modal.querySelector<HTMLElement>('[data-interview-panel]');
  if (interviewPanel) {
    modal.querySelector<HTMLElement>('[data-modal-interview]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      interviewPanel.hidden = false;
      interviewPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      await runInterviewFlow(modal, interviewPanel);
    });
  }

  // 提交(同时覆盖新建 + 编辑两种模式)
  const form = modal.querySelector<HTMLFormElement>('form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = form.querySelector<HTMLInputElement>('[data-modal-name]')!;
    const stmtInput = form.querySelector<HTMLTextAreaElement>('[data-modal-statement]')!;
    const hue = (form.querySelector<HTMLInputElement>('[data-modal-hue]')?.value as LibraryHue) || 'emerald';
    const name = nameInput.value.trim();
    const statement = stmtInput.value.trim();
    const nameErr = form.querySelector<HTMLElement>('[data-modal-name-err]')!;
    const stmtErr = form.querySelector<HTMLElement>('[data-modal-stmt-err]')!;
    let bad = false;
    if (!name) {
      nameErr.textContent = '请填写文献库名称';
      nameInput.classList.add('lib-input--error');
      bad = true;
    } else if (name.length > 32) {
      nameErr.textContent = '名称不能超过 32 字';
      nameInput.classList.add('lib-input--error');
      bad = true;
    } else {
      nameErr.textContent = '';
      nameInput.classList.remove('lib-input--error');
    }
    if (!statement) {
      // 可选 —— AI 访谈完成后会在 summary 页点「应用到表单」时回填。
      // 用户也可以空着提交,系统会用空字符串 / library 名 fallback。
      stmtErr.textContent = '';
      stmtInput.classList.remove('lib-textarea--error');
    } else if (statement.length > 200) {
      stmtErr.textContent = '方向描述不能超过 200 字';
      stmtInput.classList.add('lib-textarea--error');
      bad = true;
    } else {
      stmtErr.textContent = '';
      stmtInput.classList.remove('lib-textarea--error');
    }
    if (bad) return;

    const controls = controlsByModal.get(modal);
    const categories = controls?.categories.tags ?? [];
    const inclusionKeywords = controls?.inclusion.tags ?? [];
    const exclusionKeywords = controls?.exclusion.tags ?? [];
    const rubric = controls?.rubric.rubric ?? [];

    // 新字段
    const visibility = (form.querySelector<HTMLSelectElement>('[data-modal-visibility]')?.value as 'personal' | 'pending' | 'public') || 'personal';
    const cadence = (form.querySelector<HTMLSelectElement>('[data-modal-cadence]')?.value as 'manual' | 'daily' | 'weekly' | 'monthly') || 'manual';
    // 把 [0,1] 之外的脏输入钳到合法区间,非数字 fallback 0.8(兜底)
    const thresholdRaw = Number(form.querySelector<HTMLInputElement>('[data-modal-threshold]')?.value);
    const relevanceThreshold = !Number.isFinite(thresholdRaw)
      ? 0.8
      : Math.max(0, Math.min(1, thresholdRaw));
    // 读者画像:空串 = 未设(走 legacy)。校验一下 id 合法,避免脏 input 污染 store。
    const profileRaw = form.querySelector<HTMLInputElement>('[data-modal-profile]')?.value || '';
    const audienceProfile: AudienceProfileId | undefined =
      profileRaw && profileRaw in AUDIENCE_PROFILES
        ? (profileRaw as AudienceProfileId)
        : undefined;
    const goals = parseSentences(form.querySelector<HTMLTextAreaElement>('[data-modal-goals]')?.value || '', 3, 200);
    const inScope = parseSentences(form.querySelector<HTMLTextAreaElement>('[data-modal-in-scope]')?.value || '', 8, 80);
    const outOfScope = parseSentences(form.querySelector<HTMLTextAreaElement>('[data-modal-out-of-scope]')?.value || '', 8, 80);
    const questions = parseSentences(form.querySelector<HTMLTextAreaElement>('[data-modal-questions]')?.value || '', 8, 200);
    const anchors = anchorControlByModal.get(modal)?.get() ?? [];

    const submitBtn = form.querySelector<HTMLButtonElement>('[data-modal-submit]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const editId = modal.dataset.editId;
      if (editId) {
        // 编辑模式
        const r1 = renameLibrary(editId, { name, statement, hue, categories, inclusionKeywords, exclusionKeywords, rubric });
        if (!r1.ok) {
          showToast(getApiResultMessage(r1) || '保存失败', 'error');
          return;
        }
        const r2 = updateLibraryDefinition(editId, {
          statement,
          cadence,
          anchors,
          keywords: {
            arxivCategories: categories,
            include: inclusionKeywords,
            exclude: exclusionKeywords,
          },
          rubric,
          goals,
          inScope,
          outOfScope,
          questions,
          relevanceThreshold,
          audienceProfile,
        });
        if (!r2.ok) {
          showToast(getApiResultMessage(r2) || '保存失败', 'error');
          return;
        }
        const r3 = setLibraryVisibility(editId, visibility);
        if (!r3.ok) {
          showToast(getApiResultMessage(r3) || '可见性保存失败', 'error');
          return;
        }
        showToast(`已保存「${name}」`, 'ok');
        closeModal(modal);
        // 触发详情视图重渲染(在 /libraries/?id=<editId> 上)
        document.dispatchEvent(new CustomEvent('dpr:user-library-edit', { detail: { id: editId } }));
        return;
      }

      // 新建模式
      const res = createLibrary({
        name,
        statement,
        hue,
        categories,
        inclusionKeywords,
        exclusionKeywords,
        rubric,
        visibility,
        definition: {
          statement,
          cadence,
          anchors,
          keywords: {
            arxivCategories: categories,
            include: inclusionKeywords,
            exclude: exclusionKeywords,
          },
          rubric,
          goals,
          inScope,
          outOfScope,
          questions,
          relevanceThreshold,
          audienceProfile,
        },
      });
      if (!res.ok || !res.id) {
        showToast(getApiResultMessage(res) || '创建失败', 'error');
        return;
      }
      showToast(`已创建「${name}」`, 'ok');
      closeModal(modal);
      window.location.href = url(`/libraries/?id=${encodeURIComponent(res.id)}`);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

// ----------------------------------------------------------------
// 「+ 加进文献库」按钮 + 弹层(对照 Polaris LibraryPicker)
// ----------------------------------------------------------------

interface PopoverRefs {
  btn: HTMLElement;
  popover: HTMLElement;
  paperId: string;
}

function renderAddToLibraryPopover(refs: PopoverRefs): void {
  const libs = listUserLibraries();
  const inLibs = new Set(listLibrariesContainingPaper(refs.paperId));
  const list = refs.popover.querySelector<HTMLElement>('[data-atl-list]')!;
  const confirmBtn = refs.popover.querySelector<HTMLButtonElement>('[data-atl-confirm]')!;
  const cancelBtn = refs.popover.querySelector<HTMLButtonElement>('[data-atl-cancel]')!;

  // 初始:每个库根据 inLibs 决定是否勾选;用户改动存到暂存 set
  const picked = new Set<string>(inLibs);
  function rerenderList(): void {
    if (libs.length === 0) {
      list.innerHTML = `
        <div class="atl-empty">
          还没有任何文献库,先创建一个吧 ⤵
        </div>
      `;
      confirmBtn.textContent = '关闭';
      confirmBtn.disabled = false;
      return;
    }
    list.innerHTML = libs
      .map((lib) => {
        const on = picked.has(lib.id);
        return `
          <button type="button" class="atl-item ${on ? 'on' : ''}" data-atl-id="${escapeHtml(lib.id)}">
            <span class="atl-check">${on ? '✓' : ''}</span>
            <span style="flex:1; min-width:0;">
              <div class="atl-name">${escapeHtml(lib.name)}</div>
              <div class="atl-statement">${escapeHtml(lib.statement)}</div>
              <div class="atl-meta">${lib.paperIds.length} 篇论文</div>
            </span>
          </button>
        `;
      })
      .join('');
    // 「+ 新建」入口
    const div = document.createElement('div');
    div.className = 'atl-divider';
    list.appendChild(div);
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'atl-new';
    newBtn.dataset.atlAction = 'new';
    newBtn.textContent = '➕ 新建文献库并加入';
    list.appendChild(newBtn);
    confirmBtn.textContent = '保存';
    confirmBtn.disabled = false;
  }
  rerenderList();

  // 列表点击:切换勾选
  list.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const newBtn = target.closest<HTMLElement>('[data-atl-action="new"]');
    if (newBtn) {
      e.preventDefault();
      e.stopPropagation();
      // 关掉 popover,打开新建 modal;再让用户回来勾选 — 简化:
      // 直接 inline 一个 mini form(避免再开 modal)
      const newForm = document.createElement('div');
      newForm.className = 'atl-empty';
      newForm.style.textAlign = 'left';
      newForm.innerHTML = `
        <div class="lib-field" style="margin-bottom: 0.5rem;">
          <input type="text" class="lib-input" placeholder="文献库名称" maxlength="32" data-atl-new-name />
        </div>
        <div class="lib-field" style="margin-bottom: 0.5rem;">
          <textarea class="lib-textarea" placeholder="一句话方向描述" maxlength="200" rows="2" data-atl-new-stmt></textarea>
        </div>
        <div class="lib-field-hint" style="margin-bottom: 0.5rem;">
          分类 / 关键词 / 打分维度可后续在文献库详情页补全。
        </div>
        <div style="display: flex; gap: 0.4rem; justify-content: flex-end;">
          <button type="button" class="btn btn-soft btn-sm" data-atl-new-cancel>取消</button>
          <button type="button" class="btn btn-primary btn-sm" data-atl-new-confirm>创建并加入</button>
        </div>
      `;
      list.innerHTML = '';
      list.appendChild(newForm);
      (newForm.querySelector<HTMLInputElement>('[data-atl-new-name]'))?.focus();

      newForm.querySelector('[data-atl-new-cancel]')?.addEventListener('click', () => {
        rerenderList();
      });
      newForm.querySelector('[data-atl-new-confirm]')?.addEventListener('click', () => {
        const n = (newForm.querySelector<HTMLInputElement>('[data-atl-new-name]')?.value || '').trim();
        const s = (newForm.querySelector<HTMLTextAreaElement>('[data-atl-new-stmt]')?.value || '').trim();
        if (!n || !s) {
          showToast('名称和方向描述都要填', 'error');
          return;
        }
        const res = createLibrary({ name: n, statement: s, hue: 'emerald' });
        if (!res.ok || !res.id) {
          showToast(getApiResultMessage(res) || '创建失败', 'error');
          return;
        }
        // 立即加入本论文
        addPaperToLibrary(res.id, refs.paperId);
        showToast(`已创建「${n}」并加入本论文`, 'ok');
        rerenderList();
        // 触发外层 update 按钮态
        updateAddToLibraryButtons();
      });
      return;
    }
    const item = target.closest<HTMLElement>('[data-atl-id]');
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    const id = item.dataset.atlId || '';
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
    rerenderList();
  });

  // 保存:把 picked 与 inLibs 算 diff,加 / 减
  confirmBtn.onclick = () => {
    if (libs.length === 0) {
      closePopover(refs);
      return;
    }
    let added = 0;
    let removed = 0;
    for (const id of picked) {
      if (!inLibs.has(id)) {
        const r = addPaperToLibrary(id, refs.paperId);
        if (r.ok && r.changed) added++;
      }
    }
    for (const id of inLibs) {
      if (!picked.has(id)) {
        const r = removePaperFromLibrary(id, refs.paperId);
        if (r.ok && r.changed) removed++;
      }
    }
    if (added > 0 || removed > 0) {
      const parts: string[] = [];
      if (added > 0) parts.push(`加入 ${added} 个`);
      if (removed > 0) parts.push(`移出 ${removed} 个`);
      showToast(parts.join(' / '), 'ok');
    }
    closePopover(refs);
    updateAddToLibraryButtons();
  };
  cancelBtn.onclick = () => closePopover(refs);
}

function openPopover(refs: PopoverRefs): void {
  refs.popover.style.display = 'flex';
  renderAddToLibraryPopover(refs);
}

function closePopover(refs: PopoverRefs): void {
  refs.popover.style.display = 'none';
}

function setupAddToLibraryButtons(): void {
  document.querySelectorAll<HTMLElement>('[data-add-to-library]').forEach((btn) => {
    const paperId = btn.dataset.addToLibrary || '';
    if (!paperId) return;
    let popover = btn.parentElement?.querySelector<HTMLElement>('[data-add-to-library-popover]') || null;
    if (!popover) {
      // 自动建一个
      popover = document.createElement('div');
      popover.className = 'add-to-library-popover';
      popover.dataset.addToLibraryPopover = 'true';
      popover.style.display = 'none';
      popover.innerHTML = `
        <div data-atl-list></div>
        <div data-atl-actions class="atl-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-atl-cancel>取消</button>
          <button type="button" class="btn btn-primary btn-sm" data-atl-confirm>保存</button>
        </div>
      `;
      btn.insertAdjacentElement('afterend', popover);
    }
    const refs: PopoverRefs = { btn, popover, paperId };
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (popover!.style.display === 'flex') {
        closePopover(refs);
      } else {
        // 关闭其它已开的
        document.querySelectorAll<HTMLElement>('[data-add-to-library-popover]').forEach((p) => {
          if (p !== popover) p.style.display = 'none';
        });
        openPopover(refs);
      }
    });
  });
  // 点击外部关掉
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-add-to-library]') || target.closest('[data-add-to-library-popover]')) return;
    document.querySelectorAll<HTMLElement>('[data-add-to-library-popover]').forEach((p) => (p.style.display = 'none'));
  });
  updateAddToLibraryButtons();
}

function updateAddToLibraryButtons(): void {
  document.querySelectorAll<HTMLElement>('[data-add-to-library]').forEach((btn) => {
    const paperId = btn.dataset.addToLibrary || '';
    const cid = canonicalArxivId(paperId);
    if (!cid) return;
    const inLibs = listLibrariesContainingPaper(cid);
    const countEl = btn.querySelector<HTMLElement>('[data-in-libs-count]');
    const labelEl = btn.querySelector<HTMLElement>('[data-add-to-library-label]');
    if (inLibs.length > 0) {
      btn.classList.add('add-to-library-btn--in');
      if (labelEl) labelEl.textContent = '✓ 在文献库里';
      if (countEl) {
        countEl.textContent = `(${inLibs.length})`;
        countEl.style.display = '';
      }
    } else {
      btn.classList.remove('add-to-library-btn--in');
      if (labelEl) labelEl.textContent = '+ 加进文献库';
      if (countEl) countEl.style.display = 'none';
    }
  });
}

// ----------------------------------------------------------------
// 详情页(/libraries/?id=<userLibId>)的客户端 mount
//
// /libraries/ SSR 渲染「?id=」时输出一个空 mount 节点(因为静态站
// 不能预渲染运行时 user library id)。这里客户端水合:
//   1. 从 localStorage 找 lib
//   2. 从 SSR data-papers-json 拿全集,按 lib.paperIds 过滤
//   3. 渲染 3 tab(论文 / 概念 / 笔记)与公共库详情同构
//   4. 顶部加「✏️ 重命名 / 🗑 删除 / 🎨 改 hue」按钮组
// ----------------------------------------------------------------

interface PaperLite {
  id: string;
  canonicalArxivId: string;
  title: string;
  title_zh?: string;
  title_plain?: string;
  arxivId: string;
  date: string;
  pdf?: string;
  venue?: string;
  authors?: string;
  tldr?: string;
  evidence?: string;
  score?: number;
  concepts?: Array<{ slug: string; display_name: string; category: string }>;
}

function renderUserLibraryDetail(): void {
  const root = document.querySelector<HTMLElement>('[data-user-library-detail-id]');
  if (!root) return;
  const libId = root.dataset.userLibraryDetailId || '';
  // 记录「最近打开」时间戳,首页 recent libraries 用
  try {
    const KEY = 'dpr_last_opened_libs_v1';
    const raw = localStorage.getItem(KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    map[libId] = Date.now();
    // 只保留最近 20 条,避免无限增长
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const pruned: Record<string, number> = {};
    for (const [k, v] of entries) pruned[k] = v;
    localStorage.setItem(KEY, JSON.stringify(pruned));
  } catch { /* ignore */ }
  const lib = listUserLibraries().find((l) => l.id === libId);
  if (!lib) {
    // 不存在:重定向回列表
    window.location.href = url('/libraries/');
    return;
  }

  const mount = root.querySelector<HTMLElement>('[data-user-library-detail-mount]')!;
  const papersJson = root.dataset.papersJson || '[]';
  let allPapers: PaperLite[] = [];
  try {
    allPapers = JSON.parse(papersJson);
  } catch {
    allPapers = [];
  }
  // 默认按相关度(score 降序,同分按 date 降序)排序 —— 跟公共库工作台的口径一致,
  // 进库第一眼看到最相关的研究,而不是按入库时间。"未打分"的论文(score 缺)
  // 会落到列表底部:不把"近期但未评估"的论文顶到 top 位置。
  const papers = allPapers
    .filter((p) => lib.paperIds.includes(p.canonicalArxivId))
    .sort((a, b) => {
      // 排序:score × (1 + 0.3 × noveltyScore), noveltyScore fallback = score/10
      const getWeighted = (p: PaperLite) => {
        const s = typeof p.score === 'number' ? p.score : 0;
        const n = (lib.papers[p.canonicalArxivId]?.noveltyScore ?? s / 10);
        return s * (1 + 0.3 * n);
      };
      const wa = getWeighted(a);
      const wb = getWeighted(b);
      if (wb !== wa) return wb - wa;
      return (b.date || '').localeCompare(a.date || '');
    });

  // 概念聚合
  const conceptMap = new Map<string, { slug: string; display_name: string; category: string; n: number }>();
  for (const p of papers) {
    for (const c of p.concepts || []) {
      if (!c?.slug) continue;
      const cur = conceptMap.get(c.slug);
      if (cur) cur.n++;
      else conceptMap.set(c.slug, { slug: c.slug, display_name: c.display_name, category: c.category, n: 1 });
    }
  }
  const topConcepts = Array.from(conceptMap.values()).sort((a, b) => b.n - a.n);
  const created = fmtDateShort(lib.createdAt);

  // 页面标题
  document.title = `${lib.name} · 我的文献库 · Daily Paper Reader`;

  mount.className = `library-workbench hue-${escapeHtml(lib.hue)}`;
  mount.innerHTML = `
    <header class="library-wb-hero">
      <div>
        <h1>
          <span class="lib-type-badge lib-type-badge--personal" style="margin-right: 0.5rem; vertical-align: middle;">个人</span>
          ${escapeHtml(lib.name)}
        </h1>
        <p class="lib-wb-zh">${escapeHtml(lib.statement)}</p>
        <div class="library-wb-meta">
          <span><span class="meta-num" data-user-lib-paper-count>${papers.length}</span> 篇论文</span>
          <span><span class="meta-num">${topConcepts.length}</span> 个高频概念</span>
          <span class="lib-user-owner">
            <span class="lib-type-badge lib-mine-badge">⭐ 我的</span>
            创建于 ${created}
          </span>
        </div>
        <div class="lib-detail-actions">
          <button type="button" class="btn btn-soft btn-sm" data-action="edit" data-lib-id="${escapeHtml(lib.id)}">📝 编辑文献库(全部)</button>
          <button type="button" class="btn btn-soft btn-sm btn-danger" data-action="delete" data-lib-id="${escapeHtml(lib.id)}">🗑 删除文献库</button>
        </div>
      </div>
      <!-- 删除确认弹窗 -->
      <div class="lib-delete-modal" id="lib-delete-modal" data-delete-modal data-lib-name="${escapeHtml(lib.name)}">
        <div class="lib-delete-modal-backdrop" data-delete-modal-backdrop></div>
        <div class="lib-delete-modal-content">
          <h3>删除文献库</h3>
          <p>确定要删除文献库「<strong>${escapeHtml(lib.name)}</strong>」吗?</p>
          <p class="lib-delete-modal-hint">库内的论文不会从 docs 里删除,只是从你的收藏夹里移除。此操作不可撤销。</p>
          <div class="lib-delete-modal-field">
            <label for="lib-delete-confirm">请输入库名最后 4 个字符确认:</label>
            <input type="text" id="lib-delete-confirm" class="lib-input" maxlength="4" placeholder="xxxx" autocomplete="off" />
            <span class="lib-delete-modal-error" data-delete-error></span>
          </div>
          <div class="lib-delete-modal-actions">
            <button type="button" class="btn btn-ghost" data-delete-cancel>取消</button>
            <button type="button" class="btn btn-danger" data-delete-confirm disabled>确认删除</button>
          </div>
        </div>
      </div>
      <div class="library-wb-export">
        <a class="export-btn" href="#" data-library-export-target="bibtex" data-cx-prefix="${escapeHtml(lib.id)}-library" data-paper-ids='${escapeHtml(JSON.stringify(lib.paperIds))}'>📄 导出 references.bib</a>
        <a class="export-btn" href="#" data-library-export-target="csl" data-cx-prefix="${escapeHtml(lib.id)}-library" data-paper-ids='${escapeHtml(JSON.stringify(lib.paperIds))}'>📋 导出 library.csl.json</a>
        <a class="export-btn primary" href="#" data-library-export-target="obsidian" data-cx-prefix="${escapeHtml(lib.id)}-library" data-paper-ids='${escapeHtml(JSON.stringify(lib.paperIds))}'>📦 导出 my-library.zip</a>
        <span id="lib-export-hint" class="export-hint"></span>
      </div>
    </header>

    <nav class="library-wb-tabs" aria-label="tab 切换">
      <a class="lib-wb-tab active" href="#papers" data-tab="papers">📄 论文库 <span class="tab-count">${papers.length}</span></a>
      <a class="lib-wb-tab" href="#concepts" data-tab="concepts">🕸 概念库 <span class="tab-count">${topConcepts.length}</span></a>
      <a class="lib-wb-tab" href="#graph" data-tab="graph">🕸 图谱</a>
      <a class="lib-wb-tab" href="#digest" data-tab="digest">📰 每日简报</a>
      <a class="lib-wb-tab" href="#chat" data-tab="chat">💬 文献对话</a>
      <a class="lib-wb-tab" href="#notes" data-tab="notes">📝 笔记 <span class="tab-count">—</span></a>
      <a class="lib-wb-tab" href="#activity" data-tab="activity">📜 活动 <span class="tab-count" data-activity-count>—</span></a>
      <a class="lib-wb-tab" href="#govern" data-tab="govern">⚙️ 文献库配置 <span class="tab-count">P8a</span></a>
      <a class="back" href="${url('/libraries/')}">← 所有文献库</a>
    </nav>

    <section id="papers-panel" class="library-wb-panel active" data-panel="papers">
      <div class="wb-papers" data-user-lib-paper-list>
        <div class="wb-papers-list">
          <div class="wb-papers-quickadd">
            <input
              type="text"
              class="lib-input lib-quickadd-input"
              placeholder="手动添加 arXiv ID 或 URL(例:2503.12345)"
              data-quickadd-input
              aria-label="手动添加 arXiv 论文"
            />
            <button type="button" class="btn btn-soft btn-sm" data-quickadd-go>➕ 加进此库</button>
            <span class="muted" data-quickadd-status style="font-size: 0.8rem;"></span>
          </div>
          <div class="wb-papers-filter">
            <a class="filter-pill active" data-view="all" href="#papers">全部 ${papers.length}</a>
            <a class="filter-pill" data-view="today" href="#papers">今日 ${papers.filter((p) => p.date === new Date().toISOString().slice(0, 10)).length}</a>
          </div>
          <div class="wb-papers-sort">
            <span class="sort-label">排序</span>
            <a class="filter-pill" data-sort="date" href="#papers">📅 按时间</a>
            <a class="filter-pill active" data-sort="score" href="#papers">⭐ 按相关度</a>
          </div>
          <div class="wb-papers-status">
            <span class="sort-label">状态</span>
            <a class="filter-pill active" data-status-filter="all" href="#papers">全部 ${papers.length}</a>
            <a class="filter-pill" data-status-filter="candidate" href="#papers">🕐 候选 ${papers.filter((p) => lib.papers[p.canonicalArxivId]?.status === 'candidate').length}</a>
            <a class="filter-pill" data-status-filter="scored" href="#papers">⭐ 已打分 ${papers.filter((p) => lib.papers[p.canonicalArxivId]?.status === 'scored').length}</a>
            <a class="filter-pill" data-status-filter="included" href="#papers">✓ 纳入 ${papers.filter((p) => !lib.papers[p.canonicalArxivId]?.status || lib.papers[p.canonicalArxivId]?.status === 'included').length}</a>
            <a class="filter-pill" data-status-filter="excluded" href="#papers">✗ 剔除 ${papers.filter((p) => lib.papers[p.canonicalArxivId]?.status === 'excluded').length}</a>
            <a class="filter-pill" data-status-filter="trashed" href="#papers">🗑 回收 ${papers.filter((p) => lib.papers[p.canonicalArxivId]?.status === 'trashed').length}</a>
          </div>
          ${papers.length === 0
            ? `<div class="empty" data-user-lib-empty-hint>
                <h4 style="margin: 0 0 0.5rem;">👋 新库空空如也 — 接下来可以:</h4>
                <ol style="text-align: left; margin: 0.5rem 0; padding-left: 1.5rem; line-height: 1.8;">
                  <li>切到 <strong>「⚙️ 文献库配置」</strong> 标签 → 点「▶ 启动 Ingest」,系统从 arXiv 拉最近 30 天的候选论文</li>
                  <li>或在论文详情页右上角点 <strong>+ 加进文献库</strong> 手动加论文</li>
                  <li>填几个 <strong>锚点论文</strong>(你认可的核心论文,见「⚙️ 配置」底部),LLM 会按它们打更准的分</li>
                </ol>
                <p class="muted" style="margin: 0.5rem 0;">💡 <strong>锚点论文 = 评分锚</strong>:填 2-3 篇后,Ingest 会找跟它们主题/方法相似的论文。</p>
                <button type="button" class="btn btn-primary btn-sm" data-action="switch-tab" data-tab="govern" style="margin-top: 0.5rem;">⚙️ 打开配置 + 启动 Ingest</button>
              </div>`
            : `<div class="wb-bulk-bar" data-bulk-bar hidden>
                <span class="wb-bulk-count" data-bulk-count>0</span> 已选 ·
                <button type="button" class="btn btn-soft btn-sm" data-bulk-status="included">✓ 纳入</button>
                <button type="button" class="btn btn-soft btn-sm" data-bulk-status="excluded">✗ 剔除</button>
                <button type="button" class="btn btn-soft btn-sm" data-bulk-status="candidate">🕐 候选</button>
                <button type="button" class="btn btn-danger btn-sm" data-bulk-status="trashed">🗑 回收站</button>
                <button type="button" class="btn btn-ghost btn-sm" data-bulk-remove>🚮 从库移除</button>
                <button type="button" class="btn btn-ghost btn-sm" data-bulk-clear>清空选择</button>
              </div>
              <div class="wb-paper-rows-viewport" data-vlist-viewport data-vlist-host>
                 <div data-vlist-spacer>
                   <div data-vlist-rows></div>
                 </div>
                 <p class="wb-paper-rows-empty" hidden>暂无论文</p>
               </div>`}
        </div>
        <div class="wb-paper-detail" id="wb-detail-pane">
          ${papers.length === 0
            ? '<p class="empty">没有可显示的论文</p>'
            : papers.map((p, i) => renderPaperDetailBody(p, i, lib.papers[p.canonicalArxivId], lib.conceptOverrides)).join('')}
        </div>
      </div>
    </section>

    <section id="concepts-panel" class="library-wb-panel" data-panel="concepts">
      <div class="wb-concepts">
        <div class="wb-concepts-filter">
          <a class="filter-pill active" href="#concepts" data-cat="all"><span>全部</span><span>${topConcepts.length}</span></a>
          ${Array.from(new Set(topConcepts.map((c) => c.category))).sort().map((cat) => `
            <a class="filter-pill" href="#concepts" data-cat="${escapeHtml(cat)}">
              <span>${escapeHtml(cat)}</span>
              <span>${topConcepts.filter((c) => c.category === cat).length}</span>
            </a>
          `).join('')}
        </div>
        <div class="wb-concepts-grid">
          ${topConcepts.length === 0
            ? '<p class="empty">库内还没有概念(论文还没挂概念时这里会空)。</p>'
            : topConcepts.map((c) => {
              const ov = lib.conceptOverrides[c.slug] || {};
              const displayName = ov.displayName || c.display_name;
              const excluded = !!ov.exclude;
              return `
              <div class="wb-concepts-card${excluded ? ' cc-excluded' : ''}" data-cat="${escapeHtml(c.category)}" data-slug="${escapeHtml(c.slug)}">
                <a class="cc-name" href="${url('/wiki/concepts/' + (ov.canonicalSlug || c.slug) + '/')}">${escapeHtml(displayName)}</a>
                <div class="cc-meta"><span>×${c.n} 篇</span></div>
                <p class="cc-cat">${escapeHtml(c.category)}</p>
                <div class="cc-actions">
                  <button type="button" class="btn btn-soft btn-sm" data-action="cc-rename" data-slug="${escapeHtml(c.slug)}" data-name="${escapeHtml(displayName)}">✏️ 重命名</button>
                  ${excluded
                    ? `<button type="button" class="btn btn-soft btn-sm" data-action="cc-unexclude" data-slug="${escapeHtml(c.slug)}">↩ 恢复</button>`
                    : `<button type="button" class="btn btn-soft btn-sm" data-action="cc-exclude" data-slug="${escapeHtml(c.slug)}">⊘ 排除</button>`}
                  ${ov.canonicalSlug
                    ? `<button type="button" class="btn btn-soft btn-sm" data-action="cc-unrelink" data-slug="${escapeHtml(c.slug)}">↺ 取消合并</button>`
                    : `<button type="button" class="btn btn-soft btn-sm" data-action="cc-relink" data-slug="${escapeHtml(c.slug)}">🔗 合并到</button>`}
                  ${(ov.displayName || ov.exclude) ? `<button type="button" class="btn btn-ghost btn-sm" data-action="cc-reset" data-slug="${escapeHtml(c.slug)}">↺ 默认</button>` : ''}
                </div>
                ${ov.note ? `<p class="cc-note">📝 ${escapeHtml(ov.note)}</p>` : ''}
              </div>
            `;}).join('')}
        </div>
      </div>
    </section>

    <section id="govern-panel" class="library-wb-panel" data-panel="govern">
      <div class="wb-govern">
        <div class="govern-header">
          <h3>文献库配置(P8a LibraryDefinition)</h3>
          <button type="button" class="btn btn-soft btn-sm" data-action="edit" data-lib-id="${escapeHtml(lib.id)}">📝 编辑</button>
        </div>
        <dl class="govern-dl">
          <dt>可见性</dt>
          <dd>
            <span class="lib-visibility-pill vis-${escapeHtml(lib.visibility || 'personal')}">${escapeHtml({
              personal: '个人(仅本机 + Gist)',
              pending: '申请公开(请求中)',
              public: '公开(已发布)',
            }[lib.visibility || 'personal'])}</span>
          </dd>
          <dt>入库相关度阈值</dt>
          <dd class="mono">
            ≥ ${(lib.definition?.relevanceThreshold ?? 0.5).toFixed(2)}
            <span class="muted">(LLM 打分低于此值的论文不入库)</span>
          </dd>
          <dt>同步节奏</dt>
          <dd>${escapeHtml((lib.definition?.cadence || 'manual'))}</dd>
          <dt>研究方向陈述</dt>
          <dd>${escapeHtml(lib.statement)}</dd>
          <dt>分类 / 包括 / 排除关键词</dt>
          <dd>
            ${lib.categories.map((c) => `<span class="lib-tag">${escapeHtml(c)}</span>`).join('')}
            ${lib.inclusionKeywords.length > 0 ? '<div>包括:' + lib.inclusionKeywords.map((k) => `<span class="lib-tag include">${escapeHtml(k)}</span>`).join('') + '</div>' : ''}
            ${lib.exclusionKeywords.length > 0 ? '<div>排除:' + lib.exclusionKeywords.map((k) => `<span class="lib-tag exclude">${escapeHtml(k)}</span>`).join('') + '</div>' : ''}
            ${lib.categories.length + lib.inclusionKeywords.length + lib.exclusionKeywords.length === 0 ? '<em class="empty">— 未设置 —</em>' : ''}
          </dd>
          <dt>打分维度(rubric)</dt>
          <dd>
            ${lib.rubric.length > 0 ? lib.rubric.map((r) => `<span class="lib-tag">${escapeHtml(r.name)}</span>`).join('') : '<em class="empty">— 未设置 —</em>'}
          </dd>
          <dt>库目标(goals)</dt>
          <dd>${renderList(lib.definition?.goals, '— 未设置 —')}</dd>
          <dt>范围内(in scope)</dt>
          <dd>${renderList(lib.definition?.inScope, '— 未设置 —')}</dd>
          <dt>范围外(out of scope)</dt>
          <dd>${renderList(lib.definition?.outOfScope, '— 未设置 —')}</dd>
          <dt>研究问题</dt>
          <dd>${renderList(lib.definition?.questions, '— 未设置 —')}</dd>
          <dt>锚点论文</dt>
          <dd>
            ${lib.definition?.anchors && lib.definition.anchors.length > 0
              ? lib.definition.anchors.map((a) => `
                  <div class="lib-anchor-row">
                    <span class="kind-badge kind-${escapeHtml(a.kind)}">${escapeHtml(a.kind)}</span>
                    <span class="value">${escapeHtml(a.value)}</span>
                    ${a.note ? `<span class="note">${escapeHtml(a.note)}</span>` : ''}
                  </div>
                `).join('')
              : '<em class="empty">— 未设置 —</em>'}
          </dd>
        </dl>
        <p class="lib-edit-hint">
          配置变化后,顶部的论文列表会按新的 statement / 关键词重新过滤;
          想立刻按新方向给库内论文打分,
          <button type="button" class="linklike" data-action="rescore" data-lib-id="${escapeHtml(lib.id)}">点这里重打分</button>。
        </p>
        <p class="lib-edit-hint lib-ingest-hint">
          <strong>🛰️ Ingest</strong>:按当前 statement + 关键词去 arXiv 拉最近论文,LLM 给每篇打分,
          让你挑哪些进库。
          <button type="button" class="btn btn-primary btn-sm" data-action="ingest" data-lib-id="${escapeHtml(lib.id)}">▶ 启动 Ingest</button>
        </p>
        <p class="lib-edit-hint">
          <strong>📦 归档</strong>:把这个库移到归档区,不再参与日常浏览 / 候选拉取 / 摘要生成。
          已纳论文保留,导出仍可用。
          ${(lib.definition?.cadence === 'archived')
            ? `<button type="button" class="btn btn-soft btn-sm" data-action="unarchive" data-lib-id="${escapeHtml(lib.id)}">↩ 取消归档</button>`
            : `<button type="button" class="btn btn-soft btn-sm" data-action="archive" data-lib-id="${escapeHtml(lib.id)}">📦 归档此库</button>`}
        </p>
      </div>
      <div id="lib-ingest-mount"></div>
    </section>

    <section id="graph-panel" class="library-wb-panel" data-panel="graph">
      <div class="wb-graph">
        <h3>论文 × 概念 图谱</h3>
        <p class="muted">内圈概念 / 外圈论文 / 边按 Jaccard 相似度。客户端渲染,基于库内成员 + 高频概念。</p>
        <div id="wb-graph-svg-wrap" class="wb-graph-svg-wrap"></div>
        <script type="application/json" id="library-graph-data-personal" data-graph-data-personal set:html=""></script>
      </div>
    </section>

    <section id="chat-panel" class="library-wb-panel" data-panel="chat">
      <div class="wb-chat">
        <div class="chat-placeholder">
          <h3>文献对话 · 加载中…</h3>
        </div>
      </div>
    </section>

    <section id="digest-panel" class="library-wb-panel" data-panel="digest">
      <div class="wb-digest">
        <div class="digest-header">
          <h3>📰 简报与综述</h3>
          <p class="muted">
            <strong>日报</strong>:基于 statement + 关键词,聚合最近 7 天论文,LLM 生成 4 段解读(本地缓存 24h)。
            <strong>学术综述</strong>:IMRaD 七段结构(Abstract / Introduction / Methodology / Key Findings / Discussion / Conclusion / References),1500-2500 字可投稿级别,覆盖近 30 天。
          </p>
          <div class="digest-actions">
            <button type="button" class="btn btn-primary btn-sm" data-action="digest-generate" data-lib-id="${escapeHtml(lib.id)}">✨ 生成今日简报</button>
            <button type="button" class="btn btn-soft btn-sm" data-action="digest-academic-gen" data-lib-id="${escapeHtml(lib.id)}" title="IMRaD 七段结构,1500-2500 字,可投稿级别">📑 生成学术综述</button>
          </div>
        </div>
        <div id="lib-digest-mount" data-lib-digest-mount></div>
      </div>
    </section>

    <section id="activity-panel" class="library-wb-panel" data-panel="activity">
      <div class="wb-activity">
        <h3>📜 最近活动</h3>
        <p class="muted">库的所有变更(创建 / 改名 / 加入论文 / 状态切换 / 配置 / 归档)按时间倒序。</p>
        <div id="lib-activity-feed" data-lib-activity-feed></div>
      </div>
    </section>

    <section id="notes-panel" class="library-wb-panel" data-panel="notes">
      <div class="wb-notes">
        <p class="empty">
          笔记在每篇论文的 <a href="${url('/papers/')}">详情页</a> 底部写。
          选中下面的论文直接进入「📝 写笔记」位置。
        </p>
        ${papers.slice(0, 50).map((p) => `
          <a class="wb-note-row" href="${url('/papers/' + (p.id.split('/').pop() || p.id) + '/#paper-notes-section')}">
            <div class="note-head">
              <span>${escapeHtml(p.arxivId || '—')}</span>
              <span>${escapeHtml((p.date || '').slice(5) || '—')}</span>
            </div>
            <p class="note-title">${escapeHtml(p.title_zh || p.title_plain || p.title || p.id)}</p>
            ${p.title && p.title_zh !== p.title ? `<p class="note-body">${escapeHtml(p.title)}</p>` : ''}
          </a>
        `).join('')}
      </div>
    </section>
  `;

  // tab 切换
  const VALID_TABS = ['papers', 'concepts', 'graph', 'digest', 'chat', 'notes', 'activity', 'govern'] as const;
  type Tab = typeof VALID_TABS[number];

  // 虚拟滚动 init —— 把 papers[] 渲染成可见行,大幅降低 DOM 节点数
  // (Polaris 工作台 PapersTab 同构:460+ 论文不会卡顿)
  let visibleItems: typeof papers = papers;
  const vlistHost = mount.querySelector<HTMLElement>('[data-vlist-host]');
  let vlistCtl: ReturnType<typeof import('./virtual-list').createVirtualList> | null = null;
  if (vlistHost && papers.length > 0) {
    // 动态 import 避免 SSR bundle 膨胀
    void import('./virtual-list').then(({ createVirtualList }) => {
      vlistCtl = createVirtualList(vlistHost, {
        items: visibleItems,
        estimate: 110,
        overscan: 6,
        renderRow: (p, i) => {
          const meta = lib.papers[p.canonicalArxivId];
          const statusBadge = meta ? renderStatusBadge(meta.status) : '';
          const selected = i === 0 ? ' is-selected' : '';
          return `
            <a class="wb-paper-row${selected}"
               href="#paper-${escapeHtml(p.canonicalArxivId)}"
               data-paper-id="${escapeHtml(p.canonicalArxivId)}"
               data-vlist-idx="${i}"
               data-cx="${escapeHtml(p.canonicalArxivId)}"
               ${typeof p.score === 'number' && p.score > 0 ? `data-score="${p.score}"` : ''}>
              <div class="row-head">
                <input type="checkbox" class="wb-bulk-cb" data-bulk-toggle aria-label="批量选择" data-cx="${escapeHtml(p.canonicalArxivId)}" onclick="event.preventDefault(); event.stopPropagation();" />
                <span class="arx">${escapeHtml(p.arxivId || '—')}</span>
                ${p.date ? `<span>${escapeHtml(p.date.slice(5))}</span>` : ''}
                <span class="year">${escapeHtml((p.date || '').slice(0, 4) || '—')}</span>
                ${statusBadge}
              </div>
              <p class="row-title">${escapeHtml(p.title_zh || p.title_plain || p.title || p.id)}</p>
              ${p.title && p.title_zh ? `<p class="row-en">${escapeHtml(p.title)}</p>` : ''}
              <div class="row-chips">
                ${(p.concepts?.length || 0) > 0 ? `<span class="row-chip">🕸 ${p.concepts?.length} 概念</span>` : ''}
                <span class="row-chip">📅 ${escapeHtml(p.date || '—')}</span>
              </div>
            </a>
          `;
        },
      });
    });
  }

  function setActiveTab(tab: Tab) {
    mount.querySelectorAll<HTMLAnchorElement>('.lib-wb-tab').forEach((t) => {
      t.classList.toggle('active', (t.dataset.tab || '') === tab);
    });
    mount.querySelectorAll<HTMLElement>('.library-wb-panel').forEach((p) => {
      p.classList.toggle('active', p.dataset.panel === tab);
    });
  }
  function syncFromHash() {
    const m = window.location.hash.match(/^#(papers|concepts|graph|digest|chat|notes|activity|govern)$/);
    if (m) setActiveTab(m[1] as Tab);
  }
  mount.querySelectorAll<HTMLAnchorElement>('.lib-wb-tab').forEach((t) => {
    t.addEventListener('click', () => {
      const tab = (t.dataset.tab || '') as Tab;
      if ((VALID_TABS as readonly string[]).includes(tab)) {
        setActiveTab(tab);
        if (tab === 'graph') void ensureGraphMounted();
        if (tab === 'chat') void ensureChatMounted();
        if (tab === 'activity') void ensureActivityMounted();
      }
    });
  });
  window.addEventListener('hashchange', syncFromHash);
  syncFromHash();

  // 切到 activity tab:渲染 feed
  let activityMounted = false;
  async function ensureActivityMounted(): Promise<void> {
    if (activityMounted) return;
    activityMounted = true;
    const feed = mount.querySelector<HTMLElement>('[data-lib-activity-feed]');
    if (!feed) return;
    try {
      const { renderLibraryActivity } = await import('./library-activity-render');
      const n = renderLibraryActivity(feed, lib.id, 50);
      const cnt = mount.querySelector<HTMLElement>('[data-activity-count]');
      if (cnt) cnt.textContent = n > 0 ? String(n) : '·';
    } catch (e) {
      console.warn('[activity-feed] mount failed', e);
    }
  }

  // 切到 graph / chat 时挂载对应模块(lazy)
  let graphMounted = false;
  let chatMounted = false;
  async function ensureGraphMounted(): Promise<void> {
    if (graphMounted) return;
    graphMounted = true;
    // 注入图谱数据 JSON 给 mountLibraryGraph 读(它只查 #library-graph-data,
    // 我们注入同名节点)
    const dataNode = mount.querySelector<HTMLElement>('[data-graph-data-personal]');
    if (dataNode && !dataNode.textContent) {
      const topPapers = papers.slice(0, 80).map((p) => ({
        id: p.canonicalArxivId,
        title: p.title_zh || p.title_plain || p.title || p.id,
        relevanceScore: typeof p.score === 'number' ? p.score : undefined,
        concepts: (p.concepts || []).map((c) => c.slug).filter(Boolean),
      }));
      const topConceptsForGraph = topConcepts.slice(0, 6).map((c) => ({
        slug: c.slug, displayName: c.display_name,
      }));
      dataNode.textContent = JSON.stringify({ papers: topPapers, concepts: topConceptsForGraph });
      // 镜像到 #library-graph-data(id 名是 mountLibraryGraph 硬编码的)
      let alias = document.getElementById('library-graph-data');
      if (!alias) {
        alias = document.createElement('script');
        alias.id = 'library-graph-data';
        alias.type = 'application/json';
        document.body.appendChild(alias);
      }
      alias.textContent = dataNode.textContent;
    }
    try {
      const { mountLibraryGraph } = await import('./library-workbench-mounts');
      mountLibraryGraph();
    } catch (e) {
      console.warn('[user-lib] graph mount failed', e);
    }
  }
  async function ensureChatMounted(): Promise<void> {
    if (chatMounted) return;
    chatMounted = true;
    try {
      const { mountLibraryChat } = await import('./library-workbench-mounts');
      mountLibraryChat();
    } catch (e) {
      console.warn('[user-lib] chat mount failed', e);
    }
  }

  // 论文行点击高亮
  mount.querySelectorAll<HTMLAnchorElement>('.wb-paper-row').forEach((row) => {
    row.addEventListener('click', () => {
      mount.querySelectorAll('.wb-paper-row').forEach((r) => r.classList.remove('is-selected'));
      row.classList.add('is-selected');
    });
  });

  // view 过滤(全部 / 今日)—— 改 items 后 vlist.setItems()
  let currentView: 'all' | 'today' = 'all';
  let currentSort: 'date' | 'score' = 'score';
  let currentStatusFilter: 'all' | 'candidate' | 'scored' | 'included' | 'excluded' | 'trashed' = 'all';
  function statusOf(p: PaperLite): string {
    return (lib.papers[p.canonicalArxivId]?.status as string) || 'included';
  }
  function applyPaperListFilter(): void {
    const today = new Date().toISOString().slice(0, 10);
    let items = papers;
    if (currentView === 'today') {
      items = items.filter((p) => p.date === today);
    }
    if (currentStatusFilter !== 'all') {
      items = items.filter((p) => statusOf(p) === currentStatusFilter);
    }
    if (currentSort === 'score') {
      items = items.slice().sort((a, b) => {
        // 排序:score × (1 + 0.3 × noveltyScore), noveltyScore fallback = score/10
        const getWeighted = (p: PaperLite) => {
          const s = typeof p.score === 'number' ? p.score : 0;
          const n = (lib.papers[p.canonicalArxivId]?.noveltyScore ?? s / 10);
          return s * (1 + 0.3 * n);
        };
        const wa = getWeighted(a);
        const wb = getWeighted(b);
        if (wb !== wa) return wb - wa;
        return (b.date || '').localeCompare(a.date || '');
      });
    } else {
      items = items.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }
    visibleItems = items;
    vlistCtl?.setItems(items);
    vlistCtl?.scrollToIndex(0);
  }

  mount.querySelectorAll<HTMLAnchorElement>('.wb-papers-filter .filter-pill').forEach((p) => {
    p.addEventListener('click', (e) => {
      e.preventDefault();
      mount.querySelectorAll('.wb-papers-filter .filter-pill').forEach((b) => b.classList.toggle('active', b === p));
      currentView = (p.dataset.view === 'today' ? 'today' : 'all');
      applyPaperListFilter();
    });
  });

  // 排序
  mount.querySelectorAll<HTMLAnchorElement>('.wb-papers-sort .filter-pill').forEach((p) => {
    p.addEventListener('click', (e) => {
      e.preventDefault();
      mount.querySelectorAll('.wb-papers-sort .filter-pill').forEach((b) => b.classList.toggle('active', b === p));
      currentSort = (p.dataset.sort === 'date' ? 'date' : 'score');
      applyPaperListFilter();
    });
  });

  // 状态过滤(candidate / scored / included / excluded / trashed)
  mount.querySelectorAll<HTMLAnchorElement>('.wb-papers-status .filter-pill').forEach((p) => {
    p.addEventListener('click', (e) => {
      e.preventDefault();
      mount.querySelectorAll('.wb-papers-status .filter-pill').forEach((b) => b.classList.toggle('active', b === p));
      const v = p.dataset.statusFilter || 'all';
      currentStatusFilter = (
        v === 'candidate' || v === 'scored' || v === 'included' || v === 'excluded' || v === 'trashed'
      ) ? v : 'all';
      applyPaperListFilter();
    });
  });

  // 批量选择(每行 wb-paper-row 加勾选框 + 顶部 bulk bar 显示)
  // 极简交互:Ctrl/Cmd + click 行切换勾选;「全选」按钮走一遍当前可见 rows。
  let bulkSelected = new Set<string>();
  const bulkBar = mount.querySelector<HTMLElement>('[data-bulk-bar]');
  const bulkCount = mount.querySelector<HTMLElement>('[data-bulk-count]');
  function updateBulkBar(): void {
    if (!bulkBar) return;
    if (bulkSelected.size === 0) {
      bulkBar.hidden = true;
      return;
    }
    bulkBar.hidden = false;
    if (bulkCount) bulkCount.textContent = String(bulkSelected.size);
  }
  // row 长按 / Ctrl-click 切换勾选(用普通 click 容易误触,改成 data-bulk-toggle)
  // 用 checkbox 替代点行切换勾选,以免与详情锚点冲突。
  // 简化:复用原 row click 行为,但添加一个额外的 ☐ chip(在 .row-head 末尾)。
  // 由 mountLibraryWorkbenchPapers() 注入 —— 这里只挂事件代理:
  mount.querySelectorAll<HTMLElement>('[data-bulk-toggle]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const cx = cb.dataset.cx || '';
      if ((cb as HTMLInputElement).checked) bulkSelected.add(cx);
      else bulkSelected.delete(cx);
      updateBulkBar();
    });
  });
  // bulk-bar 按钮
  const statusBtnBind = (sel: string, status: LibraryPaperStatus): void => {
    mount.querySelector<HTMLButtonElement>(sel)?.addEventListener('click', () => {
      const ids = Array.from(bulkSelected);
      if (ids.length === 0) return;
      // 只有 trashed/excluded 才有 trashReason(included / candidate 不需要)
      const opts: { trashReason?: string } = {};
      if (status === 'trashed' || status === 'excluded') {
        opts.trashReason = 'bulk';
      }
      const res = bulkSetPaperStatus(lib.id, ids, status, opts);
      if (!res.ok) {
        showToast(getApiResultMessage(res), 'error');
      } else {
        showToast(`已批量设 ${ids.length} 篇 → ${status}`, 'ok');
        bulkSelected.clear();
        updateBulkBar();
        renderUserLibraryDetail();
      }
    });
  };
  statusBtnBind('[data-bulk-status="included"]', 'included');
  statusBtnBind('[data-bulk-status="excluded"]', 'excluded');
  statusBtnBind('[data-bulk-status="candidate"]', 'candidate');
  statusBtnBind('[data-bulk-status="trashed"]', 'trashed');
  mount.querySelector<HTMLButtonElement>('[data-bulk-remove]')?.addEventListener('click', () => {
    const ids = Array.from(bulkSelected);
    if (ids.length === 0) return;
    const ok = window.confirm(`从「${lib.name}」批量移除 ${ids.length} 篇论文?\n\n论文不会从 docs 删除,只是从这库里移走。`);
    if (!ok) return;
    const res = bulkRemovePapersFromLibrary(lib.id, ids);
    if (!res.ok) {
      showToast(getApiResultMessage(res), 'error');
    } else {
      showToast(`已批量移出 ${ids.length} 篇`, 'ok');
      bulkSelected.clear();
      updateBulkBar();
      renderUserLibraryDetail();
    }
  });
  mount.querySelector<HTMLButtonElement>('[data-bulk-clear]')?.addEventListener('click', () => {
    bulkSelected.clear();
    updateBulkBar();
    mount.querySelectorAll<HTMLInputElement>('[data-bulk-toggle]').forEach((cb) => (cb.checked = false));
  });

  // 概念 category 过滤
  mount.querySelectorAll<HTMLAnchorElement>('.wb-concepts-filter .filter-pill').forEach((p) => {
    p.addEventListener('click', (e) => {
      e.preventDefault();
      mount.querySelectorAll('.wb-concepts-filter .filter-pill').forEach((b) => b.classList.toggle('active', b === p));
      const cat = p.dataset.cat;
      mount.querySelectorAll<HTMLElement>('.wb-concepts-card').forEach((card) => {
        const show = cat === 'all' || card.dataset.cat === cat;
        card.style.display = show ? '' : 'none';
      });
    });
  });

  // 概念 relink(Polaris concept_relink):rename / exclude / unexclude / reset
  mount.querySelectorAll<HTMLButtonElement>('[data-action="cc-rename"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const slug = btn.dataset.slug || '';
      const orig = btn.dataset.name || '';
      const v = window.prompt(`重命名概念(只在本库生效;0-64 字)\n\n原名: ${orig}`, orig);
      if (v === null) return;
      const t = v.trim();
      if (!t || t === orig) return;
      const res = setLibraryConceptOverride(lib.id, slug, { displayName: t });
      if (!res.ok) showToast(getApiResultMessage(res), 'error');
      else { showToast('已重命名', 'ok'); renderUserLibraryDetail(); }
    });
  });
  mount.querySelectorAll<HTMLButtonElement>('[data-action="cc-exclude"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const slug = btn.dataset.slug || '';
      const res = setLibraryConceptOverride(lib.id, slug, { exclude: true });
      if (!res.ok) showToast(getApiResultMessage(res), 'error');
      else { showToast('已排除(只在本库)', 'ok'); renderUserLibraryDetail(); }
    });
  });
  mount.querySelectorAll<HTMLButtonElement>('[data-action="cc-unexclude"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const slug = btn.dataset.slug || '';
      const res = setLibraryConceptOverride(lib.id, slug, { exclude: false });
      if (!res.ok) showToast(getApiResultMessage(res), 'error');
      else { showToast('已恢复', 'ok'); renderUserLibraryDetail(); }
    });
  });
  mount.querySelectorAll<HTMLButtonElement>('[data-action="cc-reset"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const slug = btn.dataset.slug || '';
      const res = removeLibraryConceptOverride(lib.id, slug);
      if (!res.ok) showToast(getApiResultMessage(res), 'error');
      else { showToast('已恢复默认', 'ok'); renderUserLibraryDetail(); }
    });
  });

  // 概念 relink(合并到另一个 slug)
  mount.querySelectorAll<HTMLButtonElement>('[data-action="cc-relink"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const slug = btn.dataset.slug || '';
      const v = window.prompt(`合并概念到另一个 slug(只在本库生效)\n\n当前 slug: ${slug}\n目标 slug:`, slug);
      if (v === null) return;
      const t = v.trim();
      if (!t || t === slug) return;
      if (t.length > 64) { showToast('目标 slug 不能超过 64 个字符', 'error'); return; }
      if (/\s/.test(t)) { showToast('目标 slug 不能包含空白字符', 'error'); return; }
      const res = setLibraryConceptOverride(lib.id, slug, { canonicalSlug: t });
      if (!res.ok) showToast(getApiResultMessage(res), 'error');
      else { showToast(`已合并到「${t}」`, 'ok'); renderUserLibraryDetail(); }
    });
  });
  mount.querySelectorAll<HTMLButtonElement>('[data-action="cc-unrelink"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const slug = btn.dataset.slug || '';
      const res = setLibraryConceptOverride(lib.id, slug, { canonicalSlug: '' });
      if (!res.ok) showToast(getApiResultMessage(res), 'error');
      else { showToast('已取消合并', 'ok'); renderUserLibraryDetail(); }
    });
  });

  // 顶部按钮(编辑 / 删除)
  mount.querySelectorAll<HTMLButtonElement>('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const modal = document.querySelector<HTMLElement>('[data-new-library-modal]');
      if (!modal) return;
      const id = btn.dataset.libId || lib.id;
      openEditLibraryModal(modal, id);
    });
  });
  mount.querySelectorAll<HTMLButtonElement>('[data-action="rescore"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.libId || lib.id;
      // 进度显示
      const orig = btn.textContent;
      btn.textContent = '⏳ 重打分中…';
      btn.disabled = true;
      try {
        const { rescoreLibrary } = await import('./library-rescore');
        const r = await rescoreLibrary(id, allPapers);
        showToast(`重打分完成:打了 ${r.scored} 篇,跳过 ${r.skipped} 篇(已有分)`, 'ok');
      } catch (err) {
        showToast(`重打分失败:${(err as Error).message}`, 'error');
      } finally {
        btn.textContent = orig;
        btn.disabled = false;
        renderUserLibraryDetail();
      }
    });
  });
  mount.querySelectorAll<HTMLButtonElement>('[data-action="ingest"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.libId || lib.id;
      openIngestPanel(id);
    });
  });
  // 「切换 tab」入口(空库 onboarding 用)
  mount.querySelectorAll<HTMLButtonElement>('[data-action="switch-tab"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tab = btn.dataset.tab || '';
      if ((VALID_TABS as readonly string[]).includes(tab)) {
        setActiveTab(tab as Tab);
      }
    });
  });

  // 「手动添加 arXiv 论文」快速入口 — 让用户绕过 Ingest,直接粘贴 ID 加进库
  // 这是「想看的论文不在库内」最直接的解法:看到 arXiv → 复制 ID → 粘贴 → 纳入
  const qaInput = mount.querySelector<HTMLInputElement>('[data-quickadd-input]');
  const qaBtn = mount.querySelector<HTMLButtonElement>('[data-quickadd-go]');
  const qaStatus = mount.querySelector<HTMLElement>('[data-quickadd-status]');
  async function handleQuickAdd(): Promise<void> {
    if (!qaInput) return;
    const raw = qaInput.value.trim();
    if (!raw) {
      if (qaStatus) qaStatus.textContent = '⚠️ 粘贴一个 ID';
      return;
    }
    // 提取 arXiv ID(支持 "2503.12345" 或 "https://arxiv.org/abs/2503.12345" 或带 vN)
    const m = raw.match(/(\d{4}\.\d{4,5}(v\d+)?)/);
    if (!m) {
      if (qaStatus) qaStatus.textContent = '⚠️ 解析不出 arXiv ID(格式:2503.12345)';
      return;
    }
    const arxivId = m[1];
    if (qaBtn) qaBtn.disabled = true;
    if (qaStatus) qaStatus.textContent = `⏳ 验证 ${arxivId}…`;
    try {
      // 验证 arXiv 上真存在(防止用户复制错)+ 顺便拿元数据
      const { searchArxivById } = await import('./paper-analyzer');
      const entries = await searchArxivById(arxivId);
      if (entries.length === 0) throw new Error('arXiv 上找不到');
      const { addPaperToLibrary } = await import('../lib/user-libraries');
      const res = addPaperToLibrary(lib.id, arxivId);
      if (!res.ok) {
        if (qaStatus) qaStatus.textContent = `❌ ${res.reason || '加入失败'}`;
        return;
      }
      if (qaStatus) qaStatus.textContent = `✅ ${entries[0].title?.slice(0, 40) || arxivId}… 已加入`;
      qaInput.value = '';
      // 重渲工作台显示新论文
      renderUserLibraryDetail();
    } catch (e) {
      if (qaStatus) qaStatus.textContent = `❌ ${(e as Error).message || '失败'}`;
    } finally {
      if (qaBtn) qaBtn.disabled = false;
    }
  }
  qaBtn?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); void handleQuickAdd(); });
  qaInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); void handleQuickAdd(); }
  });

  // 归档 / 取消归档
  mount.querySelectorAll<HTMLButtonElement>('[data-action="archive"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ok = window.confirm(`把「${lib.name}」归档?\n\n归档后,库不会出现在首页 / 卡片墙,不能 ingest / digest;已纳论文保留,导出仍可用。`);
      if (!ok) return;
      const id = btn.dataset.libId || lib.id;
      const res = setLibraryArchived(id, true);
      if (!res.ok) {
        showToast(getApiResultMessage(res), 'error');
      } else {
        showToast('已归档', 'ok');
        renderUserLibraryDetail();
      }
    });
  });
  mount.querySelectorAll<HTMLButtonElement>('[data-action="unarchive"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.libId || lib.id;
      const res = setLibraryArchived(id, false);
      if (!res.ok) {
        showToast(getApiResultMessage(res), 'error');
      } else {
        showToast('已恢复', 'ok');
        renderUserLibraryDetail();
      }
    });
  });
  mount.querySelectorAll<HTMLButtonElement>('[data-action="digest-generate"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.libId || lib.id;
      const mount = document.getElementById('lib-digest-mount');
      if (!mount) return;
      mount.innerHTML = '<p class="muted"><span class="lib-spinner"></span> 正在生成 digest…</p>';
      try {
        const { generateDigest, listDigests } = await import('./library-digest');
        const d = await generateDigest(id, allPapers);
        renderDigestMount(mount, d, listDigests(id));
      } catch (err) {
        mount.innerHTML = `<p class="muted error">生成失败:${escapeHtml((err as Error).message)}</p>`;
      }
    });
  });
  // 学术综述按钮(IMRaD 七段可投稿级,深度较深 30 天 / 60 篇)
  mount.querySelectorAll<HTMLButtonElement>('[data-action="digest-academic-gen"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.libId || lib.id;
      const mount = document.getElementById('lib-digest-mount');
      if (!mount) return;
      mount.innerHTML = '<p class="muted"><span class="lib-spinner"></span> 正在生成学术综述(IMRaD 结构,1500-2500 字,通常需要 30-60s)…</p>';
      try {
        const { generateAcademicReport, listDigests } = await import('./library-digest');
        const d = await generateAcademicReport(id, allPapers);
        renderDigestMount(mount, d, listDigests(id));
      } catch (err) {
        mount.innerHTML = `<p class="muted error">生成失败:${escapeHtml((err as Error).message)}</p>`;
      }
    });
  });
  // digest 历史里的「打开」按钮
  mount.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLButtonElement>('[data-digest-open]');
    if (!btn) return;
    e.preventDefault();
    const date = btn.dataset.digestOpen || '';
    const id = lib.id;
    import('./library-digest').then(({ loadCachedDigest }) => {
      const d = loadCachedDigest(id, date);
      const mount = document.getElementById('lib-digest-mount');
      if (mount && d) renderDigestMount(mount, d, listDigestsSnapshot(id));
    });
  });
  mount.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener('click', () => {
    // 打开删除确认弹窗
    const modal = mount.querySelector<HTMLElement>('[data-delete-modal]');
    const backdrop = mount.querySelector<HTMLElement>('[data-delete-modal-backdrop]');
    const input = mount.querySelector<HTMLInputElement>('#lib-delete-confirm');
    const confirmBtn = mount.querySelector<HTMLButtonElement>('[data-delete-confirm]');
    const cancelBtn = mount.querySelector<HTMLButtonElement>('[data-delete-cancel]');
    const errorSpan = mount.querySelector<HTMLElement>('[data-delete-error]');
    if (!modal || !input || !confirmBtn || !cancelBtn || !errorSpan) return;

    const libName = modal.dataset.libName || '';
    const last4 = libName.slice(-4);

    // 重置弹窗状态
    input.value = '';
    errorSpan.textContent = '';
    confirmBtn.setAttribute('disabled', 'true');
    modal.style.display = 'block';

    // 输入验证
    const checkInput = () => {
      const val = input.value.trim();
      if (val.toLowerCase() === last4.toLowerCase()) {
        confirmBtn.removeAttribute('disabled');
        errorSpan.textContent = '';
      } else {
        confirmBtn.setAttribute('disabled', 'true');
        if (val.length > 0 && val.length !== last4.length) {
          errorSpan.textContent = `需输入 ${last4.length} 个字符`;
        } else {
          errorSpan.textContent = '';
        }
      }
    };

    input.oninput = checkInput;

    const closeModal = () => {
      modal.style.display = 'none';
    };

    cancelBtn.onclick = closeModal;
    backdrop?.onclick = closeModal;

    confirmBtn.onclick = () => {
      if ((confirmBtn.getAttribute('disabled') ?? '') === 'true') return;
      const res = deleteLibrary(lib.id);
      if (!res.ok) {
        showToast(getApiResultMessage(res), 'error');
        closeModal();
      } else {
        showToast('已删除', 'ok');
        window.location.href = url('/libraries/');
      }
    };

    // 聚焦输入框
    setTimeout(() => input.focus(), 30);
  });
  mount.querySelector<HTMLButtonElement>('[data-action="add-papers"]')?.addEventListener('click', () => {
    window.location.href = url('/papers/');
  });

  // 论文行:移出文献库按钮
  mount.querySelectorAll<HTMLButtonElement>('[data-action="remove-from-lib"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cxId = btn.dataset.cxId || '';
      if (!cxId) return;
      const ok = window.confirm('确定把这篇论文从文献库里移出?');
      if (!ok) return;
      const res = removePaperFromLibrary(lib.id, cxId);
      if (!res.ok) {
        showToast(getApiResultMessage(res), 'error');
      } else {
        showToast('已移出', 'ok');
        renderUserLibraryDetail();
      }
    });
  });

  // status 切换(Polaris library_papers.status 状态机:included/excluded/trashed/candidate)
  mount.querySelectorAll<HTMLButtonElement>('[data-action="status"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cxId = btn.dataset.cxId || '';
      const status = btn.dataset.status as 'included' | 'excluded' | 'trashed' | 'candidate' | undefined;
      if (!cxId || !status) return;
      const res = setLibraryPaperMeta(lib.id, cxId, { status });
      if (!res.ok) {
        showToast(getApiResultMessage(res), 'error');
      } else {
        showToast(`状态 → ${status}`, 'ok');
        renderUserLibraryDetail();
      }
    });
  });

  // 本库专属 TL;DR(失焦防抖保存)
  let saveTimer: number | null = null;
  mount.querySelectorAll<HTMLTextAreaElement>('.lib-tldr-note').forEach((ta) => {
    ta.addEventListener('blur', () => {
      const cxId = ta.dataset.cxId || '';
      if (!cxId) return;
      if (saveTimer) window.clearTimeout(saveTimer);
      const note = ta.value.trim();
      saveTimer = window.setTimeout(() => {
        const res = setLibraryPaperMeta(lib.id, cxId, { tldrNote: note });
        if (!res.ok) {
          showToast(getApiResultMessage(res), 'error');
        } else if (res.changed) {
          showToast('已保存本库 TL;DR', 'ok');
        }
      }, 250);
    });
    // Ctrl/Cmd+Enter 立即保存
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        ta.blur();
      }
    });
  });

  // 导出按钮(走 export-bridge 同一份函数,但 prefix + paperIds 是用户库自己)
  // export-bridge.ts 期望 data-cx 是 JSON.stringify(canonicalId[]) + data-prefix
  // 我们用 data-cx-prefix(自定义属性)+ data-paper-ids 注入;这里简单直接调用
  // exportBySet()(如果有 export 的话)。但 export-bridge 默认从 #library-wb-data
  // 节点读;这里走同一份函数:
  //   - 在 mount 末尾插一个隐藏的 [data-library-wb-data],套上 data-cx / data-prefix
  //   - import initLibraryExportButtons() 让按钮工作
  // 简化:写一个 mini 注入器
  injectExportDataAttrs(mount, lib.id, lib.paperIds);
  import('./export-bridge').then((m) => {
    try {
      m.initLibraryExportButtons?.();
    } catch {
      /* ignore */
    }
  }).catch(() => {
    /* ignore */
  });
}

function injectExportDataAttrs(mount: HTMLElement, libId: string, paperIds: string[]): void {
  let carrier = mount.querySelector<HTMLElement>('[data-cx]');
  if (!carrier) {
    carrier = document.createElement('section');
    carrier.setAttribute('aria-hidden', 'true');
    mount.appendChild(carrier);
  }
  carrier.dataset.cx = JSON.stringify(paperIds);
  carrier.dataset.prefix = `${libId}-library`;
  carrier.id = 'library-wb-data';
}

function renderPaperDetailBody(p: PaperLite, i: number, meta: LibraryPaperMeta | undefined, conceptOverrides?: Record<string, LibraryConceptOverride>): string {
  const statusLabel = meta ? renderStatusBadge(meta.status) : '';
  const relevanceScore = typeof meta?.relevanceScore === 'number' ? meta.relevanceScore : null;
  return `
    <div id="paper-${escapeHtml(p.canonicalArxivId)}"
         class="wb-detail-body${i === 0 ? ' wb-detail-default' : ''}">
      <div class="detail-head">
        <div class="detail-head-text">
          <div class="detail-pills">
            ${statusLabel ? `<span class="pill pill-libstatus pill-${escapeHtml(meta?.status || 'included')}">${statusLabel.replace(/<[^>]*>/g, '')}</span>` : '<span class="pill pill-status">已纳入</span>'}
            ${p.tldr ? '<span class="pill pill-wiki">✨ wiki</span>' : ''}
            ${p.pdf ? '<span class="pill pill-pdf">📄 PDF</span>' : ''}
            ${p.venue ? `<span class="pill pill-venue">${escapeHtml(p.venue)}</span>` : ''}
          </div>
          <h2>${escapeHtml(p.title_zh || p.title_plain || p.title || p.id)}</h2>
          ${p.title && p.title_zh ? `<p class="detail-en">${escapeHtml(p.title)}</p>` : ''}
          ${p.authors ? `<p class="detail-authors">${escapeHtml(p.authors)}</p>` : ''}
          <div class="detail-meta">
            ${p.arxivId ? `<a href="https://arxiv.org/abs/${encodeURIComponent(p.arxivId.replace(/v\d+$/, ''))}" target="_blank" rel="noopener">arXiv:${escapeHtml(p.arxivId)}</a>` : ''}
            <span>${escapeHtml(p.date || '—')}</span>
          </div>
        </div>
        ${typeof p.score === 'number' && p.score > 0 ? `
          <div class="score-ring" aria-label="相关度 ${p.score.toFixed(2)}">
            <svg viewBox="0 0 64 64" width="64" height="64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="var(--bg-muted)" stroke-width="4" />
              <circle cx="32" cy="32" r="28" fill="none" stroke="var(--accent)" stroke-width="4"
                      stroke-dasharray="${(p.score * 175.93).toFixed(1)} 175.93"
                      stroke-linecap="round" transform="rotate(-90 32 32)" />
            </svg>
            <span class="score-ring-label">${p.score.toFixed(2)}</span>
            <span class="score-ring-sub">相关度</span>
          </div>
        ` : ''}
      </div>

      <div class="detail-row detail-actions">
        <a class="export-btn primary" href="${url('/papers/' + (p.id.split('/').pop() || p.id) + '/')}">📖 阅读原文</a>
        <a class="export-btn" href="${url('/papers/' + (p.id.split('/').pop() || p.id) + '/#paper-notes-section')}">📝 写笔记</a>
        ${p.pdf ? `<a class="export-btn" href="${escapeHtml(p.pdf)}" target="_blank" rel="noopener">🔗 arXiv PDF</a>` : ''}
        <button type="button" class="export-btn" data-action="remove-from-lib" data-cx-id="${escapeHtml(p.canonicalArxivId)}">🗑 从文献库移出</button>
      </div>

      ${p.tldr ? `
        <div class="tldr-card">
          <span class="tldr-label">TL;DR</span>
          <p>${escapeHtml(p.tldr)}</p>
        </div>
      ` : ''}

      ${p.wikiContent ? `
        <details class="detail-section wiki-section" open>
          <summary>
            <span class="wiki-label">📖 中文解读</span>
            <span class="wiki-hint">Polaris 风格 5 节</span>
          </summary>
          <div class="wiki-body">${renderWikiMarkdown(p.wikiContent)}</div>
        </details>
      ` : ''}

      ${meta ? `
        <details class="detail-section" open>
          <summary>本库专属 TL;DR · ${meta.status}</summary>
          ${relevanceScore !== null ? `<p class="lib-meta-line">📊 本库相关度:<strong>${relevanceScore.toFixed(2)}</strong>${meta.relevanceReason ? ` — ${escapeHtml(meta.relevanceReason)}` : ''}</p>` : ''}
          <textarea
            class="lib-tldr-note"
            rows="3"
            maxlength="500"
            placeholder="在这条库的方向上,这篇论文的核心要点 / 我的批注(0-500 字)"
            data-cx-id="${escapeHtml(p.canonicalArxivId)}"
          >${escapeHtml(meta.tldrNote || '')}</textarea>
          <div class="lib-meta-actions">
            <button type="button" class="btn btn-soft btn-sm" data-action="status" data-cx-id="${escapeHtml(p.canonicalArxivId)}" data-status="included">✓ 纳入</button>
            <button type="button" class="btn btn-soft btn-sm" data-action="status" data-cx-id="${escapeHtml(p.canonicalArxivId)}" data-status="excluded">✗ 剔除</button>
            <button type="button" class="btn btn-soft btn-sm" data-action="status" data-cx-id="${escapeHtml(p.canonicalArxivId)}" data-status="candidate">🕐 重置候选</button>
            <button type="button" class="btn btn-danger btn-sm" data-action="status" data-cx-id="${escapeHtml(p.canonicalArxivId)}" data-status="trashed">🗑 回收站</button>
          </div>
        </details>
      ` : ''}

      ${p.concepts && p.concepts.length > 0 ? (() => {
        const limit = 12;
        const overflow = p.concepts.length > limit;
        const displayConcepts = overflow ? p.concepts.slice(0, limit) : p.concepts;
        return `
          <details class="detail-section" open=${p.concepts.length <= limit}>
            <summary>概念 · ${p.concepts.length} 个</summary>
            <div class="concepts-chips">
              ${displayConcepts.map((c) => {
                const ov = conceptOverrides?.[c.slug];
                const targetSlug = ov?.canonicalSlug || c.slug;
                return `<a class="cc" href="${url('/wiki/concepts/' + targetSlug + '/')}">${escapeHtml(c.display_name)}</a>`;
              }).join('')}
              ${overflow ? `<span class="cc cc-overflow">+${p.concepts.length - limit} 个</span>` : ''}
            </div>
          </details>
        `;
      })() : ''}

      <details class="detail-section">
        <summary>摘要</summary>
        ${p.evidence
          ? `<p class="detail-abstract">${escapeHtml(p.evidence)}</p>`
          : '<p class="empty muted">这篇还没有摘要。</p>'}
      </details>

      <details class="detail-section">
        <summary>我的笔记</summary>
        <p class="empty muted">
          笔记存在浏览器 localStorage,SSR 无法读取。<br />
          <a href="${url('/papers/' + (p.id.split('/').pop() || p.id) + '/#paper-notes-section')}">→ 去论文页底部写笔记 / 读笔记</a>
        </p>
      </details>

      <details class="detail-section">
        <summary>元信息</summary>
        <dl class="detail-meta-table">
          ${p.arxivId ? `<dt>arXiv</dt><dd class="mono">${escapeHtml(p.arxivId)}</dd>` : ''}
          ${p.date ? `<dt>发布日期</dt><dd class="mono">${escapeHtml(p.date)}</dd>` : ''}
          ${p.pdf ? `<dt>PDF</dt><dd><a href="${escapeHtml(p.pdf)}" target="_blank" rel="noopener" class="mono">${escapeHtml(p.pdf)}</a></dd>` : ''}
          ${typeof p.score === 'number' ? `<dt>相关度</dt><dd class="mono">${p.score.toFixed(3)}</dd>` : ''}
        </dl>
      </details>
    </div>
  `;
}

// ----------------------------------------------------------------
// type 段控件(全部 / 公共 / 个人)—— 用于 /libraries/ 页
// ----------------------------------------------------------------

function setupTypeFilter(): void {
  const root = document.querySelector<HTMLElement>('[data-type-filter]');
  if (!root) return;
  const segs = root.querySelectorAll<HTMLElement>('.lib-segment');
  const targetSel = root.dataset.typeFilterTarget || '[data-type-filter-target]';
  const target = document.querySelector<HTMLElement>(targetSel);
  if (!target) return;

  segs.forEach((seg) => {
    seg.addEventListener('click', () => {
      segs.forEach((s) => s.classList.remove('active'));
      seg.classList.add('active');
      const v = seg.dataset.typeValue || 'all';
      target.querySelectorAll<HTMLElement>('[data-lib-type]').forEach((el) => {
        const t = el.dataset.libType || 'public';
        const show = v === 'all' || (v === 'public' ? t === 'public' : t === 'personal');
        el.style.display = show ? '' : 'none';
      });
      // 更新计数
      const counter = target.querySelector<HTMLElement>('[data-type-filter-count]');
      if (counter) {
        const total = target.querySelectorAll<HTMLElement>('[data-lib-type]').length;
        const visible = target.querySelectorAll<HTMLElement>('[data-lib-type]:not([style*="display: none"])').length;
        counter.textContent = v === 'all' ? '' : `${visible} / ${total}`;
      }
    });
  });
}

// ----------------------------------------------------------------
// bootstrap
// ----------------------------------------------------------------

function bootstrap(): void {
  setupUserLibrariesSection();
  setupNewLibraryModal();
  setupAddToLibraryButtons();
  renderUserLibraryDetail();
  setupTypeFilter();

  // 编辑 modal 保存后刷新详情(沿用 dpr:user-libraries-change 已经会刷新卡片,
  // 但 detail 视图是 SSR-空壳 + 客户端挂载,需要在 save 后主动重渲)
  document.addEventListener('dpr:user-library-edit', () => {
    renderUserLibraryDetail();
  });
}

if (typeof window !== 'undefined') {
  // 首次加载 + Astro 切页都跑
  document.addEventListener('astro:page-load', bootstrap);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
}
