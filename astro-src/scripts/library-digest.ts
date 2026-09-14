// astro-src/scripts/library-digest.ts
//
// 单库每日 Digest —— 对照 Polaris `GET /libraries/{id}/digests/generate` 的轻量版。
//
// Polaris 后端有 research_digest agent + cron 触发 + voyage_runs 记录;
// DPR 浏览器端跑,客户端手动触发 + localStorage 缓存,
//   key: dpr_library_digest_v1:<libId>:<YYYY-MM-DD>
//
// 内容:取库内最近 7 天论文(按 status='included' 过滤),LLM 总结成
// "TL;DR + 主题分组 + 关键发现" 三段 markdown,本地持久化。
//
// 设计:
//   - 缓存命中(<24h)直接读 localStorage;否则调 LLM 重生成。
//   - LLM 输出强 JSON,失败 → 报错并保留旧 cache。
//   - 输入只发 title + 1 行 abstract(避免 token 爆炸),最多 30 篇。

import { showToast } from './toast';
import { loadSettings } from './settings';
import { getUserLibrary } from '../lib/user-libraries';
import { recordUsage } from '../lib/llm-budget';
import type { UserLibrary } from '../lib/user-libraries';

export interface LibraryDigest {
  id: string;          // YYYY-MM-DD
  libId: string;
  /** 'daily' = 4 段 600-1200 字;'academic' = IMRaD 1500-2500 字可投稿级 */
  depth: 'daily' | 'academic';
  generatedAt: number; // epoch ms
  paperCount: number;
  markdown: string;    // 完整 markdown(Polaris 风格 5 段)
  model: string;
}

const CACHE_PREFIX = 'dpr_library_digest_v1:';

function cacheKey(libId: string, date: string): string {
  return `${CACHE_PREFIX}${libId}:${date}`;
}

/** 学术综述 prompt(2026-09-14 重构):从「日报 4 段 + 600-1200 字」升到
 *  「IMRaD 学术综述 + 1500-2500 字 + 可投稿」。
 *
 *  设计目标(用户原话:「最好是能够直接投稿的程度」):
 *    - IMRaD 七段结构:Abstract / Introduction / Methodology / Key Findings /
 *      Discussion / Conclusion / References
 *    - 学术语体:中性 / 克制 / 第三人称 / 不确定处用「可能」「似乎」
 *    - 引用可追溯:每条 finding 必须标注支撑的 arxiv-id
 *    - 不补造实验数字 / 结论
 *    - 不输出 prose 引言 / <think> / 英文
 *    - 输出 JSON,UI 按段渲染(便于编辑 / 导出 / 投稿格式适配)
 *
 *  与 Polaris library.digest_synth 的差异:
 *    - Polaris 是英文 + 极简 JSON,本仓库是中文 + IMRaD 结构化,适配本地学者投稿。
 *
 *  复用:同一 prompt 服务 generateDigest() 与 generateAcademicReport();
 *  depth='daily' 时跑日报轻量版(老 4 段 600-1200 字),depth='academic' 跑本 IMRaD 版。
 */
