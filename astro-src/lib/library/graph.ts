// astro-src/lib/library/graph.ts
//
// 文献库论文关系图(PR 阶段 4):基于 DPR 现有 paper-relations 模块
// (jaccard / tfidf / hybrid)算边权,渲染为轻量 SVG,无第三方依赖。
//
// 设计:
//   - 内层节点:库内 1-3 个核心概念(从概念频率统计取出)
//   - 外层节点:本库论文(节点半径 = sqrt(relevanceScore) * scale)
//   - 边:库内论文-论文(jaccard > 0.05 阈值)
//   - 边:论文-概念(共享该概念)
//   - 颜色:论文按 relatedness 着色(高=accent / 中=violet / 低=ok)

export interface GraphPaper {
  /** 唯一 id(用 canonicalArxivId) */
  id: string;
  title: string;
  /** 0-1 范围;undefined 时按 0.5 处理 */
  relevanceScore?: number;
  concepts: string[];
}

export interface GraphConcept {
  slug: string;
  displayName: string;
}

export interface GraphLayoutNode {
  id: string;
  kind: 'paper' | 'concept';
  x: number;
  y: number;
  r: number;
  color: string;
  label: string;
}

export interface GraphLayoutEdge {
  source: string;
  target: string;
  weight: number;
}

export interface GraphLayout {
  papers: GraphPaper[];
  concepts: GraphConcept[];
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  width: number;
  height: number;
}

export interface GraphOptions {
  width?: number;
  height?: number;
  maxPapers?: number;
  maxConcepts?: number;
  edgeThreshold?: number;
  innerRadiusRatio?: number;
  outerRadiusRatio?: number;
}

const DEFAULT_OPTIONS: Required<GraphOptions> = {
  width: 720,
  height: 480,
  maxPapers: 24,
  maxConcepts: 6,
  edgeThreshold: 0.05,
  innerRadiusRatio: 0.18,
  outerRadiusRatio: 0.42,
};

const COLOR_BY_RELEVANCE = [
  'var(--ok, #3f8f5f)',
  'var(--violet, #7263b0)',
  'var(--accent, #003f88)',
];

/**
 * 取相关度对应颜色档位(0-1 → 0/1/2)。
 */
function pickColor(score: number | undefined): string {
  const s = typeof score === 'number' && Number.isFinite(score) ? score : 0.5;
  if (s >= 0.75) return COLOR_BY_RELEVANCE[2];
  if (s >= 0.45) return COLOR_BY_RELEVANCE[1];
  return COLOR_BY_RELEVANCE[0];
}

/**
 * 计算两篇论文的概念 Jaccard 相似度。任一空 → 0。
 */
