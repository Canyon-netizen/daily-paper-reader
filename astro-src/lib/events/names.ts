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