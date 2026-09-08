// /lib/events/names.ts — 全站客户端事件名集中。
//
// 为什么需要这个模块:
//   - 跨多文件emit的同一事件,字符串字面量副本一旦拼写错就静默失败;
//     用 const 引用就编译期拦截。
//   - 新增事件时统一在这里一行 grep,不需要全局搜字符串。
//   - detail 类型集中在 events/types.ts,与 event name 配对(CustomEvent<Detail> 推断)。
//
// 命名前缀: 'dpr:' — domain-specific,避免和浏览器内置事件撞车。
// 兼容性:`paper-selection-change` 沿用旧连字符风格,因为 settings.ts:343 / topic-search/init.ts:115
// 已经在外部监听这个字符串,改前缀会让 sub-page 错挂监听器。
//
// 关注点: 这是"事件名 + detail"的契约层,具体 payload 由 emit/listen 调用方自行 fill,
// 但 events/types.ts 提供 TS 联合类型保证 detail 不漏字段。

/** 主题切换 — detail: { theme: 'light' | 'dark' | 'contrast' | 'auto' }
 *  旧名 `dpr-theme-change`(连字符,theme.ts 当前用法)做 alias 兼容。 */
export const DPR_THEME_CHANGE = 'dpr:theme-change';
/** @deprecated 兼容旧调用,推荐用 DPR_THEME_CHANGE */
export const DPR_THEME_CHANGE_LEGACY = 'dpr-theme-change';

/** 首页日历主题过滤 — detail: { topic: string | null }
 *  旧名 `dpr-topic-filter-change`(连字符,DailyCalendar + topic-filter-bridge)做 alias。 */
export const DPR_TOPIC_FILTER_CHANGE = 'dpr:topic-filter-change';
/** @deprecated 兼容旧调用 */
export const DPR_TOPIC_FILTER_CHANGE_LEGACY = 'dpr-topic-filter-change';

/** 首页日历点击某日展开当日详情 — detail: { date: string }
 *  旧名 `daily-day-opened`(DailyCalendar.astro:585 当前用法)做 alias。 */
export const DPR_DAILY_DAY_OPENED = 'dpr:daily-day-opened';
/** @deprecated 兼容旧调用 */
export const DPR_DAILY_DAY_OPENED_LEGACY = 'daily-day-opened';

/** 论文选择状态变化(选择 / 取消 / 清空)— detail: void
 *  两个 emit 源:
 *   - scripts/paper-selection.ts (UI 多选 / 全清)
 *   - scripts/settings.ts:349 (设置变更后清空旧选择)
 *  同一个事件名两源触发,原 settings.ts const 重构(见 feedback_settings_selection_must_emit)。 */
export const PAPER_SELECTION_CHANGE = 'paper-selection-change';

/** 用户图书馆状态变化(星标 / 阅读状态 / 笔记 / 回收站)—
 *  detail: DprUserLibraryChangeDetail { ids, reason }
 *
 *  **单一 emit 源**:只有 lib/user-library/store.ts 的私有写入漏斗会发这个事件。
 *  这是刻意的 —— feedback_settings_selection_must_emit 记录过的 bug 就是"两条写入
 *  路径不共享事件源",导致 UI 计数不刷新。任何新增的用户态写入都必须走那个漏斗。
 *
 *  detail 里带 ids 是为了让 listener 能只重绘受影响的行(610 行全量重绘太贵);
 *  但 listener 仍应把 detail 当**提示**而非真值,状态真值始终从 store 读。 */
export const DPR_USER_LIBRARY_CHANGE = 'dpr:user-library-change';
/** @deprecated 兼容风格一致性而提供的 legacy 别名(与本文件其它事件同构)。 */
export const DPR_USER_LIBRARY_CHANGE_LEGACY = 'dpr-user-library-change';

/** 工作台批量选择(Stage 10) — detail: DprBulkSelectionChangeDetail { ids }
 *
 *  与 scripts/paper-selection.ts 的 PAPER_SELECTION_CHANGE(dpr_paper_selection_v1,
 *  软上限 8,**落盘**)刻意分开:
 *   - 这是工作台的批量操作(批量隐藏 / 批量加标签 / 批量导出),单页面会话内
 *     有效,**不**走 topic 种子,刷新即丢;硬上限 100 防误操作。
 *   - topic 种子上限 8 是为 LLM 上下文设计,批量 100 是为 UI 列表设计,
 *     混用会把 /topic/?from=selection 的拼 context 路径撞爆。
 *
 *  **单一 emit 源**:只有 scripts/paper-bulk.ts 会发。listener 直接调
 *  getBulkSelection() 读真值,不要从 detail.ids 还原。 */
export const DPR_BULK_SELECTION_CHANGE = 'dpr:bulk-selection-change';
/** @deprecated 兼容旧 listener,新代码用 DPR_BULK_SELECTION_CHANGE。 */
export const DPR_BULK_SELECTION_CHANGE_LEGACY = 'dpr-bulk-selection-change';

