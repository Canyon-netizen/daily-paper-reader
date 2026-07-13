// /paper-analyzer 页面客户端逻辑
//
// 三种输入来源 → 抽正文 → 调 LLM → 渲染结构化笔记
//   1. PDF 上传 (pdf.js 在浏览器里抽文字)
//   2. arXiv 搜索 → 自动 fetch 该论文 PDF 再抽
//
// LLM 调用直接走用户配置的 OpenAI 兼容端点,API key 仅在浏览器 localStorage。
//
// 所有设置项(LLM / Gist / Topics / CORS 代理 / arXiv 类目)统一在 /settings/
// 页面管理,本页只读取,不重复提供 UI。共享读写逻辑见 ./settings.ts。

import {
  loadSettings,
  saveSettings,
  loadProvider,
  saveProvider,
  getCustomProxy,
  setCustomProxy,
  getGistToken,
  setGistToken,
  getGistId,
  setGistId,
  getTopics,
  getTopicsText,
  setTopicsText,
  parseTopicsText,
  DEFAULT_TOPICS_TEXT,
  loadCategories,
  saveCategories,
  buildCategoryFilter,
  STORAGE_KEYS,
  PROVIDER_PRESETS,
  LLM_DEFAULTS,
  loadGitHubToken,
  loadGitHubRepo,
  loadDeepDiveSettings,
  loadHiddenPapers,
} from './settings';
import { debounce, canonicalArxivId, escapeHtml } from '../lib/dom-utils';

// ============================================================================
// 类型
// ============================================================================
interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AnalysisResult {
  // 字段与后台 pipeline (src/6.generate_docs.py) 输出的 frontmatter 完全一致
  title: string;
  title_en?: string;
  authors?: string;
  tldr: string;
  motivation: string;
  method: string;
  result: string;
  conclusion: string;
  // 主题语境:这篇论文在所处主题中的位置 / 与同类工作的差异 / 适用场景 / 局限性。
  // 旧版本只有"问题→方法→结果→结论"四段,主体内容过于狭窄——只看得到这篇论文本身,
  // 看不到它在所处研究主题里的坐标。新增此字段把笔记从"单点摘要"扩展到"主题语境"，
  // 让用户即使不读全文也能定位这篇工作相对其他工作的位置与适用边界。
  context?: string;
  // 主题标签:从 TOPIC_ALLOWLIST(下方常量)里挑 1-4 个最贴切的标签,
  // 由同一份 LLM 调用返回,前端规范化为 query:<tag> 写入 frontmatter。
  // 失败 / 字段缺失 / 非数组时降级为 [];allowlist 之外的元素丢弃,避免自由发挥。
  topic_tags?: string[];
}

// 预置主题标签清单。
// 前半段 = config.yaml intent_profiles / settings.DEFAULT_TOPICS_TEXT 已有的 5 项;
// 后半段 = 仓库 docs/papers/ 现存论文常见的方向,扩展覆盖。
// 改此处时记得同步 SYSTEM_PROMPT 里的预置清单(否则 LLM 看到清单和实际写文件的不一致)。
const TOPIC_ALLOWLIST: readonly string[] = [
  'RL',                  // 强化学习(reinforcement learning、policy optimization、MDP 等)
  'MAS',                 // 多智能体系统(multi-agent、cooperation、swarm 等)
  'game ai',             // 游戏 AI(博弈论、self-play、StarCraft、对战 等)
  'self distillation',   // 自蒸馏(self-imitation、policy self-distillation、on-policy distillation 等)
  'intervention',        // 大模型干预(steering vector、activation patching、representation engineering 等)
  'llm-agent',           // LLM 驱动的智能体(tool use、ReAct、function calling、agentic workflow 等)
  'reasoning',           // 推理增强(chain-of-thought、CoT、search-augmented、math reasoning 等)
  'gui',                 // GUI 智能体 / 屏幕操作(GUI agent、WebShop、mobile UI、computer use 等)
  'vision',              // 计算机视觉 / 多模态(VLM、image classification、video、segmentation 等)
  'speech',              // 语音 / 音频(speech recognition、text-to-speech、audio generation 等)
  'safety',              // AI 安全 / 对齐 / 红队(jailbreak、adversarial、alignment、harmful generation 等)
  'retrieval',           // 信息检索 / RAG(dense retrieval、reranker、retrieval-augmented generation 等)
  'code',                // 代码生成 / 程序合成(code LLM、completion、program synthesis 等)
  'robotics',            // 机器人 / 具身智能(manipulation、locomotion、sim-to-real、embodied AI 等)
  'knowledge',           // 知识表示 / 知识图谱(KG、entity linking、relation extraction 等)
];
const TOPIC_ALLOWLIST_LOWER = new Set(TOPIC_ALLOWLIST.map((t) => t.toLowerCase()));

export interface ArxivEntry {
  id: string;            // 完整 arXiv URL
  arxivId: string;       // 简短 ID 如 1706.03762v7
  title: string;
  authors: string[];
  summary: string;
  published: string;     // arXiv <published>: 永远是 v1 首发的日期,选"最新版本"不能拿它比
  updated: string;       // arXiv <updated>:   随版本号 vN 升级才变,选"最新版本"用这个
  pdfUrl: string;        // arxiv.org/pdf/<id>
}

// ============================================================================
// 常量 / DOM 引用
// ============================================================================
const DEFAULT_BASE = LLM_DEFAULTS.baseUrl;
const DEFAULT_MODEL = LLM_DEFAULTS.model;
const MAX_TEXT_CHARS = 50_000; // 抽出的正文上限(避免爆 LLM context)

// ============================================================================
// 长文精读 (Deep Dive) body 大小防护
// ============================================================================
// Cloudflare-fronted LLM provider 通常对 POST body 限 ~1MB,超出回 challenge 页
// (典型错误文案 "Invalid page request."),错误信息看不出真假,前端难诊断。
// 解决:序列化前量 byteLength,超过阈值自动按字符切 chunk 串行调用再拼合。
const REQUEST_BODY_LIMIT_BYTES = 900_000;
const CHUNK_TARGET_CHARS = 200_000;     // 单 chunk PDF 文本字符目标(~600KB body)
const CHUNK_OVERLAP_CHARS = 2_000;      // 段间重叠,用于上下文衔接
const WAF_SIGNATURE = /cloudflare|attention required|\bcf[-_ ]?ray\b|invalid page request|enable javascript|checking your browser|\bforbidden\b|403 forbidden/i;

// ============================================================================
// CORS 代理 — arXiv 不返回 Access-Control-Allow-Origin,纯浏览器 fetch 会被拦。
// EdgeOne 上一定需要走代理;开发环境(localhost)直接 fetch 也行,所以先直连再走代理。
// 代理按"可用 → 公开免 key → 兜底"排序,任何一个成功就用,全部失败再报错。
// 用户也可以在 LLM 设置下方的"高级"里改成自己部署的代理(最稳: 5 行 CF Worker)。
// 注意: 公共代理经常挂,顺序保持"已知稳定的"靠前,新的不稳定的最后兜底。
// ============================================================================
// 导出供 /topic 等其他页面复用(参 [[topic-search]])。顺序与可见性是按"已知稳定"排的,
// topic-search 不要再调换。
// 自家 Pages Function:部署在 https://daily-paper-reader.pages.dev/api/proxy,
//代码见 /functions/api/proxy.ts(SSRF-safe,只代理 arXiv 域,无需 key,无配额)。
// 浏览器请求时只要走 https://<host>/api/proxy?url=<encoded-arxiv-url> 即可。
// 优先级最高 — 它跟站点同源,延迟低、可靠,而公共 CORS 代理经常挂(见下)。
function sameOriginProxyHost(): string {
  // 仅在浏览器里跑,document.baseURI 形如 https://daily-paper-reader.pages.dev/paper-analyzer/
  // 去掉尾部路径,只要 origin(hostname)
  try {
    const u = new URL(document.baseURI);
    return u.origin;
  } catch {
    return '';
  }
}
// 开发环境(localhost / 127.0.0.1)走 scripts/local-cors-proxy.mjs
// 部署平台上的 functions/ 在 dev server 里不生效,所以 same-origin /api/proxy
// 在本机会 404,自动改指 8123 端口的本地代理(支持 ?url= 或路径拼接两种模式)。
function isLocalDev(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}
export const CORS_PROXIES: { name: string; wrap: (u: string) => string }[] = [
  // 自家 Pages Function(部署在哪域名就拼哪个,自动适配 Vercel / EdgeOne / GitHub Pages)
  // 注意:只有 Cloudflare Pages / Vercel / EdgeOne Pages 这些支持 functions/ 的平台才会生效;
  // 部署到 GitHub Pages 时这个代理会 404,代码会自动 fallback 到下面的公共代理。
  // 本地开发时 /api/proxy 不存在,改成指向 scripts/local-cors-proxy.mjs 的 8123。
  {
    name: 'same-origin-pages-function',
    wrap: (u) => {
      const origin = sameOriginProxyHost();
      if (!origin) return u;
      if (isLocalDev(origin)) {
        return `http://127.0.0.1:8123/?url=${encodeURIComponent(u)}`;
      }
      return `${origin}/api/proxy?url=${encodeURIComponent(u)}`;
    },
  },
  // codetabs — 当前测试比较稳(200 + 透传)
  { name: 'codetabs.com', wrap: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` },
  // corsproxy.io — 经常 403 但偶尔可用
  { name: 'corsproxy.io', wrap: (u) => `https://corsproxy.io/?${encodeURIComponent(u)}` },
  // allorigins /get 返回 JSON 包了一层,要 unwrap(只在 raw 失败时试)
  { name: 'allorigins.win', wrap: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  // thingproxy 经常 ERR_NAME_NOT_RESOLVED,留作最后兜底
  { name: 'thingproxy', wrap: (u) => `https://thingproxy.freeboard.io/fetch/${u}` },
];

const GIST_FILENAME = 'dpr-config.json';

// (PROXY_KEY / DEFAULT_PROXY / GIST_TOKEN_KEY / GIST_ID_KEY / TOPIC_KEY /
//  DEFAULT_TOPICS_TEXT / TopicEntry / parseTopicsText / getCustomProxy /
//  getGistToken / getGistId / setGistId / getTopicsText / setTopicsText /
//  getTopics 都从 ./settings 导入 — 文件顶部)

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root?: Element): T[] =>
  Array.from((root ?? document).querySelectorAll<T>(sel));

// ============================================================================
// Settings: 加载 / 保存
// (PROVIDER_PRESETS / loadSettings / saveSettings / loadProvider / saveProvider
//  都从 ./settings 导入 — 文件顶部)
// ============================================================================

// 当前 model 字段模式:false = <select> 下拉(默认),true = <input> 手动输入
let modelManualMode = false;

function isModelManual(): boolean {
  const inputEl = document.getElementById('cfg-model-input') as HTMLInputElement | null;
  return !!(inputEl && !inputEl.hidden);
}

function readModelValue(): string {
  if (isModelManual()) {
    return ($<HTMLInputElement>('cfg-model-input')).value.trim();
  }
  return ($<HTMLSelectElement>('cfg-model')).value.trim();
}

function setModelMode(manual: boolean): void {
  modelManualMode = manual;
  const select = $<HTMLSelectElement>('cfg-model');
  const input = $<HTMLInputElement>('cfg-model-input');
  const editBtn = $<HTMLButtonElement>('cfg-model-edit-btn');
  if (manual) {
    select.hidden = true;
    input.hidden = false;
    // 把当前 select 的值复制到 input,避免丢值
    if (!input.value) input.value = select.value;
    editBtn.textContent = '📋';
    editBtn.title = '切回下拉选择';
  } else {
    input.hidden = true;
    select.hidden = false;
    editBtn.textContent = '✏️';
    editBtn.title = '切到手动输入';
  }
}

function setModelOptions(models: string[], placeholder: string, defaultModel = ''): void {
  const sel = $<HTMLSelectElement>('cfg-model');
  // placeholder 用 hidden 而不是 selected,这样 dropdown 默认显示第一个真实 model
  // 如果指定了 defaultModel,优先用它作为 selected
  const placeholderOpt = `<option value="" disabled hidden>${escapeHtml(placeholder)}</option>`;
  // option 必须有 inner text(下拉显示的文本),不能为空 — value 只是 form 提交用的
  const opts = [placeholderOpt].concat(
    models.map((m, i) => {
      const isFirst = i === 0;
      const selected = (defaultModel && m === defaultModel) || (!defaultModel && isFirst);
      return `<option value="${escapeHtml(m)}"${selected ? ' selected' : ''}>${escapeHtml(m)}</option>`;
    }),
  );
  sel.innerHTML = opts.join('');
}

function readSettingsFromUI(): LLMConfig {
  return {
    apiKey: ($<HTMLInputElement>('cfg-key')).value.trim(),
    baseUrl: ($<HTMLInputElement>('cfg-base')).value.trim() || DEFAULT_BASE,
    model: readModelValue() || DEFAULT_MODEL,
  };
}

function writeSettingsToUI(cfg: LLMConfig): void {
  ($<HTMLInputElement>('cfg-key')).value = cfg.apiKey;
  ($<HTMLInputElement>('cfg-base')).value = cfg.baseUrl;
  // 同时写 select 和 input(两个都同步当前值),切换模式不丢
  const sel = $<HTMLSelectElement>('cfg-model');
  const input = $<HTMLInputElement>('cfg-model-input');
  // 优先用 select 模式写入(更直观)
  if (Array.from(sel.options).some((o) => o.value === cfg.model)) {
    sel.value = cfg.model;
    input.value = cfg.model;
  } else {
    // 用户填的 model 不在下拉里 → 自动切到手动模式
    input.value = cfg.model;
    setModelMode(true);
  }
}

function applyProviderPreset(provider: string): void {
  const preset = PROVIDER_PRESETS[provider];
  if (!preset) return;
  ($<HTMLInputElement>('cfg-base')).value = preset.baseUrl;
  // 用预设模型列表填 select,defaultModel 作为 selected
  setModelOptions(preset.models, `选择 ${preset.label} model`, preset.defaultModel);
  // input 模式也同步
  ($<HTMLInputElement>('cfg-model-input')).value = preset.defaultModel;
  // 回到 select 模式
  setModelMode(false);
  // placeholder
  const isCustom = provider === 'custom';
  ($<HTMLInputElement>('cfg-base')).placeholder = isCustom ? 'https://your-api.example.com/v1' : preset.baseUrl;
}

// init 阶段用:只填 select 的 options + placeholder,不覆盖用户已保存的 model 值
function applyProviderPresetDatalistOnly(provider: string): void {
  const preset = PROVIDER_PRESETS[provider];
  if (!preset) return;
  setModelOptions(preset.models, `选择 ${preset.label} model`);
  const isCustom = provider === 'custom';
  ($<HTMLInputElement>('cfg-base')).placeholder = isCustom ? 'https://your-api.example.com/v1' : preset.baseUrl;
}

function detectProviderFromSettings(cfg: LLMConfig): string {
  for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
    if (key === 'custom') continue;
    if (preset.baseUrl && cfg.baseUrl.startsWith(preset.baseUrl)) return key;
  }
  return 'custom';
}

