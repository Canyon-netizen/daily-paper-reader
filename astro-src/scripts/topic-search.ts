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
  type LLMConfig,
} from './settings';
import {
  searchArxiv,
  searchArxivById,
  fetchArxivPdf,
  fetchWithDiagnosis,
  callLLM,
} from './paper-analyzer';
import type { ArxivEntry } from './paper-analyzer';
import { callChatCompletion, REASONING_MODEL_PATTERN_WIDE, resolveRoute, type ChatMessage } from '../lib/llm';
import { debounce, canonicalArxivId as canonicalId, escapeHtml } from '../lib/dom-utils';
import { injectIntoPromptSync } from './prompt-pack';
import {
  buildFacet,
  buildRegenSubQ,
  buildSubQ,
  computeFacetCoverage,
  normalizeAliases,
  normalizeQuery,
  FACET_CATEGORY_LABELS,
  type Candidate,
  type ChatMsg,
  type DecomposeLLMResponse,
  type Facet,
  type FacetCategory,
  type SessionStore,
  type SubQ,
  type SubqRewrite,
  type Summary,
  type TopicDecomposition,
  type TopicReport,
  type TopicReportDimension,
  type TopicReportDimensionPaper,
  type TopicSession,
  type DebateProgress,
  type DebateIdea,
} from '../lib/schemas';

// ============================================================================
// 类型 + 常量
// ============================================================================

// LLMConfig 来自 ./settings, 不再本地定义. 见 ./settings:7.

const SESSION_KEY = 'dpr_topic_session_v1';
const SCHEMA_VERSION = 1;
// 并发上限。注:每篇 summarizeOne 内部含 PDF 下载(走 8123 / arxiv)+ PDF.js 抽文本 +
// LLM 调用三段,瓶颈在 PDF 下载(网络)+ LLM(API 限流),PDF.js worker 共享无锁竞争。
// 上限 4 在本地 8123 + 主流 LLM 下稳定;更高容易被 arXiv 429 / LLM 限流。
const SUMMARIZE_CONCURRENCY = 4;
// PDF 下载预热池并发上限 — 独立于 LLM 阶段,提前把 PDF 下载 + 抽文本做完,避免
// LLM 阶段被网络 IO 阻塞。预热池跑得比 LLM 池快(没 LLM 限流),6 路够吃满 8123 代理带宽。
const PDF_PREFETCH_CONCURRENCY = 6;
// 追问历史单篇上限(避免撑爆 context)
const MAX_QA_PER_PAPER = 50;
// 喂 LLM 的最近条数
const MAX_QA_FOR_LLM = 30;
// 报告追问历史上限(报告对话相对单篇短,设小一些)
const MAX_QA_FOR_REPORT = 20;
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

// ============================================================================
// PR-4 Prompt Pack 注入层（对齐 src/prompt_pack.py 的 inject_into_prompt）
// - 默认所有 pin 都为 null → 三个硬编码 prompt 不变（零破坏）
// - 注入规则：pack.body 拼到 prompt 前；超过 24000 chars 截断
// ============================================================================

/**
 * 获取「topic.facet」target 当前生效的 prompt。
 * 默认走原 DECOMPOSE_SYSTEM 硬编码；pin 配置后自动拼 pack.body 在前。
 */
export function getActiveFacetPrompt(): string {
  try {
    const cfg = loadSettings() as unknown;
    return injectIntoPromptSync(DECOMPOSE_SYSTEM, 'topic.facet', cfg);
  } catch {
    return DECOMPOSE_SYSTEM;
  }
}

/**
 * 获取「topic.cand」target 当前生效的 prompt（候选筛选）。
 */
export function getActiveCandPrompt(): string {
  try {
    const cfg = loadSettings() as unknown;
    return injectIntoPromptSync(FILTER_CANDIDATES_SYSTEM, 'topic.cand', cfg);
  } catch {
    return FILTER_CANDIDATES_SYSTEM;
  }
}

/**
 * 获取「topic.explore」target 当前生效的 prompt（seeds 探索）。
 */
export function getActiveExplorePrompt(): string {
  try {
    const cfg = loadSettings() as unknown;
    return injectIntoPromptSync(EXPLORE_FROM_SEEDS_SYSTEM, 'topic.explore', cfg);
  } catch {
    return EXPLORE_FROM_SEEDS_SYSTEM;
  }
}

/**
 * 获取「topic.report」target 当前生效的 prompt（主题报告）。
 */
export function getActiveReportPrompt(): string {
  try {
    const cfg = loadSettings() as unknown;
    return injectIntoPromptSync(TOPIC_REPORT_SYSTEM, 'topic.report', cfg);
  } catch {
    return TOPIC_REPORT_SYSTEM;
  }
}

const DECOMPOSE_SYSTEM = `你是研究思路拆解助手。用户给出一段研究思路(中英文均可),你要先把该主题拆成
**显式的研究维度(facet)清单**,再从这些维度出发拆出 **3-5 个可独立在 arXiv 检索的子方向**。
与以往不同:facet 这一层现在是**要输出给用户看、可编辑**的中间结构,不再只是你脑内的草稿。

═══════════════════════════════════════════════════════════
【STEP 1 — 输出研究维度 facet 清单(5-7 个)】
═══════════════════════════════════════════════════════════

针对这个主题,列出 **5-7 个"该主题特有的研究维度"**,覆盖下面五类中的**至少 4 类**:

  ① method              方法路线:主流技术路线 / 学习范式
  ② data_task           数据与任务:核心数据形态 / 任务类型
  ③ structure_property  结构与性质:内部结构、几何性质、理论保证
  ④ application_transfer 应用与迁移:下游应用 / 跨域迁移
  ⑤ evaluation_benchmark 评测与基准:评测协议、数据集、leaderboard

每个 facet 必须:
  - id:      唯一的**纯 ASCII 短标识**(如 "f_method"、"f_bench"),后续 subq 用它引用
  - label:   4-12 字中文短语,是这个主题**特有**的维度名(不要泛化成"模型优化""应用场景")
  - category:必须是上面 5 个英文枚举值之一
  - note:    一句话说明这个维度在研究什么(≤ 40 字)

facet 是可供用户编辑的研究骨架 —— 宁可维度精准而暂时没有 subq,也不要为凑数编泛维度。

═══════════════════════════════════════════════════════════
【STEP 2 — 从 facet 拆出 3-5 个子方向,每个恰好挂一个 facet】
═══════════════════════════════════════════════════════════

- 输出 3-5 个子方向(主题很窄时 2-3 个也行,不要为凑数编造不相关方向)
- **每个子方向必须有且只有一个 facetId,精确等于某个 facets[].id**
- **默认不同子方向挂不同 facet**(这是保证子方向正交、不重叠的硬约束)
- 同一个 facet 只在其内部确实存在两条不可合并的路线时,才允许挂 2 个子方向
- 子方向之间按 **研究问题 / 技术机制 / 数据任务 / 评测协议** 区分,**不要只换同义词或换个应用名**
- 若某 facet 暂时找不到稳定 query,就让它保持"未覆盖"(没有 subq),不要硬造

每个子方向字段:
  - label:       中文短标题(8-20 字),让用户一眼看懂这条在搜什么
  - query:       arXiv 真实检索关键词,**2-3 个独立英文单词空格分隔**
  - aliases:     **3-5 个 arXiv 真实常见写法**(字符串数组,每个 2-4 词空格分隔)
  - reason:      一句话中文,说明这条**如何对应它的 facet**
  - facetId:     必须精确等于上面某个 facets[].id

═══════════════════════════════════════════════════════════
【query 真实度纪律 — 直接决定 arXiv 召回率】
═══════════════════════════════════════════════════════════

- query 用 **2-3 个独立英文单词**空格分隔,不要完整短语 / 句子
  ✓ "episodic memory" / "skill embedding" / "tool retrieval"
  ✗ "long-term episodic memory architecture"(太长) / "skill latent geometry"(自创短语,arXiv 无人用)
- aliases 是 arXiv 上真实有人用的关键词组合(想 arXiv 论文标题实际怎么写),3-5 个,不能与 query 完全一样
- 用户输入中文思路时,query / aliases **全部用英文专业术语**(不混中文)
- ❌ 禁止:自创复合短语 / 论文标题式整句 / 破折号驼峰下划线连词 / 中英混杂

═══════════════════════════════════════════════════════════
【arXiv 证据的用法】
═══════════════════════════════════════════════════════════

- 输入里可能给你一组**真实 arXiv 论文标题**,它们只是"这个领域真实在研究什么"的证据
- 从标题里提取领域真实使用的术语 / 方法名 / 任务名,用作 query / aliases 的种子
- **不要照抄标题**,不要把同一组高频词铺满所有 facet / subq
- 证据不改变研究边界:以用户明确的研究思路为主;证据缺失(标注"证据不可用")时仅依思路拆解,不要因此停摆

═══════════════════════════════════════════════════════════
【示例 — "智能体长程记忆"主题(节选)】
═══════════════════════════════════════════════════════════

{
  "facets": [
    {"id":"f_mech","label":"长程记忆机制","category":"method","note":"检索式 / 参数化长期记忆的实现路径"},
    {"id":"f_compress","label":"记忆压缩与抽象","category":"structure_property","note":"记忆摘要 / 分层抽象"},
    {"id":"f_bench","label":"记忆评测基准","category":"evaluation_benchmark","note":"长期记忆的评测协议与数据集"},
    {"id":"f_multimodal","label":"多模态记忆","category":"data_task","note":"跨模态记忆的存取"}
  ],
  "subqs": [
    {"label":"情节记忆与长期记忆","query":"episodic memory long-term",
     "aliases":["memory-augmented agent","long context memory","retrieval memory agent"],
     "reason":"对应长程记忆机制:检索式长期记忆是主流实现路径","facetId":"f_mech"},
    {"label":"记忆压缩与抽象","query":"memory consolidation",
     "aliases":["memory compression agent","memory abstraction hierarchical","summarized memory agent"],
     "reason":"对应记忆压缩与抽象维度","facetId":"f_compress"},
    {"label":"记忆评测基准","query":"agent memory benchmark",
     "aliases":["long-term memory benchmark","memory evaluation LLM agent","LOCOMO benchmark"],
     "reason":"对应评测基准维度:LoCoMo / LongMemEval 等","facetId":"f_bench"}
  ]
}
(注:f_multimodal 暂无 subq,属于"未覆盖"维度 — 这是允许的)

═══════════════════════════════════════════════════════════
【输出格式 — 必须严格遵守】
═══════════════════════════════════════════════════════════

- 只输出**一个 JSON 对象**,顶层同时含 "facets" 与 "subqs" 两个数组
- 不要任何其它文字、markdown 围栏、<think> 思考块
- **第一行必须是 { ,最后一行必须是 }**
`;

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

// 阶段 3.5:AI 筛论文 system prompt
// 用户在阶段 3 搜出 N 篇候选(常 100+),LLM 基于「主题 + 子方向 + 论文标题/摘要」
// 选出最相关的 M 篇(默认 30),把 candidatesBySubq 的 selected 状态对齐。
const FILTER_CANDIDATES_SYSTEM = `你是研究主题的论文筛选助手。用户已经基于子方向去 arXiv 搜了 N
篇候选论文(通常 50-300),主题是 [topic]。现在请你从 N 篇里挑出 M 篇(默认 30)
最相关的论文。

【评估标准】
- 主题契合度(50%):论文是否真正解决该主题的核心问题,而不是边缘相关
- 方法代表性(25%):是否在子方向上具有里程碑意义 / 经典算法 / SOTA
- 时间新鲜度(15%):优先近年(2023+)的论文,经典老论文只在「奠基性」明显时入选
- 来源可信度(10%):顶会 / 顶刊 / 知名机构优先

【输出格式 — 必须严格遵守】
- 只输出一个 JSON 数组,不要任何其它文字 / markdown 围栏 / 思考块
- 第一行必须是 [,最后一行必须是 ]
- 每个元素: { "arxivId": "1706.03762", "reason": "一句话中文入选理由" }
- 元素数量严格 = M(不要多也不要少)
- arxivId 必须严格匹配输入(去版本号)`;