/** 用户文献库(复数 libraries)状态变化(新建 / 重命名 / 改描述 / 删 /
 *  加论文 / 移论文 / 改 hue / 同步)—
 *  detail: DprUserLibrariesChangeDetail { ids, reason }
 *
 *  **与 DPR_USER_LIBRARY_CHANGE(单数 per-paper 状态)刻意分开**:
 *   - 单数 user-library:每篇论文的状态(星标/笔记/...),key = canonicalArxivId;
 *   - 复数 user-libraries:用户自建文献库列表,key = libraryId。
 *   混用会让 listener 拿到的 reason/ids 语义混乱。
 *
 *  **单一 emit 源**:只有 lib/user-libraries/store.ts 的私有写入漏斗会发。
 *  listener 直接调 listUserLibraries() 读真值,不要从 detail.ids 还原。 */
export const DPR_USER_LIBRARIES_CHANGE = 'dpr:user-libraries-change';
/** @deprecated 兼容风格一致性而提供的 legacy 别名(与本文件其它事件同构)。 */
export const DPR_USER_LIBRARIES_CHANGE_LEGACY = 'dpr-user-libraries-change';

/** Project 工作区阶段变化(创建 / 归档 / 重命名 / 论文移动 / 加入 / 移除)—
 *  detail: DprProjectStageChangeDetail { ids, reason, projectId }
 *
 *  **单一 emit 源**:只有 lib/user-libraries/store.ts 的 project stage 漏斗会发。
 *  这是 Project = UserLibrary v5 的核心事件,listener 据 reason 决定重绘粒度。
 *
 *  reason 取值:
 *   - 'stage-created':新建阶段
 *   - 'stage-archived':归档阶段
 *   - 'stage-renamed':重命名阶段
 *   - 'paper-added':论文加入阶段
 *   - 'paper-removed':论文移出阶段
 *   - 'paper-moved':论文跨阶段移动 */
export const DPR_PROJECT_STAGE_CHANGE = 'dpr:project-stage-change';
/** @deprecated 兼容风格一致性而提供的 legacy 别名。 */
export const DPR_PROJECT_STAGE_CHANGE_LEGACY = 'dpr:project-stage-change';

/** 草稿自动保存(去抖动后每 30s 触发一次)—
 *  detail: DprDraftAutosaveDetail { draftId, savedAt }
 *
 *  **单一 emit 源**:只有 lib/projects/draft-store 会发。
 *  UI 订阅此事件以更新「最近保存」指示器,不要从 detail 读真值。 */
export const DPR_DRAFT_AUTOSAVE = 'dpr:draft-autosave';
/** @deprecated 兼容风格一致性而提供的 legacy 别名。 */
export const DPR_DRAFT_AUTOSAVE_LEGACY = 'dpr:draft-autosave';

/** 对比集合变化—
 *  detail: DprCompareSetChangeDetail { ids }
 *
 *  **单一 emit 源**:只有 lib/projects/compare-store 会发。
 *  这是 Project 对比功能的专用事件,ids 为当前对比集中的 canonicalArxivId。 */
export const DPR_COMPARE_SET_CHANGE = 'dpr:compare-set-change';
/** @deprecated 兼容风格一致性而提供的 legacy 别名。 */
export const DPR_COMPARE_SET_CHANGE_LEGACY = 'dpr:compare-set-change';

/** 阅读仪表盘脏标记(数据变更后需要刷新)—
 *  detail: DprReadingDashboardDirtyDetail { source }
 *
 *  **单一 emit 源**:只有 lib/projects/dashboard-store 会发。
 *  source 标识触发来源('stage' | 'draft' | 'compare'),listener 据此决定刷新范围。 */
export const DPR_READING_DASHBOARD_DIRTY = 'dpr:reading-dashboard-dirty';
/** @deprecated 兼容风格一致性而提供的 legacy 别名。 */
export const DPR_READING_DASHBOARD_DIRTY_LEGACY = 'dpr:reading-dashboard-dirty';

/** Idea Bank 状态变化(生成 / 状态变更 / 删除 / 清除)—
 *  detail: DprIdeaBankChangeDetail { projectId, reason }
 *
 *  **单一 emit 源**:只有 astro-src/scripts/projects-idea-bank.ts 会发。
 *  这是 Project Idea Bank 功能的核心事件,listener 据 reason 决定刷新粒度。
 *
 *  reason 取值:
 *   - 'generate':新想法生成
 *   - 'status':想法状态变更(star/reject/promote)
 *   - 'delete':删除单个想法
 *   - 'purge':清除整个项目的想法 */
export const DPR_IDEA_BANK_CHANGE = 'dpr:idea-bank-change';
/** @deprecated 兼容风格一致性而提供的 legacy 别名。 */
export const DPR_IDEA_BANK_CHANGE_LEGACY = 'dpr:idea-bank-change';