// ============================================================================
// Status / Errors
// ============================================================================
function setStatus(msg: string, type: 'info' | 'error' = 'info'): void {
  const el = $('status');
  el.hidden = false;
  el.className = type === 'error' ? 'analyzer-status error' : 'analyzer-status';
  el.innerHTML = type === 'error'
    ? `<span>⚠️</span><span>${escapeHtml(msg)}</span>`
    : `<span class="analyzer-spinner"></span><span>${escapeHtml(msg)}</span>`;
}

function clearStatus(): void {
  const el = $('status');
  el.hidden = true;
  el.innerHTML = '';
}

// 强转 string:之前 arxiv-index.json schema 演进时,有人把 entry 当字符串用,
// escapeHtml(<object>) 抛 "t.replace is not a function"。即使现在 contract 已经修正,
// 给 escapeHtml 加最后一道兜底:非 string (number / object / null / undefined)
// 在模板字符串拼接时静默降级为空字符串,而不是炸整个搜索流程。
// 把 docs 仓库路径转成站点绝对 URL,避免在 /paper-analyzer/ 下被解析成相对路径。
function docsPathToUrl(p: string): string {
  return '/' + p.replace(/^docs\//, '').replace(/\.md$/, '/');
}

// 从字符串里提取第一个配对的 { ... } JSON 块(跳过字符串里的 `{` `}`)。
// 避免 \{[\s\S]*\} 这种贪婪正则把多个对象吞成一个,或者把 reasoning 文本吞进去。
export function extractBalancedJson(s: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (start === -1) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start !== -1) {
        return s.slice(start, i + 1);
      }
    }
  }
  return null;
}

let savedHintTimer: ReturnType<typeof setTimeout> | null = null;
function flashSavedHint(): void {
  const el = document.getElementById('cfg-saved-hint');
  if (!el) return;
  el.classList.add('visible');
  if (savedHintTimer) clearTimeout(savedHintTimer);
  savedHintTimer = setTimeout(() => el.classList.remove('visible'), 1200);
}

function setModelStatus(msg: string, kind: '' | 'ok' | 'error' | 'warn' = ''): void {
  const el = document.getElementById('model-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'analyzer-model-status' + (kind ? ' ' + kind : '');
}

// ============================================================================
// 测试连接 / 刷新模型列表
//   - OpenAI 兼容 API 都有 GET {base}/v1/models,带 Authorization: Bearer <key>
//   - testConnection: 只验证连通性 + 当前 model 是否在列表里
//   - refreshModelList: 拉服务端真实模型,覆盖到 #model-suggest
//   - 失败时 status 显示具体错误(401/404/网络),不让用户盲改
// ============================================================================
interface ModelsResponse {
  data?: Array<{ id?: string; model?: string }>;
}

async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/models`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('API key 无效(401),检查 Base URL 和 Key 是否匹配');
    if (res.status === 403) throw new Error('API key 没权限(403),或 Base URL 写错');
    if (res.status === 404) throw new Error('该 Base URL 不支持 /v1/models(404),可能不是 OpenAI 兼容接口');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
  }
  const data: ModelsResponse = await res.json();
  const ids = (data.data || [])
    .map((m) => (m.id || m.model || '').trim())
    .filter(Boolean);
  // 去重,保序
  return Array.from(new Set(ids));
}

async function testConnection(): Promise<void> {
  const cfg = readSettingsFromUI();
  if (!cfg.apiKey) {
    setModelStatus('请先填 API key', 'error');
    return;
  }
  if (!cfg.baseUrl) {
    setModelStatus('请先填 Base URL', 'error');
    return;
  }
  const btn = $<HTMLButtonElement>('test-connection-btn');
  const refreshBtn = $<HTMLButtonElement>('refresh-models-btn');
  btn.disabled = true;
  refreshBtn.disabled = true;
  setModelStatus('正在测试连接 ...');
  try {
    const models = await fetchOpenAIModels(cfg.baseUrl, cfg.apiKey);
    const currentModel = cfg.model.trim();
    if (currentModel && models.includes(currentModel)) {
      setModelStatus(`✓ 连接成功,共 ${models.length} 个模型,当前 model "${currentModel}" 存在`, 'ok');
    } else if (currentModel) {
      setModelStatus(
        `⚠ 连接成功,共 ${models.length} 个模型,但当前 model "${currentModel}" 不在列表里(可能拼错,或被禁用)`,
        'warn',
      );
    } else {
      setModelStatus(`✓ 连接成功,共 ${models.length} 个模型`, 'ok');
    }
  } catch (e) {
    setModelStatus(`✗ ${(e as Error).message || e}`, 'error');
  } finally {
    btn.disabled = false;
    refreshBtn.disabled = false;
  }
}

async function refreshModelList(): Promise<void> {
  const cfg = readSettingsFromUI();
  if (!cfg.apiKey) {
    setModelStatus('请先填 API key', 'error');
    return;
  }
  if (!cfg.baseUrl) {
    setModelStatus('请先填 Base URL', 'error');
    return;
  }
  const btn = $<HTMLButtonElement>('refresh-models-btn');
  const testBtn = $<HTMLButtonElement>('test-connection-btn');
  btn.disabled = true;
  testBtn.disabled = true;
  setModelStatus('正在拉模型列表 ...');
  try {
    const models = await fetchOpenAIModels(cfg.baseUrl, cfg.apiKey);
    if (models.length === 0) {
      setModelStatus('⚠ 返回的列表为空,保留当前列表', 'warn');
      return;
    }
    const currentModel = cfg.model.trim();
    // 优先用当前 model 作为默认选中(若它在列表里);否则 dropdown 第一个
    const preferred = models.includes(currentModel) ? currentModel : '';
    // 填 <select>,默认选 dropdown 第一个真实 model,这样用户一打开 dropdown 就能看到/用
    setModelOptions(models, '请选择 model', preferred);
    // 回到 select 模式(刷新后让用户从下拉里选)
    setModelMode(false);
    // 同步 input 字段的值为当前选中项(避免切到手动时丢)
    ($<HTMLInputElement>('cfg-model-input')).value = ($<HTMLSelectElement>('cfg-model')).value;
    saveSettings(readSettingsFromUI());
    flashSavedHint();

    if (currentModel && !models.includes(currentModel)) {
      // 当前 model 不在服务端列表 → 自动选了 dropdown 第一个,提示用户
      const firstModel = models[0];
      setModelStatus(
        `✓ 已更新下拉列表(共 ${models.length} 个),"${currentModel}" 不在服务端 → 已自动选 "${firstModel}"(下拉里可改)`,
        'warn',
      );
    } else {
      setModelStatus(`✓ 已从服务端拉取 ${models.length} 个模型,已选 "${preferred || models[0]}"`, 'ok');
    }
  } catch (e) {
    setModelStatus(`✗ 拉取失败: ${(e as Error).message || e}`, 'error');
  } finally {
    btn.disabled = false;
    testBtn.disabled = false;
  }
}

// ============================================================================
// 同步 LLM 配置到 GitHub Gist
//   - 用户填 Gist Token(只授 gist 权限的 PAT)+ Gist ID(可空,留空时自动 POST 创建)
//   - 浏览器把当前 LLMConfig + provider + corsProxy 打包成 JSON,写进 Gist 的 dpr-config.json
//   - GitHub Actions 跑 daily pipeline 时由 [Load secrets from Gist] step 拉这个 Gist 当 secret 源
//   - 流程:
//       1) 有 Gist ID → PATCH /gists/{id} 更新现有 Gist
//       2) 无 Gist ID → POST /gists 创建 secret Gist,响应里取 id,回填 UI + 写 localStorage
// ============================================================================
async function syncToGist(): Promise<void> {
  const token = getGistToken();
  if (!token) {
    setStatus('请先填 Gist Token', 'error');
    return;
  }

  // 收集当前所有 LLM 配置(provider / key / base / model / corsProxy)
  // 不写 DPR_GIST_TOKEN:Gist Token 只通过 GitHub repo secrets.DPR_GIST_TOKEN
  // 给 Actions 用(防止循环:浏览器 token 变了 → Gist 内容变 → workflow 读到新 token → 无限循环)
  const provider = loadProvider();
  const cfg = readSettingsFromUI();
  const corsProxy = getCustomProxy();
  // topics:用户在主题配置面板编辑过的列表(可能为空数组)。
  // 后台 workflow 端会读这个 JSON array,fallback 到仓库 config.yaml 的 intent_profiles。
  const topics = getTopics();
  const payload = {
    LLM_MODEL: `${provider}/${cfg.model || 'deepseek-chat'}`,
    LLM_API_KEY: cfg.apiKey || '',
    LLM_BASE_URL: cfg.baseUrl || '',
    MINIMAX_API_KEY: cfg.apiKey || '',     // 兼容旧 workflow 命名
    MINIMAX_FILTER_MODEL: `${provider}/${cfg.model || 'deepseek-chat'}`,
    MINIMAX_REWRITE_MODEL: `${provider}/${cfg.model || 'deepseek-chat'}`,
    corsProxy,
    topics,
    // 已隐藏论文列表 — 两处 syncToGist 都要带这个字段,
    // 否则从 /settings/ 同步时会把 analyzer 同步的 topics 字段连带 hiddenPapers 一起覆盖丢失。
    hiddenPapers: loadHiddenPapers(),
  };
  const content = JSON.stringify(payload, null, 2);

  // 决定 PATCH 还是 POST
  const existingId = getGistId();
  const method = existingId ? 'PATCH' : 'POST';
  const url = existingId
    ? `https://api.github.com/gists/${encodeURIComponent(existingId)}`
    : 'https://api.github.com/gists';
  const body = existingId
    ? { files: { [GIST_FILENAME]: { content } } }
    : {
        description: 'Daily Paper Reader LLM config (synced from paper-analyzer)',
        public: false,
        files: { [GIST_FILENAME]: { content } },
      };

  const btn = $<HTMLButtonElement>('gist-sync-btn');
  btn.disabled = true;
  setStatus(`正在${existingId ? '更新' : '创建'} Gist ...`);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      if (res.status === 401) throw new Error('Gist Token 无效或已过期,重新生成一个再试');
      if (res.status === 404 && existingId) throw new Error(`Gist ID ${existingId} 找不到或没有访问权限,清空 ID 重试会自动创建`);
      throw new Error(`GitHub 返回 ${res.status}: ${detail}`);
    }
    const data = await res.json();
    const newId: string = (data.id || data.node_id || '').trim();
    if (!newId) throw new Error('GitHub 响应里没有 Gist ID,可能 API 变了');
    if (!existingId) {
      setGistId(newId);
      ($<HTMLInputElement>('cfg-gist-id')).value = newId;
    }
    setStatus(`✓ 已同步到 Gist (${newId.slice(0, 8)}...)`, 'info');
  } catch (e) {
    setStatus(`同步失败: ${(e as Error).message || e}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================================
// Mode Tabs (upload / arxiv)
// ============================================================================
function initModeTabs(): void {
  const tabs = $$('.analyzer-tab');
  const panels = $$('.analyzer-mode');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode!;
      tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
      });
      panels.forEach((p) => {
        p.hidden = p.dataset.modePanel !== mode;
      });
      // 切到 📚 历史 tab → 即时刷新列表(避免外部 localStorage 改动后看不见)
      if (mode === 'history') renderHistoryPanel();
      // 切到 arxiv 时不需要 PDF,反之亦然
      updateRunButton();
    });
  });
}

// ============================================================================
// 📚 历史笔记 tab 渲染 / 重新加载
// ============================================================================
function renderHistoryPanel(): void {
  const list = $('history-list');
  const counter = $('history-count');
  const clearBtn = $<HTMLButtonElement>('history-clear');
  const items = loadHistory();
  counter.textContent = items.length === 0 ? '空' : `${items.length} 篇`;
  clearBtn.disabled = items.length === 0;
  if (items.length === 0) {
    list.innerHTML = `<div class="analyzer-history-empty">还没有历史记录。<br>跑过几篇论文后会自动列在这里(纯本机存储)。</div>`;
    return;
  }
  list.innerHTML = items.map((e) => {
    const idAttr = escapeHtml(e.id);
    const tagText = e.source === 'pdf' ? '上传 PDF' : (e.arxivId ? `arXiv ${escapeHtml(e.arxivId)}` : '手动');
    const titleZh = escapeHtml(e.arxivTitleZh || e.analysis.title || e.arxivTitle || '(无标题)');
    const titleEn = e.analysis.title_en || e.arxivTitle;
    const tldr = escapeHtml(shortTldr(e.analysis.tldr || ''));
    const ts = escapeHtml(fmtDate(e.createdAt));
    return `
      <article class="analyzer-history-item" data-history-id="${idAttr}" tabindex="0" role="button" aria-label="查看这篇历史分析">
        <div class="analyzer-history-item-main">
          <h4 class="analyzer-history-item-title">${titleZh}</h4>
          ${titleEn && titleEn !== e.arxivTitleZh ? `<div class="analyzer-history-item-meta">${escapeHtml(titleEn)}</div>` : ''}
          <div class="analyzer-history-item-meta">
            <span>${tagText}</span>
            <span>·</span>
            <span>${ts}</span>
          </div>
          ${tldr ? `<p class="analyzer-history-item-tldr">${tldr}</p>` : ''}
        </div>
        <div class="analyzer-history-item-acts">
          <button type="button" class="analyzer-history-item-btn" data-history-act="open">查看</button>
          <button type="button" class="analyzer-history-item-btn" data-history-act="del">删除</button>
        </div>
      </article>
    `;
  }).join('');

  // 事件委托 — 单 listener 顶替 N 个 listener
  list.onclick = (ev) => {
    const t = ev.target as HTMLElement;
    const btn = t.closest<HTMLElement>('[data-history-act]');
    const card = t.closest<HTMLElement>('.analyzer-history-item');
    if (!card) return;
    const id = card.dataset.historyId!;
    if (btn) {
      ev.stopPropagation();
      if (btn.dataset.historyAct === 'del') {
        removeHistory(id);
        renderHistoryPanel();
      } else if (btn.dataset.historyAct === 'open') {
        rehydrateHistory(id);
      }
      return;
    }
    rehydrateHistory(id);
  };
  list.onkeydown = (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const card = (ev.target as HTMLElement).closest<HTMLElement>('.analyzer-history-item');
    if (!card) return;
    ev.preventDefault();
    rehydrateHistory(card.dataset.historyId!);
  };

  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = '1';
    clearBtn.addEventListener('click', () => {
      if (loadHistory().length === 0) return;
      // 双层确认 — 避免误操作清空(本地数据)
      if (!confirm(`确定清空全部 ${loadHistory().length} 篇历史?\n(只清 localStorage,不影响 GitHub 仓库里的论文)`)) return;
      clearAllHistory();
      renderHistoryPanel();
    });
  }
}

// 从历史点击进来:不调 LLM,直接把缓存的 AnalysisResult + entry 重新挂到 UI。
// deep-dive / save-to-github 后续按钮仍能继续走,因为我们同步更新 currentArxivEntry。
function rehydrateHistory(id: string): void {
  const entry = loadHistory().find((e) => e.id === id);
  if (!entry) { renderHistoryPanel(); return; }
  // 构造一个最小的 ArxivEntry 让 deep-dive / save 流程正常工作
  if (entry.source === 'arxiv' && entry.arxivId) {
    currentArxivEntry = {
      id: `https://arxiv.org/abs/${entry.arxivId}`,
      arxivId: entry.arxivId,
      title: entry.arxivTitle || entry.analysis.title_en || entry.analysis.title,
      authors: entry.arxivAuthors ? entry.arxivAuthors.split(/\s*,\s*/) : [],
      summary: '',  // 重渲染不需要 abstract;真要深读会从 PDF 重新拉
      published: new Date(entry.createdAt).toISOString(),
      updated: new Date(entry.createdAt).toISOString(),
      pdfUrl: entry.pdfUrl || `https://arxiv.org/pdf/${entry.arxivId}`,
    };
  } else {
    currentArxivEntry = null;  // 上传 PDF 走的论文没 arxivId;deep-dive/save 不能用
  }
  // 第三参数 restoreFromHistory=true:不重复 recordHistory(避免产生重复条目)
  renderResult(entry.analysis, '');
  // 切到结果展示 — 滚到结果区
  const box = $('results');
  if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // 提示用户当前是缓存,可能与论文最新版本有出入
  setStatus(`✓ 已从历史恢复 ${fmtDate(entry.createdAt)} 的分析(没重新跑 LLM)。如需重跑,切回「上传 PDF / ArXiv 搜索」再点开始分析。`, 'info');
}

