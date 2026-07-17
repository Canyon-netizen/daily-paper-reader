  // ============================================================================
  // PaperLibrary 客户端逻辑
  // ============================================================================
  // 数据源:由 SSR 端把 papers 序列化为 JSON,挂到 #papers-data 节点
  //        (避开在注释里直接写 script 字面量,以免 HTML parser 提前闭合本块)。
  // 依赖:lib/paper-relations(computeRelations) — 计算节点边。
  //       lib/user-tags — 读写用户标签。
  // 渲染目标:.papers-library-host 内的 DOM。
  // ============================================================================

  import {
    computeRelations,
    type ComputeOptions,
    type RelationNode,
    type RelationEdge,
  } from '../lib/paper-relations';
  import {
    getUserTags,
    addTag,
    removeTag,
    flattenUserTags,
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
  // categories 4-dim 调色板 — 与 astro-src/pages/papers/[arxiv].astro 的
  // .tag-<dim> CSS class 共享色值。`default` 表示 user-prefix 或纯 label(没冒号)。
  const TAG_KIND_PALETTE: Record<string, string> = {
    venue: '#b31b1b',
    task: '#1d4ed8',
    method: '#9333ea',
    type: '#0891b2',
    user: '#6b7280',
    default: '#6b7280',
  };
  const EDGE_COLOR: Record<string, string> = {
    jaccard: '#b31b1b',
    tfidf: '#1d4ed8',
    embedding: '#9333ea',
    hybrid: '#6b7280',
  };
  const ROW_ESTIMATE = 120; // 列表项估计平均高度,实际渲染后再校准

  // ---------- 工具 ----------
  function stripQueryPrefix(tag: string): string {
    const i = tag.indexOf(':');
    return i > 0 ? tag.slice(i + 1) : tag;
  }
  function tagKindOf(tag: string): string {
    const i = tag.indexOf(':');
    return i > 0 ? tag.slice(0, i).toLowerCase() : 'default';
  }
  function pickPrimaryTag(flatTags: string[]): string {
    // 跳过 venue:— venue 在卡片上已有 chip 表达,主 tag 优先让用户看到"任务"。
    for (const t of flatTags || []) {
      if (t.startsWith('task:')) return t;
    }
    for (const t of flatTags || []) {
      if (t.startsWith('method:')) return t;
    }
    for (const t of flatTags || []) {
      if (t.startsWith('type:')) return t;
    }
    return flatTags && flatTags[0] ? flatTags[0] : '';
  }
  function tagColor(tag: string): string {
    return TAG_KIND_PALETTE[tagKindOf(tag)] || TAG_KIND_PALETTE.default;
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
    private cy: unknown = null;        // cytoscape.Core
    private cytoscapeMod: unknown = null;
    private algoKind: 'jaccard' | 'tfidf' | 'hybrid' = 'jaccard';
    private drawerPaperId: string | null = null;
    private drawerUserTags: UserTag[] = [];
    private rowHeights = new Map<number, number>(); // index -> measured height
    // 点云力导向:每帧对所有边算胡克回复力 + 锚点对 1-hop/2-hop 邻居的涟漪推力。
    // 不用 layout 重跑、不用 node.lock(lock 会让 grabbable()=false,破坏 cytoscape
    // 内部 drag 状态机 — 用户之前反馈"拖动不了"就是这个原因)。
    private dragState: {
      anchorId: string;
      // 抓取瞬间每条边的两端初始相对向量(松手后整图要弹回这个拓扑)。
      edgeRestVectors: Array<{ a: string; b: string; dx: number; dy: number; len: number }>;
      rafId: number | null;
    } | null = null;
    private settleRafId: number | null = null;

    constructor(host: HTMLElement) {
      this.host = host;
    }

    async init(): Promise<void> {
      const data = loadPapersData();
      if (!data || !Array.isArray(data.papers)) {
        this.setGraphLoadingText('数据加载失败');
        return;
      }
      this.papers = data.papers;
      this.byId = new Map(this.papers.map((p) => [p.id, p]));
      this.buildTagFilter();
      this.bindUI();
      this.refreshFilter();
      // 启动时尝试从 Gist 拉一次用户标签(若 token + gistId 都配齐);
      // 远端合并到本地 union 去重 — 失败静默,本地状态不变。
      // 这步在渲染图前并行做,不等它返回(网络慢也不阻塞首屏)。
      this.maybePullTagsFromGist();
      // 异步加载 cytoscape + 计算图
      await this.loadAndRenderGraph();
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
      // 算法切换
      for (const btn of this.qsa<HTMLButtonElement>('[data-papers-algorithm]')) {
        btn.addEventListener('click', () => {
          const k = btn.dataset.papersAlgorithm as 'jaccard' | 'tfidf' | 'hybrid';
          if (!k || k === this.algoKind) return;
          for (const b of this.qsa<HTMLButtonElement>('[data-papers-algorithm]')) {
            b.classList.toggle('is-active', b.dataset.papersAlgorithm === k);
          }
          this.algoKind = k;
          void this.recomputeAndRender();
        });
      }
      this.qs<HTMLButtonElement>('[data-papers-graph-fit]')
        .addEventListener('click', () => this.fitGraph());
      // 列表 viewport 滚动 → 触发虚拟滚动重算
      const viewport = this.qs<HTMLDivElement>('[data-papers-viewport]');
      viewport.addEventListener('scroll', () => this.renderVisibleRows());
      // 主题变化时 cytoscape 重绘样式
      window.addEventListener('storage', (e) => {
        if (e.key === 'dpr_theme_v1') this.applyCytoscapeTheme();
      });
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

        node.addEventListener('mouseenter', () => this.highlightNode(p.id, true));
        node.addEventListener('mouseleave', () => this.highlightNode(p.id, false));
        node.addEventListener('click', () => this.openDrawer(p.id));
        spacer.appendChild(node);

        // 测量实际高度用于下一次渲染
        const measured = node.offsetHeight;
        if (measured > 0 && Math.abs(measured - (this.rowHeights.get(i) ?? ROW_ESTIMATE)) > 4) {
          this.rowHeights.set(i, measured);
        }
      }
    }

    // ---------- 节点高亮 ----------
    private highlightNode(paperId: string, on: boolean): void {
      const cy = this.cy as { elements: (sel: string) => { addClass: (c: string) => void; removeClass: (c: string) => void } } | null;
      if (!cy) return;
      const sel = `node[id = "${cssEscape(paperId)}"]`;
      const el = cy.elements(sel);
      if (on) el.addClass('is-hover');
      else el.removeClass('is-hover');
      // 列表项视觉同步
      for (const item of this.qsa<HTMLDivElement>('.papers-list-item')) {
        item.classList.toggle('is-hover', on && item.dataset.paperId === paperId);
      }
    }

    // ---------- 图谱加载 ----------
    private async loadAndRenderGraph(): Promise<void> {
      try {
        this.setGraphLoadingText('加载 cytoscape.js…');
        // cytoscape 是 dependencies 里的常驻依赖 — 静态 import 让 Vite 把它打进
        // 当前页面的 chunk(分块懒加载:仅在 /papers/ 这条路由下被请求)。
        // 之前用的 /* @vite-ignore */ + 变量 specifier 写法会被原样传到运行时,
        // 浏览器对裸模块名 'cytoscape' 没有解析机制 → 直接 reject 进入 catch,
        // 现象就是右侧一直停留在 "cytoscape.js 加载失败" 的 loading 态。
        // cytoscape ESM 入口 (dist/cytoscape.esm.mjs) 是 `export { cytoscape as default }`,
        // 所以 Vite 拿到的 namespace 是 { default: cytoscape },函数本体在 .default 上 —
        // 直接当函数调用会报 "cyMod is not a function"。这里 unwrap 一下,
        // 对 CJS 互操作形态 (.default === mod) 也兼容。
        const cytoscapeNs = await import('cytoscape');
        this.cytoscapeMod = (cytoscapeNs as unknown as { default: unknown }).default ?? cytoscapeNs;
        await this.recomputeAndRender();
      } catch (e) {
        console.error('[PaperLibrary] 节点网络加载失败:', e);
        this.setGraphLoadingText(
          `节点网络加载失败:${e instanceof Error ? e.message : String(e)}`
        );
        this.hideGraphLoading();
      }
    }

    private async recomputeAndRender(): Promise<void> {
      this.cancelDragAndSettle();
      this.setGraphLoadingText('计算节点网络…');
      const opts: ComputeOptions = {
        algorithm: this.algoKind,
        topK: 6,
        minWeight: 0.05,
      };
      let result;
      try {
        result = await computeRelations(this.papers as never[], opts);
      } catch (e) {
        console.error('[PaperLibrary] computeRelations 失败:', e);
        this.setGraphLoadingText('节点网络计算失败');
        return;
      }
      try {
        this.renderGraph(result.nodes, result.edges);
      } catch (e) {
        console.error('[PaperLibrary] renderGraph 失败:', e);
        this.setGraphLoadingText(
          `节点网络渲染失败:${e instanceof Error ? e.message : String(e)}`
        );
        this.hideGraphLoading();
        return;
      }
    }

    private renderGraph(nodes: RelationNode[], edges: RelationEdge[]): void {
      // cytoscape 是可选依赖(运行期 dynamic import),这里 loose-typing 即可。
      const cyMod = this.cytoscapeMod as unknown | null;
      if (!cyMod) return;
      // 折叠多余空边和单节点优化:数据集大时,cytoscape 在 layout 阶段会卡,这里手动限制
      const elements = [
        ...nodes.map((n) => ({
          data: {
            id: n.id,
            label: (n.title || '').slice(0, 60),
            title: n.title,
            tags: n.tags,
            // primaryTag:从 task 起挑第一个(任务/方法/类型),venue 略过(venue
            // 在卡片角落的 venue-chip 已表达);若无 task/method/type 则取第一项。
            primaryTag: pickPrimaryTag(n.tags),
          },
        })),
        ...edges.map((e, idx) => ({
          data: {
            id: `e${idx}`,
            source: e.source,
            target: e.target,
            weight: e.weight,
            type: e.type,
            sharedTags: e.sharedTags,
          },
        })),
      ];
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const fg = isDark ? '#e6edf3' : '#1a1a1a';
      const edgeBase = isDark ? '#484f58' : '#d1d5db';
      // cytoscape 是可选依赖,运行期 dynamic import — 这里 loose-typing 避免连锁 TS 报错。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (cyMod as any)({
        container: this.qs<HTMLDivElement>('#cy'),
        elements,
        wheelSensitivity: 0.25,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': (ele: { data: (k: string) => unknown }) =>
                tagColor(String(ele.data('primaryTag') || '')),
              'label': 'data(label)',
              'font-size': '9px',
              'color': fg,
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 4,
              'text-wrap': 'ellipsis',
              'text-max-width': '80px',
              'width': 14,
              'height': 14,
              'border-width': 1,
              'border-color': isDark ? '#30363d' : '#ffffff',
              'opacity': 0.9,
            },
          },
          {
            selector: 'node.is-hover',
            style: {
              'border-width': 3,
              'border-color': '#ff6b35',
              'width': 22,
              'height': 22,
              'opacity': 1,
              'z-index': 10,
            },
          },
          {
            selector: 'node.is-active',
            style: {
              'border-width': 3,
              'border-color': '#ff6b35',
              'width': 20,
              'height': 20,
              'z-index': 9,
            },
          },
          {
            selector: 'node.is-dragging',
            style: {
              'border-width': 3,
              'border-color': '#ff6b35',
              'width': 22,
              'height': 22,
              'opacity': 1,
              'z-index': 11,
            },
          },
          {
            selector: 'node.is-neighbor',
            style: {
              'border-width': 2,
              'border-color': '#ff6b35',
              'opacity': 1,
              'z-index': 8,
            },
          },
          {
            selector: 'node.dim',
            style: { 'opacity': 0.15 },
          },
          {
            selector: 'edge',
            style: {
              'curve-style': 'straight',
              'line-color': edgeBase,
              'width': (ele: { data: (k: string) => unknown }) =>
                Math.max(1, Math.min(4, Number(ele.data('weight') || 0) * 4)),
              'opacity': 0.55,
              'target-arrow-shape': 'none',
            },
          },
          {
            selector: 'edge.jaccard',
            style: { 'line-color': EDGE_COLOR.jaccard },
          },
          {
            selector: 'edge.tfidf',
            style: { 'line-color': EDGE_COLOR.tfidf },
          },
          {
            selector: 'edge.embedding',
            style: { 'line-color': EDGE_COLOR.embedding },
          },
          {
            selector: 'edge.hybrid',
            style: { 'line-color': EDGE_COLOR.hybrid },
          },
          {
            selector: 'edge.dim',
            style: { 'opacity': 0.05 },
          },
          {
            selector: 'edge.highlight',
            style: { 'opacity': 0.95, 'z-index': 5 },
          },
        ],
        layout: {
          name: 'cose',
          animate: false,
          padding: 30,
          nodeRepulsion: () => 6000,
          idealEdgeLength: () => 70,
          gravity: 0.25,
          numIter: 1500,
          fit: true,
          randomize: true,
        } as never,
      });
      // 节点点击 → 打开抽屉
      cy.on('tap', 'node', (evt: { target: { id: () => string } }) => {
        this.openDrawer(evt.target.id());
      });
      // 节点 hover → 同步高亮列表
      cy.on('mouseover', 'node', (evt: { target: { id: () => string } }) => {
        this.highlightListItem(evt.target.id(), true);
      });
      cy.on('mouseout', 'node', (evt: { target: { id: () => string } }) => {
        this.highlightListItem(evt.target.id(), false);
      });

      // 点云力导向(整图手动算位移,不依赖 layout 重跑 / node.lock):
      //   - grab       记下每条边的两端初始相对向量 + 给所有节点打 __origPos,
      //                加高亮;不 lock(lock 会让 grabbable()=false,破坏 drag 状态机)。
      //   - drag       rAF-throttled 调用 applyForceSimulation(),
      //                对每条边算胡克回复力 + 锚点对 1-hop/2-hop 邻居的主动推力
      //                (涟漪效应:拖一个点,1-hop 跟着被推,2-hop 跟着 1-hop 走,远端靠弹簧拉动)。
      //   - dragfree   启动 rAF 弹簧衰减,整图弹回初始拓扑,清高亮。
      // 目标节点类型 cytoscape 没暴露完整类型,这里用 any 处理。
      /* eslint-disable @typescript-eslint/no-explicit-any */
      cy.on('grab', 'node', (evt: { target: any }) => {
        const node = evt.target;
        const pos = node.position();
        // 抓取时记下每条边的两端初始相对向量 — 松手后整图用胡克力弹回这个拓扑。
        // 同时给所有节点打 __origPos 标记(给锚点主动推力做"原位"参考)。
        const edgeRestVectors: Array<{ a: string; b: string; dx: number; dy: number; len: number }> = [];
        cy.edges().forEach((e: { source: () => { id: () => string; position: () => { x: number; y: number } }; target: () => { id: () => string; position: () => { x: number; y: number } } }) => {
          const a = e.source();
          const b = e.target();
          const pa = a.position();
          const pb = b.position();
          edgeRestVectors.push({ a: a.id(), b: b.id(), dx: pb.x - pa.x, dy: pb.y - pa.y, len: Math.hypot(pb.x - pa.x, pb.y - pa.y) });
        });
        cy.nodes().forEach((n: { id: () => string; position: () => { x: number; y: number }; data: (k: string, v?: unknown) => unknown }) => {
          const p = n.position();
          n.data('__origPos', { x: p.x, y: p.y });
        });
        this.dragState = {
          anchorId: node.id(),
          edgeRestVectors,
          rafId: null,
        };
        node.addClass('is-dragging');
        node.neighborhood().addClass('is-neighbor');
      });
      cy.on('drag', 'node', () => {
        if (!this.dragState) return;
        if (this.dragState.rafId !== null) return;        // rAF-throttle:每帧最多一次
        this.dragState.rafId = requestAnimationFrame(() => {
          if (!this.dragState) return;
          this.dragState.rafId = null;
          this.applyForceSimulation();
        });
      });
      cy.on('dragfree', 'node', (evt: { target: any }) => {
        const node = evt.target;
        node.removeClass('is-dragging');
        node.neighborhood().removeClass('is-neighbor');
        // 启动 rAF 弹簧衰减:整图用胡克力弹回初始拓扑。
        this.runSettleFrames();
      });
      /* eslint-enable @typescript-eslint/no-explicit-any */
      this.cy = cy;
      this.hideGraphLoading();
      this.updateGraphMeta(edges.length, nodes.length);
      this.renderLegend();
    }

    private renderLegend(): void {
      const root = this.qs<HTMLDivElement>('[data-papers-graph-legend]');
      root.hidden = false;
      root.innerHTML = '';
      const label = document.createElement('div');
      label.style.fontWeight = '700';
      label.style.fontSize = '0.7rem';
      label.style.letterSpacing = '0.04em';
      label.style.textTransform = 'uppercase';
      label.textContent = '节点(主 tag)';
      root.appendChild(label);
      for (const [kind, color] of Object.entries(TAG_KIND_PALETTE)) {
        const row = document.createElement('div');
        row.className = 'papers-graph-legend-row';
        const dot = document.createElement('span');
        dot.className = 'papers-graph-legend-dot';
        dot.style.background = color;
        row.appendChild(dot);
        const txt = document.createElement('span');
        txt.textContent = kind === 'default' ? '其他' : kind;
        row.appendChild(txt);
        root.appendChild(row);
      }
    }

    private updateGraphMeta(edgeCount: number, nodeCount: number): void {
      const meta = this.qs<HTMLDivElement>('[data-papers-graph-meta]');
      meta.textContent = `${nodeCount} 节点 / ${edgeCount} 边 · ${this.algoKind}`;
    }

    private applyCytoscapeTheme(): void {
      // 主题切换:重渲图(简化:重新跑一次 compute + render)
      void this.recomputeAndRender();
    }

    private highlightListItem(paperId: string, on: boolean): void {
      for (const item of this.qsa<HTMLDivElement>('.papers-list-item')) {
        if (item.dataset.paperId === paperId) {
          item.classList.toggle('is-hover', on);
        }
      }
    }

    private fitGraph(): void {
      const cy = this.cy as { fit: (p?: unknown, padding?: number) => void } | null;
      if (!cy) return;
      this.cancelDragAndSettle();
      cy.fit(undefined, 30);
    }

    // ---------- 点云力导向:整图弹簧 + 锚点主动推力 ----------
    /** 胡克弹簧理想边长 — 节点间最终静止距离大致这个值。 */
    private static readonly IDEAL_EDGE_LEN = 70;
    /** 弹簧刚度 — 每帧把两端拉回/推到 IDEAL_EDGE_LEN 的比例。 */
    private static readonly SPRING_K = 0.06;
    /** 阻尼 — 防止松手后图来回震荡。 */
    private static readonly DAMPING = 0.78;
    /** 锚点对 1-hop 邻居的主动推力(每帧把邻居往外推一段距离)。 */
    private static readonly ANCHOR_PUSH_1HOP = 12;
    /** 1-hop 邻居把"推力"再传递给 2-hop 邻居的衰减系数 — 让拖动有"涟漪感"。 */
    private static readonly ANCHOR_PUSH_2HOP = 0.35;
    /** 锚点推力的最大有效距离(像素) — 远端节点不受主动推力影响,只受弹簧拉动。 */
    private static readonly PUSH_RADIUS = 260;
    /** dragfree 后 rAF 弹簧衰减的总帧数 ≈ 500ms @ 60fps。 */
    private static readonly SETTLE_FRAMES = 30;

    /**
     * drag 期间每帧:对每条边算胡克回复力(把两端拉回理想距离),
     * 再叠加被拖节点对 1-hop/2-hop 邻居的主动推力(涟漪效应)。
     * cytoscape 自带 drag handler 已经把被拖节点本身移到鼠标位置,
     * 这里只接管其他所有节点。
     */
    private applyForceSimulation(): void {
      const state = this.dragState;
      if (!state) return;
      // cytoscape Core 没有完整类型 — 用 any 透传,和 renderGraph 里的风格保持一致。
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const cy = this.cy as any;
      if (!cy) return;
      const anchor = cy.getElementById(state.anchorId);
      const anchorPos = anchor.position();

      // 1) 弹簧回复:遍历所有边,对每条边两端施加胡克力。
      //    远端节点虽然不直接受锚点推力,但被它们的邻居拉一把,自然就跟着动了。
      state.edgeRestVectors.forEach((e: { a: string; b: string; dx: number; dy: number; len: number }) => {
        const na = cy.getElementById(e.a);
        const nb = cy.getElementById(e.b);
        if (!na || na.empty() || !nb || nb.empty()) return;
        const pa = na.position();
        const pb = nb.position();
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const displacement = dist - PaperLibrary.IDEAL_EDGE_LEN;
        // 力的方向 = 从 a 指向 b;正值表示两端太远(要拉近)。
        const fx = (dx / dist) * displacement * PaperLibrary.SPRING_K;
        const fy = (dy / dist) * displacement * PaperLibrary.SPRING_K;
        // a 或 b 可能是被拖节点 — 它被 cytoscape 锁在鼠标位置,跳过。
        if (e.a !== state.anchorId) na.position({ x: pa.x + fx, y: pa.y + fy });
        if (e.b !== state.anchorId) nb.position({ x: pb.x - fx, y: pb.y - fy });
      });

      // 2) 锚点主动推力(涟漪):1-hop 邻居被锚点推开,2-hop 邻居被 1-hop 间接推开。
      //    用 __origPos 算"原位"避免反馈循环。
      const pushed: Map<string, { x: number; y: number }> = new Map();
      anchor.neighborhood().nodes().forEach((n: any) => {
        const np = n.position();
        const orig = n.data('__origPos') as { x: number; y: number } | undefined;
        if (!orig) return;
        const ox = np.x - orig.x;
        const oy = np.y - orig.y;
        const curOffset = Math.hypot(ox, oy);
        if (curOffset < 0.5) return;  // 没动就别推了,避免原地抖动
        const ux = ox / curOffset;
        const uy = oy / curOffset;
        const force = Math.min(curOffset * 0.4, PaperLibrary.ANCHOR_PUSH_1HOP);
        pushed.set(n.id(), { x: ux * force, y: uy * force });
      });
      // 1-hop 应用推力
      pushed.forEach((force, nid) => {
        const n = cy.getElementById(nid);
        if (!n || n.empty() || nid === state.anchorId) return;
        const p = n.position();
        n.position({ x: p.x + force.x, y: p.y + force.y });
      });
      // 2-hop 邻居:从 1-hop 推力方向继承一份
      anchor.neighborhood().nodes().forEach((oneHop: any) => {
        const f1 = pushed.get(oneHop.id());
        if (!f1) return;
        oneHop.neighborhood().nodes().forEach((twoHop: any) => {
          if (twoHop.id() === state.anchorId) return;
          if (pushed.has(twoHop.id())) return;  // 跳过 1-hop
          const orig = twoHop.data('__origPos') as { x: number; y: number } | undefined;
          if (!orig) return;
          const cur = twoHop.position();
          const distFromOrig = Math.hypot(cur.x - orig.x, cur.y - orig.y);
          if (distFromOrig > PaperLibrary.PUSH_RADIUS) return;
          const f2 = { x: f1.x * PaperLibrary.ANCHOR_PUSH_2HOP, y: f1.y * PaperLibrary.ANCHOR_PUSH_2HOP };
          twoHop.position({ x: cur.x + f2.x, y: cur.y + f2.y });
        });
      });
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }

    /**
     * dragfree 后:对每条边用胡克力把两端拉回初始相对位置。
     * 没有锚点主动推力,纯弹簧回平衡 — 体感是"松手后整张图微微一抖回到拓扑"。
     */
    private runSettleFrames(): void {
      if (this.settleRafId !== null) cancelAnimationFrame(this.settleRafId);
      const state = this.dragState;
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const cy = this.cy as any;
      if (!state || !cy) {
        this.dragState = null;
        return;
      }
      // 截快照:每条边的"当前两端位置"+"目标 = 初始相对向量"。
      type Snap = { curA: { x: number; y: number }; curB: { x: number; y: number }; restDx: number; restDy: number };
      const snaps: Array<{ a: string; b: string; s: Snap }> = [];
      state.edgeRestVectors.forEach((e) => {
        const na = cy.getElementById(e.a);
        const nb = cy.getElementById(e.b);
        if (!na || na.empty() || !nb || nb.empty()) return;
        const pa = na.position();
        const pb = nb.position();
        // rest 终态:以 a 当前位置为基准,加上初始两端向量 = b 的目标位置
        snaps.push({ a: e.a, b: e.b, s: { curA: { x: pa.x, y: pa.y }, curB: { x: pb.x, y: pb.y }, restDx: e.dx, restDy: e.dy } });
      });
      this.dragState = null;
      let framesLeft = PaperLibrary.SETTLE_FRAMES;
      const tick = (): void => {
        if (framesLeft <= 0) {
          // 最后一帧 snap 到精确目标 — 避免浮点漂移。
          snaps.forEach(({ a, b, s }) => {
            const na = cy.getElementById(a);
            const nb = cy.getElementById(b);
            if (na && !na.empty()) na.position({ x: s.curA.x, y: s.curA.y });
            if (nb && !nb.empty()) nb.position({ x: s.curA.x + s.restDx, y: s.curA.y + s.restDy });
          });
          this.settleRafId = null;
          return;
        }
        const k = 1 - PaperLibrary.DAMPING;
        snaps.forEach(({ a, b, s }) => {
          // b 的目标 = curA + (restDx, restDy);b 当前 = curB
          const goalBx = s.curA.x + s.restDx;
          const goalBy = s.curA.y + s.restDy;
          const stepBx = (goalBx - s.curB.x) * k;
          const stepBy = (goalBy - s.curB.y) * k;
          s.curB.x += stepBx;
          s.curB.y += stepBy;
          // a 也做对称收敛(防止一端固定导致弹簧只动一端)
          const stepAx = (s.curB.x - s.restDx - s.curA.x) * k * 0.5;
          const stepAy = (s.curB.y - s.restDy - s.curA.y) * k * 0.5;
          s.curA.x += stepAx;
          s.curA.y += stepAy;
          const na = cy.getElementById(a);
          const nb = cy.getElementById(b);
          if (na && !na.empty()) na.position({ x: s.curA.x, y: s.curA.y });
          if (nb && !nb.empty()) nb.position({ x: s.curB.x, y: s.curB.y });
        });
        framesLeft--;
        this.settleRafId = requestAnimationFrame(tick);
      };
      this.settleRafId = requestAnimationFrame(tick);
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }

    /**
     * 取消拖拽中 / 弹簧衰减中的状态:切换算法 / 主题 / fit 时调用,防残留 rAF。
     * 节点位置不重置(交给重新渲染的 renderGraph 用 init layout 重新布)。
     */
    private cancelDragAndSettle(): void {
      if (this.dragState && this.dragState.rafId !== null) {
        cancelAnimationFrame(this.dragState.rafId);
      }
      this.dragState = null;
      if (this.settleRafId !== null) {
        cancelAnimationFrame(this.settleRafId);
        this.settleRafId = null;
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
      // 图节点 active
      const cy = this.cy as { elements: (sel: string) => { addClass: (c: string) => void; removeClass: (c: string) => void } } | null;
      if (cy) {
        cy.elements('node').removeClass('is-active');
        cy.elements(`node[id = "${cssEscape(paperId)}"]`).addClass('is-active');
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
      // TLDR 需要单独请求(SSR payload 只包含轻量列表项,不包含 tldr/abstract)
      // 但 frontmatter 已经包含 tldr 字段 — 在 SSR 时一并嵌入。
      const tldrEl = this.qs<HTMLDivElement>('[data-papers-drawer-tldr]');
      // 从 payload 里找
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
      const cy = this.cy as { elements: (sel: string) => { removeClass: (c: string) => void } } | null;
      if (cy) cy.elements('node').removeClass('is-active');
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

    // ---------- 杂项 ----------
    private setGraphLoadingText(text: string): void {
      const t = this.qs<HTMLDivElement>('[data-papers-graph-loading-text]');
      if (t) t.textContent = text;
    }
    private hideGraphLoading(): void {
      const el = this.qs<HTMLDivElement>('[data-papers-graph-loading]');
      if (el) el.style.display = 'none';
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

  // ---------- CSS selector escape (paper id 可能含 [ 等特殊字符) ----------
  function cssEscape(s: string): string {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
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
