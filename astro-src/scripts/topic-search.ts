// /topic 页面客户端逻辑
//
// 5 阶段状态机:输入 → 拆解 → 搜索 → 总结 → 追问。
// 每个阶段都允许回退/重新触发,localStorage 持久化整个会话。
//
// 复用:
//   - LLM: settings.ts 的 OpenAI 兼容端点(loadSettings / loadProvider)
//   - arXiv 抓取 + 解析: paper-analyzer.ts 的 fetchWithDiagnosis / searchArxiv / parseArxivEntry / fetchArxivPdf
//   - 单篇总结 prompt: paper-analyzer.ts 的 SYSTEM_PROMPT(已 export)
//   - 总结入口 callLLM: paper-analyzer.ts 的 callLLM(已 export,接受可选 statusCb)

import {
  loadSettings,
  getCustomProxy,
} from './settings';
import {
  searchArxiv,
  fetchArxivPdf,
  extractBalancedJson,
  callLLM,
} from './paper-analyzer';
import type { ArxivEntry, AnalysisResult } from './paper-analyzer';

// ============================================================================
// 类型 + 常量
// ============================================================================

interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface SubQ {
  id: string;
  label: string;
  query: string;
  reason: string;
  selected: boolean;
}

interface Candidate {
  arxivId: string;
  entry: ArxivEntry;
  selected: boolean;
}

interface Summary {
  arxivId: string;
  subqId: string;
  summary: AnalysisResult;
  generatedAt: number;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

interface TopicSession {
  id: string;
  topic: string;
  createdAt: number;
  updatedAt: number;
  subqs: SubQ[];
  candidatesBySubq: Record<string, Candidate[]>;
  summaries: Summary[];
  chats: Record<string, ChatMsg[]>; // 按 arxivId 分组
}

interface SessionStore {
  version: number;
  currentId: string | null;
  sessions: Record<string, TopicSession>;
}

const SESSION_KEY = 'dpr_topic_session_v1';
const SCHEMA_VERSION = 1;
// 并发上限:避免 LLM 429。沿用 plan 决策 N=2。
const SUMMARIZE_CONCURRENCY = 2;
// 追问历史单篇上限(避免撑爆 context)
const MAX_QA_PER_PAPER = 50;
// 喂 LLM 的最近条数
const MAX_QA_FOR_LLM = 30;
// 总 sessions 字节上限(留 ~1MB 给别的 key)
const TOTAL_BYTES_LIMIT = 4 * 1024 * 1024;
// 单会话字节上限
const PER_SESSION_BYTES_LIMIT = 800 * 1024;

// ============================================================================
// Prompt 模板
// ============================================================================

const DECOMPOSE_SYSTEM = `你是研究思路拆解助手。用户给出一段研究思路(中英文均可),
请把它拆解成 2-5 个可独立检索的子方向,每个子方向对应一个 arXiv 检索 query。

【输出格式 — 必须严格遵守】
- 只输出一个 JSON 数组,不要任何其它文字、markdown 围栏、思考块
- 不要写 <think> 思考块,不要写解释
- 第一行必须是 [ ,最后一行必须是 ]
- 每个元素字段:
  - label: 子方向中文短标题(8-20 字)
  - query: arXiv 检索关键词,**必须是英文单词,2-3 个独立的 arXiv 关键词,空格分隔**,
          例如 ["episodic memory", "long-term agent"],不要写完整短语或句子
  - reason: 一句话中文说明为什么这个子方向值得检索

【检索纪律 - 非常重要】
- query 必须是纯英文单词组合,**绝对不要在 query 里出现中文字符**;
  即使用户输入的是中文思路,query 也要全部用英文专业术语
- query 用 2-3 个独立的英文关键词(arXiv 习惯用 all: 全文匹配,独立关键词召回更高);
  写成完整短语(超过 3 词) 在 arXiv 上几乎 0 召回 — 拆短、拆开
- 子方向之间要尽量不重叠,覆盖思路的不同侧面(方法/应用/评测/理论)
- 数量 2-5 个都可以;思路很短时 2 个也行,不要为了凑数而编造不相关的方向

【示例输出】
[
  {"label":"情节记忆与长期记忆","query":"episodic memory long-term","reason":"对应思路中关于智能体跨会话记忆的核心方法"},
  {"label":"游戏智能体记忆基准","query":"game agent memory benchmark","reason":"对应评测层面,检索游戏场景下记忆模块的基准与对比"}
]`;

export function normalizeQuery(q: string): string {
  // 兜底:即使 LLM 不守规矩返回了中文 / 长短语,也尽量清洗成 arXiv 友好的英文关键词。
  // 1. 去中文字符
  let s = (q ?? '').replace(/[一-鿿]+/g, ' ').trim();
  if (!s) return '';
  // 2. 只保留字母 / 数字 / 空格 / 连字符 / 下划线;其余(逗号、句号、引号等)当分隔符
  s = s.replace(/[^A-Za-z0-9\s\-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // 3. 截到前 6 个 token(arXiv all: 全文模式允许多词组合,6 个覆盖"5-6 个关键词"的需求;
  //    再多 arXiv 会召回过低且容易命中噪声论文)
  const toks = s.split(' ').filter(Boolean);
  if (toks.length > 6) s = toks.slice(0, 6).join(' ');
  return s;
}

const PAPER_CHAT_SYSTEM = `你是论文问答助手。用户已经看过一篇论文的速览笔记,你需要基于这篇论文的
abstract 和已有的速览内容,回答用户的追问。

【纪律 — 必须严格遵守】
- 只能基于提供的 abstract + 速览内容回答,信息不足时明确说"原文 abstract / 速览中未涉及此细节,无法确认"
- 不要编造公式、数字、作者观点
- 中文回答,术语首次出现给中英对照
- 答案控制在 200 字以内,除非用户明确要求展开`;

// ============================================================================
// 工具函数
// ============================================================================

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function canonicalId(arxivId: string): string {
  return arxivId.replace(/v\d+$/i, '');
}

// 简单的 worker-pool 并发(限制同时在飞的 Promise 数)。
// items: 任务列表;limit: 并发上限;fn: 单个任务。
// onProgress(done) 在每个任务完成(成功或失败)后回调一次。
async function runConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: Array<{ item: T; result: R }>; err: Array<{ item: T; error: Error }> }> {
  const results: Array<{ item: T; result: R } | null> = new Array(items.length).fill(null);
  const errors: Array<{ item: T; error: Error } | null> = new Array(items.length).fill(null);
  let cursor = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        results[idx] = { item: items[idx], result: await fn(items[idx], idx) };
      } catch (e) {
        errors[idx] = { item: items[idx], error: e as Error };
      } finally {
        done++;
        onProgress?.(done, items.length);
      }
    }
  }

  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return {
    ok: results.filter((r): r is { item: T; result: R } => r !== null),
    err: errors.filter((r): r is { item: T; error: Error } => r !== null),
  };
}