// ============================================================================
// 通用输入状态(影响"开始分析"按钮)
// ============================================================================
let currentPdfText: string | null = null;
let currentPdfMeta: { name: string; size: number } | null = null;
let currentArxivEntry: ArxivEntry | null = null;

// arxiv-index.json: build-arxiv-index.mjs 生成。
// schema 演进:早期是 {id → rel},后来 settings 面板要查 title,改为
// {id → {rel, title}},见 build-arxiv-index.mjs:94-100 的注释。
// paper-analyzer 用 rel 拼"查看现有笔记"链接 + 给搜索结果加"已分析"徽章;
// title 用来在 badge tooltip 里多给一行信息(让用户知道命中的是哪篇)。
interface ArxivIndexEntry { rel: string; title: string | null; }
// 惰性加载一次,缺文件/失败时回空 map。loadArxivIndex 还会做运行时校验,
// 把 schema 损坏的 entry 静默丢弃,所以这里类型是严格契约。
let arxivIndexCache: Record<string, ArxivIndexEntry> | null = null;
let arxivIndexLoading: Promise<Record<string, ArxivIndexEntry>> | null = null;
// 最近一次展示的搜索结果,index 异步加载完后再画一遍,免得首次 query 就把命中徽章丢失。
let lastRenderedEntries: ArxivEntry[] | null = null;

function updateRunButton(): void {
  const btn = $<HTMLButtonElement>('run-btn');
  // apiKey / baseUrl 不再从 UI 读 — analyzer 页面没有 cfg-* input,统一从 localStorage 拿
  const cfg = loadSettings();
  const ready = !!cfg.apiKey && (currentPdfText !== null || currentArxivEntry !== null);
  btn.disabled = !ready;
  if (!cfg.apiKey) {
    btn.textContent = '⚙ 请先在设置里填 API Key';
  } else if (currentPdfText === null && currentArxivEntry === null) {
    btn.textContent = '🚀 开始分析';
  } else {
    btn.textContent = '🚀 开始分析';
  }
}

// ============================================================================
// PDF 处理 (pdf.js)
// ============================================================================
async function ensurePdfJs(): Promise<typeof import('pdfjs-dist')> {
  const pdfjsLib = await import('pdfjs-dist');
  // Worker 来源优先级:
  //   1. 用户在「设置」面板填的 CORS 代理(getCustomProxy),走 ?url= query 拼 pdf.worker.min.mjs
  //   2. 兜底走本地 scripts/local-cors-proxy.mjs (localhost:8123) — 仅本机开发场景
  // 直连 bootcdn 在某些网络下动态 import 会失败(被报 Failed to fetch),
  // 走 CORS 代理后 worker 一定能加载。functions/api/proxy.ts 已把
  // cdn.bootcdn.net/ajax/libs/pdf.js/* 加进 allowlist(限定路径前缀,
  // 不放开整个 bootcdn),所以 PDF worker 直连能过。
  // 警告:getCustomProxy() 的返回值必须带 https:// 协议头 — 否则会
  // 拼出 "daily-paper-reader.pages.dev/api/proxy?url=...",浏览器报
  // "Failed to resolve module specifier ..."(见 settings.ts DEFAULT_PROXY)。
  const corsProxy = getCustomProxy();
  const workerTarget = 'https://cdn.bootcdn.net/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  let workerUrl: string;
  if (corsProxy) {
    if (corsProxy.endsWith('/api/proxy')) {
      workerUrl = `${corsProxy}?url=${encodeURIComponent(workerTarget)}`;
    } else {
      workerUrl = `${corsProxy}/${workerTarget}`;
    }
  } else {
    // 本机开发兜底
    workerUrl = 'http://localhost:8123/?url=' + encodeURIComponent(workerTarget);
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjsLib;
}

async function extractPdfText(file: File): Promise<string> {
  setStatus('加载 PDF 解析引擎...');
  const pdfjsLib = await ensurePdfJs();

  setStatus(`解析 PDF: ${file.name} (${(file.size / 1024).toFixed(0)} KB)...`);
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    const totalPages = doc.numPages;
    let text = '';
    const maxPages = Math.min(totalPages, 30); // 论文一般前 20 页足够
    for (let i = 1; i <= maxPages; i++) {
      setStatus(`解析 PDF 第 ${i}/${maxPages} 页...`);
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((it: any) => ('str' in it ? it.str : ''))
        .filter(Boolean)
        .join(' ');
      text += pageText + '\n\n';
      if (text.length > MAX_TEXT_CHARS) break;
    }
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS) + '\n\n[... 已截断 ...]';
    }
    return text;
  } finally {
    // PDF.js 内部 task worker + typed array,必须显式 destroy() 释放,
    // 否则页面长时间停留会累计内存(单分析任务 < 1MB 累计,批量 deep-dive 时上千 MB)。
    doc.destroy().catch(() => {});
  }
}

// 精读专用:从 ArrayBuffer 解析 PDF 文本,允许更大上限和自定义状态回调。
export async function extractPdfTextFromBuffer(
  buf: ArrayBuffer,
  statusCb: (msg: string) => void,
  opts: { maxPages?: number; maxChars?: number } = {},
): Promise<string> {
  const pdfjsLib = await ensurePdfJs();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    const totalPages = doc.numPages;
    const maxPages = opts.maxPages ?? Math.min(totalPages, 60);
    const maxChars = opts.maxChars ?? 800_000;

    let text = '';
    for (let i = 1; i <= maxPages; i++) {
      statusCb(`解析 PDF 第 ${i}/${maxPages} 页...`);
      try {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((it: any) => ('str' in it ? it.str : ''))
          .filter(Boolean)
          .join(' ');
        text += pageText + '\n\n';
      } catch (e) {
        // 防御性兜底:某些 PDF 在 worker 解析时,numPages 报告正常但 getPage(i) 仍可能抛
        // "Invalid page request"(常见于页对象损坏 / worker 半挂)。
        // 一旦遇到,后续页大概率全挂,直接停 — 已抽到的文本足够 LLM 精读。
        const msg = (e as Error)?.message || String(e);
        statusCb(`第 ${i} 页解析失败 (${msg.slice(0, 60)}),停止抽取,继续使用已抽到的 ${text.length.toLocaleString()} 字符`);
        break;
      }
      if (text.length > maxChars) break;
    }
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return text;
  } finally {
    doc.destroy().catch(() => {});
  }
}

function showFileBar(name: string, size: number): void {
  ($('file-bar') as HTMLElement).hidden = false;
  $('file-name').textContent = name;
  $('file-meta').textContent = `${(size / 1024).toFixed(0)} KB · ${name.endsWith('.pdf') ? 'PDF' : '文件'}`;
}

function clearFileBar(): void {
  ($('file-bar') as HTMLElement).hidden = true;
  currentPdfText = null;
  currentPdfMeta = null;
  ($<HTMLInputElement>('pdf-input')).value = '';
  updateRunButton();
}

// ============================================================================
// arXiv 处理
// ============================================================================
export async function fetchWithDiagnosis(url: string, label: string): Promise<Response> {
  // 浏览器原生 fetch 在 CORS / 网络层失败时只抛 "Failed to fetch",
  // 看不出是 arXiv 没 CORS 头、被 CDN 拦截、还是离线。下面把更多信息抓出来。
  //
  // arXiv (export.arxiv.org / arxiv.org/pdf/...) 不发 Access-Control-Allow-Origin,
  // 在 EdgeOne 这种静态部署站上纯 fetch 必失败,所以走 CORS 代理链兜底。
  const custom = getCustomProxy();
  const attempts: { name: string; url: string }[] = [{ name: '直连 arXiv', url }];
  if (custom) {
    // 智能拼接:如果自定义代理以 /api/proxy 结尾(Cloudflare Pages Function),
    // 用 ?url= query 参数(更稳,不用 catch-all 路由)。
    // 其他代理用 /<encoded-url> 路径拼接。
    if (custom.endsWith('/api/proxy')) {
      attempts.push({ name: `自定义(${custom})`, url: `${custom}?url=${encodeURIComponent(url)}` });
    } else {
      attempts.push({ name: `自定义(${custom})`, url: `${custom}/${url}` });
    }
  }
  for (const p of CORS_PROXIES) attempts.push({ name: p.name, url: p.wrap(url) });

  const tried: string[] = [];
  let lastErr = '';
  for (const a of attempts) {
    tried.push(`${a.name} → ${a.url}`);
    try {
      const res = await fetch(a.url, { mode: 'cors' });
      if (res.ok) return res;
      // arXiv 真实存在但代理返回 5xx / 404 → 不是 CORS 问题,直接报错不再试
      if (res.status >= 400 && res.status < 500 && a.name !== '直连 arXiv') {
        lastErr = `${a.name} 返回 ${res.status}`;
        continue;
      }
      lastErr = `${a.name} 返回 ${res.status}`;
    } catch (e) {
      lastErr = `${a.name}: ${(e as Error)?.message || e}`;
      // CORS / 网络错误 → 继续试下一个代理
    }
  }
  const detail = [
    `请求 ${label} 失败: ${lastErr || '所有通道都失败'}`,
    `目标: ${url}`,
    `尝试过的通道:`,
    ...tried.map((t) => `  - ${t}`),
    `可能原因:`,
    `  1) arXiv 不返回 CORS 头 — 在静态部署站上几乎一定发生,会走代理`,
    `  2) 当前代理全挂了 / 限流(公共 CORS 代理经常变)`,
    `  3) 网络层拦截(运营商 / 企业网关)`,
    `解决:`,
    `  - 在浏览器里手动打开上面任一代理 URL 看是否能拿到数据`,
    `  - 若公共代理全挂,在 localStorage 设 dpr_analyzer_proxy_v1 = 你的代理前缀(如 https://your-proxy.example.com)`,
    `  - 或部署一个轻量 Cloudflare Worker (5 行代码) 做转发`,
  ].join('\n');
  throw new Error(detail);
}

// 对齐 [[feedback_arxiv_version_dedup]] 的规则:同一篇论文多版本时只保留最新的 v#。
// dedupeLatestVersion: 默认 true,主题搜索时也希望稳定命中一篇。
// (canonicalArxivId 现在从 lib/dom-utils 导入,见文件顶部。)

export async function searchArxiv(query: string, opts: { dedupeLatestVersion?: boolean; mode?: 'title' | 'all' } = {}): Promise<ArxivEntry[]> {
  // arXiv API:title / all / au 前缀,以及 cat: 类目限定。
  //   - ti: 限定只在标题搜,避免 "StarBench" 这种生造词被 all: 全文匹配搜到一堆老论文
  //   - all: 标题 + 摘要全文搜索,召回更高(适合冷门 query)
  //   - cat: 限定只搜用户勾选的类目(默认 cs 主流 6 类),物理/数学等无关论文直接过滤掉
  //   - 多个 cat 之间 OR,等效把搜索限定在这些类目
  // 用户输入完整的 arXiv ID 时(如 1706.03762),走 searchArxivById,不走这里。
  //
  // search_query 整段一起 encode 一次(URL 编码不能嵌套),field: 段里 q 也不能再二次 encode。
  const q = query.trim();
  const catFilter = buildCategoryFilter(loadCategories());
  const field = opts.mode === 'all' ? 'all' : 'ti';
  const searchExpr = catFilter ? `${field}:"${q}" AND ${catFilter}` : `${field}:"${q}"`;
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchExpr)}&max_results=12&sortBy=relevance&sortOrder=descending`;
  const res = await fetchWithDiagnosis(url, 'arXiv 搜索');
  if (!res.ok) throw new Error(`arXiv API 返回 ${res.status}`);
  const xmlText = await res.text();
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) throw new Error('arXiv 返回无法解析');

  const entries = Array.from(doc.querySelectorAll('entry')).map(parseArxivEntry).filter((e): e is ArxivEntry => e !== null);
  if (opts.dedupeLatestVersion === false) return entries;
  // arXiv 同篇论文多版本时按 <updated> 时间戳降序,第一个就是最新;
  // 注意: <published> 永远是 v1 首发的日期,所有版本都一样,用它做 dedup
  // 会永远选中 v1,导致多版本论文的前端卡片永远指向旧版本(见 6821f09)。
  // 按 canonical id 取首条。
  const byCanonical = new Map<string, ArxivEntry>();
  for (const e of entries) {
    const key = canonicalArxivId(e.arxivId);
    const cur = byCanonical.get(key);
    if (!cur || (e.updated || '') > (cur.updated || '')) byCanonical.set(key, e);
  }
  return Array.from(byCanonical.values());
}

export async function searchArxivById(arxivId: string): Promise<ArxivEntry[]> {
  // 用 id_list 精确查一篇,验证它真存在
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
  const res = await fetchWithDiagnosis(url, 'arXiv ID 查询');
  if (!res.ok) throw new Error(`arXiv API 返回 ${res.status}`);
  const xmlText = await res.text();
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const rawEntries = Array.from(doc.querySelectorAll('entry'));
  if (rawEntries.length === 0) {
    throw new Error(`arXiv 上找不到论文 ${arxivId},检查一下 ID 是否输对了`);
  }
  const parsed = rawEntries.map(parseArxivEntry).filter((e): e is ArxivEntry => e !== null);
  if (parsed.length === 0) {
    throw new Error(`arXiv 论文 ${arxivId} 元数据无法解析`);
  }
  return parsed;
}

export function parseArxivEntry(e: Element): ArxivEntry | null {
  const idFull = e.querySelector('id')?.textContent?.trim() ?? '';
  // idFull 形如 http://arxiv.org/abs/1706.03762v7
  const arxivId = idFull.split('/abs/').pop() ?? '';
  const title = (e.querySelector('title')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // 跳过 arXiv 的占位 entry(title 是 "Error" 或空,作者为 0)
  if (!title || title.toLowerCase() === 'error' || title.length < 3) return null;
  const summary = (e.querySelector('summary')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const authorNodes = Array.from(e.querySelectorAll('author name'));
  const authors = authorNodes.map((n) => n.textContent?.trim() ?? '').filter(Boolean);
  const published = e.querySelector('published')?.textContent?.trim() ?? '';
  const updated = e.querySelector('updated')?.textContent?.trim() ?? '';
  // PDF 链接:优先取 entry 里 rel=related 或 title=pdf 的 link
  const pdfLink = Array.from(e.querySelectorAll('link')).find((l) =>
    l.getAttribute('title') === 'pdf' || l.getAttribute('rel') === 'related'
  );
  const pdfUrl = pdfLink?.getAttribute('href') ?? `https://arxiv.org/pdf/${arxivId}`;
  return { id: idFull, arxivId, title, authors, summary, published, updated, pdfUrl };
}

