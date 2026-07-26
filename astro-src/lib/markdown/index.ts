// /lib/markdown/index.ts — 公开 API barrel。
// 子模块各自独立,通过本文件统一对外暴露稳定符号。
//
// 公开 surface:
//   - renderMarkdownBody:主入口
//   - renderTitleHtml:标题专用
//   - FigureEntry / RenderOptions:DTO

export { renderMarkdownBody } from './render';
export { renderTitleHtml } from './title';
export type { FigureEntry, RenderOptions } from './types';