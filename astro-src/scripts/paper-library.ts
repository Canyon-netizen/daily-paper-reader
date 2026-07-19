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
  import { getGistToken, getGistId } from '../scripts/settings';
  import { showToast } from '../scripts/toast';

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
    // 可选:SSR 嵌入的轻量 tldr(若空,drawer 打开时再单独请求)
    tldr?: string;
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
      this.refreshFilter();
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
      this.refreshFilter();
    }

    // ---------- 搜索 + 过滤 ----------
    private bindUI(): void {
      const search = this.qs<HTMLInputElement>('[data-papers-search]');
      let timer: number | undefined;
      search.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          this.filterText = search.value.trim().toLowerCase();
          this.refreshFilter();
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
    }

    private refreshFilter(): void {
      const q = this.filterText;
      const tag = this.filterTag;
      this.filtered = this.papers.filter((p) => {
        if (tag) {
          const tags = p.tags || [];
          if (!tags.includes(tag)) return false;
        }
        if (q) {
          const hay = [
            p.title || '',
            p.title_zh || '',
            p.tldr || '',
          ].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      const meta = this.qs<HTMLDivElement>('[data-papers-toolbar-meta]');
      const today = todayString();
      const todayCount = this.filtered.filter((p) => p.date === today).length;
      meta.textContent = `共 ${this.filtered.length} / ${this.papers.length} 篇 · 今日 ${todayCount}`;
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
        node.addEventListener('click', () => this.openDrawer(p.id));
        spacer.appendChild(node);

        // 测量实际高度用于下一次渲染
        const measured = node.offsetHeight;
        if (measured > 0 && Math.abs(measured - (this.rowHeights.get(i) ?? ROW_ESTIMATE)) > 4) {
          this.rowHeights.set(i, measured);
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