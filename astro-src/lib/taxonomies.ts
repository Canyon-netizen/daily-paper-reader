// 4-dim 分类白名单(任务/方法/类型),与 `src/taxonomy.py` 共用同份
// `config/taxonomies.json`。TS 端主要靠 Vite 的 JSON import;bun 跑的独立脚本
// 若 Vite 解析不到,动态 import `./taxonomies-disk.mjs` 回落到 `readFileSync`。
//
// venue 维度的可取集合由 `astro-src/lib/venue.ts::CONFERENCE_SOURCE_LABELS`
// 推导 (source → 'ICML 2025' 风格 label),不在此处声明。
//
// 注意:不要在此文件顶层 `import` 任何 node:* 模块 —— Vite 会把整个模块编进
// 客户端 bundle,触发 `node:fs / node:path is not exported by __vite-browser-external`。
// 需要读盘的逻辑全部走 `./taxonomies-disk.mjs`(动态 import)。
// 见 astro.config.mjs:diskExternalForClientOnly plugin 把 disk.mjs 只在
// client 端 externalize,SSR 端会被 Vite 编进 chunk,运行时自包含。

interface TaxonomiesFile {
  task: readonly string[];
  method: readonly string[];
  type: readonly string[];
}

// Vite 解析路径:从 astro-src/lib 走到根 config。
import taxonomiesJson from '../../config/taxonomies.json';

function toSet(arr: readonly string[]): ReadonlySet<string> {
  return new Set(arr.map((s) => s.trim().toLowerCase()).filter(Boolean));
}

// 模块级常量 — Vite build 时固化,bun 跑 vite-bundled 输出时也直接命中。
export const TASK_ALLOWLIST: ReadonlySet<string> = toSet(
  (taxonomiesJson as TaxonomiesFile).task ?? [],
);
export const METHOD_ALLOWLIST: ReadonlySet<string> = toSet(
  (taxonomiesJson as TaxonomiesFile).method ?? [],
);
export const TYPE_ALLOWLIST: ReadonlySet<string> = toSet(
  (taxonomiesJson as TaxonomiesFile).type ?? [],
);

export const TASK_ALLOWLIST_RAW: readonly string[] =
  (taxonomiesJson as TaxonomiesFile).task ?? [];
export const METHOD_ALLOWLIST_RAW: readonly string[] =
  (taxonomiesJson as TaxonomiesFile).method ?? [];
export const TYPE_ALLOWLIST_RAW: readonly string[] =
  (taxonomiesJson as TaxonomiesFile).type ?? [];

// 旧 query:<label> → categories.task 直迁。命中后该 label 不再走 LLM。
// key 一律 lower-case。`self distillation` 同时映射到 method:distillation,
// 由消费方 (backfill) 自行决定哪个维度接住。
export const ALIAS_OLD_TAG_TO_TASK: Readonly<Record<string, string>> = {
  rl: 'rl',
  'llm-agent': 'agent',
  reasoning: 'reasoning',
  gui: 'gui',
  vision: 'vision',
  speech: 'speech',
  'game ai': 'game-ai',
  mas: 'mas',
  retrieval: 'retrieval',
  code: 'code',
  robotics: 'robotics',
  safety: 'safety',
  knowledge: 'knowledge',
  // 'intervention' 故意不映射。
};

export const ALIAS_OLD_TAG_TO_METHOD: Readonly<Record<string, string>> = {
  'self distillation': 'distillation',
};

export type CategoryDim = 'venue' | 'task' | 'method' | 'type';

/** 跟 Python `normalize_category_dim` 对齐:venue 维度直接放行(无白名单),
 *  task/method/type 白名单 + 大小写无关 + 去空 + 去重 + 保序。 */
export function normalizeCategoryDim(
  raw: readonly unknown[] | undefined,
  dim: CategoryDim,
): string[] {
  if (!Array.isArray(raw)) return [];
  if (dim === 'venue') {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of raw) {
      const v = typeof x === 'string' ? x.trim() : '';
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }
  let allow: ReadonlySet<string>;
  if (dim === 'task') allow = TASK_ALLOWLIST;
  else if (dim === 'method') allow = METHOD_ALLOWLIST;
  else if (dim === 'type') allow = TYPE_ALLOWLIST;
  else throw new Error(`unknown category dim: ${dim as string}`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const t = typeof x === 'string' ? x.trim().toLowerCase() : '';
    if (!t || !allow.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export interface CategoriesInput {
  venue?: readonly unknown[];
  task?: readonly unknown[];
  method?: readonly unknown[];
  type?: readonly unknown[];
}

export interface Categories {
  venue: string[];
  task: string[];
  method: string[];
  type: string[];
}

/** 集中 4-dim 拷出 (whitelist-copy)。所有 LLM-emit / backfill / regen 入口
 *  构造 `Categories` 时必须走这里,缺字段立刻在调用处类型不匹配。 */
export function buildCategories(input: CategoriesInput = {}): Categories {
  return {
    venue: normalizeCategoryDim(input.venue, 'venue'),
    task: normalizeCategoryDim(input.task, 'task'),
    method: normalizeCategoryDim(input.method, 'method'),
    type: normalizeCategoryDim(input.type, 'type'),
  };
}

/** 单行 flow-style YAML 序列化。塞进 frontmatter `categories:` 行内。
 *  这样 JS `yaml.load` 和 Python 手写 frontmatter parser 都直接认。
 *
 *  `categories: {venue: ["ICML 2025"], task: ["rl"], method: [], type: ["benchmark"]}`
 */
export function categoriesToYamlInline(c: Categories): string {
  const dims: CategoryDim[] = ['venue', 'task', 'method', 'type'];
  const parts = dims.map((dim) => {
    const items = c[dim];
    if (!items || items.length === 0) return `${dim}: []`;
    const quoted = items.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(', ');
    return `${dim}: [${quoted}]`;
  });
  return '{ ' + parts.join(', ') + ' }';
}

/** bun 独立跑 (无 Vite) 时的 fallback — 动态 import 读盘文件,
 *  这样本文件的静态 dependency graph 不含 node:fs / node:path。
 *  类型与 JSON import 路径保持一致。 */
let diskCache: TaxonomiesFile | null = null;
export async function readTaxonomiesFromDisk(): Promise<TaxonomiesFile> {
  if (diskCache) return diskCache;
  const mod = await import('./taxonomies-disk.mjs');
  diskCache = mod.readTaxonomiesFromDisk() as TaxonomiesFile;
  return diskCache;
}
