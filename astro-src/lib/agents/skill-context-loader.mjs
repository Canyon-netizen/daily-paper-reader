// astro-src/lib/agents/skill-context-loader.mjs
//
// R7.1 B.1.1: 按 agent stage 读 docs/research-skills/*.md,拼成 system prompt
// 注入上下文块。Designer / Modifier / Reviewer / Reviser 在 buildXxxPrompt
// 时调用 loadSkillContext(stage) 把方法论拼到 system prompt 顶部。
//
// iter #74: 增加 Paperclip 源 —— 已批准(被 pin 住)的 skill 版本也能进上下文。
//   - 远端优先:某份方法论文档在 Paperclip 里有已批准版本 → 用远端那份
//   - 本地兜底:远端没有 / 没 pin / Paperclip 挂了 → 用本地 docs/research-skills/*.md
//   - 治理:只读 pin(已批准),绝不读 currentVersionId(最新写入 = 可能只是提案)
//
// 设计:
//   - STAGE_TO_SKILL 静态映射;每 stage 列 1-2 份相关 skill
//   - 读文件失败 graceful:catch e 后写 WARN,不阻断 agent
//   - 每个 skill 截 3000 字(防止 prompt 过长;7 份 skill 总 ~30KB,截后 ~24KB)
//   - 0 依赖,纯 Node 20+ 内置 fs
//
// 用法:
//   import { loadSkillContext } from './skill-context-loader';
//   const sysPrompt = `${loadSkillContext('draft')}\n\n${DESIGNER_SYSTEM_PROMPT}`;

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  findApprovedFileForStage,
  loadPaperclipSkillCacheFromEnv,
  paperclipSkillStagesFromEnv,
  renderSkillCacheBlock,
  truncateSkillText,
} from './paperclip-skill-source.mjs';

/** R7 agent stage 枚举,与 pipeline.mjs 的 7 stage + 用户维度 stage 对齐 */
export const AGENT_STAGES = [
  'ideation',     // 0: 研究问题定义 / idea 衍生
  'literature',   // 1-2: 文献检索 / 筛选 / 速读
  'experiment',   // 3-4: 实验设计 / 验证
  'draft',        // 5-7: 论文写作 / 综述 / 实验方案
  'review',       // 8: 同行审稿
  'revise',       // 9: rebuttal / 修订
];

/** stage → 需要的 skill 文档列表(每 stage 1-2 份,不超过 3000 字/份) */
const STAGE_TO_SKILL = {
  ideation:   ['defining-research-question.md'],
  literature: ['how-to-lit-review.md', 'how-to-read-paper.md'],
  experiment: ['experiment-design.md'],
  draft:      ['writing-paper.md'],
  review:     ['reviewer-mindset.md', 'writing-review.md'],
  revise:     ['writing-rebuttal.md'],
};

const DOCS_ROOT = 'docs/research-skills';
const MAX_CHARS_PER_FILE = 3000;

/** 读指定 stage 的 skill 文档,拼成 prompt 注入块。
 *  @param {string} stage - AGENT_STAGES 之一
 *  @param {{cache?: object|null, stages?: string[]|null}} [opts]
 *    cache  — Paperclip 已批准 skill 的缓存(不给就从 env 读)
 *    stages — 吃 Paperclip skill 的 stage 列表(null = 全部)
 *  @returns {string} '[方法论上下文 · stage=X]' 头 + 文件内容,空 stage 返回空字符串 */
export function loadSkillContext(stage, opts = {}) {
  const files = STAGE_TO_SKILL[stage];
  if (!files || files.length === 0) return '';

  const cache = opts.cache !== undefined ? opts.cache : loadPaperclipSkillCacheFromEnv();
  const stages = opts.stages !== undefined ? opts.stages : paperclipSkillStagesFromEnv();

  const parts = [`[方法论上下文 · stage=${stage}]`];
  for (const f of files) {
    // 远端优先:Paperclip 里已批准的同名文档覆盖本地那份
    const approved = findApprovedFileForStage(cache, f);
    if (approved) {
      parts.push(
        `### ${f}\n${truncateSkillText(approved.content, MAX_CHARS_PER_FILE)}` +
        `\n(已批准版本 ${cache.versionId} · sha256 ${cache.sha256})`,
      );
      continue;
    }
    const path = join(DOCS_ROOT, f);
    if (!existsSync(path)) {
      parts.push(`### ${f}\n(WARN: file not found at ${path})`);
      continue;
    }
    try {
      const content = readFileSync(path, 'utf8');
      const truncated = content.length > MAX_CHARS_PER_FILE
        ? content.slice(0, MAX_CHARS_PER_FILE) + '\n...[truncated]'
        : content;
      parts.push(`### ${f}\n${truncated}`);
    } catch (e) {
      parts.push(`### ${f}\n(WARN: ${(e && e.message) || String(e)})`);
    }
  }

  // Paperclip 已批准 skill 的总纲(它的 SKILL.md)
  const paperclipBlock = renderSkillCacheBlock(cache, stage, { stages });
  if (paperclipBlock) parts.push(paperclipBlock);

  return parts.join('\n\n');
}

/** 预取 Paperclip 已批准 skill 版本并落缓存(异步)。
 *  loadSkillContext 是同步 API(5 个调用点),所以远端拉取只能走"预取 → 落缓存 → 同步读缓存"。
 *  @param {{fetchImpl?: Function, env?: object, now?: Date}} [options]
 *  @returns {Promise<{status: string, cache: object|null, error: string|null}>} */
export function prefetchSkillContext(options = {}) {
  // 动态 import:保持 loader 的同步调用点零依赖变化
  return import('./paperclip-skill-source.mjs')
    .then((mod) => mod.refreshPaperclipSkillCache(options));
}


/** 检查 stage 是否合法(给 agent CLI 校验用) */
export function isValidStage(stage) {
  return Object.prototype.hasOwnProperty.call(STAGE_TO_SKILL, stage);
}

/** 列出所有可用 stage + 对应 skill(给 --help / debug 用) */
export function listStageSkillMapping() {
  return Object.entries(STAGE_TO_SKILL).map(([stage, files]) => ({ stage, files }));
}