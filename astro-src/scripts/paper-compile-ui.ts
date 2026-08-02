// astro-src/scripts/paper-compile-ui.ts
//
// 「编译论文」按钮的客户端控制器(挂载到论文页)。
//
// 入口点:
//   1. 论文页 SSR 已把 figures / tables 序列化为 #paper-compile-data
//   2. 客户端 initPaperCompile() 读 data + bind 按钮事件
//   3. 用户点「✨ 编译」→ 走 streamLLMCompile 流式翻译,DOM 增量更新
//   4. 流结束后存 localStorage(下次访问直接读缓存,不再调 LLM)
//
// 设计原则:
//   - 0 依赖:不引外部 markdown 解析器,inline 处理 #paper-compile-output 内容
//   - 不修改 server-rendered 论文正文,#paper-compile-section 是独立 <section>
//   - 用户体验:边流边看,失败弹 toast,可以停止 / 重编

import { showToast } from './toast';
import { loadSettings } from './settings';
import {
  hasLLMConfigured,
  loadCompileState,
  saveCompileState,
  clearCompileState,
  streamLLMCompile,
  buildSystemPrompt,
  summarizeFigures,
  summarizeTables,
  compileStorageKey,
} from './paper-compile';
import { preSubstituteMedia, injectFiguresAndTables } from './paper-compile-render';
import type { FigureEntry } from '../lib/paper';

interface CompiledFigures { index: number; caption?: string; page?: number; url: string; }
interface CompiledTables { index: number; caption?: string; }

interface CompileData {
  canonicalId: string;
  titleZh: string;
  titleEn: string;
  abstract: string;
  fulltext: string;
  figures: CompiledFigures[];
  tables: CompiledTables[];
}

function readCompileData(): CompileData | null {
  const el = document.getElementById('paper-compile-data');
  if (!el) return null;
  try {
    return {
      canonicalId: el.dataset.canonicalId || '',
      titleZh: el.dataset.titleZh || '',
      titleEn: el.dataset.titleEn || '',
      abstract: el.dataset.abstract || '',
      fulltext: el.dataset.fulltext || '',
      figures: JSON.parse(el.dataset.figures || '[]') as CompiledFigures[],
      tables: JSON.parse(el.dataset.tables || '[]') as CompiledTables[],
    };
  } catch (e) {
    console.warn('[paper-compile] parse data failed', e);
    return null;
  }
}

/** 极简 markdown 渲染 —— 不引外部库,只够 LLM 输出用。
 *  - 行内 **粗体** 和 *斜体*
 *  - # ## ### 标题
 *  - [[wikilink]] / ![[fig:N]] 占位(后者在调用方预处理成 <figure>)
 *  - ``` code fence
 *  - 段落换行
 *  不支持:列表、表格、链接(LLM 输出通常不用这些;表格走占位 + 真实替换) */
function renderInlineMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let inPara: string[] = [];

  const flushPara = () => {
    if (inPara.length === 0) return;
    const text = inPara.join(' ').trim();
    if (text) out.push(`<p>${inlineFormat(text)}</p>`);
    inPara = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('```')) {
      flushPara();
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    if (line.startsWith('### ')) { flushPara(); out.push(`<h3>${inlineFormat(line.slice(4))}</h3>`); continue; }
    if (line.startsWith('## '))  { flushPara(); out.push(`<h2>${inlineFormat(line.slice(3))}</h2>`); continue; }
    if (line.startsWith('# '))   { flushPara(); out.push(`<h1>${inlineFormat(line.slice(2))}</h1>`); continue; }
    if (line === '') { flushPara(); continue; }
    inPara.push(line);
  }
  flushPara();
  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  }
  return out.join('');
}

function inlineFormat(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // 先转义,再做粗体/斜体/链接(顺序重要)
    .replace(/&lt;\/em&gt;/g, '</em>')  // 防御性修复
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[\[([^\]]+)\]\]/g, (_m, name) => {
      // wiki-link: 保持原文,客户端已处理 [[fig:N]] 替换
      const trimmed = name.trim();
      if (/^fig:\d+$/i.test(trimmed)) return `<span class="wikilink-missing" data-raw="${escapeAttr(trimmed)}">[[${escapeHtml(trimmed)}]]</span>`;
      if (/^table:\d+$/i.test(trimmed)) return `<span class="wikilink-missing" data-raw="${escapeAttr(trimmed)}">[[${escapeHtml(trimmed)}]]</span>`;
      return `<span class="wikilink">[[${escapeHtml(trimmed)}]]</span>`;
    });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function renderAll(rawMd: string, figures: CompiledFigures[]): string {
  // 1) 预替换 ![[fig:N]] / [[table:N]] 为占位 <figure data-fig-idx="N">
  const substituted = preSubstituteMedia(rawMd);
  // 2) markdown → HTML(极简内联渲染)
  let html = renderInlineMarkdown(substituted);
  // 3) 真实 figure/table 替换占位
  html = injectFiguresAndTables(html, {
    figures: figures as FigureEntry[],
  });
  return html;
}

function showStatus(target: HTMLElement, msg: string, kind: 'info' | 'ok' | 'error' | 'live' = 'info'): void {
  const status = target.querySelector<HTMLElement>('[data-compile-status]');
  if (!status) return;
  status.textContent = msg;
  status.dataset.kind = kind;
}