// AI 筛论文入口:从 candidatesBySubq 全集中选 M 篇最相关。
async function filterCandidatesByLLM(targetN: number): Promise<void> {
  if (!current) return;
  // 收集所有候选(去重,保留第一条;过 hidden)
  const hidden = new Set(loadHiddenPapers());
  const allEntries: Array<{ cand: Candidate; subqId: string }> = [];
  for (const [subqId, list] of Object.entries(current.candidatesBySubq)) {
    for (const c of list) {
      if (hidden.has(c.arxivId)) continue;
      allEntries.push({ cand: c, subqId });
    }
  }
  // 同一篇跨子方向只算一次,保留首条 subqId
  const seen = new Set<string>();
  const unique = allEntries.filter((e) => {
    const k = canonicalId(e.cand.arxivId);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length === 0) {
    setStatus('没有候选论文可筛选', 'error');
    return;
  }
  if (unique.length <= targetN) {
    // 已经 <= M 篇,直接全选
    for (const e of unique) e.cand.selected = true;
    // 清掉同 subq 内不在 unique 列表的勾选
    for (const e of allEntries) {
      if (!unique.some((u) => u.cand.arxivId === e.cand.arxivId)) e.cand.selected = false;
    }
    renderCandStage();
    setStatus(`✓ 候选 ${unique.length} 篇,已全部勾选`, 'success');
    return;
  }
  const cfg = loadSettings() as LLMConfig;
  if (!cfg.apiKey) {
    renderBanner('请先在 <a href="/settings/">设置</a> 页面填 LLM API Key。');
    return;
  }
  clearBanner();
  inFlightController = new AbortController();
  setStatus(`🤖 AI 筛论文中:从 ${unique.length} 篇候选选最相关的 ${targetN} 篇...`);

  // 拼 userPrompt:每篇一个 block(标题 + 摘要前 200 字 + 来自子方向)
  const blocks: string[] = [];
  unique.forEach((e, i) => {
    const subq = current!.subqs.find((q) => q.id === e.subqId);
    const label = subq?.label ?? '?';
    blocks.push(
      `[${i + 1}] arXiv:${e.cand.arxivId} (子方向: ${label})\n` +
      `标题: ${e.cand.entry.title}\n` +
      `摘要: ${(e.cand.entry.summary || '').slice(0, 200).replace(/\s+/g, ' ')}`,
    );
  });
  const userPrompt =
    `研究主题: ${current.topic}\n\n` +
    `请从以下 ${unique.length} 篇候选中选最相关的 ${targetN} 篇:\n\n` +
    blocks.join('\n\n') +
    `\n\n请输出 JSON 数组,严格 ${targetN} 个元素:`;

  let raw = '';
  let arr: any[] = [];
  const MAX = 2;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      // 筛论文是重任务:输入含 N 篇候选(常 100-300)的标题+摘要,推理模型的
      // <think> 逐篇分析会很长。给足 8000 初始预算(callLLMRaw 内部再按
      // finish_reason=length 自动加倍到 16000),避免思考吃光预算导致正文为空。
      // PR-3:stage=topic_cand(筛候选)。
      const candRoute = resolveRoute('topic_cand');
      raw = await callLLMRaw(getActiveCandPrompt(), userPrompt, { ...cfg, model: candRoute.model }, true, 8000);
    } catch (e) {
      if (attempt >= MAX) {
        setStatusErrorWithAction(`AI 筛论文失败: ${(e as Error).message}`, '🔄 重试', () => filterCandidatesByLLM(targetN));
        inFlightController = null;
        return;
      }
      continue;
    }
    try {
      arr = JSON.parse(raw);
    } catch {
      if (attempt >= MAX) {
        setStatusErrorWithAction(`AI 筛论文返回不是 JSON: ${raw.slice(0, 100)}`, '🔄 重试', () => filterCandidatesByLLM(targetN));
        inFlightController = null;
        return;
      }
      continue;
    }
    if (Array.isArray(arr) && arr.length > 0) break;
  }
  // 把 LLM 选出的 arxivId 转成 Set
  const picked = new Set<string>();
  for (const item of arr) {
    const id = String(item.arxivId ?? '').trim();
    if (id) picked.add(canonicalId(id));
  }
  if (picked.size === 0) {
    setStatusErrorWithAction('AI 没选出任何论文', '🔄 重试', () => filterCandidatesByLLM(targetN));
    inFlightController = null;
    return;
  }

  // 应用勾选:在 picked 里的设 true,其他全 false
  for (const e of allEntries) {
    e.cand.selected = picked.has(canonicalId(e.cand.arxivId));
  }
  renderCandStage();
  persistSession(current!);
  inFlightController = null; // 先置空,再报成功 — 否则 setStatus 会误判为「仍在飞」而挂 spinner/停止按钮
  setStatus(`✓ AI 筛论文完成:从 ${unique.length} 篇中选了 ${picked.size} 篇。点「🚀 总结选中论文」开始总结。`, 'success');
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

const REPORT_CHAT_SYSTEM = `你是主题报告交互助手。用户的会话刚刚由 LLM 生成了一份「主题报告」,现在他/她在
围绕这份报告提问或要求修改。请按下面两类意图分别处理:

【意图 1:提问 / 澄清 / 求证】
- 用户问"为什么把 X 论文归到 Y 维度"、"某个数字从哪来"、"对比是否公平"等
- 你需要基于报告内容、已给的论文速览、abstract 上下文回答
- 信息不足时明确说"原报告 / 速览 / abstract 中未涉及此细节"
- 不要编造公式、数字、作者观点
- 中文回答,术语首次出现给中英对照
- 默认 ≤ 250 字;用户明确要求展开除外

【意图 2:修改 / 重写 / 增删 / 调整语气或顺序】
- 用户说"改"、"调整"、"重写"、"删掉"、"加上"、"把 X 换成 Y"、"语气更口语化"等
- 你**不要直接修改报告并回写**,而是输出"修改建议":
  - 用项目符号列出每条建议,每条说明: ① 要改的位置(报告哪个 section / 哪条 / 哪个字段)
                              ② 改后的内容(直接给出建议的替换文本,≤ 200 字)
                              ③ 改动理由(1 句话)
- 末尾固定加一行: "——\n📥 点报告下方的「🔄 应用此修改并重新生成」即可让模型基于这些建议重生成报告。"
- 用户可以多次迭代修改建议

【共性纪律】
- 始终保持中文回答
- 不要重新编报告 JSON 全文,只在「修改建议」模式下给"点位 + 替换文本"
- 不要越界讨论报告以外的话题
- 不要承诺会"自动应用"任何修改 — 应用由用户点按钮触发`;

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
  if (copy.reportChats && copy.reportChats.length > MAX_QA_FOR_REPORT) {
    copy.reportChats = copy.reportChats.slice(-MAX_QA_FOR_REPORT);
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

// 从已剥壳文本里提取顶层 JSON(数组或对象),带**截断自愈**。
// 为什么不用 lastIndexOf(']'):LLM 被 max_tokens 截断时,尾部的外层 ] 根本没输出,
// lastIndexOf(']') 会误取某个内层 aliases 数组的 ],得到 `[{..},{.."aliases":[..]`
// 这种括号不配对的串,JSON.parse 直接抛「不是合法 JSON」(就是用户看到的报错)。
// 这里改用括号栈扫描:
//   - 扫到与 opener 配对的闭合 → 返回完整片段;
//   - 扫到结尾仍未闭合(被截断)→ 按未闭合的括号栈补齐 " / } / ],丢掉末尾残缺一小段,
//     尽量还原成可 parse 的 JSON。
// opener 由调用方按首个结构字符给定('[' 或 '{'),避免误抓另一种括号。
function extractTopLevelJsonWithHeal(stripped: string, opener: '[' | '{'): string | null {
  const startIdx = stripped.indexOf(opener);
  if (startIdx < 0) return null;
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < stripped.length; i++) {
    const ch = stripped[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (stack.length === 0) return stripped.slice(startIdx, i + 1); // 完整闭合
    }
  }
  // 未闭合 → 截断自愈
  let trial = stripped.slice(startIdx);
  if (inStr) {
    // 截在字符串值中间(如 "reason":"…核心路)→ 先补收尾引号
    trial += '"';
  } else {
    // 截在元素之间留了悬挂逗号(如 [{a},{b},)→ 去掉,否则 [..,] 非法
    trial = trial.replace(/,\s*$/, '');
  }
  // 按未闭合的括号栈 LIFO 补齐(最内层先闭合)
  for (let i = stack.length - 1; i >= 0; i--) trial += stack[i];
  return trial;
}

async function callLLMRaw(
  systemPrompt: string,
  userContent: string,
  cfg: LLMConfig,
  jsonOnly = true,
  maxTokens = 4000,
  expectedTopLevel?: '[' | '{',
): Promise<string> {
  // finish_reason=length(被输出预算截断)时,自动加倍预算重试一次。
  // 主要救推理模型:它会先输出一大段 reasoning,重任务思考很长,可能烧光整个 maxTokens,
  // 剥掉思考后正文为空。
  let budget = maxTokens;
  const MAX_BUDGET = 16000;
  for (let attempt = 0; ; attempt++) {
    const response = await callChatCompletion(
      cfg,
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
        maxTokens: budget,
        signal: inFlightController?.signal,
        reasoningModelPattern: REASONING_MODEL_PATTERN_WIDE,
      },
    );
    const content = response.content;
    const finishReason = response.finishReason;
    const stripped = content
      .replace(/<\/think>/gi, "")
      .replace(/<\/think[\s\S]*\$/i, "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    if (
      finishReason === "length" &&
      stripped.length < 20 &&
      budget < MAX_BUDGET &&
      attempt < 3
    ) {
      budget = Math.min(budget * 2, MAX_BUDGET);
      continue;
    }
    return finalizeLLMJson(content, stripped, finishReason, jsonOnly, expectedTopLevel);
  }
}


// 从(已剥 think/fence 的)stripped 里提取顶层 JSON;jsonOnly=false 时原样返回 stripped。
function finalizeLLMJson(
  content: string,
  stripped: string,
  finishReason: string,
  jsonOnly: boolean,
  expectedTopLevel?: '[' | '{',
): string {
  if (!jsonOnly) {
    if (!stripped) throw new Error(`LLM 返回为空 (finish_reason=${finishReason})`);
    return stripped;
  }
  // jsonOnly:用带截断自愈的括号栈扫描提取顶层 JSON(数组或对象)。
  // 关键:顶层数组**不能**用 extractBalancedJson(只识别第一个 {...},会把
  // [{a},{b},{c}] 截成单个 {a});也不能用 lastIndexOf(']')(截断时会误取内层
  // aliases 的 ],得到括号不配对的串)。extractTopLevelJsonWithHeal 对完整/被
  // max_tokens 截断两种情况都能还原成可 parse 的 JSON。
  const headIdx = stripped.search(/\S/);
  if (headIdx < 0) throw new Error(`LLM 返回为空(finish_reason=${finishReason}, 返回前 200 字符: ${content.slice(0, 200).replace(/\s+/g, ' ')})`);
  const head = stripped[headIdx];
  // head 不是 [ / { 时说明 LLM 先输出了思考/说明文字。此时优先用调用方给的
  // expectedTopLevel(decompose 传 '{');没给才按"数组优先"猜:首个 [ 若出现在
  // 首个 { 之前就当数组,否则当对象。注意真实首字符永远优先于 expectedTopLevel,
  // 以支持 legacy 数组 fallback(某些 provider 仍返回数组)。
  let opener: '[' | '{';
  if (head === '[') opener = '[';
  else if (head === '{') opener = '{';
  else if (expectedTopLevel) opener = expectedTopLevel;
  else {
    const bi = stripped.indexOf('[');
    const oi = stripped.indexOf('{');
    opener = bi !== -1 && (oi === -1 || bi < oi) ? '[' : '{';
  }
  const extracted = extractTopLevelJsonWithHeal(stripped, opener);
  if (!extracted) {
    throw new Error(`LLM 未输出 JSON(finish_reason=${finishReason}, 返回前 200 字符: ${content.slice(0, 200).replace(/\s+/g, ' ')})`);
  }
  return extracted;
}

// ============================================================================
// 状态机:5 个阶段
// ============================================================================

// 拆解前对原始主题做一次轻量 arXiv 探针,拿真实论文标题作为"这个领域真实在研究什么"
// 的证据喂给拆解 prompt。失败(CORS / 网络 / 无英文 token)返回空证据,绝不阻塞拆解。
// arXiv 限速 ~1 req/s:默认只发 1 个请求,标题不足时最多再补 1 个(间隔 1s)。
async function probeTopicEvidence(idea: string): Promise<string[]> {
  const q = normalizeQuery(idea);
  if (!q || !/[A-Za-z]/.test(q)) return []; // 整段中文 / 无英文 token → 跳过
  const titles: string[] = [];
  const seen = new Set<string>();
  const pushTitles = (entries: ArxivEntry[]) => {
    for (const e of entries) {
      const t = (e.title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const key = t.toLowerCase();
      if (!t || seen.has(key)) continue;
      seen.add(key);
      titles.push(t);
    }
  };
  try {
    pushTitles(await fetchEntriesNoCatFilter(q, 15));
  } catch {
    return titles; // 首个请求失败 → 有多少给多少(通常 0)
  }
  // 命中太少 → 用前 2-3 个 token 的更宽 query 补一次(仍受 1 请求/s 限速,先 sleep)
  if (titles.length < 5) {
    const toks = q.split(' ').filter(Boolean);
    const broader = toks.slice(0, Math.min(3, toks.length)).join(' ');
    if (broader && broader !== q) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        pushTitles(await fetchEntriesNoCatFilter(broader, 15));
      } catch {
        /* 补充失败无所谓 */
      }
    }
  }
  return titles.slice(0, 15);
}

// 把证据标题拼成 prompt 片段;空证据写降级说明,让模型仅依思路拆解、不停摆。
function buildEvidenceBlock(titles: string[]): string {
  if (titles.length === 0) {
    return `【arXiv 证据不可用】未能检索到该主题的真实论文标题,请仅依据研究思路拆解,不要因缺证据而停摆。\n\n`;
  }
  const lines = titles.map((t, i) => `  ${i + 1}. ${t}`).join('\n');
  return (
    `【arXiv 真实论文标题证据(共 ${titles.length} 条)】\n` +
    `以下标题来自对你研究思路的轻量检索,仅用于识别该领域真实使用的术语,不要照抄:\n` +
    lines +
    `\n\n`
  );
}