const DIGEST_SYSTEM_PROMPT_ACADEMIC = [
  '你是学术综述编辑(对照 Nature Perspective / Annual Review of [Field] / Trends in [Discipline] 风格)。',
  '你的产出是**可投稿的中文综述报告**,写给同行学者阅读,不是给小白看的入门解读。',
  '',
  '## 写作风格硬约束',
  '- 中文学术语体:中性 / 克制 / 第三人称;不要「我们」「我」',
  '- 不确定处用「可能」「似乎」「初步证据表明」,不要过度断言',
  '- 句子结构:陈述句为主,长句(20-40 字)优于碎片短句',
  '- 术语首次出现给中英对照(如「思维链(Chain-of-Thought, CoT)」),后续只用中文',
  '- 不补造输入中没有的实验数字 / 结论 / 作者归属',
  '- 不输出 prose 引言 / <think> / 英文整段 / Markdown 代码块包裹整篇',
  '',
  '## 输出结构(IMRaD 七段)',
  '严格按以下 7 个二级标题,顺序不可调换:',
  '',
  '### 1. Abstract(150-200 中文字)',
  '结构:背景 1 句 → 方法 1 句 → 主要发现 2-3 句 → 意义 1 句。',
  '不要分点,用完整段落。最后 1 句结尾给出本文核心贡献。',
  '',
  '### 2. Introduction(80-120 中文字)',
  '- 本库研究方向的 1 句话定位',
  '- 本综述要回答的核心研究问题(1-2 个,问号结尾)',
  '- 综述范围:N 篇论文 / 时间窗 / 主要子方向',
  '',
  '### 3. Methodology(60-100 中文字)',
  '- 文献选取标准:相关性阈值(给具体数字,如 ≥ 0.50)、来源(arXiv)、时间窗',
  '- 综述方法:按主题聚类、跨论文模式识别、研究方法分类',
  '- 不需要详细方法学论证(对照顶会 review section 写法)',
  '',
  '### 4. Key Findings(按 theme 分 3-5 组,共 800-1200 中文字)',
  '每个 theme 一段,结构:',
  '  - 主题名(2-8 字,概括性强)',
  '  - 核心发现(2-3 句话,具体到方法 / 数据 / 结论)',
  '  - 支撑论文:用 [arxiv-id] 引用 2-4 篇,**每条 finding 至少 1 个引用**',
  '  - 与本方向的关联:1 句话点出对本研究方向的启示',
  'theme 间不要重复论文引用(除非有强 cross-cutting 关系)。',
  '',
  '### 5. Discussion(150-250 中文字)',
  '三段式:',
  '  - 跨论文模式:综合 theme 提炼出 2-3 条贯穿性观察',
  '  - 局限性:本库时间窗 / 评分偏差 / 跨语言漏召 / 理论 vs 实验失衡',
  '  - 未来方向:基于本批论文自然延伸的 2-3 个开放问题(问号结尾)',
  '',
  '### 6. Conclusion(60-80 中文字)',
  '3 条 bullet,每条一句,提炼本文最核心的 3 个 takeaway。',
  '不要新引入主题,只综合前文。',
  '',
  '### 7. References',
  '按 theme 内首次引用顺序编号:',
  '  [1] arxiv-id | 标题(英文原题) | 第一作者 et al. | 年份',
  '  [2] ...',
  '只列本文实际引用的论文,不要列输入但没用到的。',
  '',
  '## 总字数与质量',
  '- 总字数 1500-2500 中文字(除 References 外)',
  '- 至少 5 处 [arxiv-id] 内联引用',
  '- 至少 2 个跨论文模式识别(Discussion 段)',
  '- 至少 1 个未来方向(Discussion 段)',
  '',
  '## JSON 输出(严格)',
  '只输出一个 JSON 对象,不要 Markdown 代码块:',
  '{',
  '  "abstract": "...",',
  '  "introduction": "...",',
  '  "methodology": "...",',
  '  "key_findings": [{"theme": "...", "core_finding": "...", "supporting_papers": ["arxiv-id", ...], "relevance": "..."}, ...],',
  '  "discussion": "...",',
  '  "conclusion": ["...", "...", "..."],',
  '  "references": [{"id": "arxiv-id", "title": "英文原题", "authors": "第一作者 et al.", "year": "2025"}]',
  '}',
].join('\n');

const DIGEST_SYSTEM_PROMPT_DAILY = (
  '你是文献库摘要助手。给定一个文献库的方向声明 + 关键词 + 范围内主题,'
  + '以及该库内最近 7 天的 N 篇论文(title + 1 行 abstract),'
  + '写一篇深入浅出的中文 markdown 解读。要求:\n'
  + '## TL;DR(2-3 句话:这批论文共同关注什么,核心结论)\n'
  + '## 主题分组(按方法 / 问题 / 趋势分 2-4 组,每组 2-4 篇,组标题一句)\n'
  + '## 关键发现(3-5 条 bullet,每条一句话,引用论文 arxiv-id)\n'
  + '## 启示与可能的下一步(2-3 句话)\n'
  + '总字数 600-1200 中文字。严禁 prose 引言 / <think> / 英文输出。'
  + '严禁 markdown 代码块包裹整篇;严格按 4 个 ## 二级标题。'
);