export function initPaperCompile(): void {
  const data = readCompileData();
  if (!data) return;
  const section = document.getElementById('paper-compile-section');
  if (!section) return;
  const startBtn = section.querySelector<HTMLButtonElement>('[data-compile-start]');
  const stopBtn = section.querySelector<HTMLButtonElement>('[data-compile-stop]');
  const recompileBtn = section.querySelector<HTMLButtonElement>('[data-compile-recompile]');
  const clearBtn = section.querySelector<HTMLButtonElement>('[data-compile-clear]');
  const output = section.querySelector<HTMLElement>('[data-compile-output]');
  if (!startBtn || !output) return;

  // 有缓存 → 直接渲染(无需 LLM)
  const cached = loadCompileState(data.canonicalId);
  if (cached && cached.markdown) {
    output.innerHTML = renderAll(cached.markdown, data.figures);
    showStatus(section, '已加载缓存编译结果(本地存储)', 'ok');
    startBtn.hidden = true;
    if (recompileBtn) recompileBtn.hidden = false;
    if (clearBtn) clearBtn.hidden = false;
  } else {
    if (recompileBtn) recompileBtn.hidden = true;
    if (clearBtn) clearBtn.hidden = true;
  }

  // LLM 没配 → 给提示
  if (!hasLLMConfigured()) {
    startBtn.disabled = true;
    showStatus(section, '请先在设置页配置 LLM key', 'info');
  }

  let currentAbort: AbortController | null = null;
  let inflight: Promise<void> | null = null;

  async function runCompile() {
    if (!hasLLMConfigured()) {
      showStatus(section, '请先在设置页配置 LLM key', 'error');
      return;
    }
    const cfg = loadSettings();
    const figures = summarizeFigures(data.figures);
    const tables = summarizeTables(data.tables);
    const systemPrompt = buildSystemPrompt(figures, tables);
    // user prompt:元数据 + 摘要(代替全文 —— 避免 token 爆炸;fulltext 可选)
    const userPrompt = [
      `论文标题(英文): ${data.titleEn}`,
      `论文标题(中文): ${data.titleZh}`,
      '',
      '## 摘要',
      data.abstract || '(无摘要)',
      data.fulltext ? '\n## 论文全文(markdown,前 6000 字符)\n' + data.fulltext.slice(0, 6000) : '',
    ].join('\n');

    // 状态机
    if (startBtn) startBtn.disabled = true;
    if (recompileBtn) recompileBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    if (stopBtn) stopBtn.hidden = false;
    output.innerHTML = '';
    showStatus(section, '编译中…', 'live');

    let fullMd = '';
    saveCompileState(data.canonicalId, {
      status: 'streaming', markdown: '', startedAt: Date.now(), updatedAt: Date.now(),
    });

    currentAbort = new AbortController();
    try {
      await streamLLMCompile(
        cfg,
        systemPrompt,
        userPrompt,
        (chunk) => {
          fullMd += chunk;
          output.innerHTML = renderAll(fullMd, data.figures);
          // 节流保存
          saveCompileState(data.canonicalId, {
            status: 'streaming',
            markdown: fullMd,
            startedAt: Date.now(),
            updatedAt: Date.now(),
          });
        },
        currentAbort.signal,
      );
      saveCompileState(data.canonicalId, {
        status: 'done',
        markdown: fullMd,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      });
      showStatus(section, '✓ 编译完成,已存到本地存储', 'ok');
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        showStatus(section, '已停止', 'info');
        saveCompileState(data.canonicalId, {
          status: 'done',  // 部分内容也保存
          markdown: fullMd,
          startedAt: Date.now(),
          updatedAt: Date.now(),
        });
      } else {
        showStatus(section, `✗ ${(e as Error).message || '编译失败'}`, 'error');
        saveCompileState(data.canonicalId, {
          status: 'error',
          markdown: fullMd,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          errorMessage: (e as Error).message,
        });
      }
    } finally {
      if (startBtn) startBtn.disabled = false;
      if (recompileBtn) recompileBtn.disabled = false;
      if (clearBtn) clearBtn.disabled = false;
      if (stopBtn) stopBtn.hidden = true;
      currentAbort = null;
      inflight = null;
    }
  }

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (inflight) return;
      inflight = runCompile();
    });
  }
  if (recompileBtn) {
    recompileBtn.addEventListener('click', () => {
      if (inflight) return;
      clearCompileState(data.canonicalId);
      output.innerHTML = '';
      if (startBtn) startBtn.hidden = false;
      if (recompileBtn) recompileBtn.hidden = true;
      if (clearBtn) clearBtn.hidden = true;
      showStatus(section, '已清除缓存,准备重新编译', 'info');
      inflight = runCompile();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (inflight) return;
      clearCompileState(data.canonicalId);
      output.innerHTML = '';
      if (startBtn) startBtn.hidden = false;
      if (recompileBtn) recompileBtn.hidden = true;
      if (clearBtn) clearBtn.hidden = true;
      showStatus(section, '已清除缓存', 'info');
    });
  }
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (currentAbort) currentAbort.abort();
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPaperCompile);
} else {
  initPaperCompile();
}
