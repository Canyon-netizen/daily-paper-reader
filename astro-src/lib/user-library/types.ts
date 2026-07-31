// astro-src/lib/user-library/types.ts
//
// 用户图书馆(user library)—— 每篇论文的**用户侧**状态:星标 / 阅读状态 /
// 笔记 / 回收站元数据。这是 Stage 1 的地基,Stage 2(Gist 同步)、Stage 3
// (阅读态 UI)、Stage 6(笔记进检索)、Stage 10(工作台筛选)都建在它上面。
//
// 与 Polaris 的对应关系:
//   Polaris paper_user_meta(starred + reading_status) → UserPaperState.starred / readingStatus
//   Polaris paper_notes(per-user markdown)           → UserPaperState.note
//   Polaris library_papers.trash_reason + 软删除       → UserPaperState.trash
// Polaris 用 Postgres 多表 + user_id 隔离;DPR 是单人静态站,所以拍平成
// 一个 localStorage doc,key 是 canonical arXiv id。
//
// 本模块是**纯类型**,零运行时,页面可以 `import type` 而不拖任何东西进 bundle。

/** 阅读生命周期 —— 对齐 Polaris reading_status。 */
export type ReadingStatus = 'unread' | 'reading' | 'read';

/** 回收站元数据。注意:`dpr_hidden_papers_v1` 仍然是"这篇是否被隐藏"的**真值**,
 *  这里只补充"什么时候删的 / 为什么删",避免两个 key 各存一份 boolean 造成裂脑。 */
export interface TrashMeta {
  /** epoch ms */
  deletedAt: number;
  /** 'manual' | 'bulk' | 自定义原因;对齐 Polaris 的 trash_reason。 */
  reason?: string;
}

/**
 * 单篇论文的用户态。所有业务字段都是可选的 —— 存储是**稀疏**的:
 * 只有用户真正操作过的论文才会有 entry,610 篇论文不会凭空占 610 个 key。
 */
export interface UserPaperState {
  starred?: boolean;
  readingStatus?: ReadingStatus;
  /** markdown 原文,不做任何投影/转义 —— 渲染时才交给 lib/markdown。 */
  note?: string;
  trash?: TrashMeta;
  /** epoch ms。由 store 的私有写入漏斗统一盖章,调用方不需要也不应该自己填。
   *  Stage 2 的 Gist 合并按本字段做 last-write-wins。 */
  updatedAt: number;
}

/** 整个 doc 的形状。schemaVersion 不匹配时 store 直接丢弃重建(见 store.ts 的
 *  loadUserLibrary),避免旧结构的半残数据在新代码里引发难查的运行时错误。 */
export interface UserLibraryDoc {
  schemaVersion: 1;
  /** key = canonicalArxivId(...),**永不含 vN**。
   *  不变式见 lib/arxiv.ts:canonicalArxivId 的注释。 */
  papers: Record<string, UserPaperState>;
}

/**
 * 写入结果。
 *
 * 为什么不是 `void`:localStorage 有 ~5MB 配额,而笔记是用户手打的长文本 ——
 * 配额耗尽是**可预期**的失败,不是异常边缘。本仓库已有一个反面先例:
 * scripts/paper-fulltext.ts 的 writeToLocalStorage 静默吞掉 QuotaExceededError,
 * 用户写的东西消失了却什么都看不到。所以这里把失败做成返回值,强制调用方处理
 * (Stage 3 的笔记编辑器会据此弹 toast)。
 */
export type WriteResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'quota' | 'unavailable' };

/**
 * 只读快照 —— 交给**纯函数**筛选层(Stage 10 的 applyLibraryFilters)。
 *
 * 关键设计:lib/paper-filter.ts 是纯模块,不能 import localStorage。所以状态
 * 以显式参数注入,而不是让纯函数自己去读全局。
 *
 * userTags 只读不写:user-library **不接管** `dpr_user_tags_v1`,那套 CRUD +
 * Gist 同步在 scripts/settings.ts 里现状可用,迁移是纯风险零收益。
 */
export interface UserLibrarySnapshot {
  hidden: ReadonlySet<string>;
  starred: ReadonlySet<string>;
  status: ReadonlyMap<string, ReadingStatus>;
  /** 只放 note.length > 0 的条目,调用方可以直接 `.has()` 当 hasNote 判定。 */
  notes: ReadonlyMap<string, string>;
  userTags: ReadonlyMap<string, ReadonlyArray<{ kind: string; label: string }>>;
}

/** Stage 2 用:Gist 同步结果。conflicts 必须暴露给 UI —— 笔记是标量,
 *  两端都改过就一定有一方要被覆盖,静默丢弃是不可接受的。 */
export interface GistLibraryResult {
  ok: boolean;
  reason?: string;
  mergedPapers?: number;
  writtenPapers?: number;
  conflicts?: number;
}
