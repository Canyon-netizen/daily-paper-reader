// /lib/arxiv-entry/types.ts — ArXiv API 返回 entry 的 DTO。
//
// 这两条 DTO 同时被 paper-analyzer / topic-search seeds-modal / 多处 client 渲染
// 复用。集中放这里避免再去走 paper-analyzer.ts 的间接依赖(违反低耦合)。

export interface ArxivEntry {
  /** id 全文 URL,例如 http://arxiv.org/abs/1706.03762v7 */
  id: string;
  /** 提取出的 arXiv id,例如 1706.03762v7 */
  arxivId: string;
  title: string;
  authors: string[];
  summary: string;
  published: string;
  updated: string;
  /** 已拼好 PDF URL;entry 内若没有 link[title=pdf],回退到 https://arxiv.org/pdf/<id>。 */
  pdfUrl: string;
}