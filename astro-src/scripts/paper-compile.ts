// astro-src/scripts/paper-compile.ts
//
// 「编译论文」功能(Stage 11+ 用户主动要求)—— 浏览器侧调用 LLM,
// 把英文论文按 Polaris LIBRARIAN_SYSTEM_PROMPT 风格翻译/总结成中文 markdown,
// 图片(fig:N)和表格(table:N)由 LLM 在合适位置插入 ![[fig:N]] / [[fig:N]] 标记,
// 客户端再把这些标记替换为实际 <figure>/<table> 节点。
//
// 数据流:
//   1. 论文页 load → 用户点「✨ 编译」按钮
//   2. 浏览器 fetch /v1/chat/completions (流式) 拿到增量 delta
//   3. 流式 append 到 #paper-compile-output(用 marked 渲染)
//   4. 解析完存到 localStorage dpr_paper_compile_v1[<canonicalId>]
//   5. 再次访问论文页,先看缓存 — 有就直接展示,不调 LLM
//   6. 「重编」按钮覆盖缓存
//
// 已知限制(plan §Stage 11 决策):
//   - 编译结果存 localStorage,跨设备不同步(可以加 Gist 但要新增一键,本次不做)
//   - 不做 pdf_available 物理 PDF 的图注入(只走 frontmatter figures_json)
//   - LLM 调用是用户自己配 key,失败弹 toast 不抛
import { loadSettings, type LLMConfig } from './settings';
import { injectIntoPromptSync, preloadPacks } from './prompt-pack';

interface FigureSummary { index: number; caption?: string; page?: number; }
interface TableSummary { index: number; caption?: string; }

/** 简化版 FigureEntry —— 只带 LLM 提示词 + 客户端渲染需要的字段。 */
export interface CompileFigure {
  index: number;
  caption?: string;
  page?: number;
  url: string;
}

const COMPILE_KEY_PREFIX = 'dpr_paper_compile_v1:';
const INFLIGHT_PREFIX = 'dpr_paper_compile_inflight:';

export function compileStorageKey(canonicalId: string): string {
  return COMPILE_KEY_PREFIX + canonicalId;
}

export function inflightStorageKey(canonicalId: string): string {
  return INFLIGHT_PREFIX + canonicalId;
}

export interface CompileState {
  status: 'idle' | 'streaming' | 'done' | 'error';
  markdown: string;
  startedAt: number;
  updatedAt: number;
  errorMessage?: string;
}

