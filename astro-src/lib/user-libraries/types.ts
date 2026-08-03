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

/**
 * LibraryDefinition —— 对照 Polaris docs/api-lit.md §P8a:
 * `direction_libraries.definition` 列(NOT NULL JSONB,Polaris 后端 schema)。
 *
 * DPR 没有 Postgres,把这个 blob 嵌进 UserLibrary.definition 一起存 localStorage
 * + Gist。Schema v2 起强制:新库必有 statement + keywords;in_scope/out_of_scope/
 * questions/anchors 是可选但 UI 会暴露。
 *
 * 设计要点:
 *  - **不要把 anchors 局限成 arxiv_id** —— 允许 doi / arxiv-id / free-text 三种,
 *    Polaris 实际也是这样。客户端需各自归一化到 canonicalArxivId。
 *  - **goals / in_scope / out_of_scope / questions 都是 string[]** —— 人写一句话
 *    的颗粒度,Polaris 在 schema 里就是这么设计的。不要再细分。
 *  - **cadence**:Polaris 的「自动同步频率」语义,DPR 单人静态站没有 cron,
 *    留作 user-facing label(写「每日」「每周」告诉用户预期),**不真调度**。
 *    Polaris 真正触发 ingest 的也是 cron + voyage agent;DPR 走手动按钮。
 */
export interface LibraryDefinition {
  /** 主声明,1-500 字。Polaris 也用,这是「这个库关心什么」的总纲。
   *  与顶层 UserLibrary.statement 重复:Polaris 在数据库里 statement 列与
   *  definition.statement 同步,我们这里把 statement 视为冗余 + 编辑友好,
   *  显示时优先 statement,fallback definition.statement。 */
  statement: string;
  /** 期望的同步频率 label(例如 "daily" / "weekly" / "manual")。Polaris
   *  真正用 cron 调 voyage;DPR 只是 UI label,不调度。 */
  cadence: 'manual' | 'daily' | 'weekly' | 'monthly';
  /** 锚点论文。命中即给高分(Polaris: anchors 内的论文强制 included)。 */
  anchors: LibraryAnchor[];
  /** 关键词规则。空 = 不按关键词过滤。 */
  keywords: {
    arxivCategories: string[];
    include: string[];
    exclude: string[];
  };
  /** 自定义打分维度(沿用顶层 rubric,这里冗余一份给 Polaris 兼容)。 */
  rubric: LibraryRubricItem[];
  /** 库的目标。1-3 句话形式。Polaris 用来生成 digest prompt 上下文。 */
  goals: string[];
  /** 范围内主题(粒度比 keywords 更粗,如「长上下文」「思维链」)。 */
  inScope: string[];
  /** 范围外主题(命中即剔除)。与 keywords.exclude 重叠但更宽 ——
   *  排除关键词是机械匹配,in_scope/out_of_scope 是语义层面的「我不关心」。 */
  outOfScope: string[];
  /** 库要回答的研究问题(LLM ingest 时当 prompt 上下文)。 */
  questions: string[];
}

/** 锚点论文 = 已知与本库方向高度相关的「种子论文」。Polaris 强制 included。 */
export interface LibraryAnchor {
  /** 'arxiv' | 'doi' | 'free'。'arxiv' 走 canonicalArxivId 归一,
   *  'doi' 在 ingest 时去 openalex 查 arxiv_id,失败就降级成 free。 */
  kind: 'arxiv' | 'doi' | 'free';
  /** kind='arxiv':带不带 vN 都行;客户端归一化到 canonicalArxivId */
  value: string;
  /** 一句话注释:为什么这是锚点(选论文 / 写 review 时回忆)。1-100 字。 */
  note?: string;
}

/**
 * LibraryPaperMeta —— 单篇论文在某条 library 内的「成员元数据」。
 *
 * 对照 Polaris `library_papers` 表(后端唯一真相):
 *   - library_id     ↔ LibraryPaperMeta.lid
 *   - paper_id       ↔ LibraryPaperMeta.cx
 *   - relevance_score ↔ LibraryPaperMeta.relevanceScore
 *   - relevance_reason ↔ LibraryPaperMeta.relevanceReason
 *   - tldr_note      ↔ LibraryPaperMeta.tldrNote
 *   - status         ↔ LibraryPaperMeta.status
 *   - trash_reason   ↔ LibraryPaperMeta.trashReason
 *
 * Polaris 的 `status` 是状态机:candidate → scored → included / excluded;
 * 同一篇论文在多个 library 里有不同 status —— 这是与单数 `user-library` 的
 * (单篇论文级 star / status) 不同维度的状态,**绝不合并**。
 *
 * 存储:`UserLibrariesDoc.libraries[libId].papers` = Record<cx, LibraryPaperMeta>。
 * 老 v1/v2 doc 没有此字段,loadUserLibraries() 升级时置空对象 `{}`。
 */
