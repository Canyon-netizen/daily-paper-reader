// astro-src/lib/storage.ts
//
// Re-exports the localStorage / Gist / LLM-default primitives that
// `lib/user-tags.ts` and `lib/paper-relations.ts` need from
// `scripts/settings.ts`. This is the boundary that fixes the
// `lib → scripts` reverse-dependency (lib used to import directly from
// scripts/; lib/ is meant to be the lower layer).
//
// The actual implementations stay in `scripts/settings.ts` for now — moving
// the bodies would be a follow-up refactor. This module just gives `lib/`
// a stable import path so future refactors can move the bodies here without
// changing the call sites.

export {
  STORAGE_KEYS,
  GITHUB_REPO_DEFAULT,
  loadGitHubToken,
  setGitHubToken,
  getGistToken,
  setGistToken,
  loadGitHubRepo,
  setGitHubRepo,
  LLM_DEFAULTS,
  loadSettings,
  getGistId,
  setGistId,
  GIST_FILENAME,
  loadUserTags,
  saveUserTagsRaw,
  getUserTags,
  setUserTags,
  addTag,
  removeTag,
  clearAllUserTags,
  pullUserTagsFromGist,
  pushUserTagsToGist,
  // 隐藏论文 — lib/user-library/snapshot.ts 需要读它来组装快照。
  // 真值仍归 scripts/settings.ts 所有,这里只开一个 lib 侧的读取通道。
  loadHiddenPapers,
  addHiddenPaper,
  removeHiddenPaper,
  // Stage 2:用户图书馆 Gist 同步需要 GitHub token。
  // 同 loadHiddenPapers 一致,只读 channel,不走 scripts → lib 反向。
} from '../scripts/settings';

export type { LLMConfig, GitHubRepoConfig, UserTag, UserTagMap, GistUserTagsResult } from '../scripts/settings';