// /lib/paper-frontmatter/parse.ts — paper markdown frontmatter 解析纯函数集。
//
// 集中理由:
//   - paper.ts 442 行里 frontmatter 解析(parseFrontmatter + 3 个 normalize)
//     占了 110 行业务逻辑,且只读盘侧(与 lib/arxiv / paper-filter 完全无关)。
//   - 把这些纯函数下沉到这里,paper.ts 只剩 readPaper orchestrator + 列表投影,
//     行数 < 350 行,职责更聚焦。
//   - 服务端 Python 端解析 markdown frontmatter 时,如未来做跨端字段对齐验证,
//     这层 TS 函数是文档化的"已知合法形状",直接单元测试覆盖。
//
// 不依赖 node:fs / 任何 astro 集成——保持纯函数,可独立单测。

import yaml from 'js-yaml';
import { buildCategories, type Categories } from '../taxonomies';
import type { ConceptRef } from '../types/concept';
import { normalizeConceptList } from '../concepts-index';
import type { PaperFrontmatter, FigureEntry } from '../paper';

/** 把 figures_json 字符串(JSON-encoded 或 inline 数组)规范化成 FigureEntry[]。 */
export function parseFigureList(raw: unknown): FigureEntry[] {
  if (!raw) return [];
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
  return arr
    .map((item, i) => normalizeFigureEntry(item, i))
    .filter((e): e is FigureEntry => e !== null);
}

/** 单项 frontmatter figures entry 标准化:缺 url 视为非法。 */
export function normalizeFigureEntry(item: unknown, fallbackIndex: number): FigureEntry | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  const url = typeof obj.url === 'string' ? obj.url.trim() : '';
  if (!url) return null;
  return {
    url,
    caption: typeof obj.caption === 'string' ? obj.caption : '',
    page: typeof obj.page === 'number' ? obj.page : 0,
    index: typeof obj.index === 'number' ? obj.index : fallbackIndex + 1,
    width: typeof obj.width === 'number' ? obj.width : 0,
    height: typeof obj.height === 'number' ? obj.height : 0,
    extractor: typeof obj.extractor === 'string' ? obj.extractor : '',
  };
}

/** date 字段统一为 'YYYY-MM-DD' 字符串;无法识别 → undefined。 */
export function normalizeDate(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const s = String(v).padStart(8, '0');
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(4 + 2, 4 + 4)}`;
  }
  if (typeof v === 'string') return v;
  return undefined;
}

/** categories 4-dim 规范化:输入 unknown,经过 buildCategories 走白名单。 */
export function normalizeCategories(raw: unknown): Categories {
  if (!raw || typeof raw !== 'object') {
    return buildCategories({});
  }
  const obj = raw as Record<string, unknown>;
  return buildCategories({
    venue: Array.isArray(obj.venue) ? (obj.venue as unknown[]) : undefined,
    task: Array.isArray(obj.task) ? (obj.task as unknown[]) : undefined,
    method: Array.isArray(obj.method) ? (obj.method as unknown[]) : undefined,
    type: Array.isArray(obj.type) ? (obj.type as unknown[]) : undefined,
  });
}

/**
 * 解析 paper .md 的 frontmatter 区段;失败返回 { error } 而不是抛错,
 * caller 用 'error' in parsed 区分。
 *
 * 不依赖 node:fs / 外部 I/O;纯字符串解析 → frontmatter DTO。
 */
export function parseFrontmatter(
  text: string,
): { data: PaperFrontmatter; body: string } | { error: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { error: 'no frontmatter' };
  try {
    const raw = (yaml.load(m[1]) as PaperFrontmatter) || {};
    const data: PaperFrontmatter = {
      ...raw,
      date: normalizeDate(raw.date),
      categories: normalizeCategories(raw.categories),
      concepts: normalizeConceptList(raw.concepts),
    };
    return { data, body: m[2] };
  } catch (e) {
    return { error: (e as Error).message.slice(0, 100) };
  }
}