export function loadCompileState(canonicalId: string): CompileState | null {
  try {
    const raw = localStorage.getItem(compileStorageKey(canonicalId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CompileState;
    if (typeof parsed.markdown !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCompileState(canonicalId: string, state: CompileState): void {
  try {
    localStorage.setItem(compileStorageKey(canonicalId), JSON.stringify(state));
  } catch (e) {
    // 配额爆了 — 不阻断 UI,后续 fallback 用 inflight 段。
    console.warn('[paper-compile] save failed', e);
  }
}

export function clearCompileState(canonicalId: string): void {
  try {
    localStorage.removeItem(compileStorageKey(canonicalId));
  } catch { /* ignore */ }
}

/** 检查 LLM 是否已配置(apiKey 非空)。 */
export function hasLLMConfigured(): boolean {
  try {
    const cfg = loadSettings();
    return Boolean(cfg.apiKey && cfg.apiKey.trim());
  } catch {
    return false;
  }
}

/**
 * LLM 系统提示词 —— 仿 Polaris LIBRARIAN_SYSTEM_PROMPT 的精神,
 * 重点是**显式图片嵌位规则**和**不要遗漏 !**。
 *
 * PR 阶段 1 起:如果 `config.prompt_packs.active.library.compile` 已 pin 了
 * `library-compile:2026-08-02` pack,会把 Polaris 原版 LIBRARIAN_SYSTEM_PROMPT
 * 原文拼在前面(对齐 24k 预算截断规则),后接下方 figures/tables 列表与说明。
 * 未 pin 时完全保留旧行为,零破坏。
 */
export function buildSystemPrompt(
  figures: CompileFigure[],
  tables: TableSummary[],
  config?: LLMConfig | null,
): string {
  const figLines = figures.length > 0
    ? '\n可用图片清单(出现顺序就是内嵌顺序建议):\n' + figures.slice(0, 12).map((f) => {
        const cap = f.caption ? ` —— ${f.caption}` : '';
        const page = f.page ? ` (p.${f.page})` : '';
        return `- ![[fig:${f.index}]]${page}${cap}`;
      }).join('\n') + '\n(超过 12 张的图后续再说,优先放前 12 张)'
    : '\n(本论文没有内嵌图,无需插图)';

  const tableLines = tables.length > 0
    ? '\n可用表格清单(按出现顺序内嵌):\n' + tables.slice(0, 8).map((t) => {
        return `- [[table:${t.index}]] —— ${t.caption || '表格'}`;
      }).join('\n')
    : '\n(本论文没有表格)';

  const basePrompt = `你是论文精读助手(Librarian)。把以下英文学术论文翻译并精读成**中文 markdown 深度解读**。

结构骨架(保留二级标题,小标题措辞可按内容微调):
## TL;DR
两三句话说清做了什么、结果如何。
## 研究背景与动机
为什么重要、已有方法的局限、本文的切入点。
## 方法
核心思路 + 关键设计(为什么这样设计、差在哪)。
## 实验与结果
主要数字、对比、这些结果说明什么。
## 讨论与可借鉴点
局限、启发、对后续研究方向的意义。

写作要求:
- 充分展开,通常 800–1500 字;有全文细节时利用,不要只复述摘要。
- 数学符号用 LaTeX:行内 $...$,重要公式独立一行用 $$...$$。
- **图片嵌位**(关键,漏了 ！ 会被当成概念双链):
  - 用 ![[fig:N]] 内嵌第 N 张图,**感叹号必填**;**! [[fig:N]]**也算嵌入;
  - 在对应小节(方法 / 实验 / 结果等)插一行 ![[fig:N]];
  - 插图前后 1-3 句说明这张图画了什么、如何支撑论点、读者应关注的部分;
  - **每张可用图都要用上**,不要把图集中堆在文章开头或结尾;不要只丢图不解释。
- 表格嵌位:用 [[table:N]] 内嵌第 N 张表(无感叹号);放在引用它的段落附近。
- 概念双链 [[概念名]] 只标**跨论文复现**的通用概念;论文自己起的名字(方法缩写、
  系统名、模型代号、自建 benchmark)一律**不加**双链,在正文里正常写出来。${figLines}${tableLines}`;

  // pack 注入:任何异常都 fallback 回 basePrompt(0-break)
  if (!config) return basePrompt;
  try {
    return injectIntoPromptSync(basePrompt, 'library.compile', config);
  } catch {
    return basePrompt;
  }
}

/**
 * 启动时预热 library.* 全部 pack(供页面 entry 调用一次)。
 * 不阻塞页面:失败走 graceful fallback,等同于没 pin。
 */
export function preloadLibraryPacks(config: LLMConfig | null): Promise<void> {
  if (!config) return Promise.resolve();
  return preloadPacks(config).catch(() => undefined);
}

/** 把 figures 缩到提示词最小集合,保留 url 用于客户端渲染替换。 */
export function summarizeFigures(figures: Array<{ index: number; caption?: string; page?: number; url: string }>): CompileFigure[] {
  return figures.map((f) => ({
    index: f.index,
    caption: f.caption,
    page: f.page,
    url: f.url,
  }));
}

export function summarizeTables(tables: Array<{ index: number; caption?: string }>): TableSummary[] {
  return tables.map((t) => ({ index: t.index, caption: t.caption }));
}

/**
 * 流式调用 LLM,把增量文本流式追加到 onDelta。
 * 流结束 / 失败 / 取消时 resolve。
 *
 * 用 fetch + ReadableStream 解 SSE chunks,不走 callChatCompletion(后者只
 * 处理非流式响应)。这是 paper-compile 专用的薄封装,polling 别的用法不抽
 * 上来 —— 计划已经在 .mjs 路径上有了 callChatCompletion,流式路径直接给
 * 论文编译用,不污染 lib/llm。
 */
export async function streamLLMCompile(
  cfg: LLMConfig,
  systemPrompt: string,
  userPrompt: string,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
  modelOverride?: string,
  temperature = 0.4,
  maxTokens = 8000,
): Promise<{ content: string; finishReason: string }> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: modelOverride ?? cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`LLM API 错误 (${res.status}): ${t.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let finishReason = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE:每行以 \n 分隔,行内以 \r\n 也行,所以 split('\n') 后过滤空行 / 'data:' 前缀
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';   // 最后一段可能不完整
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const obj = JSON.parse(payload);
        const delta = obj?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          full += delta;
          onDelta(delta);
        }
        const fr = obj?.choices?.[0]?.finish_reason;
        if (fr) finishReason = fr;
      } catch {
        // 解析失败忽略(可能 chunk 跨行);不弹错
      }
    }
  }
  return { content: full, finishReason };
}