// ============================================================================
// localStorage 会话存储
// ============================================================================

function emptyStore(): SessionStore {
  return { version: SCHEMA_VERSION, currentId: null, sessions: {} };
}

function loadStore(): SessionStore {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as SessionStore;
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions) return emptyStore();
    // 版本迁移占位:目前只有 v1
    return { version: SCHEMA_VERSION, currentId: parsed.currentId ?? null, sessions: parsed.sessions ?? {} };
  } catch {
    return emptyStore();
  }
}

function saveStore(store: SessionStore): void {
  // 估算大小,超限就裁剪
  let payload = JSON.stringify(store);
  if (payload.length > TOTAL_BYTES_LIMIT) {
    // 按 updatedAt 升序裁掉旧 session,直到达标
    const ids = Object.values(store.sessions).sort((a, b) => a.updatedAt - b.updatedAt).map((s) => s.id);
    for (const id of ids) {
      if (payload.length <= TOTAL_BYTES_LIMIT * 0.9) break;
      // 不删当前 session
      if (id === store.currentId) continue;
      delete store.sessions[id];
      payload = JSON.stringify(store);
    }
  }
  try {
    localStorage.setItem(SESSION_KEY, payload);
  } catch (e) {
    // 配额满 — 极端兜底,清空
    console.warn('[topic] localStorage 写入失败,清空旧 sessions:', (e as Error).message);
    try {
      const keep = store.currentId ? store.sessions[store.currentId] : null;
      const fresh = emptyStore();
      if (keep) {
        fresh.currentId = keep.id;
        fresh.sessions[keep.id] = trimSessionToLimit(keep);
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(fresh));
    } catch {
      /* ignore */
    }
  }
}

function trimSessionToLimit(s: TopicSession): TopicSession {
  // 单会话超限 → 截断每个 paper 的 qa
  let copy: TopicSession = JSON.parse(JSON.stringify(s));
  for (const k of Object.keys(copy.chats)) {
    if (copy.chats[k].length > MAX_QA_PER_PAPER) {
      copy.chats[k] = copy.chats[k].slice(-MAX_QA_PER_PAPER);
    }
  }
  let ser = JSON.stringify(copy);
  if (ser.length <= PER_SESSION_BYTES_LIMIT) return copy;
  // 还不够 → 继续截断最早 qa
  for (let i = 0; i < 3 && ser.length > PER_SESSION_BYTES_LIMIT; i++) {
    for (const k of Object.keys(copy.chats)) {
      if (copy.chats[k].length > 8) {
        copy.chats[k] = copy.chats[k].slice(-Math.max(4, Math.floor(copy.chats[k].length / 2)));
      }
    }
    ser = JSON.stringify(copy);
  }
  return copy;
}

const persistSession = debounce((s: TopicSession) => {
  s.updatedAt = Date.now();
  const store = loadStore();
  store.sessions[s.id] = trimSessionToLimit(s);
  store.currentId = s.id;
  saveStore(store);
}, 300);

function deleteSession(s: TopicSession): void {
  const store = loadStore();
  delete store.sessions[s.id];
  if (store.currentId === s.id) store.currentId = null;
  saveStore(store);
}

// ============================================================================
// 当前会话状态(模块作用域)
// ============================================================================

let current: TopicSession | null = null;
let inFlightController: AbortController | null = null;

// ============================================================================
// LLM 调用(独立的轻量调用,与 callLLM 解耦 — 这里用于拆解和追问)
// ============================================================================

