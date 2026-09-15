// astro-src/scripts/library-ingest.ts
//
// 单库 Ingest —— 对照 Polaris `POST /libraries/{id}/ingest/run` 的轻量版。
//
// Polaris 的 ingest 跑 voyage agent(arXiv + OpenAlex + LLM rerank),周期化拉新论文;
// DPR 浏览器端跑,**手动触发**,简化:
//   1. 读 library.definition.statement + keywords.include + inScope[]
//   2. 用这些拼 arXiv API 的 search_query(OR 拼接),取最近 N 天 / 最多 K 篇
//   3. LLM 给每篇打 relevance_score 0-1,过滤 < threshold 的
//   4. 把候选列表返回 UI,用户逐个决定:
//      - 候选(不加入 paperIds,只 set status='candidate' + relevanceScore/reason)
//      - 纳入(addPaperToLibrary + status='included')
//      - 跳过
//
// 设计取舍:
//   - 全部客户端跑,**不**走服务端 LLM。browser 里调 LLM 走 settings.llmKey。
//   - arXiv API 走 export.arxiv.org,直接 fetch(CORS 不发 ACAO,但本仓库
//     paper-analyzer.ts:972 已经在客户端用过同接口 —— 实测某些代理
//     /some-cors-proxy 起作用。失败 → 弹 toast,不让 UI 卡死。
//   - LLM 打分用一次 batch(最多 30 篇/批),避免单篇 round-trip。
//
// 入口:openIngestModal(libId) 由 user-libraries-ui.ts 在 Govern tab 上绑定。

import { showToast } from './toast';
import { canonicalArxivId } from '../lib/arxiv';
import { loadSettings } from './settings';
import { recordUsage } from '../lib/llm-budget';
import {
  addPaperToLibrary,
  batchSetLibraryPaperMeta,
  getUserLibrary,
  setLibraryPaperMeta,
} from '../lib/user-libraries';
import type { UserLibrary } from '../lib/user-libraries';
import {
  buildAudiencePromptAddendum,
  getAudienceProfile,
  resolveLibraryThreshold,
  type AudienceProfileId,
} from '../lib/library/audience-profiles';

interface IngestCandidate {
  /** canonicalArxivId,去 vN */
  cx: string;
  /** 带 vN 的原 id(用于显示 + 跳 arXiv) */
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  date: string;
  /** LLM 0-1 相关度 */
  score: number;
  /** 0-1 新颖性(用于排序加权:score × (1 + 0.3 × novelty)) */
  novelty?: number;
  reason: string;
  /** 当前是否已在 paperIds */
  inLibrary: boolean;
}

const ARXIV_API = 'https://export.arxiv.org/api/query';
const LLM_BATCH = 15;

/** 同义词扩展词典 —— 解决「RLHF ≠ preference learning」漏召。
 *  key 是归一化关键词(小写),value 是 arXiv 标题/摘要里常出现的同义表达。
 *  仅在 buildArxivQuery 用 inclusionKeywords 时展开。
 *
 *  维护规则(2026-09-14 学者视角审计扩展):
 *    - 每条 3-5 个同义,过度扩展会引入噪音
 *    - 优先选 arXiv 标题/摘要里高频出现的同义表达(而非教科书术语)
 *    - 子领域分类:对齐/训练方法/推理/多模态/评测
 *    - 与 audience-profiles 互不耦合(此为召回层,画像是打分层)
 */
