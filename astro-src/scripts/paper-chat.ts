// /papers/{arxiv}/ 页面底部固定聊天 dock
//
// UX:常驻浮动按钮(fixed bottom-right),点击展开成聊天面板,再点收起。
// 这样不管用户滚到论文哪里,都能一秒打开问问题。
//
// 上下文走轻量路线:只喂论文摘要字段(由 Astro SSR 时序列化到 #paper-chat 的
// data-* 属性),客户端脚本读出来构建 system prompt。消息历史纯内存,刷新即清空。
//
// LLM 调用:复用用户在 /settings/ 配置的 OpenAI 兼容端点(apiKey/baseUrl/model 在
// localStorage)。不走 CORS 代理——chat 浏览器直接打到用户 LLM provider。
//
// 遵循 paper-analyzer.ts 约定:模块被多页 import 时若 DOM 不存在直接 return,
// 不抛错打断调用方。

import { loadSettings, type LLMConfig } from './settings';
import { renderMarkdownBody } from '../lib/markdown';
import {
  loadFulltextSkeleton,
  skeletonToPromptText,
  type FulltextSkeleton,
  type FulltextResult,
} from './paper-fulltext';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ============================================================================
// 全文模式状态 — 用户偏好持久化(沿用 dpr_analyzer_*_v1 约定)
// ============================================================================
// 'summary' = 默认,只喂结构化摘要(老行为)
// 'fulltext' = 注入 ar5iv 抓到的论文骨架
// 用户切到 fulltext 后,首次发问会异步触发骨架加载;加载期间不影响当前轮回答,
// 下一次 send 时自动用上。
const FULLTEXT_MODE_KEY = 'dpr_analyzer_chat_fulltext_mode_v1';
// 强制回退开关:用户或管理员在 localStorage 里设 '1' 时,toggle 锁在 summary,
// 用于线上回滚或 A/B 控制。
const FORCE_SUMMARY_KEY = 'dpr_analyzer_chat_force_summary_v1';

type FulltextMode = 'summary' | 'fulltext';

function readFulltextMode(): FulltextMode {
  try {
    if (localStorage.getItem(FORCE_SUMMARY_KEY) === '1') return 'summary';
    return localStorage.getItem(FULLTEXT_MODE_KEY) === 'fulltext' ? 'fulltext' : 'summary';
  } catch {
    return 'summary';
  }
}
function writeFulltextMode(m: FulltextMode): void {
  try { localStorage.setItem(FULLTEXT_MODE_KEY, m); } catch { /* ignore */ }
}
function isForcedSummary(): boolean {
  try { return localStorage.getItem(FORCE_SUMMARY_KEY) === '1'; } catch { return false; }
}

