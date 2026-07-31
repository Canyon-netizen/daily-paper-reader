// settings/storage — STORAGE_KEYS 集中点。
// 这里只装"不需要 import 任何 localStorage 行为"的纯数据:
// - localStorage key 字符串 (STORAGE_KEYS)
// - 默认仓库常量 (GITHUB_REPO_DEFAULT)
// - GitHubRepoConfig interface
//
// 行为层(读写这些 key 的函数、跨域同步逻辑)留在 settings.ts 里以避免
// 子目录循环 import。等到 settings.ts 真正拆开后, 这一坨函数应该按域
// 走 ./settings/{github,llm,deepdive,...}.ts —— 见本目录 README。

export const STORAGE_KEYS = {
  llm: 'dpr_analyzer_v1',
  provider: 'dpr_analyzer_provider_v1',
  proxy: 'dpr_analyzer_proxy_v1',
  // 单一 GitHub PAT — 同时用于"Gist 同步配置"和"保存论文到 GitHub"。
  // 需要同时有 `gist`(创建/更新 Gist)和 `repo`(触发 workflow_dispatch)权限。
  // fine-grained PAT: Gist (write) + Actions (write) 或 Contents (write)。
  // 历史 key `dpr_analyzer_gist_token_v1` 仍能读出来做向后兼容,但写入统一用 githubToken。
  githubToken: 'dpr_analyzer_github_token_v1',
  gistId: 'dpr_analyzer_gist_id_v1',
  topics: 'dpr_analyzer_topics_v1',
  categories: 'dpr_analyzer_categories_v1',
  // 长文精读(Deep Dive) — maxPages 默认 20,compact 默认关。
  // 用户在 settings 页改,仅存浏览器 localStorage。
  deepDiveMaxPages: 'dpr_analyzer_deepdive_max_pages_v1',
  deepDiveCompact: 'dpr_analyzer_deepdive_compact_v1',
  deepDiveCompactPages: 'dpr_analyzer_deepdive_compact_pages_v1',
  // 已隐藏论文列表 — 论文详情页"隐藏"按钮的持久化层。
  // 不写 Gist(避免污染 CI $GITHUB_ENV),纯 localStorage。
  hiddenPapers: 'dpr_hidden_papers_v1',
  // 用户标签 — 论文抽屉"打标签"面板 + /settings/ 用户标签面板的持久化层。
  // 与 hiddenPapers 一样纯 localStorage,Gist 同步在 settings.ts 里有专门
  // pullUserTagsFromGist / pushUserTagsToGist,不污染其它字段。
  userTags: 'dpr_user_tags_v1',
  // 已选论文列表 — 多选论文 → 送去 /topic/?from=selection 当种子上下文。
  // 仅 localStorage,不上 Gist(选择是临时工作流,跨设备无意义)。
  selection: 'dpr_paper_selection_v1',
  // paper-analyzer 分析结果本地历史(用户刷新页面后仍能查看、再次访问)。
  // 纯 localStorage,不同步 Gist,也不上 GitHub。
  analyzerHistory: 'dpr_analyzer_history_v1',
  // analyzer 自动同步开关 — 跑完分析后自动触发 save-paper.yml 把笔记落盘到
  // docs/papers/。需要 GitHub PAT(同 saveToGitHub 路径),未配 PAT 时静默跳过。
  // 默认关:用户显式开启才动用户仓库,避免误推。
  autoSaveAnalyzerToGitHub: 'dpr_analyzer_auto_save_v1',
  // 用户图书馆 — 星标 / 阅读状态 / 笔记 / 回收站元数据(Stage 1)。
  // 实现在 lib/user-library/,不在 settings.ts —— 因为 lib/search 和 SSR 侧都要读它,
  // 放 scripts/ 会造成 lib → scripts 的反向依赖。这里只登记 key 名,保证
  // 全站 localStorage key 仍然只有这一个字典。
  userLibrary: 'dpr_user_library_v1',
  // 用户图书馆的 Gist id(Stage 2)。**必须与 gistId 分开**:
  // .github/scripts/load_gist.py:150 取的是 gist 里"第一个 .json 文件",
  // 不是按文件名找 dpr-config.json。把图书馆数据塞进同一个 gist,
  // 每日 pipeline 有可能读到错误的配置源。
  libraryGistId: 'dpr_library_gist_id_v1',
  // 主题在 theme.ts / BaseLayout 里维护,这里不重复
} as const;

// GitHub 仓库配置 — 用于"保存论文到 GitHub"功能触发 workflow_dispatch。
// 用户不需要填这个,默认指向当前仓库。如果 fork 到别处,在 settings 页面改这两个值。
export const GITHUB_REPO_DEFAULT = {
  owner: 'Canyon-netizen',
  repo: 'daily-paper-reader',
  workflow: 'save-paper.yml',
};

export interface GitHubRepoConfig {
  owner: string;
  repo: string;
  workflow: string;
}
