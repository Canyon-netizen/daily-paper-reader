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
  loadHiddenPapers,
  loadSelection,
  isInSelection,
  addToSelection,
  removeFromSelection,
  clearSelection,
  type SelectionItem,
} from './settings';
import {
  searchArxiv,
  searchArxivById,
  fetchArxivPdf,
  extractBalancedJson,
  callLLM,
} from './paper-analyzer';
import type { ArxivEntry, AnalysisResult } from './paper-analyzer';
import { debounce, canonicalArxivId as canonicalId, escapeHtml } from '../lib/dom-utils';

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
  // 新增:从已选论文来的方向带这个标签 — 标记迁移范式
  explorationType?: 'cross_domain' | 'method_transfer' | 'reverse' | 'combination';
  // 新增:
  //   manual: 用户输入思路 + 没选参考论文 → 纯手动拆解
  //   manual-with-seeds: 用户输入思路 + 同时选了一些参考论文 → 拆解 prompt 既看思路也看参考
  //   seeds: 来自 ?from=selection 入口,完全替代主题,纯靠 seeds 生成迁移方向
  source?: 'manual' | 'manual-with-seeds' | 'seeds';
  // arXiv 真实常见写法(3-5 个独立英文关键词/短语)。
  // searchForDirection 会逐个打 arXiv 后按 canonicalArxivId 合并去重。
  // 老 session 没这个字段 → undefined,走 ?? [] 兜底。
  aliases?: string[];
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
  // 主题报告(阶段 5 产物)。老 session 没这个字段 → undefined,所有
  // `if (current.report) ...` / `current.report?.` 走兜底,不需要 schema 迁移。
  report?: TopicReport;
  // 最近一次 doDecompose 拆解时参考的论文 ID(来自 modal 加进 selection 的那批);
  // 用于阶段 1 banner 渲染"你选了 N 篇论文参与本次拆解"。不影响搜索/总结逻辑。
  // 复选框手动选子方向时同样有效。如果用户后续又点了一次 🔍 拆解思路,这里会
  // 被覆盖成最新一批 seeds 的 ID。
  referenceSeedArxivIds?: string[];
}

interface TopicReportDimensionPaper {
  arxivId: string;
  role: string;       // 在该维度下的定位, 截断 24
  key: string;        // 与维度的连接点, 截断 120
  method?: string;    // 截断 120
  result?: string;    // 截断 120
  note?: string;      // 截断 120
}

interface TopicReportDimension {
  name: string;                                  // 截断 30
  description?: string;                          // 截断 160
  papers: TopicReportDimensionPaper[];           // ≥ 1
}

