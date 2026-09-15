/**
 * agents/skill-context-loader.mjs — skill-context-loader.ts 的 JavaScript 镜像。
 *
 * 单一真相源:skill-context-loader.ts(浏览器侧,带类型)
 *   ↕  行为必须一致(手维护镜像;改任一文件务必同步另一份)
 * 镜像文件:skill-context-loader.mjs(Node CLI 直接 import)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const SKILL_DOCS_ROOT = 'docs/research-skills';

export const STAGE_TO_SKILL = {
  ideation:    ['defining-research-question.md'],
  literature:  ['how-to-lit-review.md', 'how-to-read-paper.md'],
  experiment:  ['experiment-design.md'],
  draft:       ['writing-paper.md'],
  review:      ['reviewer-mindset.md', 'writing-review.md'],
  revise:      ['writing-rebuttal.md'],
};

export const SKILL_DOC_MAX_CHARS = 3000;

// ---------------------------------------------------------------------------
// In-memory cache: 同进程内同 stage 多次调用走缓存
// ---------------------------------------------------------------------------

const _cache = new Map();

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * loadSkillContext(stage) — 加载 stage 对应的所有 skill 文档, 拼成一段
 * "[方法论上下文 · stage=xxx] ### file\n<content>" 形式的字符串。
 * 失败 graceful(WARN 占位), 文件截断到 SKILL_DOC_MAX_CHARS。
 */
export function loadSkillContext(stage) {
  if (_cache.has(stage)) return _cache.get(stage);
  const files = STAGE_TO_SKILL[stage] ?? [];
  if (files.length === 0) return '';

  const parts = [`[方法论上下文 · stage=${stage}]`];
  for (const f of files) {
    const path = join(SKILL_DOCS_ROOT, f);
    try {
      const content = readFileSync(path, 'utf8');
      const trimmed = content.length > SKILL_DOC_MAX_CHARS
        ? content.slice(0, SKILL_DOC_MAX_CHARS) + '\n…(truncated)'
        : content;
      parts.push(`### ${f}\n${trimmed}`);
    } catch (e) {
      parts.push(`### ${f}\n(WARN: ${e.message})`);
    }
  }

  const out = parts.join('\n\n');
  _cache.set(stage, out);
  return out;
}

export function resetSkillContextCache() {
  _cache.clear();
}

export function listSkillDocsForStage(stage) {
  return [...(STAGE_TO_SKILL[stage] ?? [])];
}