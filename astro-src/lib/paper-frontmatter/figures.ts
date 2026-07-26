// /lib/paper-frontmatter/figures.ts — figure 兜底读盘工具。
//
// 当 frontmatter `figures_json` 缺失或为空时,从
// `docs/assets/figures/arxiv/<arxivId>/meta.json` 读 figures 列表。
// 主要防 backfill 漏写 + 跨版本 frontmatter 漂移;disk miss 时返回 undefined。
//
// 这是 paper.ts 的辅助函数,只被 readPaper 调用。
// 单独拆到这里,让 paper.ts 只剩 orchestrator + 类型补全。

import { normalizeFigureEntry } from './parse';
import type { FigureEntry } from '../paper';

/** 对外公开:缺失 frontmatter figures_json 时尝试从 assets/meta.json 兜底。
 *  这里动态 import paper-disk.mjs 是为了 SSR 时不污染客户端 bundle
 *  (paper-disk.mjs 顶层用 node:fs,不能进 client chunk)。 */
export async function loadFiguresFromAssetMeta(
  arxivId: string,
): Promise<FigureEntry[] | undefined> {
  if (!arxivId) return undefined;
  const disk = await import('../paper-disk.mjs');
  const metaPath = disk.joinPath(disk.DOCS_DIR, 'assets', 'figures', 'arxiv', arxivId, 'meta.json');
  let text: string;
  try {
    text = await disk.readTextFile(metaPath);
  } catch {
    return undefined;
  }
  try {
    const meta = JSON.parse(text) as { figures?: unknown };
    if (!Array.isArray(meta.figures)) return undefined;
    const out: FigureEntry[] = [];
    meta.figures.forEach((item, i) => {
      const entry = normalizeFigureEntry(item, i);
      if (entry) out.push(entry);
    });
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}