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
  // 长文精读(Deep Dive) — maxPages 默认 20,compact 默认关。
  // 用户在 settings 页改,仅存浏览器 localStorage。
  deepDiveMaxPages: 'dpr_analyzer_deepdive_max_pages_v1',
  deepDiveCompact: 'dpr_analyzer_deepdive_compact_v1',
  deepDiveCompactPages: 'dpr_analyzer_deepdive_compact_pages_v1',
  // 已隐藏论文列表 — 论文详情页"隐藏"按钮的持久化层。
  // 不写 Gist(避免污染 CI $GITHUB_ENV),纯 localStorage。
  hiddenPapers: 'dpr_hidden_papers_v1',
  // 已选论文列表 — 多选论文 → 送去 /topic/?from=selection 当种子上下文。
  // 仅 localStorage,不上 Gist(选择是临时工作流,跨设备无意义)。
  selection: 'dpr_paper_selection_v1',
  // paper-analyzer 分析结果本地历史(用户刷新页面后仍能查看、再次访问)。
  // 纯 localStorage,不同步 Gist,也不上 GitHub。
  analyzerHistory: 'dpr_analyzer_history_v1',
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
// 长文精读 (Deep Dive) — 控制 PDF 文本量与 chunking 行为
// ============================================================================
// maxPages: 传给 extractPdfTextFromBuffer 的页数上限。20 覆盖 95%+ arXiv 论文。
//   太大会触发 Cloudflare-fronted LLM provider 的 WAF body size 限制,UI 上看是
//   "Invalid page request."。用户可显式调高,但大于 60 的请求多半会失败。
// compact: 紧凑模式开启后只读 PDF 前 compactPages 页,适合超长论文(综述、博士论文)。
// compactPages: 紧凑模式读多少页(abstract + intro + method 头部通常在 6 页内)。
export interface DeepDiveConfig {
  maxPages: number;
  compact: boolean;
  compactPages: number;
}

export const DEEPDIVE_DEFAULTS: DeepDiveConfig = {
  maxPages: 20,
  compact: false,
  compactPages: 6,
};

const DEEPDIVE_MAX_PAGES_MIN = 5;
const DEEPDIVE_MAX_PAGES_MAX = 60;
const DEEPDIVE_COMPACT_PAGES_MIN = 2;
const DEEPDIVE_COMPACT_PAGES_MAX = 20;
const DD_MAX_PAGES_KEY = STORAGE_KEYS.deepDiveMaxPages;
const DD_COMPACT_KEY = STORAGE_KEYS.deepDiveCompact;
const DD_COMPACT_PAGES_KEY = STORAGE_KEYS.deepDiveCompactPages;

export function loadDeepDiveSettings(): DeepDiveConfig {
  const fallback = { ...DEEPDIVE_DEFAULTS };
  try {
    const clampInt = (raw: string | null, dflt: number, lo: number, hi: number): number => {
      if (!raw) return dflt;
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n)) return dflt;
      return Math.max(lo, Math.min(hi, n));
    };
    const maxPages = clampInt(
      localStorage.getItem(DD_MAX_PAGES_KEY),
      DEEPDIVE_DEFAULTS.maxPages,
      DEEPDIVE_MAX_PAGES_MIN,
      DEEPDIVE_MAX_PAGES_MAX,
    );
    const compactPages = clampInt(
      localStorage.getItem(DD_COMPACT_PAGES_KEY),
      DEEPDIVE_DEFAULTS.compactPages,
      DEEPDIVE_COMPACT_PAGES_MIN,
      DEEPDIVE_COMPACT_PAGES_MAX,
    );
    const compactRaw = localStorage.getItem(DD_COMPACT_KEY);
    const compact = compactRaw === '1' || compactRaw === 'true';
    return { maxPages, compact, compactPages };
  } catch {
    return fallback;
  }
}

export function saveDeepDiveSettings(cfg: DeepDiveConfig): void {
  try {
    const clampInt = (n: number, dflt: number, lo: number, hi: number): number =>
      Math.max(lo, Math.min(hi, Number.isFinite(n) ? Math.floor(n) : dflt));
    localStorage.setItem(DD_MAX_PAGES_KEY, String(clampInt(
      cfg.maxPages,
      DEEPDIVE_DEFAULTS.maxPages,
      DEEPDIVE_MAX_PAGES_MIN,
      DEEPDIVE_MAX_PAGES_MAX,
    )));
    localStorage.setItem(DD_COMPACT_KEY, cfg.compact ? '1' : '0');
    localStorage.setItem(DD_COMPACT_PAGES_KEY, String(clampInt(
      cfg.compactPages,
      DEEPDIVE_DEFAULTS.compactPages,
      DEEPDIVE_COMPACT_PAGES_MIN,
      DEEPDIVE_COMPACT_PAGES_MAX,
    )));
  } catch { /* ignore */ }
}