// escapeHtml:之前漏写导致 paper-chat.ts 顶层调用 initChat() 抛 ReferenceError,
// 整个 ES module bundle 求值失败,顺带把 paper-figures.ts 的 initFigures 也拖死,
// 表现为"图表 carousel 按钮点不到"。放在模块顶层,其它页面 import 也无害。
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================================
// LLM 调用:简化版 chat completion(不走 paper-analyzer.callLLM,那是为
// 结构化 JSON 输出设计的,聊天拿 content 字符串即可)。
// ============================================================================
async function sendChat(messages: ChatMessage[], cfg: LLMConfig): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const isDeepSeek = /^https?:\/\/api\.deepseek\.com/i.test(cfg.baseUrl);
  const isReasoning = /reasoner|reasoning|r1/i.test(cfg.model);
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: 0.4,
  };
  if (isDeepSeek && isReasoning) {
    body.thinking = { type: 'disabled' };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API 错误 (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  let content: string = data?.choices?.[0]?.message?.content ?? '';
  // 推理模型(DeepSeek-R1 等)可能把中间思考放到独立字段,这里合成进 content
  // 后由 markdown 渲染器统一折叠展示,而非直接丢给用户。
  const reasoning: string = data?.choices?.[0]?.message?.reasoning_content
    || data?.choices?.[0]?.message?.reasoning
    || '';
  if (reasoning) content = `思考过程:\n${reasoning}\n\n---\n\n${content}`;
  if (!content.trim()) throw new Error('LLM 返回为空');
  // 即便上游只把 思路 放在 content 里,也整体走渲染器统一处理。
  return content;
}

// ============================================================================
// System prompt 构建 — 接受可选 skeleton,summary / fulltext 共用同一模板
// ============================================================================
function buildSystemPrompt(d: DOMStringMap, skeleton: FulltextSkeleton | null = null): string {
  const titleZh = d.titleZh || '';
  const titleEn = d.title || '';
  const authors = d.authors || '';
  const tldr = d.tldr || '';
  const motivation = d.motivation || '';
  const method = d.method || '';
  const result = d.result || '';
  const conclusion = d.conclusion || '';
  const tags = d.tags || '';
  const arxivId = d.arxivId || '';

  const lines: string[] = [];
  lines.push('你是一位耐心的科研助手,正在帮用户理解一篇论文。');
  if (skeleton) {
    // 全文模式:让 LLM 优先用骨架,但不丢掉摘要(摘要已是高密度浓缩,放在最前)
    lines.push('下面是该论文的结构化摘要 + ar5iv.org 抓到的全文骨架(章节标题 + 每段首句 + 公式/表格计数)。');
    lines.push('优先基于全文骨架回答细节问题(方法、实验、附录);摘要信息可直接复用;若骨架未覆盖,坦诚告知。');
  } else {
    lines.push('下面是该论文的结构化摘要(由 daily pipeline 预先生成);当用户提问时,请**优先基于这些信息回答**,如确实超出范围请明确说"摘要里没提到,我无法确认"。');
  }
  lines.push('回答用中文,简洁清晰,必要时用列表/小标题;避免编造论文里没写的细节。');
  lines.push('');
  lines.push('=== 论文信息 ===');
  if (titleZh) lines.push(`中文标题:${titleZh}`);
  if (titleEn && titleEn !== titleZh) lines.push(`英文标题:${titleEn}`);
  if (arxivId) lines.push(`arXiv ID:${arxivId}`);
  if (authors) lines.push(`作者:${authors}`);
  if (tags) lines.push(`标签:${tags}`);
  if (tldr) lines.push(`\nTL;DR:\n${tldr}`);
  if (motivation) lines.push(`\n动机:\n${motivation}`);
  if (method) lines.push(`\n方法:\n${method}`);
  if (result) lines.push(`\n结果:\n${result}`);
  if (conclusion) lines.push(`\n结论:\n${conclusion}`);
  if (skeleton) {
    lines.push('\n=== 论文全文骨架(ar5iv 抓取,按章节结构排列) ===');
    lines.push(skeletonToPromptText(skeleton));
  }
  lines.push('');
  lines.push('=== 回答指南 ===');
  lines.push('- 用户可能追问方法细节、实验设置、局限性、与相关工作的对比等。');
  if (skeleton) {
    lines.push('- 骨架里的章节用 ## 标记,可按章节引用(如"见 §Method")。');
    lines.push('- 若用户问的细节在骨架里没出现,坦诚说明,不要从其他论文知识推断。');
  } else {
    lines.push('- 如果用户的问题涉及摘要外的内容(如完整数学推导、附录实验),坦诚告知摘要范围有限。');
  }
  lines.push('- 不要复述完整摘要/骨架;直接回答用户具体的问题。');
  return lines.join('\n');
}

// ============================================================================
// Markdown 渲染 — 复用 lib/markdown 的 SSR 渲染器,标题自动 downshift 两级。
// 唯一的额外职责:把模型输出里偶发的 块包成可折叠 details,默认收起。
// ============================================================================

// 按字符位置扫描 块(可独占行、可与正文同行、可跨段),
function extractThinkSegments(
  src: string,
): Array<{ kind: 'think' | 'plain'; text: string }> {
  const out: Array<{ kind: 'think' | 'plain'; text: string }> = [];
  const closeRe = /<\/think>/gi;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = closeRe.exec(src)) !== null) {
    const segmentEnd = m.index;
    const segment = src.slice(cursor, segmentEnd);
    const openIdx = segment.toLowerCase().lastIndexOf('<');
    if (openIdx === -1) {
      if (segment) out.push({ kind: 'plain', text: segment });
    } else {
      const before = segment.slice(0, openIdx);
      const innerStart = openIdx + 7;
      const inner = segment.slice(innerStart);
      if (before) out.push({ kind: 'plain', text: before });
      if (inner.trim()) out.push({ kind: 'think', text: inner });
    }
    cursor = m.index + m[0].length;
  }
  const tail = src.slice(cursor);
  if (tail) out.push({ kind: 'plain', text: tail });
  return out;
}

