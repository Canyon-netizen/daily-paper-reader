// astro-src/scripts/library-workbench-mounts.ts
//
// /libraries/<id>/ 阶段 4:graph 与 chat tab 客户端挂载逻辑。
//
// - mountLibraryGraph: 读 <script type="application/json" id="library-graph-data">
//   注入的 SSR JSON,渲染到 #wb-graph-svg-wrap;只在切到 graph tab 时调一次。
// - mountLibraryChat: 在 chat-panel 内嵌一个简化版 paper-chat 浮窗,带
//   library.chat pack 注入与流式 LLM 回答。

import {
  layoutGraph,
  layoutToSvg,
  type GraphPaper,
  type GraphConcept,
} from '../lib/library/graph';
import { loadCompileState, compileStorageKey } from './paper-compile';
import { renderCompileMarkdown } from './paper-compile-render';
import type { FigureEntry } from '../lib/paper';
import { loadSettings } from './settings';
import {
  injectIntoPrompt,
  injectIntoPromptSync,
  preloadPacks,
} from './prompt-pack';
import { callChatCompletion } from '../lib/llm/chat';
import { resolveRoute } from '../lib/llm/route';
import { showToast } from './toast';

const REASONING_MODEL_RE = /reasoner|reasoning|r1|think/i;

interface GraphData {
  papers: GraphPaper[];
  concepts: GraphConcept[];
}

let graphMounted = false;
let chatMounted = false;

function readGraphData(): GraphData | null {
  const tag = document.getElementById('library-graph-data');
  if (!tag) return null;
  try {
    return JSON.parse(tag.textContent || '{}') as GraphData;
  } catch {
    return null;
  }
}

