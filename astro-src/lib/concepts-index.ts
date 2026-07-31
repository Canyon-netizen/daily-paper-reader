// /lib/concepts-index.ts — 概念索引构建器 + 解析 helpers。
//
// 这是 Stage 9 的真值来源:从 docs/papers/<YYYY>/<MM>/<arxivid>-*.md 的 frontmatter
// `concepts:` 段派生概念图谱,**不依赖 gitignored 的 wiki/concepts/**(CI 上根本不存在)。
//
// 设计要点:
//   - build-time walk + frontmatter parse,得到 {bySlug, relatedBySlug}
//   - 同一个 slug 在多篇论文出现时:display_name/category 取首次见到,novelty/centrality 取均值
//   - paper_ids 数组就是 [slug] → 引用此概念的全部 paper id 列表(SSR-only)
//   - 相关概念:co-occurrence,relatedBySlug[slug].sort by co_count desc
//
// 调用方:
//   - pages/wiki/concepts/[slug].astro  ::  getStaticPaths / getConceptDetail
//   - pages/papers/[arxiv].astro         ::  paper 的 concepts 数组(已经在 frontmatter)
//   - lib/markdown/inline.ts             ::  wikilink resolver(从 bySlug 派生 Map)

import yaml from 'js-yaml';
import type {
  ConceptRef,
  ConceptIndex,
  ConceptIndexEntry,
  RelatedConcept,
} from './types/concept';

const EXCLUDED_DIRS = new Set(['tutorial', 'assets', 'plans']);
const PREFIX_SKIP_DIR = '_';

interface RawFrontmatter {
  concepts?: unknown;
}

/** 把 frontmatter `concepts:` 段规整成 ConceptRef[]。宽容:遇到坏数据整条忽略。
 *
 *  data shape 来自 python src/6.generate_docs.py:
 *    concepts: [{"slug": "...", "display_name": "...", "category": "...",
 *                "novelty": 0.0..1.0, "centrality": 0.0..1.0}]
 *
 *  JSON-encoded 字符串 / inline list / 直接 list 都接受 — 跟 figures_json 同处理。 */
