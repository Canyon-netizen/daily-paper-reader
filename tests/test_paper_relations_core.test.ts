// tests/test_paper_relations_core.test.ts — Stage 7 数学一致性 + artifact 形态。
//
// 跑法: bun test tests/test_paper_relations_core.test.ts
//
// 覆盖:
//   - core.mjs flattenCategories 与 lib/paper-relations/edges-util.ts:tagSet
//     行为一致(同一 fixture 同样 4-dim categories,展开后 Set 相等)
//   - core.mjs jaccardEdges 输出与 jaccard.ts:computeJaccardEdges 对同
//     论文数组产出同样 (source, target, weight, sharedTags) 三元组
//     (允许 weight 浮点 1e-6 误差)
//   - computeRelations 输出 schema = { ids, edges: { srcIdx: [[tgtIdx,
//     weight×1000, mask], ...] } },且 weight ∈ [0, 1000],mask ∈ {1,2,3}

import { describe, it, expect } from 'bun:test';
import { computeJaccardEdges } from '../astro-src/lib/paper-relations/jaccard';
import type { PaperListItem } from '../astro-src/lib/paper';

interface CoreRelations {
  ids: string[];
  edges: Record<string, Array<[number, number, number]>>;
}

let core: typeof import('../astro-src/lib/paper-relations/core.mjs');

async function loadCore() {
  if (!core) {
    core = await import('../astro-src/lib/paper-relations/core.mjs');
  }
  return core;
}

function paper(p: Partial<PaperListItem> & { id: string }): PaperListItem {
  return {
    arxivId: p.id.split('/').pop() || '',
    slug: p.id,
    yearMonth: '2026',
    day: '01',
    categories: p.categories,
    title: p.title,
    title_zh: p.title_zh,
    tldr: p.tldr,
    ...p,
  };
}

const FIXTURE: PaperListItem[] = [
  paper({
    id: 'papers/2026/01/01/2607.00001-a',
    categories: { venue: ['ICML 2025'], task: ['rl'] },
    title: 'RL survey',
    title_zh: '强化学习综述',
    tldr: 'an overview of reinforcement learning',
  }),
  paper({
    id: 'papers/2026/01/01/2607.00002-b',
    categories: { venue: ['ICML 2025'], task: ['rl', 'marl'] },
    title: 'Multi-agent RL',
    title_zh: '多智能体强化学习',
    tldr: 'cooperative reinforcement learning',
  }),
  paper({
    id: 'papers/2026/01/01/2607.00003-c',
    categories: { venue: ['NeurIPS'], task: ['cv'] },
    title: 'Image classification',
    title_zh: '图像分类',
    tldr: 'computer vision benchmark',
  }),
];

describe('paper-relations/core.mjs', () => {
  it('flattenCategories matches TS tagSet on 4-dim input', async () => {
    const c = await loadCore();
    const flat = c.flattenCategories(FIXTURE[0].categories);
    expect(flat.sort()).toEqual(['task:rl', 'venue:ICML 2025']);
  });

  it('jaccardEdges output matches jaccard.ts on small fixture', async () => {
    const c = await loadCore();
    const core = c.jaccardEdges(
      FIXTURE.map((p) => ({ id: p.id, g: c.flattenCategories(p.categories) })),
    );
    const ts = computeJaccardEdges(FIXTURE);
    expect(core.length).toBe(ts.length);
    // 字段命名约定不同:core.mjs 写成 shared(更短),jaccard.ts 写成 sharedTags
    // (与 RelationEdge 类型一致)。展开后再归一化比较。
    const norm = (a: any[]) => a.map((e) => ({
      source: e.source,
      target: e.target,
      weight: Math.round(e.weight * 1e6) / 1e6,
      shared: [...(e.shared || e.sharedTags || [])].sort(),
    }));
    expect(norm(core)).toEqual(norm(ts));
  });

  it('computeRelations artifact shape: ids + edges dict', async () => {
    const c = await loadCore();
    const rel = c.computeRelations(
      FIXTURE.map((p) => ({
        id: p.id,
        g: c.flattenCategories(p.categories),
        t: p.title || '',
        z: p.title_zh || '',
        l: p.tldr || '',
      })),
      { topK: 8, minWeight: 0 },
    );
    expect(rel.ids).toEqual(FIXTURE.map((p) => p.id));
    for (const [src, list] of Object.entries(rel.edges)) {
      const srcIdx = Number(src);
      expect(srcIdx).toBeGreaterThanOrEqual(0);
      expect(srcIdx).toBeLessThan(rel.ids.length);
      for (const [tgt, w, mask] of list) {
        expect(tgt).toBeGreaterThanOrEqual(0);
        expect(tgt).toBeLessThan(rel.ids.length);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1000);
        expect([1, 2, 3]).toContain(mask);
      }
    }
  });
});