interface TopicReport {
  overview: string;                              // 截断 800
  dimensions: TopicReportDimension[];            // 2-6
  sharedFindings: string[];                      // 截断 120/条, 最长 8
  gaps: string[];                                // 截断 120/条, 最长 6
  nextSteps: string[];                           // 截断 120/条, 最长 6
  generatedAt: number;
  relatedArxivIds: string[];                     // 用于 UI 排序
  incrementallyAddedArxivIds?: string[];         // 仅 incremental 模式
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
// 主题报告增量追加节流(同 session 内 N 篇并发完成时,8 秒内最多触发 1 次)
const REPORT_INC_THROTTLE_MS = 8000;
// 报告生成 LLM 重试次数
const REPORT_LLM_RETRY = 2;

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
  - aliases: **3-5 个 arXiv 真实常见写法**(用于 searchForDirection 多别名单跑),
          字符串数组,每个元素是 2-4 个英文关键词空格分隔的短语,
          例如 ["memory-augmented agent", "retrieval memory", "long context memory"];
          不要与 query 重复,也不要写中文
  - reason: 一句话中文说明为什么这个子方向值得检索

【检索纪律 - 非常重要】
- query 必须是纯英文单词组合,**绝对不要在 query 里出现中文字符**;
  即使用户输入的是中文思路,query 也要全部用英文专业术语
- query 用 2-3 个独立的英文关键词(arXiv 习惯用 all: 全文匹配,独立关键词召回更高);
  写成完整短语(超过 3 词) 在 arXiv 上几乎 0 召回 — 拆短、拆开
- aliases 是"arXiv 上真正有人用的关键词组合",必须贴近 arXiv 论文的真实写法;
  不要硬塞自定义短语,挑 arXiv 搜索栏输入会出现的词组;3-5 个,不能与 query 完全一样
- 子方向之间要尽量不重叠,覆盖思路的不同侧面(方法/应用/评测/理论)
- 数量 2-5 个都可以;思路很短时 2 个也行,不要为了凑数而编造不相关的方向

【示例输出】
[
  {"label":"情节记忆与长期记忆","query":"episodic memory long-term",
   "aliases":["memory-augmented agent","long context memory","retrieval memory"],
   "reason":"对应思路中关于智能体跨会话记忆的核心方法"},
  {"label":"游戏智能体记忆基准","query":"game agent memory benchmark",
   "aliases":["agent memory benchmark","memory evaluation"],
   "reason":"对应评测层面,检索游戏场景下记忆模块的基准与对比"}
]`;

const EXPLORE_FROM_SEEDS_SYSTEM = `你是研究迁移/探索助手。用户已选 N 篇相关性较高的论文,你需要基于这些论文的核心思路,
生成 4-6 个"迁移或探索"方向,用于在 arXiv 上检索新论文。

【4 种迁移范式 — 尽量覆盖,避免只输出一种】
1. cross_domain (跨域迁移):把方法/思想从一个领域搬到另一个领域(例如把 RL 训练方法用到蛋白质设计)
2. method_transfer (方法借鉴):把某篇论文的核心技术手段(如某种 loss、某种解码策略、某种评测协议)
   应用到不同问题
3. reverse (反向工程):把论文的目标/结论反过来用(例如把"检测幻觉"反过来用做"主动生成幻觉做训练数据";
   或把"压缩模型"反过来想成"展开小模型得到大模型能力")
4. combination (组合创新):把多篇论文的思路叠加形成新方向(例如论文 A 的表示 + 论文 B 的优化 +
   论文 C 的评测)

【输出格式 — 必须严格遵守】
- 只输出一个 JSON 数组,不要任何其它文字、markdown 围栏、思考块
- 不要写 <think> 思考块,不要写解释
- 第一行必须是 [ ,最后一行必须是 ]
- 每个元素字段:
  - label: 中文短标题(8-20 字)
  - query: **2-3 个英文独立 arXiv 关键词,空格分隔**(例如 "reinforcement learning protein design")
  - aliases: **3-5 个 arXiv 真实常见写法的英文短语**,字符串数组;
          必须贴近 arXiv 搜索栏的真实输入(你"会"在 arXiv 上敲的词组),不能与 query 完全相同;
          例如 ["RLHF protein","reward model design","policy optimization biology"]
  - reason: 一句话中文,**明确引用至少 1 篇已选论文(用标题或核心方法名)+ 它提供的可迁移点**
  - explorationType: 必须是 cross_domain / method_transfer / reverse / combination 之一

【检索纪律 - 非常重要】
- query 必须是纯英文单词组合,**绝对不要在 query 里出现中文字符**
- query 用 2-3 个独立的英文关键词,不要写完整短语或句子(arXiv all: 全文模式,短词召回更高)
- aliases 必须贴近 arXiv 真实写作习惯,挑会在 arXiv 搜索栏里"会敲"的那类词组;3-5 个
- reason 必须能让人看出"这个方向和已选论文的具体连接点",不要泛泛而谈"可借鉴 X 方法"
- 当 N >= 3 时,**4 种 explorationType 至少各出现 1 次**(避免只输出 cross_domain)
- 当 N < 3 时,允许某种范式重复,但仍要覆盖至少 2 种不同范式

【示例输出】
[
  {"label":"RLHF 思想迁移到蛋白质序列设计","query":"reinforcement learning protein design",
   "aliases":["RLHF protein","reward model design","policy optimization biology"],
   "reason":"已选论文《Aligning Language Models》把 PPO 用于 LLM 对齐,核心 trick(reward model + KL 约束)可迁移到蛋白质生成中提升稳定性","explorationType":"cross_domain"},
  {"label":"借用对比解码做摘要事实性","query":"contrastive decoding summarization",
   "aliases":["contrastive decoding","faithful summarization","hallucination mitigation"],
   "reason":"论文《Contrastive Decoding》提出的正负 prompt 对比解码,可直接套用到摘要生成中缓解幻觉","explorationType":"method_transfer"},
  {"label":"反用幻觉检测做对抗训练","query":"adversarial training hallucination",
   "aliases":["adversarial NLG","hallucination detection","robust generation"],
   "reason":"把论文《Detecting Hallucinations》的检测器反过来当攻击器,生成对抗样本增强模型鲁棒性","explorationType":"reverse"},
  {"label":"长上下文 + 思维链融合","query":"long-context chain-of-thought",
   "aliases":["long context reasoning","chain-of-thought prompting","extended context LLM"],
   "reason":"结合论文 A 的 100k 上下文窗口与论文 B 的多步 CoT prompting,探索超长文档上的多步推理","explorationType":"combination"}
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

const TOPIC_REPORT_SYSTEM = `你是研究主题整合助手。用户给你 M 篇论文的中文速览笔记(每篇包含标题、
TLDR / 方法 / 结果 / 结论 / 主题语境),以及一个研究主题的种子描述。

你需要做"主题级横向整合",输出一份适合研究者 5 分钟内掌握全局的中文报告。

【输出格式 — 必须严格遵守】
- 只输出一个 JSON 对象,不要任何其它文字 / markdown 围栏 / 思考块
- 不要写 <think> 思考块
- 第一行必须是 {,最后一行必须是 }
- 字段如下,字段名/类型严格匹配:
  - overview: 字符串,主题总览(2-3 段),≤ 400 字
  - dimensions: 数组,2-6 个维度,每个元素:
      - name: 字符串,维度名,≤ 14 字
      - description: 字符串,维度概述,≤ 80 字(可省略)
      - papers: 数组,≥ 1 篇该维度下的论文,每篇:
          - arxivId: 字符串,严格匹配输入(去掉版本号后)
          - role: 字符串,≤ 12 字
          - key: 字符串,一句话连接点,≤ 60 字
          - method: 字符串,≤ 60 字(可省略)
          - result: 字符串,≤ 60 字(可省略)
          - note: 字符串,≤ 60 字(可省略)
  - sharedFindings: 字符串数组,3-6 条共同发现,每条 ≤ 60 字
  - gaps: 字符串数组,2-5 条研究空白,每条 ≤ 60 字
  - nextSteps: 字符串数组,3-5 条下一步建议,每条 ≤ 60 字

【归纳纪律 — 非常重要】
- dimensions 是"归纳出来的横向比较轴",不要每个论文一个维度;当 M>3 时尤其要合并
  (例如多篇同做 RLHF 合并成"RLHF 对齐范式")
- 每篇论文必须在至少一个维度里出现;理想是 1-2 次出现(过度散开说明维度没归纳)
- overview 不要照抄单篇 TLDR,要写"这堆论文研究的是什么 / 主要分歧点 / 适用场景"
- sharedFindings 是"多篇一致或收敛的方向",gaps 是"论文没解决或互相矛盾的地方",
  nextSteps 给读者(下一步读什么 / 哪个方向有空间)
- 当 incrementalMode = true 时,你会收到 prevDimensions 列表 — 把它当作"已经发现的维度",
  新的 dimensions 应优先复用 / 扩展已有维度,只在确实无法归入时才新增;
  newPapers 请确保每篇都至少进 1 个维度

【写作风格】
- 中文,术语首次出现可给中英对照(如"近端策略优化(PPO)")
- 简短信息密度优先,不要散文
- 直接陈述观点,不要"我们认为 / 总的来说"等套话`;

// ============================================================================
// 工具函数
// ============================================================================

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// 简单的 worker-pool 并发(限制同时在飞的 Promise 数)。
// items: 任务列表;limit: 并发上限;fn: 单个任务。
// onProgress(done) 在每个任务完成(成功或失败)后回调一次。
async function runConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
  onDoneItem?: (item: T, idx: number, result: R | null, error: Error | null) => void,
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
        const result = await fn(items[idx], idx);
        results[idx] = { item: items[idx], result };
        onDoneItem?.(items[idx], idx, result, null);
      } catch (e) {
        const err = e as Error;
        errors[idx] = { item: items[idx], error: err };
        onDoneItem?.(items[idx], idx, null, err);
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

async function decomposeIdea(idea: string, seeds?: SelectionItem[]): Promise<SubQ[]> {
  const cfg = loadSettings() as LLMConfig;
  let userPrompt = `研究思路:\n"""\n${idea.trim()}\n"""\n\n`;
  // 参考论文(若 selection 非空)拼成上下文。用户可能选 0 篇,这时逻辑与原版完全一致。
  if (seeds && seeds.length > 0) {
    // trunc 风格抄 exploreFromSeeds:每篇 500 字符上限,块与块之间空行
    const trunc = (v: string | undefined, max = 500): string => {
      const s = (v ?? '').trim();
      if (!s) return '';
      return s.length > max ? s.slice(0, max) + '…' : s;
    };
    const blocks: string[] = [];
    seeds.forEach((p, i) => {
      const lines: string[] = [];
      lines.push(`[参考论文 ${i + 1}] arXiv:${p.arxivId}`);
      lines.push(`标题: ${p.title}${p.title_zh ? ' / ' + p.title_zh : ''}`);
      if (p.tldr) lines.push(`TLDR: ${trunc(p.tldr)}`);
      if (p.motivation) lines.push(`动机: ${trunc(p.motivation)}`);
      if (p.method) lines.push(`方法: ${trunc(p.method)}`);
      if (p.result) lines.push(`结果: ${trunc(p.result)}`);
      if (p.conclusion) lines.push(`结论: ${trunc(p.conclusion)}`);
      if (p.tags && p.tags.length) lines.push(`标签: ${p.tags.join(', ')}`);
      blocks.push(lines.join('\n'));
    });
    const seedsBlock = blocks.join('\n\n');
    userPrompt +=
      `用户已选 ${seeds.length} 篇参考论文(用于迁移/借鉴,不限从中衍生):\n"""\n${seedsBlock}\n"""\n\n` +
      `请结合研究思路与参考论文,综合出 3-7 个可独立检索的子方向,允许「直接借鉴参考论文的方法路径」` +
      `与「主题在参考论文之外的新方向」并存。务必混合,不要只输出从参考论文衍生的方向。\n\n`;
  }
  userPrompt += `请输出 3-7 个可独立检索的子方向(严格 JSON 数组,不要其它文字):`;
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
  // 主题报告不需 rebuild,因为 report.relatedArxivIds 跟主题独立 — 用户重新点"📊
  // 生成报告"按钮就会按新的 summaries + 同样的 prevDimensions 重新生成。
  const hasSeeds = !!(seeds && seeds.length > 0);
  return arr.slice(0, 7).map((x: any, i: number) => {
    const rawQuery = String(x.query ?? '').trim();
    const cleaned = normalizeQuery(rawQuery);
    // aliases 白名单拷字段:每个元素去中文字符 + 仅保留 ASCII token。
    // 保证 searchForDirection 收到的是干净英文,避免主 query 已 0 命中、alias 又因
    // LLM 偶发混入中文/标点而白白浪费一次 arXiv 调用。
    const rawAliases = Array.isArray(x.aliases)
      ? x.aliases.map((a: any) => normalizeQuery(String(a ?? ''))).filter(Boolean)
      : [];
    const aliases: string[] = Array.from(new Set<string>(rawAliases)).filter((a) => a !== cleaned);
    return {
      id: uid('q'),
      label: String(x.label ?? `子方向 ${i + 1}`).slice(0, 60),
      query: cleaned || rawQuery, // 兜底清洗后为空就保留原文,仍交给用户手动改
      reason: String(x.reason ?? '').trim(),
      selected: true,
      source: hasSeeds ? ('manual-with-seeds' as const) : ('manual' as const),
      aliases,
    };
  }).filter((q: SubQ) => q.query);
}

// 基于已选论文生成"迁移/探索"子方向 — 复用 decomposeIdea 的重试/解析模式。
// 每个 direction 的 explorationType 决定 UI 上展示哪种迁移范式 badge。
export async function exploreFromSeeds(
  seeds: SelectionItem[],
  cfg: LLMConfig,
): Promise<SubQ[]> {
  // 过滤掉没有任何有用内容的条目(必须有 tldr 或 method 至少一个非空)
  const useful = seeds.filter((s) =>
    (s.tldr && s.tldr.trim()) || (s.method && s.method.trim()),
  );
  if (useful.length === 0) {
    throw new Error('已选论文都缺少 TLDR/方法摘要,无法生成迁移方向');
  }

  // 拼 seedContext — 每个论文一段,字段截到 500 字符避免 prompt 过长
  const trunc = (v: string | undefined, max = 500): string => {
    const s = (v ?? '').trim();
    if (!s) return '';
    return s.length > max ? s.slice(0, max) + '…' : s;
  };
  const blocks: string[] = [];
  useful.forEach((p, i) => {
    const lines: string[] = [];
    lines.push(`[论文 ${i + 1}] arXiv:${p.arxivId}`);
    lines.push(`标题: ${p.title}${p.title_zh ? ' / ' + p.title_zh : ''}`);
    if (p.tldr) lines.push(`TLDR: ${trunc(p.tldr)}`);
    if (p.motivation) lines.push(`动机: ${trunc(p.motivation)}`);
    if (p.method) lines.push(`方法: ${trunc(p.method)}`);
    if (p.result) lines.push(`结果: ${trunc(p.result)}`);
    if (p.conclusion) lines.push(`结论: ${trunc(p.conclusion)}`);
    if (p.tags && p.tags.length) lines.push(`标签: ${p.tags.join(', ')}`);
    blocks.push(lines.join('\n'));
  });
  const seedContext = blocks.join('\n\n');

  const userPrompt =
    `已选论文 (${useful.length} 篇):\n"""\n${seedContext}\n"""\n\n` +
    `请基于这些论文生成 4-6 个迁移/探索方向(严格 JSON 数组,不要其它文字):`;

  let raw = '';
  let arr: any[] = [];
  let attempt = 0;
  const MAX = 2;
  while (attempt < MAX) {
    attempt++;
    try {
      raw = await callLLMRaw(EXPLORE_FROM_SEEDS_SYSTEM, userPrompt, cfg, true);
    } catch (e) {
      if (attempt >= MAX) throw e;
      continue; // 网络/LLM 错误重试一次
    }
    try {
      arr = JSON.parse(raw);
    } catch {
      if (attempt >= MAX) {
        throw new Error(`迁移方向不是合法 JSON: ${raw.slice(0, 200)}`);
      }
      continue;
    }
    if (Array.isArray(arr) && arr.length > 0) break;
    // 空数组 → 提示用户换种子
    if (attempt >= MAX) {
      throw new Error('LLM 未返回任何迁移方向,试试换个论文组合或刷新后再试');
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  // 把 explorationType 限制在白名单内(LLM 偶尔会写错大小写或拼写)
  const ALLOWED_TYPES = new Set(['cross_domain', 'method_transfer', 'reverse', 'combination']);
  return arr.slice(0, 6).map((x: any, i: number) => {
    const rawQuery = String(x.query ?? '').trim();
    const cleaned = normalizeQuery(rawQuery);
    const rawType = String(x.explorationType ?? '').trim().toLowerCase();
    const explorationType = (ALLOWED_TYPES.has(rawType) ? rawType : undefined) as SubQ['explorationType'];
    const rawAliases = Array.isArray(x.aliases)
      ? x.aliases.map((a: any) => normalizeQuery(String(a ?? ''))).filter(Boolean)
      : [];
    const aliases: string[] = Array.from(new Set<string>(rawAliases)).filter((a) => a !== cleaned);
    return {
      id: uid('q'),
      label: String(x.label ?? `迁移方向 ${i + 1}`).slice(0, 60),
      query: cleaned || rawQuery,
      reason: String(x.reason ?? '').trim(),
      selected: true,
      source: 'seeds' as const,
      explorationType,
      aliases,
    };
  }).filter((q: SubQ) => q.query);
}

async function searchForDirection(subq: SubQ): Promise<Candidate[]> {
  // 主 query + aliases 多别名单跑,按 canonicalArxivId 合并去重。
  //
  // 为什么需要 aliases: arXiv all:"..." 是整短语精确匹配 — LLM 拆出来的 query 太
  // "学术短语化"(例如 "parameterized skill injection activation"),真实 arXiv
  // 论文几乎没人会在摘要里逐字写这种复合词,主 query 总是 0 命中。
  // aliases 是 LLM 同步产出的 3-5 个 arXiv 真实常见写法,逐个跑一遍能极大提高召回。
  //
  // 顺序:aliases 顺序由 LLM 产出顺序决定,主 query 命中的不参与排序(等同空);
  // 跨 alias 按 canonicalArxivId 去重,首次出现的 canonical id 占位(对应 alias
  // 顺序在先)。这样 UI 上能看到"哪一条 alias 拯救了命中"。
  //
  // 兜底:即使 UI 输入框被填了中文,这里也做一次清洗;如果洗不出任何英文 token
  // (整段中文),直接抛错让 doSearch 显示成"0 命中 + 重试"状态,而不是浪费一次请求。
  const cleaned = normalizeQuery(subq.query);
  const queryForArxiv = cleaned || subq.query.trim();
  const hasAscii = /[A-Za-z]/.test(queryForArxiv);
  if (!hasAscii) {
    throw new Error(`子方向 "${subq.label}" 的 query 不含英文,无法在 arXiv 搜索: ${subq.query}`);
  }

  // 构造别名列表 — 与主 query 互不重叠(已经在构造 SubQ 时 Set 去重一次了,这里
  // 再做一次兜底以防外部直接构造的 SubQ)。
  const rawAliases = (subq.aliases ?? [])
    .map((a) => normalizeQuery(a))
    .filter(Boolean);
  const queries = [queryForArxiv, ...rawAliases.filter((a) => a !== queryForArxiv)];

  // 单子方向内顺序跑别名 — arXiv 限速 1 req/s,避免 429。doSearch 顶层的
  // runConcurrent(SUMMARIZE_CONCURRENCY=2) 只管子方向之间并发,这里再串行
  // 避免同子方向内触发 arXiv 限速。
  const seen = new Set<string>();
  const merged: ArxivEntry[] = [];
  for (const q of queries) {
    let entries: ArxivEntry[] = [];
    try {
      entries = await searchArxiv(q, { dedupeLatestVersion: true, mode: 'all' });
    } catch (e) {
      // 单个别名出错时不让整个子方向 fail — 阶段 2 应该容忍个别失败,继续合并。
      // UI 上不会暴露这次失败(因为主 query 那次可能正常)。在控制台留 trace 即可。
      if (q === queryForArxiv) {
        // 主 query 失败:不可静默吞,向上抛错让 doSearch 显示。
        throw e;
      }
      console.warn(`[topic] alias "${q}" 检索失败,跳过:`, e);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    for (const e of entries) {
      const key = canonicalId(e.arxivId);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(e);
    }
    // 别名之间 sleep 1s 避免 arXiv 429
    if (q !== queries[queries.length - 1]) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const entries = merged;
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
    `结论: ${sum.summary.conclusion}\n` +
    (sum.summary.context ? `主题语境: ${sum.summary.context}\n` : '');

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
  renderStageInputSeedsBanner();
}

// 阶段 1 banner:当选了 N > 0 篇参考论文时显示,告诉用户这些论文会被拆解 prompt 看到。
function renderStageInputSeedsBanner(): void {
  const banner = document.getElementById('stage-input-seeds-banner');
  if (!banner) return;
  const countEl = document.getElementById('stage-input-seeds-count');
  const detailEl = document.getElementById('stage-input-seeds-detail');
  const seeds = loadSelection();
  if (seeds.length === 0) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  if (countEl) countEl.textContent = String(seeds.length);
  if (detailEl) {
    // 列首 3 篇标题,多则折叠 (+N)
    const display = seeds.slice(0, 3).map((s) => s.title).join(' · ');
    const more = seeds.length > 3 ? ` +${seeds.length - 3}` : '';
    detailEl.textContent = display ? `${display}${more}` : '';
  }
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
  list.innerHTML = current.subqs.map((q, i) => {
    const badgeHtml = q.explorationType
      ? `<span class="topic-subq-card-badge topic-subq-card-badge--${escapeHtml(q.explorationType)}" title="迁移范式:${escapeHtml(explorationTypeLabel(q.explorationType))}"><span class="topic-subq-card-badge-dot"></span>${escapeHtml(explorationTypeLabel(q.explorationType))}</span>`
      : '';
    const sourceTag =
      q.source === 'seeds'
        ? `<span class="topic-subq-card-source" title="从已选论文迁移探索">📚 来自已选论文</span>`
        : q.source === 'manual-with-seeds'
          ? `<span class="topic-subq-card-source topic-subq-card-source--seeds" title="拆解时同时参考了你在「添加参考论文」里选的论文">📚 参考论文+主题</span>`
          : '';
    return `
    <div class="topic-subq-card ${q.selected ? 'selected' : ''}" data-id="${q.id}">
      <input type="checkbox" class="topic-subq-check" ${q.selected ? 'checked' : ''} aria-label="勾选子方向 ${i + 1}" />
      <div class="topic-subq-card-main">
        <div class="topic-subq-card-row">
          <input type="text" class="label-input" value="${escapeHtml(q.label)}" data-field="label" placeholder="子方向标题" />
          ${badgeHtml}
          ${sourceTag}
          <div class="topic-subq-card-actions">
            <button type="button" class="topic-btn ghost" data-act="regen" title="重新生成此子方向">🔄</button>
            <button type="button" class="topic-btn ghost" data-act="del" title="删除此子方向">✕</button>
          </div>
        </div>
        <div class="topic-subq-card-row">
          <input type="text" class="query-input" value="${escapeHtml(q.query)}" data-field="query" placeholder="arXiv 检索 query(英文)" />
        </div>
        <div class="topic-subq-card-row">
          <input type="text" class="aliases-input" value="${escapeHtml((q.aliases ?? []).join(' '))}" data-field="aliases" placeholder="arXiv 别名(空格分隔,3-5 个真实常见写法)" aria-label="arXiv 别名" />
        </div>
        <textarea data-field="reason" placeholder="为什么这个子方向值得检索">${escapeHtml(q.reason)}</textarea>
      </div>
    </div>
  `;
  }).join('');

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
        const field = inp.dataset.field as 'label' | 'query' | 'reason' | 'aliases';
        if (field === 'aliases') {
          // 空格 / 逗号 / 多个空白都当分隔符,空字符串视为清空 aliases。
          const arr = inp.value
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          // 去空去重(避免用户键入空格导致重复)
          subq.aliases = Array.from(new Set(arr));
        } else {
          (subq as any)[field] = inp.value;
        }
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
          // 只替换这一个;aliases 沿用旧值(用户手动写的优先级 > LLM 一次性产出),
          // 如果新 LLM 输出有 aliases 而旧值为空,则填充。
          const replacement = newOne[0];
          subq.label = replacement.label;
          subq.query = replacement.query;
          subq.reason = replacement.reason;
          if ((!subq.aliases || subq.aliases.length === 0) && replacement.aliases) {
            subq.aliases = replacement.aliases;
          }
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

// explorationType → 中文显示名。给 renderSubqStage 用。
function explorationTypeLabel(t: SubQ['explorationType']): string {
  switch (t) {
    case 'cross_domain': return '跨域迁移';
    case 'method_transfer': return '方法借鉴';
    case 'reverse': return '反向工程';
    case 'combination': return '组合创新';
    default: return '';
  }
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
  // 渲染 seeds group(独立于子方向,带 [📚 参考论文] 徽章表示这是用户主动选的)
  const seedsRendered = renderSeedsCandidateGroup();
  wrap.innerHTML =
    current.subqs
      .filter((q) => current!.candidatesBySubq[q.id] !== undefined)
      .map((q) => renderCandidateGroupFor(q.id))
      .join('') + seedsRendered;

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

// 渲染一个子方向的候选 group(独立 helper 拆分出来,避免 renderCandStage 内联一个
// 超大 lambda + 嵌套 .map 触发 TS 类型推断错误:topic-candidate-item--seed 的 seed
// group 视觉差异化在此 path 上做不出来,所以独立 helper 拆出来)
function renderCandidateGroupFor(subqId: string): string {
  const allList = current!.candidatesBySubq[subqId] || [];
  const hidden = new Set(loadHiddenPapers());
  const list = allList.filter((c) => !hidden.has(c.arxivId));
  const grpSelected = list.filter((c) => c.selected).length;
  const subq = current!.subqs.find((q) => q.id === subqId);
  const label = subq?.label ?? subqId;
  // 让用户能看出"是哪个 query / alias 拯救了命中"。aliases 留空或主 query 没
  // 别名时仅展示 query,保持视觉简洁。
  const queryLine = subq && (subq.query || (subq.aliases ?? []).length > 0)
    ? `<div class="topic-candidate-group-query">
        query: <code>${escapeHtml(subq.query || '')}</code>${
          (subq.aliases ?? []).length > 0
            ? ` <span class="topic-candidate-group-aliases">· 别名: ${subq.aliases!.map((a) => escapeHtml(a)).join(', ')}</span>`
            : ''
        }
      </div>`
    : '';
  const emptyHint = list.length === 0 && allList.length > 0
    ? `<div style="padding:0.7rem 0.9rem;color:var(--fg-subtle);font-size:0.85rem">该子方向下 ${allList.length} 篇候选全部被隐藏。可在 设置页"已隐藏论文"面板 恢复。</div>`
    : list.length === 0
      ? `<div style="padding:0.7rem 0.9rem;color:var(--fg-subtle);font-size:0.85rem">未命中任何论文。可能是 query 太冷门,试试改 query 或换个角度重检索。</div>`
      : '';
  const metaHtml = list.length === 0
    ? `0 命中${allList.length > 0 ? ` (${allList.length} 篇已隐藏)` : ''}`
    : `${grpSelected}/${list.length} 已选 · <a href="#" data-act="toggle-all">${grpSelected === list.length ? '全不选' : '全选'}</a>`;
  const itemsHtml = list.map((c) => `
            <div class="topic-candidate-item ${c.selected ? 'selected' : ''}" data-arxiv="${escapeHtml(c.arxivId)}">
              <input type="checkbox" ${c.selected ? 'checked' : ''} aria-label="勾选论文 ${escapeHtml(c.entry.title)}" />
              <div class="topic-candidate-main">
                <div class="topic-candidate-title">${escapeHtml(c.entry.title)}</div>
                <div class="topic-candidate-meta">arXiv:${escapeHtml(c.arxivId)} · ${escapeHtml((c.entry.published || '').slice(0, 10))} · ${c.entry.authors.length} 位作者</div>
                <div class="topic-candidate-summary">${escapeHtml(c.entry.summary)}</div>
              </div>
              <div></div>
            </div>
          `).join('');
  return `
    <div class="topic-candidate-group" data-subq="${subqId}">
      <div class="topic-candidate-group-header" data-act="toggle-grp">
        <div class="topic-candidate-group-title">📂 ${escapeHtml(label)}</div>
        <div class="topic-candidate-group-meta">${metaHtml}</div>
      </div>
      ${queryLine}
      ${list.length === 0 ? emptyHint : `<div class="topic-candidate-list">${itemsHtml}</div>`}
    </div>`;
}

// 渲染"📚 参考论文"group(用户在 modal 加的论文),带 [📚 你选的] 徽章
function renderSeedsCandidateGroup(): string {
  const list = current!.candidatesBySubq['__seeds__'] || [];
  if (list.length === 0) return '';
  const hidden = new Set(loadHiddenPapers());
  const visList = list.filter((c) => !hidden.has(c.arxivId));
  if (visList.length === 0) return '';
  const sel = visList.filter((c) => c.selected).length;
  const itemsHtml = visList.map((c) => `
            <div class="topic-candidate-item ${c.selected ? 'selected topic-candidate-item--seed' : 'topic-candidate-item--seed'}" data-arxiv="${escapeHtml(c.arxivId)}">
              <input type="checkbox" ${c.selected ? 'checked' : ''} aria-label="勾选论文 ${escapeHtml(c.entry.title)}" />
              <div class="topic-candidate-main">
                <div class="topic-candidate-title">${escapeHtml(c.entry.title)}</div>
                <div class="topic-candidate-meta">arXiv:${escapeHtml(c.arxivId)} <span class="topic-candidate-seed-tag">📚 你选的</span></div>
                <div class="topic-candidate-summary">${escapeHtml(c.entry.summary)}</div>
              </div>
            </div>
          `).join('');
  return `
    <div class="topic-candidate-group topic-candidate-group--seeds" data-subq="__seeds__">
      <div class="topic-candidate-group-header" data-act="toggle-grp">
        <div class="topic-candidate-group-title">
          <span class="topic-candidate-group-badge topic-candidate-group-badge--seeds" title="你在「添加参考论文」里选的论文">📚 参考论文</span>
        </div>
        <div class="topic-candidate-group-meta">${sel}/${visList.length} 已选 · <a href="#" data-act="toggle-all">${sel === visList.length ? '全不选' : '全选'}</a></div>
      </div>
      <div class="topic-candidate-list">${itemsHtml}</div>
    </div>`;
}

function renderSummaryStage(): void {
  const list = $('summary-list');
  const meta = $('summ-meta');
  if (!current || current.summaries.length === 0) {
    list.innerHTML = '<div style="color:var(--fg-subtle);font-size:0.88rem">尚未总结 — 在第 3 步勾选论文后点"🚀 总结选中论文"。</div>';
    meta.textContent = '尚未总结';
    return;
  }
  const hiddenSet = new Set(loadHiddenPapers());
  const visibleSummaries = current.summaries.filter((s) => !hiddenSet.has(s.arxivId));
  meta.textContent = `已总结 ${current.summaries.length} 篇${
    visibleSummaries.length < current.summaries.length ? ` (${current.summaries.length - visibleSummaries.length} 篇已隐藏)` : ''
  }`;
  if (visibleSummaries.length === 0) {
    list.innerHTML = '<div style="color:var(--fg-subtle);font-size:0.88rem">已总结的论文全部被隐藏。可在 设置页"已隐藏论文"面板 恢复。</div>';
    return;
  }
  list.innerHTML = visibleSummaries.map((s) => {
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
          ${r.context ? `<div class="topic-summary-context"><div class="topic-summary-context-label">主题语境</div><div class="topic-summary-context-text">${escapeHtml(r.context)}</div></div>` : ''}
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

// ============================================================================
// 阶段 5:主题报告渲染
// ============================================================================

function renderReportToHTML(r: TopicReport, referenceSeeds?: SelectionItem[]): string {
  const dimsHTML = r.dimensions
    .map(
      (d) => `
    <details class="topic-report-dim" open>
      <summary class="topic-report-dim-header">
        <strong>${escapeHtml(d.name)}</strong>
        <span class="topic-report-dim-count">${d.papers.length} 篇</span>
      </summary>
      ${d.description ? `<div class="topic-report-dim-desc">${escapeHtml(d.description)}</div>` : ''}
      <ul class="topic-report-dim-papers">
        ${d.papers
          .map(
            (p) => `
          <li>
            <a href="/papers/${encodeURIComponent(p.arxivId)}/" class="topic-link" target="_blank" rel="noopener">arXiv:${escapeHtml(p.arxivId)}</a>
            <span class="topic-report-dim-role">${escapeHtml(p.role)}</span>
            — ${escapeHtml(p.key)}
            ${p.method ? `<div class="topic-report-dim-meta">方法: ${escapeHtml(p.method)}</div>` : ''}
            ${p.result ? `<div class="topic-report-dim-meta">结果: ${escapeHtml(p.result)}</div>` : ''}
            ${p.note ? `<div class="topic-report-dim-meta">注: ${escapeHtml(p.note)}</div>` : ''}
          </li>`,
          )
          .join('')}
      </ul>
    </details>`,
    )
    .join('');
  const section = (title: string, items: string[]): string =>
    !items.length
      ? ''
      : `<section class="topic-report-section"><h3>${escapeHtml(title)}</h3><ul>${items
          .map((s) => `<li>${escapeHtml(s)}</li>`)
          .join('')}</ul></section>`;
  // 用户在 modal 主动选的参考论文 — 在主题总览之前独立罗列,只做索引层(不参与
  // LLM 报告归纳),让用户清楚"这 N 篇是参考论文,主题报告基于 arXiv 搜 + 这 N 篇"
  const seedsHTML = referenceSeeds && referenceSeeds.length > 0
    ? `<section class="topic-report-seeds">
        <h3>📚 参考论文 (${referenceSeeds.length})</h3>
        <ul class="topic-report-seeds-list">
          ${referenceSeeds
            .map(
              (s) => `<li>
                <a href="/papers/${encodeURIComponent(s.arxivId)}/" target="_blank" rel="noopener">arXiv:${escapeHtml(s.arxivId)}</a>
                — ${escapeHtml(s.title)}
                ${s.tldr ? `<div style="color:var(--fg-subtle);font-size:0.85rem;margin-top:0.2rem">${escapeHtml(s.tldr.slice(0, 220))}${s.tldr.length > 220 ? '…' : ''}</div>` : ''}
              </li>`,
            )
            .join('')}
        </ul>
      </section>`
    : '';
  return `
    ${seedsHTML}
    <section class="topic-report-section">
      <h3>主题总览</h3>
      <p>${escapeHtml(r.overview).replace(/\n/g, '<br>')}</p>
    </section>
    <section class="topic-report-section">
      <h3>论文横向对比</h3>
      ${dimsHTML}
    </section>
    ${section('共同发现', r.sharedFindings)}
    ${section('研究空白', r.gaps)}
    ${section('下一步建议', r.nextSteps)}
  `;
}

function renderReportStage(): void {
  const meta = $('report-meta');
  const out = $('report-output');
  const genBtn = $<HTMLButtonElement>('report-gen-btn');
  const copyBtn = $<HTMLButtonElement>('report-copy-btn');
  const n = current?.summaries.length ?? 0;
  if (!current || n === 0) {
    meta.textContent = '需要先有至少 1 篇速览';
    genBtn.disabled = true;
    copyBtn.disabled = true;
    out.innerHTML = '<div class="topic-empty">尚未总结 — 在第 4 步完成速览后再来生成报告。</div>';
    return;
  }
  genBtn.disabled = false;
  if (!current.report) {
    meta.textContent = '尚未生成';
    copyBtn.disabled = true;
    out.innerHTML = `<div class="topic-empty">点击"📊 生成报告"开始基于 ${n} 篇速览整合主题报告。</div>`;
    return;
  }
  const r = current.report;
  const incNote = r.incrementallyAddedArxivIds?.length
    ? ` · 本次 +${r.incrementallyAddedArxivIds.length}`
    : '';
  // 从 selection 过滤出当前会话 referenceSeedArxivIds 包含的论文,作为报告里
  // "参考论文" group 的输入(用户在 modal 主动选的,不被 LLM 归纳)
  const refIds = new Set(current.referenceSeedArxivIds ?? []);
  const refSeeds = refIds.size > 0 ? loadSelection().filter((s) => refIds.has(canonicalId(s.arxivId))) : [];
  const refNote = refSeeds.length > 0 ? ` · ${refSeeds.length} 篇参考论文` : '';
  meta.textContent = `已生成 · ${r.dimensions.length} 个维度 · ${r.relatedArxivIds.length} 篇${incNote}${refNote}`;
  copyBtn.disabled = false;
  out.innerHTML = renderReportToHTML(r, refSeeds);
}

function renderAll(): void {
  renderSessionMeta();
  renderInputStage();
  renderSubqStage();
  renderCandStage();
  renderSummaryStage();
  renderReportStage();
  updateSeedsCounter();
}

// ============================================================================
// 阶段动作(用户触发)
// ============================================================================

async function doGenerateReport(): Promise<void> {
  if (!current) return;
  if (current.summaries.length === 0) {
    setStatus('需要至少 1 篇速览笔记才能生成报告', 'error');
    return;
  }
  const cfg = loadSettings() as LLMConfig;
  if (!cfg.apiKey) {
    renderBanner('请先在 <a href="/settings/">设置</a> 页面填 LLM API Key。');
    return;
  }
  clearBanner();
  ($<HTMLButtonElement>('report-gen-btn')).disabled = true;
  ($('stage-report') as HTMLDetailsElement).open = true;
  inFlightController = new AbortController();
  const n = current.summaries.length;
  setStatus(`📊 正在为 ${n} 篇论文生成主题报告...`);
  try {
    const report = await generateTopicReport(
      current.topic,
      current.summaries,
      cfg,
      current.report ? 'incremental' : 'full',
      current.report,
    );
    current.report = report;
    renderReportStage();
    persistSession(current!);
    setStatus(
      `✓ 报告完成: ${report.dimensions.length} 个维度 · ${report.relatedArxivIds.length} 篇论文`,
    );
    setTimeout(clearStatus, 2000);
  } catch (e) {
    setStatusErrorWithAction(`生成报告失败: ${(e as Error).message}`, '🔄 重试', () => doGenerateReport());
  } finally {
    ($<HTMLButtonElement>('report-gen-btn')).disabled = false;
    inFlightController = null;
  }
}

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
    // 用户在 modal 里选的论文一并喂给 LLM(同时支持 ?from=selection 入口,会
    // 跳过手动 textarea 走 doExploreFromSeeds 单独路径,这里不会与它冲突)。
    const seeds = loadSelection();
    const subqs = await decomposeIdea(idea, seeds);
    current.topic = idea;
    current.subqs = subqs;
    // 记录拆解时参考了的论文 ID(用于阶段 5 报告剔除重复时参考,以及
    // UI 提示"这些论文作为前提"),不参与后续逻辑判定。
    current.referenceSeedArxivIds = seeds.map((s) => canonicalId(s.arxivId));
    // 清掉旧的候选/总结(主题变了)
    current.candidatesBySubq = {};
    current.summaries = [];
    current.chats = {};
    // 主题报告也跟着清:旧报告基于上一次的总结,但主题/参考论文变了,旧报告过期
    current.report = undefined;
    ($('stage-subqs') as HTMLDetailsElement).open = true;
    renderAll();
    persistSession(current!);
    const seedNote = seeds.length > 0 ? ` · 已参考 ${seeds.length} 篇已选论文` : '';
    setStatus(`✓ 已拆解为 ${subqs.length} 个子方向${seedNote}`);
    setTimeout(clearStatus, 2000);
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
  // 把当前会话里用户主动选的"参考论文"作为虚拟候选注入到 candidatesBySubq['__seeds__']
  // — 用户手动从 modal 加进来的论文,默认勾上,渲染时打 [📚 参考论文] 徽章,
  // 最终进入阶段 4 总结 + 阶段 5 报告。用 '__seeds__' 当 key 区分于子方向 group,
  // 阶段 4 在 doSummarize 选 candidates 时也读取。
  if (current.referenceSeedArxivIds && current.referenceSeedArxivIds.length > 0) {
    const seeds = loadSelection();
    const seedCands: Candidate[] = seeds
      .filter((s) => current!.referenceSeedArxivIds!.includes(canonicalId(s.arxivId)))
      .map((s) => {
        // 构造一个虚拟 ArxivEntry。论文库里的 SelectionItem 是带 selection
        // 摘要的; arXiv API 那条代码路径走 fetchArxivPdf + callLLM(SYSTEM_PROMPT
        // 单篇 prompt), entry 字段至少要 arxivId / title / summary 齐全。
        const summary =
          [s.method, s.result].filter(Boolean).join('\n').trim() ||
          s.tldr ||
          '(参考论文无摘要,只能基于标题与 TLDR 总结)';
        const entry: ArxivEntry = {
          id: `https://arxiv.org/abs/${s.arxivId}`,
          arxivId: s.arxivId,
          title: s.title,
          authors: [],
          summary,
          published: '',
          updated: '',
          pdfUrl: `https://arxiv.org/pdf/${s.arxivId}.pdf`,
        };
        return { arxivId: s.arxivId, entry, selected: true };
      });
    current.candidatesBySubq['__seeds__'] = seedCands;
    // seeds 默认选上后, 用户可以手动取消勾选(走与 arXiv 候选一样的 UI)
    // 这里注意 selected 已经设 true, 后面用户改 UI 会改同一个 selected
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
    async ({ cand, subqId }) => summarizeOne(cand.entry, subqId),
    (d, total) => {
      setStatus(`🚀 总结中 ${d}/${total} ...`);
      renderSummaryStage();
      renderSessionMeta();
      persistSession(current!);
    },
    (_item, _idx, sum, err) => {
      // 每篇一完成即 push + 触发可能的增量报告草稿
      if (sum && current) {
        current.summaries.push(sum);
        renderSummaryStage();
        renderSessionMeta();
        persistSession(current!);
        renderReportStage(); // 阶段 5 meta 计数会更新
        if (incrementalReportEnabled() && current.report) {
          void triggerIncrementalReportDraft(current);
        }
      } else if (err) {
        // 单篇失败不阻塞其他;但保留总数可见
        console.warn('[topic] summarize failed:', err.message);
      }
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

// ============================================================================
// 主题报告(阶段 5):topic + 已总结论文 → 结构化中文报告
// ============================================================================

// 把字符串截到 max 字符,空值返回空串。复用 exploreFromSeeds 的 trunc 风格(topic-search.ts:480)。
function truncReport(s: string | undefined, max: number): string {
  const v = (s ?? '').trim();
  if (!v) return '';
  return v.length > max ? v.slice(0, max) + '…' : v;
}

// 手工规范化 LLM 输出的报告。失败边界都兜底成空串。
function normalizeReportTopic(obj: any, prev: TopicReport | undefined, mode: 'full' | 'incremental'): TopicReport | null {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.dimensions)) return null;
  const normDim = (d: any): TopicReportDimension | null => {
    const name = String(d?.name ?? '').trim().slice(0, 30);
    if (!name) return null;
    const papers: TopicReportDimensionPaper[] = [];
    if (Array.isArray(d?.papers)) {
      for (const p of d.papers) {
        const id = canonicalId(String(p?.arxivId ?? '').trim());
        const key = truncReport(p?.key, 120);
        if (!id || !key) continue;
        const role = truncReport(p?.role, 24) || '相关';
        papers.push({
          arxivId: id,
          role,
          key,
          method: p?.method ? truncReport(p.method, 120) : undefined,
          result: p?.result ? truncReport(p.result, 120) : undefined,
          note: p?.note ? truncReport(p.note, 120) : undefined,
        });
      }
    }
    if (papers.length === 0) return null;
    return {
      name,
      description: d?.description ? truncReport(d.description, 160) : undefined,
      papers,
    };
  };
  const dims: TopicReportDimension[] = [];
  for (const d of obj.dimensions.slice(0, 6)) {
    const n = normDim(d);
    if (n) dims.push(n);
  }
  if (dims.length === 0) return null;
  const arrOf = (k: string, max: number): string[] => {
    if (!Array.isArray(obj[k])) return [];
    const out: string[] = [];
    for (const s of obj[k]) {
      if (typeof s !== 'string') continue;
      const t = truncReport(s, 120);
      if (t) out.push(t);
      if (out.length >= max) break;
    }
    return out;
  };
  const relatedSet = new Set<string>();
  for (const d of dims) for (const p of d.papers) relatedSet.add(p.arxivId);
  const related: string[] = [...relatedSet];
  const prevIds = new Set(prev?.relatedArxivIds ?? []);
  return {
    overview: truncReport(obj.overview, 800) || '(未生成总览)',
    dimensions: dims,
    sharedFindings: arrOf('sharedFindings', 8),
    gaps: arrOf('gaps', 6),
    nextSteps: arrOf('nextSteps', 6),
    generatedAt: Date.now(),
    relatedArxivIds: related,
    incrementallyAddedArxivIds:
      mode === 'incremental' ? related.filter((id) => !prevIds.has(id)) : undefined,
  };
}

async function generateTopicReport(
  topic: string,
  summaries: Summary[],
  cfg: LLMConfig,
  mode: 'full' | 'incremental',
  prev?: TopicReport,
): Promise<TopicReport> {
  if (summaries.length === 0) {
    throw new Error('需要至少 1 篇已总结论文才能生成报告');
  }

  // 每篇拼块,字段截断 600 防 prompt 过长。
  const blocks: string[] = [];
  summaries.forEach((s, i) => {
    const r = s.summary;
    const lines: string[] = [`[论文 ${i + 1}] arXiv:${s.arxivId}`];
    if (r.title) lines.push(`标题: ${r.title}${r.title_en ? ' / ' + r.title_en : ''}`);
    lines.push(`TLDR: ${truncReport(r.tldr, 600)}`);
    if (r.motivation) lines.push(`动机: ${truncReport(r.motivation, 600)}`);
    if (r.method) lines.push(`方法: ${truncReport(r.method, 600)}`);
    if (r.result) lines.push(`结果: ${truncReport(r.result, 600)}`);
    if (r.conclusion) lines.push(`结论: ${truncReport(r.conclusion, 600)}`);
    if (r.context) lines.push(`主题语境: ${truncReport(r.context, 600)}`);
    blocks.push(lines.join('\n'));
  });
  const papersContext = blocks.join('\n\n');

  let incrementalSection = '';
  if (mode === 'incremental' && prev) {
    const prevDims = prev.dimensions
      .map((d) => `  - ${d.name}: ${d.description ?? '(无描述)'} (含 ${d.papers.length} 篇)`)
      .join('\n');
    incrementalSection =
      `\n\n【增量模式】本会话之前已经基于 ${prev.relatedArxivIds.length} 篇论文生成过报告;` +
      `当前再整合全部 ${summaries.length} 篇。请复用 / 扩展 prevDimensions,只在确实无法归入时才新增维度。\n\n` +
      `prevDimensions:\n${prevDims}\n`;
  }

  const userPrompt =
    `研究主题: ${topic}\n\n` +
    `论文速览 (${summaries.length} 篇):\n"""\n${papersContext}\n"""` +
    incrementalSection +
    `\n请输出 JSON 对象,字段严格遵循 system prompt 定义:`;

  // 2 次重试,网络/LLM 报错和 JSON 解析失败都重试一次(沿用 exploreFromSeeds 模式)
  let lastErr = '';
  for (let attempt = 1; attempt <= REPORT_LLM_RETRY; attempt++) {
    try {
      const raw = await callLLMRaw(TOPIC_REPORT_SYSTEM, userPrompt, cfg, true);
      try {
        const obj = JSON.parse(raw);
        const report = normalizeReportTopic(obj, prev, mode);
        if (report) return report;
        lastErr = '维度数组为空';
      } catch (e) {
        lastErr = `JSON 解析失败: ${(e as Error).message}`;
      }
    } catch (e) {
      lastErr = (e as Error).message;
    }
    if (attempt < REPORT_LLM_RETRY) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`主题报告生成失败 (${lastErr || '未知原因'})`);
}

function incrementalReportEnabled(): boolean {
  const cb = document.getElementById('report-incremental-toggle') as HTMLInputElement | null;
  return !!cb?.checked;
}

// 增量追加入口。同 session 内 8 秒最多触发 1 次,防止 N 篇并发完成时连环 LLM 调用。
async function triggerIncrementalReportDraft(s: TopicSession): Promise<void> {
  if (!s.report || s.summaries.length === 0) return;
  const incKey = '__reportIncLastTs__';
  const last = (s as unknown as Record<string, number>)[incKey] ?? 0;
  const now = Date.now();
  if (now - last < REPORT_INC_THROTTLE_MS) return;
  (s as unknown as Record<string, number>)[incKey] = now;
  try {
    const cfg = loadSettings() as LLMConfig;
    if (!cfg.apiKey) return;
    setStatus(`📊 正在增量更新报告(共 ${s.summaries.length} 篇)...`);
    const newReport = await generateTopicReport(s.topic, s.summaries, cfg, 'incremental', s.report);
    s.report = newReport;
    renderReportStage();
    persistSession(s);
    setStatus(`✓ 报告已增量更新 · ${newReport.dimensions.length} 个维度`);
    setTimeout(clearStatus, 2000);
  } catch (e) {
    // 增量失败静默 — 不要打断总结流程
    console.warn('[topic] incremental report draft failed:', (e as Error).message);
    clearStatus();
  }
}

function copyReportAsMarkdown(): void {
  if (!current?.report) return;
  const r = current.report;
  const lines: string[] = [];
  lines.push(`# 主题报告: ${current.topic || '(主题探索)'}`);
  lines.push('');
  lines.push(
    `> 生成于 ${new Date(r.generatedAt).toLocaleString()} · 整合 ${r.relatedArxivIds.length} 篇论文` +
      (r.incrementallyAddedArxivIds && r.incrementallyAddedArxivIds.length
        ? ` · 本次新增 ${r.incrementallyAddedArxivIds.length} 篇`
        : ''),
  );
  lines.push('');
  lines.push('## 主题总览');
  lines.push(r.overview);
  lines.push('');
  lines.push('## 论文横向对比');
  r.dimensions.forEach((d) => {
    lines.push(`### ${d.name}`);
    if (d.description) lines.push(`*${d.description}*`);
    lines.push('');
    d.papers.forEach((p) => {
      lines.push(`- **arXiv:${p.arxivId}** — *${p.role}* — ${p.key}`);
      if (p.method) lines.push(`  - 方法: ${p.method}`);
      if (p.result) lines.push(`  - 结果: ${p.result}`);
      if (p.note) lines.push(`  - 注: ${p.note}`);
    });
    lines.push('');
  });
  if (r.sharedFindings.length) {
    lines.push('## 共同发现');
    r.sharedFindings.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  if (r.gaps.length) {
    lines.push('## 研究空白');
    r.gaps.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  if (r.nextSteps.length) {
    lines.push('## 下一步建议');
    r.nextSteps.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  navigator.clipboard.writeText(lines.join('\n')).then(
    () => setStatus('✓ 报告已复制为 Markdown'),
    () => setStatus('复制失败,请手动选择', 'error'),
  );
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
    if (s.summary.context) lines.push(`\n**主题语境**: ${s.summary.context}`);
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
// 基于已选论文(seed papers)的迁移探索 — 由 ?from=selection URL 触发入口
// ============================================================================

// 注入"📚 基于已选 N 篇论文探索"卡片到 #seeds-pill-slot(#stage-input 之前)
function renderSeedsPill(seeds: SelectionItem[]): void {
  const slot = document.getElementById('seeds-pill-slot');
  if (!slot || seeds.length === 0) return;
  slot.innerHTML = `
    <div class="seeds-pill" id="seeds-pill">
      <div class="seeds-pill-icon">📚</div>
      <div class="seeds-pill-body">
        <div class="seeds-pill-title">基于已选 ${seeds.length} 篇论文探索</div>
        <div class="seeds-pill-desc">跳过手动输入思路,模型会读取每篇的 TLDR/方法/结果,生成 4-6 个迁移/探索方向(跨域迁移 / 方法借鉴 / 反向工程 / 组合创新)。</div>
      </div>
      <button type="button" class="topic-btn primary seeds-pill-btn" id="seeds-explore-btn">🚀 开始迁移探索</button>
    </div>
  `;
  document.getElementById('seeds-explore-btn')?.addEventListener('click', () => doExploreFromSeeds());
}

// 隐藏"来自已选论文"入口卡片(在迁移探索完成后调用,避免重复触发)
function hideSeedsPill(): void {
  const slot = document.getElementById('seeds-pill-slot');
  if (slot) slot.innerHTML = '';
}

async function doExploreFromSeeds(): Promise<void> {
  const seeds = loadSelection();
  if (seeds.length === 0) {
    setStatus('已选论文为空,请先在论文详情页加入选集', 'error');
    return;
  }
  const cfg = loadSettings() as LLMConfig;
  if (!cfg.apiKey) {
    renderBanner('请先在 <a href="/settings/">设置</a> 页面填 LLM API Key。');
    return;
  }

  // 当前会话已经有内容 → 二次确认(沿用 startNewSession 的提示风格)
  if (current && (current.subqs.length > 0 || current.summaries.length > 0)) {
    if (!confirm(`开始迁移探索会清空当前会话的 ${current.subqs.length} 个子方向和 ${current.summaries.length} 篇已总结论文,确定吗?`)) {
      return;
    }
  }

  // 创建全新会话(不弹 startNewSession 的 confirm,因为上面已经问过了)
  if (current) deleteSession(current);
  current = {
    id: uid('ts'),
    topic: `基于 ${seeds.length} 篇已选论文的迁移探索`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    subqs: [],
    candidatesBySubq: {},
    summaries: [],
    chats: {},
  };
  {
    const store2 = loadStore();
    store2.currentId = current.id;
    store2.sessions[current.id] = current;
    saveStore(store2);
  }
  // 把 textarea 同步成新 topic(给用户反馈)
  const ta = $<HTMLTextAreaElement>('topic-input');
  ta.value = current.topic;
  ($<HTMLButtonElement>('decompose-btn')).disabled = true;

  hideSeedsPill();
  clearBanner();
  inFlightController = new AbortController();
  setStatus(`🌱 基于 ${seeds.length} 篇已选论文生成迁移方向...`);

  try {
    const subqs = await exploreFromSeeds(seeds, cfg);
    if (subqs.length === 0) {
      throw new Error('LLM 未返回任何迁移方向');
    }
    current.subqs = subqs;
    ($('stage-subqs') as HTMLDetailsElement).open = true;
    renderAll();
    persistSession(current!);
    setStatus(`✓ 已生成 ${subqs.length} 个迁移方向,勾选后搜索 arXiv`);
    setTimeout(clearStatus, 2000);
  } catch (e) {
    setStatusErrorWithAction(`迁移探索失败: ${(e as Error).message}`, '🔄 重试', () => doExploreFromSeeds());
  } finally {
    inFlightController = null;
  }
}

// ============================================================================
// Modal 状态:📚 添加参考论文
// ============================================================================

let modalOpen = false;

function openAddSeedsModal(): void {
  const modal = document.getElementById('add-seeds-modal');
  if (!modal) return;
  renderAddSeedsModalList();
  // 不清空搜索框 / 不重置结果区 — 用户上次关 modal 时的状态保持,除非他手动输入
  modal.classList.remove('topic-hidden');
  modalOpen = true;
  document.getElementById('add-seeds-search-input')?.focus();
}

function closeAddSeedsModal(): void {
  const modal = document.getElementById('add-seeds-modal');
  if (!modal) return;
  modal.classList.add('topic-hidden');
  modalOpen = false;
}

function renderAddSeedsModalList(): void {
  const wrap = document.getElementById('add-seeds-list');
  if (!wrap) return;
  const items = loadSelection();
  if (items.length === 0) {
    wrap.innerHTML =
      '<div class="topic-modal-empty">还没有参考论文 — 上方输入论文标题搜索,或展开「已知 arXiv ID」直接添加。</div>';
    return;
  }
  wrap.innerHTML = items
    .map(
      (it) => `
    <div class="topic-modal-list-item" data-arxiv="${escapeHtml(it.arxivId)}">
      <span class="topic-modal-list-badge">已加入</span>
      <a href="/papers/${encodeURIComponent(it.arxivId)}/" target="_blank" rel="noopener" class="topic-link topic-modal-list-id">
        arXiv:${escapeHtml(it.arxivId)}
      </a>
      <span class="topic-modal-list-title">${escapeHtml(it.title)}</span>
      <button type="button" class="topic-btn ghost topic-modal-list-remove" data-act="remove" title="从参考列表移除">✕</button>
    </div>`,
    )
    .join('');
  wrap.querySelectorAll<HTMLElement>('.topic-modal-list-item').forEach((row) => {
    const ax = row.dataset.arxiv!;
    row.querySelector<HTMLButtonElement>('[data-act="remove"]')!.addEventListener('click', () => {
      removeFromSelection(ax);
    });
  });
}

function updateSeedsCounter(): void {
  const chip = document.getElementById('seeds-counter-chip');
  const nEl = document.getElementById('seeds-counter-n');
  if (!chip || !nEl) return;
  const n = loadSelection().length;
  nEl.textContent = String(n);
  chip.hidden = n === 0;
  const modalCount = document.getElementById('add-seeds-count');
  if (modalCount) modalCount.textContent = String(n);
  // 阶段 1 banner 也要随 selection 变化(增/减论文都该立刻反映)
  renderStageInputSeedsBanner();
}

async function submitAddSeedsUrl(_form: HTMLFormElement): Promise<void> {
  const input = document.getElementById('add-seeds-url-input') as HTMLInputElement | null;
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) {
    input.focus();
    return;
  }
  const m = raw.match(/(\d{4}\.\d{4,5})(v\d+)?/);
  if (!m) {
    setStatus(`无法从 "${raw}" 识别 arXiv ID`, 'error');
    return;
  }
  try {
    setStatus(`📥 正在获取 arXiv:${m[1]} 的元数据...`);
    const entries = await searchArxivById(m[1]);
    if (!entries.length) throw new Error('未找到该论文');
    const e = entries[0];
    // 用 arXiv abstract 作为 tldr 占位 — exploreFromSeeds 的 useful filter
    // 会因 method 缺失而跳过,所以"从 URL 加"只适合作为显示/复制种子,
    // 想用作迁移探索种子请从论文库选。
    addToSelection({
      arxivId: e.arxivId,
      title: e.title,
      tldr: e.summary.slice(0, 400),
      method: '',
      result: '',
      tags: [],
      addedAt: Date.now(),
    });
    input.value = '';
    setStatus(`✓ 已加入 arXiv:${e.arxivId}`);
    setTimeout(clearStatus, 1500);
  } catch (err) {
    setStatus(`获取失败: ${(err as Error).message}`, 'error');
  }
}

// ============================================================================
// 标题搜索:联网 arXiv,debounce + 结果渲染
// ============================================================================

// 复用 paper-analyzer.ts 已 export 的 searchArxiv(mode: 'title' 默认就是标题语义)。
// 前端再叠一层简单的 token 排序:标题真的命中查询 token 的条目排前面。
function rankArxivResults(entries: ArxivEntry[], query: string): ArxivEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const score = (e: ArxivEntry): number => {
    const t = e.title.toLowerCase();
    let s = 0;
    for (const tok of tokens) {
      if (t.includes(tok)) s += 10;
      if (t.startsWith(tok)) s += 5;
      if (e.summary.toLowerCase().includes(tok)) s += 1;
    }
    return s;
  };
  return [...entries].sort((a, b) => score(b) - score(a));
}

let arxivSearchAbort: AbortController | null = null;
let arxivSearchSeq = 0; // 竞态:只保留最后一次的结果,旧的渲染请求全部丢弃

async function searchArxivByTitle(query: string): Promise<ArxivEntry[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  if (arxivSearchAbort) arxivSearchAbort.abort();
  arxivSearchAbort = new AbortController();
  const seq = ++arxivSearchSeq;
  try {
    // paper-analyzer.ts 已 export searchArxiv(query, { mode: 'title' }),默认就是 ti: 语义
    const entries = await searchArxiv(q, { dedupeLatestVersion: true });
    if (seq !== arxivSearchSeq) return []; // 用户已经输入了更新的 query,丢掉
    return rankArxivResults(entries, q);
  } catch (e) {
    if ((e as Error).name === 'AbortError') return [];
    throw e;
  }
}

function renderArxivSearchResults(entries: ArxivEntry[]): void {
  const wrap = document.getElementById('add-seeds-search-results');
  if (!wrap) return;
  if (!entries.length) {
    wrap.innerHTML =
      '<div class="topic-modal-search-empty">未命中 — 试试更短的关键词、英文术语、或下方的「已知 arXiv ID」直接添加。</div>';
    return;
  }
  wrap.innerHTML = entries
    .slice(0, 12)
    .map((e) => {
      const id = canonicalId(e.arxivId);
      const already = isInSelection(id);
      const btnText = already ? '✓ 已加入' : '➕ 加入';
      return `
    <div class="topic-modal-search-item" data-arxiv="${escapeHtml(e.arxivId)}">
      <div class="topic-modal-search-item-main">
        <div class="topic-modal-search-item-title">${escapeHtml(e.title)}</div>
        <div class="topic-modal-search-item-meta">
          <span class="topic-modal-search-item-id">arXiv:${escapeHtml(e.arxivId)}</span>
          <span class="topic-modal-search-item-authors">${escapeHtml(e.authors.slice(0, 3).join(', ') + (e.authors.length > 3 ? ' …' : ''))}</span>
          <span class="topic-modal-search-item-date">${escapeHtml(e.published.slice(0, 10))}</span>
        </div>
        <div class="topic-modal-search-item-summary">${escapeHtml(e.summary.slice(0, 220))}${e.summary.length > 220 ? '…' : ''}</div>
      </div>
      <button type="button" class="topic-btn primary topic-modal-search-item-add" data-act="add"${already ? ' disabled' : ''}>${btnText}</button>
    </div>`;
    })
    .join('');
  wrap.querySelectorAll<HTMLElement>('.topic-modal-search-item').forEach((row) => {
    const ax = row.dataset.arxiv!;
    row.querySelector<HTMLButtonElement>('[data-act="add"]')!.addEventListener('click', () => {
      addSearchResultToSelection(ax);
    });
  });
}

function addSearchResultToSelection(arxivId: string): void {
  const wrap = document.getElementById('add-seeds-search-results');
  if (!wrap) return;
  // 让用户能看到当前已选 — 通过 loadSelection 检测重复
  if (isInSelection(arxivId)) {
    setStatus(`arXiv:${arxivId} 已在参考列表中`, '');
    setTimeout(clearStatus, 1500);
    return;
  }
  // arxivId 形如 1706.03762v7,canonicalId 会去掉 v# 后缀。
  const canonId = canonicalId(arxivId);
  // 直接从当前渲染结果里读 entry 元数据 — 不必再走 searchArxivById 拿。
  const card = wrap.querySelector<HTMLElement>(
    `.topic-modal-search-item[data-arxiv="${CSS.escape(arxivId)}"]`,
  );
  const title = card?.querySelector('.topic-modal-search-item-title')?.textContent?.trim() || canonId;
  const sumText = card?.querySelector('.topic-modal-search-item-summary')?.textContent?.trim() || '';
  addToSelection({
    arxivId: canonId,
    title,
    tldr: sumText.slice(0, 400),
    method: '',
    result: '',
    tags: [],
    addedAt: Date.now(),
  });
  setStatus(`✓ 已加入 arXiv:${canonId}`, '');
  setTimeout(clearStatus, 1500);
  // 屏蔽重复添加 — 把按钮 disabled
  if (card) {
    const btn = card.querySelector<HTMLButtonElement>('[data-act="add"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '✓ 已加入';
    }
  }
}

// 搜索输入:debounce 250ms。沿用 paper-analyzer 已有的 searchArxiv()。
function setupAddSeedsSearch(): void {
  const input = document.getElementById('add-seeds-search-input') as HTMLInputElement | null;
  if (!input) return;
  const debounceMs = 250;
  let timer: number | undefined;
  input.addEventListener('input', () => {
    const v = input.value;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try {
        if (v.trim().length < 3) {
          const wrap = document.getElementById('add-seeds-search-results');
          if (wrap) wrap.innerHTML = '';
          return;
        }
        const wrapEl = document.getElementById('add-seeds-search-results');
        if (wrapEl) wrapEl.innerHTML = '<div class="topic-modal-search-empty">🔍 正在搜索...</div>';
        const entries = await searchArxivByTitle(v);
        renderArxivSearchResults(entries);
      } catch (e) {
        const wrapEl = document.getElementById('add-seeds-search-results');
        if (wrapEl) {
          wrapEl.innerHTML = `<div class="topic-modal-search-empty topic-modal-search-error">搜索失败: ${escapeHtml((e as Error).message)}</div>`;
        }
      }
    }, debounceMs);
  });
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
  // 主题页自己管 selection 弹层,与 paper-selection.ts 的浮动 action-bar 重复,
  // 且会自指跳到 /topic/?from=selection。打标记让 paper-selection.ts 跳过。
  document.body.dataset.noSelectionBar = '';

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

  // 阶段 1:📚 添加参考论文弹层
  $<HTMLButtonElement>('add-seeds-btn').addEventListener('click', openAddSeedsModal);
  document.getElementById('stage-input-seeds-edit')?.addEventListener('click', openAddSeedsModal);
  document.getElementById('add-seeds-modal')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.dataset.act === 'close-mask' || target.dataset.act === 'close-modal') {
      closeAddSeedsModal();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOpen) closeAddSeedsModal();
  });
  document.getElementById('add-seeds-clear-all')?.addEventListener('click', () => {
    const items = loadSelection();
    if (items.length === 0) return;
    if (items.length >= 3 && !confirm(`确定清空已选 ${items.length} 篇参考论文?`)) return;
    clearSelection();
  });
  document.getElementById('add-seeds-url-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitAddSeedsUrl(e.currentTarget as HTMLFormElement);
  });
  setupAddSeedsSearch();
  document.addEventListener('paper-selection-change', () => {
    updateSeedsCounter();
    if (modalOpen) renderAddSeedsModalList();
  });

  // 阶段 5:报告按钮 + 增量开关
  $<HTMLButtonElement>('report-gen-btn').addEventListener('click', doGenerateReport);
  $<HTMLButtonElement>('report-copy-btn').addEventListener('click', copyReportAsMarkdown);
  $<HTMLInputElement>('report-incremental-toggle').addEventListener('change', (e) => {
    setStatus(
      (e.target as HTMLInputElement).checked
        ? '✓ 已开启增量更新 — 后续每篇速览完成会自动刷新报告'
        : '已关闭增量更新',
      '',
    );
    setTimeout(clearStatus, 1800);
  });

  // ?from=selection 入口 — 在 stage 1 之前注入"📚 基于已选 N 篇论文探索"卡片
  // 用 try/catch 包裹,避免 seeds 相关 bug 影响主页面
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('from') === 'selection') {
      // 清除 URL 上的 from=selection,避免刷新页面时再次注入
      try {
        const url = new URL(location.href);
        url.searchParams.delete('from');
        history.replaceState(null, '', url.toString());
      } catch { /* ignore */ }
      const seeds = loadSelection();
      if (seeds.length > 0) {
        renderSeedsPill(seeds);
      }
    }
  } catch (e) {
    console.warn('[topic] 注入已选论文入口失败:', (e as Error).message);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}