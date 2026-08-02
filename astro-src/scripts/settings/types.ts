// settings/types — 跨域纯 interface
// 这些是 settings.ts 顶部不再就地定义的接口, 旧 import path
// `import { ... } from '../scripts/settings'` 仍然能取到(因为主文件
// re-export 它们); 新代码 import 路径可写
// `import type { LLMConfig } from '../scripts/settings/types'` 取同一个定义。

/**
 * LLMConfig 新增 prompt_packs(可选)—— 浏览器侧提示词版本化注入。
 *
 * 结构: { active: { [target]: "<pack_id>:<version>" } }
 * 任意 target 缺位时走 hardcoded 默认(0-break)。
 * 仅在前端 settings-storage JSON 里持久化,不同步到 Gist(各人偏好本地化)。
 */
export interface PromptPacksConfig {
  active?: Record<string, string>;
}

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 提示词版本化配置(可选)。 */
  prompt_packs?: PromptPacksConfig;
}

export interface TopicEntry {
  tag: string;
  description: string;
  enabled: boolean;
}

export interface ProviderPreset {
  baseUrl: string;
  defaultModel: string;
  models: string[];
  label: string;
}