async function callLLMRaw(
  systemPrompt: string,
  userContent: string,
  cfg: LLMConfig,
  jsonOnly = true,
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const isDeepSeek = /^https?:\/\/api\.deepseek\.com/i.test(cfg.baseUrl);
  const isReasoning = /reasoner|reasoning|r1/i.test(cfg.model);
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.3,
  };
  if (isDeepSeek && isReasoning) body.thinking = { type: 'disabled' };
  const res = await fetch(url, {
    method: 'POST',
    signal: inFlightController?.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LLM API 错误 (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? '';
  if (!content) throw new Error('LLM 返回为空');
  let stripped = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  if (jsonOnly) {
    // 先看顶层是数组还是对象。extractBalancedJson 只识别 {...},对顶层数组 [...](包括嵌套的)会
    // 错误地把第一个 {...} 截出来,丢掉外层的 [ 和后面的元素。所以顶层是 [ 时走数组路径。
    const headIdx = stripped.search(/\S/);
    const head = headIdx >= 0 ? stripped[headIdx] : '';
    if (head === '[') {
      const arrStart = stripped.indexOf('[');
      const arrEnd = stripped.lastIndexOf(']');
      if (arrStart !== -1 && arrEnd > arrStart) {
        stripped = stripped.slice(arrStart, arrEnd + 1);
      } else {
        throw new Error(`LLM 未输出 JSON(返回前 200 字符: ${content.slice(0, 200).replace(/\s+/g, ' ')})`);
      }
    } else {
      const obj = extractBalancedJson(stripped);
      if (obj) {
        stripped = obj;
      } else {
        throw new Error(`LLM 未输出 JSON(返回前 200 字符: ${content.slice(0, 200).replace(/\s+/g, ' ')})`);
      }
    }
  }
  return stripped;
}

// ============================================================================
// 状态机:5 个阶段
// ============================================================================

async function decomposeIdea(idea: string): Promise<SubQ[]> {
  const cfg = loadSettings() as LLMConfig;
  const userPrompt =
    `研究思路:\n"""\n${idea.trim()}\n"""\n\n` +
    `请输出 3-7 个可独立检索的子方向(严格 JSON 数组,不要其它文字):`;
  let raw = '';
  let arr: any[] = [];
  let attempt = 0;
  const MAX = 2;
  while (attempt < MAX) {
    attempt++;
    try {
      raw = await callLLMRaw(DECOMPOSE_SYSTEM, userPrompt, cfg, true);
    } catch (e) {
      if (attempt >= MAX) throw e;
      continue; // 解析错误重试一次
    }
    try {
      arr = JSON.parse(raw);
    } catch {
      if (attempt >= MAX) {
        throw new Error(`拆解结果不是合法 JSON: ${raw.slice(0, 200)}`);
      }
      continue;
    }
    if (Array.isArray(arr) && arr.length > 0) break;
    // 空数组 → 提示用户细化
    if (attempt >= MAX) {
      throw new Error('LLM 未返回任何子方向,试试把思路描述得更具体一些,或换个角度重试');
    }
    // 否则自动重试
    await new Promise((r) => setTimeout(r, 300));
  }
  return arr.slice(0, 7).map((x: any, i: number) => {
    const rawQuery = String(x.query ?? '').trim();
    const cleaned = normalizeQuery(rawQuery);
    return {
      id: uid('q'),
      label: String(x.label ?? `子方向 ${i + 1}`).slice(0, 60),
      query: cleaned || rawQuery, // 兜底清洗后为空就保留原文,仍交给用户手动改
      reason: String(x.reason ?? '').trim(),
      selected: true,
    };
  }).filter((q: SubQ) => q.query);
}

async function searchForDirection(subq: SubQ): Promise<Candidate[]> {
  // 主题探索场景下 query 通常是关键词组合(如 "episodic memory long-term"),用 all: 全文匹配
  // 召回更高;冷门 query 也能搜到。返回后再按时间/相关性让用户挑。
  //
  // 兜底:即使 UI 输入框被填了中文,这里也做一次清洗;如果洗不出任何英文 token
  // (整段中文),直接抛错让 doSearch 显示成"0 命中 + 重试"状态,而不是浪费一次请求。
  const cleaned = normalizeQuery(subq.query);
  const queryForArxiv = cleaned || subq.query.trim();
  const hasAscii = /[A-Za-z]/.test(queryForArxiv);
  if (!hasAscii) {
    throw new Error(`子方向 "${subq.label}" 的 query 不含英文,无法在 arXiv 搜索: ${subq.query}`);
  }
  const entries = await searchArxiv(queryForArxiv, { dedupeLatestVersion: true, mode: 'all' });
  return entries.map((e) => ({
    arxivId: e.arxivId,
    entry: e,
    selected: true,
  }));
}

async function summarizeOne(entry: ArxivEntry, subqId: string): Promise<Summary> {
  const cfg = loadSettings() as LLMConfig;
  // 下载 + 抽 PDF 文本(走 paper-analyzer 的兜底链)
  const buf = await fetchArxivPdf(entry.pdfUrl, (msg) => setStatus(msg));
  const head = new Uint8Array(buf.slice(0, 4));
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  if (!isPdf) {
    throw new Error('PDF 下载失败(proxy 可能返回了 HTML 错误页),请检查网络或切换自定义代理');
  }
  // 复用 paper-analyzer.ts 的 ensurePdfJs/extractPdfTextFromBuffer 是模块内私有函数。
  // 这里自己解析(避免重新打开大文件太多次)。最多 25 页 / 50k 字符。
  // PDF worker 走 settings 的 CORS 代理(同 paper-analyzer 一套),
  // 避免生产部署时硬编码 localhost:8123 直接挂。
  const pdfjsLib = await (async () => {
    const lib = await import('pdfjs-dist');
    const workerTarget = 'https://cdn.bootcdn.net/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
    const corsProxy = getCustomProxy();
    let workerUrl: string;
    if (corsProxy) {
      if (corsProxy.endsWith('/api/proxy')) {
        workerUrl = `${corsProxy}?url=${encodeURIComponent(workerTarget)}`;
      } else {
        workerUrl = `${corsProxy}/${workerTarget}`;
      }
    } else {
      workerUrl = 'http://localhost:8123/?url=' + encodeURIComponent(workerTarget);
    }
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    return lib;
  })();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  const maxPages = Math.min(doc.numPages, 25);
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it: any) => ('str' in it ? it.str : ''))
      .filter(Boolean)
      .join(' ');
    text += pageText + '\n\n';
    if (text.length > 50_000) break;
  }
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 50_000);
  if (text.length < 200) {
    throw new Error(`抽取出的正文太短 (${text.length} 字符),可能是扫描版 PDF / 加密文档`);
  }
  // callLLM 已经 export,且支持 statusCb。复用 paper-analyzer 的 SYSTEM_PROMPT。
  const summary = await callLLM(entry.title, entry.summary, text, cfg, () => { /* status silent */ });
  return {
    arxivId: entry.arxivId,
    subqId,
    summary,
    generatedAt: Date.now(),
  };
}