// ============================================================================
// 已隐藏论文列表 — 软删除本地副本
// 仅在浏览器 localStorage 持久化,不上 Gist(避免污染 CI $GITHUB_ENV)。
// 后续要做跨设备同步,需要另开独立 Gist(dpr-hidden.json),
// 不能写进 dpr-config.json —— 因为 .github/scripts/load_gist.py 会把
// payload 里所有 key 当 env 写进 $GITHUB_ENV,数组会被序列化成
// hiddenPapers=["..."] 污染环境。
// ============================================================================
export function loadHiddenPapers(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.hiddenPapers);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function saveHiddenPapersRaw(ids: string[]): void {
  try {
    // 去重 + 保持首次出现顺序
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        dedup.push(id);
      }
    }
    localStorage.setItem(STORAGE_KEYS.hiddenPapers, JSON.stringify(dedup));
  } catch {
    /* localStorage 不可用时静默忽略(隐私模式等) */
  }
}

// 导出给 settings-page.ts 的"清空本地"按钮用 — 它要一次写空数组,不走逐条 remove。
export { saveHiddenPapersRaw };

export function isPaperHidden(arxivId: string): boolean {
  if (!arxivId) return false;
  return loadHiddenPapers().includes(arxivId);
}

// 返回 true 表示真的新增了,false 表示之前已在列表里。
export function addHiddenPaper(arxivId: string): boolean {
  if (!arxivId) return false;
  const ids = loadHiddenPapers();
  if (ids.includes(arxivId)) return false;
  ids.push(arxivId);
  saveHiddenPapersRaw(ids);
  return true;
}

// 返回 true 表示真的移除了,false 表示本来就不在列表里。
export function removeHiddenPaper(arxivId: string): boolean {
  if (!arxivId) return false;
  const ids = loadHiddenPapers();
  const next = ids.filter((x) => x !== arxivId);
  if (next.length === ids.length) return false;
  saveHiddenPapersRaw(next);
  return true;
}

// ============================================================================
// 已选论文列表(用于"送去主题探索")— 仅本地,不上 Gist。
// 数据结构:每条存了 arxivId + 速览关键字段的快照,这样 topic 页能直接拼上下文,
// 不必再回 /papers/{arxiv}/ 抓整张 frontmatter(也兼容用户离开本站时本地还能用)。
// 软上限 8 篇 — 超过时仍允许,但 action bar 会显示警告(UI 层处理,这里不强截)。
// ============================================================================
export interface SelectionItem {
  arxivId: string;
  title: string;
  title_zh?: string;
  tldr: string;
  motivation?: string;
  method: string;
  result: string;
  conclusion?: string;
  tags: string[];
  addedAt: number;
}

export const SELECTION_SOFT_CAP = 8;

export function loadSelection(): SelectionItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.selection);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is SelectionItem =>
      !!x && typeof x === 'object' && typeof x.arxivId === 'string' && typeof x.title === 'string',
    );
  } catch {
    return [];
  }
}

function saveSelectionRaw(items: SelectionItem[]): void {
  try {
    // 去重 + 保持首次出现顺序
    const seen = new Set<string>();
    const dedup: SelectionItem[] = [];
    for (const it of items) {
      if (!seen.has(it.arxivId)) {
        seen.add(it.arxivId);
        dedup.push(it);
      }
    }
    localStorage.setItem(STORAGE_KEYS.selection, JSON.stringify(dedup));
  } catch {
    /* localStorage 不可用时静默忽略(隐私模式等) */
  }
}

export function isInSelection(arxivId: string): boolean {
  if (!arxivId) return false;
  return loadSelection().some((x) => x.arxivId === arxivId);
}

// 返回 true 表示真的新增了,false 表示之前已在列表里或 arxivId/title 缺失。
export function addToSelection(item: SelectionItem): boolean {
  if (!item.arxivId || !item.title) return false;
  const items = loadSelection();
  if (items.some((x) => x.arxivId === item.arxivId)) return false;
  items.push(item);
  saveSelectionRaw(items);
  return true;
}

// 返回 true 表示真的移除了,false 表示本来就不在列表里。
export function removeFromSelection(arxivId: string): boolean {
  if (!arxivId) return false;
  const items = loadSelection();
  const next = items.filter((x) => x.arxivId !== arxivId);
  if (next.length === items.length) return false;
  saveSelectionRaw(next);
  return true;
}

