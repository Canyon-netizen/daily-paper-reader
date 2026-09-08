// astro-src/scripts/paper-concepts.ts
//
// 论文详情页: 从 /wiki/concepts/_graph.json 拉本论文关联的概念节点,
// 渲染为 chip 标签。每个 chip 链接到 /wiki/concepts/<slug>/ 详情页。
//
// 设计:
// - 一次性 fetch + 浏览器缓存;多次访问不同论文页复用同一份 graph
// - 仅当 ≥1 个 concept 关联时显示整行 (data-paper-concepts hidden 控制)
// - chip 复用 .tag 样式,新加 .tag-concept 改色 (橙红,与现有 4 维 tag 区分)

let graphCache: { nodes: Array<{ id: string; label?: string; kind?: string }>; edges: Array<{ source?: string; target?: string; kind?: string }> } | null = null;
let graphLoading: Promise<typeof graphCache> | null = null;

async function loadGraph() {
  if (graphCache) return graphCache;
  if (graphLoading) return graphLoading;
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  graphLoading = fetch(`${base}/wiki/concepts/_graph.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((g) => {
      graphCache = g;
      return graphCache;
    })
    .catch(() => null);
  return graphLoading;
}

/** 复用 pages/concepts.astro 的清洗规则 (单一来源 hard to maintain cross-file,
 *  这里 inline 一份等价简化版:只处理 > 50 + ':' 的论文标题污染,够用) */
function cleanLabel(raw: string): string {
  let s = (raw || '').trim();
  if (!s) return s;
  if (s.length > 50 && s.includes(':')) {
    s = s.split(':')[0].trim();
  }
  return s;
}

async function mountPaperConcepts(root: HTMLElement) {
  const arxivId = (root.dataset.paperArxivId || '').trim();
  if (!arxivId) return;

  const chipsEl = root.querySelector<HTMLElement>('.meta-concepts-chips');
  if (!chipsEl) return;

  const graph = await loadGraph();
  if (!graph) return;

  const conceptIds = new Set(
    graph.nodes.filter((n) => n.kind === 'concept').map((n) => n.id),
  );
  const labelById = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.kind === 'concept') labelById.set(n.id, n.label || n.id);
  }

  // edge.source 形如 'papers/<arxivId>vN-<slug>' 或 'papers/<arxivId>-<slug>'
  // 或单纯 arxivId。canonicalArxivId 不带 vN,所以需要兼容 vN 后缀。
  const matchSource = (src: string): boolean => {
    if (!src) return false;
    if (src === arxivId) return true;
    if (src.startsWith(`papers/${arxivId}-`) || src.startsWith(`papers/${arxivId}v`)) return true;
    return false;
  };
  const targets = graph.edges
    .filter((e) => matchSource(e.source || '') && !!e.target && conceptIds.has(e.target as string))
    .map((e) => e.target as string);

  if (targets.length === 0) return;

  // 去重保序
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const t of targets) {
    if (!seen.has(t)) {
      seen.add(t);
      unique.push(t);
    }
  }

  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  chipsEl.innerHTML = unique
    .slice(0, 20) // 最多 20 个
    .map((id) => {
      const label = cleanLabel(labelById.get(id) || id);
      return `<a class="tag tag-concept" href="${base}/wiki/concepts/${encodeURIComponent(id)}/" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
    })
    .join('');
  root.hidden = false;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function init() {
  document
    .querySelectorAll<HTMLElement>('[data-paper-concepts]')
    .forEach(mountPaperConcepts);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