export function mountLibraryGraph(): void {
  if (graphMounted) return;
  const wrap = document.getElementById('wb-graph-svg-wrap');
  if (!wrap) return;
  const data = readGraphData();
  if (!data || !data.papers?.length) {
    wrap.textContent = '没有可用的论文数据';
    return;
  }
  const layout = layoutGraph(data.papers, data.concepts);
  wrap.innerHTML = layoutToSvg(layout, { ariaLabel: '论文关系图' });
  // 论文节点点击 → 切回 papers tab 并选中
  wrap.querySelectorAll<SVGElement>('g.graph-node.graph-paper').forEach((g) => {
    g.style.cursor = 'pointer';
    g.addEventListener('click', () => {
      const cx = g.getAttribute('data-paper-id');
      if (!cx) return;
      window.location.hash = '#papers';
      setTimeout(() => {
        const row = document.querySelector<HTMLElement>(`.wb-paper-row[data-paper-id="${cx}"]`);
        row?.click();
        row?.scrollIntoView({ block: 'center' });
      }, 50);
    });
  });
  graphMounted = true;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

let chatState: { history: ChatMsg[]; busy: boolean } = { history: [], busy: false };
let chatAbortCtl: AbortController | null = null;

export function mountLibraryChat(): void {
  if (chatMounted) return;
  const panel = document.getElementById('chat-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="wb-chat-inner">
      <h3>文献对话 · ${escapeHtml(readLibraryTitle())}</h3>
      <p class="wb-chat-hint">基于 library.chat 提示词 + 库内论文上下文。引用规约:句末 [n]、概念 [[…]]、图片 ![[fig:N]]。</p>
      <div id="wb-chat-log" class="wb-chat-log" aria-live="polite"></div>
      <form id="wb-chat-form" class="wb-chat-form" autocomplete="off">
        <input id="wb-chat-input" type="text" placeholder="问点关于这个文献库的问题…" disabled />
        <button id="wb-chat-send" type="submit" disabled>发送</button>
        <button id="wb-chat-stop" type="button" hidden>停止</button>
      </form>
      <div class="wb-chat-status"></div>
    </div>
  `;
  const input = panel.querySelector<HTMLInputElement>('#wb-chat-input')!;
  const sendBtn = panel.querySelector<HTMLButtonElement>('#wb-chat-send')!;
  const stopBtn = panel.querySelector<HTMLButtonElement>('#wb-chat-stop')!;
  const form = panel.querySelector<HTMLFormElement>('#wb-chat-form')!;
  const log = panel.querySelector<HTMLDivElement>('#wb-chat-log')!;
  const status = panel.querySelector<HTMLDivElement>('.wb-chat-status')!;

  // 启用(若有 LLM key)
  const cfg = loadSettings();
  if (!cfg?.apiKey) {
    status.textContent = '请先在设置页配置 LLM key';
  } else {
    input.disabled = false;
    sendBtn.disabled = false;
    preloadPacks(cfg).catch(() => undefined);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = (input.value || '').trim();
    if (!q || chatState.busy) return;
    await sendChat(q, log, input, sendBtn, stopBtn, status);
  });

  stopBtn.addEventListener('click', () => {
    chatAbortCtl?.abort();
  });

  chatMounted = true;
}

function readLibraryTitle(): string {
  return document.querySelector<HTMLElement>('.library-wb-hero h1')?.textContent?.trim() || '文献库';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c] || c);
}

function appendMsg(log: HTMLElement, role: 'user' | 'assistant', text: string): void {
  const div = document.createElement('div');
  div.className = `wb-chat-msg wb-chat-msg-${role}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function sendChat(
  q: string,
  log: HTMLElement,
  input: HTMLInputElement,
  sendBtn: HTMLButtonElement,
  stopBtn: HTMLButtonElement,
  status: HTMLElement,
): Promise<void> {
  const cfg = loadSettings();
  if (!cfg?.apiKey) {
    showToast('请先在设置页配置 LLM key');
    return;
  }
  chatState.busy = true;
  chatState.history.push({ role: 'user', content: q });
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;
  stopBtn.hidden = false;
  status.textContent = '正在生成…';

  appendMsg(log, 'user', q);
  const aDiv = document.createElement('div');
  aDiv.className = 'wb-chat-msg wb-chat-msg-assistant skel';
  aDiv.textContent = '…';
  log.appendChild(aDiv);

  chatAbortCtl = new AbortController();

  try {
    const baseSystem = `你是文献库伴读助手。当前库:${readLibraryTitle()}。`;
    const sys = injectIntoPromptSync(baseSystem, 'library.chat', cfg);
    // 拼入历史 + 当前问题作为 user message
    const userContent = [
      chatState.history.slice(0, -1).map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join('\n'),
      `用户: ${q}`,
    ].filter(Boolean).join('\n\n');

    const finalUser = await injectIntoPrompt(userContent, 'library.chat', cfg);

    const route = resolveRoute('library_chat');
    const res = await callChatCompletion(cfg, {
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: finalUser },
      ],
      temperature: route.temperature,
      maxTokens: 2048,
      signal: chatAbortCtl.signal,
      reasoningModelPattern: REASONING_MODEL_RE,
    });
    const reply = (res?.content || '').trim() || '(空回答)';
    aDiv.classList.remove('skel');
    aDiv.textContent = reply;
    chatState.history.push({ role: 'assistant', content: reply });
    status.textContent = '';
  } catch (e) {
    aDiv.classList.remove('skel');
    aDiv.textContent = `(中断) ${e instanceof Error ? e.message : '未知错误'}`;
    status.textContent = '已中断';
  } finally {
    chatState.busy = false;
    chatAbortCtl = null;
    input.disabled = false;
    sendBtn.disabled = false;
    stopBtn.hidden = true;
  }
}

/**
 * 阶段 4:工作台 PapersTab 详情面板内联编译预览挂载。
 *
 * 流程:页面里每个论文的 .wb-paper-compile 节点都带
 *   data-cx / data-figures / data-titles
 * 启动时遍历:
 *   1. 读 localStorage[dpr_paper_compile_v1:<cx>]
 *   2. 有缓存 → 调 renderCompileMarkdown(md, { figures }) 渲染到内联容器
 *   3. 无缓存 → 留默认提示文字(引导用户去论文页编译)
 *
 * 该函数自动在 DOMContentLoaded / 立即执行,无需 tab 切换触发(论文行
 * 选中态决定哪个 .wb-paper-compile 可见,但所有节点都先 hydrate)。
 */
export function mountWorkbenchCompile(): void {
  const containers = document.querySelectorAll<HTMLElement>('.wb-paper-compile');
  if (containers.length === 0) return;
  for (const el of containers) {
    if (el.dataset.mounted === '1') continue;
    const cx = el.dataset.cx || '';
    if (!cx) continue;
    let cached: ReturnType<typeof loadCompileState> = null;
    try {
      // 直接读 localStorage(避免 paper-compile 模块自身对图等的依赖)
      const raw = localStorage.getItem(compileStorageKey(cx));
      if (raw) {
        const parsed = JSON.parse(raw) as { markdown?: string; status?: string };
        if (parsed.markdown && parsed.markdown.length > 0) {
          cached = { status: 'done', markdown: parsed.markdown, startedAt: 0, updatedAt: 0 };
        }
      }
    } catch { /* ignore */ }

    if (cached && cached.markdown) {
      try {
        const figures = JSON.parse(el.dataset.figures || '[]') as FigureEntry[];
        el.innerHTML = renderCompileMarkdown(cached.markdown, { figures });
        const paperId = el.dataset.paperId || '';
        const base = el.dataset.base || '';
        const link = document.createElement('p');
        link.className = 'wb-compile-actions';
        const paperName = (paperId || '').split('/').pop() || paperId;
        link.innerHTML = `<a class="export-btn" href="${escapeAttr(base + '/papers/' + paperName + '/#paper-compile-section')}">🔄 重新编译</a>`;
        el.appendChild(link);
        el.dataset.mounted = '1';
        continue;
      } catch (e) {
        console.warn('[workbench-compile] render failed', e);
      }
    }

    // 无缓存:留提示
    el.innerHTML = `
      <p class="wb-compile-empty">
        本论文还没有编译结果。点上方
        const paperName = ((el.dataset.paperId || '')).split('/').pop() || el.dataset.paperId;
      <a class="export-btn" href="${escapeAttr((el.dataset.base || '') + '/papers/' + paperName + '/#paper-compile-section')}">✨ 去编译</a>
        触发 LLM 流式翻译(浏览器本地缓存,下次访问自动显示)。
      </p>
    `;
    el.dataset.mounted = '1';
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// 自动启动
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountWorkbenchCompile, { once: true });
  } else {
    mountWorkbenchCompile();
  }
}