function renderMessageBody(content: string): string {
  // 剥离 块后每段都交给 SSR 渲染器。chat: true 让标题整体下移两级,跳过 figures 区块。
  // think 段渲染后再包成可折叠的 details;plain 段直接渲染。
  const segs = extractThinkSegments(content);
  return segs
    .map((seg) => {
      const rendered = renderMarkdownBody(seg.text, { chat: true });
      if (seg.kind === 'think') {
        return (
          '<details class="paper-chat-think">' +
          '<summary>🧠 思考过程</summary>' +
          '<div class="paper-chat-think-body">' +
          rendered +
          '</div>' +
          '</details>'
        );
      }
      return rendered;
    })
    .join('');
}

// ============================================================================
// UI 渲染:右侧贴边常驻侧栏 + 显示/隐藏开关 FAB
// ============================================================================
const QUICK_PROMPTS = [
  '这篇论文的核心方法是什么?',
  '主要实验结果和 baseline 对比如何?',
  '这篇论文有哪些局限性?',
  '用一句话给我讲明白这篇论文',
];

// 用户偏好"侧栏默认可见" — 跨会话持久化(沿用 settings.ts 的 dpr_analyzer_*_v1 约定)
const CHAT_DOCKED_KEY = 'dpr_analyzer_chat_docked_v1';
function readChatDocked(): boolean {
  try {
    return localStorage.getItem(CHAT_DOCKED_KEY) !== '0';
  } catch {
    return true;
  }
}
function writeChatDocked(v: boolean): void {
  try {
    localStorage.setItem(CHAT_DOCKED_KEY, v ? '1' : '0');
  } catch {
    /* localStorage 不可用时静默忽略(隐私模式等) */
  }
}