export async function fetchArxivPdf(pdfUrl: string, statusCb?: (msg: string) => void): Promise<ArrayBuffer> {
  (statusCb ?? (() => {}))('下载 arXiv PDF...');
  // 走同一个 fetchWithDiagnosis:先直连,失败再走代理链。
  // 若代理返回 HTML 错误页(200 但内容不是 PDF),pdf.js 后面会 catch 抛 Invalid PDF,
  // 此时由 runAnalysis 里的 "PDF 解析失败" 分支处理,告诉用户 arXiv 可能 404。
  const res = await fetchWithDiagnosis(pdfUrl, 'arXiv PDF');
  if (!res.ok) throw new Error(`下载 PDF 失败 (${res.status})`);
  return res.arrayBuffer();
}

// ============================================================================
// arXiv 索引(由构建期 build-arxiv-index.mjs 生成 public/arxiv-index.json)
// ============================================================================
async function loadArxivIndex(): Promise<Record<string, ArxivIndexEntry>> {
  if (arxivIndexCache) return arxivIndexCache;
  if (arxivIndexLoading) return arxivIndexLoading;
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const url = `${base}/arxiv-index.json`;
  arxivIndexLoading = (async () => {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`arxiv-index.json ${r.status}`);
      // 运行时校验 schema:build-arxiv-index.mjs 写的是 {[id]: {rel, title}},
      // 但 old-shape (id → rel 字符串) 也可能在本地 / 历史 dist 里残留。
      // 旧 shape 当成 rel 用;非对象 / 缺 rel → 静默丢弃,避免后续 escapeHtml 抛
      // "t.replace is not a function"(这就是用户报的 t.replace bug 来源)。
      const raw = (await r.json()) as Record<string, unknown>;
      const data: Record<string, ArxivIndexEntry> = {};
      for (const [k, v] of Object.entries(raw || {})) {
        if (typeof v === 'string') {
          // 旧 schema 兼容:id 直接映射到 rel,无 title。
          data[k] = { rel: v, title: null };
        } else if (v && typeof v === 'object' && typeof (v as any).rel === 'string') {
          data[k] = {
            rel: (v as any).rel,
            title: typeof (v as any).title === 'string' ? (v as any).title : null,
          };
        }
        // 其他形态(数组 / 数字 / null)直接 skip,不污染 cache。
      }
      arxivIndexCache = data;
    } catch (err) {
      // 缺文件 / 网络失败 / 构建期漏跑 — 不阻塞,UI 走"未命中"路径
      console.warn('[arxiv-index] load failed:', (err as Error).message);
      arxivIndexCache = {};
    }
    return arxivIndexCache!;
  })();
  return arxivIndexLoading;
}

/**
 * 命中已存在的笔记路径(repo-相对,形如 "docs/20260625-...md")或 null。
 */
function findExistingNote(arxivId: string): string | null {
  const idx = arxivIndexCache || {};
  return idx[arxivId]?.rel || null;
}

function renderArxivResults(entries: ArxivEntry[]): void {
  lastRenderedEntries = entries;
  const box = $('arxiv-results');
  if (entries.length === 0) {
    box.innerHTML = '<div style="padding:1rem;color:var(--fg-subtle)">未找到结果,试试用论文标题全称或 arXiv ID。</div>';
    box.hidden = false;
    return;
  }
  // 优先使用已缓存的索引(同步命中卡片徽章),不阻塞 UI。
  const idx = arxivIndexCache || {};
  box.innerHTML = entries
    .map((e, i) => {
      // 索引 schema 是 {id: {rel, title}};只取 rel 拼 URL,取 title 给 badge tooltip 展示命中是哪篇。
      const existingEntry = idx[e.arxivId];
      const existingPath = existingEntry?.rel || null;
      const existingTitle = existingEntry?.title || null;
      const badge = existingPath
        ? `<span class="analyzer-existing-badge" title="docs 已有笔记: ${escapeHtml(existingPath)}${existingTitle ? ` · ${escapeHtml(existingTitle)}` : ''}">📎 已分析</span>`
        : '';
      const existingClass = existingPath ? ' analyzer-arxiv-item-existing' : '';
      const existingLink = existingPath
        ? `<a class="analyzer-existing-link" href="${escapeHtml(docsPathToUrl(existingPath))}" onclick="event.stopPropagation()">查看现有笔记 →</a>`
        : '';
      return `
      <a class="analyzer-arxiv-item${existingClass}" data-idx="${i}" href="javascript:void(0)">
        <div class="analyzer-arxiv-meta">arXiv:${escapeHtml(e.arxivId)} · ${escapeHtml(e.published.slice(0, 10))} · ${e.authors.length} 位作者${badge}</div>
        <div class="analyzer-arxiv-title">${escapeHtml(e.title)}</div>
        <div class="analyzer-arxiv-summary">${escapeHtml(e.summary)}</div>
        ${existingLink}
      </a>
    `;
    })
    .join('');
  box.hidden = false;

  // 绑定选择
  $$('.analyzer-arxiv-item', box).forEach((el, i) => {
    el.addEventListener('click', () => {
      $$('.analyzer-arxiv-item', box).forEach((x) => x.classList.remove('selected'));
      el.classList.add('selected');
      currentArxivEntry = entries[i];
      updateRunButton();
    });
  });
}

// ============================================================================
// LLM 调用 (OpenAI 兼容)
// ============================================================================
// 与后台 pipeline (src/6.generate_docs.py: build_overview_glance) 对齐的字段和长度规范,
// 这样 web 单篇分析与 daily 自动抓取得到的速览笔记内容一致。
// 字段:title / title_en / authors / tldr / motivation / method / result / conclusion。
export const SYSTEM_PROMPT = `你是论文速览助手，请用中文生成信息密度高、但不冗长的论文速览。

【输出格式 — 必须遵守】
- 只输出一个 JSON 对象,不要输出任何其它文字。
- 不要写 <think> 思考块,不要写解释,不要写 markdown 围栏(不要 \`\`\`json)。
- 第一行必须是 { ,最后一行必须是 }。
- 中文表达,术语首次出现可附英文。

【JSON 字段与长度规范】
- title: 论文中文标题(自拟,简洁准确)
- title_en: 原文标题(英文)
- authors: 作者列表(英文,逗号分隔;若不确定可省)
- tldr: 150-220 个中文字符,3-4 个短句,按"问题背景→核心方法→关键结果→贡献意义"组织
- motivation / method / result / conclusion: 每个字段 30-70 个中文字符,一句话,对标论文速览卡片,简洁但必须包含具体信息(数字、模型名、方法名等)
- context(主题语境,新增):40-90 个中文字符,1-2 句话,把这篇论文放回所属研究主题里定位——
  说明它在该主题脉络中的位置(承接/扩展/对比哪类已有工作)、典型适用场景或边界条件、
  已知局限性或仍未解决的问题。**不要重复 TLDR / motivation / method / result / conclusion 里已经说过的事实**,
  写的是"如果只把这篇论文放回主题坐标系,它大致在哪个象限、相对其他工作最值得注意的点是什么"。
- topic_tags(主题标签):从下方"预置清单"里挑 1-4 个最贴切的标签,输出为 JSON 字符串数组。
  - **每个元素必须完全等于清单中某一项的字面值**(大小写、连字符、空格都按清单原样)。
  - 例:["RL","MAS"] 或 ["self distillation","RL"];完全不命中时输出 []。
  - 不许改写大小写、不许翻译成中文、不许编造、不许在新标签里塞笔记段落。

【预置清单 — topic_tags 严格从这里挑,大小写 / 连字符 / 空格按以下原样】
- RL — 强化学习(reinforcement learning、policy optimization、MDP、Q-learning 等)
- MAS — 多智能体系统(multi-agent、cooperation、swarm、agent communication 等)
- game ai — 游戏 AI(博弈论、self-play、StarCraft、游戏对战 等)
- self distillation — 自蒸馏(self-imitation、policy self-distillation、on-policy distillation 等)
- intervention — 大模型干预(steering vector、activation patching、representation engineering 等)
- llm-agent — LLM 驱动的智能体(tool use、ReAct、function calling、agentic workflow 等)
- reasoning — 推理增强(chain-of-thought、CoT、math reasoning、search-augmented reasoning 等)
- gui — GUI 智能体(GUI agent、WebShop、mobile UI、computer use 等)
- vision — 计算机视觉 / 多模态(VLM、image classification、video、segmentation 等)
- speech — 语音 / 音频(speech recognition、text-to-speech、audio generation 等)
- safety — AI 安全 / 对齐(jailbreak、adversarial、alignment、harmful generation 等)
- retrieval — 信息检索 / RAG(dense retrieval、reranker、retrieval-augmented generation 等)
- code — 代码生成 / 程序合成(code LLM、completion、program synthesis 等)
- robotics — 机器人 / 具身智能(manipulation、locomotion、sim-to-real、embodied AI 等)
- knowledge — 知识表示 / 知识图谱(KG、entity linking、relation extraction 等)

【内容要求】
- 不要把英文句子放进中文字段;可保留必要英文术语或模型名
- 不要编造数字,如果原文没提就说"未给出具体数字"
- 如果正文明显不完整,根据已有内容合理推断,但要简明
- tldr / motivation / method / result / conclusion / context 之间要互补不重复:
  tldr 写宏观叙事(背景→方法→结果→贡献),四段写具体细节,context 写主题坐标——三块内容分工明确,
  这样用户看完任意一段都不会觉得信息有缺口`;

function buildUserPrompt(title: string, abstract: string, body: string): string {
  // 对齐 src/6.generate_docs.py: payload = {"title": title, "abstract": abstract}
  // 优先用 arxiv 元数据里的 title/abstract;长正文作为补充上下文。
  const payload = JSON.stringify({ title, abstract: abstract || '(无 abstract,从正文摘录)', body_excerpt: body.slice(0, 8000) }, null, 0);
  return (
    "请基于上面的 JSON 中的 title / abstract / body_excerpt,输出一个中文速览摘要,严格返回 JSON(不要输出任何其它文字):\n" +
    "{\"title\":\"...\",\"title_en\":\"...\",\"authors\":\"...\",\"tldr\":\"...\",\"motivation\":\"...\",\"method\":\"...\",\"result\":\"...\",\"conclusion\":\"...\",\"context\":\"...\",\"topic_tags\":[\"...\",...]}\n" +
    "Output must be strict JSON only, no markdown, no fences, no extra text."
  ).replace("上面的 JSON", payload + "\n上面的 JSON");
}

// 规范化 topic_tags:限长、去空、去重、按 TOPIC_ALLOWLIST 严格匹配,不在清单的丢弃。
// LLM 偶尔会返回自由词或拼写变体;这里兜底成空数组,buildFrontmatter 会用 arxivId 前缀兜底。
function normalizeTopicTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    if (!t) continue;
    const lower = t.toLowerCase();
    if (!TOPIC_ALLOWLIST_LOWER.has(lower)) continue;  // 不在清单 → 丢弃
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(t);  // 保留 LLM 字面值(大小写/连字符),与 system prompt 清单一一对应
    if (out.length >= 4) break;
  }
  return out;
}

export async function callLLM(
  title: string,
  abstract: string,
  paperBody: string,
  cfg: LLMConfig,
  statusCb?: (msg: string) => void,
): Promise<AnalysisResult> {
  const note = statusCb ?? (() => {});
  note('调用 LLM 生成摘要...');
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  // 对 DeepSeek 的 R 系列(reasoning 模型),显式禁用思考块。
  // 非 DeepSeek provider 没这个字段,会报 400,所以只对 deepseek-* 加。
  const isDeepSeek = /^https?:\/\/api\.deepseek\.com/i.test(cfg.baseUrl);
  const isReasoning = /reasoner|reasoning|r1/i.test(cfg.model);
  const requestBody: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(title, abstract, paperBody) },
    ],
    temperature: 0.2,
    // cap LLM output so JSON is not truncated mid-field
    max_tokens: 4000,
  };
  if (isDeepSeek && isReasoning) {
    requestBody.thinking = { type: 'disabled' };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM API 错误 (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? '';
  const finishReason: string = data?.choices?.[0]?.finish_reason ?? '';
  if (!content) throw new Error(`LLM 返回为空 (finish_reason=${finishReason})`);

  // 提取 JSON:reasoning 模型(DeepSeek-R1 等)会在前面输出 <think>...</think>,
  // 也要兼容 markdown fence ```json ... ```。先剥这些外壳,再用栈匹配找配对 JSON。
  let stripped = content
    // 剥 <think>...</think>(reasoning 模型)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // 剥 markdown fence
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  let jsonText = extractBalancedJson(stripped);

  // Truncation self-heal: if LLM output was cut at max_tokens, the JSON
  // may be missing trailing `}` or `"`. Try to close them and re-parse.
  if (!jsonText && stripped.includes('{')) {
    const lastBrace = stripped.lastIndexOf('{');
    if (lastBrace >= 0) {
      let trial = stripped.slice(lastBrace);
      let opens = 0;
      let inStr = false;
      let esc = false;
      for (const ch of trial) {
        if (esc) { esc = false; continue; }
        if (inStr) {
          if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') opens++;
        else if (ch === '}') opens--;
      }
      if (inStr) trial += '"';
      while (opens > 0) { trial += '}'; opens--; }
      jsonText = trial;
    }
  }
  if (!jsonText) {
    throw new Error(`LLM 未输出 JSON (finish_reason=${finishReason}, 返回前 200 字符: ${content.slice(0, 200).replace(/\s+/g, ' ')})`);
  }
  let parsed: AnalysisResult;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`JSON 解析失败: ${(e as Error).message} | finish_reason=${finishReason} | LLM 输出前 200 字符: ${content.slice(0, 200).replace(/\s+/g, ' ')}`);
  }
  // 必要字段兜底
  return {
    title: parsed.title || title || '(未命名)',
    title_en: parsed.title_en,
    authors: parsed.authors,
    tldr: parsed.tldr || '',
    motivation: parsed.motivation || '',
    method: parsed.method || '',
    result: parsed.result || '',
    conclusion: parsed.conclusion || '',
    context: parsed.context || '',
    // topic_tags 由 normalizeTopicTags 按 TOPIC_ALLOWLIST 严格过滤;
    // LLM 没返回 / 字段缺失 / 格式错乱时降级为 [],buildFrontmatter 再 fallback 到 arxivId 前缀。
    topic_tags: normalizeTopicTags(parsed.topic_tags),
  };
}