const SYNONYM_DICT: Record<string, string[]> = {
  // --- 对齐 / RLHF ---
  rlhf: ['preference learning', 'reinforcement learning from human feedback', 'human feedback', 'reward model', 'preference optimization'],
  dpo: ['direct preference optimization', 'preference optimization'],
  ppo: ['proximal policy optimization'],
  cot: ['chain-of-thought', 'chain of thought', 'step-by-step reasoning'],
  alignment: ['constitutional AI', 'red teaming', 'AI safety', 'AI governance', 'RLHF safety'],
  // --- 训练方法 ---
  'self-distillation': ['self-distillation', 'self-rewarding', 'self-play', 'self-improvement'],
  'mechanistic-interpretability': ['mechanistic interpretability', 'circuit analysis', 'sparse autoencoder', 'feature attribution', 'activation patching'],
  ssm: ['state space model', 'Mamba', 'selective state space', 'linear recurrent', 'HiPPO'],
  // --- 推理 / 生成 ---
  diffusion: ['flow matching', 'consistency model', 'rectified flow', 'probability flow ODE', 'score-based'],
  // --- 多模态 ---
  multimodal: ['vision-language model', 'VLM', 'MLLM', 'image-to-text', 'visual reasoning'],
  'llm-agent': ['language agent', 'tool use', 'function calling', 'tool-augmented'],
  // --- 检索 / 记忆 ---
  rag: ['retrieval-augmented generation', 'retrieval augmented', 'memory-augmented', 'knowledge retrieval'],
  'long-context': ['128K context', 'million token', 'extended context', 'sparse attention'],
  // --- 评测 ---
  benchmark: ['LMArena', 'MT-Bench', 'AlpacaEval', 'HumanEval', 'Chatbot Arena'],
  // --- RL 经典 ---
  mcts: ['monte carlo tree search', 'tree search'],
  'world-model': ['world model', 'learned dynamics', 'forward model', 'model-based RL'],
  // --- 可控生成 / 表征 ---
  steering: ['activation steering', 'steering vector', 'representation engineering', 'inference-time intervention'],
};

/** 把单个关键词展开成含同义词的列表,长度限制防 arXiv URL 过长。 */
function expandKeyword(k: string): string[] {
  const out = [k];
  const norm = k.toLowerCase().trim();
  for (const [base, syns] of Object.entries(SYNONYM_DICT)) {
    if (norm === base || norm.includes(base) || base.includes(norm)) {
      for (const s of syns) if (!out.includes(s)) out.push(s);
    }
  }
  return out.slice(0, 4); // 每个关键词最多 4 个变体
}

/** 把 library 的 definition + keywords 拼成 arXiv 搜索表达式。
 *  arXiv 查询语法:ti:"keyword" OR abs:"keyword" */
function buildArxivQuery(lib: UserLibrary): string {
  const parts: string[] = [];
  // 1) inScope + goals + questions → 拆词
  const inScope = lib.definition?.inScope || [];
  const goals = lib.definition?.goals || [];
  const questions = lib.definition?.questions || [];
  const stmt = lib.statement;
  // 2) keywords.include 优先(必命中,带同义词扩展);其次 inScope(主题,不展开避免噪音)
  const must = (lib.inclusionKeywords || []).filter(Boolean);
  const should = [...inScope, ...goals, ...questions];
  // 3) arXiv categories 走 cat:cs.LG 这种前缀
  const cats = lib.categories || lib.definition?.keywords?.arxivCategories || [];
  if (cats.length > 0) {
    parts.push(`(${cats.map((c) => `cat:${c}`).join(' OR ')})`);
  }
  if (must.length > 0) {
    // 同义词扩展:每个 inclusionKeyword 展开成多个变体,所有变体 OR 起来
    const expandedGroups = must.map((k) => {
      const variants = expandKeyword(k);
      return `(${variants.map((v) => `ti:"${escapeArxiv(v)}" OR abs:"${escapeArxiv(v)}"`).join(' OR ')})`;
    });
    parts.push(expandedGroups.join(' OR '));
  } else if (should.length > 0) {
    parts.push(`(${should.map((k) => `ti:"${escapeArxiv(k)}" OR abs:"${escapeArxiv(k)}"`).join(' OR ')})`);
  } else if (stmt) {
    // fallback:把 statement 拆词,前 8 个非停用词
    const tokens = stmt.split(/[\s,。、]+/).filter((t) => t.length >= 2).slice(0, 8);
    if (tokens.length > 0) {
      parts.push(`(${tokens.map((k) => `ti:"${escapeArxiv(k)}" OR abs:"${escapeArxiv(k)}"`).join(' OR ')})`);
    }
  }
  return parts.join(' AND ');
}