async function chatWithPaper(arxivId: string, question: string): Promise<string> {
  if (!current) throw new Error('当前无会话');
  const sum = current.summaries.find((s) => s.arxivId === arxivId);
  if (!sum) throw new Error('请先总结这篇论文');
  // 找 entry(可能在 candidatesBySubq 里)
  let entry: ArxivEntry | undefined;
  for (const list of Object.values(current.candidatesBySubq)) {
    const found = list.find((c) => c.arxivId === arxivId);
    if (found) { entry = found.entry; break; }
  }
  if (!entry) throw new Error('找不到这篇论文的元数据');

  const cfg = loadSettings() as LLMConfig;
  const history = (current.chats[arxivId] ?? []).slice(-MAX_QA_FOR_LLM);
  const sysContext =
    `[论文标题] ${entry.title}\n` +
    `[arXiv ID] ${arxivId}\n\n` +
    `[Abstract]\n${entry.summary}\n\n` +
    `[已有速览]\n` +
    `TLDR: ${sum.summary.tldr}\n` +
    `动机: ${sum.summary.motivation}\n` +
    `方法: ${sum.summary.method}\n` +
    `结果: ${sum.summary.result}\n` +
    `结论: ${sum.summary.conclusion}\n`;

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: PAPER_CHAT_SYSTEM + '\n\n' + sysContext },
  ];
  for (const m of history) messages.push({ role: m.role, content: m.content });
  messages.push({ role: 'user', content: question });

  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const isDeepSeek = /^https?:\/\/api\.deepseek\.com/i.test(cfg.baseUrl);
  const isReasoning = /reasoner|reasoning|r1/i.test(cfg.model);
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: 0.4,
  };
  if (isDeepSeek && isReasoning) body.thinking = { type: 'disabled' };
  const res = await fetch(url, {
    method: 'POST',
    signal: inFlightController?.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LLM API 错误 (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  let content: string = data?.choices?.[0]?.message?.content ?? '';
  if (!content) throw new Error('LLM 返回为空');
  content = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:markdown)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  return content;
}

// ============================================================================
// DOM 渲染
// ============================================================================

function setStatus(msg: string, kind: '' | 'error' = ''): void {
  const el = $('status-bar');
  el.classList.remove('topic-hidden');
  el.classList.toggle('error', kind === 'error');
  el.innerHTML = kind === 'error'
    ? `<span>⚠️</span><span>${escapeHtml(msg)}</span>`
    : `<span class="topic-status-spinner"></span><span>${escapeHtml(msg)}</span>`;
}

// 失败时挂一个按钮(label + onClick),方便用户一键重试
function setStatusErrorWithAction(msg: string, actionLabel: string, action: () => void): void {
  const el = $('status-bar');
  el.classList.remove('topic-hidden');
  el.classList.add('error');
  el.innerHTML = `<span>⚠️</span><span>${escapeHtml(msg)}</span><button type="button" class="topic-btn ghost" id="status-action-btn" style="margin-left:auto">${escapeHtml(actionLabel)}</button>`;
  document.getElementById('status-action-btn')?.addEventListener('click', () => {
    clearStatus();
    action();
  });
}

function clearStatus(): void {
  const el = $('status-bar');
  el.classList.add('topic-hidden');
  el.innerHTML = '';
}

function renderBanner(msg: string, info = false): void {
  const slot = $('banner-slot');
  slot.innerHTML = `<div class="topic-banner ${info ? 'info' : ''}">${escapeHtml(msg)}</div>`;
}
function clearBanner(): void {
  $('banner-slot').innerHTML = '';
}

function renderSessionMeta(): void {
  const meta = $('session-meta');
  if (!current) {
    meta.textContent = '尚未开始 — 在下方输入一段研究思路';
    ($('copy-all-btn') as HTMLButtonElement).disabled = true;
    return;
  }
  const subqN = current.subqs.length;
  const candN = Object.values(current.candidatesBySubq).reduce((a, b) => a + b.length, 0);
  const sumN = current.summaries.length;
  const qaN = Object.values(current.chats).reduce((a, b) => a + b.length, 0);
  const ideaPreview = (current.topic || '').slice(0, 50) + ((current.topic || '').length > 50 ? '…' : '');
  meta.textContent =
    `已拆解 ${subqN} 个方向 · 候选 ${candN} 篇 · 已总结 ${sumN} 篇 · 追问 ${qaN} 轮` +
    (ideaPreview ? ` · "${ideaPreview}"` : '');
  ($('copy-all-btn') as HTMLButtonElement).disabled = sumN === 0;
}

function renderInputStage(): void {
  const ta = $<HTMLTextAreaElement>('topic-input');
  ta.value = current?.topic ?? '';
  const btn = $<HTMLButtonElement>('decompose-btn');
  btn.disabled = !ta.value.trim();
  $('input-hint').textContent = current
    ? '已拆解过 — 修改后再次点拆解会覆盖现有子方向。'
    : '提示:思路越具体,拆解出的子方向越精准。';
}

function renderSubqStage(): void {
  const list = $('subq-list');
  const subqMeta = $('subq-meta');
  const searchBtn = $<HTMLButtonElement>('search-btn');
  if (!current || current.subqs.length === 0) {
    list.innerHTML = '<div style="color:var(--fg-subtle);font-size:0.88rem">尚未拆解 — 在第 1 步输入思路后点"🔍 拆解思路"。</div>';
    subqMeta.textContent = '尚未拆解';
    searchBtn.disabled = true;
    return;
  }
  const selectedCount = current.subqs.filter((s) => s.selected).length;
  subqMeta.textContent = `共 ${current.subqs.length} 个,已选 ${selectedCount}`;
  searchBtn.disabled = selectedCount === 0;
  list.innerHTML = current.subqs.map((q, i) => `
    <div class="topic-subq-card ${q.selected ? 'selected' : ''}" data-id="${q.id}">
      <input type="checkbox" class="topic-subq-check" ${q.selected ? 'checked' : ''} aria-label="勾选子方向 ${i + 1}" />
      <div class="topic-subq-card-main">
        <div class="topic-subq-card-row">
          <input type="text" class="label-input" value="${escapeHtml(q.label)}" data-field="label" placeholder="子方向标题" />
          <div class="topic-subq-card-actions">
            <button type="button" class="topic-btn ghost" data-act="regen" title="重新生成此子方向">🔄</button>
            <button type="button" class="topic-btn ghost" data-act="del" title="删除此子方向">✕</button>
          </div>
        </div>
        <div class="topic-subq-card-row">
          <input type="text" class="query-input" value="${escapeHtml(q.query)}" data-field="query" placeholder="arXiv 检索 query(英文)" />
        </div>
        <textarea data-field="reason" placeholder="为什么这个子方向值得检索">${escapeHtml(q.reason)}</textarea>
      </div>
    </div>
  `).join('');

  // 绑定交互
  list.querySelectorAll<HTMLElement>('.topic-subq-card').forEach((card) => {
    const id = card.dataset.id!;
    const subq = current!.subqs.find((s) => s.id === id)!;
    card.querySelector<HTMLInputElement>('.topic-subq-check')!.addEventListener('change', (e) => {
      subq.selected = (e.target as HTMLInputElement).checked;
      card.classList.toggle('selected', subq.selected);
      renderSubqStage();
      persistSession(current!);
    });
    card.querySelectorAll<HTMLInputElement>('input[data-field], textarea[data-field]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const field = inp.dataset.field as 'label' | 'query' | 'reason';
        (subq as any)[field] = inp.value;
        persistSession(current!);
      });
    });
    card.querySelector<HTMLButtonElement>('[data-act="del"]')!.addEventListener('click', () => {
      current!.subqs = current!.subqs.filter((s) => s.id !== id);
      delete current!.candidatesBySubq[id];
      current!.summaries = current!.summaries.filter((s) => s.subqId !== id);
      renderSubqStage();
      renderCandStage();
      renderSummaryStage();
      renderSessionMeta();
      persistSession(current!);
    });
    card.querySelector<HTMLButtonElement>('[data-act="regen"]')!.addEventListener('click', async () => {
      if (!current) return;
      try {
        inFlightController = new AbortController();
        setStatus(`重新生成子方向 ${subq.label}...`);
        const newOne = await decomposeIdea(current.topic);
        if (newOne.length > 0) {
          // 只替换这一个
          const replacement = newOne[0];
          subq.label = replacement.label;
          subq.query = replacement.query;
          subq.reason = replacement.reason;
          renderSubqStage();
          persistSession(current!);
        }
      } catch (e) {
        setStatus(`重新生成失败: ${(e as Error).message}`, 'error');
      } finally {
        clearStatus();
      }
    });
  });
}