// ============================================================================
// 长文精读(Deep Dive) —— 基于 PDF 全文的中文长文解读
// 与速读流程解耦:不写盘、不走 GitHub、纯浏览器内一次性阅读体验。
// ============================================================================

// 各 model 的 context window(token),查不到时兜底 32K。
const MODEL_CONTEXT: Record<string, number> = {
  // 用户当前实际使用(2026-07-05 截图确认)
  'MiniMax-M3': 1_000_000,
  // 仓库预设
  'MiniMax-Text-01': 1_000_000,
  'abab6.5s-chat': 32_000,
  'abab5.5-chat': 16_000,
  // 其他常见 model
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,
  'Qwen/Qwen2.5-7B-Instruct': 32_000,
  'Qwen/Qwen2.5-14B-Instruct': 32_000,
  'Qwen/Qwen2.5-32B-Instruct': 32_000,
  'Qwen/Qwen2.5-72B-Instruct': 32_000,
  'moonshot-v1-8k': 8_000,
  'moonshot-v1-32k': 32_000,
  'moonshot-v1-128k': 128_000,
  'glm-4-flash': 128_000,
  'glm-4-air': 128_000,
  'glm-4-plus': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4o': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-3.5-turbo': 16_000,
};

function estimateContext(model: string): number {
  if (MODEL_CONTEXT[model]) return MODEL_CONTEXT[model];
  const lower = (model || '').toLowerCase();
  // 后备:按 key 长度倒序匹配,优先取最具体的(例如 'deepseek-reasoner'
  // 必须先于 'deepseek-chat' 命中)。substring 排序不能保证先后 — 直接
  // 按 key.length 倒序遍历更稳。
  const keys = Object.keys(MODEL_CONTEXT).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (lower.includes(k.toLowerCase())) return MODEL_CONTEXT[k];
  }
  return 32_000; // 保守兜底
}

// 估算 PDF 文本占用的 token 数(中英文混排典型值:3 字符 ≈ 1 token)
function estimatePdfTokens(chars: number): number {
  return Math.ceil(chars / 3);
}

const DEEPDIVE_SYSTEM_PROMPT = `你是论文精读助手,擅长把英文学术论文深度解读给中文读者。

【输出格式】
- 直接输出 markdown,不要输出 JSON,不要写 markdown 围栏(不要 \`\`\`)。
- 不要写  思考块。

【章节结构(严格按顺序,共 8 章)】
## 一、全文翻译(节选)
- 翻译 abstract + introduction 核心段(300-500 中文字符)

## 二、研究背景与动机
- 这篇论文要解决什么问题?为什么重要?200-400 字

## 三、方法详解
### 3.1 整体框架
- 一段话说清整体 pipeline / framework
### 3.2 关键模块
- 拆解 2-4 个核心模块,每个 100-200 字
### 3.3 关键公式解读
- 用 $LaTeX$ 列出 1-3 个最核心的公式(不要列所有公式),每个公式后用一句中文解释每个符号的含义
### 3.4 图表解读
- 描述 1-3 个最关键图表展示了什么(基于正文中的 caption / 实验描述推断,不要假装看到图)

## 四、实验设置与结果
### 4.1 数据集与基线
- 数据集名称 + 规模,基线方法列表
### 4.2 主要结果
- 关键指标 + 数字,提升幅度
### 4.3 消融实验
- 1-2 个核心消融结论

## 五、Related Work 与本文定位
- 这篇论文在领域中的位置,与已有方法的核心区别

## 六、优点与局限性
- 优点 3 条,局限性 2-3 条(基于正文批判性分析)

## 七、复现要点
- 数据/代码开源情况,核心超参,硬件需求

## 八、适用场景与延伸思考
- 这篇方法适合什么场景?哪些下游任务可以借鉴?未来工作方向

【内容纪律】
- 专业术语首次出现给中英对照(例:对比学习 contrastive learning)
- 引用论文保持英文原名
- 不确定的内容明确写"原文未明确说明"
- 不要编造数字,如果原文没提就说"原文未给出具体数字"
- 中文为主,公式 / 模型名 / 论文名保留英文
- 总长度 4000-7000 中文字符`;

// ============================================================================
// 长文精读:错误上报 + body 大小防护 + 自动 chunk
// ============================================================================


async function readErrorBody(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t || '';
  } catch { return ''; }
}

// 检测 body 是不是 Cloudflare / CDN challenge 页(关键误判来源)。
function looksLikeWaf(body: string): boolean {
  return WAF_SIGNATURE.test(body);
}

// 单次 LLM 调用,自动按字节阈值分块。返回 markdown 字符串。
// systemMsg / userContent 是已经构造好的字符串;调用方决定是否要走 chunk 模式。
async function invokeChatCompletion(
  cfg: LLMConfig,
  systemMsg: string,
  userContent: string,
  label: string,
  statusCb: (msg: string) => void,
  opts: { maxOutputTokens?: number } = {},
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const isDeepSeek = /^https?:\/\/api\.deepseek\.com/i.test(cfg.baseUrl);
  const isReasoning = /reasoner|reasoning|r1/i.test(cfg.model);

  // 量 body 字节 — 对纯 ASCII 文本 byteLength === 字符数;含中文时略大于字符数。
  // 用 TextEncoder 量实际 UTF-8 字节数最准确但贵,这里降级用 1.5x 估。
  const estimatedBytes = new TextEncoder().encode(
    JSON.stringify({ system: systemMsg, user: userContent }),
  ).length;

  if (estimatedBytes <= REQUEST_BODY_LIMIT_BYTES) {
    return await invokeOne(url, cfg, systemMsg, userContent, isDeepSeek, isReasoning, label, estimatedBytes);
  }
  statusCb(`请求体过大(≈ ${(estimatedBytes / 1024 / 1024).toFixed(1)} MB),自动分段调用 LLM...`);
  return await chunkAndCall(url, cfg, systemMsg, userContent, isDeepSeek, isReasoning, label, statusCb);
}

async function invokeOne(
  url: string, cfg: LLMConfig,
  systemMsg: string, userContent: string,
  isDeepSeek: boolean, isReasoning: boolean,
  label: string, sentBytes: number,
): Promise<string> {
  const requestBody: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemMsg },
      { role: 'user', content: userContent },
    ],
    temperature: 0.3,
  };
  if (isDeepSeek && isReasoning) {
    requestBody.thinking = { type: 'disabled' };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });
  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new Error(formatLlmError(label, res.status, sentBytes, body));
  }
  const data = await res.json();
  let content: string = data?.choices?.[0]?.message?.content ?? '';
  if (!content) throw new Error(`${label}: LLM 返回为空`);
  // 剥 reasoning 模型 思考块 + markdown fence
  content = content
    .replace(/<[Tt]hink(?:ing)?Block>[\s\S]*?<\/(?:[Tt]hink|ThinkingBlock)>/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:markdown)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  return content;
}

function formatLlmError(label: string, status: number, sentBytes: number, body: string): string {
  const mb = Math.round(sentBytes / 1024 / 1024 * 10) / 10;
  const bodyExcerpt = body.slice(0, 2000).replace(/\s+/g, ' ');
  const isWaf = looksLikeWaf(body);
  const wafNote = isWaf
    ? `\n⚠ 检测到 Cloudflare / CDN WAF 拦截标记 — 大概率是 CDN 在前拦截(请求体过大 / 触发风控),不是 LLM 真实错误。\n建议:设置 → 长文精读 里减小 maxPages 或开启紧凑模式;或切换 LLM provider。`
    : '';
  return `${label} (HTTP ${status}) [请求体 ≈ ${mb} MB]:\n${bodyExcerpt}${wafNote}`;
}

// 把 userContent 按 PDF 文本段切块串行调用,每段拼成 ## 段 N 解读。
// 段间留 CHUNK_OVERLAP_CHARS 重叠。Markdown 输出格式:
//   # 综合精读\n\n## 段 1 解读\n<md>\n\n---\n\n## 段 2 解读\n<md>
async function chunkAndCall(
  url: string, cfg: LLMConfig,
  systemMsg: string, userContent: string,
  isDeepSeek: boolean, isReasoning: boolean,
  label: string, statusCb: (msg: string) => void,
): Promise<string> {
  // 找 userContent 里 PDF 文本的起点 — "[PDF 全文节选]" 之后算 PDF,之前的(speedReadHint + 标题 + ...)每段重复带上,避免 LLM 丢失上下文。
  const pdfMarker = '[PDF 全文节选]';
  const markerIdx = userContent.indexOf(pdfMarker);
  const prefix = markerIdx >= 0 ? userContent.slice(0, markerIdx + pdfMarker.length) + '\n' : '';
  const pdfText = markerIdx >= 0 ? userContent.slice(markerIdx + pdfMarker.length + 1) : userContent;

  const total = pdfText.length;
  const stride = CHUNK_TARGET_CHARS;
  const overlap = CHUNK_OVERLAP_CHARS;
  const step = stride - overlap;
  if (step <= 0) throw new Error('chunk 配置错误');
  const chunks: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < total; i += step) {
    const end = Math.min(i + stride, total);
    chunks.push({ start: i, end, text: pdfText.slice(i, end) });
    if (end >= total) break;
  }
  const N = chunks.length;
  statusCb(`分段调用 LLM (${N} 段)...`);
  const parts: string[] = [];
  for (let i = 0; i < N; i++) {
    const c = chunks[i];
    const overlapHeader = i > 0
      ? `\n[上一段末尾 ${overlap} 字符提示] ${pdfText.slice(Math.max(0, c.start - overlap), c.start)}\n\n[本段 PDF 文本 起止 ${c.start}-${c.end}]\n`
      : `\n[本段 PDF 文本 起止 0-${c.end}]\n`;
    const fullUser = `${prefix}${overlapHeader}${c.text}`;
    statusCb(`${label} (${i + 1}/${N})...`);
    let md: string;
    try {
      md = await invokeOne(url, cfg, systemMsg, fullUser, isDeepSeek, isReasoning, `${label} 第 ${i + 1}/${N} 段`, fullUser.length);
    } catch (e) {
      throw new Error(`${label}: 第 ${i + 1}/${N} 段失败 — 已成功 ${i}/${N} 段\n${(e as Error).message}`);
    }
    parts.push(md);
  }
  // 拼合:每段用 ## 段 N 解读 包起来,中间 --- 分隔
  const combined = parts.map((md, i) => `## 段 ${i + 1} 解读\n\n${md}`).join('\n\n---\n\n');
  return `# 综合精读\n\n${combined}`;
}

interface DeepDiveResult {
  markdown: string;
  truncated: boolean;
  pdfChars: number;
  pdfTokensEstimate: number;
  contextTokens: number;
  usedModel: string;
  // 注入给 LLM 的图基础路径(留空 = 退化纯文字描述,LLM 不插图)。
  // 形如 `assets/figures/arxiv/2510.18483v1`(相对 docs/ 仓库根)
  figureBase: string;
  // 该论文已抽出的图数量(前端从 docs/assets/figures/arxiv/<id>/fig-*.webp 数出来)
  figureCount: number;
}

async function runDeepDive(
  r: AnalysisResult,
  entry: ArxivEntry | null,
  cfg: LLMConfig,
  statusCb: (msg: string) => void,
  opts: { figureBase?: string; figureCount?: number } = {},
): Promise<DeepDiveResult> {
  if (!entry || !entry.pdfUrl) {
    throw new Error('当前结果没有 arxiv PDF URL(仅 arxiv 论文支持精读)');
  }

  // 1. 下载 PDF
  statusCb('下载 PDF...');
  const buf = await fetchArxivPdf(entry.pdfUrl);
  // 校验前 4 字节是不是 %PDF(避免 proxy 返回 HTML 错误页)
  const head = new Uint8Array(buf.slice(0, 4));
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  if (!isPdf) {
    throw new Error('PDF 下载失败(proxy 可能返回了 HTML 错误页),请检查网络或切换自定义代理');
  }

  // 2. 解析 PDF 文本 — maxPages 由用户设置控制(默认 20,见 settings.ts)
  statusCb('提取 PDF 文本...');
  const dd = loadDeepDiveSettings();
  const rawText = await extractPdfTextFromBuffer(buf, statusCb, {
    maxPages: dd.maxPages,
  });
  if (rawText.length < 500) {
    throw new Error('PDF 文本过短(可能为扫描版或加密文档),无法精读');
  }

  // 3. 按 model context 计算可用 PDF 字符数
  const ctx = estimateContext(cfg.model);
  // 留给 prompt(system+user ≈ 4K token) + output(8K token) + 思考(2K) 余量
  const RESERVED = 16_000;
  const availableTokens = Math.max(ctx - RESERVED, 16_000);
  const maxChars = Math.min(800_000, availableTokens * 3);
  let pdfTokensEstimate = estimatePdfTokens(rawText.length);
  let truncated = rawText.length > maxChars;
  let pdfText = truncated ? rawText.slice(0, maxChars) : rawText;

  // compact 模式:只读前 dd.compactPages 页(纯文本层截断,无论上面 maxChars)。
  // 30K 字符/页是 PDF 文本层的保守上限,通常一页 2-4K 字符;30K 留 buffer 给稀疏扫描页。
  if (dd.compact) {
    const compactChars = dd.compactPages * 30_000;
    if (pdfText.length > compactChars) {
      pdfText = pdfText.slice(0, compactChars);
      truncated = true;
    }
  }

  if (truncated) {
    statusCb(`PDF 较长,已截断到前 ${Math.round((pdfText.length / rawText.length) * 100)}%`);
  }

  // 4. 调用 LLM
  statusCb('调用 LLM 生成精读...');
  const speedReadHint = [
    r.tldr && `[速览 TLDR] ${r.tldr}`,
    r.motivation && `[速览 动机] ${r.motivation}`,
    r.method && `[速览 方法] ${r.method}`,
    r.result && `[速览 结果] ${r.result}`,
    r.conclusion && `[速览 结论] ${r.conclusion}`,
    r.context && `[速览 主题语境] ${r.context}`,
  ].filter(Boolean).join('\n');

  const truncateNotice = truncated
    ? `\n\n[注意] PDF 文本较长,本次精读仅基于前 ${Math.round((maxChars / rawText.length) * 100)}% 内容(超出上下文窗口已截断),请基于已有内容推断剩余部分并明确标注"原文未明确说明"。\n`
    : '';

  // 图提示:如果 figureBase 存在,告诉 LLM 在适当章节插图;否则退化纯文字描述。
  const figureHint = opts.figureBase
    ? `\n\n[可用图表] docs/assets/figures/arxiv/<arxiv-id>/ 已抽出 ${opts.figureCount ?? 0} 张图,文件名形如 fig-001.webp。
在"## 三、方法详解"或"## 四、实验设置与结果"等章节提到论文核心 figure/table 时,使用 markdown 图片语法插入对应图:

  ![Figure N 标题](${opts.figureBase}/fig-NNN.webp)

NNN 用三位数(001, 002, ...);只能引用实际存在的图(不要编造编号)。若不确定,纯文字描述即可,不要强行插图。`
    : `\n\n[图表说明] 该论文尚未抽图,## 3.4 / ## 4.x 章节请用纯文字描述图表内容,不要插入图片。`;

  const compactHint = dd.compact
    ? `\n\n[模式] compact 精读:仅基于 PDF 前 ${dd.compactPages} 页(abstract + intro + method 头部)。涉及后续章节请写"原文未明确说明"。`
    : '';

  const userPrompt = `${speedReadHint}\n\n[论文标题] ${r.title_en || r.title}${compactHint}\n\n[PDF 全文节选]\n${pdfText}${truncateNotice}${figureHint}`;

  // 走 invokeChatCompletion:超 900KB body 自动按字符切 chunk 串行调用再拼合。
  const content = await invokeChatCompletion(
    cfg,
    DEEPDIVE_SYSTEM_PROMPT,
    userPrompt,
    '精读生成',
    statusCb,
  );

  return {
    markdown: content,
    truncated,
    pdfChars: rawText.length,
    pdfTokensEstimate,
    contextTokens: ctx,
    usedModel: cfg.model,
    figureBase: opts.figureBase || '',
    figureCount: opts.figureCount || 0,
  };
}

