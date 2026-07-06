// 共享设置层 — /paper-analyzer/ 和 /settings/ 页面都用这里读写 localStorage。
// 所有 key 名在这里集中定义,避免两边漂移。
//
// 浏览器里没有任何敏感数据离开浏览器:LLM key / Gist token 只存在 localStorage,
// 只有用户主动"同步到 Gist"才会上传到用户自己的 Gist,后台 workflow 拉这个 Gist 当配置源。

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

// ============================================================================
// Storage keys — 在这里集中管理,改 key 名只需要改这一处
// ============================================================================
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

export function loadGitHubToken(): string {
  try {
    // 优先用新 key,旧 key 也能读出来(用户从老版本升级时不丢 token)
    const cur = localStorage.getItem(STORAGE_KEYS.githubToken);
    if (cur) return cur.trim();
    const legacy = localStorage.getItem('dpr_analyzer_gist_token_v1');
    if (legacy) return legacy.trim();
    return '';
  } catch { return ''; }
}
export function setGitHubToken(t: string): void {
  try {
    if (t) localStorage.setItem(STORAGE_KEYS.githubToken, t);
    else localStorage.removeItem(STORAGE_KEYS.githubToken);
  } catch { /* ignore */ }
}

// 向后兼容:以前 getGistToken() 直接读 dpr_analyzer_gist_token_v1。
// 现在统一指向 githubToken,这样新代码用 loadGitHubToken 就行,旧 syncToGist 调用也能工作。
export function getGistToken(): string { return loadGitHubToken(); }
export function setGistToken(t: string): void { setGitHubToken(t); }

const GH_OWNER_KEY = 'dpr_analyzer_github_owner_v1';
const GH_REPO_KEY = 'dpr_analyzer_github_repo_v1';
const GH_WORKFLOW_KEY = 'dpr_analyzer_github_workflow_v1';

export function loadGitHubRepo(): GitHubRepoConfig {
  const get = (k: string, fallback: string) => {
    try { return (localStorage.getItem(k) || '').trim() || fallback; }
    catch { return fallback; }
  };
  return {
    owner: get(GH_OWNER_KEY, GITHUB_REPO_DEFAULT.owner),
    repo: get(GH_REPO_KEY, GITHUB_REPO_DEFAULT.repo),
    workflow: get(GH_WORKFLOW_KEY, GITHUB_REPO_DEFAULT.workflow),
  };
}
export function setGitHubRepo(cfg: Partial<GitHubRepoConfig>): void {
  try {
    if (cfg.owner) localStorage.setItem(GH_OWNER_KEY, cfg.owner);
    if (cfg.repo) localStorage.setItem(GH_REPO_KEY, cfg.repo);
    if (cfg.workflow) localStorage.setItem(GH_WORKFLOW_KEY, cfg.workflow);
  } catch { /* ignore */ }
}

export const LLM_DEFAULTS = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
};

// ============================================================================
// LLM / Provider
// ============================================================================
export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  siliconflow: {
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    models: [
      'Qwen/Qwen2.5-7B-Instruct',
      'Qwen/Qwen2.5-14B-Instruct',
      'Qwen/Qwen2.5-32B-Instruct',
      'Qwen/Qwen2.5-72B-Instruct',
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'THUDM/glm-4-9b-chat',
    ],
  },
  moonshot: {
    label: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  zhipu: {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-airx', 'glm-4-plus'],
  },
  minimax: {
    label: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-Text-01',
    models: ['MiniMax-Text-01', 'abab6.5s-chat', 'abab5.5-chat'],
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  custom: {
    label: '自定义',
    baseUrl: '',
    defaultModel: '',
    models: [],
  },
};

export function loadSettings(): LLMConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.llm);
    if (raw) return { ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { apiKey: '', baseUrl: LLM_DEFAULTS.baseUrl, model: LLM_DEFAULTS.model };
}

export function saveSettings(cfg: LLMConfig): void {
  try { localStorage.setItem(STORAGE_KEYS.llm, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function loadProvider(): string {
  try { return localStorage.getItem(STORAGE_KEYS.provider) || 'deepseek'; }
  catch { return 'deepseek'; }
}

export function saveProvider(p: string): void {
  try { localStorage.setItem(STORAGE_KEYS.provider, p); } catch { /* ignore */ }
}

// ============================================================================
// CORS 代理
// ============================================================================
export const DEFAULT_PROXY = 'daily-paper-reader.pages.dev/api/proxy';

export function getCustomProxy(): string {
  try {
    const v = (localStorage.getItem(STORAGE_KEYS.proxy) || '').trim().replace(/\/+$/, '');
    return v || DEFAULT_PROXY;
  } catch {
    return DEFAULT_PROXY;
  }
}

export function setCustomProxy(v: string): void {
  try {
    const trimmed = v.trim();
    if (trimmed) localStorage.setItem(STORAGE_KEYS.proxy, trimmed);
    else localStorage.removeItem(STORAGE_KEYS.proxy);
  } catch { /* ignore */ }
}

// ============================================================================
// Gist 同步
// ============================================================================
export const GIST_FILENAME = 'dpr-config.json';

// getGistToken / setGistToken 已在上面"向后兼容"段定义为 loadGitHubToken 的别名,
// 这里不重复定义。

export function getGistId(): string {
  try { return (localStorage.getItem(STORAGE_KEYS.gistId) || '').trim(); }
  catch { return ''; }
}
export function setGistId(id: string): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEYS.gistId, id);
    else localStorage.removeItem(STORAGE_KEYS.gistId);
  } catch { /* ignore */ }
}