function renderCandStage(): void {
  const wrap = $('cand-list');
  const meta = $('cand-meta');
  const summarizeBtn = $<HTMLButtonElement>('summarize-btn');
  if (!current || Object.keys(current.candidatesBySubq).length === 0) {
    wrap.innerHTML = '<div style="color:var(--fg-subtle);font-size:0.88rem">尚未搜索 — 在第 2 步勾选子方向后点"📚 搜索论文"。</div>';
    meta.textContent = '尚未搜索';
    summarizeBtn.disabled = true;
    return;
  }
  const allCands: Candidate[] = [];
  for (const list of Object.values(current.candidatesBySubq)) allCands.push(...list);
  const selected = allCands.filter((c) => c.selected).length;
  meta.textContent = `共 ${allCands.length} 篇候选,已选 ${selected}`;
  summarizeBtn.disabled = selected === 0;

  // 按 subq 分组渲染 — 即使某个子方向 0 命中也要显示,这样用户能看到"哪些没搜到"
  wrap.innerHTML = current.subqs.filter((q) => current!.candidatesBySubq[q.id] !== undefined).map((q) => {
    const list = current!.candidatesBySubq[q.id] || [];
    const grpSelected = list.filter((c) => c.selected).length;
    const emptyHint = list.length === 0
      ? `<div style="padding:0.7rem 0.9rem;color:var(--fg-subtle);font-size:0.85rem">未命中任何论文。可能是 query 太冷门,试试改 query 或换个角度重检索。</div>`
      : '';
    return `
      <div class="topic-candidate-group" data-subq="${q.id}">
        <div class="topic-candidate-group-header" data-act="toggle-grp">
          <div class="topic-candidate-group-title">📂 ${escapeHtml(q.label)}</div>
          <div class="topic-candidate-group-meta">${list.length === 0 ? `0 命中` : `${grpSelected}/${list.length} 已选 · <a href="#" data-act="toggle-all">${grpSelected === list.length ? '全不选' : '全选'}</a>`}</div>
        </div>
        ${list.length === 0 ? emptyHint : `
        <div class="topic-candidate-list">
          ${list.map((c) => `
            <div class="topic-candidate-item ${c.selected ? 'selected' : ''}" data-arxiv="${escapeHtml(c.arxivId)}">
              <input type="checkbox" ${c.selected ? 'checked' : ''} aria-label="勾选论文 ${escapeHtml(c.entry.title)}" />
              <div class="topic-candidate-main">
                <div class="topic-candidate-title">${escapeHtml(c.entry.title)}</div>
                <div class="topic-candidate-meta">arXiv:${escapeHtml(c.arxivId)} · ${escapeHtml((c.entry.published || '').slice(0, 10))} · ${c.entry.authors.length} 位作者</div>
                <div class="topic-candidate-summary">${escapeHtml(c.entry.summary)}</div>
              </div>
              <div></div>
            </div>
          `).join('')}
        </div>
        `}
      </div>
    `;
  }).join('');

  // 绑定
  wrap.querySelectorAll<HTMLElement>('.topic-candidate-item').forEach((row) => {
    const ax = row.dataset.arxiv!;
    const cb = row.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    cb.addEventListener('change', () => {
      for (const list of Object.values(current!.candidatesBySubq)) {
        for (const c of list) if (c.arxivId === ax) c.selected = cb.checked;
      }
      row.classList.toggle('selected', cb.checked);
      renderCandStage(); // 刷新 meta
      persistSession(current!);
    });
  });
  wrap.querySelectorAll<HTMLElement>('.topic-candidate-group').forEach((grp) => {
    const subqId = grp.dataset.subq!;
    const list = current!.candidatesBySubq[subqId] || [];
    const toggleAll = grp.querySelector<HTMLElement>('[data-act="toggle-all"]');
    if (!toggleAll) return; // 0 命中子方向没有"全选/全不选"链接
    toggleAll.addEventListener('click', (e) => {
      e.preventDefault();
      const allSelected = list.every((c) => c.selected);
      for (const c of list) c.selected = !allSelected;
      renderCandStage();
      persistSession(current!);
    });
  });
}