// ============================================================================
// 精读 → GitHub 持久化触发(模块顶层)
// ============================================================================

// 当前最近一次生成的精读结果(供"保存精读到 GitHub"按钮使用)
let currentDeepDive: DeepDiveResult | null = null;

// 探测 docs/ 仓库是否已有该论文抽出的图(返回 ≥1 = 已存在,workflow 跳过抽图)
async function probeExistingFigures(arxivId: string): Promise<number> {
  const repo = loadGitHubRepo();
  const token = loadGitHubToken();
  if (!token || !repo?.owner) return 0;
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/docs/assets/figures/arxiv/${encodeURIComponent(arxivId)}/fig-001.webp`;
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    return res.ok ? 1 : 0;
  } catch {
    return 0;
  }
}

// 触发 save-paper.yml (mode=combined):
//   - 前端拼好完整 .md(frontmatter + 速读四段 + Abstract + 精读全文),塞进 md_content
//   - workflow 不依赖 docs 仓库里是否已有 .md(用户从论文分析页搜到就精读,可能从未点过 📤)
//   - 如果 docs/ 仓库已经有该论文的图(后台 daily 跑过),needs_figures=false(快速路径)
//   - 否则 needs_figures=true,让 workflow 端用 PyMuPDF 抽图,再回写 figures_json
async function saveDeepDiveToGitHub(
  r: AnalysisResult,
  entry: ArxivEntry,
  deepDive: DeepDiveResult,
): Promise<void> {
  const token = loadGitHubToken();
  const repo = loadGitHubRepo();
  if (!token) throw new Error('请先在 /settings/ 页面填 GitHub PAT(需要 repo 权限)');

  const slug = slugifyTitle(r.title || r.title_en || entry.title, entry.arxivId);
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/workflows/${repo.workflow}/dispatches`;

  setStatus('正在检查 docs/ 是否已有该论文图表...');
  const existingFigs = await probeExistingFigures(entry.arxivId);
  const needsFigures = existingFigs === 0 ? 'true' : 'false';

  setStatus(`正在拼装完整 .md (frontmatter + 速读 + 精读)...`);
  const md = buildCombinedNote(r, entry, deepDive);

  setStatus(`正在触发 GitHub Action (mode=combined, needs_figures=${needsFigures})...`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs: {
        mode: 'combined',
        md_content: md,
        arxiv_id: entry.arxivId,
        slug,
        message: `chore: speed-read + deep dive ${entry.arxivId} via web analyzer`,
        // combined 模式不读 deep_dive_md / used_model / truncated_pct,传空占位避免 yml required 校验
        deep_dive_md: '',
        used_model: '',
        truncated_pct: '100',
        needs_figures: needsFigures,
        figures_url: entry.pdfUrl || '',
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404) throw new Error(`Workflow 未找到: 检查 ${repo.owner}/${repo.repo} 是否存在,以及 ${repo.workflow} 是否在 .github/workflows/ 下`);
    if (res.status === 401) throw new Error(`GitHub Token 无效或没权限(检查 PAT 是否过期 + 是否有 repo scope)`);
    if (res.status === 403) throw new Error(`GitHub 拒绝触发(可能是 workflow 没启用,或 token 没 workflow 权限)`);
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }

  // dispatch 204 成功 ≠ workflow 成功:轮询 run 状态直到完成,把失败原因抛回 UI。
  // 否则 GitHub 那边 5 秒就挂,前端却停留在 "✓ 已触发,稍等部署",用户根本不知道。
  await pollWorkflowConclusion(repo, token);
}

// 轮询最近一次 workflow_dispatch run 的结论:
//   - queued / in_progress → 每 2s 拉一次,直到 completed(最多 ~50s)
//   - completed + success → 返回
//   - completed + failure → 找第一个 failed step,抛回错误信息 + run 链接
async function pollWorkflowConclusion(
  repo: { owner: string; repo: string; workflow: string },
  token: string,
): Promise<void> {
  setStatus('已触发,等待 workflow 完成...');
  const authHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  // 等 1.5s 给 GitHub 把 run 排上队,再开始拉列表
  await new Promise((r) => setTimeout(r, 1500));
  const listUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/workflows/${repo.workflow}/runs?per_page=1`;
  let runId = 0;
  for (let i = 0; i < 25; i++) {
    const res = await fetch(listUrl, { headers: authHeaders });
    if (!res.ok) throw new Error(`查询 workflow runs 失败: ${res.status}`);
    const data = await res.json();
    const run = data.workflow_runs?.[0];
    if (!run) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    runId = run.id;
    if (run.status === 'completed') break;
    setStatus(`workflow 运行中(${i + 1}/25)...`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!runId) throw new Error('workflow 未在 50 秒内排上队,稍后到 GitHub Actions 查看');

  const runRes = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}`,
    { headers: authHeaders },
  );
  if (!runRes.ok) throw new Error(`查询 run 状态失败: ${runRes.status}`);
  const runInfo = await runRes.json();
  if (runInfo.conclusion === 'success') {
    setStatus('workflow 已完成,稍等部署', 'info');
    return;
  }

  // 失败 — 抓 jobs 的 steps,定位第一个失败的 step 名
  const jobsRes = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/jobs`,
    { headers: authHeaders },
  );
  let failedStep = '';
  if (jobsRes.ok) {
    const jobsData = await jobsRes.json();
    for (const job of jobsData.jobs || []) {
      for (const step of job.steps || []) {
        if (step.conclusion === 'failure') {
          failedStep = step.name;
          break;
        }
      }
      if (failedStep) break;
    }
  }
  const url = `https://github.com/${repo.owner}/${repo.repo}/actions/runs/${runId}`;
  const tail = failedStep ? `(失败 step: ${failedStep})` : '';
  throw new Error(`workflow ${runInfo.conclusion || '失败'} ${tail} — 查看: ${url}`);
}

// 极简 markdown 渲染(只处理精读用得到的子集:标题、粗体、代码、列表、LaTeX、引用)
// 不引第三方库,避免精读功能引入额外依赖。
function renderDeepDiveMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (inList) {
      out.push(listType === 'ol' ? '</ol>' : '</ul>');
      inList = false;
      listType = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行
    if (!trimmed) {
      closeList();
      out.push('');
      continue;
    }

    // 图片 markdown: ![alt](src) —— 独立成行,渲染成 <img>。src/alt 均过 escapeHtml 防注入。
    const img = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
    if (img) {
      closeList();
      out.push(
        `<p class="analyzer-figure"><img src="${escapeHtml(img[2])}" alt="${escapeHtml(img[1])}" loading="lazy" decoding="async" class="analyzer-figure-img" /></p>`,
      );
      continue;
    }

    // 三级及以上标题
    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3) {
      closeList();
      out.push(`<h4>${inlineMd(h3[1])}</h4>`);
      continue;
    }
    const h2 = trimmed.match(/^##\s+(.+)$/);
    if (h2) {
      closeList();
      out.push(`<h3>${inlineMd(h2[1])}</h3>`);
      continue;
    }
    const h1 = trimmed.match(/^#\s+(.+)$/);
    if (h1) {
      closeList();
      out.push(`<h2>${inlineMd(h1[1])}</h2>`);
      continue;
    }

    // 引用
    if (trimmed.startsWith('> ')) {
      closeList();
      out.push(`<blockquote>${inlineMd(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    // 有序列表
    const ol = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (ol) {
      if (!inList || listType !== 'ol') {
        closeList();
        out.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      out.push(`<li>${inlineMd(ol[2])}</li>`);
      continue;
    }

    // 无序列表
    const ul = trimmed.match(/^[-*]\s+(.+)$/);
    if (ul) {
      if (!inList || listType !== 'ul') {
        closeList();
        out.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      out.push(`<li>${inlineMd(ul[1])}</li>`);
      continue;
    }

    // 普通段落
    closeList();
    out.push(`<p>${inlineMd(trimmed)}</p>`);
  }
  closeList();
  return out.join('\n');

  // 行内 markdown 渲染:粗体、代码、$LaTeX$
  function inlineMd(s: string): string {
    return escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // $...$ 行内 LaTeX(粗略保留原样,KaTeX 渲染留给未来扩展)
      .replace(/\$([^$]+)\$/g, '<code class="analyzer-latex">$$1$</code>');
  }
}

// ============================================================================
// 把 AnalysisResult + arxiv 元数据生成完整 .md 文件(对齐后台 docs 格式)
// ============================================================================
function slugifyTitle(title: string, arxivId: string): string {
  // arxivId 已经含版本号 + 短 hash,适合作为 slug 主干
  // 如果需要更"人类可读"的标题 slug,可以再附加 title 的 ascii 化短串
  const ascii = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  if (ascii) return ascii;
  // fallback:纯 ascii kebab-case,只保留 [a-z0-9],把 "." 和 "v" 都替换成 "-"
  // (yml 校验 ^[a-z0-9-]{1,80}$ 不允许 ".",而 arxivId 形如 2606.30015v1 含点和 v)
  return arxivId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'paper';
}

// frontmatter 字段集中处,glance 与 combined 共用。修一处字段,两边一起跟着走。
// 字段顺序与 docs/20260625-20260704/*.md 保持一致(参见 sample 2606.26474v1)。
function buildFrontmatter(r: AnalysisResult, entry: ArxivEntry | null, now: string): string[] {
  const arxivId = entry?.arxivId || '';
  const pdfUrl = entry?.pdfUrl || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : '');
  // tags 优先级:
  //   1) LLM 抽出的 topic_tags (来自 TOPIC_ALLOWLIST)  → "query:<tag>"
  //   2) 全部为空时 — fallback 到旧的 arxivId 年月前缀(原行为),保证不缺标签
  //  兜底数组保持去重 + 最多 6 个,与后端 extract_sidebar_tags 对齐。
  const tagsFromLLM = (r.topic_tags || []).map((t) => `query:${t.toLowerCase()}`);
  const tagSet = new Set<string>();
  for (const t of tagsFromLLM) tagSet.add(t);
  if (tagSet.size === 0) tagSet.add(`query:${arxivId.split('.')[0] || 'manual'}`);
  const tags = [...tagSet].slice(0, 6);
  // 标题/作者等含特殊字符(: , # 等)时统一加双引号,避免 YAML 解析失败。
  const yamlStr = (s: string): string => `"${(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
  return [
    '---',
    `title: ${yamlStr(r.title_en || r.title || '(untitled)')}`,
    r.authors ? `authors: ${yamlStr(r.authors)}` : null,
    arxivId ? `date: ${(entry?.published || now).slice(0, 10)}` : null,
    `generated_at: ${yamlStr(now)}`,
    pdfUrl ? `pdf: ${yamlStr(pdfUrl)}` : null,
    `tags: [${tags.map((t) => `"${t}"`).join(', ')}]`,
    `score: 7.0`,
    r.motivation ? `evidence: ${yamlStr(r.motivation.slice(0, 60))}` : null,
    r.tldr ? `tldr: ${yamlStr(r.tldr)}` : null,
    'source: arxiv',
    'selection_source: web_analyzer',
    r.motivation ? `motivation: ${yamlStr(r.motivation)}` : null,
    r.method ? `method: ${yamlStr(r.method)}` : null,
    r.result ? `result: ${yamlStr(r.result)}` : null,
    r.conclusion ? `conclusion: ${yamlStr(r.conclusion)}` : null,
    r.context ? `context: ${yamlStr(r.context)}` : null,
    '---',
  ].filter((l): l is string => l !== null);
}

// 速读正文块(TLDR / Abstract / 动机/方法/结果/结论/主题语境),与旧 buildMarkdownNote 行为一致。
function buildSpeedReadBody(r: AnalysisResult, entry: ArxivEntry | null): string {
  const bodyParts: string[] = [];
  if (r.tldr) bodyParts.push(`## TLDR\n${r.tldr}`);
  if (entry?.summary) bodyParts.push(`## Abstract\n${entry.summary}`);
  if (r.motivation) bodyParts.push(`## 动机\n${r.motivation}`);
  if (r.method) bodyParts.push(`## 方法\n${r.method}`);
  if (r.result) bodyParts.push(`## 结果\n${r.result}`);
  if (r.conclusion) bodyParts.push(`## 结论\n${r.conclusion}`);
  if (r.context) bodyParts.push(`## 主题语境\n${r.context}`);
  return bodyParts.length ? '\n' + bodyParts.join('\n\n') + '\n' : '';
}

// 精读元信息行(显示在 ## 深度精读 标题正下方,告诉读者这篇精读是哪个 model 生成的、
// 是否截断过 PDF)。跟 save-paper.yml:286-292 旧版的格式对齐,方便以后 backend
// 写出的 .md 和 web 写出的 .md 在文档结构上一致。
function buildDeepDiveBanner(d: DeepDiveResult): string {
  // truncated 时给个"前 N%"提示;N 是按 model context window 算出的可用字符占 PDF 总字符的比例
  // —— 跟 save-paper.yml 拼 deep_block 时的 truncate_note 公式保持一致。
  let truncateNote = '全文';
  if (d.truncated) {
    const availableChars = Math.min(800_000, d.contextTokens * 3 - 16_000 * 3);
    const pct = d.pdfChars > 0 ? Math.round((availableChars / d.pdfChars) * 100) : 0;
    truncateNote = `前 ${pct}%`;
  }
  const modelLine = d.usedModel ? ' · 模型: ' + d.usedModel : '';
  return `> 基于 PDF 全文生成${modelLine} · ${truncateNote}\n\n`;
}

function buildMarkdownNote(r: AnalysisResult, entry: ArxivEntry | null): string {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const fm = buildFrontmatter(r, entry, now);
  const body = buildSpeedReadBody(r, entry);
  return fm.join('\n') + '\n' + body + '\n';
}

// combined .md:frontmatter + 速读四段 + Abstract + 精读全文。
// 跟旧 "📤 save 速读" 路径对比:不依赖仓库里是否已有 .md,适合"我搜到就要精读"用户。
// 跟旧 "📥 save 精读" 路径对比:不再依赖"先点过 📤" — 一次完成。
function buildCombinedNote(r: AnalysisResult, entry: ArxivEntry, deepDive: DeepDiveResult): string {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const fm = buildFrontmatter(r, entry, now);
  const speedRead = buildSpeedReadBody(r, entry).trimEnd();
  // 精读章节用 `---` 分隔,跟旧 save-paper.yml 写入时的格式一致(append-deepdive 步骤里
  // 拼的是 '\n\n---\n\n## 深度精读\n\n' + banner + deep)。
  const banner = buildDeepDiveBanner(deepDive);
  const deepSection = `\n\n---\n\n## 深度精读\n\n${banner}${deepDive.markdown}\n`;
  return fm.join('\n') + '\n' + speedRead + deepSection;
}

async function saveToGitHub(r: AnalysisResult, entry: ArxivEntry | null): Promise<void> {
  const { loadGitHubToken, loadGitHubRepo } = await import('./settings');
  const token = loadGitHubToken();
  const repo = loadGitHubRepo();
  if (!token) {
    throw new Error('请先在 /settings/ 页面填 GitHub PAT(需要 repo 权限)');
  }
  if (!entry || !entry.arxivId) {
    throw new Error('当前结果没有 arxiv 元数据(只支持 arxiv 论文保存;PDF 上传暂不支持)');
  }
  const md = buildMarkdownNote(r, entry);
  const slug = slugifyTitle(r.title || r.title_en || entry.title, entry.arxivId);

  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/workflows/${repo.workflow}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs: {
        md_content: md,
        arxiv_id: entry.arxivId,
        slug,
        message: `chore: add ${entry.arxivId} from web analyzer`,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404) throw new Error(`Workflow 未找到: 检查 ${repo.owner}/${repo.repo} 是否存在,以及 ${repo.workflow} 是否在 .github/workflows/ 下`);
    if (res.status === 401) throw new Error(`GitHub Token 无效或没权限(检查 PAT 是否过期 + 是否有 repo scope)`);
    if (res.status === 403) throw new Error(`GitHub 拒绝触发(可能是 workflow 没启用,或 token 没 workflow 权限)`);
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  // 204 No Content — dispatch 成功。但 workflow 本身仍可能失败,所以继续轮询结论。
  await pollWorkflowConclusion(repo, token);
}

// ============================================================================
// 本地历史记录(📚 历史笔记 tab 用)
// 储存最近 50 篇在本机的 AnalysisResult;每次 callLLM 成功返回 → save 一条;
// 切到历史 tab 时 list 显示,点击 → 重新渲染(不需要再调 LLM)。
// 纯 localStorage,不上传,不进 Gist。如果用户拒绝再渲染或刷新页面,数据不丢。
// ============================================================================
const HISTORY_KEY = 'dpr_analyzer_history_v1';
const HISTORY_MAX_ENTRIES = 50;
const HISTORY_MAX_TLDR_CHARS = 80;

interface HistoryEntry {
  id: string;
  createdAt: number;
  arxivId: string;
  source: 'pdf' | 'arxiv';
  // 简化版 entry — 仅保存分析时所需的最小子集,避免 localStorage 存太多 / 序列化复杂对象。
  arxivTitle: string;
  arxivTitleZh?: string;
  arxivAuthors?: string;
  pdfUrl?: string;
  analysis: AnalysisResult;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && typeof e.id === 'string' && e.analysis && typeof e.analysis === 'object');
  } catch {
    return [];
  }
}

function saveHistory(list: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX_ENTRIES)));
  } catch {
    // localStorage 满了 — 静默吞掉,不阻断分析流程
  }
}

