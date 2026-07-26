// /lib/markdown/types.ts — 纯 DTO。
// 图 entries 在 lib/paper 里也有同名 FigureEntry 类型(完整 8 字段),
// 这里收窄到 markdown 真正用到的字段,避免 markdown 反向依赖 lib/paper。

export interface FigureEntry {
  url: string;
  caption?: string;
  page?: number;
  index?: number;
  width?: number;
  height?: number;
  /** 提取器来源。'pdf-rasterize' = 整页预览(论文无独立图),UI 需区别标注。 */
  extractor?: string;
}

/** renderMarkdownBody 调参。 */
export interface RenderOptions {
  /** 论文 frontmatter figures_json 解析后的图片列表;非空时会在 body 开头插入"论文图表"区块。 */
  figures?: FigureEntry[];
  /** 部署 base 路径,把相对路径图片 url 解析成可访问 src。 */
  base?: string;
  /** 聊天模式:跳过 figures 区块、标题整体下移两级。论文页面调用时不要设。 */
  chat?: boolean;
}