// astro-src/lib/user-libraries/types.ts
//
// 用户文献库(复数 libraries)—— 用户自建的论文收藏夹,**对照 Polaris 的
// DirectionLibrary**(但本仓库砍掉 inclusion/anchor/rubric/admin/status
// 概念,单人静态站,无审批流程)。
//
// 与 lib/user-library(单数 user-library)完全独立:
//   - user-library:每篇论文的**用户侧状态**(star / status / note / trash),
//     key = canonicalArxivId,稀疏存储。
//   - user-libraries(本模块):**用户命名的论文集合**,key = libraryId,
//     每条带 name + statement + paperIds[] + hue + 时间戳。
//
// 名字区分:
//   - 文件夹用 **libraries**(复数)→ localStorage key `dpr_user_libraries_v1`。
//   - 状态用 **library**(单数)→ localStorage key `dpr_user_library_v1`。
// 写代码时碰到 library(单)/ libraries(复)一定要分清,grep 容易撞名。
//
// 关键设计:
//   1. **单一写入漏斗** commit() (在 store.ts),所有 mutator 经过它,
//      盖 updatedAt + 发 dpr:user-libraries-change 事件。
//      历史教训 feedback_settings_selection_must_emit:两条写入路径不共享
//      事件源,UI 计数就不刷新。
//   2. **name + statement 都必填**(Polaris 强调 statement 是「挑论文和打分」用;
//      本仓库没有 LLM 抓取,statement 是「给这个收藏夹写一句话」,但是
//      短句「标题 + statement」能让用户翻找时一眼认出来)。
//   3. **canonical paper id** —— paperIds 一律 canonicalArxivId(),
//      避免 v1/v2 各存一份。
//
// 本模块是**纯类型**,零运行时,页面可以 `import type` 而不拖任何东西进 bundle。

/** 与 public LIBRARIES 共享的 hue 调色板 —— 7 种,见 lib/libraries.ts:Library.hue。
 *  客户端 chip 选择器用同一份枚举。 */
export type LibraryHue = 'orange' | 'cyan' | 'purple' | 'emerald' | 'amber' | 'rose' | 'sky';

export const LIBRARY_HUES: readonly LibraryHue[] = [
  'orange', 'cyan', 'purple', 'emerald', 'amber', 'rose', 'sky',
] as const;

/** 单个用户文献库。**Polaris 字段映射**:
 *  - name              ↔ DirectionLibrary.name
 *  - statement         ↔ DirectionLibrary.statement(给这个收藏夹写一句话)
 *  - inclusionKeywords ↔ DirectionLibrary.inclusion_keywords(必须命中)
 *  - exclusionKeywords ↔ DirectionLibrary.exclusion_keywords(命中则剔除)
 *  - categories        ↔ DirectionLibrary.categories(arXiv 学科分类,辅助筛选)
 *  - rubric            ↔ DirectionLibrary.rubric(自定义打分维度数组)
 *  - 砍:isPublic / status / paper_pool / wiki_snapshot / digest /
 *    last_compiled_at —— Polaris 那些是 DB 后端运算 / 审批状态机,
 *    本仓库不需要。
 *  - 加:hue(Polaris 用图标 + 颜色,本仓库用左竖条 hue 区分)。
 *
 *  Polaris 原版还有个 AI 访谈生成 statement —— 本仓库留 follow-up,
 *  暂时不做 LLM 介入,手写 statement 已经够用。
 *
 *  字段向后兼容:老 doc 里没有这几个字段,store 加载时用空数组兜底。
 */

/** arXiv 主要学科分类。Polaris modal 里展示的就是这几个 + 自定义。
 *  实际上 arXiv 还有 cs.IR / cs.CR / cs.CY 等几十个,这里只挑最常见的
 *  几个作预设,用户也可以在 input 里写自定义分类。 */
export const ARXIV_CATEGORY_PRESETS: readonly string[] = [
  'cs.CL', 'cs.AI', 'cs.LG', 'cs.CV', 'cs.MA', 'stat.ML',
] as const;

/** 单个打分维度。Polaris 用 free-form {name, weight};本仓库简化为
 *  只有 name(weight 留作后续,UI 上还没暴露)。 */
export interface LibraryRubricItem {
  /** 维度名,1-32 字 */
  name: string;
}

export interface UserLibrary {
  id: string;
  /** 1-32 字,trim 后非空(漏斗会再校验一次,见 store.ts:isValidName) */
  name: string;
  /** 1-200 字,trim 后非空(Polaris 强调必填) */
  statement: string;
  /** 7 色挑一;新建默认 emerald */
  hue: LibraryHue;
  /** canonicalArxivId[],顺序 = 加入顺序(用户期望「最新加的在前」可 sorted,这里保留序) */
  paperIds: string[];
  /** arXiv 学科分类,如 ['cs.CL', 'cs.AI']。空数组 = 不按分类过滤。 */
  categories: string[];
  /** 命中关键词,大小写不敏感。每个 1-32 字,去重保序。 */
  inclusionKeywords: string[];
  /** 排除关键词,大小写不敏感。命中则被剔除。 */
  exclusionKeywords: string[];
  /** 自定义打分维度。空数组 = 未设维度,后续打分时只用 statement 兜底。 */
  rubric: LibraryRubricItem[];
  /** epoch ms */
  createdAt: number;
  /** epoch ms。由 store 的私有写入漏斗统一盖章,调用方不需要也不应该自己填。
   *  Gist 合并按本字段做 last-write-wins。 */
  updatedAt: number;
}

/** 整个 doc 的形状。schemaVersion 不匹配时 store 直接丢弃重建(见 store.ts 的
 *  loadUserLibraries),避免旧结构的半残数据在新代码里引发难查的运行时错误。 */
export interface UserLibrariesDoc {
  schemaVersion: 1;
  /** key = library.id,**永不含 vN**。 */
  libraries: Record<string, UserLibrary>;
}

/**
 * 写入结果。
 *
 * 为什么不是 `void`:localStorage 有 ~5MB 配额,而 library 可能有几十条 +
 * paperIds 数组。配额耗尽是**可预期**的失败,不是异常边缘。
 * 本仓库已有一个反面先例: scripts/paper-fulltext.ts 的 writeToLocalStorage
 * 静默吞掉 QuotaExceededError,用户写的东西消失了却什么都看不到。
 * 所以这里把失败做成返回值,强制调用方处理(弹 toast)。
 */
export type WriteResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'quota' | 'unavailable' | 'invalid' };
