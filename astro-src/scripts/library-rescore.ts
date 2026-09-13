// astro-src/scripts/library-rescore.ts
//
// 单库论文批量 LLM 重打分 —— 对照 Polaris 后端 voyage agent 的
// `POST /libraries/{id}/ingest/run` 的打分阶段(client 端版)。
//
// 用途:
//   - 用户改了 library 的 statement / 关键词 / inScope 后,让所有库内论文
//     按新方向重新打分。
//   - 用户手动点 Govern tab 的「重打分」按钮,触发本模块。
//
// 行为:
//   1. 拿 library 库内所有 paperIds[] + papers[](SSR 注入的全集)
//   2. 跳过已有 relevanceScore 的(已有就不重打,除非 force=true)
//   3. LLM 批量打分(M2.7-highspeed ~5s/30 篇)
//   4. batchSetLibraryPaperMeta 一次性写入,发 paper-meta 事件
//   5. 用户在 PapersTab 看到更新后的 score

import { showToast } from './toast';
import { loadSettings } from './settings';
import { canonicalArxivId } from '../lib/arxiv';
import { getUserLibrary, batchSetLibraryPaperMeta } from '../lib/user-libraries';
import { recordUsage } from '../lib/llm-budget';
import type { UserLibrary } from '../lib/user-libraries';

const LLM_BATCH = 15;

const RESCORE_SYSTEM_PROMPT = (
  '你是文献库评分助手。给定一个文献库的方向声明 + 关键词 + 范围内主题 + 锚点论文,'
  + '给每篇论文打 0-1 相关度,并给一句话理由。\n'
  + '评分标准(必须严格按此执行,不允许给 0.6-0.9 的中间分):\n'
  + '• 1.0 分:论文核心贡献直接落在本库方向内,是本领域的原创研究(非跨领域)。\n'
  + '• 0.5 分:论文提到本库核心概念但只是引用/应用/综述/博客,非主要贡献;'
  + '或跨方向论文(用了本方向工具但目标是别的领域)。\n'
  + '• 0.0 分:论文主题与本库方向完全无关,即使标题里有同义词。\n'
  + '• 无法判断时统一给 0.5 分。\n'
  + '注意:\n'
  + '- 锚点论文是本库认可的核心里程碑,与锚点主题/方法/场景相似的论文给 1 分;\n'
  + '- 即使标题不含所有关键词,只要用了相关技术/涉及相关子领域,就给 1 或 0.5,不要给 0。\n'
  + '严格 JSON 输出,无 prose,无 <think>,无 markdown 代码块:'
  + '{"scores":[{"i":1,"s":1.0,"r":"理由必须说明为什么是 0/0.5/1"},...]}'
);

/** 拉 + 打分 + 写入。进度回调给 UI 显示。 */
export async function rescoreLibrary(
  libId: string,
  papers: Array<{ canonicalArxivId: string; arxivId?: string; title?: string; title_zh?: string; abstract?: string; evidence?: string }>,
  opts: { force?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ scored: number; skipped: number }> {
  const lib = getUserLibrary(libId);
  if (!lib) throw new Error(`library ${libId} 不存在`);

  const inLib = new Set(lib.paperIds);
  const candidates = papers.filter((p) => inLib.has(p.canonicalArxivId));

  // 跳过已有 score(除非 force)
  const toScore = opts.force
    ? candidates
    : candidates.filter((p) => {
        const m = lib.papers[p.canonicalArxivId];
        return !m || typeof m.relevanceScore !== 'number';
      });
  const skipped = candidates.length - toScore.length;
  if (toScore.length === 0) {
    showToast(`全部 ${candidates.length} 篇已打分,无需重打`, 'info');
    return { scored: 0, skipped };
  }

  const cfg = loadSettings();
  if (!cfg?.apiKey) {
    showToast('请先在设置页配置 LLM key', 'error');
    return { scored: 0, skipped };
  }
  const url = (cfg.baseUrl || 'https://api.minimaxi.com/v1').replace(/\/$/, '');
  const model = cfg.model || 'MiniMax-M2.7-highspeed';

  const scores = new Map<string, { score: number; reason: string }>();
  const total = toScore.length;
  let done = 0;

  for (let i = 0; i < toScore.length; i += LLM_BATCH) {
    const batch = toScore.slice(i, i + LLM_BATCH);
    const anchorList = (lib.definition?.anchors || []).slice(0, 8);
    const anchorSection = anchorList.length > 0
      ? `锚点论文(本库已认可的核心,相似者给 1 分):\n${anchorList.map((a, idx) => `${idx + 1}. ${a.value}${a.note ? ` (${a.note})` : ''}`).join('\n')}\n`
      : '';
    const userMsg = [
      `## 文献库`,
      `陈述: ${lib.statement}`,
      lib.inclusionKeywords.length > 0 ? `必须命中关键词: ${lib.inclusionKeywords.join(', ')}` : '',
      (lib.definition?.inScope || []).length > 0 ? `范围内: ${(lib.definition?.inScope || []).join('; ')}` : '',
      '',
      anchorSection,
      `## 论文(本批 ${i + 1}-${i + batch.length}/${toScore.length} 篇)`,
      ...batch.map((p, idx) => `${idx + 1}. ${p.title_zh || p.title || p.canonicalArxivId}\n   ${(p.abstract || p.evidence || '').slice(0, 300).replace(/\s+/g, ' ')}`),
    ].filter(Boolean).join('\n');
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
            { role: 'system', content: RESCORE_SYSTEM_PROMPT },
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
      let content = (data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      const obj = JSON.parse(content.slice(start, end + 1));
      const arr = obj.scores || obj.results || [];
      for (const it of arr) {
        const idx = Number(it.i);
        if (!Number.isFinite(idx) || idx < 1 || idx > batch.length) continue;
        const s = Number(it.s);
        if (!Number.isFinite(s)) continue;
        const cx = canonicalArxivId(batch[idx - 1].canonicalArxivId);
        if (!cx) continue;
        scores.set(cx, {
          score: Math.max(0, Math.min(1, s)),
          reason: String(it.r || '').slice(0, 200),
        });
      }
      done += batch.length;
      opts.onProgress?.(done, total);
    } catch (e) {
      console.warn('[library-rescore] batch failed', e);
      showToast(`打分失败(部分批):${(e as Error).message}`, 'error');
      done += batch.length;
      opts.onProgress?.(done, total);
    }
  }

  // 批量写入(单事件)
  const items = Array.from(scores.entries()).map(([cx, sc]) => ({
    arxivId: cx,
    meta: {
      status: 'scored' as const,
      relevanceScore: sc.score,
      relevanceReason: sc.reason,
    },
  }));
  const res = batchSetLibraryPaperMeta(libId, items);
  if (!res.ok) {
    showToast('保存打分失败', 'error');
    return { scored: 0, skipped };
  }
  showToast(`已为 ${items.length} 篇论文重打分`, 'ok');
  return { scored: items.length, skipped };
}