export function clearSelection(): void {
  try { localStorage.removeItem(STORAGE_KEYS.selection); } catch { /* ignore */ }
}

// ============================================================================
// Gist 拉推 — 与现有 syncToGist() (settings-page.ts / paper-analyzer.ts 各一份)
// 的"整文件覆盖"语义解耦。这里只针对 hiddenPapers 做 GET → merge → PATCH,
// 避免 settings 同步把 analyzer 的 topics 字段连带 hiddenPapers 抹掉。
//
// 失败模式:
//   - token / gistId 任一为空 → 返回 { ok: false, reason: 'no_token' },
//     paper-hide.ts 静默不报错(用户没配 Gist 是正常态)
//   - HTTP 401/403/网络错误 → 返回 { ok: false, reason: <message> },
//     调用方 console.warn 即可
// ============================================================================

export interface GistHiddenPapersResult {
  ok: boolean;
  reason?: string;
  /** pull 时:本次新合入的 ids(用于"已新增 N 条"提示) */
  merged?: string[];
}

async function readGistHiddenPapers(): Promise<string[] | null> {
  const token = getGistToken();
  const gistId = getGistId();
  if (!token || !gistId) return null;
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`Gist GET HTTP ${res.status}`);
  const data = await res.json();
  const files = data?.files || {};
  const target = files[GIST_FILENAME] as { content?: string } | undefined;
  if (!target?.content) return [];
  let payload: unknown;
  try { payload = JSON.parse(target.content); } catch { return []; }
  const arr = (payload as { hiddenPapers?: unknown })?.hiddenPapers;
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is string => typeof x === 'string');
}

// 启动时调用:Gist 里的 hiddenPapers 与 localStorage union 去重 → 写回 localStorage。
// 不会清空 localStorage(避免把"本地新增还没推"的条目误删)。
export async function pullHiddenPapersFromGist(): Promise<GistHiddenPapersResult> {
  try {
    const remote = await readGistHiddenPapers();
    if (remote === null) return { ok: false, reason: 'no_token' };
    const local = loadHiddenPapers();
    const localSet = new Set(local);
    const merged: string[] = [...local];
    const fresh: string[] = [];
    for (const id of remote) {
      if (!localSet.has(id)) {
        localSet.add(id);
        merged.push(id);
        fresh.push(id);
      }
    }
    if (fresh.length > 0) saveHiddenPapersRaw(merged);
    return { ok: true, merged: fresh };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || String(e) };
  }
}

// 点隐藏/恢复时调用:GET → 把当前 localStorage 写回 hiddenPapers 字段 → PATCH。
// 不动 Gist 里其他字段(llm / topics / categories / provider 等)。
export async function pushHiddenPapersToGist(): Promise<GistHiddenPapersResult> {
  const token = getGistToken();
  const gistId = getGistId();
  if (!token || !gistId) return { ok: false, reason: 'no_token' };
  try {
    // 读现有 payload(GET)
    const getRes = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!getRes.ok) throw new Error(`Gist GET HTTP ${getRes.status}`);
    const getData = await getRes.json();
    const files = getData?.files || {};
    const target = files[GIST_FILENAME] as { content?: string } | undefined;
    let payload: Record<string, unknown> = {};
    if (target?.content) {
      try { payload = JSON.parse(target.content) as Record<string, unknown>; }
      catch { payload = {}; }
    }
    payload.hiddenPapers = loadHiddenPapers();
    // PATCH
    const patchRes = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: { [GIST_FILENAME]: { content: JSON.stringify(payload, null, 2) } } }),
    });
    if (!patchRes.ok) throw new Error(`Gist PATCH HTTP ${patchRes.status}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || String(e) };
  }
}

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
// 协议头必须显式带 https:// — 否则拼 worker URL 时会得到
// "daily-paper-reader.pages.dev/api/proxy?url=...",PDF.js 把它当 module
// specifier 解析失败(报 "Failed to resolve module specifier ...")。
// 用户在设置面板里填代理时也务必保留协议头。
export const DEFAULT_PROXY = 'https://daily-paper-reader.pages.dev/api/proxy';

export function getCustomProxy(): string {
  try {
    let v = (localStorage.getItem(STORAGE_KEYS.proxy) || '').trim();
    // 容错:用户从旧版本升级时 localStorage 里可能存着没协议头的旧值
    // (如 "daily-paper-reader.pages.dev/api/proxy"),直接拼到 worker URL
    // 会得到 ".../api/proxy?url=..." — 浏览器报 "Failed to resolve
    // module specifier ..."。这里默认补上 https://,避免他们手动改设置。
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    v = v.replace(/\/+$/, '');
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