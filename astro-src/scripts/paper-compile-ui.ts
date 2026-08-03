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
  preloadLibraryPacks,
} from './paper-compile';
import {
  preSubstituteMedia,
  injectFiguresAndTables,
  renderInlineMarkdown,
} from './paper-compile-render';
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

// 阶段 4:renderInlineMarkdown 改从 paper-compile-render 导入,与 workbench 内联
// 编译预览共享同一份渲染逻辑。

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

/**
 * 把一段 paper 数据 + 容器节点 + 控件引用打包,跑一次编译并就地渲染。
 * 既给 paper 页 initPaperCompile 用(走它自己绑好的 startBtn/stopBtn),
 * 也给 library 工作台「就地编译」用(走它自己的 btn / 容器)。
 * 返回:可取消的 AbortController(让 caller 二次 abort / dispose)。
 */
export interface InlineCompileArgs {
  canonicalId: string;
  titleZh: string;
  titleEn: string;
  abstract: string;
  fulltext?: string;
  figures: CompiledFigures[];
  tables: CompiledTables[];
  output: HTMLElement;
  startBtn?: HTMLButtonElement | null;
  stopBtn?: HTMLButtonElement | null;
  recompileBtn?: HTMLButtonElement | null;
  clearBtn?: HTMLButtonElement | null;
  statusEl?: HTMLElement | null;
  onStatus?: (msg: string, kind: 'info' | 'ok' | 'error' | 'live') => void;
  onChunk?: (fullMd: string) => void;
}

export async function runInlineCompile(args: InlineCompileArgs): Promise<AbortController> {
  const ctrl = new AbortController();
  const setStatus = (msg: string, kind: 'info' | 'ok' | 'error' | 'live') => {
    if (args.onStatus) args.onStatus(msg, kind);
    else if (args.statusEl) showStatusEl(args.statusEl, msg, kind);
  };
  const renderChunk = (fullMd: string) => {
    if (args.onChunk) args.onChunk(fullMd);
    else args.output.innerHTML = renderAll(fullMd, args.figures as FigureEntry[]);
  };

  if (!hasLLMConfigured()) {
    setStatus('请先在设置页配置 LLM key', 'error');
    return ctrl;
  }
  const cfg = loadSettings();
  await preloadLibraryPacks(cfg);
  const figures = summarizeFigures(args.figures);
  const tables = summarizeTables(args.tables);
  const systemPrompt = buildSystemPrompt(figures, tables, cfg);
  const userPrompt = [
    `论文标题(英文): ${args.titleEn}`,
    `论文标题(中文): ${args.titleZh}`,
    '',
    '## 摘要',
    args.abstract || '(无摘要)',
    args.fulltext ? '\n## 论文全文(markdown,前 6000 字符)\n' + args.fulltext.slice(0, 6000) : '',
  ].join('\n');

  if (args.startBtn) args.startBtn.disabled = true;
  if (args.recompileBtn) args.recompileBtn.disabled = true;
  if (args.clearBtn) args.clearBtn.disabled = true;
  if (args.stopBtn) args.stopBtn.hidden = false;
  args.output.innerHTML = '';
  setStatus('编译中…', 'live');

  let fullMd = '';
  saveCompileState(args.canonicalId, {
    status: 'streaming', markdown: '', startedAt: Date.now(), updatedAt: Date.now(),
  });

  try {
    await streamLLMCompile(
      cfg,
      systemPrompt,
      userPrompt,
      (chunk) => {
        fullMd += chunk;
        renderChunk(fullMd);
        saveCompileState(args.canonicalId, {
          status: 'streaming',
          markdown: fullMd,
          startedAt: Date.now(),
          updatedAt: Date.now(),
        });
      },
      ctrl.signal,
    );
    saveCompileState(args.canonicalId, {
      status: 'done',
      markdown: fullMd,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    setStatus('✓ 编译完成,已存到本地存储', 'ok');
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      setStatus('已停止', 'info');
      saveCompileState(args.canonicalId, {
        status: 'done',
        markdown: fullMd,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      });
    } else {
      setStatus(`✗ ${(e as Error).message || '编译失败'}`, 'error');
      saveCompileState(args.canonicalId, {
        status: 'error',
        markdown: fullMd,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        errorMessage: (e as Error).message,
      });
    }
  } finally {
    if (args.startBtn) args.startBtn.disabled = false;
    if (args.recompileBtn) args.recompileBtn.disabled = false;
    if (args.clearBtn) args.clearBtn.disabled = false;
    if (args.stopBtn) args.stopBtn.hidden = true;
  }
  return ctrl;
}

/** runInlineCompile fallback status 写入 */
function showStatusEl(el: HTMLElement, msg: string, kind: 'info' | 'ok' | 'error' | 'live'): void {
  el.textContent = msg;
  el.dataset.kind = kind;
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

  /** 复刻 paper 页 runCompile 的行为(为 initPaperCompile 内部用) */
  async function runCompile(): Promise<void> {
    if (!hasLLMConfigured()) {
      showStatus(section, '请先在设置页配置 LLM key', 'error');
      return;
    }
    // 委托给 runInlineCompile,用本闭包里的 output/buttons
    currentAbort = await runInlineCompile({
      canonicalId: data.canonicalId,
      titleZh: data.titleZh,
      titleEn: data.titleEn,
      abstract: data.abstract,
      fulltext: data.fulltext,
      figures: data.figures,
      tables: data.tables,
      output,
      startBtn, stopBtn, recompileBtn, clearBtn,
    });
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
