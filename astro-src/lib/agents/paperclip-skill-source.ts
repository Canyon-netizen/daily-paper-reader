/**
 * lib/agents/paperclip-skill-source.ts — typed mirror of paperclip-skill-source.mjs (iter #74).
 *
 * Phase A shim pattern(同 export-bundle / paper-compiler / synthesis-pdf /
 * synthesis-diff / web-search):.mjs 是 runtime 真相源,.ts 只声明 type contract + re-export。
 *
 * 治理要点:.mjs 只读 agent 的 pin(已批准版本),不读 company_skill.currentVersionId
 * (最新写入 = 可能只是 learning agent 的提案)。见 .mjs 顶部注释。
 */

/** Paperclip skill key 的形状:company/<companyId>/<slug> */
export interface PaperclipSkillKeyParts {
  companyId: string;
  slug: string;
}

/** agent skill 快照里的一条 pin 记录 */
export interface PaperclipDesiredSkillEntry {
  key: string;
  versionId: string;
}

/** GET /api/agents/:id/skills 的形状(只关心 pin 相关字段) */
export interface PaperclipAgentSkillSnapshot {
  desiredSkillEntries?: PaperclipDesiredSkillEntry[];
  desiredSkills?: unknown[];
  entries?: unknown[];
  [key: string]: unknown;
}

/** company skill 列表里的一条记录 */
export interface PaperclipCompanySkill {
  id: string;
  key: string;
  currentVersionId?: string | null;
  [key: string]: unknown;
}

/** 版本 fileInventory 里的一条文件 */
export interface PaperclipSkillFile {
  path: string;
  content: string;
}

/** 缓存里的一份已批准版本 */
export interface PaperclipSkillCache {
  schema: number;
  key: string;
  skillId: string;
  versionId: string;
  sha256: string;
  fetchedAt: string;
  files: PaperclipSkillFile[];
}

/** 预取结果 */
export interface PaperclipSkillPrefetchResult {
  /** disabled = 没配;no-pin = 没有已批准版本;error = 拉取失败;ok = 成功 */
  status: 'disabled' | 'no-pin' | 'error' | 'ok';
  cache: PaperclipSkillCache | null;
  error: string | null;
  cached?: boolean;
}

/** 预取选项 */
export interface PaperclipSkillPrefetchOptions {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: Date;
}

export {
  DEFAULT_PAPERCLIP_API_URL,
  DEFAULT_PAPERCLIP_SKILL_CACHE,
  DEFAULT_PAPERCLIP_SKILL_TTL_MS,
  PAPERCLIP_SKILL_MAX_CHARS,
  parsePaperclipSkillKey,
  pickPinnedVersionId,
  pickSkillIdByKey,
  selectVersionFiles,
  computeSkillFilesSha256,
  buildSkillCache,
  parseSkillCache,
  readSkillCache,
  writeSkillCache,
  isSkillCacheFresh,
  parseStageList,
  stageUsesPaperclipSkill,
  findApprovedFileForStage,
  truncateSkillText,
  renderSkillCacheBlock,
  prefetchPaperclipSkill,
  refreshPaperclipSkillCache,
  loadPaperclipSkillCacheFromEnv,
  paperclipSkillStagesFromEnv,
  paperclipSkillCachePath,
  paperclipSkillKeyFromEnv,
} from './paperclip-skill-source.mjs';