export function jaccard(a: GraphPaper, b: GraphPaper): number {
  if (!a.concepts.length || !b.concepts.length) return 0;
  const A = new Set(a.concepts);
  const B = new Set(b.concepts);
  let inter = 0;
  A.forEach((x) => { if (B.has(x)) inter += 1; });
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 简单布局:inner 环放核心概念,outer 环放论文。
 * 节点位置基于极坐标,论文按 relatedness 降序排。
 */
export function layoutGraph(
  papers: GraphPaper[],
  concepts: GraphConcept[],
  opts: GraphOptions = {},
): GraphLayout {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const cx = o.width / 2;
  const cy = o.height / 2;
  const innerR = Math.min(o.width, o.height) * o.innerRadiusRatio;
  const outerR = Math.min(o.width, o.height) * o.outerRadiusRatio;

  // 截断到最大数量
  const topPapers = [...papers]
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .slice(0, o.maxPapers);
  const topConcepts = concepts.slice(0, o.maxConcepts);

  const nodes: GraphLayoutNode[] = [];

  // 内环:核心概念
  topConcepts.forEach((c, i) => {
    const angle = (i / Math.max(1, topConcepts.length)) * Math.PI * 2;
    nodes.push({
      id: `con:${c.slug}`,
      kind: 'concept',
      x: cx + Math.cos(angle) * innerR,
      y: cy + Math.sin(angle) * innerR,
      r: 8,
      color: 'var(--ok, #3f8f5f)',
      label: c.displayName,
    });
  });

  // 外环:论文
  topPapers.forEach((p, i) => {
    const angle = (i / Math.max(1, topPapers.length)) * Math.PI * 2;
    const score = p.relevanceScore ?? 0.5;
    const r = 6 + Math.sqrt(score) * 14;
    nodes.push({
      id: `paper:${p.id}`,
      kind: 'paper',
      x: cx + Math.cos(angle) * outerR,
      y: cy + Math.sin(angle) * outerR,
      r,
      color: pickColor(score),
      label: p.title,
    });
  });

  // 边:论文-论文
  const edges: GraphLayoutEdge[] = [];
  for (let i = 0; i < topPapers.length; i += 1) {
    for (let j = i + 1; j < topPapers.length; j += 1) {
      const w = jaccard(topPapers[i], topPapers[j]);
      if (w >= o.edgeThreshold) {
        edges.push({
          source: `paper:${topPapers[i].id}`,
          target: `paper:${topPapers[j].id}`,
          weight: w,
        });
      }
    }
  }
  // 边:论文-概念(共享 slug)
  const conceptSlugSet = new Set(topConcepts.map((c) => c.slug));
  for (const p of topPapers) {
    for (const c of p.concepts) {
      if (!conceptSlugSet.has(c)) continue;
      edges.push({
        source: `paper:${p.id}`,
        target: `con:${c}`,
        weight: 0.4,
      });
    }
  }

  return {
    papers: topPapers,
    concepts: topConcepts,
    nodes,
    edges,
    width: o.width,
    height: o.height,
  };
}

/**
 * 把 layout 序列化为 SVG 字符串。无第三方依赖,纯 string concat。
 */
export function layoutToSvg(layout: GraphLayout, options: { ariaLabel?: string } = {}): string {
  const parts: string[] = [];
  parts.push(
    `<svg viewBox="0 0 ${layout.width} ${layout.height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeXml(options.ariaLabel || '论文关系图')}">`,
  );
  // 边
  const nodeMap = new Map(layout.nodes.map((n) => [n.id, n]));
  for (const e of layout.edges) {
    const s = nodeMap.get(e.source);
    const t = nodeMap.get(e.target);
    if (!s || !t) continue;
    const w = Math.max(0.5, Math.min(2, e.weight * 3));
    parts.push(
      `<line x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${t.x.toFixed(1)}" y2="${t.y.toFixed(1)}" stroke="var(--border-2, #cbd5e1)" stroke-width="${w.toFixed(2)}" opacity="0.7" />`,
    );
  }
  // 节点
  for (const n of layout.nodes) {
    const titleAttr = n.kind === 'paper'
      ? ` data-paper-id="${escapeXml(n.id.replace(/^paper:/, ''))}"`
      : '';
    parts.push(
      `<g class="graph-node graph-${n.kind}"${titleAttr}>`,
    );
    parts.push(
      `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r}" fill="${n.color}" stroke="white" stroke-width="1.5" />`,
    );
    if (n.kind === 'concept') {
      parts.push(
        `<text x="${(n.x + n.r + 4).toFixed(1)}" y="${(n.y + 4).toFixed(1)}" font-size="11" fill="var(--text, #111827)">${escapeXml(truncate(n.label, 18))}</text>`,
      );
    } else {
      // 论文节点 hover 提示(<title> + 简短标签)
      parts.push(`<title>${escapeXml(n.label)}</title>`);
    }
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

/**
 * 客户端入口:从 DOM 读 #wb-graph-svg-wrap 上下文,渲染 SVG。
 * 论文与概念数据从 window.__LIBRARY_GRAPH_DATA__ 读取([id].astro 注入)。
 */
export function mountGraphFromWindow(): boolean {
  const wrap = document.getElementById('wb-graph-svg-wrap');
  if (!wrap) return false;
  const data = (window as unknown as { __LIBRARY_GRAPH_DATA__?: { papers: GraphPaper[]; concepts: GraphConcept[] } }).__LIBRARY_GRAPH_DATA__;
  if (!data) {
    wrap.textContent = '图谱数据未注入(SSR 阶段失败)';
    return false;
  }
  const layout = layoutGraph(data.papers, data.concepts);
  wrap.innerHTML = layoutToSvg(layout, { ariaLabel: '论文关系图' });
  // 论文节点点击 → 切回 papers tab 并选中
  wrap.querySelectorAll<SVGElement>('g.graph-node.graph-paper').forEach((g) => {
    g.style.cursor = 'pointer';
    g.addEventListener('click', () => {
      const cx = g.getAttribute('data-paper-id');
      if (!cx) return;
      window.location.hash = '#papers';
      // 触发论文行选中 + 详情显示
      setTimeout(() => {
        const row = document.querySelector<HTMLElement>(`.wb-paper-row[data-paper-id="${cx}"]`);
        row?.click();
        row?.scrollIntoView({ block: 'center' });
      }, 50);
    });
  });
  return true;
}