function recordHistory(entry: HistoryEntry): void {
  const list = loadHistory();
  // 同 arxivId 已有 → 移到最前(time updated),不重复条目。
  const filtered = list.filter((e) => e.arxivId !== entry.arxivId || e.source !== entry.source);
  filtered.unshift(entry);
  saveHistory(filtered);
}

function removeHistory(id: string): void {
  saveHistory(loadHistory().filter((e) => e.id !== id));
}

function clearAllHistory(): void {
  saveHistory([]);
}

function shortTldr(s: string): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > HISTORY_MAX_TLDR_CHARS ? t.slice(0, HISTORY_MAX_TLDR_CHARS) + '…' : t;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function newId(): string {
  return 'h' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ============================================================================
// 结果渲染
// ============================================================================
// 注:历史笔记重新加载由调用方负责 — 这里只画 result DOM,不读写 history;
// 防止「打开历史」也生成一份新 history 条目这种递归 bug。
function renderResult(r: AnalysisResult, rawText: string): void {
  const box = $('results');
  box.hidden = false;

  const fullTextEn = r.title_en ? `<p class="analyzer-card-en">${escapeHtml(r.title_en)}</p>` : '';
  const authors = r.authors ? `<div class="analyzer-card-en" style="font-style:normal">👥 ${escapeHtml(r.authors)}</div>` : '';

  const noteHtml = (label: string, content: string): string => content
    ? `<div class="analyzer-note"><div class="analyzer-note-label">${label}</div><p>${escapeHtml(content).replace(/\n/g, '<br>')}</p></div>`
    : '';

  box.innerHTML = `
    <div class="analyzer-results-header">
      <h2>📋 分析结果</h2>
      <div class="analyzer-results-actions">
        <button type="button" id="copy-md">复制 Markdown</button>
        <button type="button" id="download-json">下载 JSON</button>
        <button type="button" id="deepdive-btn" class="analyzer-action-deepdive" title="基于 PDF 全文生成中文长文精读">📖 生成长文精读</button>
        <button type="button" id="save-deepdive-github" class="analyzer-action-deepdive" disabled title="先生成长文精读,再点此按钮一次性写入完整 .md(速读+精读)+ 抽图,不需要先点 📤">📥 一键保存(速读+精读)到 GitHub</button>
        <button type="button" id="save-github" class="analyzer-action-primary">📤 保存到 GitHub</button>
      </div>
    </div>

    <div id="deepdive-status" class="analyzer-deepdive-status" hidden></div>
    <div id="deepdive-output" class="analyzer-deepdive-output" hidden></div>

    <div class="analyzer-card">
      <div class="analyzer-card-label">论文标题</div>
      <h3 class="analyzer-card-title">${escapeHtml(r.title)}</h3>
      ${fullTextEn}
      ${authors}
    </div>

    ${r.tldr ? `
    <div class="analyzer-card analyzer-tldr">
      <div class="analyzer-card-label">TL;DR</div>
      <p class="analyzer-card-body">${escapeHtml(r.tldr)}</p>
    </div>
    ` : ''}

    ${r.motivation ? `
    <div class="analyzer-card">
      <div class="analyzer-card-label">研究背景 / 动机</div>
      <p class="analyzer-card-body">${escapeHtml(r.motivation).replace(/\n/g, '<br>')}</p>
    </div>
    ` : ''}

    <div class="analyzer-card">
      <div class="analyzer-card-label">四段笔记</div>
      <div class="analyzer-notes">
        ${noteHtml('动机', r.motivation)}
        ${noteHtml('方法', r.method)}
        ${noteHtml('结果', r.result)}
        ${noteHtml('结论', r.conclusion)}
      </div>
    </div>

    ${r.context ? `
    <div class="analyzer-card analyzer-context">
      <div class="analyzer-card-label">主题语境</div>
      <p class="analyzer-card-body">${escapeHtml(r.context).replace(/\n/g, '<br>')}</p>
    </div>
    ` : ''}

    <details class="analyzer-raw">
      <summary>查看抽出的原文片段</summary>
      <pre>${escapeHtml(rawText.slice(0, 5000))}${rawText.length > 5000 ? '\n\n[... 共 ' + rawText.length + ' 字符,已截断显示 ...]' : ''}</pre>
    </details>
  `;

  // 绑定导出
  $('copy-md')?.addEventListener('click', () => copyAsMarkdown(r));
  $('download-json')?.addEventListener('click', () => downloadJson(r));

  // 精读按钮:仅 arxiv 论文可用,需要 PDF URL
  const deepdiveBtn = $<HTMLButtonElement>('deepdive-btn');
  const deepdiveStatus = $('deepdive-status');
  const deepdiveOutput = $('deepdive-output');
  if (deepdiveBtn) {
    if (!currentArxivEntry?.pdfUrl) {
      deepdiveBtn.disabled = true;
      deepdiveBtn.title = '仅 arxiv 论文支持长文精读(PDF 上传暂不支持)';
    } else {
      const cfg = loadSettings();
      const ctx = estimateContext(cfg.model || '');
      if (ctx < 16_000) {
        deepdiveBtn.disabled = true;
        deepdiveBtn.title = `当前 model (${cfg.model}) context 仅 ${ctx} tokens,装不下 PDF 精读,请切换更大的模型`;
      }
      deepdiveBtn.addEventListener('click', async () => {
        if (!currentArxivEntry) return;
        deepdiveBtn.disabled = true;
        const oldText = deepdiveBtn.textContent;
        deepdiveBtn.textContent = '⏳ 精读中...';
        deepdiveStatus.hidden = false;
        deepdiveStatus.textContent = '准备中...';
        deepdiveStatus.className = 'analyzer-deepdive-status';
        deepdiveOutput.hidden = true;
        deepdiveOutput.innerHTML = '';
        const setLocalStatus = (msg: string) => {
          deepdiveStatus.textContent = msg;
        };
        // 默认假设没图,LLM 走纯文字描述路径;若 docs/ 已有图,主动喂 figureBase 让 LLM 插图。
        // figureBase 用 raw.githubusercontent 绝对 URL,部署在 GH Pages (`base=/daily-paper-reader`)
        // 也能渲染,不依赖站点 base 路径。
        const figAssetKey = currentArxivEntry.arxivId;
        const repo = loadGitHubRepo();
        const absBase = repo?.owner
          ? `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/main/docs/assets/figures/arxiv/${figAssetKey}`
          : '';
        let figureCount = 0;
        try {
          figureCount = await probeExistingFigures(figAssetKey);
        } catch {
          figureCount = 0;
        }
        const figureBase = (figureCount > 0 && absBase) ? absBase : '';
        try {
          const result = await runDeepDive(r, currentArxivEntry, cfg, setLocalStatus, {
            figureBase: figureCount > 0 ? figureBase : '',
            figureCount,
          });
          currentDeepDive = result;
          deepdiveOutput.hidden = false;
          const meta = [
            `📊 PDF 字符数 ${result.pdfChars.toLocaleString()}`,
            `≈ ${result.pdfTokensEstimate.toLocaleString()} tokens`,
            `model context ${result.contextTokens.toLocaleString()}`,
            result.truncated ? '⚠️ 已截断' : '✅ 全文',
            figureCount > 0 ? `🖼 docs/ 已有 ${figureCount}+ 张图` : '🖼 尚未抽图(保存时会抽)',
          ].join(' · ');
          deepdiveStatus.className = 'analyzer-deepdive-status ok';
          deepdiveStatus.textContent = meta;
          // 用 details 折叠,长文精读不会撑爆视口
          deepdiveOutput.innerHTML = `<details class="analyzer-deepdive-details" open><summary>📖 深度精读(基于 PDF 全文)</summary><div class="analyzer-deepdive-md">${renderDeepDiveMarkdown(result.markdown)}</div></details>`;
          // 精读生成成功后,启用"保存精读"按钮
          const saveDeepDiveBtn = $<HTMLButtonElement>('save-deepdive-github');
          if (saveDeepDiveBtn) saveDeepDiveBtn.disabled = false;
        } catch (e) {
          deepdiveStatus.className = 'analyzer-deepdive-status err';
          deepdiveStatus.textContent = '✗ 精读失败: ' + (e as Error).message;
        } finally {
          deepdiveBtn.disabled = false;
          deepdiveBtn.textContent = oldText;
        }
      });
    }
  }

  // "📥 一键保存(速读+精读)到 GitHub" 按钮(精读生成成功后可用)
  const saveDeepDiveBtn = $<HTMLButtonElement>('save-deepdive-github');
  if (saveDeepDiveBtn) {
    if (!currentArxivEntry?.arxivId) {
      saveDeepDiveBtn.disabled = true;
      saveDeepDiveBtn.title = '需要先选择一篇 arXiv 论文并生成精读';
    } else {
      saveDeepDiveBtn.disabled = !currentDeepDive;
      saveDeepDiveBtn.addEventListener('click', async () => {
        if (!currentArxivEntry || !currentDeepDive) return;
        saveDeepDiveBtn.disabled = true;
        const oldText = saveDeepDiveBtn.textContent;
        saveDeepDiveBtn.textContent = '⏳ 保存中...';
        try {
          await saveDeepDiveToGitHub(r, currentArxivEntry, currentDeepDive);
          saveDeepDiveBtn.textContent = '✓ 已触发,稍等部署';
          setStatus('已触发 save-paper workflow (combined),几秒后刷新 docs 页面查看', 'info');

          // 工作流完成后,GitHub 还要 ~2-10s 把 commit 推上 main。重探一次 fig-001.webp:
          // 若图已就位且本次精读是"无图文字版",自动二次调用 runDeepDive 重新渲染。
          const arxivKey = currentArxivEntry.arxivId;
          const hadFiguresInFirstPass = !!(currentDeepDive.figureBase && currentDeepDive.figureCount > 0);
          if (!hadFiguresInFirstPass) {
            const retryProbe = async (): Promise<number> => {
              try { return await probeExistingFigures(arxivKey); } catch { return 0; }
            };
            let figsAfter = await retryProbe();
            if (!figsAfter) {
              await new Promise((r) => setTimeout(r, 2000));
              figsAfter = await retryProbe();
            }
            if (figsAfter > 0) {
              setStatus('📥 已保存,正在重渲染精读(含图)...', 'info');
              const cfg2 = loadSettings();
              const repo2 = loadGitHubRepo();
              const absBase2 = repo2?.owner
                ? `https://raw.githubusercontent.com/${repo2.owner}/${repo2.repo}/main/docs/assets/figures/arxiv/${arxivKey}`
                : '';
              const localStatus = (msg: string) => {
                const s = $('deepdive-status');
                if (s) {
                  s.hidden = false;
                  s.textContent = msg;
                }
              };
              if (absBase2) {
                try {
                  const rebuilt = await runDeepDive(r, currentArxivEntry!, cfg2, localStatus, {
                    figureBase: absBase2,
                    figureCount: figsAfter,
                  });
                  currentDeepDive = rebuilt;
                  const deepdiveOutput2 = $('deepdive-output');
                  if (deepdiveOutput2) {
                    deepdiveOutput2.hidden = false;
                    deepdiveOutput2.innerHTML = `<details class="analyzer-deepdive-details" open><summary>📖 深度精读(基于 PDF 全文)</summary><div class="analyzer-deepdive-md">${renderDeepDiveMarkdown(rebuilt.markdown)}</div></details>`;
                  }
                  setStatus('✓ 已重新渲染含图精读', 'info');
                } catch (e) {
                  setStatus(`重渲染精读失败,可手动再点一次长文精读: ${(e as Error).message}`, 'error');
                }
              }
            } else {
              setStatus('workflow 已完成但图尚未落 main,可几秒后再点"长文精读"刷新', 'info');
            }
          }
        } catch (e) {
          saveDeepDiveBtn.textContent = oldText;
          saveDeepDiveBtn.disabled = false;
          setStatus(`保存精读到 GitHub 失败: ${(e as Error).message}`, 'error');
        }
      });
    }
  }

  const saveBtn = $<HTMLButtonElement>('save-github');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      const oldText = saveBtn.textContent;
      saveBtn.textContent = '⏳ 正在保存...';
      try {
        await saveToGitHub(r, currentArxivEntry);
        saveBtn.textContent = '✓ 已触发 GitHub Action,稍等部署';
        setStatus('已触发 save-paper workflow,几秒后刷新 https://github.com/Canyon-netizen/daily-paper-reader 查看', 'info');
      } catch (e) {
        saveBtn.textContent = oldText;
        saveBtn.disabled = false;
        setStatus(`保存到 GitHub 失败: ${(e as Error).message}`, 'error');
      }
    });
  }

  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function copyAsMarkdown(r: AnalysisResult): void {
  const md = [
    `# ${r.title}`,
    r.title_en ? `\n> ${r.title_en}` : '',
    r.authors ? `\n**作者**: ${r.authors}` : '',
    r.tldr ? `\n## TLDR\n${r.tldr}` : '',
    `\n## 动机\n${r.motivation}`,
    `\n## 方法\n${r.method}`,
    `\n## 结果\n${r.result}`,
    `\n## 结论\n${r.conclusion}`,
    r.context ? `\n## 主题语境\n${r.context}` : '',
    '',
  ].filter((s) => s !== '').join('\n');
  navigator.clipboard.writeText(md).then(
    () => setStatus('已复制 Markdown 到剪贴板', 'info'),
    () => setStatus('复制失败,请手动选择', 'error'),
  );
}