// ============================================================================
// Topics: textarea 文本 ↔ TopicEntry[] ↔ localStorage
// 输入格式:每行 "tag: 中文说明",空行 / ## / // 当注释跳过。
// ============================================================================
export const DEFAULT_TOPICS_TEXT = [
  '## RL: 强化学习',
  '## MAS: 多智能体',
  '## game ai: 游戏 AI',
  '## self distillation: 自蒸馏',
  '## intervention: 激活干预',
].join('\n');

export function parseTopicsText(text: string): TopicEntry[] {
  const seen = new Set<string>();
  const out: TopicEntry[] = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\s*(#|\/\/)/.test(line)) continue;
    const m = line.match(/^([A-Za-z0-9_.\- ]+?)\s*[:：]\s*(.+)$/);
    if (!m) continue;
    const tag = m[1].trim();
    const description = m[2].trim();
    if (!tag || !description) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tag, description, enabled: true });
  }
  return out;
}

export function serializeTopicsForStorage(entries: TopicEntry[]): string {
  return entries.map((e) => `${e.tag}: ${e.description}`).join('\n');
}

export function getTopicsText(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.topics);
    if (raw && raw.trim()) return raw;
  } catch { /* ignore */ }
  return DEFAULT_TOPICS_TEXT;
}

export function setTopicsText(text: string): void {
  try { localStorage.setItem(STORAGE_KEYS.topics, text); } catch { /* ignore */ }
}

export function getTopics(): TopicEntry[] {
  return parseTopicsText(getTopicsText());
}

// ============================================================================
// arXiv categories — 用户可勾选要搜哪些类
// 默认勾选 cs 主流 6 类(覆盖 AI/ML/NLP/CV/RL/IR 95%+ 论文),用户可自己改。
// ============================================================================
export interface ArxivCategory {
  code: string;        // arXiv 类目代号,如 "cs.AI"
  label: string;       // 中文说明
  group: string;       // 分组:cs / stat / math / eess / q-bio / 其他
}

export const ARXIV_CATEGORIES: ArxivCategory[] = [
  // cs — 主流(默认勾选)
  { code: 'cs.AI',  label: '人工智能(广义)',          group: 'cs' },
  { code: 'cs.LG',  label: '机器学习',                  group: 'cs' },
  { code: 'cs.CL',  label: '自然语言处理 / 计算语言学', group: 'cs' },
  { code: 'cs.CV',  label: '计算机视觉',                group: 'cs' },
  { code: 'cs.RO',  label: '机器人',                    group: 'cs' },
  { code: 'cs.IR',  label: '信息检索',                  group: 'cs' },
  // cs — 进阶
  { code: 'cs.CR',  label: '密码与安全',                group: 'cs' },
  { code: 'cs.DC',  label: '分布式计算',                group: 'cs' },
  { code: 'cs.HC',  label: '人机交互',                  group: 'cs' },
  { code: 'cs.NE',  label: '神经与演化计算',            group: 'cs' },
  { code: 'cs.PL',  label: '编程语言',                  group: 'cs' },
  // 跨学科
  { code: 'stat.ML', label: '统计机器学习',             group: 'stat' },
  { code: 'math.OC', label: '优化与控制',               group: 'math' },
  { code: 'eess.AS', label: '音频与语音处理',           group: 'eess' },
  { code: 'q-bio.NC', label: '神经元与认知',            group: 'q-bio' },
];

export const DEFAULT_CATEGORY_CODES = ['cs.AI', 'cs.LG', 'cs.CL', 'cs.CV', 'cs.RO', 'cs.IR'];

export function loadCategories(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.categories);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return parsed.filter((c) => ARXIV_CATEGORIES.some((a) => a.code === c));
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_CATEGORY_CODES.slice();
}

export function saveCategories(codes: string[]): void {
  try { localStorage.setItem(STORAGE_KEYS.categories, JSON.stringify(codes)); } catch { /* ignore */ }
}

// 把勾选状态序列化成 arXiv API 的 cat: 字段(cat:cs.AI OR cat:cs.LG OR ...)
// 多个 cat 之间 OR,等效把搜索限定在这些类目。
export function buildCategoryFilter(codes: string[]): string {
  if (codes.length === 0) return '';
  return '(' + codes.map((c) => `cat:${c}`).join(' OR ') + ')';
}