export type LibraryPaperStatus =
  | 'candidate'   // LLM 没打过分,候选状态(刚被 ingest 拉进来)
  | 'scored'      // LLM 打过分了,等用户确认
  | 'included'    // 用户接受 / 原本就在 paperIds[]
  | 'excluded'    // 用户/打分剔除
  | 'trashed';    // 回收站

export interface LibraryPaperMeta {
  /** 0-1;LLM 给的相关度。undefined = 还没打分 */
  relevanceScore?: number;
  /** 1-200 字:LLM 给的「为什么这个分」一句话 */
  relevanceReason?: string;
  /** 1-500 字:本库专属 TL;DR(可能与论文 wiki_compiled 不同)。
   *  比如同一篇 RL 论文,在「LLM Agent」库里侧重 agent 部分,
   *  在「RL 算法」库里侧重算法部分。 */
  tldrNote?: string;
  status: LibraryPaperStatus;
  /** trashed / excluded 的原因标签('irrelevant' | 'manual' | 'duplicate' | 等) */
  trashReason?: string;
  /** epoch ms;store 漏斗盖 */
  updatedAt: number;
}

export interface UserLibrary {
  id: string;
  /** 1-32 字,trim 后非空(漏斗会再校验一次,见 store.ts:isValidName) */
  name: string;
  /** 1-200 字,trim 后非空(Polaris 强调必填)。
   *  顶层 statement 是「卡片上一眼看到的总述」,definition.statement 是
   *  「库方向的全量声明」(更细)。 */
  statement: string;
  /** 7 色挑一;新建默认 emerald */
  hue: LibraryHue;
  /** canonicalArxivId[],顺序 = 加入顺序(用户期望「最新加的在前」可 sorted,这里保留序) */
  paperIds: string[];
  /** arXiv 学科分类,如 ['cs.CL', 'cs.AI']。空数组 = 不按分类过滤。
   *  这是顶层冗余字段,与 definition.keywords.arxivCategories 同义;
   *  顶层为「快速过滤」、definition 为「Polaris 兼容 + digest 上下文」。 */
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
  /** Polaris P8a LibraryDefinition。可选 —— v1 老库没有,store 加载时
   *  用 defaultLibraryDefinition() 兜底,UI 显示 v1 老字段。 */
  definition?: LibraryDefinition;
  /** 公共申请状态。Polaris 用 status='pending'/'active'/'rejected';
   *  DPR 单人静态站没有 admin,但保留 status 字段,用户可手动切 public(等于
   *  公开到 Gist) / pending(申请中) / personal(私有)。 */
  visibility?: 'personal' | 'pending' | 'public';
  /** 每篇论文在本库内的元数据(Polaris library_papers 表的镜像)。
   *  key = canonicalArxivId,**永不含 vN**。老库没有 = `{}`。 */
  papers: Record<string, LibraryPaperMeta>;
}

/** 兜底 definition —— 用于老 v1 doc 没有 definition 字段时。 */
export function defaultLibraryDefinition(statement: string): LibraryDefinition {
  return {
    statement,
    cadence: 'manual',
    anchors: [],
    keywords: { arxivCategories: [], include: [], exclude: [] },
    rubric: [],
    goals: [],
    inScope: [],
    outOfScope: [],
    questions: [],
  };
}

/** 整个 doc 的形状。schemaVersion 不匹配时 store 直接丢弃重建(见 store.ts 的
 *  loadUserLibraries),避免旧结构的半残数据在新代码里引发难查的运行时错误。
 *
 *  v2 加入 LibraryDefinition;老 v1 doc 加载时升级(in-place 把顶层字段拷到
 *  definition,保留原 statement / categories / keywords / rubric)。
 *  v3 加入 papers:Record<cx, LibraryPaperMeta>(Polaris library_papers 镜像),
 *  老 doc 加载时此字段兜底为 `{}`。 */
export interface UserLibrariesDoc {
  schemaVersion: 3;
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
