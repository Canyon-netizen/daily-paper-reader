/**
 * agents/skill-context-loader.ts — read research-skill docs as prompt context.
 *
 * Designer / Modifier / Reviewer / Reviser 等 agents 真正消费 docs/research-skills/
 * 下的方法论文档作为 system prompt 的"方法论上下文"段,而不是凭 LLM 记忆自由发挥。
 *
 * iter #74: 增加 Paperclip 源 —— 已批准(被 pin 住)的 skill 版本也能进上下文。
 *   - 远端优先:某份方法论文档在 Paperclip 里有已批准版本 → 用远端那份
 *   - 本地兜底:远端没有 / 没 pin / Paperclip 挂了 → 用本地 docs/research-skills/*.md
 *   - 治理:只读 pin(已批准),绝不读 currentVersionId(最新写入 = 可能只是提案)
 *
 * 单一真相源:skill-context-loader.ts (浏览器侧, 带类型)
 *   ↕  行为必须与 skill-context-loader.mjs 一致(手维护镜像)
 * 镜像文件:skill-context-loader.mjs (Node CLI 直接 import)
 *
 * 用法:
 *   import { loadSkillContext, SKILL_DOCS_ROOT } from './skill-context-loader';
 *   const ctx = loadSkillContext('ideation');  // → "[方法论上下文 · stage=ideation] ..."
 *
 * 设计原则:
 *   - 截断:每个文档最多 3000 字符(总开销 ~24KB, 控制 LLM token cost)
 *   - graceful:文件不存在 → 输出 WARN 行,不抛异常, 让 round 继续跑
 *   - 缓存:同一进程内同 stage 多次调用走 in-memory cache(避免重复 IO)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findApprovedFileForStage,
  loadPaperclipSkillCacheFromEnv,
  paperclipSkillStagesFromEnv,
  renderSkillCacheBlock,
  truncateSkillText,
  type PaperclipSkillCache,
} from './paperclip-skill-source.mjs';

// ---------------------------------------------------------------------------
// 类型 + 常量
// ---------------------------------------------------------------------------

/** Agent 阶段 → 应该注入的 skill 文档列表 */
export type AgentStage =
  | 'ideation'
  | 'literature'
  | 'experiment'
  | 'draft'
  | 'review'
  | 'revise';

/** skill 文档根目录(相对 repo root) */
export const SKILL_DOCS_ROOT = 'docs/research-skills';

/** 每个 stage 对应的 skill 文档列表
 *  注:`ideation` 计划挂 `defining-research-question.md`,但该 skill doc 当前不存在;
 *  缺文件时 loader 走 graceful WARN(不抛),待用户后续补齐。
 *  等 `defining-research-question.md` 落盘后无需改本表。 */
export const STAGE_TO_SKILL: Record<AgentStage, string[]> = {
  ideation: ['defining-research-question.md'],
  literature: ['how-to-lit-review.md', 'how-to-read-paper.md'],
  experiment: ['experiment-design.md'],
  draft: ['writing-paper.md'],
  review: ['reviewer-mindset.md', 'writing-review.md'],
  revise: ['writing-rebuttal.md'],
};

/** 每个 skill 文件最多取的字符数(截断 LLM prompt 总开销) */
export const SKILL_DOC_MAX_CHARS = 3000;

/** loadSkillContext 的可选参数 */
export interface LoadSkillContextOptions {
  /** Paperclip 已批准 skill 的缓存(不给就从 env 读) */
  cache?: PaperclipSkillCache | null;
  /** 吃 Paperclip skill 的 stage 列表(null = 全部) */
  stages?: string[] | null;
}

// ---------------------------------------------------------------------------
// In-memory cache: 同进程内同 stage 多次调用走缓存,避免重复 IO
// ---------------------------------------------------------------------------

/** cache key 带上已批准版本号:版本一换,缓存自动失效 */
const _cache = new Map<string, string>();

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * loadSkillContext(stage) — 加载一个 stage 对应的所有 skill 文档,
 * 拼成一段 "[方法论上下文 · stage=xxx] ### file\n<content>" 形式的字符串,
 * 可直接 prepend 到 Designer / Modifier / Reviewer 等 agent 的 system prompt 顶部。
 *
 * 失败处理:
 *   - 文件不存在或读不出来 → 写入 "(WARN: <error>)" 占位行,不抛。
 *   - stage 不在 AgentStage 联合中 → 返回空字符串 + 静默。
 *
 * 缓存:
 *   - 同一 stage 第二次起走 in-memory cache;若需要强制 reload, 调 resetSkillContextCache()。
 */
export function loadSkillContext(stage: AgentStage, opts: LoadSkillContextOptions = {}): string {
  const cache = opts.cache !== undefined ? opts.cache : loadPaperclipSkillCacheFromEnv();
  const stages = opts.stages !== undefined ? opts.stages : paperclipSkillStagesFromEnv();
  const cacheKey = `${stage}::${cache?.versionId ?? 'no-paperclip'}`;
  if (_cache.has(cacheKey)) return _cache.get(cacheKey)!;
  const files = STAGE_TO_SKILL[stage] ?? [];
  if (files.length === 0) return '';

  const parts: string[] = [`[方法论上下文 · stage=${stage}]`];
  for (const f of files) {
    // 远端优先:Paperclip 里已批准的同名文档覆盖本地那份
    const approved = findApprovedFileForStage(cache, f);
    if (approved) {
      parts.push(
        `### ${f}\n${truncateSkillText(approved.content, SKILL_DOC_MAX_CHARS)}` +
        `\n(已批准版本 ${cache!.versionId} · sha256 ${cache!.sha256})`,
      );
      continue;
    }
    const path = join(SKILL_DOCS_ROOT, f);
    try {
      const content = readFileSync(path, 'utf8');
      const trimmed = content.length > SKILL_DOC_MAX_CHARS
        ? content.slice(0, SKILL_DOC_MAX_CHARS) + '\n…(truncated)'
        : content;
      parts.push(`### ${f}\n${trimmed}`);
    } catch (e) {
      parts.push(`### ${f}\n(WARN: ${(e as Error).message})`);
    }
  }

  // Paperclip 已批准 skill 的总纲(它的 SKILL.md)
  const paperclipBlock = renderSkillCacheBlock(cache, stage, { stages });
  if (paperclipBlock) parts.push(paperclipBlock);

  const out = parts.join('\n\n');
  _cache.set(cacheKey, out);
  return out;
}

/**
 * resetSkillContextCache() — 清空 in-memory cache。
 * 测试或热重载场景用;常规 round-run 流程不需要调。
 */
export function resetSkillContextCache(): void {
  _cache.clear();
}

/**
 * listSkillDocsForStage(stage) — 纯查询:一个 stage 配了几个 skill 文档。
 * 给 UI / 调试输出用,不改 prompt 行为。
 */
export function listSkillDocsForStage(stage: AgentStage): string[] {
  return [...(STAGE_TO_SKILL[stage] ?? [])];
}