export function normalizeConceptList(raw: unknown): ConceptRef[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      arr = JSON.parse(s);
    } catch {
      try {
        arr = JSON.parse(s.replace(/\\"/g, '"'));
      } catch {
        return [];
      }
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: ConceptRef[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const slug = typeof obj.slug === 'string' ? obj.slug.trim() : '';
    const displayName = typeof obj.display_name === 'string' ? obj.display_name.trim() : '';
    if (!slug || !displayName) continue;
    if (seen.has(slug)) continue; // 同 paper 内去重
    seen.add(slug);
    const category = typeof obj.category === 'string' ? obj.category.trim() : 'other';
    const novelty = typeof obj.novelty === 'number' && Number.isFinite(obj.novelty) ? obj.novelty : undefined;
    const centrality = typeof obj.centrality === 'number' && Number.isFinite(obj.centrality) ? obj.centrality : undefined;
    out.push({
      slug,
      display_name: displayName,
      category,
      novelty,
      centrality,
    });
  }
  return out;
}

/** 从论文 markdown 文本里抽出 frontmatter 的 `concepts` 字段 + slug。纯字符串解析,
 *  与 paper-frontmatter/parse.ts 风格一致;只关心 `concepts` 一项,不抛错。
 *
 *  返回 paper id(从入参或文件路径推断)+ concepts refs。失败 → 空 refs。 */
function extractConceptsFromMdText(mdText: string): ConceptRef[] {
  const m = mdText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return [];
  let raw: RawFrontmatter = {};
  try {
    raw = (yaml.load(m[1]) as RawFrontmatter) || {};
  } catch {
    return [];
  }
  return normalizeConceptList(raw.concepts);
}

async function walk(dir: string, out: string[]): Promise<void> {
  const disk = await import('./concept-disk.mjs');
  const entries = await disk.readDirEntries(dir);
  for (const e of entries) {
    if (e.isDirectory()) {
      if (EXCLUDED_DIRS.has(e.name) || e.name.startsWith(PREFIX_SKIP_DIR)) continue;
      const p = disk.joinPath(dir, e.name);
      await walk(p, out);
      continue;
    }
    if (e.name.endsWith('.md') && !e.name.startsWith('_') && e.name !== 'README.md'
        && e.name !== 'path-spec.md' && e.name !== 'zotero-usage.md') {
      const p = disk.joinPath(dir, e.name);
      const rel = disk.relativeTo(disk.DOCS_DIR, p);
      const id = rel.replace(/\.md$/, '');
      out.push(id);
    }
  }
}

/** 构建期单次 walk,产出完整 ConceptIndex。
 *
 *  SSR-only。cloudflare pages / vercel build 期间会调一次,缓存到 module scope
 *  直到 process 结束。 */
let cached: ConceptIndex | null = null;
export async function buildConceptIndex(): Promise<ConceptIndex> {
  if (cached) return cached;
  const disk = await import('./concept-disk.mjs');
  const paperIds: string[] = [];
  await walk(disk.DOCS_DIR, paperIds);

  // 第一遍:per-paper refs,同时累加 per-slug 累计
  const bySlug = new Map<string, ConceptIndexEntry>();
  const paperConceptsList: Array<{ id: string; refs: ConceptRef[] }> = [];

  for (const id of paperIds) {
    const mdPath = disk.joinPath(disk.DOCS_DIR, `${id}.md`);
    let text: string;
    try {
      text = await disk.readTextFile(mdPath);
    } catch {
      continue;
    }
    const refs = extractConceptsFromMdText(text);
    if (refs.length === 0) continue;
    paperConceptsList.push({ id, refs });

    for (const ref of refs) {
      const cur = bySlug.get(ref.slug);
      if (!cur) {
        bySlug.set(ref.slug, {
          slug: ref.slug,
          display_name: ref.display_name,
          category: ref.category,
          paper_count: 1,
          novelty: ref.novelty ?? 0,
          centrality: ref.centrality ?? 0,
          paper_ids: [id],
        });
      } else {
        cur.paper_count += 1;
        cur.paper_ids.push(id);
        // novelty/centrality 累加,最后 mean
        if (ref.novelty !== undefined) cur.novelty += ref.novelty;
        if (ref.centrality !== undefined) cur.centrality += ref.centrality;
      }
    }
  }

  // 第二遍:取均值
  for (const entry of bySlug.values()) {
    // 简单均值(分母 = paper_count,因为累加时 missing 不加)
    if (entry.novelty > 0) {
      entry.novelty = +(entry.novelty / entry.paper_count).toFixed(3);
    } else {
      entry.novelty = 0;
    }
    if (entry.centrality > 0) {
      entry.centrality = +(entry.centrality / entry.paper_count).toFixed(3);
    } else {
      entry.centrality = 0;
    }
  }

  // 第三遍:co-occurrence
  const coCount = new Map<string, Map<string, number>>();
  for (const { refs } of paperConceptsList) {
    const slugs = refs.map((r) => r.slug);
    for (let i = 0; i < slugs.length; i++) {
      for (let j = i + 1; j < slugs.length; j++) {
        const a = slugs[i];
        const b = slugs[j];
        if (!coCount.has(a)) coCount.set(a, new Map());
        if (!coCount.has(b)) coCount.set(b, new Map());
        const am = coCount.get(a)!;
        const bm = coCount.get(b)!;
        am.set(b, (am.get(b) ?? 0) + 1);
        bm.set(a, (bm.get(a) ?? 0) + 1);
      }
    }
  }

  const relatedBySlug = new Map<string, RelatedConcept[]>();
  for (const [slug, m] of coCount.entries()) {
    const related: RelatedConcept[] = [];
    for (const [other, co] of m.entries()) {
      const otherEntry = bySlug.get(other);
      if (!otherEntry) continue;
      related.push({
        slug: other,
        display_name: otherEntry.display_name,
        category: otherEntry.category,
        co_count: co,
        paper_count: otherEntry.paper_count,
      });
    }
    related.sort((a, b) => {
      if (b.co_count !== a.co_count) return b.co_count - a.co_count;
      return a.display_name.localeCompare(b.display_name);
    });
    relatedBySlug.set(slug, related);
  }

  cached = {
    bySlug,
    relatedBySlug,
    totalPapersWithConcepts: paperConceptsList.length,
    totalPapers: paperIds.length,
  };
  return cached;
}

/** 给定 slug,返回 index entry;undefined → slug 不存在。 */
export function getConceptEntry(
  index: ConceptIndex,
  slug: string,
): ConceptIndexEntry | undefined {
  return index.bySlug.get(slug);
}

/** 给定 slug,返回共现相关概念列表(已按 co_count desc 排好)。 */
export function getRelatedConcepts(
  index: ConceptIndex,
  slug: string,
): RelatedConcept[] {
  return index.relatedBySlug.get(slug) || [];
}

/** 给 wikilink resolver 用:从 index 派生 Map(name|slug → {slug, display_name})。
 *  alias 暂不接(plan §阶段 9 #3 提到的 alias 走 name 即可,无需 alias 表)。
 *  Map 的 key 三件套:slug / display_name lowercase / display_name 原样。 */
export function buildWikilinkResolver(
  index: ConceptIndex,
): Map<string, { slug: string; display_name: string }> {
  const m = new Map<string, { slug: string; display_name: string }>();
  for (const entry of index.bySlug.values()) {
    m.set(entry.slug, { slug: entry.slug, display_name: entry.display_name });
    m.set(entry.display_name, { slug: entry.slug, display_name: entry.display_name });
    m.set(entry.display_name.toLowerCase(), {
      slug: entry.slug,
      display_name: entry.display_name,
    });
  }
  return m;
}

/** 清缓存 — 给测试用。 */
export function _resetConceptIndexCache(): void {
  cached = null;
}