function escapeArxiv(s: string): string {
  // arXiv API 不喜欢引号内的双引号 —— 保留原字符,其它转义给 url
  return s.replace(/"/g, '');
}

/** 走 arXiv listing API 拉候选。返回 0-30 条 raw entries。 */
async function fetchArxivCandidates(
  query: string,
  opts: { daysBack: number; maxResults: number },
): Promise<Array<{
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  date: string;
}>> {
  // 日期过滤:submittedDate:[YYYYMMDDHHMM TO NOW]
  const now = new Date();
  const past = new Date(now.getTime() - opts.daysBack * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 13); // YYYYMMDDHHMM
  const dateFilter = `submittedDate:[${fmt(past)} TO ${fmt(now)}]`;
  const fullQuery = `(${query}) AND ${dateFilter}`;
  const url = `${ARXIV_API}?search_query=${encodeURIComponent(fullQuery)}&max_results=${opts.maxResults}&sortBy=submittedDate&sortOrder=descending`;

  let resp: Response;
  try {
    resp = await fetch(url, { method: 'GET' });
  } catch (e) {
    throw new Error(`arXiv API 不可达:${(e as Error).message}`);
  }
  if (!resp.ok) throw new Error(`arXiv API HTTP ${resp.status}`);
  const xml = await resp.text();
  return parseArxivList(xml);
}

/** 极简 arXiv list XML 解析。够用即可 —— 字段严格按 arXiv API 输出格式。 */
function parseArxivList(xml: string): Array<{
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  date: string;
}> {
  const out: Array<{
    arxivId: string;
    title: string;
    authors: string[];
    abstract: string;
    date: string;
  }> = [];
  const entries = xml.split(/<entry>/).slice(1);
  for (const raw of entries) {
    const block = raw.split(/<\/entry>/)[0] || raw;
    const idMatch = block.match(/<id>([^<]+)<\/id>/);
    const arxivId = idMatch ? idMatch[1].split('/').pop() || '' : '';
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = block.match(/<summary>([\s\S]*?)<\/summary>/);
    const publishedMatch = block.match(/<published>([^<]+)<\/published>/);
    const authorBlocks = block.match(/<author>\s*<name>([^<]+)<\/name>\s*<\/author>/g) || [];
    const authors = authorBlocks.map((b) => (b.match(/<name>([^<]+)<\/name>/) || [])[1] || '').filter(Boolean);
    if (!arxivId || !titleMatch) continue;
    out.push({
      arxivId,
      title: titleMatch[1].trim().replace(/\s+/g, ' '),
      authors,
      abstract: summaryMatch ? summaryMatch[1].trim().replace(/\s+/g, ' ') : '',
      date: publishedMatch ? publishedMatch[1].slice(0, 10) : '',
    });
  }
  return out;
}

/** 共享 SCORE/RESCORE rubric —— library-ingest.ts 和 library-rescore.ts 都引用同一份。
 *  3 角色审计后融合(2026-09-14):
 *    - 小白视角:措辞小白化(「主要内容」「顺便提到」「根本不涉及」)
 *    - 学者视角:加 0.75 跨方向例外(本方向方法/工具用于其他领域)
 *    - 评分员视角:加跨语言指令 + axes 可选字段
 *
 *  输出 schema:{scores:[{i, s, r, axes?}]}
 *    - s 只允许 0 / 0.5 / 0.75 / 1 四档,严禁中间分
 *    - axes 仅在有读者画像时输出(否则 LLM 容易编轴名)
 */
export const SHARED_SCORING_RUBRIC = [
  '你是文献库筛选助手。给定文献库的方向描述、必命中关键词、范围内主题、范围外主题、锚点论文,',
  '给每篇候选 arXiv 论文打 0-1 相关度分,并给一句话理由。',
  '',
  '## 评分规则(只打 0 / 0.5 / 0.75 / 1 四档,不要中间分)',
  '• 1.0 分:论文主要内容就是这个库的方向,核心贡献直接落在本库方向内。',
  '• 0.75 分:论文将本方向的核心方法/工具/分析框架应用于其他领域',
  '  (例如 mechanistic-interpretability 用于 RLHF 分析);或报告重要负结果。',
  '• 0.5 分:论文顺便提到你的方向,但不是主要内容;或是综述/博客/纯应用。',
  '• 0.0 分:论文主题跟你的方向完全无关,即使标题里有同义词。',
  '• 无法判断时给 0.5。',
  '',
  '## 注意',
  '- 锚点论文是这方向的核心论文,跟它们主题/方法/场景相似的给 1 或 0.75。',
  '- 顶会(NeurIPS/ICML/ICLR/CVPR)不会自动加分,要看内容。',
  '- 即使标题里没出现所有关键词,只要内容涉及相关技术/子领域,就给 1/0.75/0.5,不要给 0。',
  '- 论文标题和摘要都是英文,只按英文内容判断;中文 statement 仅作方向参考。',
  '- 若配置了读者画像,额外输出 axes 字段:{axis_name: 1-5 整数}(轴名见画像定义)。',
  '',
  '## 输出',
  '严格 JSON,无 prose,无 <think>:',
  '{"scores":[{"i":1,"s":1.0,"r":"理由必须说明为什么是 0/0.5/0.75/1"},...]}',
].join('\n');

/** 从 LLM 输出文本里抠 JSON scores[]。
 *  比 indexOf/lastIndexOf 更稳:
 *    1. 先剥 ```json ... ``` markdown fence
 *    2. 再剥 <think>...</think>
 *    3. 抓首对 {...} 区间解析
 *    4. 解析失败时退化为 regex 抓 i/s 字段(保住部分 batch)
 *
 *  返回空数组(永不抛)—— 调用方决定如何处理失败。 */
export function parseScoredJson(content: string): Array<{ i: number; s: number; n?: number; r?: string; axes?: Record<string, number> }> {
  if (!content) return [];
  let cleaned = content
    .replace(/^```json\s*[\s\S]*?```\s*$/gm, '')
    .replace(/^```\s*[\s\S]*?```\s*$/gm, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    const arr = Array.isArray(obj?.scores) ? obj.scores : Array.isArray(obj?.results) ? obj.results : [];
    return arr
      .map((it: { i?: unknown; s?: unknown; n?: unknown; r?: unknown; axes?: unknown }) => {
        const i = Number(it.i);
        const s = Number(it.s);
        if (!Number.isFinite(i) || !Number.isFinite(s)) return null;
        const n = typeof it.n === 'number' ? it.n : undefined;
        const r = typeof it.r === 'string' ? it.r : undefined;
        const axes = it.axes && typeof it.axes === 'object' ? (it.axes as Record<string, number>) : undefined;
        return { i, s, n, r, axes };
      })
      .filter((x: { i: number; s: number; n?: number; r?: string; axes?: Record<string, number> } | null): x is { i: number; s: number; n?: number; r?: string; axes?: Record<string, number> } => x !== null);
  } catch {
    // 兜底:regex 抓 {i:N, s:M} 模式,保住 batch 部分数据
    const out: Array<{ i: number; s: number; n?: number; r?: string }> = [];
    const re = /"i"\s*:\s*(\d+)[^}]*?"s"\s*:\s*([\d.]+)/g;
    let m;
    while ((m = re.exec(cleaned)) !== null) {
      out.push({ i: parseInt(m[1], 10), s: parseFloat(m[2]) });
    }
    return out;
  }
}