interface DigestPaper {
  arxivId: string;
  title: string;
  abstract: string;
  date: string;
  score: number;
}

/** 构造 LLM 输入论文列表:取库内 last 7 天 included 论文。 */
function pickRecentPapers(
  lib: UserLibrary,
  papers: Array<{ canonicalArxivId: string; arxivId?: string; title?: string; title_zh?: string; abstract?: string; evidence?: string; date?: string; score?: number }>,
  daysBack = 7,
  maxN = 30,
): DigestPaper[] {
  const inLib = new Set(lib.paperIds);
  const now = Date.now();
  const cutoff = now - daysBack * 24 * 60 * 60 * 1000;
  const out: DigestPaper[] = [];
  for (const p of papers) {
    if (!inLib.has(p.canonicalArxivId)) continue;
    const meta = lib.papers[p.canonicalArxivId];
    if (meta && meta.status && meta.status !== 'included' && meta.status !== 'scored') continue;
    const ts = p.date ? Date.parse(p.date) : 0;
    if (ts < cutoff) continue;
    const abstract = (p.abstract || p.evidence || '').slice(0, 200).replace(/\s+/g, ' ');
    out.push({
      arxivId: p.arxivId || p.canonicalArxivId,
      title: p.title_zh || p.title || p.canonicalArxivId,
      abstract,
      date: p.date || '',
      score: meta?.relevanceScore ?? p.score ?? 0,
    });
    if (out.length >= maxN) break;
  }
  // 按 score 倒序
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** 读缓存(命中且 <24h 直接返回)。 */
export function loadCachedDigest(libId: string, date: string): LibraryDigest | null {
  try {
    const raw = localStorage.getItem(cacheKey(libId, date));
    if (!raw) return null;
    const d = JSON.parse(raw) as LibraryDigest;
    if (!d.markdown) return null;
    // 老缓存(2026-09-14 之前)无 depth 字段,默认 daily
    if (!d.depth) d.depth = 'daily';
    return d;
  } catch {
    return null;
  }
}

/** LLM 生成 digest。无候选时返回 null + 友好 toast。 */
export async function generateDigest(
  libId: string,
  papers: Array<{ canonicalArxivId: string; arxivId?: string; title?: string; title_zh?: string; abstract?: string; evidence?: string; date?: string; score?: number }>,
  opts: { force?: boolean; daysBack?: number; maxN?: number; depth?: 'daily' | 'academic' } = {},
): Promise<LibraryDigest | null> {
  const lib = getUserLibrary(libId);
  if (!lib) throw new Error(`library ${libId} 不存在`);
  const date = new Date().toISOString().slice(0, 10);
  if (!opts.force) {
    const cached = loadCachedDigest(libId, date);
    if (cached && Date.now() - cached.generatedAt < 24 * 60 * 60 * 1000) {
      return cached;
    }
  }
  const picked = pickRecentPapers(lib, papers, opts.daysBack ?? 7, opts.maxN ?? 30);
  if (picked.length === 0) {
    showToast('最近 7 天库内没有新论文,无需生成 digest', 'info');
    return null;
  }

  const cfg = loadSettings();
  if (!cfg?.apiKey) {
    showToast('请先在设置页配置 LLM key', 'error');
    return null;
  }
  const url = (cfg.baseUrl || 'https://api.minimaxi.com/v1').replace(/\/$/, '');
  const model = cfg.model || 'MiniMax-M2.7-highspeed';

  const depth = opts.depth ?? 'daily';
  const systemPrompt = depth === 'academic' ? DIGEST_SYSTEM_PROMPT_ACADEMIC : DIGEST_SYSTEM_PROMPT_DAILY;
  const maxTokens = depth === 'academic' ? 8000 : 4000;

  const userMsg = [
    `## 文献库`,
    `名称: ${lib.name}`,
    `方向陈述: ${lib.statement}`,
    lib.inclusionKeywords.length > 0 ? `必须命中关键词: ${lib.inclusionKeywords.join(', ')}` : '',
    (lib.definition?.inScope || []).length > 0 ? `范围内: ${(lib.definition?.inScope || []).join('; ')}` : '',
    (lib.definition?.goals || []).length > 0 ? `库目标: ${(lib.definition?.goals || []).join('; ')}` : '',
    '',
    `## 最近 ${picked.length} 篇论文(按相关度倒序)`,
    ...picked.map((p, i) => `${i + 1}. [${p.arxivId}] ${p.title}\n   ${p.date} · score=${p.score.toFixed(2)}\n   ${p.abstract}`),
  ].filter(Boolean).join('\n');

  let content = '';
  try {
    const resp = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
        temperature: depth === 'academic' ? 0.3 : 0.4,
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
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
    content = data.choices?.[0]?.message?.content || '';
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  } catch (e) {
    showToast(`Digest 生成失败:${(e as Error).message}`, 'error');
    return null;
  }

  // Academic 深度:JSON 结构化(abstract/introduction/methodology/key_findings/discussion/conclusion/references)
  // Daily 浅度:JSON 里含 markdown 字段
  let markdown = '';
  if (depth === 'academic') {
    markdown = renderAcademicMarkdown(content, picked);
  } else {
    try {
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      const obj = JSON.parse(content.slice(start, end + 1));
      for (const k of ['markdown', 'article', 'digest', 'content', 'text']) {
        if (typeof obj[k] === 'string' && obj[k].length > 200) {
          markdown = obj[k];
          break;
        }
      }
      if (!markdown && typeof obj === 'object') {
        for (const v of Object.values(obj)) {
          if (typeof v === 'string' && v.length > 200) {
            markdown = v;
            break;
          }
        }
      }
    } catch {
      if (content.startsWith('## ')) markdown = content;
    }
  }

  if (!markdown || markdown.length < 200) {
    showToast('LLM 输出解析失败', 'error');
    return null;
  }

  const digest: LibraryDigest = {
    id: date,
    libId,
    depth,
    generatedAt: Date.now(),
    paperCount: picked.length,
    markdown,
    model,
  };
  try {
    localStorage.setItem(cacheKey(libId, date), JSON.stringify(digest));
  } catch {
    // 配额满:仍返回 digest 给 UI,但不持久化(下次得重生成)
    showToast('localStorage 配额满,digest 未缓存', 'info');
  }
  showToast(`已生成 digest(${picked.length} 篇)`, 'ok');
  return digest;
}

/** 把 LLM 输出的学术 JSON 渲染成 IMRaD markdown。
 *  与日报的差异:日报是单段 markdown,学术是 7 段结构化(abstract / introduction /
 *  methodology / key_findings[] / discussion / conclusion[] / references[])。
 *  渲染时按 IMRaD 顺序拼接,References 用 [1] [2] 编号(对应 key_findings 引用)。
 *
 *  鲁棒性:LLM 输出可能缺字段、references 不全、key_findings 是字符串而非数组。
 *  全程 try-catch,失败回退到 raw content。 */
function renderAcademicMarkdown(content: string, picked: Array<{ arxivId: string }>): string {
  let obj: Record<string, unknown>;
  try {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) return content; // 不是 JSON:raw 输出
    obj = JSON.parse(content.slice(start, end + 1));
  } catch {
    return content;
  }

  const lines: string[] = [];
  const abstract = typeof obj.abstract === 'string' ? obj.abstract.trim() : '';
  const introduction = typeof obj.introduction === 'string' ? obj.introduction.trim() : '';
  const methodology = typeof obj.methodology === 'string' ? obj.methodology.trim() : '';
  const discussion = typeof obj.discussion === 'string' ? obj.discussion.trim() : '';
  const findings = Array.isArray(obj.key_findings) ? obj.key_findings : [];
  const conclusion = Array.isArray(obj.conclusion) ? obj.conclusion : [];
  const references = Array.isArray(obj.references) ? obj.references : [];

  if (abstract) {
    lines.push('## Abstract');
    lines.push('');
    lines.push(abstract);
    lines.push('');
  }
  if (introduction) {
    lines.push('## 1. Introduction');
    lines.push('');
    lines.push(introduction);
    lines.push('');
  }
  if (methodology) {
    lines.push('## 2. Methodology');
    lines.push('');
    lines.push(methodology);
    lines.push('');
  }
  if (findings.length > 0) {
    lines.push('## 3. Key Findings');
    lines.push('');
    findings.forEach((f, i) => {
      const item = f as { theme?: unknown; core_finding?: unknown; supporting_papers?: unknown; relevance?: unknown };
      const theme = typeof item.theme === 'string' ? item.theme : `主题 ${i + 1}`;
      const finding = typeof item.core_finding === 'string' ? item.core_finding : '';
      const papers = Array.isArray(item.supporting_papers) ? item.supporting_papers.map(String) : [];
      const relevance = typeof item.relevance === 'string' ? item.relevance : '';
      lines.push(`### 3.${i + 1} ${theme}`);
      lines.push('');
      if (finding) lines.push(finding);
      if (papers.length > 0) lines.push(`支撑论文:${papers.map((p) => `[${p}]`).join(', ')}。`);
      if (relevance) lines.push(`对本方向的启示:${relevance}`);
      lines.push('');
    });
  }
  if (discussion) {
    lines.push('## 4. Discussion');
    lines.push('');
    lines.push(discussion);
    lines.push('');
  }
  if (conclusion.length > 0) {
    lines.push('## 5. Conclusion');
    lines.push('');
    conclusion.forEach((c) => lines.push(`- ${typeof c === 'string' ? c : String(c)}`));
    lines.push('');
  }
  if (references.length > 0) {
    lines.push('## References');
    lines.push('');
    references.forEach((r, i) => {
      const ref = r as { id?: unknown; title?: unknown; authors?: unknown; year?: unknown };
      const id = typeof ref.id === 'string' ? ref.id : '';
      const title = typeof ref.title === 'string' ? ref.title : '';
      const authors = typeof ref.authors === 'string' ? ref.authors : '';
      const year = typeof ref.year === 'string' || typeof ref.year === 'number' ? String(ref.year) : '';
      const parts = [
        `[${i + 1}]`,
        id ? `\`${id}\`` : '',
        title ? `*${title}*` : '',
        authors ? `${authors}.` : '',
        year ? `${year}.` : '',
      ].filter(Boolean);
      lines.push(parts.join(' '));
    });
    lines.push('');
  }
  // fallback:若上面所有段落都没渲染出来,直接用 raw content
  if (lines.length === 0) return content;
  return lines.join('\n');
}