async function decomposeIdea(idea: string, seeds?: SelectionItem[]): Promise<TopicDecomposition> {
  const cfg = loadSettings() as LLMConfig;
  // Step 1:轻量 arXiv 探针(失败静默,返回空证据)
  const evidenceTitles = await probeTopicEvidence(idea);

  let userPrompt = `研究思路:\n"""\n${idea.trim()}\n"""\n\n`;
  // Step 2:证据块紧跟思路
  userPrompt += buildEvidenceBlock(evidenceTitles);
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
      `用户已选 ${seeds.length} 篇参考论文(用户主动选的先验材料,区别于上面的领域证据;用于迁移/借鉴,不限从中衍生):\n"""\n${seedsBlock}\n"""\n\n` +
      `请结合研究思路与参考论文拆解,允许「直接借鉴参考论文的方法路径」与「主题在参考论文之外的新方向」并存,` +
      `不要让所有子方向都变成参考论文的迁移方向。\n\n`;
  }
  userPrompt += `请输出一个 JSON 对象(顶层含 facets 与 subqs 两个数组,不要其它文字):`;

  const hasSeeds = !!(seeds && seeds.length > 0);
  let parsed: DecomposeLLMResponse | null = null;
  let legacyArr: any[] | null = null;
  const MAX = 3;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    let raw = '';
    try {
      // 输出含 facets + subqs,预算给 6000(callLLMRaw 内部按 finish_reason=length 再加倍)。
      // expectedTopLevel='{':前导有说明文字时按对象取,真实首字符仍优先(兼容 legacy 数组)。
      // PR-3:stage=topic_facet(主题拆解)。
      const facetRoute = resolveRoute('topic_facet');
      raw = await callLLMRaw(getActiveFacetPrompt(), userPrompt, { ...cfg, model: facetRoute.model }, true, 6000, '{');
    } catch (e) {
      if (attempt >= MAX) throw e;
      continue;
    }
    let obj: any;
    try {
      obj = JSON.parse(raw);
    } catch {
      if (attempt >= MAX) throw new Error(`拆解结果不是合法 JSON: ${raw.slice(0, 200)}`);
      continue;
    }
    // 期望顶层对象含 facets + subqs
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && Array.isArray(obj.subqs)) {
      parsed = obj as DecomposeLLMResponse;
      if (Array.isArray(parsed.subqs) && parsed.subqs.length > 0) break;
      // subqs 空 → 重试
      if (attempt >= MAX) {
        throw new Error('LLM 未返回任何子方向,试试把思路描述得更具体一些,或换个角度重试');
      }
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    // 顶层是数组(legacy provider / 缓存):最后一次仍如此才作 fallback,否则重试提示要对象
    if (Array.isArray(obj)) {
      if (attempt >= MAX) {
        legacyArr = obj;
        break;
      }
      userPrompt += `\n\n【重要】必须返回一个 JSON 对象(含 facets 与 subqs),不要直接返回数组。`;
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    if (attempt >= MAX) {
      throw new Error('LLM 拆解输出结构不符合预期(缺 subqs 数组)');
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  // ---- 构造 facets(缺 id 兜底、重复 id 加后缀、过 buildFacet)----
  const facets: Facet[] = [];
  const rawIdToFacetId = new Map<string, string>();     // LLM 原始 id → 正式 id
  const labelToFacetId = new Map<string, string>();     // facet label(lower) → 正式 id
  const usedIds = new Set<string>();
  if (parsed && Array.isArray(parsed.facets)) {
    parsed.facets.forEach((f, i) => {
      const rawId = String(f?.id ?? '').trim();
      let fid = rawId || `facet-${i + 1}`;
      // 去重 id
      if (usedIds.has(fid)) {
        let n = 2;
        while (usedIds.has(`${fid}-${n}`)) n++;
        fid = `${fid}-${n}`;
      }
      usedIds.add(fid);
      const facet = buildFacet({ id: fid, label: f?.label ?? `维度 ${i + 1}`, category: f?.category, note: f?.note });
      facets.push(facet);
      if (rawId) rawIdToFacetId.set(rawId, facet.id);
      if (facet.label) labelToFacetId.set(facet.label.toLowerCase(), facet.id);
    });
  }

  // ---- 构造 subqs(facetId 映射 → label 兜底 → 未分配;绝不按下标猜)----
  const rawSubqs = parsed ? parsed.subqs ?? [] : legacyArr ?? [];
  const built: SubQ[] = rawSubqs.slice(0, 7).map((x: any, i: number) => {
    // 解析 facetId:先按原始 id 映射,再按 label 完全匹配兜底
    let facetId: string | undefined;
    const rawFacetId = String(x?.facetId ?? '').trim();
    if (rawFacetId) {
      facetId = rawIdToFacetId.get(rawFacetId) ?? (usedIds.has(rawFacetId) ? rawFacetId : undefined);
      if (!facetId) facetId = labelToFacetId.get(rawFacetId.toLowerCase());
    }
    const facetLabel = facetId ? facets.find((f) => f.id === facetId)?.label : undefined;
    return buildSubQ({
      id: uid('q'),
      label: x?.label ?? `子方向 ${i + 1}`,
      query: x?.query,
      reason: x?.reason,
      selected: true,
      source: hasSeeds ? 'manual-with-seeds' : 'manual',
      aliases: x?.aliases,
      facetId,
      facetLabel,
    });
  }).filter((q: SubQ) => q.query);

  // 实测 arXiv 召回 + 命中 0 自动让 LLM 改写闭环(把探针证据一并喂给改写);失败时静默返回原数组。
  let finalSubqs = built;
  try {
    finalSubqs = await validateAndRewriteSubqs(built, cfg, evidenceTitles);
  } catch {
    finalSubqs = built;
  }

  const coverage = computeFacetCoverage(facets, finalSubqs);
  return { facets, subqs: finalSubqs, coverage };
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
      // PR-3:stage=topic_explore(从 seeds 探索)。
      const exploreRoute = resolveRoute('topic_explore');
      raw = await callLLMRaw(getActiveExplorePrompt(), userPrompt, { ...cfg, model: exploreRoute.model }, true);
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

  // 把 explorationType 限制在白名单内(LLM 偶尔会写错大小写或拼写)。
  // ALLOWED_EXPLORATION_TYPES 已在 ../lib/schemas 集中维护,buildSubQ 自动收敛。
  const built = arr.slice(0, 6).map((x: any, i: number) => buildSubQ({
    id: uid('q'),
    label: x.label ?? `迁移方向 ${i + 1}`,
    query: x.query,
    reason: x.reason,
    selected: true,
    source: 'seeds',
    explorationType: x.explorationType,
    aliases: x.aliases,
  })).filter((q: SubQ) => q.query);
  // 实测 arXiv 召回 + 命中 0 自动让 LLM 改写闭环
  try {
    return await validateAndRewriteSubqs(built, cfg);
  } catch {
    return built;
  }
}

// 轻量实测 arXiv 命中数 — 不下载 PDF、不调 searchArxiv(它会 parse ArxivEntry 浪费),
// 直接打 arXiv API 拿 top 5 条只数不同 canonical id,够用来判断"这个 query 有没有论文"。
// 单次调用 ~300ms,arXiv 限速 1 req/s。
async function validateSubqHitCount(q: string): Promise<{ count: number; samples: string[] }> {
  const url = `https://export.arxiv.org/api/query?search_query=all%3A%22${encodeURIComponent(q)}%22&max_results=5&sortBy=relevance&sortOrder=descending`;
  try {
    // 走 fetchWithDiagnosis 代理链 — 本地开发 arXiv 无 CORS 头时纯 fetch 会全挂,
    // 导致命中 badge 全显示 0。复用 paper-analyzer 的代理链修这个假 0。
    const res = await fetchWithDiagnosis(url, `arXiv 命中实测 "${q}"`);
    if (!res.ok) return { count: 0, samples: [] };
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const ids = new Set<string>();
    const samples: string[] = [];
    doc.querySelectorAll('entry').forEach((e) => {
      const idEl = e.querySelector('id');
      const titleEl = e.querySelector('title');
      if (!idEl) return;
      const idText = (idEl.textContent ?? '').trim();
      // arXiv API 返回的 id 形如 "http://arxiv.org/abs/2405.14790v1",取最后一段再 strip /v\d+/
      const m = idText.match(/abs\/([\d.]+)(?:v\d+)?/);
      if (!m) return;
      ids.add(m[1].replace(/v\d+$/, ''));
      if (titleEl && samples.length < 3) samples.push((titleEl.textContent ?? '').trim().replace(/\s+/g, ' '));
    });
    return { count: ids.size, samples };
  } catch {
    // 网络/CORS 错误不要让整个拆解挂掉 — 视为 0 命中,UI 上会显示"⚠ 无法验证"
    return { count: 0, samples: [] };
  }
}

// searchForDirection 主 query 失败时的 fallback:不走 searchArxiv(带 cat 过滤),而是
// 直接打 arXiv API(不带 cat 过滤,max_results=12),parse 出 ArxivEntry[] 用于合并。
// 这样即使 cat 过滤在某个边缘 case 下完全 0 命中,fallback 仍能给用户至少几条候选。
async function fetchEntriesNoCatFilter(q: string, maxResults = 12): Promise<ArxivEntry[]> {
  const url = `https://export.arxiv.org/api/query?search_query=all%3A%22${encodeURIComponent(q)}%22&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;
  try {
    // 走 paper-analyzer 已导出的 fetchWithDiagnosis(直连 → 自定义代理 → 8123 链),
    // 使本地开发 (arXiv 无 CORS 头) 也能命中,而不是纯 fetch 直接失败。
    const res = await fetchWithDiagnosis(url, `arXiv 检索 "${q}"`);
    if (!res.ok) return [];
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const entries: ArxivEntry[] = [];
    const seen = new Set<string>();
    doc.querySelectorAll('entry').forEach((e) => {
      const idFull = e.querySelector('id')?.textContent?.trim() ?? '';
      const arxivId = idFull.split('/abs/').pop() ?? '';
      const canon = canonicalId(arxivId);
      if (seen.has(canon)) return;
      const title = (e.querySelector('title')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!title || title.toLowerCase() === 'error' || title.length < 3) return;
      const summary = (e.querySelector('summary')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const authors = Array.from(e.querySelectorAll('author name')).map((n) => (n.textContent ?? '').trim()).filter(Boolean);
      const published = e.querySelector('published')?.textContent?.trim() ?? '';
      const updated = e.querySelector('updated')?.textContent?.trim() ?? '';
      seen.add(canon);
      entries.push({
        id: idFull, arxivId, title, authors, summary, published, updated,
        pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
      });
    });
    return entries;
  } catch {
    return [];
  }
}

// 子方向 query 改写 system prompt(只在命中 0 时触发一次,提供 arXiv 真实命中样本作证据)
const SUBQ_REWRITE_SYSTEM = `你是研究思路拆解助手的"query 修复"模块。

你刚拆出的若干子方向在 arXiv 上**主 query 0 召回**。请基于我提供的"已验证召回的样本"作为
真实写法的证据,**只对 0 召回的那几个子方向**重新生成 query + aliases。

【硬性约束】
- 只输出一个 JSON 数组,元素数量 = 0 召回子方向的数量(不要新增、不要删除)
- 每个元素严格匹配 schema: { id, label, query, aliases, reason }
  - id 必须等于下面给到的原 id(用于在调用方替换原条目,不是新增)
  - label 保留原文(用户已看过)
  - reason 保留原文
  - query + aliases 是要重新生成的
- query / aliases 必须遵守 DECOMPOSE_SYSTEM 的【query 真实度纪律】(2-3 个独立英文词,贴近 arXiv 真实标题)

【facet 纪律 — 防同质化,非常重要】
- 只改 query / aliases,**不要改变每个子方向的研究维度(facet)边界** —— 改写后它仍应搜的是原方向
- **绝不**因为证据里某个词高频,就把所有 0 召回子方向都改成同一组词(那会让子方向塌成一条)
- 不同 0 召回子方向改写后彼此仍要区分,不要互相靠拢

【证据优先级】
1. **优先用"主题证据标题"**(对整个主题探针得到的真实论文标题)提取该方向的术语
2. 其次复用"其他子方向的真实命中样本"关键词
3. 只有前两者都不足时,才退而用更短、更通用的英文术语
- aliases 可多给一些(可达 5-7 个),用 arXiv 标题里真实出现过的小词组合

【输出】
第一行 [,最后一行 ],中间严格 JSON,不要任何其它文字。`;

// 命中 0 闭环重写:把"0 命中子方向列表 + 主题证据标题 + 其他子方向实测命中样本"反馈给 LLM,
// 让它基于证据改写 0 命中的 query。evidenceTitles 是拆解阶段对整个主题探针得到的真实标题。
async function rewriteZeroHitSubqs(
  zeros: SubQ[],
  samplesByLabel: Map<string, string[]>,
  evidenceTitles: readonly string[],
  cfg: LLMConfig,
): Promise<Map<string, { query: string; aliases: string[] }>> {
  if (zeros.length === 0) return new Map();
  // 主题证据块(优先级最高)
  const topicEvidenceBlock = evidenceTitles.length > 0
    ? `\n【主题证据标题(共 ${evidenceTitles.length} 个,对整个主题检索得到,最高优先级)】\n` +
      evidenceTitles.slice(0, 8).map((s, i) => `  ${i + 1}. ${s}`).join('\n') + '\n'
    : '';
  // 收集样本(去重 + 截前 6 个标题)
  const allSamples: string[] = [];
  for (const samples of samplesByLabel.values()) {
    for (const s of samples) if (!allSamples.includes(s)) allSamples.push(s);
  }
  const evidenceBlock = allSamples.length > 0
    ? `\n【已验证召回的样本标题(共 ${allSamples.length} 个,来自其他子方向)】\n` +
      allSamples.slice(0, 6).map((s, i) => `  ${i + 1}. ${s}`).join('\n') + '\n'
    : evidenceTitles.length > 0
      ? '\n【注意】其他子方向暂无命中样本,请优先用上面的主题证据标题。\n'
      : '\n【注意】暂无任何真实证据 — 整体 query 可能太冷门,建议换成更通用的英文术语,但仍保持各方向区分。\n';

  const zerosBlock =
    `\n【0 召回子方向(共 ${zeros.length} 个,需要重新生成 query / aliases)】\n` +
    zeros.map((z, i) => `  ${i + 1}. id=${z.id}\n     label: ${z.label}${z.facetLabel ? `\n     研究维度: ${z.facetLabel}` : ''}\n     当前 query: ${z.query}\n     当前 aliases: ${JSON.stringify(z.aliases)}`).join('\n');
  const userPrompt = `研究主题相关拆解,以下 ${zeros.length} 个子方向的主 query 在 arXiv 上 0 召回,请改写(保持各方向研究维度不变、彼此仍区分)。${topicEvidenceBlock}${evidenceBlock}${zerosBlock}\n请只输出改写后的 JSON 数组:`;

  try {
    // PR-3:stage=topic_facet(subq rewrite 也走 facet 路由 — 同一 prompt 类目)。
    const facetRoute2 = resolveRoute('topic_facet');
    const raw = await callLLMRaw(SUBQ_REWRITE_SYSTEM, userPrompt, { ...cfg, model: facetRoute2.model }, true);
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Map();
    const out = new Map<string, SubqRewrite>();
    for (const item of arr) {
      const id = String(item.id ?? '');
      if (!id) continue;
      const newQuery = normalizeQuery(String(item.query ?? ''));
      const newAliases = normalizeAliases(item.aliases, newQuery);
      out.set(id, { query: newQuery, aliases: newAliases });
    }
    return out;
  } catch {
    // 改写失败也不要阻塞 — 保留原 query,UI 上仍标 0 召回警告
    return new Map();
  }
}

// decomposeIdea 后置处理:实测每个 subq 的 arXiv 召回,命中 0 触发一次 LLM 改写闭环。
// 串行测(arXiv 限速 1 req/s),预计 3-5 个子方向共 3-5s;命中 0 时再调 1 次 LLM(~3-10s)。
export async function validateAndRewriteSubqs(
  subqs: SubQ[],
  cfg: LLMConfig,
  evidenceTitles: readonly string[] = [],
): Promise<SubQ[]> {
  if (subqs.length === 0) return subqs;
  // 并行 3 路实测(arXiv API 实际支持一定并发,实测 3 路并发也没问题;但串行更稳,arXiv
  // 偶尔会 429)。先串行,实测后改写循环一次性调 LLM。
  const samplesByLabel = new Map<string, string[]>();
  const zeros: SubQ[] = [];
  for (const sq of subqs) {
    const { count, samples } = await validateSubqHitCount(sq.query);
    sq.hitCount = count;
    sq.hitSamples = samples;
    if (count > 0) samplesByLabel.set(sq.label, samples);
    else if (sq.query && /[A-Za-z]/.test(sq.query)) zeros.push(sq);
  }
  if (zeros.length === 0) return subqs;

  // 命中 0 → 让 LLM 改写一次(优先用主题证据标题,其次其他子方向的命中样本)
  const rewriteMap = await rewriteZeroHitSubqs(zeros, samplesByLabel, evidenceTitles, cfg);
  // 把改写结果应用回原 subqs,并对改写后的 query 再实测一次。
  // 重要:若改写后实测仍 0 命中,立即**还原** LLM 改写前的原始 query + aliases,
  // 避免「改写把原本命中的 query 改成不命中的」(LLM 看到其他子方向的命中样本后
  // 可能强行套用「skill / tool / embedding」等高频词,把 "hierarchical reinforcement
  // learning" 改成 "hierarchical skill learning" 反而 0 命中)。还原后 hitCount 仍
  // 为 0,UI 显示红 badge 让用户手动改。
  for (const sq of zeros) {
    const rw = rewriteMap.get(sq.id);
    if (!rw || !rw.query) continue;
    // 留一份原 query / aliases,改写后再实测一次,如果仍然 0 命中就还原。
    const origQuery = sq.query;
    const origAliases = sq.aliases;
    sq.query = rw.query;
    sq.aliases = Array.from(new Set(rw.aliases)).filter((a) => a !== rw.query);
    const { count, samples } = await validateSubqHitCount(sq.query);
    if (count > 0) {
      sq.hitCount = count;
      sq.hitSamples = samples;
    } else {
      // 还原原 query + aliases —— 宁可保留「验证过 0 命中」也不要换上更糟糕的
      sq.query = origQuery;
      sq.aliases = origAliases;
      sq.hitCount = 0;
      sq.hitSamples = [];
    }
  }
  return subqs;
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
  // 注意:searchForDirection 是被 runConcurrent 调的,throw 会让 candidatesBySubq[id]
  // 保持 [] 空数组(doSearch 的初始清空),UI 显示"0 命中"但用户不知道原因。把错误
  // 信息先 attach 到 subq.searchError,再 throw,让 doSearch 把这个错误摘出来报告。
  const cleaned = normalizeQuery(subq.query);
  const queryForArxiv = cleaned || subq.query.trim();
  const hasAscii = /[A-Za-z]/.test(queryForArxiv);
  if (!hasAscii) {
    const msg = `子方向 "${subq.label}" 的 query 不含英文,无法在 arXiv 搜索: ${subq.query}`;
    subq.searchError = msg;
    throw new Error(msg);
  }

  // 构造别名列表 — 与主 query 互不重叠(已经在构造 SubQ 时 Set 去重一次了,这里
  // 再做一次兜底以防外部直接构造的 SubQ)。
  const aliasList = normalizeAliases(subq.aliases, queryForArxiv);
  const queries = [queryForArxiv, ...aliasList.filter((a) => a !== queryForArxiv)];

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
        // 主 query 失败:不要让整个子方向 fail(candidatesBySubq[id] 会保持 [] 让用户看到
        // "0 命中",但其实是有救的 — cat 过滤可能在某些查询下 0 命中,而直接打 arXiv
        // API 不带 cat 过滤就命中)。fallback 到轻量 URL(validateSubqHitCount 那种
        // 不带 cat 过滤的 fetch,parse 头部几个 entry 拿过来用)。
        console.warn(`[topic] 主 query "${queryForArxiv}" searchArxiv 失败,fallback 到无 cat 过滤 URL:`, e);
        const fb = await fetchEntriesNoCatFilter(q);
        if (fb.length > 0) {
          for (const e of fb) {
            const key = canonicalId(e.arxivId);
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(e);
          }
        } else {
          // 兜底也失败 → 真没命中,记录错误后让 doSearch 显示
          const msg = (e as Error).message.slice(0, 240);
          subq.searchError = `主 query "${queryForArxiv}" arXiv 调用失败: ${msg}`;
        }
        await new Promise((r) => setTimeout(r, 1000));
        continue;
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

// PDF 文本缓存 — 让 PDF 下载 + 抽文本在 LLM 阶段之前并行预热。结构:
//   { arxivId: { status: 'pending'|'ready'|'failed', text?, error?, startedAt } }
// 单次 doSummarize 期间有效;doSummarize 完成后整体清空(避免内存泄漏)。
// 不持久化(下次 doSummarize 重新下载即可,反正下载被 8123 代理缓存)。
const pdfTextCache = new Map<string, { status: 'pending' | 'ready' | 'failed'; text?: string; error?: string; startedAt: number }>();

// 预热一篇 PDF:下载 + 抽文本 → 写入 pdfTextCache。失败写 'failed' + error。
// failed 状态有 5 分钟 TTL:代理刚起来 / 网络瞬断后用户重试,不会被旧错误永远卡死。
const PREFETCH_FAIL_TTL_MS = 5 * 60_000;
async function prefetchOnePdf(entry: ArxivEntry): Promise<void> {
  const cached = pdfTextCache.get(entry.arxivId);
  if (cached?.status === 'ready') return;
  if (cached?.status === 'failed' && Date.now() - cached.startedAt < PREFETCH_FAIL_TTL_MS) return;
  pdfTextCache.set(entry.arxivId, { status: 'pending', startedAt: Date.now() });
  try {
    const buf = await fetchArxivPdf(entry.pdfUrl, () => { /* 预热阶段不打扰 UI status */ });
    const head = new Uint8Array(buf.slice(0, 4));
    const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
    if (!isPdf) {
      throw new Error('PDF 下载失败(proxy 可能返回了 HTML 错误页),请检查网络或切换自定义代理');
    }
    const text = await extractPdfTextFromBuffer(buf);
    pdfTextCache.set(entry.arxivId, { status: 'ready', text, startedAt: Date.now() });
  } catch (e) {
    pdfTextCache.set(entry.arxivId, {
      status: 'failed',
      error: (e as Error).message.slice(0, 240),
      startedAt: Date.now(),
    });
  }
}

// PDF → 文本,最多 25 页 / 50k 字符。从 paper-analyzer 内部复用逻辑。
// PDF worker 走 settings 的 CORS 代理(同 paper-analyzer 一套),避免生产部署时
// 硬编码 localhost:8123 直接挂。
async function extractPdfTextFromBuffer(buf: ArrayBuffer): Promise<string> {
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
  return text;
}

async function summarizeOne(entry: ArxivEntry, subqId: string): Promise<Summary> {
  const cfg = loadSettings() as LLMConfig;
  // 等预热池就绪(预热池在 doSummarize 阶段 1 已并发跑);若预热失败回退到同步下载+抽文本。
  let text: string | undefined;
  const cached = pdfTextCache.get(entry.arxivId);
  if (cached?.status === 'ready' && cached.text) {
    text = cached.text;
  } else if (cached?.status === 'failed') {
    throw new Error(`PDF 预热失败: ${cached.error}`);
  } else {
    // 预热还没轮到这篇 → 阻塞同步下载(预热并发 6 但 LLM 并发 4,有可能 LLM 抢在预热前)
    await prefetchOnePdf(entry);
    const r = pdfTextCache.get(entry.arxivId);
    if (r?.status === 'ready' && r.text) {
      text = r.text;
    } else {
      throw new Error(`PDF 处理失败: ${r?.error ?? '未知'}`);
    }
  }
  // callLLM 已经 export,且支持 statusCb。复用 paper-analyzer 的 SYSTEM_PROMPT。
  const summary = await callLLM(entry.title, entry.summary, text!, cfg, () => { /* status silent */ });
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
  // PR-3:stage=topic_chat(单论文 chat)。
  const chatRoute = resolveRoute('topic_chat');
  const response = await callChatCompletion({ ...cfg, model: chatRoute.model }, {
    messages,
    temperature: chatRoute.temperature,
    signal: inFlightController?.signal,
  });
  let content: string = response.content ?? '';
  if (!content) throw new Error('LLM 返回为空');
  content = content
    .replace(/<\/think>/gi, '')
    .replace(/^```(?:markdown)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  return content;
}

async function chatWithReport(
  report: TopicReport,
  topic: string,
  summaries: Summary[],
  question: string,
  history: ChatMsg[],
): Promise<string> {
  const cfg = loadSettings() as LLMConfig;
  if (!cfg.apiKey) throw new Error('请先在设置页填 LLM API Key');

  // 把整份报告 + 已用论文速览拼成 sysContext,长度可控
  const dimLines = report.dimensions
    .map(
      (d, i) =>
        `[维度 ${i + 1}] ${d.name}` +
        (d.description ? ` — ${d.description}` : '') +
        '\n' +
        d.papers
          .map(
            (p) =>
              `  - arXiv:${p.arxivId} — role=${p.role} — key=${p.key}` +
              (p.method ? `\n    方法:${p.method}` : '') +
              (p.result ? `\n    结果:${p.result}` : '') +
              (p.note ? `\n    注:${p.note}` : ''),
          )
          .join('\n'),
    )
    .join('\n');
  const sysContext =
    `[研究主题] ${topic}\n` +
    `[主题报告 — 生成于 ${new Date(report.generatedAt).toLocaleString()}]\n` +
    `[覆盖论文数] ${report.relatedArxivIds.length}\n\n` +
    `[主题总览]\n${report.overview}\n\n` +
    `[论文横向对比]\n${dimLines}\n\n` +
    (report.sharedFindings.length ? `[共同发现]\n${report.sharedFindings.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}\n\n` : '') +
    (report.gaps.length ? `[研究空白]\n${report.gaps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}\n\n` : '') +
    (report.nextSteps.length ? `[下一步建议]\n${report.nextSteps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}\n\n` : '') +
    `[可引用的论文速览(节选)] —— 供你(模型)在回答细节问题时交叉验证:\n` +
    summaries
      .slice(0, 30)
      .map(
        (s, i) =>
          `  ${i + 1}. arXiv:${s.arxivId} TLDR:${(s.summary.tldr ?? '').slice(0, 200)}\n` +
          `     方法:${(s.summary.method ?? '').slice(0, 200)}` +
          (s.summary.result ? `\n     结果:${(s.summary.result ?? '').slice(0, 200)}` : ''),
      )
      .join('\n');

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: REPORT_CHAT_SYSTEM + '\n\n' + sysContext },
  ];
  for (const m of history.slice(-MAX_QA_FOR_LLM)) messages.push({ role: m.role, content: m.content });
  messages.push({ role: 'user', content: question });
  // PR-3:stage=topic_report_chat(主题报告 chat)。
  const reportChatRoute = resolveRoute('topic_report_chat');
  const response = await callChatCompletion({ ...cfg, model: reportChatRoute.model }, {
    messages,
    temperature: reportChatRoute.temperature,
    signal: inFlightController?.signal,
  });
  let content: string = response.content ?? '';
  if (!content) throw new Error('LLM 返回为空');
  content = content
    .replace(/<\/think>/gi, '')
    .replace(/^```(?:markdown)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  return content;
}

// ============================================================================
// DOM 渲染
// ============================================================================

function setStatus(msg: string, kind: '' | 'error' | 'success' = ''): void {
  const el = $('status-bar');
  el.classList.remove('topic-hidden');
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('success', kind === 'success');
  // spinner + ⏹ 停止按钮只在「确实有任务在飞」(inFlightController 非空) 且非完成态时出现。
  // 之前无条件渲染 spinner,导致每条 ✓ 完成/已复制/已下载 消息都一直转圈,
  // 误导用户以为还在忙。success / error 是明确的终态,永不转圈、永不挂停止按钮。
  const busy = kind === '' && inFlightController !== null;
  const stopBtn = busy
    ? `<button type="button" class="topic-btn ghost" id="status-stop-btn" style="margin-left:auto">⏹ 停止</button>`
    : '';
  const icon = kind === 'error'
    ? '<span>⚠️</span>'
    : kind === 'success'
      ? '<span>✅</span>'
      : busy
        ? '<span class="topic-status-spinner"></span>'
        : '<span>ℹ️</span>';
  el.innerHTML = `${icon}<span>${escapeHtml(msg)}</span>${stopBtn}`;
  if (busy) {
    document.getElementById('status-stop-btn')?.addEventListener('click', stopInFlight);
  }
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

// 全局「⏹ 停止」按钮触发。AbortController 中断正在跑的 LLM fetch / PDF 下载;
// runConcurrent 的 in-flight Promise 会被 reject,然后 doSearch / doSummarize
// 的 finally 把 inFlightController 置 null,UI 状态条变 error。
function stopInFlight(): void {
  if (inFlightController) {
    inFlightController.abort();
    setStatus('⏹ 已停止当前任务', 'error');
  }
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

// 只更新 subq-meta 文本(facet 改选时用,不重绘整列)——与 renderSubqStage 里的逻辑一致。
function refreshSubqMeta(): void {
  if (!current) return;
  const subqMeta = document.getElementById('subq-meta');
  if (!subqMeta) return;
  const selectedCount = current.subqs.filter((s) => s.selected).length;
  const facets = current.facets ?? [];
  if (facets.length > 0) {
    const cov = computeFacetCoverage(facets, current.subqs);
    const covered = facets.length - cov.uncoveredFacetIds.length;
    const parts = [`共 ${current.subqs.length} 个,已选 ${selectedCount}`, `维度覆盖 ${covered}/${facets.length}`];
    if (cov.redundantFacetIds.length > 0) parts.push(`${cov.redundantFacetIds.length} 个可能重复`);
    if (cov.unassignedSubqIds.length > 0) parts.push(`${cov.unassignedSubqIds.length} 个未归属`);
    subqMeta.textContent = parts.join(' · ');
  } else {
    subqMeta.textContent = `共 ${current.subqs.length} 个,已选 ${selectedCount}`;
  }
}

// ============================================================================
// 阶段 2:研究维度(facet)面板
// ============================================================================

// 渲染 facet 面板:每个维度一个 chip(label / category / note 可编辑 + subq 计数 + 状态)。
// 无 facets(旧 session / seed 探索 / legacy 数组 fallback)→ 隐藏面板。
// 输入 input 事件只存值 + 刷新计数,不整块重绘(防丢焦点);增删 / 改 category 才全重绘。
function renderFacetStage(): void {
  const panel = document.getElementById('facet-panel');
  if (!panel) return;
  const facets = current?.facets ?? [];
  if (!current || facets.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const cov = computeFacetCoverage(facets, current.subqs);
  const countByFacet = new Map<string, number>();
  for (const sq of current.subqs) {
    if (sq.facetId) countByFacet.set(sq.facetId, (countByFacet.get(sq.facetId) ?? 0) + 1);
  }

  const meta = document.getElementById('facet-meta');
  if (meta) {
    const covered = facets.length - cov.uncoveredFacetIds.length;
    meta.textContent = `${facets.length} 个维度 · 已覆盖 ${covered}`;
  }

  const catOptions = (sel: FacetCategory): string =>
    (Object.keys(FACET_CATEGORY_LABELS) as FacetCategory[])
      .map((c) => `<option value="${c}"${c === sel ? ' selected' : ''}>${escapeHtml(FACET_CATEGORY_LABELS[c])}</option>`)
      .join('');

  const list = document.getElementById('facet-list');
  if (list) {
    list.innerHTML = facets
      .map((f) => {
        const n = countByFacet.get(f.id) ?? 0;
        const uncovered = n === 0;
        const redundant = n > 1;
        let stateCls = '';
        let stateTag = `<span class="topic-facet-chip-count">${n} 个子方向</span>`;
        if (uncovered) {
          stateCls = ' topic-facet-chip--uncovered';
          stateTag = `<span class="topic-facet-chip-count topic-facet-chip-state--warn" title="没有子方向归属此维度">未覆盖</span>`;
        } else if (redundant) {
          stateCls = ' topic-facet-chip--redundant';
          stateTag = `<span class="topic-facet-chip-count topic-facet-chip-state--warn" title="${n} 个子方向挂在同一维度,可能重复">${n} 个 · 可能重复</span>`;
        }
        return `
        <div class="topic-facet-chip${stateCls}" data-id="${escapeHtml(f.id)}">
          <div class="topic-facet-chip-main">
            <input type="text" class="topic-facet-label-input" data-field="label" value="${escapeHtml(f.label)}" placeholder="研究维度名" aria-label="维度名" />
            <select class="topic-facet-cat-select" data-field="category" aria-label="维度分类">${catOptions(f.category)}</select>
            ${stateTag}
            <button type="button" class="topic-btn ghost topic-facet-del" data-act="del-facet" title="删除此维度(关联子方向变为未分配)">✕</button>
          </div>
          <input type="text" class="topic-facet-note-input" data-field="note" value="${escapeHtml(f.note)}" placeholder="一句话说明这个维度在研究什么" aria-label="维度说明" />
        </div>`;
      })
      .join('');

    // 绑定 chip 交互
    list.querySelectorAll<HTMLElement>('.topic-facet-chip').forEach((chip) => {
      const fid = chip.dataset.id!;
      const facet = current!.facets?.find((f) => f.id === fid);
      if (!facet) return;
      // label / note:input 事件只存值,不重绘(防丢焦点);label 改动后 subq 显示会在下次
      // 重绘时按 facetId 查到最新 label,这里同步刷新已归属 subq 的 facetLabel 缓存。
      chip.querySelector<HTMLInputElement>('[data-field="label"]')?.addEventListener('input', (e) => {
        facet.label = (e.target as HTMLInputElement).value.slice(0, 60);
        for (const sq of current!.subqs) if (sq.facetId === fid) sq.facetLabel = facet.label;
        persistSession(current!);
      });
      chip.querySelector<HTMLInputElement>('[data-field="note"]')?.addEventListener('input', (e) => {
        facet.note = (e.target as HTMLInputElement).value.slice(0, 180);
        persistSession(current!);
      });
      // category 改动 → 全重绘(顺带更新分类显示)
      chip.querySelector<HTMLSelectElement>('[data-field="category"]')?.addEventListener('change', (e) => {
        const raw = (e.target as HTMLSelectElement).value;
        facet.category = raw as FacetCategory;
        renderFacetStage();
        persistSession(current!);
      });
      // 删除维度:关联 subq 变为未分配(不删 subq / 候选 / 总结)
      chip.querySelector<HTMLButtonElement>('[data-act="del-facet"]')?.addEventListener('click', () => {
        current!.facets = (current!.facets ?? []).filter((f) => f.id !== fid);
        for (const sq of current!.subqs) {
          if (sq.facetId === fid) {
            sq.facetId = undefined;
            sq.facetLabel = undefined;
          }
        }
        if (current!.facets.length === 0) current!.facets = undefined;
        renderFacetStage();
        renderSubqStage();
        persistSession(current!);
      });
    });
  }

  // coverage 文字提示
  const covEl = document.getElementById('facet-coverage');
  if (covEl) {
    const msgs: string[] = [];
    if (cov.uncoveredFacetIds.length > 0) {
      const names = cov.uncoveredFacetIds
        .map((id) => facets.find((f) => f.id === id)?.label || id)
        .join('、');
      msgs.push(`未覆盖:${names}`);
    }
    if (cov.redundantFacetIds.length > 0) {
      const names = cov.redundantFacetIds
        .map((id) => facets.find((f) => f.id === id)?.label || id)
        .join('、');
      msgs.push(`可能重复:${names}`);
    }
    if (cov.unassignedSubqIds.length > 0) {
      msgs.push(`${cov.unassignedSubqIds.length} 个子方向尚未归属任何维度`);
    }
    if (msgs.length === 0) {
      covEl.className = 'topic-facet-coverage topic-facet-coverage--ok';
      covEl.textContent = `已覆盖全部 ${facets.length} 个维度,未发现明显重复。`;
    } else {
      covEl.className = 'topic-facet-coverage topic-facet-coverage--warning';
      covEl.textContent = msgs.join(' · ') + '(仅提示,不影响搜索;可在下方子方向卡片改归属)';
    }
  }
}

// 阶段 2 底部「添加维度」按钮:新增一个空维度供用户手填。
function addFacet(): void {
  if (!current) return;
  if (!current.facets) current.facets = [];
  current.facets.push(buildFacet({ id: uid('facet'), label: '新维度', category: 'method', note: '' }));
  renderFacetStage();
  renderSubqStage();
  persistSession(current!);
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
  const facets = current.facets ?? [];
  const hasFacets = facets.length > 0;
  // 覆盖自检 → subq-meta 追加摘要
  if (hasFacets) {
    const cov = computeFacetCoverage(facets, current.subqs);
    const covered = facets.length - cov.uncoveredFacetIds.length;
    const parts = [`共 ${current.subqs.length} 个,已选 ${selectedCount}`, `维度覆盖 ${covered}/${facets.length}`];
    if (cov.redundantFacetIds.length > 0) parts.push(`${cov.redundantFacetIds.length} 个可能重复`);
    if (cov.unassignedSubqIds.length > 0) parts.push(`${cov.unassignedSubqIds.length} 个未归属`);
    subqMeta.textContent = parts.join(' · ');
  } else {
    subqMeta.textContent = `共 ${current.subqs.length} 个,已选 ${selectedCount}`;
  }
  searchBtn.disabled = selectedCount === 0;
  // 构造 facet <select> 的 option 列表(仅在有 facets 时展示;无 facets → 旧布局)
  const facetOptionsFor = (sel?: string): string =>
    `<option value=""${!sel ? ' selected' : ''}>未分配维度</option>` +
    facets
      .map(
        (f) =>
          `<option value="${escapeHtml(f.id)}"${sel === f.id ? ' selected' : ''}>${escapeHtml(f.label || f.id)}</option>`,
      )
      .join('');
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
    // arXiv 命中标签:hitCount undefined → "验证中...";0 → 红色 0 命中;>=1 → 绿色 N 篇
    let hitTag = '';
    let cardClass = q.selected ? 'selected' : '';
    if (q.hitCount === undefined) {
      hitTag = '<span class="topic-subq-hit topic-subq-hit--pending">arXiv 验证中…</span>';
    } else if (q.hitCount === 0) {
      hitTag = `<span class="topic-subq-hit topic-subq-hit--zero" title="主 query 在 arXiv 上 0 召回,试试改英文关键词或加更多 aliases">⚠ 0 命中</span>`;
      cardClass += ' topic-subq-card--zero-hit';
    } else {
      hitTag = `<span class="topic-subq-hit topic-subq-hit--ok" title="实测 arXiv 前 5 条命中 ${q.hitCount} 篇${q.hitSamples?.length ? '\\n样例:\\n' + q.hitSamples.slice(0, 3).join('\\n') : ''}">arXiv 命中 ${q.hitCount} 篇</span>`;
    }
    return `
    <div class="topic-subq-card ${cardClass}" data-id="${q.id}">
      <input type="checkbox" class="topic-subq-check" ${q.selected ? 'checked' : ''} aria-label="勾选子方向 ${i + 1}" />
      <div class="topic-subq-card-main">
        <div class="topic-subq-card-row">
          <input type="text" class="label-input" value="${escapeHtml(q.label)}" data-field="label" placeholder="子方向标题" />
          ${badgeHtml}
          ${sourceTag}
          ${hitTag}
          <div class="topic-subq-card-actions">
            <button type="button" class="topic-btn ghost" data-act="verify-hit" title="用当前 query 实测 arXiv 命中数">🔬 验证</button>
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
        ${hasFacets ? `<div class="topic-subq-card-row topic-subq-card-facet-row">
          <label class="topic-subq-facet-label">研究维度</label>
          <select class="facet-select" data-field="facetId" aria-label="子方向 ${i + 1} 归属研究维度">${facetOptionsFor(q.facetId)}</select>
        </div>` : ''}
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
    // facet 归属下拉:改选同步 facetId + facetLabel,只刷新 meta / facet panel 计数,
    // 不整块重绘 subq 列表(避免用户正在编辑其它输入框时丢焦点)。
    card.querySelector<HTMLSelectElement>('.facet-select')?.addEventListener('change', (e) => {
      const fid = (e.target as HTMLSelectElement).value || undefined;
      subq.facetId = fid;
      subq.facetLabel = fid ? current!.facets?.find((f) => f.id === fid)?.label : undefined;
      // 只更新 meta 与 facet 计数/覆盖提示,不重绘卡片
      refreshSubqMeta();
      renderFacetStage();
      persistSession(current!);
    });
    card.querySelector<HTMLButtonElement>('[data-act="del"]')!.addEventListener('click', () => {
      current!.subqs = current!.subqs.filter((s) => s.id !== id);
      delete current!.candidatesBySubq[id];
      current!.summaries = current!.summaries.filter((s) => s.subqId !== id);
      renderFacetStage(); // 删子方向会改变 facet 覆盖计数/未覆盖状态,同步刷新面板
      renderSubqStage();
      renderCandStage();
      renderSummaryStage();
      renderSessionMeta();
      persistSession(current!);
    });
    card.querySelector<HTMLButtonElement>('[data-act="verify-hit"]')!.addEventListener('click', async () => {
      if (!current) return;
      const btn = card.querySelector<HTMLButtonElement>('[data-act="verify-hit"]')!;
      btn.disabled = true;
      setStatus(`🔬 实测 arXiv: ${subq.label}...`);
      try {
        const { count, samples } = await validateSubqHitCount(subq.query);
        subq.hitCount = count;
        subq.hitSamples = samples;
        renderSubqStage();
        persistSession(current!);
        setStatus(count > 0 ? `✓ 命中 ${count} 篇` : '⚠ 0 命中 — 改 query 或加 aliases', count > 0 ? 'success' : '');
      } catch (e) {
        setStatus(`验证失败: ${(e as Error).message}`, 'error');
      } finally {
        btn.disabled = false;
      }
    });
    card.querySelector<HTMLButtonElement>('[data-act="regen"]')!.addEventListener('click', async () => {
      if (!current) return;
      try {
        inFlightController = new AbortController();
        setStatus(`重新生成子方向 ${subq.label}...`);
        const newOne = await decomposeIdea(current.topic);
        if (newOne.subqs.length > 0) {
          // regen 路径走 buildRegenSubQ:label/query/reason 用 LLM 新值;
          // aliases/explorationType/hitCount/hitSamples/facetId 等"用户手动 / 阶段 3 实测"的值
          // 沿用 base(LLM 一次性产出不应覆盖)。这避免了 [[feedback_subq_fields_whitelist]]
          // 在 regen 路径上的字段漏拷。整套 newOne.facets 只用于找 replacement,不覆盖
          // current.facets(用户可能已编辑过维度)。
          const merged = buildRegenSubQ({ base: subq, replacement: newOne.subqs[0] });
          Object.assign(subq, merged);
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
  const summarizeTopBtn = $<HTMLButtonElement>('summarize-top-btn');
  const summarizeAllBtn = $<HTMLButtonElement>('summarize-all-btn');
  const filterCandBtn = $<HTMLButtonElement>('filter-cand-btn');
  if (!current || Object.keys(current.candidatesBySubq).length === 0) {
    wrap.innerHTML = '<div style="color:var(--fg-subtle);font-size:0.88rem">尚未搜索 — 在第 2 步勾选子方向后点"📚 搜索论文"。</div>';
    meta.textContent = '尚未搜索';
    summarizeBtn.disabled = true;
    summarizeTopBtn.disabled = true;
    summarizeAllBtn.disabled = true;
    filterCandBtn.disabled = true;
    return;
  }
  const allCands: Candidate[] = [];
  for (const list of Object.values(current.candidatesBySubq)) allCands.push(...list);
  const selected = allCands.filter((c) => c.selected).length;
  summarizeBtn.disabled = selected === 0;
  summarizeTopBtn.disabled = selected === 0;
  summarizeAllBtn.disabled = selected === 0;
  // 「总结全部」按钮显示实际待总结数(去重后的 selected 数)
  summarizeAllBtn.textContent = `🚀 总结全部 (${selected})`;
  // AI 筛按钮:候选数 ≥ 10 才启用(太少没意义)
  filterCandBtn.disabled = allCands.length < 10;
  // 全局「全部展开/收起」:展开的 group 数 = sum(expanded[id] === true);默认折叠。
  // 整个 stage 至少有一个 group,这个判断才有意义。
  const subqIds = Object.keys(current.candidatesBySubq);
  const expandedCount = subqIds.filter((id) => current!.candGroupExpanded?.[id] === true).length;
  const allExpanded = expandedCount === subqIds.length && subqIds.length > 0;
  meta.innerHTML = `共 ${allCands.length} 篇候选,已选 ${selected}` +
    (subqIds.length > 0
      ? ` · <a href="#" data-act="expand-all-grps" style="margin-left:0.4rem">${allExpanded ? '全部收起' : '全部展开'}</a>`
      : '');
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
    // group header 点击折叠/展开 — 仅命中>0 的 group 才有意义(0 命中已显示 emptyHint)
    const header = grp.querySelector<HTMLElement>('[data-act="toggle-grp"]');
    header?.addEventListener('click', (e) => {
      // 点 "全选/全不选" 链接时不应该触发折叠,链接自己阻止冒泡即可;这里再保险一次
      if ((e.target as HTMLElement).closest('[data-act="toggle-all"]')) return;
      if (!current!.candGroupExpanded) current!.candGroupExpanded = {};
      current!.candGroupExpanded[subqId] = !(current!.candGroupExpanded[subqId] === true);
      renderCandStage();
      persistSession(current!);
    });
  });
  // 全局「全部展开/收起」:链接嵌在 #cand-meta.innerHTML 里,这里绑事件。
  $('cand-meta').querySelector<HTMLElement>('[data-act="expand-all-grps"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!current!.candGroupExpanded) current!.candGroupExpanded = {};
    const target = !allExpanded; // 当前全部展开 → 点一下 = 全部收起
    for (const id of subqIds) current!.candGroupExpanded[id] = target;
    renderCandStage();
    persistSession(current!);
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
  // 默认折叠:用户研究主题时常有 80+ 篇候选,一次性全展开视觉密度太大;
  // 折叠状态从 current.candGroupExpanded 读,缺省视为折叠(老 session / 第一次搜索)。
  const expanded = current!.candGroupExpanded?.[subqId] === true;
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
  const chevron = expanded ? '▾' : '▸';
  return `
    <div class="topic-candidate-group ${expanded ? 'expanded' : 'collapsed'}" data-subq="${subqId}">
      <div class="topic-candidate-group-header" data-act="toggle-grp">
        <div class="topic-candidate-group-title"><span class="topic-candidate-group-chevron">${chevron}</span> 📂 ${escapeHtml(label)}</div>
        <div class="topic-candidate-group-meta">${metaHtml}</div>
      </div>
      ${queryLine}
      ${list.length === 0 ? emptyHint : expanded ? `<div class="topic-candidate-list">${itemsHtml}</div>` : ''}
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
    ${renderReportNextStepsHTML()}
  `;
}

// 报告生成完后的「下一步」操作面板:导出 / 重新生成 / 补论文增量更新 / 追问报告
function renderReportNextStepsHTML(): string {
  return `
    <section class="topic-report-next-steps">
      <h3>👉 下一步可以做什么</h3>
      <p class="topic-report-next-steps-hint">报告已经生成。下面是常见的几种后续操作,挑一个继续:</p>
      <div class="topic-report-next-steps-actions">
        <button type="button" class="topic-btn primary" data-act="report-dl">💾 下载报告 .md</button>
        <button type="button" class="topic-btn ghost" data-act="report-copy">📋 复制为 Markdown</button>
        <button type="button" class="topic-btn ghost" data-act="report-regen">🔄 用相同速览重新生成报告</button>
        <button type="button" class="topic-btn ghost" data-act="report-add-more">➕ 去阶段 3 补论文(完成后会触发增量更新)</button>
        <button type="button" class="topic-btn ghost" data-act="report-edit-topic">↩ 改思路重新探索(回到阶段 1)</button>
      </div>
      <div class="topic-report-chat" data-role="report-chat">
        <div class="topic-report-chat-head">
          <button type="button" class="topic-btn ghost" data-act="toggle-report-chat">💬 追问 / 修改报告</button>
          <span class="topic-report-chat-hint">围绕这份报告提问,或让模型给出修改建议后点「应用此修改」</span>
        </div>
        <div class="topic-chat topic-hidden" data-role="report-chat-body">
          <div class="topic-chat-history" data-role="report-chat-history"></div>
          <div class="topic-chat-input">
            <input type="text" placeholder="例如:为什么把 ASE 归到「表征学习」? / 把共同发现第 2 条改得更具体" />
            <button type="button" class="topic-btn primary" data-act="send-report-chat">发送</button>
          </div>
          <div class="topic-chat-foot">
            <span>本地仅保留最近 ${MAX_QA_FOR_REPORT} 轮</span>
            <button type="button" class="topic-btn ghost" data-act="apply-report-suggestion">📥 应用最近一轮「修改建议」并重新生成报告</button>
            <button type="button" class="topic-btn ghost" data-act="clear-report-chat">清空追问</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderReportStage(): void {
  const meta = $('report-meta');
  const out = $('report-output');
  const genBtn = $<HTMLButtonElement>('report-gen-btn');
  const copyBtn = $<HTMLButtonElement>('report-copy-btn');
  const dlBtn = $<HTMLButtonElement>('report-download-btn');
  const n = current?.summaries.length ?? 0;
  if (!current || n === 0) {
    meta.textContent = '需要先有至少 1 篇速览';
    genBtn.disabled = true;
    copyBtn.disabled = true;
    dlBtn.disabled = true;
    out.innerHTML = '<div class="topic-empty">尚未总结 — 在第 4 步完成速览后再来生成报告。</div>';
    return;
  }
  genBtn.disabled = false;
  if (!current.report) {
    meta.textContent = '尚未生成';
    copyBtn.disabled = true;
    dlBtn.disabled = true;
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
  dlBtn.disabled = false;
  out.innerHTML = renderReportToHTML(r, refSeeds);
  // 阶段 5 报告生成后:绑「下一步」面板 + 报告追问 chat 事件
  bindReportNextStepsActions(out);
  renderReportChat();
}

// 把「下一步」面板里的按钮 / 报告追问 chat 控件事件一次性绑好。
// out.innerHTML 每次 renderReportStage 都会被重写,所以每次重渲染后都要重新绑一次。
function bindReportNextStepsActions(out: HTMLElement): void {
  out.querySelector<HTMLButtonElement>('[data-act="report-dl"]')?.addEventListener('click', () => downloadReportAsMarkdown());
  out.querySelector<HTMLButtonElement>('[data-act="report-copy"]')?.addEventListener('click', () => copyReportAsMarkdown());
  out.querySelector<HTMLButtonElement>('[data-act="report-regen"]')?.addEventListener('click', () => doGenerateReport());
  out.querySelector<HTMLButtonElement>('[data-act="report-add-more"]')?.addEventListener('click', () => {
    ($('stage-candidates') as HTMLDetailsElement).open = true;
    ($('stage-candidates') as HTMLDetailsElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('📚 去阶段 3 勾选/搜索新论文,完成后回这里会自动增量更新报告');
  });
  out.querySelector<HTMLButtonElement>('[data-act="report-edit-topic"]')?.addEventListener('click', () => {
    ($('stage-input') as HTMLDetailsElement).open = true;
    ($('stage-input') as HTMLDetailsElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('↩ 回到阶段 1 改思路,点「🔍 拆解思路」会重新跑后续阶段');
  });

  const toggleBtn = out.querySelector<HTMLButtonElement>('[data-act="toggle-report-chat"]');
  const chatBody = out.querySelector<HTMLElement>('[data-role="report-chat-body"]');
  toggleBtn?.addEventListener('click', () => {
    if (!chatBody) return;
    chatBody.classList.toggle('topic-hidden');
    if (!chatBody.classList.contains('topic-hidden')) {
      // 展开时自动滚动到 chat 区域
      chatBody.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  const sendBtn = out.querySelector<HTMLButtonElement>('[data-act="send-report-chat"]');
  const input = out.querySelector<HTMLInputElement>('[data-role="report-chat-body"] .topic-chat-input input');
  const doSend = () => void doSendReportChat();
  sendBtn?.addEventListener('click', doSend);
  input?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); doSend(); }
  });
  out.querySelector<HTMLButtonElement>('[data-act="clear-report-chat"]')?.addEventListener('click', () => doClearReportChat());
  out.querySelector<HTMLButtonElement>('[data-act="apply-report-suggestion"]')?.addEventListener('click', () => doApplyReportSuggestion());
}

function renderReportChat(): void {
  if (!current) return;
  const historyEl = document.querySelector<HTMLElement>('[data-role="report-chat-history"]');
  if (!historyEl) return;
  const msgs = current.reportChats ?? [];
  if (msgs.length === 0) {
    historyEl.innerHTML = '<div class="topic-chat-empty">还没有追问 — 输入问题开始,或要求模型给「修改建议」</div>';
    return;
  }
  historyEl.innerHTML = msgs.map((m) => `
    <div class="topic-chat-msg ${m.role}">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
  `).join('');
  historyEl.scrollTop = historyEl.scrollHeight;
}

function renderAll(): void {
  renderSessionMeta();
  renderInputStage();
  renderFacetStage();
  renderSubqStage();
  renderCandStage();
  renderSummaryStage();
  // PR-6: 可选 Elo 辩论 stage（默认 disabled,topic.v2.enabled=true 才走）
  // renderDebateStage 在 topic-search-v2.ts 内导出,实现细节看那里。
  // 此处不阻塞 v1 流程：dynamic import 失败 / enabled=false 都直接跳过。
  renderDebateStageSafe();
  renderReportStage();
  updateSeedsCounter();
}

/** PR-6: 动态 import 包装,默认 enabled=false 时 noop,失败不抛。
 *
 * v2 renderDebateStage 是 fire-and-forget：内部自己跑 Elo + 写 localStorage + 可视化。
 * 我们的接入点只确保：(1) 启用检查；(2) 调用安全。
 */
function renderDebateStageSafe(): void {
  if (!current) return;
  const cfg = (loadSettings() as unknown as { topic?: { v2?: { enabled?: boolean } } }) || {};
  if (!cfg.topic?.v2?.enabled) return;
  // 从 current.summaries 抽出 idea-like 输入（每个 summary 视作一个 idea 候选）
  const ideas: Array<Record<string, unknown>> = (current.summaries || []).map((s) => ({
    id: s.arxivId,
    title: s.title,
    elo_rating: 1200,
  }));
  import('./topic-search-v2')
    .then((mod) => mod.renderDebateStage(current!.id, ideas))
    .then(() => {
      // v2 renderDebateStage 内部已写 localStorage；这里仅同步到 TopicSession.debateProgress
      // 字段（如果用户切 session 后还查得到）。
      // 真正写盘由 saveDebateProgress 完成；UI 重新渲染由下次 renderAll 触发。
    })
    .catch((e) => console.warn('[topic.v2] renderDebateStage skipped:', e));
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
  const startedAt = Date.now();
  setStatus(`📊 正在为 ${n} 篇论文生成主题报告...`);
  // 等计时器:报告生成是单次 LLM 调用 + 最多 2 次重试,30s-3min 没中间反馈,
  // 状态条加个「已等待 X 秒」让用户知道还活着。
  let elapsedTick = 0;
  const waitTimer = setInterval(() => {
    elapsedTick += 5;
    setStatus(`📊 正在为 ${n} 篇论文生成主题报告... (已等待 ${elapsedTick}s)`);
  }, 5000);
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
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    setStatus(
      `✓ 报告完成 · ${report.dimensions.length} 个维度 · ${report.relatedArxivIds.length} 篇论文 · 耗时 ${seconds}s`,
    );
    setTimeout(clearStatus, 2500);
  } catch (e) {
    setStatusErrorWithAction(`生成报告失败: ${(e as Error).message}`, '🔄 重试', () => doGenerateReport());
  } finally {
    clearInterval(waitTimer);
    ($<HTMLButtonElement>('report-gen-btn')).disabled = false;
    inFlightController = null;
  }
}

// ============================================================================
// 报告追问 / 修改建议(阶段 5 chat)
// ============================================================================

async function doSendReportChat(): Promise<void> {
  if (!current?.report) {
    setStatus('需要先有报告才能追问 — 请先生成报告', 'error');
    return;
  }
  const input = document.querySelector<HTMLInputElement>('[data-role="report-chat-body"] .topic-chat-input input');
  if (!input) return;
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  if (!current.reportChats) current.reportChats = [];
  current.reportChats.push({ role: 'user', content: q, ts: Date.now() });
  if (current.reportChats.length > MAX_QA_FOR_REPORT) {
    current.reportChats = current.reportChats.slice(-MAX_QA_FOR_REPORT);
  }
  renderReportChat();
  persistSession(current!);

  const sendBtn = document.querySelector<HTMLButtonElement>('[data-act="send-report-chat"]');
  if (sendBtn) sendBtn.disabled = true;
  setStatus('💬 报告追问中...');
  try {
    inFlightController = new AbortController();
    const a = await chatWithReport(
      current.report,
      current.topic,
      current.summaries,
      q,
      current.reportChats.slice(0, -1), // 不含本轮 user 消息
    );
    current.reportChats.push({ role: 'assistant', content: a, ts: Date.now() });
    if (current.reportChats.length > MAX_QA_FOR_REPORT) {
      current.reportChats = current.reportChats.slice(-MAX_QA_FOR_REPORT);
    }
    renderReportChat();
    persistSession(current!);
    setStatus('✓ 追问完成', 'success');
    setTimeout(clearStatus, 1500);
  } catch (e) {
    setStatusErrorWithAction(`追问失败: ${(e as Error).message}`, '🔄 重试', () => doSendReportChat());
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    inFlightController = null;
  }
}

function doClearReportChat(): void {
  if (!current) return;
  if (!current.reportChats || current.reportChats.length === 0) return;
  if (!confirm('清空报告追问历史?此操作不可撤销。')) return;
  current.reportChats = [];
  renderReportChat();
  persistSession(current!);
  setStatus('✓ 已清空报告追问', 'success');
  setTimeout(clearStatus, 1500);
}

// 用户点「应用最近一轮修改建议并重新生成报告」
// 实现:从最近一轮 assistant 消息中抽取 user 在前面要求的修改建议,作为 userNotes 拼进
//       generateTopicReport 的 prompt(走 'incremental' 模式保留 prevDimensions),让 LLM
//       基于建议重写报告。如果最近一轮 assistant 并不是修改建议(只是普通回答),则提示用户。
async function doApplyReportSuggestion(): Promise<void> {
  if (!current?.report) return;
  if (!current.reportChats || current.reportChats.length < 2) {
    setStatus('没有可应用的修改建议 — 先在追问里要求模型给出修改建议', 'error');
    return;
  }
  const lastAssistant = [...current.reportChats].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) {
    setStatus('找不到最近一轮模型回复', 'error');
    return;
  }
  // 启发式:assistant 消息以「修改建议」「建议:」或含「改」/「调整」/「重写」等动词开头 → 视为修改建议。
  const isSuggestion = /(修改建议|建议[:：]|建议如下|^[\s\S]*?(改写|调整|把.+改成|把.+换|删除|加上|重排|改.+为))/m.test(lastAssistant.content)
    || /^[「『]/.test(lastAssistant.content.trim());
  if (!isSuggestion) {
    setStatus('最近一轮不是「修改建议」格式,无法应用 — 请明确告诉模型「请给修改建议」', 'error');
    return;
  }
  if (!confirm('将基于最近一轮「修改建议」重新生成报告?原报告会作为 prevDimensions 被复用/扩展。')) return;
  const cfg = loadSettings() as LLMConfig;
  if (!cfg.apiKey) {
    renderBanner('请先在 <a href="/settings/">设置</a> 页面填 LLM API Key。');
    return;
  }
  clearBanner();
  inFlightController = new AbortController();
  ($<HTMLButtonElement>('report-gen-btn')).disabled = true;
  setStatus('🔄 正在按修改建议重生成报告...');
  try {
    // 把建议拼到 topic 后面,作为 userNotes 带入 prompt
    const topicWithNotes =
      current.topic +
      '\n\n【用户上一轮提出的修改建议 — 请基于这些建议重写报告(走 incremental 模式)】\n' +
      lastAssistant.content;
    const newReport = await generateTopicReport(
      topicWithNotes,
      current.summaries,
      cfg,
      'incremental',
      current.report,
    );
    current.report = newReport;
    renderReportStage();
    persistSession(current!);
    setStatus(`✓ 报告已按建议重生成 · ${newReport.dimensions.length} 个维度 · ${newReport.relatedArxivIds.length} 篇`, 'success');
    setTimeout(clearStatus, 2500);
  } catch (e) {
    setStatusErrorWithAction(`应用建议失败: ${(e as Error).message}`, '🔄 重试', () => doApplyReportSuggestion());
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
    const decomposition = await decomposeIdea(idea, seeds);
    current.topic = idea;
    current.subqs = decomposition.subqs;
    current.facets = decomposition.facets.length > 0 ? decomposition.facets : undefined;
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
    const facetNote = current.facets ? ` · ${current.facets.length} 个研究维度` : '';
    setStatus(`✓ 已拆解为 ${decomposition.subqs.length} 个子方向${facetNote}${seedNote}`, 'success');
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
  // 收集 searchForDirection 失败的子方向错误信息(主 query 抛错时附在 subq.searchError)
  const failedDetails = result.err.map((e) => {
    const sq = e.item as SubQ;
    const detail = sq.searchError ? `\n  · ${sq.label}: ${sq.searchError}` : `\n  · ${sq.label}: ${(e.error as Error).message.slice(0, 120)}`;
    return detail;
  }).join('');
  if (result.err.length > 0) {
    const msg = result.err.map((e) => (e.error as Error).message).join('; ');
    if (totalCands === 0) {
      // 完全没拿到论文 — 提示重试 + 给出失败详情
      setStatusErrorWithAction(`所有子方向都未命中(代理或网络问题): ${msg.slice(0, 100)}${failedDetails}`, '🔄 重试', () => doSearch());
    } else {
      setStatus(`部分子方向失败${failedDetails ? ` — 详情:${failedDetails}` : ''},共拿到 ${totalCands} 篇候选`, 'error');
      setTimeout(clearStatus, 3000);
    }
  } else if (totalCands === 0) {
    // 搜索成功但 0 命中 — 提示用户改 query
    setStatusErrorWithAction(`搜索完成但 ${subqsSearched} 个子方向都未命中论文。可能是 query 太冷门,试试改英文关键词。`, '🔄 重新搜索', () => doSearch());
  } else {
    setStatus(`✓ ${subqsHit}/${subqsSearched} 个子方向命中,共 ${totalCands} 篇候选`, 'success');
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

async function doSummarize(limit?: number): Promise<void> {
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

  // top-N 限制:用户论文多时(>100)默认只总结前 N 篇,避免几小时等待;
  // limit = undefined 或 0 = 总结全部;limit = N = 只总结前 N 篇。
  // 排序按 arXiv id 升序(新论文 id 数字更大,放在后面 — 但保持稳定)。
  // 实际排序:candidates 已经按 searchForDirection 的 query+alias 命中顺序排过,
  // 这里直接截前 N 篇,保留命中顺序作为「重要度」近似。
  const totalCandidates = unique.length;
  if (limit && limit > 0 && limit < unique.length) {
    unique.length = limit;
  }
  const totalToSummarize = unique.length;

  // 清掉旧总结(只清这批论文的)
  const ids = new Set(unique.map((p) => p.cand.arxivId));
  current.summaries = current.summaries.filter((s) => !ids.has(s.arxivId));
  // 同步清掉这些 paper 的追问(可选:保留,但 user 可能觉得混乱)
  for (const id of ids) delete current.chats[id];

  ($<HTMLButtonElement>('summarize-btn')).disabled = true;
  ($<HTMLButtonElement>('summarize-top-btn'))?.setAttribute('disabled', 'true');
  ($<HTMLButtonElement>('summarize-all-btn'))?.setAttribute('disabled', 'true');
  inFlightController = new AbortController();
  ($('stage-summaries') as HTMLDetailsElement).open = true;

  // ETA 计算:用前 3 篇的平均耗时做样本,推断剩余。论文很多时(>50)立刻有样本;
  // 论文少时(<5)用 25s 默认估计。
  const startedAt = Date.now();
  const sampleDurations: number[] = [];

  const limitDesc = limit && limit < totalCandidates ? `前 ${totalToSummarize}/${totalCandidates} 篇` : `${totalToSummarize} 篇`;
  setStatus(`🚀 总结 ${limitDesc}(并发 LLM ${SUMMARIZE_CONCURRENCY} + PDF 预热 ${PDF_PREFETCH_CONCURRENCY},流水线)...`);

  // 心跳定时器:LLM 慢时(单篇 30-60s)onProgress 很久不触发,状态条文本
  // 不变 → 用户以为卡住。每 2s 强制刷一次状态条,显示已用时间 + 当前
  // 预热池状态(用 setStatus 重渲染会被 inFlightController 检测逻辑
  // 自动附 ⏹ 停止按钮,顺手做也加在这里)。
  const heartbeat = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const readyN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'ready').length;
    const pendingN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'pending').length;
    const failN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'failed').length;
    const completed = current?.summaries.length ?? 0;
    const prefetchInfo = ` · PDF 预热 ${readyN}/${totalToSummarize} ready` +
      (pendingN > 0 ? ` · ${pendingN} 下载中` : '') +
      (failN > 0 ? ` · ${failN} 失败` : '');
    setStatus(`🚀 总结 ${limitDesc} · 已用 ${formatEta(elapsed)} · 完成 ${completed}/${totalToSummarize}${prefetchInfo}`);
  }, 2000);

  // 阶段 1+2 流水线:PDF 预热和 LLM 总结并发跑(不阻塞等所有 PDF 下完再开 LLM)。
  // 启动一个独立的后台任务跑 PDF 预热(PDF_PREFETCH_CONCURRENCY=6 路并发),
  // LLM 主任务(SUMMARIZE_CONCURRENCY=4 路)同时从 pdfTextCache 拿 text。
  // 每篇 LLM 完成时,顺手把还没预热的 PDF 加入预热队列(由 LLM 阶段的 worker 触发)。
  pdfTextCache.clear();
  // 启动合并式增量报告定时器:每 8s 检查"自从上次报告以来新加了 ≥1 篇",是则触发
  // 一次增量 LLM(避免 4 路 worker 各自触发 LLM 把配额打爆)。
  startIncrementalReportTimer(current);
  // 后台预热任务:fire-and-forget。不 await,跟 LLM 主任务并发。
  void (async () => {
    try {
      await runConcurrent(unique, PDF_PREFETCH_CONCURRENCY, async ({ cand }) => {
        // 如果 cache 里没 pending/ready(可能被 LLM 抢先同步预热过),跳过
        if (pdfTextCache.has(cand.entry.arxivId)) {
          const cur = pdfTextCache.get(cand.entry.arxivId)!;
          if (cur.status !== 'pending') return;
        }
        await prefetchOnePdf(cand.entry);
      });
    } catch (e) {
      console.warn('[topic] prefetch background loop failed:', e);
    }
  })();

  // LLM 阶段:4 路并发跑 summarizeOne。summarizeOne 内部会从 pdfTextCache 拿 text,
  // 拿不到就阻塞同步预热这一篇(预热池同时在跑别的,基本不会撞车)。
  let result: { ok: Array<{ item: { cand: Candidate; subqId: string }; result: Summary }>; err: Array<{ item: { cand: Candidate; subqId: string }; error: Error }> };
  try {
    result = await runConcurrent(
      unique,
      SUMMARIZE_CONCURRENCY,
      async ({ cand, subqId }) => {
        const t0 = Date.now();
        const sum = await summarizeOne(cand.entry, subqId);
        const dt = Date.now() - t0;
        sampleDurations.push(dt);
        return sum;
      },
      (d, total) => {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        // 实时统计预热状态
        const readyN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'ready').length;
        const pendingN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'pending').length;
        const failN = Array.from(pdfTextCache.values()).filter((v) => v.status === 'failed').length;
        let eta = '';
        // ETA 算法:样本 ≥ 5 后用中位数(比均值更稳,不被一两篇异常拖偏),
        // 并且 `remain × median / CONCURRENCY` 上限 6h 防止估算炸(7.7s/篇 × 391 剩 / 4 路
        // = 12.5 分钟,但样本里有 5s 和 60s 混着时均值会跳)。样本 < 5 时只显示已用时间。
        if (sampleDurations.length >= 5) {
          const sorted = [...sampleDurations].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          const remain = Math.max(0, total - d);
          // elapsed / d 给出真实吞吐(秒/篇),比 median/CONCURRENCY 更准(因为
          // LLM 4 路 + PDF 6 路 实际串了 PDF,吞吐不会无限逼近 4×LLM 速度)
          const observedTput = elapsed / Math.max(d, 1); // 秒/篇
          let etaSec = Math.round(observedTput * remain);
          // 钳制:大于 6 小时显示「>6h」提示用户中断
          if (etaSec > 6 * 3600) {
            eta = ` · 已用 ${formatEta(elapsed)} · 预计 >6h(建议 ⏹ 停止,用「总结前 20 篇」)`;
          } else {
            eta = ` · 已用 ${formatEta(elapsed)} · 预计还需 ${formatEta(etaSec)}`;
          }
        } else if (d > 0) {
          eta = ` · 已用 ${formatEta(elapsed)} · 采样中(还需 ${5 - sampleDurations.length} 篇)`;
        }
        const prefetchInfo = ` · PDF 预热 ${readyN}/${total} ready` +
          (pendingN > 0 ? ` · ${pendingN} 下载中` : '') +
          (failN > 0 ? ` · ${failN} 失败` : '');
        setStatus(`🚀 总结 ${limitDesc}... ${d}/${total}${eta}${prefetchInfo}`);
        renderSummaryStage();
        renderSessionMeta();
        // 节流 persistSession:每 5 篇 + 最后 1 篇才写 localStorage,避免 LLM 完成
        // 太频繁时 JSON.stringify + localStorage.setItem 阻塞主线程(主线程挂起
        // 表现为「界面卡住」)
        if (d % 5 === 0 || d === total) {
          persistSession(current!);
        }
      },
      (_item, _idx, sum, err) => {
        if (sum && current) {
          current.summaries.push(sum);
          renderSummaryStage();
          renderSessionMeta();
          persistSession(current!);
          renderReportStage();
          // 增量报告由合并式定时器统一处理(避免 4 路 worker 各自
          // 触发 LLM)。doSummarize 启动时调用 startIncrementalReportTimer。
        } else if (err) {
          console.warn('[topic] summarize failed:', err.message);
        }
      },
    );
  } finally {
    // 任何路径下都清心跳和 controller,避免定时器泄漏
    clearInterval(heartbeat);
    inFlightController = null;
  }

  // 停掉合并式增量报告定时器(doSummarize 结束 = 任务完成,不再触发增量)
  stopIncrementalReportTimer();

  // 等待后台预热结束(避免 cache 在 LLM 完成后被 clear 时还有 pending)。
  // 给预热最多 60s grace period,超时也不阻塞。
  await new Promise((resolve) => {
    const deadline = Date.now() + 60_000;
    const tick = () => {
      const stillPending = Array.from(pdfTextCache.values()).some((v) => v.status === 'pending');
      if (!stillPending || Date.now() > deadline) {
        resolve(undefined);
        return;
      }
      setTimeout(tick, 500);
    };
    tick();
  });

  // 阶段 1 + 2 都已完成,清 PDF 缓存
  const finalPrefetchFailed = Array.from(pdfTextCache.values()).filter((v) => v.status === 'failed').length;
  pdfTextCache.clear();
  if (result.err.length > 0) {
    setStatus(`部分总结失败(${result.err.length}/${totalToSummarize}): ${result.err[0].error.message.slice(0, 100)}${result.err.length > 1 ? ` …` : ''}`, 'error');
  } else {
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    setStatus(`✓ ${limitDesc}总结完成 · 耗时 ${formatEta(seconds)}`, 'success');
    setTimeout(clearStatus, 2000);
  }
  ($<HTMLButtonElement>('summarize-btn')).disabled = false;
  ($<HTMLButtonElement>('summarize-top-btn'))?.removeAttribute('disabled');
  ($<HTMLButtonElement>('summarize-all-btn'))?.removeAttribute('disabled');
  renderSummaryStage();
  renderSessionMeta();
  persistSession(current!);
}

// 把秒数格式化为人类可读:75s / 1m 23s / 1h 5m
function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
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
      // 主题报告也是重任务:输入含 M 篇速览,输出多维度 JSON 对象。给 8000 初始预算。
      // PR-3:stage=topic_report(主题报告)。
      const reportRoute = resolveRoute('topic_report');
      const raw = await callLLMRaw(getActiveReportPrompt(), userPrompt, { ...cfg, model: reportRoute.model }, true, 8000);
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
    setStatus(`✓ 报告已增量更新 · ${newReport.dimensions.length} 个维度`, 'success');
    setTimeout(clearStatus, 2000);
  } catch (e) {
    // 增量失败静默 — 不要打断总结流程
    console.warn('[topic] incremental report draft failed:', (e as Error).message);
    clearStatus();
  }
}

// 合并式增量报告触发:同一 doSummarize 阶段内多篇同时完成时,只触发
// 一次增量报告(避免每篇 worker 各自触发 LLM,4 路并发变 4 路 LLM 并发
// 加 N 次增量 LLM 调用,把 LLM 配额打爆)。
// 机制:setInterval 每 2s 检查一次"距上次报告以来是否新加了 ≥1 篇",
// 是则触发增量报告。否则不触发。任务结束后 clearInterval。
let reportIncTimer: ReturnType<typeof setInterval> | null = null;
let reportIncLastCount = 0;
function startIncrementalReportTimer(s: TopicSession): void {
  stopIncrementalReportTimer();
  reportIncLastCount = s.summaries.length;
  if (!s.report) return; // 没报告就不启动定时器(用户还没点「生成报告」)
  reportIncTimer = setInterval(async () => {
    if (!incrementalReportEnabled()) return;
    if (s.summaries.length === reportIncLastCount) return; // 没人完成
    if (!s.report) return;
    const cur = s.summaries.length;
    reportIncLastCount = cur;
    try {
      const cfg = loadSettings() as LLMConfig;
      if (!cfg.apiKey) return;
      setStatus(`📊 正在增量更新报告(共 ${cur} 篇)...`);
      const newReport = await generateTopicReport(s.topic, s.summaries, cfg, 'incremental', s.report);
      s.report = newReport;
      renderReportStage();
      persistSession(s);
      setStatus(`✓ 报告已增量更新 · ${newReport.dimensions.length} 个维度`, 'success');
      setTimeout(clearStatus, 2000);
    } catch (e) {
      console.warn('[topic] incremental report draft failed:', (e as Error).message);
      clearStatus();
    }
  }, REPORT_INC_THROTTLE_MS);
}
function stopIncrementalReportTimer(): void {
  if (reportIncTimer) {
    clearInterval(reportIncTimer);
    reportIncTimer = null;
  }
}

function buildReportMarkdown(): string | null {
  if (!current?.report) return null;
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
  return lines.join('\n');
}

function copyReportAsMarkdown(): void {
  const md = buildReportMarkdown();
  if (!md) return;
  navigator.clipboard.writeText(md).then(
    () => setStatus('✓ 报告已复制为 Markdown', 'success'),
    () => setStatus('复制失败,请手动选择', 'error'),
  );
}

// 文件名:主题报告-<topic 安全 slug>-<YYYYMMDD-HHmmss>.md
function reportFileName(): string {
  const topicSlug = (current?.topic || '主题探索')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .slice(0, 40)
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'topic';
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `主题报告-${topicSlug}-${stamp}.md`;
}

function downloadReportAsMarkdown(): void {
  const md = buildReportMarkdown();
  if (!md) return;
  try {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reportFileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus('✓ 报告已下载', 'success');
    setTimeout(clearStatus, 2000);
  } catch (e) {
    setStatus(`下载失败: ${(e as Error).message}`, 'error');
  }
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
    () => setStatus('✓ 已复制全部为 Markdown', 'success'),
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
    setStatus(`✓ 已生成 ${subqs.length} 个迁移方向,勾选后搜索 arXiv`, 'success');
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
    setStatus(`✓ 已加入 arXiv:${e.arxivId}`, 'success');
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
  setStatus(`✓ 已加入 arXiv:${canonId}`, 'success');
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
    setStatus('✓ 已恢复上次会话', 'success');
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
  $<HTMLButtonElement>('summarize-btn').addEventListener('click', () => doSummarize());
  // top-N 按钮:论文多时只总结前 20 篇,避免长时间等待(用户可继续追加).
  $<HTMLButtonElement>('summarize-top-btn').addEventListener('click', () => doSummarize(20));
  // 总结全部:不传 limit(走 unique.length 全量).
  $<HTMLButtonElement>('summarize-all-btn').addEventListener('click', () => doSummarize());
  // 阶段 3.5:AI 筛论文 → 从所有候选中选最相关的 30 篇
  $<HTMLButtonElement>('filter-cand-btn').addEventListener('click', () => filterCandidatesByLLM(30));
  $<HTMLButtonElement>('subq-add-btn').addEventListener('click', () => {
    if (!current) return;
    current.subqs.push({
      id: uid('q'),
      label: '新子方向',
      query: '',
      reason: '',
      selected: true,
    });
    renderFacetStage(); // 新子方向未归属任何维度,刷新面板的"未归属"提示
    renderSubqStage();
    persistSession(current!);
  });
  // 阶段 2:添加研究维度(facet)
  document.getElementById('facet-add-btn')?.addEventListener('click', () => addFacet());

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
  $<HTMLButtonElement>('report-download-btn').addEventListener('click', downloadReportAsMarkdown);
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