function renderDock(container: HTMLElement): {
  fab: HTMLButtonElement;
  panel: HTMLDivElement;
  stream: HTMLDivElement;
  input: HTMLTextAreaElement;
  sendBtn: HTMLButtonElement;
  clearBtn: HTMLAnchorElement;
  errorBox: HTMLDivElement;
  quickBox: HTMLDivElement;
  badge: HTMLSpanElement;
  // 全文模式相关
  modeToggle: HTMLDivElement;
  modeBadge: HTMLSpanElement;
  modeHint: HTMLDivElement;
} {
  const arxivId = container.dataset.arxivId || '';
  // 容器本身是数据载体,实际渲染都挂到 body 上的浮层节点
  container.style.display = 'none';

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'paper-chat-fab paper-chat-fab--sidebar paper-chat-fab--sidebar-visible';
  fab.setAttribute('aria-label', '切换与论文对话');
  fab.title = '与论文对话';
  fab.innerHTML = `<span class="paper-chat-fab-icon">💬</span><span class="paper-chat-fab-badge" hidden>0</span><span class="paper-chat-fab-mode-dot" hidden></span>`;

  const panel = document.createElement('div');
  // 默认带 --sidebar 修饰类;--hidden 由 initChat 根据用户偏好决定是否加上
  panel.className = 'paper-chat-panel paper-chat-panel--sidebar';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '与论文对话');
  // dpr_analyzer_chat_force_summary_v1='1' 时,把 toggle 锁在 summary 并显示提示。
  const forced = isForcedSummary();
  panel.innerHTML = `
    <div class="paper-chat-head">
      <div class="paper-chat-title">
        💬 与论文对话
        ${arxivId ? `<span class="paper-chat-arxiv">${escapeHtml(arxivId)}</span>` : ''}
      </div>
      <button type="button" class="paper-chat-close" aria-label="收起">×</button>
    </div>
    <div class="paper-chat-mode" role="group" aria-label="对话上下文模式">
      <button type="button" class="paper-chat-mode-btn paper-chat-mode-btn--active" data-mode="summary">📄 摘要</button>
      <button type="button" class="paper-chat-mode-btn" data-mode="fulltext" ${forced ? 'disabled title="管理员在 localStorage 设置了 dpr_analyzer_chat_force_summary_v1=1,全文模式已禁用"' : ''}>📄 全文</button>
      <span class="paper-chat-mode-badge" data-state="idle" aria-live="polite"></span>
    </div>
    <div class="paper-chat-sub">
      默认基于本篇论文的结构化摘要与 LLM 多轮对话。
      需问方法细节 / 实验设置 / 附录等不在摘要里的内容,
      上面切到「📄 全文」即可(读 daily pipeline 已抽取的本地 PDF 正文,秒开)。
      未配置 LLM?去 <a href="./../../settings/">设置页</a>。
    </div>
    <div class="paper-chat-mode-hint" hidden></div>
    <div class="paper-chat-stream" id="chat-stream" role="log" aria-live="polite"></div>
    <div class="paper-chat-quick" id="chat-quick">
      ${QUICK_PROMPTS.map((q, i) => `<button type="button" class="paper-chat-chip" data-quick="${i}">${escapeHtml(q)}</button>`).join('')}
    </div>
    <div class="paper-chat-error" id="chat-error" hidden></div>
    <div class="paper-chat-input">
      <textarea id="chat-input" rows="2" placeholder="问点关于这篇论文的问题…(Shift+Enter 换行)"></textarea>
      <div class="paper-chat-actions">
        <button type="button" id="chat-send" class="paper-chat-send">发送</button>
        <a href="#" id="chat-clear" class="paper-chat-clear" role="button">清空</a>
      </div>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  return {
    fab,
    panel,
    stream: panel.querySelector('#chat-stream') as HTMLDivElement,
    input: panel.querySelector('#chat-input') as HTMLTextAreaElement,
    sendBtn: panel.querySelector('#chat-send') as HTMLButtonElement,
    clearBtn: panel.querySelector('#chat-clear') as HTMLAnchorElement,
    errorBox: panel.querySelector('#chat-error') as HTMLDivElement,
    quickBox: panel.querySelector('#chat-quick') as HTMLDivElement,
    badge: fab.querySelector('.paper-chat-fab-badge') as HTMLSpanElement,
    modeToggle: panel.querySelector('.paper-chat-mode') as HTMLDivElement,
    modeBadge: panel.querySelector('.paper-chat-mode-badge') as HTMLSpanElement,
    modeHint: panel.querySelector('.paper-chat-mode-hint') as HTMLDivElement,
  };
}

function appendMessage(
  stream: HTMLDivElement,
  role: 'user' | 'assistant',
  content: string,
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `paper-chat-msg paper-chat-msg--${role}`;
  el.innerHTML = renderMessageBody(content);
  stream.appendChild(el);
  stream.scrollTop = stream.scrollHeight;
  return el;
}

function appendPlaceholder(stream: HTMLDivElement): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'paper-chat-msg paper-chat-msg--assistant paper-chat-msg--placeholder';
  el.textContent = '上下文已就绪,问个问题开始 ✨';
  stream.appendChild(el);
  return el;
}

function setError(box: HTMLDivElement, msg: string): void {
  box.hidden = false;
  box.textContent = msg;
}
function clearError(box: HTMLDivElement): void {
  box.hidden = true;
  box.textContent = '';
}

// ============================================================================
// 主流程
// ============================================================================
function initChat(): void {
  const container = document.getElementById('paper-chat');
  if (!container) return;
  // container 在整个 initChat 闭包内非空,但 TS 看不到入口 null check,
  // 用一个确定非空别名避免每处都用 !。
  const data = container.dataset;

  const parts = renderDock(container);
  const {
    fab, panel, stream, input, sendBtn, clearBtn, errorBox, quickBox, badge,
    modeToggle, modeBadge, modeHint,
  } = parts;

  // 配置检查:缺 key 就锁输入,提示用户去设置页
  const cfg = loadSettings();
  const cfgMissing = !cfg.apiKey?.trim() || !cfg.baseUrl?.trim() || !cfg.model?.trim();
  if (cfgMissing) {
    input.disabled = true;
    sendBtn.disabled = true;
    quickBox.classList.add('paper-chat-quick--disabled');
    setError(
      errorBox,
      '未检测到 LLM 配置,请先在 设置页 配置 apiKey / baseUrl / model 后再使用对话功能。',
    );
  }

  // ============================================================================
  // 全文模式状态机
  // ============================================================================
  // currentMode:用户当前选中(UI 反馈源)
  // currentSkeleton:已加载的骨架;null 表示还在抓或加载失败
  // loadingPromise:并发去重 — 同时多次触发不会重抓
  let currentMode: FulltextMode = readFulltextMode();
  let currentSkeleton: FulltextSkeleton | null = null;
  let loadingPromise: Promise<FulltextResult> | null = null;

  // 根据当前 mode 渲染 toggle UI 的选中态 + FAB 模式点
  function renderModeUI(state: 'idle' | 'loading' | 'ready' | 'error', hintMsg = ''): void {
    const summaryBtn = modeToggle.querySelector<HTMLButtonElement>('[data-mode="summary"]')!;
    const fulltextBtn = modeToggle.querySelector<HTMLButtonElement>('[data-mode="fulltext"]')!;
    summaryBtn.classList.toggle('paper-chat-mode-btn--active', currentMode === 'summary');
    fulltextBtn.classList.toggle('paper-chat-mode-btn--active', currentMode === 'fulltext');

    // FAB 右侧小圆点:全文模式开就亮蓝
    const dot = fab.querySelector('.paper-chat-fab-mode-dot') as HTMLElement | null;
    if (dot) dot.hidden = currentMode !== 'fulltext';

    // badge:loading/ready/error 三态
    modeBadge.dataset.state = state;
    if (state === 'loading') {
      modeBadge.innerHTML = '<span class="paper-chat-spinner"></span> 加载全文骨架…';
    } else if (state === 'ready') {
      const cnt = currentSkeleton?.sections.length ?? 0;
      modeBadge.textContent = `✅ 骨架就绪 (${cnt} 章节)`;
    } else if (state === 'error') {
      modeBadge.textContent = '⚠️ 加载失败,继续用摘要';
      modeBadge.title = hintMsg;
    } else {
      modeBadge.textContent = '';
      modeBadge.title = '';
    }

    // mode-hint 行:三态分别提示不同内容,让用户清楚当前进度 / 怎么用
    // - loading:抓全文骨架进行中
    // - error:抓取失败,已回退
    // - summary idle:提醒用户可以切全文(避免「摘要 LLM 看不到全文」的最常见困惑)
    // - fulltext idle:不打扰(用户已主动切过来)
    if (state === 'loading') {
      modeHint.hidden = false;
      modeHint.classList.remove('paper-chat-mode-hint--tip');
      modeHint.textContent = '正在抓取 ar5iv 全文,首次 3-8 秒,后续命中缓存秒切…';
    } else if (state === 'error') {
      modeHint.hidden = false;
      modeHint.classList.remove('paper-chat-mode-hint--tip');
      modeHint.textContent = `全文加载失败:${hintMsg}。已自动回退到摘要模式。`;
    } else if (state === 'idle' && currentMode === 'summary' && !isForcedSummary()) {
      // 摘要默认模式,且管理员没强制锁 — 提示有全文可用,降低发现成本
      modeHint.hidden = false;
      modeHint.classList.add('paper-chat-mode-hint--tip');
      modeHint.textContent = '💡 默认只喂 LLM 摘要。问方法细节 / 实验设置 / 附录时,记得点上方「📄 全文」(读本地 PDF 正文)。';
    } else {
      modeHint.hidden = true;
      modeHint.classList.remove('paper-chat-mode-hint--tip');
      modeHint.textContent = '';
    }
  }

  // system prompt 每次 send 前按当前 mode + skeleton 重新构造
  // 注意:messages[0] 是 system,send 时直接覆盖(不污染历史 user/assistant)
  function rebuildSystemPrompt(): void {
    const skeleton = currentMode === 'fulltext' ? currentSkeleton : null;
    messages[0] = { role: 'system', content: buildSystemPrompt(data, skeleton) };
  }

  function setMode(mode: FulltextMode): void {
    if (isForcedSummary() && mode === 'fulltext') return;
    currentMode = mode;
    writeFulltextMode(mode);
    if (mode === 'fulltext') {
      // 切到 fulltext → 触发骨架加载
      void ensureFulltextLoaded();
    } else {
      // 切回 summary → 立刻清掉骨架,下次 send 用回纯摘要 prompt
      rebuildSystemPrompt();
      renderModeUI(currentSkeleton ? 'ready' : 'idle');
    }
  }

  async function ensureFulltextLoaded(): Promise<void> {
    if (currentSkeleton) {
      rebuildSystemPrompt();
      renderModeUI('ready');
      return;
    }
    if (loadingPromise) {
      // 已有加载在进行,等它完成即可
      const result = await loadingPromise;
      applyFulltextResult(result);
      return;
    }
    renderModeUI('loading');
    const arxivId = data.arxivId || '';
    if (!arxivId) {
      renderModeUI('error', '论文 arxiv id 缺失');
      return;
    }
    loadingPromise = loadFulltextSkeleton(arxivId).catch((e: unknown) => ({
      state: 'error' as const,
      skeleton: null,
      error: (e as Error)?.message || String(e),
      hasFulltext: false,
    }));
    const result = await loadingPromise;
    loadingPromise = null;
    applyFulltextResult(result);
  }

  function applyFulltextResult(result: FulltextResult): void {
    if (result.state === 'error') {
      currentSkeleton = null;
      rebuildSystemPrompt();
      renderModeUI('error', result.error || '未知错误');
      // 骨架加载失败时,把还在 stream 里的"加载中"提示换成"已失败"提示
      // (注意:notice 已经在 send() 里根据 loadingPromise 状态显示对应文案,这里不用再改)
      return;
    }
    if (!result.skeleton) {
      currentSkeleton = null;
      rebuildSystemPrompt();
      renderModeUI('error', '骨架为空');
      return;
    }
    currentSkeleton = result.skeleton;
    rebuildSystemPrompt();
    renderModeUI('ready');
    // 骨架到位,清掉之前 user 消息旁挂的"加载中"提示
    stream.querySelectorAll('.paper-chat-mode-notice').forEach((n) => n.remove());
  }

  const messages: ChatMessage[] = [{
    role: 'system',
    content: buildSystemPrompt(data, currentMode === 'fulltext' ? currentSkeleton : null),
  }];
  let busy = false;
  let unread = 0;
  let sidebarVisible = readChatDocked();

  // 论文正文区所有 .container(4 个 section + chat 容器),同步让位/收回
  const paperContainers = Array.from(
    document.querySelectorAll<HTMLElement>('.paper-page .container'),
  );

  function applySidebarVisibility(): void {
    if (sidebarVisible) {
      panel.classList.remove('paper-chat-panel--hidden');
      fab.classList.add('paper-chat-fab--sidebar-visible');
      fab.classList.add('paper-chat-fab--active');
      for (const el of paperContainers) el.classList.remove('container--chat-hidden');
    } else {
      panel.classList.add('paper-chat-panel--hidden');
      fab.classList.remove('paper-chat-fab--sidebar-visible');
      fab.classList.remove('paper-chat-fab--active');
      for (const el of paperContainers) el.classList.add('container--chat-hidden');
    }
  }

  function showSidebar(): void {
    sidebarVisible = true;
    writeChatDocked(true);
    applySidebarVisibility();
    unread = 0;
    badge.hidden = true;
    badge.textContent = '0';
    setTimeout(() => input.focus(), 50);
  }
  function hideSidebar(): void {
    sidebarVisible = false;
    writeChatDocked(false);
    applySidebarVisibility();
  }
  function toggleSidebar(): void {
    if (sidebarVisible) hideSidebar();
    else showSidebar();
  }

  // 初始状态
  applySidebarVisibility();
  // localStorage 提示"已收起"时,首次显示需要触发角标归零逻辑
  if (!sidebarVisible) {
    unread = 0;
    badge.hidden = true;
  }

  fab.addEventListener('click', toggleSidebar);
  panel.querySelector('.paper-chat-close')?.addEventListener('click', hideSidebar);
  // Esc 键收起
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebarVisible) hideSidebar();
  });

  // 智能预热:首次 focus chat 输入框或点 FAB 打开侧栏时,如果 mode=fulltext
  // 就触发骨架加载。用户没开 chat → 零 arxiv 请求,首屏零开销。
  let prefetchTriggered = false;
  function maybePrefetch(): void {
    if (prefetchTriggered) return;
    if (currentMode === 'fulltext' && !currentSkeleton && !loadingPromise) {
      prefetchTriggered = true;
      void ensureFulltextLoaded();
    }
  }
  input.addEventListener('focus', maybePrefetch, { once: true });
  fab.addEventListener('click', maybePrefetch, { once: true });

  // toggle 按钮点击
  modeToggle.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
    if (!btn || btn.disabled) return;
    const mode = (btn.dataset.mode as FulltextMode) || 'summary';
    if (mode === currentMode) return;
    setMode(mode);
  });

  // 初始 UI 反映当前 mode(用户上次选的状态)
  renderModeUI(currentMode === 'fulltext' ? 'loading' : 'idle');
  // 若默认是 fulltext 但还没加载,fire-and-forget 抓
  if (currentMode === 'fulltext') void ensureFulltextLoaded();

  appendPlaceholder(stream);

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || busy || cfgMissing) return;

    clearError(errorBox);
    busy = true;
    sendBtn.disabled = true;
    quickBox.classList.add('paper-chat-quick--disabled');

    appendMessage(stream, 'user', trimmed);
    messages.push({ role: 'user', content: trimmed });

    // 全文模式骨架还在加载中时,在 user 消息下面挂一行小字
    // 提示"基于摘要回答中…",避免用户对回答口径困惑。
    let modeNotice: HTMLDivElement | null = null;
    if (currentMode === 'fulltext' && !currentSkeleton) {
      modeNotice = document.createElement('div');
      modeNotice.className = 'paper-chat-mode-notice';
      modeNotice.textContent = loadingPromise
        ? '⏳ 全文骨架加载中,本轮基于摘要回答'
        : '⚠️ 全文骨架加载失败,本轮基于摘要回答';
      stream.appendChild(modeNotice);
      stream.scrollTop = stream.scrollHeight;
    }

    const placeholder = document.createElement('div');
    placeholder.className = 'paper-chat-msg paper-chat-msg--assistant paper-chat-msg--thinking';
    placeholder.textContent = '思考中';
    const dots = document.createElement('span');
    dots.className = 'paper-chat-thinking-dots';
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('span');
      d.className = 'dot';
      d.textContent = '.';
      dots.appendChild(d);
    }
    placeholder.appendChild(dots);
    stream.appendChild(placeholder);
    stream.scrollTop = stream.scrollHeight;

    try {
      const reply = await sendChat(messages, cfg);
      placeholder.remove();
      const msgEl = appendMessage(stream, 'assistant', reply);
      messages.push({ role: 'assistant', content: reply });
      // 侧栏收起时,新来消息 → 角标 +1
      if (!sidebarVisible) {
        unread += 1;
        badge.textContent = String(unread);
        badge.hidden = false;
        msgEl.classList.add('paper-chat-msg--unread');
      }
    } catch (e) {
      placeholder.remove();
      const msg = (e as Error).message || String(e);
      if (/401|403|unauthor/i.test(msg)) {
        setError(errorBox, `鉴权失败:${msg}。请检查 设置页 中的 apiKey 是否正确。`);
      } else {
        setError(errorBox, msg);
      }
      // 失败时把刚才那条 user 消息从历史里弹出去,避免污染下一轮
      messages.pop();
      stream.lastElementChild?.remove();
    } finally {
      busy = false;
      if (!cfgMissing) {
        sendBtn.disabled = false;
        quickBox.classList.remove('paper-chat-quick--disabled');
      }
      input.focus();
    }
  }

  sendBtn.addEventListener('click', () => {
    const v = input.value;
    input.value = '';
    void send(v);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      void send(v);
    }
  });
  clearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (busy) return;
    stream.innerHTML = '';
    appendPlaceholder(stream);
    messages.length = 1;
    clearError(errorBox);
  });
  quickBox.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-quick]');
    if (!btn || busy || cfgMissing) return;
    const idx = Number(btn.dataset.quick || '0');
    const text = QUICK_PROMPTS[idx] ?? '';
    if (text) void send(text);
  });
}

// 顶层 try 包住:之前 initChat() 抛 ReferenceError 时(escapeHtml 未定义)
// 整个 ES module bundle 求值中断,顺带把 paper-figures.ts 的 initFigures
// 也拖死——表现就是论文图表 carousel 按钮没绑事件、点不到。
// 这里 catch + console.error,让同 bundle 其它顶层语句仍能继续执行。
try {
  initChat();
} catch (e) {
  console.error('[paper-chat] init failed:', e);
}