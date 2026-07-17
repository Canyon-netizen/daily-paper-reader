// settings/types — 跨域纯 interface
// 这些是 settings.ts 顶部不再就地定义的接口, 旧 import path
// `import { ... } from '../scripts/settings'` 仍然能取到(因为主文件
// re-export 它们); 新代码 import 路径可写
// `import type { LLMConfig } from '../scripts/settings/types'` 取同一个定义。

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
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