/** LLM 给候选打分。一次最多 LLM_BATCH 篇。
 *  返回 {scores, failedBatches} —— failedBatches 让 UI 可显示「部分论文打分失败」。 */
async function scoreCandidatesWithLLM(
  lib: UserLibrary,
  candidates: Array<{ arxivId: string; title: string; abstract: string }>,
  onProgress?: (p: IngestProgress) => void,
): Promise<{ scores: Map<string, { score: number; novelty?: number; reason: string }>; failedBatches: number }> {
  const cfg = loadSettings();
  if (!cfg?.apiKey) {
    showToast('请先在设置页配置 LLM key', 'error');
    return { scores: new Map(), failedBatches: 0 };
  }
  const out = new Map<string, { score: number; novelty?: number; reason: string }>();
  const url = cfg.baseUrl || 'https://api.minimaxi.com/v1';
  const model = cfg.model || 'MiniMax-M2.7-highspeed';
  let failedBatches = 0;
  const total = candidates.length;

  onProgress?.({ stage: 'scoring', pct: 30, message: `正在 LLM 评分 (0/${total})…`, scored: { done: 0, total } });

  for (let i = 0; i < candidates.length; i += LLM_BATCH) {
    const batch = candidates.slice(i, i + LLM_BATCH);
    // 取最后 8 条 anchor(用户最近加的最能反映当前方向;若不足 8 则全部)。
    // 修 2026-09-14 学者视角 P0-3:之前 slice(0,8) 无排序,库 50+ anchor 时随机选 8 篇不稳定。
    const anchorList = (lib.definition?.anchors || []).slice(-8);
    const anchorSection = anchorList.length > 0
      ? `锚点论文(本库已认可的核心,相似者给 1 或 0.75 分):\n${anchorList.map((a, idx) => `${idx + 1}. ${a.value}${a.note ? ` (${a.note})` : ''}`).join('\n')}\n`
      : '';
    // 注入读者画像的 addendum(若有)。prompt 顶部追加"按画像打分"指令。
    const profile = getAudienceProfile(lib.definition?.audienceProfile);
    const audienceSection = profile
      ? buildAudiencePromptAddendum(profile) + '\n'
      : '';
    const userMsg = [
      audienceSection,
      `## 文献库方向`,
      `陈述: ${lib.statement}`,
      lib.inclusionKeywords.length > 0 ? `必须命中关键词: ${lib.inclusionKeywords.join(', ')}` : '',
      // 修 2026-09-14 学者视角 P1-3:Step 3 访谈生成的排除关键词注入 SCORE。
      // 与机械过滤互补:LLM 可识别「论文顺便提到 exclude 关键词」等模糊情况。
      lib.exclusionKeywords.length > 0 ? `排除关键词(命中则低分或 0): ${lib.exclusionKeywords.join(', ')}` : '',
      (lib.definition?.inScope || []).length > 0 ? `范围内: ${(lib.definition?.inScope || []).join('; ')}` : '',
      (lib.definition?.outOfScope || []).length > 0 ? `范围外(语义层不关心): ${(lib.definition?.outOfScope || []).join('; ')}` : '',
      anchorSection,
      '',
      `## 候选论文(本批 ${i + 1}-${i + batch.length}/${candidates.length} 篇)`,
      ...batch.map((c, idx) => `${idx + 1}. ${c.title}\n   abstract: ${c.abstract.slice(0, 400)}`),
      '',
      '## 输出',
      'JSON 对象:{"scores":[{"i":1,"s":1.0,"r":"理由"},...]}',
    ].filter(Boolean).join('\n');

    try {
      const resp = await fetch(`${url.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SHARED_SCORING_RUBRIC },
            { role: 'user', content: userMsg },
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: 4000,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`LLM HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      }
      const data = await resp.json();
      // Record token usage
      const usage = data?.usage;
      if (usage) {
        recordUsage(lib.id, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
      }
      const content = data.choices?.[0]?.message?.content || '';
      // 用统一的 parseScoredJson(2026-09-14 评分员 P0-1:剥 markdown fence + 兜底 regex)
      const items = parseScoredJson(content);
      for (const it of items) {
        const idx = it.i;
        if (idx < 1 || idx > batch.length) continue;
        const score = Math.max(0, Math.min(1, it.s));
        // 提取 novelty(0-1),fallback 到 score/10
        const novelty = typeof it.n === 'number' ? Math.max(0, Math.min(1, it.n)) : score / 10;
        out.set(batch[idx - 1].arxivId, {
          score,
          novelty,
          reason: String(it.r || '').slice(0, 200),
        });
      }
    } catch (e) {
      failedBatches += 1;
      console.warn('[library-ingest] LLM batch failed', e);
      showToast(`LLM 批量打分失败:(${(e as Error).message || 'unknown'})`, 'error');
      // 不阻断其它批 —— 已成功的 out 保留
    }
    // 每批完成后更新进度
    const done = Math.min(i + LLM_BATCH, total);
    onProgress?.({ stage: 'scoring', pct: 30 + Math.round((done / total) * 50), message: `正在 LLM 评分 (${done}/${total})…`, scored: { done, total } });
  }
  return { scores: out, failedBatches };
}

/** 拉 + 打分,返回 IngestCandidate[]。
 *  - daysBack 默认 30;maxResults 默认 50
 *  - threshold 默认 0.5(过滤低分) */
export async function runIngest(
  libId: string,
  opts: {
    daysBack?: number;
    maxResults?: number;
    threshold?: number;
    /** 覆盖 library.definition.audienceProfile,主要给测试用。 */
    audienceProfile?: AudienceProfileId | null;
    /** 进度回调,每个关键阶段触发 */
    onProgress?: (p: IngestProgress) => void;
  } = {},
): Promise<IngestCandidate[]> {
  const { onProgress } = opts;
  const lib = getUserLibrary(libId);
  if (!lib) throw new Error(`library ${libId} 不存在`);
  const daysBack = opts.daysBack ?? 30;
  const maxResults = opts.maxResults ?? 50;
  // 阈值解析顺序:opts.threshold > library.definition.relevanceThreshold > profile.defaultThreshold > 0.5
  const profile = getAudienceProfile(opts.audienceProfile ?? lib.definition?.audienceProfile);
  const threshold = resolveLibraryThreshold({
    profile,
    userThreshold:
      typeof opts.threshold === 'number'
        ? opts.threshold
        : lib.definition?.relevanceThreshold,
  });

  const query = buildArxivQuery(lib);
  if (!query) {
    throw new Error('library 缺关键词 / 范围内主题,无法拼 arXiv 搜索');
  }
  // Stage 1: Fetching from arXiv
  onProgress?.({ stage: 'fetching', pct: 10, message: `正在拉取 arXiv 候选 (${daysBack} 天 / 上限 ${maxResults} 篇)…` });
  const raws = await fetchArxivCandidates(query, { daysBack, maxResults });
  if (raws.length === 0) {
    onProgress?.({ stage: 'done', pct: 100, message: '未找到候选论文' });
    return [];
  }

  // 去重:保留每个 canonicalArxivId 第一条
  const seen = new Set<string>();
  const uniq = raws.filter((r) => {
    const cx = canonicalArxivId(r.arxivId);
    if (!cx || seen.has(cx)) return false;
    seen.add(cx);
    return true;
  });
  // 已经在库内的过滤掉(避免重复展示)
  const inLib = new Set(lib.paperIds);
  const fresh = uniq.filter((r) => !inLib.has(canonicalArxivId(r.arxivId)));

  // LLM 打分(2026-09-14 评分员 P0-5:failedBatches 让 UI 知道漏打分)
  onProgress?.({ stage: 'scoring', pct: 30, message: `正在 LLM 评分 (0/${fresh.length})…`, scored: { done: 0, total: fresh.length } });
  const { scores, failedBatches } = await scoreCandidatesWithLLM(lib, fresh.map((r) => ({
    arxivId: r.arxivId,
    title: r.title,
    abstract: r.abstract,
  })), onProgress);
  if (failedBatches > 0) {
    showToast(`有 ${failedBatches} 批打分失败,候选可能不全`, 'warn');
  }

  const candidates: IngestCandidate[] = fresh.map((r) => {
    const cx = canonicalArxivId(r.arxivId) || r.arxivId;
    const meta = scores.get(r.arxivId);
    // 新颖性 fallback:score/10(如果 LLM 没返回 novelty)
    const novelty = meta?.novelty ?? (meta?.score ?? 0) / 10;
    return {
      cx,
      arxivId: r.arxivId,
      title: r.title,
      authors: r.authors,
      abstract: r.abstract,
      date: r.date,
      score: meta?.score ?? 0,
      novelty,
      reason: meta?.reason ?? '',
      inLibrary: inLib.has(cx),
    };
  });
  // 排序:score × (1 + 0.3 × novelty), novelty fallback = score/10
  onProgress?.({ stage: 'sorting', pct: 85, message: '正在排序…' });
  const weightedScore = (c: IngestCandidate) => c.score * (1 + 0.3 * (c.novelty ?? c.score / 10));
  candidates.sort((a, b) => weightedScore(b) - weightedScore(a));
  const filtered = candidates.filter((c) => c.score >= threshold);
  onProgress?.({ stage: 'done', pct: 100, message: `完成! 找到 ${filtered.length} 篇候选` });
  return filtered;
}

export interface IngestProgress {
  /** 当前阶段: 'fetching' | 'scoring' | 'sorting' | 'done' | 'error' */
  stage: 'fetching' | 'scoring' | 'sorting' | 'done' | 'error';
  /** 当前阶段进度 0-100 */
  pct: number;
  /** 当前状态文字 */
  message: string;
  /** 打分阶段:已处理/总数 */
  scored?: { done: number; total: number };
}

/** 把候选一次性写入 library 的 papers(candidate 状态),不加入 paperIds。
 *  caller 决定后续是否 addPaperToLibrary()(纳入)。 */
export function persistCandidatesAsCandidate(libId: string, candidates: IngestCandidate[]): void {
  if (candidates.length === 0) return;
  batchSetLibraryPaperMeta(
    libId,
    candidates.map((c) => ({
      arxivId: c.cx,
      meta: {
        status: 'candidate',
        relevanceScore: c.score,
        noveltyScore: c.novelty,
        relevanceReason: c.reason,
      },
    })),
  );
}

/** 单条「直接纳入」:加进 paperIds + 设 included status */
export function commitCandidateAsIncluded(libId: string, c: IngestCandidate): void {
  addPaperToLibrary(libId, c.cx);
  setLibraryPaperMeta(libId, c.cx, {
    status: 'included',
    relevanceScore: c.score,
    relevanceReason: c.reason,
  });
}