// /lib/events/index.ts — 公开 API barrel。
//
// 外部调用:
//   import {
//     DPR_THEME_CHANGE,
//     emitDprThemeChange,
//     onDprThemeChange,
//     type DprThemeChangeDetail,
//   } from '../lib/events';
//
// 子模块单向依赖:
//   names.ts  零依赖(纯字符串)
//   types.ts  零依赖(纯 interface)
//   bus.ts    → names + types,无业务依赖

export {
  DPR_THEME_CHANGE,
  DPR_THEME_CHANGE_LEGACY,
  DPR_TOPIC_FILTER_CHANGE,
  DPR_TOPIC_FILTER_CHANGE_LEGACY,
  DPR_DAILY_DAY_OPENED,
  DPR_DAILY_DAY_OPENED_LEGACY,
  PAPER_SELECTION_CHANGE,
  DPR_USER_LIBRARY_CHANGE,
  DPR_USER_LIBRARY_CHANGE_LEGACY,
  DPR_BULK_SELECTION_CHANGE,
  DPR_BULK_SELECTION_CHANGE_LEGACY,
  DPR_USER_LIBRARIES_CHANGE,
  DPR_USER_LIBRARIES_CHANGE_LEGACY,
  DPR_PROJECT_STAGE_CHANGE,
  DPR_PROJECT_STAGE_CHANGE_LEGACY,
  DPR_DRAFT_AUTOSAVE,
  DPR_DRAFT_AUTOSAVE_LEGACY,
  DPR_COMPARE_SET_CHANGE,
  DPR_COMPARE_SET_CHANGE_LEGACY,
  DPR_READING_DASHBOARD_DIRTY,
  DPR_READING_DASHBOARD_DIRTY_LEGACY,
  DPR_IDEA_BANK_CHANGE,
  DPR_IDEA_BANK_CHANGE_LEGACY,
} from './names';

export type {
  DprThemeName,
  DprThemeChangeDetail,
  DprTopicFilterChangeDetail,
  DprDailyDayOpenedDetail,
  PaperSelectionChangeDetail,
  DprUserLibraryChangeDetail,
  DprUserLibraryChangeReason,
  DprBulkSelectionChangeDetail,
  DprUserLibrariesChangeDetail,
  DprUserLibrariesChangeReason,
  DprProjectStageChangeDetail,
  DprProjectStageChangeReason,
  DprDraftAutosaveDetail,
  DprCompareSetChangeDetail,
  DprReadingDashboardDirtyDetail,
  DprIdeaBankChangeDetail,
  DprIdeaBankChangeReason,
} from './types';

export {
  emitDprThemeChange,
  onDprThemeChange,
  emitDprTopicFilterChange,
  onDprTopicFilterChange,
  emitDprDailyDayOpened,
  onDprDailyDayOpened,
  emitPaperSelectionChange,
  onPaperSelectionChange,
  emitDprUserLibraryChange,
  onDprUserLibraryChange,
  emitDprBulkSelectionChange,
  onDprBulkSelectionChange,
  emitDprUserLibrariesChange,
  onDprUserLibrariesChange,
  emitDprProjectStageChange,
  onDprProjectStageChange,
  emitDprDraftAutosave,
  onDprDraftAutosave,
  emitDprCompareSetChange,
  onDprCompareSetChange,
  emitDprReadingDashboardDirty,
  onDprReadingDashboardDirty,
  emitDprIdeaBankChange,
  onDprIdeaBankChange,
} from './bus';