// astro-src/scripts/paper-related.ts
//
// 论文详情页"内容相似论文"卡的客户端胶水(Stage 7)。
//
// 数据源 /paper-relations.json(由 build-search-corpus.mjs 在 prebuild 多产出),
// 形状:{ v, algorithm, ids: [...], edges: { srcIdx: [[tgtIdx, weight×1000, mask], ...] } }。
//
// 渲染规则:
//   - 按当前 paper 的 canonicalArxivId 找到它在 ids 里的下标。
//   - 读 edges[srcIdx],按 weight 降序取 ≤8 条。
//   - 写 8 个 <a href="/papers/<id>-<slug>/"> 项 + 简单的 meta(weight% + mask 标签)。
//
// 不依赖任何额外库 —— 30 行内联 fetch + DOM,符合 Stage 7 决策
// (不新建 scripts/paper-related.ts;这是计划里"内联 ~30 行"的实现)。

import { onDprUserLibraryChange } from '../lib/events';

const FETCH_TIMEOUT_MS = 8000;

interface RelationsArtifact {
  v: number;
  algorithm: string;
  ids: string[];
  edges: Record<string, Array<[number, number, number]>>;
}

let artifactCache: RelationsArtifact | null = null;
let artifactPromise: Promise<RelationsArtifact | null> | null = null;

async function fetchRelations(url: string): Promise<RelationsArtifact | null> {
  if (artifactCache) return artifactCache;
  if (artifactPromise) return artifactPromise;
  artifactPromise = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const data = (await res.json()) as RelationsArtifact;
      artifactCache = data;
      return data;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  return artifactPromise;
}

function maskLabel(mask: number): string {
  // 1=jaccard, 2=tfidf, 3=both
  if (mask === 3) return '分类+文本';
  if (mask === 1) return '分类相似';
  if (mask === 2) return '文本相似';
  return '相关';
}

function paperIdToSlug(id: string): string {
  // paper id 已经包含 "<arxiv>v<n>-<slug>" 形态;直接当作 href 即可。
  return id;
}

async function hydrateCard(host: HTMLElement): Promise<void> {
  const url = host.dataset.relationsUrl || '/paper-relations.json';
  const data = await fetchRelations(url);
  if (!data) return; // 静默:卡片不显示,主内容区不受影响
  const canonical = (host.dataset.canonicalArxivId || '').trim();
  if (!canonical) return;
  // paper id 形如 "papers/2026/06/04/2606.06087v1-latentskill",不带 canonical。
  // ids 也是同样的 paper id 形态 —— 用 canonical 匹配要扫一遍(610 个元素,
  // 不到 1 ms,不是问题)。
  let srcIdx = -1;
  for (let i = 0; i < data.ids.length; i++) {
    if (data.ids[i].includes(canonical)) {
      srcIdx = i;
      break;
    }
  }
  if (srcIdx < 0) return;
  const list = (data.edges[srcIdx] || []).slice().sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (list.length === 0) return;

  const ul = host.querySelector<HTMLUListElement>('[data-paper-related-list]');
  if (!ul) return;
  ul.innerHTML = '';
  for (const [tgtIdx, weightX1000, mask] of list) {
    const tgt = data.ids[tgtIdx];
    if (!tgt) continue;
    const li = document.createElement('li');
    li.className = 'paper-related-item';
    const a = document.createElement('a');
    a.href = `/papers/${paperIdToSlug(tgt)}/`;
    a.className = 'paper-related-link';
    a.textContent = tgt.split('/').pop() || tgt;
    const meta = document.createElement('span');
    meta.className = 'paper-related-meta-item';
    const pct = (weightX1000 / 10).toFixed(1);
    meta.textContent = `${maskLabel(mask)} · ${pct}%`;
    li.appendChild(a);
    li.appendChild(meta);
    ul.appendChild(li);
  }
  host.hidden = false;
}

function init(): void {
  const host = document.querySelector<HTMLElement>('#paper-related');
  if (!host) return;
  void hydrateCard(host);
  // 卡片内容跟用户态无关;不需要订阅 DPR_USER_LIBRARY_CHANGE。
  // 但保留 import 以避免 ts-check 死代码警告。
  void onDprUserLibraryChange;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}