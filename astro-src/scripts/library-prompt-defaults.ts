// astro-src/scripts/library-prompt-defaults.ts
//
// 默认的 Polaris 提示词包 pin 映射(PR 阶段 1)。
// 任何模块只要 import 这份 DEFAULT_LIBRARY_PACKS 并设置到 settings 即可启用
// 6 个 Polaris 提示词包;不设置就走原 hardcoded 行为(0-break)。
//
// 设计:
//   - 单源真理:本文件是 6 个 target 默认 pin 的唯一源;新增 library.* target
//     必须在这里也加一行。
//   - 不在 settings 初始化时强制注入:留给用户在 settings UI 显式开启;
//     浏览器侧从 settings-page / settings storage 读 / 写。
//   - Python 侧默认值见 config/defaults.yaml 的 prompt_packs.active。
//
// 同步点:每次新增 / 改 Polaris 提示词版本,这里要同步 bump。

export const DEFAULT_LIBRARY_PACKS: Readonly<Record<string, string>> = Object.freeze({
  'library.compile': 'library-compile:2026-08-02',
  'library.relevance': 'library-relevance:2026-08-02',
  'library.concept_def': 'library-concept-def:2026-08-02',
  'library.figure': 'library-figure:2026-08-02',
  'library.digest': 'library-digest:2026-08-02',
  'library.digest_synth': 'library-digest:2026-08-02',
  'library.trend': 'library-digest:2026-08-02',
  'library.chat': 'library-chat:2026-08-02',
});

/**
 * 把默认 library.* pin 合并进 config.prompt_packs.active;
 * 已存在的非空 pin 不被覆盖(让用户自定优先生效)。
 * 任何异常都返回原 config,绝不抛(graceful)。
 */
export function withDefaultLibraryPacks<T extends { prompt_packs?: { active?: Record<string, string> } }>(
  config: T,
): T {
  try {
    const active = { ...(config.prompt_packs?.active || {}) };
    let dirty = false;
    for (const [target, pin] of Object.entries(DEFAULT_LIBRARY_PACKS)) {
      if (typeof active[target] !== 'string' || !active[target].includes(':')) {
        active[target] = pin;
        dirty = true;
      }
    }
    if (!dirty && config.prompt_packs?.active) return config;
    return {
      ...config,
      prompt_packs: { ...(config.prompt_packs || {}), active },
    };
  } catch {
    return config;
  }
}
