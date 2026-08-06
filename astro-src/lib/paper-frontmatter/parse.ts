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

/**
 * score 字段统一到 0–1 区间。
 *
 * 历史上存在两套写法并存(2026-08 实测 464 篇 0–1 / 62 篇 legacy):
 *   - legacy:`score: 8.0`(0–10 整数刻度,早期 4.llm_refine_papers 写入)
 *   - 现行:`score: 0.8`(0–1,src/4_5_batch_score.py:write_frontmatter 写入)
 *
 * 两者混在一起时 /papers/ 的「相关度」排序会把 legacy 论文整体顶到前面
 * (8.0 > 任何 0–1 分),相关度阈值过滤也会全部放行。这里在解析边界一次性
 * 归一化,让下游(paper-filter 排序 / 库工作台 score-ring / 详情页 pill)
 * 只需面对单一量纲。
 *
 * 归一化规则:> 1 视为 0–10 刻度,除以 10;其余原样保留。非数字 / NaN
 * → undefined(缺分论文,排序时按 0 兜底,不伪装成 0 分论文)。
 */
export function normalizeScore(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  if (v < 0) return 0;
  const n = v > 1 ? v / 10 : v;
  // legacy 10.0 → 1.0;更大的脏数据钳到 1,避免 score-ring 画出 > 满环。
  return n > 1 ? 1 : n;
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
      score: normalizeScore(raw.score),
      categories: normalizeCategories(raw.categories),
      concepts: normalizeConceptList(raw.concepts),
    };
    return { data, body: m[2] };
  } catch (e) {
    return { error: (e as Error).message.slice(0, 100) };
  }
}

/**
 * 从 paper body 里抽「Polaris-style 5 节中文解读」段。
 * translate_polaris.py 把它插在 frontmatter 关闭后,## 摘要 / ## Abstract
 * 之前(空行隔开)。结构:
 *   <空行>
 *   ## TL;DR
 *   ...
 *   ## 研究背景与动机
 *   ...
 *   ## 方法
 *   ...
 *   ## 实验与结果
 *   ...
 *   ## 讨论与可借鉴点
 *   ...
 *   <空行>
 *   ## 摘要
 *   ## Abstract
 *   ...
 *
 * 没有 5 节 → 返回 null(没编译过的论文)。
 * 用于 workbench 右侧详情面板就地展示 wiki(Polaris 模式)。
 */
export function extractWikiArticle(body: string): string | null {
  if (!body) return null;
  // 在 body 里找 `## TL;DR` 起始,到下一个二级标题或纯英文 ## Abstract / ## 摘要 之前
  const startRe = /^## TL;DR\s*$/m;
  const startMatch = startRe.exec(body);
  if (!startMatch) return null;
  // 终止:到第一个非 wiki 节段(## 摘要 / ## Abstract / 任何 ## 标题(非 TL;DR/研究背景/方法/实验/讨论))
  // 简单做法:扫到「## 摘要」或「## Abstract」就停
  const endRe = /^## (摘要|Abstract)\s*$/m;
  const endMatch = endRe.exec(body.slice(startMatch.index + 1));
  const end = endMatch ? startMatch.index + 1 + endMatch.index : body.length;
  return body.slice(startMatch.index, end).trim();
}

/**
 * translate_polaris.py 写出的 5 节中文解读必须全 5 节都在才算「完整」:
 *   ## TL;DR
 *   ## 研究背景与动机
 *   ## 方法
 *   ## 实验与结果
 *   ## 讨论与可借鉴点
 *
 * extractWikiArticle() 只校验 ## TL;DR 起始,容忍老版 4 节翻译(## TLDR/## 动机/
 * 方法/结果/结论)与不完整 body,这是向后兼容的需要。
 *
 * extractWikiArticleStrict() 是「完整版」:5 节标题必须全在 body 段内,否则 null。
 * 用于:
 *   - paper.ts readPaper 的 wikiContent fallback 链:strict 优先,strict 不行才退化
 *   - daily workflow translate 完之后的完整性校验
 *
 * 不要在这里做强字符 / 长度校验 —— 那是 translate_polaris.py:_validate_article 的职责,
 * Python 端拒收低质量 LLM 输出。本函数只校验结构(5 个 ## 标题),不评估内容质量。
 */
const REQUIRED_WIKI_HEADINGS = [
  '## TL;DR',
  '## 研究背景与动机',
  '## 方法',
  '## 实验与结果',
  '## 讨论与可借鉴点',
] as const;

export function extractWikiArticleStrict(body: string): string | null {
  const wiki = extractWikiArticle(body);
  if (!wiki) return null;
  return REQUIRED_WIKI_HEADINGS.every((h) => wiki.includes(h)) ? wiki : null;
}