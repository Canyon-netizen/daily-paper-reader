// /lib/paper-frontmatter/index.ts — 公开 API barrel。
//
//  - parse.ts:  frontmatter 段解析(YAML → DTO)+ date/categories/figures 各类 normalize
//  - figures.ts: 兜底读盘(docs/assets/figures/arxiv/<id>/meta.json)
//
// 注意:与 lib/markdown/、lib/arxiv/、lib/paper-filter/ 一样,
// 本模块零依赖 node:fs / astro,parse 部分纯字符串,可独立单测。

export {
  parseFrontmatter,
  parseFigureList,
  normalizeFigureEntry,
  normalizeDate,
  normalizeScore,
  normalizeCategories,
  extractWikiArticle,
  extractWikiArticleStrict,
} from './parse';

export {
  loadFiguresFromAssetMeta,
} from './figures';