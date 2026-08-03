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
import type { UserLibrary } from '../lib/user-libraries';

export interface LibraryDigest {
  id: string;          // YYYY-MM-DD
  libId: string;
  generatedAt: number; // epoch ms
  paperCount: number;
  markdown: string;    // 完整 markdown(Polaris 风格 5 段)
  model: string;
}

const CACHE_PREFIX = 'dpr_library_digest_v1:';

function cacheKey(libId: string, date: string): string {
  return `${CACHE_PREFIX}${libId}:${date}`;
}

const DIGEST_SYSTEM_PROMPT = (
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
    return d;
  } catch {
    return null;
  }
}

/** LLM 生成 digest。无候选时返回 null + 友好 toast。 */
export async function generateDigest(
  libId: string,
  papers: Array<{ canonicalArxivId: string; arxivId?: string; title?: string; title_zh?: string; abstract?: string; evidence?: string; date?: string; score?: number }>,
  opts: { force?: boolean; daysBack?: number; maxN?: number } = {},
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
          { role: 'system', content: DIGEST_SYSTEM_PROMPT },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.4,
        response_format: { type: 'json_object' },
        max_tokens: 4000,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`LLM HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    }
    const data = await resp.json();
    content = data.choices?.[0]?.message?.content || '';
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  } catch (e) {
    showToast(`Digest 生成失败:${(e as Error).message}`, 'error');
    return null;
  }

  // parse JSON
  let markdown = '';
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
      // any string field
      for (const v of Object.values(obj)) {
        if (typeof v === 'string' && v.length > 200) {
          markdown = v;
          break;
        }
      }
    }
  } catch {
    // 不是 JSON:可能是 raw markdown
    if (content.startsWith('## ')) markdown = content;
  }

  if (!markdown || markdown.length < 200) {
    showToast('LLM 输出解析失败', 'error');
    return null;
  }

  const digest: LibraryDigest = {
    id: date,
    libId,
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