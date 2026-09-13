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
  reason: string;
  /** 当前是否已在 paperIds */
  inLibrary: boolean;
}

const ARXIV_API = 'https://export.arxiv.org/api/query';
const LLM_BATCH = 15;

/** 同义词扩展词典 —— 解决"RLHF ≠ preference learning"漏召。
 *  key 是归一化关键词(小写),value 是 arXiv 标题/摘要里常出现的同义表达。
 *  仅在 buildArxivQuery 用 inclusionKeywords 时展开。 */
const SYNONYM_DICT: Record<string, string[]> = {
  rlhf: ['preference learning', 'reinforcement learning from human feedback', 'human feedback', 'reward model', 'preference optimization'],
  dpo: ['direct preference optimization', 'preference optimization'],
  ppo: ['proximal policy optimization'],
  cot: ['chain-of-thought', 'chain of thought', 'step-by-step reasoning'],
  'llm-agent': ['language agent', 'tool use', 'function calling', 'tool-augmented'],
  rag: ['retrieval-augmented generation', 'retrieval augmented'],
  mcts: ['monte carlo tree search', 'tree search'],
  'world-model': ['world model', 'learned dynamics', 'forward model'],
  'self-distillation': ['self-distillation', 'self-rewarding', 'self-play', 'self-improvement'],
  'mechanistic-interpretability': ['mechanistic interpretability', 'circuit analysis', 'superposition'],
  steering: ['activation steering', 'steering vector', 'representation engineering'],
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

const SCORE_SYSTEM_PROMPT = (
  '你是文献库筛选助手。给定一个文献库的方向陈述 + 关键词 + 范围 + 锚点论文,'
  + '给每篇候选 arXiv 论文打 0-1 相关度分,并给一句话理由。\n'
  + '评分标准(必须严格按此执行,不允许给 0.6-0.9 的中间分):\n'
  + '• 1.0 分:论文核心贡献直接落在本库方向内,是本领域的原创研究(非跨领域)。\n'
  + '• 0.5 分:论文提到本库核心概念但只是引用/应用/综述/博客,非主要贡献;'
  + '或跨方向论文(用了本方向工具但目标是别的领域)。\n'
  + '• 0.0 分:论文主题与本库方向完全无关,即使标题里有同义词。\n'
  + '• 无法判断时统一给 0.5 分。\n'
  + '注意:\n'
  + '- 锚点论文是本库认可的核心里程碑,与锚点主题/方法/场景相似的论文给 1 分;\n'
  + '- 顶会(NeurIPS/ICML/ICLR/CVPR)不会自动加分,仍要核验内容是否贴库;\n'
  + '- 即使标题不含所有关键词,只要用了相关技术/涉及相关子领域,就给 1 或 0.5,不要给 0。\n'
  + '严格 JSON 输出,无 prose,无 <think>:{"scores":[{"i":1,"s":1.0,"r":"理由必须说明为什么是 0/0.5/1"},...]}'
);

/** LLM 给候选打分。一次最多 LLM_BATCH 篇。 */
async function scoreCandidatesWithLLM(
  lib: UserLibrary,
  candidates: Array<{ arxivId: string; title: string; abstract: string }>,
): Promise<Map<string, { score: number; reason: string }>> {
  const cfg = loadSettings();
  if (!cfg?.apiKey) {
    showToast('请先在设置页配置 LLM key', 'error');
    return new Map();
  }
  const out = new Map<string, { score: number; reason: string }>();
  const url = cfg.baseUrl || 'https://api.minimaxi.com/v1';
  const model = cfg.model || 'MiniMax-M2.7-highspeed';

  for (let i = 0; i < candidates.length; i += LLM_BATCH) {
    const batch = candidates.slice(i, i + LLM_BATCH);
    const anchorList = (lib.definition?.anchors || []).slice(0, 8);
    const anchorSection = anchorList.length > 0
      ? `锚点论文(本库已认可的核心,相似者给 1 分):\n${anchorList.map((a, idx) => `${idx + 1}. ${a.value}${a.note ? ` (${a.note})` : ''}`).join('\n')}\n`
      : '';
    const userMsg = [
      `## 文献库方向`,
      `陈述: ${lib.statement}`,
      lib.inclusionKeywords.length > 0 ? `必须命中关键词: ${lib.inclusionKeywords.join(', ')}` : '',
      (lib.definition?.inScope || []).length > 0 ? `范围内: ${(lib.definition?.inScope || []).join('; ')}` : '',
      (lib.definition?.outOfScope || []).length > 0 ? `范围外: ${(lib.definition?.outOfScope || []).join('; ')}` : '',
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
            { role: 'system', content: SCORE_SYSTEM_PROMPT },
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
        recordUsage(libId, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
      }
      let content = data.choices?.[0]?.message?.content || '';
      // strip <think>
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      // parse JSON
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      const payload = JSON.parse(content.slice(start, end + 1));
      const arr = payload.scores || payload.results || [];
      for (const it of arr) {
        const idx = Number(it.i);
        if (!Number.isFinite(idx) || idx < 1 || idx > batch.length) continue;
        const score = Number(it.s);
        if (!Number.isFinite(score)) continue;
        out.set(batch[idx - 1].arxivId, {
          score: Math.max(0, Math.min(1, score)),
          reason: String(it.r || '').slice(0, 200),
        });
      }
    } catch (e) {
      console.warn('[library-ingest] LLM batch failed', e);
      showToast(`LLM 批量打分失败:${(e as Error).message}`, 'error');
      // 失败也返回空 Map,不阻断其它批
    }
  }
  return out;
}

/** 拉 + 打分,返回 IngestCandidate[]。
 *  - daysBack 默认 30;maxResults 默认 50
 *  - threshold 默认 0.5(过滤低分) */
export async function runIngest(
  libId: string,
  opts: { daysBack?: number; maxResults?: number; threshold?: number } = {},
): Promise<IngestCandidate[]> {
  const lib = getUserLibrary(libId);
  if (!lib) throw new Error(`library ${libId} 不存在`);
  const daysBack = opts.daysBack ?? 30;
  const maxResults = opts.maxResults ?? 50;
  const threshold = opts.threshold ?? 0.5;

  const query = buildArxivQuery(lib);
  if (!query) {
    throw new Error('library 缺关键词 / 范围内主题,无法拼 arXiv 搜索');
  }
  const raws = await fetchArxivCandidates(query, { daysBack, maxResults });
  if (raws.length === 0) return [];

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

  // LLM 打分
  const scores = await scoreCandidatesWithLLM(lib, fresh.map((r) => ({
    arxivId: r.arxivId,
    title: r.title,
    abstract: r.abstract,
  })));

  const candidates: IngestCandidate[] = fresh.map((r) => {
    const cx = canonicalArxivId(r.arxivId) || r.arxivId;
    const meta = scores.get(r.arxivId);
    return {
      cx,
      arxivId: r.arxivId,
      title: r.title,
      authors: r.authors,
      abstract: r.abstract,
      date: r.date,
      score: meta?.score ?? 0,
      reason: meta?.reason ?? '',
      inLibrary: inLib.has(cx),
    };
  });
  // 排序:score 高 → 低
  candidates.sort((a, b) => b.score - a.score);
  return candidates.filter((c) => c.score >= threshold);
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