function renderSummaryStage(): void {
  const list = $('summary-list');
  const meta = $('summ-meta');
  if (!current || current.summaries.length === 0) {
    list.innerHTML = '<div style="color:var(--fg-subtle);font-size:0.88rem">尚未总结 — 在第 3 步勾选论文后点"🚀 总结选中论文"。</div>';
    meta.textContent = '尚未总结';
    return;
  }
  meta.textContent = `已总结 ${current.summaries.length} 篇`;
  list.innerHTML = current.summaries.map((s) => {
    let entry: ArxivEntry | undefined;
    for (const clist of Object.values(current!.candidatesBySubq)) {
      const f = clist.find((c) => c.arxivId === s.arxivId);
      if (f) { entry = f.entry; break; }
    }
    const subq = current!.subqs.find((q) => q.id === s.subqId);
    const r = s.summary;
    const noteHtml = (label: string, content: string): string => content
      ? `<div class="topic-summary-note"><div class="topic-summary-note-label">${label}</div><div class="topic-summary-note-text">${escapeHtml(content).replace(/\n/g, '<br>')}</div></div>`
      : '';
    return `
      <article class="topic-summary-card" data-arxiv="${escapeHtml(s.arxivId)}">
        <header class="topic-summary-card-header">
          <h3 class="topic-summary-title">${escapeHtml(r.title || entry?.title || s.arxivId)}</h3>
          ${r.title_en ? `<p class="topic-summary-title-en">${escapeHtml(r.title_en)}</p>` : ''}
          <div class="topic-summary-meta">
            <span>arXiv:${escapeHtml(s.arxivId)}</span>
            ${subq ? `<span>· 来自子方向:${escapeHtml(subq.label)}</span>` : ''}
            ${entry?.authors.length ? `<span>· ${entry.authors.length} 位作者</span>` : ''}
          </div>
        </header>
        <div class="topic-summary-body">
          ${r.tldr ? `<div class="topic-summary-tldr"><div class="topic-summary-tldr-label">TL;DR</div><div class="topic-summary-tldr-text">${escapeHtml(r.tldr)}</div></div>` : ''}
          <div class="topic-summary-notes">
            ${noteHtml('动机', r.motivation)}
            ${noteHtml('方法', r.method)}
            ${noteHtml('结果', r.result)}
            ${noteHtml('结论', r.conclusion)}
          </div>
        </div>
        <div class="topic-summary-actions">
          <button type="button" class="topic-btn ghost" data-act="regen">🔄 重新生成</button>
          <button type="button" class="topic-btn ghost" data-act="toggle-chat">💬 追问 / 收起</button>
        </div>
        <div class="topic-summary-status topic-hidden" data-role="status"></div>
        <div class="topic-chat topic-hidden" data-role="chat">
          <div class="topic-chat-history" data-role="history"></div>
          <div class="topic-chat-input">
            <input type="text" placeholder="问点什么…例如:它的方法有什么局限?" />
            <button type="button" class="topic-btn primary" data-act="send-chat">发送</button>
          </div>
          <div class="topic-chat-foot">
            <span>本地仅保留最近 ${MAX_QA_PER_PAPER} 轮</span>
            <button type="button" class="topic-btn ghost" data-act="clear-chat">清空本轮追问</button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  // 绑定每篇的操作
  list.querySelectorAll<HTMLElement>('.topic-summary-card').forEach((card) => {
    const ax = card.dataset.arxiv!;
    card.querySelector<HTMLButtonElement>('[data-act="regen"]')!.addEventListener('click', () => regenerateSummary(ax));
    card.querySelector<HTMLButtonElement>('[data-act="toggle-chat"]')!.addEventListener('click', () => {
      const chat = card.querySelector<HTMLElement>('[data-role="chat"]')!;
      chat.classList.toggle('topic-hidden');
      if (!chat.classList.contains('topic-hidden')) {
        renderChatHistory(card);
        chat.querySelector<HTMLInputElement>('input[type=text]')!.focus();
      }
    });
    card.querySelector<HTMLButtonElement>('[data-act="send-chat"]')!.addEventListener('click', () => sendChat(card));
    card.querySelector<HTMLInputElement>('.topic-chat-input input')!.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendChat(card); }
    });
    card.querySelector<HTMLButtonElement>('[data-act="clear-chat"]')!.addEventListener('click', () => {
      if (!confirm('确定要清空这篇论文的所有追问历史吗?')) return;
      delete current!.chats[ax];
      renderChatHistory(card);
      renderSessionMeta();
      persistSession(current!);
    });
  });
}

function renderChatHistory(card: HTMLElement): void {
  if (!current) return;
  const ax = card.dataset.arxiv!;
  const history = card.querySelector<HTMLElement>('[data-role="history"]')!;
  const msgs = current.chats[ax] ?? [];
  if (msgs.length === 0) {
    history.innerHTML = '<div class="topic-chat-empty">还没有追问 — 输入问题开始多轮对话</div>';
    return;
  }
  history.innerHTML = msgs.map((m) => `
    <div class="topic-chat-msg ${m.role}">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
  `).join('');
  history.scrollTop = history.scrollHeight;
}

function setSummaryStatus(card: HTMLElement, msg: string, error = false): void {
  const status = card.querySelector<HTMLElement>('[data-role="status"]')!;
  status.classList.remove('topic-hidden');
  status.classList.toggle('error', error);
  status.textContent = msg;
}

async function regenerateSummary(arxivId: string): Promise<void> {
  if (!current) return;
  const sum = current.summaries.find((s) => s.arxivId === arxivId);
  if (!sum) return;
  let entry: ArxivEntry | undefined;
  for (const list of Object.values(current.candidatesBySubq)) {
    const f = list.find((c) => c.arxivId === arxivId);
    if (f) { entry = f.entry; break; }
  }
  if (!entry) {
    setStatus(`找不到论文 ${arxivId} 的元数据,无法重新生成`, 'error');
    return;
  }
  const card = document.querySelector<HTMLElement>(`.topic-summary-card[data-arxiv="${arxivId}"]`);
  if (!card) return;
  try {
    inFlightController = new AbortController();
    setSummaryStatus(card, '⏳ 正在重新生成...');
    const newSum = await summarizeOne(entry, sum.subqId);
    sum.summary = newSum.summary;
    sum.generatedAt = Date.now();
    renderSummaryStage();
    renderSessionMeta();
    persistSession(current!);
  } catch (e) {
    setSummaryStatus(card, `✗ 重新生成失败: ${(e as Error).message}`, true);
  } finally {
    inFlightController = null;
  }
}

async function sendChat(card: HTMLElement): Promise<void> {
  if (!current) return;
  const ax = card.dataset.arxiv!;
  const input = card.querySelector<HTMLInputElement>('.topic-chat-input input')!;
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  if (!current.chats[ax]) current.chats[ax] = [];
  current.chats[ax].push({ role: 'user', content: q, ts: Date.now() });
  // 截断到上限
  if (current.chats[ax].length > MAX_QA_PER_PAPER) {
    current.chats[ax] = current.chats[ax].slice(-MAX_QA_PER_PAPER);
  }
  renderChatHistory(card);
  renderSessionMeta();
  persistSession(current!);

  setSummaryStatus(card, '⏳ 思考中...');
  try {
    inFlightController = new AbortController();
    const a = await chatWithPaper(ax, q);
    current.chats[ax].push({ role: 'assistant', content: a, ts: Date.now() });
    if (current.chats[ax].length > MAX_QA_PER_PAPER) {
      current.chats[ax] = current.chats[ax].slice(-MAX_QA_PER_PAPER);
    }
    renderChatHistory(card);
    renderSessionMeta();
    persistSession(current!);
    const status = card.querySelector<HTMLElement>('[data-role="status"]')!;
    status.classList.add('topic-hidden');
  } catch (e) {
    setSummaryStatus(card, `✗ 追问失败: ${(e as Error).message}`, true);
  } finally {
    inFlightController = null;
  }
}

function renderAll(): void {
  renderSessionMeta();
  renderInputStage();
  renderSubqStage();
  renderCandStage();
  renderSummaryStage();
}

// ============================================================================
// 阶段动作(用户触发)
// ============================================================================

async function doDecompose(): Promise<void> {
  if (!current) return;
  const ta = $<HTMLTextAreaElement>('topic-input');
  const idea = ta.value.trim();
  if (!idea) return;
  const cfg = loadSettings() as LLMConfig;
  if (!cfg.apiKey) {
    renderBanner('请先在 <a href="/settings/">设置</a> 页面填 LLM API Key。');
    return;
  }
  clearBanner();
  inFlightController = new AbortController();
  setStatus('🔍 拆解思路中...');
  ($<HTMLButtonElement>('decompose-btn')).disabled = true;
  try {
    const subqs = await decomposeIdea(idea);
    current.topic = idea;
    current.subqs = subqs;
    // 清掉旧的候选/总结(主题变了)
    current.candidatesBySubq = {};
    current.summaries = [];
    current.chats = {};
    ($('stage-subqs') as HTMLDetailsElement).open = true;
    renderAll();
    persistSession(current!);
    setStatus(`✓ 已拆解为 ${subqs.length} 个子方向`);
    setTimeout(clearStatus, 1500);
  } catch (e) {
    setStatusErrorWithAction(`拆解失败: ${(e as Error).message}`, '🔄 重试', () => doDecompose());
  } finally {
    ($<HTMLButtonElement>('decompose-btn')).disabled = false;
    inFlightController = null;
  }
}

async function doSearch(): Promise<void> {
  if (!current) return;
  const selected = current.subqs.filter((q) => q.selected);
  if (selected.length === 0) return;
  ($<HTMLButtonElement>('search-btn')).disabled = true;
  inFlightController = new AbortController();
  setStatus(`📚 搜索 ${selected.length} 个子方向...`);
  // 清空旧候选
  for (const q of selected) current.candidatesBySubq[q.id] = [];
  renderCandStage();

  let done = 0;
  const result = await runConcurrent(
    selected,
    SUMMARIZE_CONCURRENCY,
    async (q) => {
      const cands = await searchForDirection(q);
      current!.candidatesBySubq[q.id] = cands;
      return cands.length;
    },
    (d, total) => {
      done = d;
      setStatus(`📚 搜索中 ${done}/${total} ...`);
      renderCandStage();
      persistSession(current!);
    },
  );
  // 统计命中情况
  const totalCands = Object.values(current.candidatesBySubq).reduce((a, b) => a + b.length, 0);
  const subqsSearched = Object.values(current.candidatesBySubq).filter((l) => l !== undefined).length;
  const subqsHit = Object.values(current.candidatesBySubq).filter((l) => (l || []).length > 0).length;
  if (result.err.length > 0) {
    const msg = result.err.map((e) => (e.error as Error).message).join('; ');
    if (totalCands === 0) {
      // 完全没拿到论文 — 提示重试
      setStatusErrorWithAction(`所有子方向都未命中(代理或网络问题): ${msg.slice(0, 100)}`, '🔄 重试', () => doSearch());
    } else {
      setStatus(`部分子方向失败,共拿到 ${totalCands} 篇候选`, 'error');
      setTimeout(clearStatus, 3000);
    }
  } else if (totalCands === 0) {
    // 搜索成功但 0 命中 — 提示用户改 query
    setStatusErrorWithAction(`搜索完成但 ${subqsSearched} 个子方向都未命中论文。可能是 query 太冷门,试试改英文关键词。`, '🔄 重新搜索', () => doSearch());
  } else {
    setStatus(`✓ ${subqsHit}/${subqsSearched} 个子方向命中,共 ${totalCands} 篇候选`);
    setTimeout(clearStatus, 1500);
  }
  ($<HTMLButtonElement>('search-btn')).disabled = false;
  ($('stage-candidates') as HTMLDetailsElement).open = true;
  renderCandStage();
  renderSessionMeta();
  persistSession(current!);
  inFlightController = null;
}

async function doSummarize(): Promise<void> {
  if (!current) return;
  // 收集所有勾选的候选
  const picks: Array<{ cand: Candidate; subqId: string }> = [];
  for (const [subqId, list] of Object.entries(current.candidatesBySubq)) {
    for (const c of list) if (c.selected) picks.push({ cand: c, subqId });
  }
  if (picks.length === 0) return;
  // 去重(同一篇可能来自多个子方向):保留第一条
  const seen = new Set<string>();
  const unique = picks.filter((p) => {
    const k = canonicalId(p.cand.arxivId);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 清掉旧总结(只清这批论文的)
  const ids = new Set(unique.map((p) => p.cand.arxivId));
  current.summaries = current.summaries.filter((s) => !ids.has(s.arxivId));
  // 同步清掉这些 paper 的追问(可选:保留,但 user 可能觉得混乱)
  for (const id of ids) delete current.chats[id];

  ($<HTMLButtonElement>('summarize-btn')).disabled = true;
  inFlightController = new AbortController();
  ($('stage-summaries') as HTMLDetailsElement).open = true;
  setStatus(`🚀 总结 ${unique.length} 篇论文(并发上限 ${SUMMARIZE_CONCURRENCY})...`);

  const result = await runConcurrent(
    unique,
    SUMMARIZE_CONCURRENCY,
    async ({ cand, subqId }) => {
      const sum = await summarizeOne(cand.entry, subqId);
      current!.summaries.push(sum);
      return sum;
    },
    (d, total) => {
      setStatus(`🚀 总结中 ${d}/${total} ...`);
      renderSummaryStage();
      renderSessionMeta();
      persistSession(current!);
    },
  );

  if (result.err.length > 0) {
    setStatus(`部分总结失败: ${result.err.map((e) => (e.error as Error).message).join('; ')}`, 'error');
  } else {
    setStatus('✓ 全部总结完成');
    setTimeout(clearStatus, 1500);
  }
  ($<HTMLButtonElement>('summarize-btn')).disabled = false;
  renderSummaryStage();
  renderSessionMeta();
  persistSession(current!);
  inFlightController = null;
}

function copyAllAsMarkdown(): void {
  if (!current || current.summaries.length === 0) return;
  const lines: string[] = [];
  lines.push(`# ${current.topic || '(主题探索)'}`);
  lines.push('');
  lines.push(`> 生成于 ${new Date().toISOString()},共 ${current.summaries.length} 篇论文`);
  lines.push('');
  lines.push('## 子方向');
  for (const q of current.subqs) {
    lines.push(`- **${q.label}**: \`${q.query}\` — ${q.reason}`);
  }
  lines.push('');
  lines.push('## 论文速览');
  for (const s of current.summaries) {
    lines.push(`### ${s.summary.title || s.arxivId}`);
    if (s.summary.title_en) lines.push(`*${s.summary.title_en}*`);
    lines.push(`arXiv: ${s.arxivId}`);
    if (s.summary.tldr) lines.push(`\n**TLDR**: ${s.summary.tldr}`);
    if (s.summary.motivation) lines.push(`\n**动机**: ${s.summary.motivation}`);
    if (s.summary.method) lines.push(`\n**方法**: ${s.summary.method}`);
    if (s.summary.result) lines.push(`\n**结果**: ${s.summary.result}`);
    if (s.summary.conclusion) lines.push(`\n**结论**: ${s.summary.conclusion}`);
    lines.push('');
  }
  const md = lines.join('\n');
  navigator.clipboard.writeText(md).then(
    () => setStatus('✓ 已复制全部为 Markdown'),
    () => setStatus('复制失败,请手动选择', 'error'),
  );
}

function startNewSession(): void {
  if (current && (current.subqs.length > 0 || current.summaries.length > 0)) {
    if (!confirm('确定要新建会话?当前会话的论文和追问会被清空(已写入 localStorage 的旧会话可手动清除)。')) return;
  }
  if (current) deleteSession(current);
  current = null;
  ($<HTMLTextAreaElement>('topic-input')).value = '';
  clearBanner();
  clearStatus();
  renderAll();
}

// ============================================================================
// Init
// ============================================================================

function ensureSession(): void {
  if (current) return;
  const store = loadStore();
  if (store.currentId && store.sessions[store.currentId]) {
    current = store.sessions[store.currentId];
    setStatus('✓ 已恢复上次会话');
    setTimeout(clearStatus, 1500);
  } else {
    current = {
      id: uid('ts'),
      topic: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      subqs: [],
      candidatesBySubq: {},
      summaries: [],
      chats: {},
    };
    const store2 = loadStore();
    store2.currentId = current.id;
    store2.sessions[current.id] = current;
    saveStore(store2);
  }
}

function init(): void {
  // 检查 LLM key
  const cfg = loadSettings() as LLMConfig;
  if (!cfg.apiKey) {
    renderBanner('⚠️ 你还没填 LLM API Key,先去 <a href="/settings/">设置</a> 页面填一下。');
  }

  ensureSession();
  renderAll();

  // 监听输入 → 拆解按钮 enable
  $<HTMLTextAreaElement>('topic-input').addEventListener('input', (e) => {
    const v = (e.target as HTMLTextAreaElement).value.trim();
    ($<HTMLButtonElement>('decompose-btn')).disabled = !v;
    if (current) {
      current.topic = (e.target as HTMLTextAreaElement).value;
      persistSession(current);
    }
  });

  // 主按钮
  $<HTMLButtonElement>('decompose-btn').addEventListener('click', doDecompose);
  $<HTMLButtonElement>('search-btn').addEventListener('click', doSearch);
  $<HTMLButtonElement>('summarize-btn').addEventListener('click', doSummarize);
  $<HTMLButtonElement>('subq-add-btn').addEventListener('click', () => {
    if (!current) return;
    current.subqs.push({
      id: uid('q'),
      label: '新子方向',
      query: '',
      reason: '',
      selected: true,
    });
    renderSubqStage();
    persistSession(current!);
  });

  // 顶栏
  $<HTMLButtonElement>('new-session-btn').addEventListener('click', startNewSession);
  $<HTMLButtonElement>('copy-all-btn').addEventListener('click', copyAllAsMarkdown);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}