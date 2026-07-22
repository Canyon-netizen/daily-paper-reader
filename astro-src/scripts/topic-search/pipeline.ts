// topic-search 域逻辑 pipeline —— 从 topic-search.ts 抽出（模块化重构 step 7）。
//
// /topic 页面 5 个阶段背后的纯逻辑：拆解 / 探针 / 子方向搜索 / 改写 / 总结 / 追问。
// 大多数函数是 pure（输入全靠参数）；只有 chatWithPaper / chatWithReport 读 S.getSession()
// 取当前会话，并通过 S.getInFlight() 给 LLM signal 串上 abort。
//
// pdfTextCache 是模块局部缓存（prefetch/summarize 共享），不影响别的模块。
//
// 公开导出：exploreFromSeeds + validateAndRewriteSubqs —— 是历史上被外部 import 的稳定 API，
// orchestrator (../topic-search.ts) 端再 re-export 以保持原 import 路径。

import {
  loadSettings,
  getCustomProxy,
  type SelectionItem,
  type LLMConfig,
} from '../settings';
import {
  searchArxiv,
  fetchArxivPdf,
  fetchWithDiagnosis,
  callLLM,
} from '../paper-analyzer';
import type { ArxivEntry } from '../paper-analyzer';
import { callChatCompletion, resolveRoute } from '../../lib/llm';
import { canonicalArxivId as canonicalId } from '../../lib/dom-utils';
import {
  buildFacet,
  buildSubQ,
  computeFacetCoverage,
  normalizeAliases,
  normalizeQuery,
  type Candidate,
  type ChatMsg,
  type DecomposeLLMResponse,
  type Facet,
  type SubQ,
  type SubqRewrite,
  type Summary,
  type TopicDecomposition,
  type TopicReport,
} from '../../lib/schemas';
import {
  PAPER_CHAT_SYSTEM,
  REPORT_CHAT_SYSTEM,
  SUBQ_REWRITE_SYSTEM,
  getActiveFacetPrompt,
  getActiveExplorePrompt,
} from './prompts';
import { uid, runConcurrent } from './concurrency';
import { callLLMRaw } from './llm-call';
import { S } from './state';

// 喂 LLM 的最近条数（chatWithPaper / chatWithReport 共享）。
const MAX_QA_FOR_LLM = 30;
// 并发上限。注:每篇 summarizeOne 内部含 PDF 下载(走 8123 / arxiv)+ PDF.js 抽文本 +
// LLM 调用三段,瓶颈在 PDF 下载(网络)+ LLM(API 限流),PDF.js worker 共享无锁竞争。
// 上限 4 在本地 8123 + 主流 LLM 下稳定;更高容易被 arXiv 429 / LLM 限流。
export const SUMMARIZE_CONCURRENCY = 4;
// PDF 下载预热池并发上限 — 独立于 LLM 阶段,提前把 PDF 下载 + 抽文本做完,避免
// LLM 阶段被网络 IO 阻塞。预热池跑得比 LLM 池快(没 LLM 限流),6 路够吃满 8123 代理带宽。
export const PDF_PREFETCH_CONCURRENCY = 6;

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

export async function decomposeIdea(idea: string, seeds?: SelectionItem[]): Promise<TopicDecomposition> {
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
export async function validateSubqHitCount(q: string): Promise<{ count: number; samples: string[] }> {
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

// 命中 0 闭环重写:把"0 命中子方向列表 + 主题证据标题 + 其他子方向实测命中样本"反馈给 LLM,
// 让它基于证据改写 0 命中的 query。evidenceTitles 是拆解阶段对整个主题探针得到的真实标题。
async function rewriteZeroHitSubqs(
  zeros: SubQ[],
  samplesByLabel: Map<string, string[]>,
  evidenceTitles: readonly string[],
  cfg: LLMConfig,
): Promise<Map<string, SubqRewrite>> {
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

export async function searchForDirection(subq: SubQ): Promise<Candidate[]> {
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
export const pdfTextCache = new Map<string, { status: 'pending' | 'ready' | 'failed'; text?: string; error?: string; startedAt: number }>();

// 预热一篇 PDF:下载 + 抽文本 → 写入 pdfTextCache。失败写 'failed' + error。
// failed 状态有 5 分钟 TTL:代理刚起来 / 网络瞬断后用户重试,不会被旧错误永远卡死。
export const PREFETCH_FAIL_TTL_MS = 5 * 60_000;
export async function prefetchOnePdf(entry: ArxivEntry): Promise<void> {
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

export async function summarizeOne(entry: ArxivEntry, subqId: string): Promise<Summary> {
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

export async function chatWithPaper(arxivId: string, question: string): Promise<string> {
  const session = S.getSession();
  if (!session) throw new Error('当前无会话');
  const sum = session.summaries.find((s) => s.arxivId === arxivId);
  if (!sum) throw new Error('请先总结这篇论文');
  // 找 entry(可能在 candidatesBySubq 里)
  let entry: ArxivEntry | undefined;
  for (const list of Object.values(session.candidatesBySubq)) {
    const found = list.find((c) => c.arxivId === arxivId);
    if (found) { entry = found.entry; break; }
  }
  if (!entry) throw new Error('找不到这篇论文的元数据');

  const cfg = loadSettings() as LLMConfig;
  const history = (session.chats[arxivId] ?? []).slice(-MAX_QA_FOR_LLM);
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
    signal: S.getInFlight()?.signal,
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

export async function chatWithReport(
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
    signal: S.getInFlight()?.signal,
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