function downloadJson(r: AnalysisResult): void {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `paper-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// 主流程
// ============================================================================
async function runAnalysis(): Promise<void> {
  const cfg = loadSettings();
  if (!cfg.apiKey) {
    setStatus('请先在 /settings/ 里填 API Key', 'error');
    return;
  }
  if (!cfg.baseUrl || !cfg.model) {
    setStatus('请在 /settings/ 里补全 Base URL 与 Model', 'error');
    return;
  }

  ($<HTMLButtonElement>('run-btn')).disabled = true;
  ($('results') as HTMLElement).hidden = true;

  try {
    let text: string;
    if (currentPdfText) {
      text = currentPdfText;
    } else if (currentArxivEntry) {
      const buf = await fetchArxivPdf(currentArxivEntry.pdfUrl);
      const pdfjsLib = await ensurePdfJs();
      setStatus('解析 arXiv PDF...');
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      try {
        let acc = '';
        const maxPages = Math.min(doc.numPages, 25);
        for (let i = 1; i <= maxPages; i++) {
          setStatus(`解析 arXiv PDF 第 ${i}/${maxPages} 页...`);
          try {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            acc += content.items.map((it: any) => ('str' in it ? it.str : '')).filter(Boolean).join(' ') + '\n\n';
          } catch (e) {
            // 同 extractPdfTextFromBuffer 的防御:页对象损坏时停止,已抽文本够用
            const msg = (e as Error)?.message || String(e);
            setStatus(`第 ${i} 页解析失败 (${msg.slice(0, 60)}),继续使用已抽到的 ${acc.length.toLocaleString()} 字符`);
            break;
          }
          if (acc.length > MAX_TEXT_CHARS) break;
        }
        text = acc.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS) + '\n\n[... 截断 ...]';
      } finally {
        doc.destroy().catch(() => {});
      }
    } else {
      setStatus('请先上传 PDF 或选择一篇 arXiv 论文', 'error');
      return;
    }

    if (text.length < 200) {
      throw new Error(`抽取出的正文太短 (${text.length} 字符),可能是扫描版 PDF / 加密文档,或者 arXiv 上根本没有这篇论文`);
    }

    const result = await callLLM(currentArxivEntry?.title || '', currentArxivEntry?.summary || '', text, cfg);
    // 每次新分析写一份到 localStorage 历史,后续刷新页面/切到 📚 tab 还能看。
    // 上传 PDF 时没有 arxivId — 用 'pdf:<sha-like>' 作 id 是没必要的,直接用时间戳即可。
    recordHistory({
      id: newId(),
      createdAt: Date.now(),
      arxivId: currentArxivEntry?.arxivId || `manual-${Date.now()}`,
      source: currentArxivEntry ? 'arxiv' : 'pdf',
      arxivTitle: currentArxivEntry?.title || '(手动上传 PDF)',
      arxivTitleZh: result.title,
      arxivAuthors: currentArxivEntry?.authors?.join(', '),
      pdfUrl: currentArxivEntry?.pdfUrl,
      analysis: result,
    });
    renderResult(result, text);
    clearStatus();
  } catch (e) {
    const msg = (e as Error).message || String(e);
    // pdf.js 解析失败时 message 通常是 "Invalid PDF structure" 或 "Load failed"
    // 这时底层其实是 arXiv 返回了 404 HTML 而不是真正的 PDF
    if (/load failed|invalid pdf|missing pdf/i.test(msg)) {
      setStatus(
        `PDF 解析失败: ${msg}。可能 arXiv 上找不到这篇论文(返回了 404 HTML 而不是 PDF),或 PDF 已加密/损坏。`,
        'error',
      );
    } else {
      setStatus(msg, 'error');
    }
  } finally {
    updateRunButton();
  }
}

// ============================================================================
// Init
// ============================================================================
function initAnalyzer(): void {
  // Guard: 这个脚本被多个页面共享 import(/paper-analyzer、/settings、/topic 等),
  // 没有 drop-zone 元素说明不在 analyzer 页面,直接跳过整个 init 流程,避免
  // 误抛 #xxx not found 阻断调用方(/topic 页面)的 init。
  if (!document.getElementById('drop-zone')) return;
  // 1. 设置 — 这些 UI 现在统一在 /settings/ 页面维护。
  //    paper-analyzer.astro 不再渲染设置区块,所以这里要 guarded skip。
  //    /settings/ 页面通过自己的 settings-page.ts 处理相同逻辑。
  const hasSettingsUI = !!document.getElementById('cfg-provider');
  if (hasSettingsUI) {
    const savedProvider = loadProvider();
    const savedCfg = loadSettings();
    // 检测当前 baseUrl 是否匹配某个预设(优先用 URL 匹配,而不是直接信任保存值)
    const detectedProvider = savedProvider === 'custom'
      ? 'custom'
      : (PROVIDER_PRESETS[savedProvider] && savedCfg.baseUrl.startsWith(PROVIDER_PRESETS[savedProvider].baseUrl)
          ? savedProvider
          : detectProviderFromSettings(savedCfg));
    ($<HTMLSelectElement>('cfg-provider')).value = detectedProvider;
    writeSettingsToUI(savedCfg);
    applyProviderPresetDatalistOnly(detectedProvider);

    $('cfg-provider').addEventListener('change', (e) => {
      const p = (e.target as HTMLSelectElement).value;
      saveProvider(p);
      applyProviderPreset(p);
      saveSettings(readSettingsFromUI());
      flashSavedHint();
      updateRunButton();
      const preset = PROVIDER_PRESETS[p];
      if (preset) {
        setModelStatus(`✓ 已切换到 ${preset.label},默认 model: ${preset.defaultModel}`, 'ok');
      }
    });

    const debouncedSave = debounce(() => {
      saveSettings(readSettingsFromUI());
      flashSavedHint();
      updateRunButton();
    }, 400);
    ['cfg-key', 'cfg-base'].forEach((id) => {
      $(id).addEventListener('input', debouncedSave);
    });

    const corsInput = $<HTMLInputElement>('cfg-cors');
    try { corsInput.value = getCustomProxy(); } catch { /* ignore */ }
    const debouncedCorsSave = debounce(() => {
      setCustomProxy(corsInput.value.trim());
      flashSavedHint();
    }, 400);
    corsInput.addEventListener('input', debouncedCorsSave);
  } // end if (hasSettingsUI)

  // 2. 模式 tab
  initModeTabs();
  // 预渲染历史 tab 列表 — 让切到 📚 时不白屏一下
  // (再次切回时 initModeTabs 也会再 renderHistoryPanel,避免 stale)
  try { renderHistoryPanel(); } catch { /* history helpers may be off on first load */ }

  // 3. PDF 上传
  const drop = $('drop-zone');
  const dropBtn = $<HTMLButtonElement>('drop-btn');
  const input = $<HTMLInputElement>('pdf-input');
  const trigger = (): void => input.click();
  // 整个 drop 区点击触发(键盘 Enter/Space 也触发)
  drop.addEventListener('click', trigger);
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); }
  });
  // "选择 PDF 文件" 按钮点击(防止冒泡触发两次)
  dropBtn.addEventListener('click', (e) => { e.stopPropagation(); trigger(); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
    const file = e.dataTransfer?.files?.[0];
    if (file) await handlePdfFile(file);
  });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) await handlePdfFile(file);
  });

  async function handlePdfFile(file: File): Promise<void> {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setStatus('只支持 PDF 文件', 'error');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setStatus(`文件过大 (${(file.size / 1024 / 1024).toFixed(1)} MB),建议 ≤ 30 MB`, 'error');
      return;
    }
    clearStatus();
    try {
      const text = await extractPdfText(file);
      currentPdfText = text;
      currentPdfMeta = { name: file.name, size: file.size };
      showFileBar(file.name, file.size);
      updateRunButton();
      setStatus(`已抽取 ${text.length.toLocaleString()} 字符,可以开始分析`, 'info');
      setTimeout(clearStatus, 2500);
    } catch (e) {
      setStatus(`PDF 解析失败: ${(e as Error).message}`, 'error');
    }
  }

  $('file-clear').addEventListener('click', () => {
    clearFileBar();
    clearStatus();
  });

  // 4. arXiv 搜索
  const arxivInput = $<HTMLInputElement>('arxiv-input');
  const arxivBtn = $<HTMLButtonElement>('arxiv-search-btn');
  async function doArxivSearch(): Promise<void> {
    const q = arxivInput.value.trim();
    if (!q) { setStatus('请输入论文标题或 arXiv ID', 'error'); return; }
    arxivBtn.disabled = true;
    try {
      let entries: ArxivEntry[];
      // arXiv ID 直接输入 → 用 id_list 查询 arXiv 验证存在并拿真实元数据
      if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(q)) {
        setStatus(`在 arXiv 验证 ID ${q}...`);
        entries = await searchArxivById(q);
      } else {
        setStatus(`在 arXiv 搜索 "${q}"...`);
        entries = await searchArxiv(q);
      }
      clearStatus();
      currentArxivEntry = null;
      updateRunButton();
      renderArxivResults(entries);
    } catch (e) {
      const err = e as Error;
      console.error('[doArxivSearch] caught:', err);
      setStatus(`搜索失败: ${err.message}\n栈: ${err.stack || '(no stack)'}`, 'error');
    } finally {
      arxivBtn.disabled = false;
    }
  }
  arxivBtn.addEventListener('click', doArxivSearch);
  arxivInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doArxivSearch(); });

  // 5. 主流程
  $('run-btn').addEventListener('click', runAnalysis);
  $('reset-btn').addEventListener('click', () => {
    clearFileBar();
    currentArxivEntry = null;
    $$('.analyzer-arxiv-item').forEach((x) => x.classList.remove('selected'));
    ($<HTMLInputElement>('arxiv-input')).value = '';
    ($('arxiv-results') as HTMLElement).hidden = true;
    ($('results') as HTMLElement).hidden = true;
    clearStatus();
    updateRunButton();
  });

  // 6. 同步配置到 Gist / 主题列表 / 模型测试 — 这些 UI 现在只在 /settings/ 页面
  if (hasSettingsUI) {
  const gistTokenInput = $<HTMLInputElement>('cfg-gist-token');
  const gistIdInput = $<HTMLInputElement>('cfg-gist-id');
  try { gistTokenInput.value = getGistToken(); } catch { /* ignore */ }
  try { gistIdInput.value = getGistId(); } catch { /* ignore */ }

  // token / id 也用 input + debounce 持久化(不要每次都重新填)
  const debouncedGistFieldSave = debounce(() => {
    setGistToken(gistTokenInput.value.trim());
    setGistId(gistIdInput.value.trim());
    flashSavedHint();
  }, 400);
  gistTokenInput.addEventListener('input', debouncedGistFieldSave);
  gistIdInput.addEventListener('input', debouncedGistFieldSave);

  $('gist-sync-btn').addEventListener('click', syncToGist);

  // 7. 主题配置 textarea
  const topicsArea = $<HTMLTextAreaElement>('cfg-topics');
  const topicsStatus = $('topics-status');
  const topicsResetBtn = $<HTMLButtonElement>('topics-reset-btn');
  const topicsSyncBtn = $<HTMLButtonElement>('topics-sync-btn');

  function refreshTopicsStatus(): void {
    const entries = parseTopicsText(topicsArea.value);
    topicsStatus.classList.remove('warn', 'ok');
    if (entries.length === 0) {
      topicsStatus.textContent = '当前列表为空 — 后台将走 config.yaml 默认主题';
      topicsStatus.classList.add('warn');
    } else {
      topicsStatus.textContent = `已加载 ${entries.length} 个主题${entries.length === parseTopicsText(DEFAULT_TOPICS_TEXT).length ? '(默认)' : ''}`;
    }
  }

  try { topicsArea.value = getTopicsText(); } catch { topicsArea.value = DEFAULT_TOPICS_TEXT; }
  refreshTopicsStatus();

  const debouncedTopicsSave = debounce(() => {
    setTopicsText(topicsArea.value);
    refreshTopicsStatus();
    flashSavedHint();
  }, 400);
  topicsArea.addEventListener('input', () => {
    refreshTopicsStatus();
    debouncedTopicsSave();
  });
  topicsResetBtn.addEventListener('click', () => {
    setTopicsText(DEFAULT_TOPICS_TEXT);
    topicsArea.value = DEFAULT_TOPICS_TEXT;
    refreshTopicsStatus();
    flashSavedHint();
  });
  topicsSyncBtn.addEventListener('click', () => syncToGist());

  // 8. 模型连接测试 + 刷新模型列表 + 模式切换
  $('test-connection-btn').addEventListener('click', testConnection);
  $('refresh-models-btn').addEventListener('click', refreshModelList);
  $('cfg-model-edit-btn').addEventListener('click', () => {
    setModelMode(!isModelManual());
  });
  const modelInput = $<HTMLInputElement>('cfg-model-input');
  const debouncedModelInputSave = debounce(() => {
    saveSettings(readSettingsFromUI());
    flashSavedHint();
    updateRunButton();
  }, 400);
  modelInput.addEventListener('input', debouncedModelInputSave);
  $<HTMLSelectElement>('cfg-model').addEventListener('change', () => {
    saveSettings(readSettingsFromUI());
    flashSavedHint();
  });
  } // end if (hasSettingsUI)

  updateRunButton();

  // 异步加载 arxiv-index.json,加载完若已有搜索结果则重渲染,补上命中徽章。
  void loadArxivIndex().then(() => {
    if (lastRenderedEntries) renderArxivResults(lastRenderedEntries);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    try { initAnalyzer(); } catch (e) { console.warn('[paper-analyzer] init failed:', e); }
  });
} else {
  try { initAnalyzer(); } catch (e) { console.warn('[paper-analyzer] init failed:', e); }
}