/** 生成学术综述报告(用户原话:「最好是能够直接投稿的程度」)。
 *  等价于 generateDigest(libId, papers, { depth: 'academic' }),但语义更明确,
 *  强制 depth='academic',并允许更大的 daysBack / maxN(综述需要更全的论文)。
 *
 *  与日报区别:
 *    - 1500-2500 字 IMRaD 结构(日报 600-1200 字 4 段)
 *    - 强制 [arxiv-id] 内联引用 + References 编号
 *    - 强制跨论文模式识别 + 局限性 + 未来方向
 *    - 7-30 天窗(日报 7 天默认)
 */
export async function generateAcademicReport(
  libId: string,
  papers: Array<{ canonicalArxivId: string; arxivId?: string; title?: string; title_zh?: string; abstract?: string; evidence?: string; date?: string; score?: number }>,
  opts: { force?: boolean; daysBack?: number; maxN?: number } = {},
): Promise<LibraryDigest | null> {
  return generateDigest(libId, papers, {
    ...opts,
    depth: 'academic',
    daysBack: opts.daysBack ?? 30,
    maxN: opts.maxN ?? 60,
  });
}

/** 列已生成的 digest 历史(按日期倒序)。 */
export function listDigests(libId: string): LibraryDigest[] {
  const out: LibraryDigest[] = [];
  const prefix = `${CACHE_PREFIX}${libId}:`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(prefix)) continue;
    try {
      const d = JSON.parse(localStorage.getItem(k) || '') as LibraryDigest;
      if (d && d.markdown) out.push(d);
    } catch {
      /* ignore */
    }
  }
  out.sort((a, b) => (b.id || '').localeCompare(a.id || ''));
  return out;
}