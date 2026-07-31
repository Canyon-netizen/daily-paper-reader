// ============================================================================
  // PaperLibrary 客户端逻辑(精简版:仅列表 + 抽屉)
  // ============================================================================
  // 数据源:由 SSR 端把 papers 序列化为 JSON,挂到 #papers-data 节点
  //        (避开在注释里直接写 script 字面量,以免 HTML parser 提前闭合本块)。
  // 渲染目标:.papers-library-host 内的 DOM。
  // 用户标签:localStorage 优先(key 'dpr_user_tags_v1'),Gist 同步由 user-tags.ts 内部处理。
  // ============================================================================

  import {
    getUserTags,
    addTag,
    removeTag,
    pullUserTagsFromGist,
    pushUserTagsToGist,
    type UserTag,
  } from '../lib/user-tags';
  import {
    getUserPaperState,
    hasUserNote,
    isStarred,
    toggleStar,
    setReadingStatus,
  } from '../lib/user-library';
  import { onDprUserLibraryChange } from '../lib/events';
  import { canonicalArxivId } from '../lib/arxiv';
  import { getGistToken, getGistId } from '../scripts/settings';
  import { showToast } from '../scripts/toast';
  import { searchLibrary, renderModePill, renderDegradeBanner } from '../scripts/library-search';
  import type { SearchResult } from '../lib/search/types';

  // ---------- 类型 ----------
  interface PaperListItemLite {
    id: string;
    title?: string;
    title_zh?: string;
    authors?: string;
    date?: string;
    pdf?: string;
    tags?: string[];
    arxivId: string;
    slug: string;
    canonicalArxivId?: string;
    // 可选:SSR 嵌入的轻量 tldr(若空,drawer 打开时再单独请求)
    tldr?: string;
    // 可选:缩略图 URL(已拼 base);给抽屉展示 first figure 用
    thumbnail?: string;
  }
  interface PapersDataPayload {
    papers: PaperListItemLite[];
    generatedAt: string;
  }

  // ---------- 数据装载 ----------
  function loadPapersData(): PapersDataPayload | null {
    const el = document.getElementById('papers-data');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || '{}') as PapersDataPayload;
    } catch {
      return null;
    }
  }

  // ---------- 常量 ----------
  const VIRTUAL_ROW_HEIGHT = 96;     // px,列表项估计高度(用于虚拟滚动)
  const VIRTUAL_OVERSCAN = 6;        // 多渲染的离屏行数
  const ROW_ESTIMATE = 120; // 列表项估计平均高度,实际渲染后再校准

  // ---------- 工具 ----------
  function stripQueryPrefix(tag: string): string {
    const i = tag.indexOf(':');
    return i > 0 ? tag.slice(i + 1) : tag;
  }
  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c),
    );
  }
  function todayString(): string {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  // ---------- 主类 ----------
  class PaperLibrary {
    private host: HTMLElement;
    private papers: PaperListItemLite[] = [];
    private filtered: PaperListItemLite[] = [];
    private filterText = '';
    private filterTag = '';
    private byId = new Map<string, PaperListItemLite>();
    private tagCounts = new Map<string, number>();
    private drawerPaperId: string | null = null;
    private drawerUserTags: UserTag[] = [];
    private rowHeights = new Map<number, number>(); // index -> measured height
    private notesEnabled = false;
    private lastSearchResult: SearchResult | null = null;
    private refreshSeq = 0;  // 串行化:旧 refresh 跑完才认新的,避免 out-of-order

    constructor(host: HTMLElement) {
      this.host = host;
    }

    async init(): Promise<void> {
      const data = loadPapersData();
      if (!data || !Array.isArray(data.papers)) {
        return;
      }
      this.papers = data.papers;
      this.byId = new Map(this.papers.map((p) => [p.id, p]));
      this.buildTagFilter();
      this.bindUI();
      void this.refreshFilter();
      // 阅读态事件订阅 — rAF 合并多次写入,避免连续点击 star 时每条事件都触发 querySelectorAll。
      let pending: ReadonlyArray<string> | null = null;
      let rafId: number | null = null;
      const flush = (): void => {
        rafId = null;
        if (pending) {
          const ids = pending;
          pending = null;
          this.applyStateChange(ids);
        }
      };
      onDprUserLibraryChange((detail) => {
        pending = pending && pending.length ? [...pending, ...detail.ids] : detail.ids;
        if (rafId === null) rafId = window.requestAnimationFrame(flush);
      });
      // 启动时尝试从 Gist 拉一次用户标签(若 token + gistId 都配齐);
      // 远端合并到本地 union 去重 — 失败静默,本地状态不变。
      this.maybePullTagsFromGist();
    }

    /** 启动时从 Gist 拉用户标签,与本地 union 合并。若当前抽屉已开,刷新 chip。 */
    private maybePullTagsFromGist(): void {
      if (!getGistToken() || !getGistId()) return;
      pullUserTagsFromGist()
        .then((r) => {
          if (r.ok && r.mergedCount && r.mergedCount > 0 && this.drawerPaperId) {
            const p = this.byId.get(this.drawerPaperId);
            if (p?.arxivId) {
              this.drawerUserTags = getUserTags(p.arxivId);
              this.renderUserTags();
            }
          }
        })
        .catch((e) => console.warn('[PaperLibrary] Gist pull failed:', e));
    }

    /** 本地写完后,异步把整个 userTags map 推到 Gist。失败弹 toast,本地状态不变。 */
    private maybePushTagsToGist(): void {
      if (!getGistToken() || !getGistId()) return;
      pushUserTagsToGist().then((r) => {
        if (!r.ok) {
          showToast(
            `标签已保存到本地,Gist 同步失败,下次访问会重试(${r.reason || '未知错误'})`,
            'error',
          );
        }
      }).catch((e) => {
        showToast(
          `标签已保存到本地,Gist 同步失败,下次访问会重试(${(e as Error).message || e})`,
          'error',
        );
      });
    }

    // ---------- 标签筛选条 ----------
    private buildTagFilter(): void {
      this.tagCounts.clear();
      for (const p of this.papers) {
        for (const t of p.tags || []) {
          this.tagCounts.set(t, (this.tagCounts.get(t) || 0) + 1);
        }
      }
      // 取前 30 个最多的标签,避免渲染过多样本
      const sorted = Array.from(this.tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30);
      const root = this.qs<HTMLDivElement>('[data-papers-tag-filter]');
      root.innerHTML = '';
      // "全部" chip
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'papers-tag-chip is-active';
      all.dataset.tag = '';
      all.textContent = `全部 ${this.papers.length}`;
      all.addEventListener('click', () => this.setTagFilter(''));
      root.appendChild(all);
      for (const [tag, count] of sorted) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'papers-tag-chip';
        b.dataset.tag = tag;
        const label = stripQueryPrefix(tag);
        const countSpan = document.createElement('span');
        countSpan.className = 'papers-tag-chip-count';
        countSpan.textContent = String(count);
        b.appendChild(document.createTextNode(label + ' '));
        b.appendChild(countSpan);
        b.addEventListener('click', () => this.setTagFilter(tag));
        root.appendChild(b);
      }
    }

    private setTagFilter(tag: string): void {
      this.filterTag = tag;
      const root = this.qs<HTMLDivElement>('[data-papers-tag-filter]');
      for (const c of root.children) {
        const btn = c as HTMLButtonElement;
        const t = btn.dataset.tag || '';
        btn.classList.toggle('is-active', t === tag);
      }
      void this.refreshFilter();
    }

    // ---------- 搜索 + 过滤 ----------
    private bindUI(): void {
      const search = this.qs<HTMLInputElement>('[data-papers-search]');
      let timer: number | undefined;
      search.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          this.filterText = search.value.trim().toLowerCase();
          void this.refreshFilter();
        }, 100);
      });
      // 抽屉关闭
      this.qs<HTMLButtonElement>('[data-papers-drawer-close]')
        .addEventListener('click', () => this.closeDrawer());
      // 标签编辑
      this.qs<HTMLButtonElement>('[data-papers-tag-add]')
        .addEventListener('click', () => this.handleAddTag());
      const kindIn = this.qs<HTMLInputElement>('[data-papers-tag-kind]');
      const labelIn = this.qs<HTMLInputElement>('[data-papers-tag-label]');
      labelIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.handleAddTag();
      });
      kindIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') labelIn.focus();
      });
      // 列表 viewport 滚动 → 触发虚拟滚动重算
      const viewport = this.qs<HTMLDivElement>('[data-papers-viewport]');
      viewport.addEventListener('scroll', () => this.renderVisibleRows());
      // 「搜索我的笔记」开关(Stage 6):复选 toggle → 改 notesEnabled 然后 refreshFilter。
      const notesToggle = this.host.querySelector<HTMLInputElement>(
        '[data-papers-search-notes-toggle]',
      );
      if (notesToggle) {
        notesToggle.checked = this.notesEnabled;
        notesToggle.addEventListener('change', () => {
          this.notesEnabled = notesToggle.checked;
          if (this.filterText) void this.refreshFilter();
        });
      }
    }

    private async refreshFilter(): Promise<void> {
      const q = this.filterText;
      const tag = this.filterTag;
      const seq = ++this.refreshSeq;
      // 1) tag 过滤先做(命中行确定)
      let prefiltered = this.papers;
      if (tag) prefiltered = prefiltered.filter((p) => (p.tags || []).includes(tag));

      if (q) {
        // Stage 5/6:跑 BM25 / substring
        const notesSnapshot = this.notesEnabled ? this.collectNotesSnapshot() : undefined;
        const result = await searchLibrary(q, { notesSnapshot });
        if (seq !== this.refreshSeq) return;
        this.lastSearchResult = result;
        const orderedByRank = orderedByRankedIds(prefiltered, result, q);
        this.filtered = orderedByRank;
        // toolbar ui
        const pill = this.host.querySelector<HTMLElement>('[data-papers-search-mode]');
        if (pill) renderModePill(pill, result);
        const banner = this.host.querySelector<HTMLElement>('[data-papers-search-degrade]');
        if (banner) renderDegradeBanner(banner, result);
      } else {
        this.lastSearchResult = null;
        // 无 query — 按 date desc 兜底排
        this.filtered = prefiltered.slice().sort((a, b) => {
          const av = a.date ? new Date(a.date).getTime() : 0;
          const bv = b.date ? new Date(b.date).getTime() : 0;
          return bv - av;
        });
        const emptyResult: SearchResult = {
          hits: [],
          mode: 'empty',
          stats: { tookMs: 0, totalHits: 0, noteHits: 0, indexedDocs: 0, notesSearched: false },
        };
        const pill = this.host.querySelector<HTMLElement>('[data-papers-search-mode]');
        if (pill) renderModePill(pill, emptyResult);
        const banner = this.host.querySelector<HTMLElement>('[data-papers-search-degrade]');
        if (banner) renderDegradeBanner(banner, emptyResult);
      }
      this.updateMetaLine();
      // 重置虚拟滚动
      this.rowHeights.clear();
      const spacer = this.qs<HTMLDivElement>('[data-papers-spacer]');
      spacer.style.height = `${this.filtered.length * ROW_ESTIMATE}px`;
      const viewport = this.qs<HTMLDivElement>('[data-papers-viewport]');
      viewport.scrollTop = 0;
      const empty = this.qs<HTMLDivElement>('[data-papers-list-empty]');
      empty.hidden = this.filtered.length > 0;
      this.renderVisibleRows();
    }

    private collectNotesSnapshot(): ReadonlyMap<string, string> | undefined {
      try {
        // 动态 import 避免在 init 阶段阻塞 SSR 渲染。listWithNotes 只放 length>0 的。
        // 内联实现一份 simplify 版,避免再深引 user-library snapshot 触发 SSR 路径。
        const raw = localStorage.getItem('dpr_user_library_v1');
        if (!raw) return undefined;
        const doc = JSON.parse(raw);
        const papers = doc?.papers;
        if (!papers || typeof papers !== 'object') return undefined;
        const out = new Map<string, string>();
        for (const [cx, st] of Object.entries(papers)) {
          const note = (st && (st as { note?: string }).note) || '';
          if (note.trim()) out.set(cx, note);
        }
        return out.size ? out : undefined;
      } catch {
        return undefined;
      }
    }

    private updateMetaLine(): void {
      const meta = this.qs<HTMLDivElement>('[data-papers-toolbar-meta]');
      const today = todayString();
      const todayCount = this.filtered.filter((p) => p.date === today).length;
      const stats = this.lastSearchResult?.stats;
      const noteBit = stats?.notesSearched
        ? ` · 笔记+${this.lastSearchResult?.stats.noteHits || 0}`
        : '';
      meta.textContent = `共 ${this.filtered.length} / ${this.papers.length} 篇 · 今日 ${todayCount}${noteBit}`;
    }

    // ---------- 虚拟滚动 ----------
    private renderVisibleRows(): void {
      const viewport = this.qs<HTMLDivElement>('[data-papers-viewport]');
      const spacer = this.qs<HTMLDivElement>('[data-papers-spacer]');
      const scrollTop = viewport.scrollTop;
      const viewportH = viewport.clientHeight;

      // 计算累计偏移(用 rowHeights 测量值,缺则用 ROW_ESTIMATE)
      const offsets: number[] = new Array(this.filtered.length + 1);
      offsets[0] = 0;
      for (let i = 0; i < this.filtered.length; i++) {
        const h = this.rowHeights.get(i) ?? ROW_ESTIMATE;
        offsets[i + 1] = offsets[i] + h;
      }
      spacer.style.height = `${offsets[this.filtered.length]}px`;

      // 二分找可见区间
      let start = 0;
      let end = this.filtered.length;
      // start: 第一个 offset+height > scrollTop 的
      let lo = 0, hi = this.filtered.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid] + (this.rowHeights.get(mid) ?? ROW_ESTIMATE) > scrollTop) hi = mid;
        else lo = mid + 1;
      }
      start = Math.max(0, lo - VIRTUAL_OVERSCAN);
      // end: 第一个 offset >= scrollTop+viewportH 的
      lo = start; hi = this.filtered.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid] >= scrollTop + viewportH) hi = mid;
        else lo = mid + 1;
      }
      end = Math.min(this.filtered.length, lo + VIRTUAL_OVERSCAN);

      // 渲染 start..end-1
      spacer.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'papers-list-empty';
      empty.hidden = this.filtered.length > 0;
      empty.textContent = '暂无匹配论文';
      spacer.appendChild(empty);

      for (let i = start; i < end; i++) {
        const p = this.filtered[i];
        const node = document.createElement('div');
        node.className = 'papers-list-item';
        if (p.id === this.drawerPaperId) node.classList.add('is-active');
        node.style.top = `${offsets[i]}px`;
        node.style.height = `${this.rowHeights.get(i) ?? ROW_ESTIMATE}px`;
        node.dataset.paperId = p.id;
        node.dataset.arxivId = p.arxivId || ' ';

        // 阅读态控件行:星标 + 状态胶囊 + 笔记指示(行内 inline-flex,绝对不换行)
        const stateRow = this.buildStateRow(p);
        node.appendChild(stateRow);

        const title = document.createElement('div');
        title.className = 'papers-list-item-title';
        title.textContent = p.title_zh || p.title || p.id;
        node.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'papers-list-item-meta';
        const authors = document.createElement('span');
        authors.className = 'papers-list-item-authors';
        authors.textContent = p.authors || '';
        meta.appendChild(authors);
        const date = document.createElement('span');
        date.textContent = p.date || '';
        meta.appendChild(date);
        node.appendChild(meta);

        const tagsRow = document.createElement('div');
        tagsRow.className = 'papers-list-item-tags';
        for (const t of (p.tags || []).slice(0, 3)) {
          const tag = document.createElement('span');
          tag.className = 'papers-list-item-tag';
          tag.textContent = stripQueryPrefix(t);
          tagsRow.appendChild(tag);
        }
        node.appendChild(tagsRow);

        node.addEventListener('mouseenter', () => this.highlightListItem(p.id, true));
        node.addEventListener('mouseleave', () => this.highlightListItem(p.id, false));
        node.addEventListener('click', (ev) => {
          // 点击星标 / 状态胶囊时不打开抽屉
          const tgt = ev.target as HTMLElement;
          if (tgt.closest('[data-list-state-btn]')) return;
          this.openDrawer(p.id);
        });
        spacer.appendChild(node);

        // 测量实际高度用于下一次渲染
        const measured = node.offsetHeight;
        if (measured > 0 && Math.abs(measured - (this.rowHeights.get(i) ?? ROW_ESTIMATE)) > 4) {
          this.rowHeights.set(i, measured);
        }
      }
    }

    /** 行内阅读态控件:⭐ + 状态胶囊 + 📝 笔记指示。事件走 user-library 漏斗,
     *  监听 DPR_USER_LIBRARY_CHANGE 后只更新单行,不全表重绘。 */
    private buildStateRow(p: PaperListItemLite): HTMLDivElement {
      const row = document.createElement('div');
      row.className = 'papers-list-item-state';

      // 星标按钮
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'papers-list-star';
      star.dataset.listStateBtn = 'star';
      star.dataset.arxivId = p.arxivId || ' ';
      star.title = '星标这篇论文';
      this.applyStarState(star, p.arxivId || '');
      star.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!p.arxivId) return;
        const res = toggleStar(p.arxivId);
        if (!res.ok) {
          showToast(res.reason === 'quota' ? '本地存储已满,星标失败' : '星标失败', 'error');
        }
      });
      row.appendChild(star);

      // 状态胶囊 ○/◐/●
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'papers-list-status-chip';
      chip.dataset.listStateBtn = 'status';
      chip.dataset.arxivId = p.arxivId || ' ';
      chip.title = '点击切换阅读状态(未读 → 在读 → 已读)';
      this.applyStatusState(chip, p.arxivId || '');
      chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!p.arxivId) return;
        const cur = getUserPaperState(p.arxivId)?.readingStatus ?? 'unread';
        const next = cur === 'unread' ? 'reading' : cur === 'reading' ? 'read' : 'unread';
        const res = setReadingStatus(p.arxivId, next);
        if (!res.ok) {
          showToast(res.reason === 'quota' ? '本地存储已满,状态保存失败' : '状态保存失败', 'error');
        }
      });
      row.appendChild(chip);

      // 笔记指示点(纯展示,无 click —— 笔记编辑在抽屉/详情页)
      const note = document.createElement('span');
      note.className = 'papers-list-note-dot';
      note.dataset.listStateBtn = 'note';
      note.title = '已写笔记';
      note.textContent = '📝';
      this.applyNoteState(note, p.arxivId || '');
      row.appendChild(note);

      return row;
    }

    private applyStarState(btn: HTMLButtonElement, rawId: string): void {
      const on = rawId ? isStarred(rawId) : false;
      btn.textContent = on ? '⭐' : '☆';
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
    }

    private applyStatusState(btn: HTMLButtonElement, rawId: string): void {
      const s = rawId ? (getUserPaperState(rawId)?.readingStatus ?? 'unread') : 'unread';
      const label = s === 'read' ? '●' : s === 'reading' ? '◐' : '○';
      btn.textContent = label;
      btn.classList.remove('is-unread', 'is-reading', 'is-read');
      btn.classList.add(`is-${s}`);
      btn.setAttribute('aria-label', `阅读状态:${s}`);
    }

    private applyNoteState(el: HTMLElement, rawId: string): void {
      const on = rawId ? hasUserNote(rawId) : false;
      el.classList.toggle('is-on', on);
      el.hidden = !on;
    }

    /** 事件回调:对受影响的 paperId 列表,只重绘对应行(不全表重绘)。
     *  通过 id → paper → row 的两步定位实现。 */
    private applyStateChange(ids: ReadonlyArray<string>): void {
      const affected = new Set(ids);
      for (const id of affected) {
        // events 传的是 canonicalArxivId;列表行 dataset.arxivId 是原始(带版本)id。
        // 用 canonicalArxivId() 双向归一化。
        const canonical = canonicalArxivId(id);
        for (const node of this.qsa<HTMLDivElement>('.papers-list-item')) {
          const rowCanon = canonicalArxivId(node.dataset.arxivId || '');
          if (rowCanon && rowCanon === canonical) {
            const arxivId = node.dataset.arxivId || '';
            const star = node.querySelector<HTMLButtonElement>('[data-list-state-btn="star"]');
            const chip = node.querySelector<HTMLButtonElement>('[data-list-state-btn="status"]');
            const note = node.querySelector<HTMLSpanElement>('[data-list-state-btn="note"]');
            if (star) this.applyStarState(star, arxivId);
            if (chip) this.applyStatusState(chip, arxivId);
            if (note) this.applyNoteState(note, arxivId);
          }
        }
      }
    }

    // ---------- 列表项高亮(无图节点,只同步列表) ----------
    private highlightListItem(paperId: string, on: boolean): void {
      for (const item of this.qsa<HTMLDivElement>('.papers-list-item')) {
        if (item.dataset.paperId === paperId) {
          item.classList.toggle('is-hover', on);
        }
      }
    }

    // ---------- 抽屉 ----------
    private openDrawer(paperId: string): void {
      const p = this.byId.get(paperId);
      if (!p) return;
      this.drawerPaperId = paperId;
      const drawer = this.qs<HTMLDivElement>('[data-papers-drawer]');
      drawer.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');
      // 列表项 active
      for (const item of this.qsa<HTMLDivElement>('.papers-list-item')) {
        item.classList.toggle('is-active', item.dataset.paperId === paperId);
      }
      // 填内容
      this.qs<HTMLDivElement>('[data-papers-drawer-title-zh]').textContent =
        p.title_zh || p.title || p.id;
      const titleEn = this.qs<HTMLDivElement>('[data-papers-drawer-title-en]');
      if (p.title && p.title !== (p.title_zh || '')) {
        titleEn.textContent = p.title;
        titleEn.hidden = false;
      } else {
        titleEn.hidden = true;
      }
      // 抽屉缩略图(first figure):有 url 就显示,否则整块隐藏
      const thumbWrap = this.qs<HTMLDivElement>('[data-papers-drawer-thumb]');
      const thumbImg = thumbWrap ? thumbWrap.querySelector('img') : null;
      if (p.thumbnail && thumbImg) {
        thumbImg.src = p.thumbnail;
        thumbWrap.hidden = false;
      } else if (thumbImg) {
        thumbImg.removeAttribute('src');
        thumbWrap.hidden = true;
      }
      this.qs<HTMLDivElement>('[data-papers-drawer-arxiv]').textContent =
        p.arxivId ? `arXiv: ${p.arxivId}` : '';
      this.qs<HTMLDivElement>('[data-papers-drawer-authors]').textContent =
        p.authors ? `作者: ${p.authors}` : '';
      this.qs<HTMLDivElement>('[data-papers-drawer-date]').textContent =
        p.date ? `日期: ${p.date}` : '';
      // TLDR:SSR payload 已包含 tldr 字段 — 直接从 papers 找。
      const tldrEl = this.qs<HTMLDivElement>('[data-papers-drawer-tldr]');
      const full = this.papers.find((x) => x.id === p.id) as (PaperListItemLite & { tldr?: string });
      tldrEl.textContent = (full && (full as { tldr?: string }).tldr) || p.title_zh || p.title || '—';
      // PDF
      const pdfLink = this.qs<HTMLAnchorElement>('[data-papers-drawer-pdf]');
      if (p.pdf) {
        pdfLink.href = p.pdf;
        pdfLink.hidden = false;
      } else {
        pdfLink.hidden = true;
      }
      // 加载用户标签
      this.drawerUserTags = p.arxivId ? getUserTags(p.arxivId) : [];
      this.renderUserTags();
    }

    private closeDrawer(): void {
      const drawer = this.qs<HTMLDivElement>('[data-papers-drawer]');
      drawer.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
      this.drawerPaperId = null;
      for (const item of this.qsa<HTMLDivElement>('.papers-list-item')) {
        item.classList.remove('is-active');
      }
    }

    private renderUserTags(): void {
      const root = this.qs<HTMLDivElement>('[data-papers-tag-list]');
      root.innerHTML = '';
      if (this.drawerUserTags.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'papers-tag-edit-empty';
        empty.textContent = '暂无用户标签 — 在下方添加';
        root.appendChild(empty);
        return;
      }
      for (const t of this.drawerUserTags) {
        const chip = document.createElement('span');
        chip.className = 'papers-tag-edit-chip';
        const kind = document.createElement('span');
        kind.className = 'papers-tag-edit-kind';
        kind.textContent = t.kind;
        chip.appendChild(kind);
        const label = document.createElement('span');
        label.textContent = t.label;
        chip.appendChild(label);
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'papers-tag-edit-remove';
        rm.setAttribute('aria-label', `删除 ${t.kind}:${t.label}`);
        rm.textContent = '×';
        rm.addEventListener('click', () => this.handleRemoveTag(t.kind, t.label));
        chip.appendChild(rm);
        root.appendChild(chip);
      }
    }

    private handleAddTag(): void {
      if (!this.drawerPaperId) return;
      const p = this.byId.get(this.drawerPaperId);
      if (!p || !p.arxivId) return;
      const kindIn = this.qs<HTMLInputElement>('[data-papers-tag-kind]');
      const labelIn = this.qs<HTMLInputElement>('[data-papers-tag-label]');
      const kind = kindIn.value.trim();
      const label = labelIn.value.trim();
      if (!kind || !label) return;
      const ok = addTag(p.arxivId, kind, label);
      if (ok) {
        this.drawerUserTags = getUserTags(p.arxivId);
        this.renderUserTags();
        kindIn.value = '';
        labelIn.value = '';
        this.flashSaved();
        // 异步推 Gist(失败 toast 提示,本地状态不变)
        this.maybePushTagsToGist();
      }
    }

    private handleRemoveTag(kind: string, label: string): void {
      if (!this.drawerPaperId) return;
      const p = this.byId.get(this.drawerPaperId);
      if (!p || !p.arxivId) return;
      const ok = removeTag(p.arxivId, kind, label);
      if (ok) {
        this.drawerUserTags = getUserTags(p.arxivId);
        this.renderUserTags();
        this.flashSaved();
        this.maybePushTagsToGist();
      }
    }

    private flashSaved(): void {
      const el = this.qs<HTMLSpanElement>('[data-papers-tag-saved]');
      el.hidden = false;
      window.setTimeout(() => { el.hidden = true; }, 1500);
    }

    private qs<T extends HTMLElement>(sel: string): T {
      const el = this.host.querySelector<T>(sel);
      if (!el) throw new Error(`missing ${sel}`);
      return el;
    }
    private qsa<T extends HTMLElement>(sel: string): T[] {
      return Array.from(this.host.querySelectorAll<T>(sel));
    }
  }

  // ---------- 启动 ----------
  function bootstrap(): void {
    const host = document.querySelector<HTMLElement>('[data-papers-library]');
    if (!host) return;
    const lib = new PaperLibrary(host);
    void lib.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // ---------- free helpers ----------
  /** 按 hits 顺序排命中项;未命中项按 date desc 兜底排到末尾。
   *  hits 为空时回退纯 substring filter(plan 兼容设计:语料拉不到时 UI 不要变空)。 */
  function orderedByRankedIds<T extends { canonicalArxivId?: string; arxivId: string; date?: string; title?: string; title_zh?: string; tldr?: string }>(
    prefiltered: T[],
    result: SearchResult,
    query: string,
  ): T[] {
    if (!result.hits.length) {
      // 0 命中 — substring fallback
      const q = (query || '').toLowerCase();
      if (!q) return prefiltered.slice().sort((a, b) => {
        const av = a.date ? new Date(a.date).getTime() : 0;
        const bv = b.date ? new Date(b.date).getTime() : 0;
        return bv - av;
      });
      return prefiltered
        .filter((p) =>
          ((p.title || '') + ' ' + (p.title_zh || '') + ' ' + (p.tldr || ''))
            .toLowerCase()
            .includes(q),
        )
        .sort((a, b) => {
          const av = a.date ? new Date(a.date).getTime() : 0;
          const bv = b.date ? new Date(b.date).getTime() : 0;
          return bv - av;
        });
    }
    const hitSet = new Set<T>();
    const ordered: T[] = [];
    for (const h of result.hits) {
      const p = prefiltered.find(
        (x) =>
          (x.canonicalArxivId && x.canonicalArxivId === h.canonicalId) ||
          canonicalArxivId(x.arxivId) === h.canonicalId,
      );
      if (p && !hitSet.has(p)) {
        ordered.push(p);
        hitSet.add(p);
      }
    }
    const rest = prefiltered
      .filter((p) => !hitSet.has(p))
      .slice()
      .sort((a, b) => {
        const av = a.date ? new Date(a.date).getTime() : 0;
        const bv = b.date ? new Date(b.date).getTime() : 0;
        return bv - av;
      });
    ordered.push(...rest);
    return ordered;
  }