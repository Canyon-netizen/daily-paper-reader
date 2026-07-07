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

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
  const content: string = data?.choices?.[0]?.message?.content ?? '';
  if (!content) throw new Error('LLM 返回为空');
  return content.trim();
}

// ============================================================================
// System prompt 构建
// ============================================================================
function buildSystemPrompt(d: DOMStringMap): string {
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
  lines.push('下面是该论文的结构化摘要(由 daily pipeline 预先生成);当用户提问时,请**优先基于这些信息回答**,如确实超出范围请明确说"摘要里没提到,我无法确认"。');
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
  lines.push('');
  lines.push('=== 回答指南 ===');
  lines.push('- 用户可能追问方法细节、实验设置、局限性、与相关工作的对比等。');
  lines.push('- 如果用户的问题涉及摘要外的内容(如完整数学推导、附录实验),坦诚告知摘要范围有限。');
  lines.push('- 不要复述完整摘要;直接回答用户具体的问题。');
  return lines.join('\n');
}

// ============================================================================
// 极简 Markdown:bold / italic / inline code / 链接 / 换行。不引外部依赖。
// ============================================================================
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, txt, url) =>
    `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`,
  );
  return out;
}

function renderMessageBody(content: string): string {
  return content
    .split(/\n{2,}/)
    .map((para) => `<p>${renderInline(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// ============================================================================
// UI 渲染:浮动按钮 + 展开面板
// ============================================================================
const QUICK_PROMPTS = [
  '这篇论文的核心方法是什么?',
  '主要实验结果和 baseline 对比如何?',
  '这篇论文有哪些局限性?',
  '用一句话给我讲明白这篇论文',
];

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
} {
  const arxivId = container.dataset.arxivId || '';
  // 容器本身是数据载体,实际渲染都挂到 body 上的浮层节点
  container.style.display = 'none';

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'paper-chat-fab';
  fab.setAttribute('aria-label', '打开与论文对话');
  fab.title = '与论文对话';
  fab.innerHTML = `<span class="paper-chat-fab-icon">💬</span><span class="paper-chat-fab-badge" hidden>0</span>`;

  const panel = document.createElement('div');
  panel.className = 'paper-chat-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '与论文对话');
  panel.innerHTML = `
    <div class="paper-chat-head">
      <div class="paper-chat-title">
        💬 与论文对话
        ${arxivId ? `<span class="paper-chat-arxiv">${escapeHtml(arxivId)}</span>` : ''}
      </div>
      <button type="button" class="paper-chat-close" aria-label="收起">×</button>
    </div>
    <div class="paper-chat-sub">
      基于本篇论文的结构化摘要与 LLM 多轮对话。
      未配置 LLM?去 <a href="./../../settings/">设置页</a>。
    </div>
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

  const parts = renderDock(container);
  const {
    fab, panel, stream, input, sendBtn, clearBtn, errorBox, quickBox, badge,
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

  const systemPrompt = buildSystemPrompt(container.dataset);
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  let busy = false;
  let unread = 0;
  let panelOpen = false;

  function openPanel(): void {
    panelOpen = true;
    panel.hidden = false;
    unread = 0;
    badge.hidden = true;
    badge.textContent = '0';
    fab.classList.add('paper-chat-fab--active');
    setTimeout(() => input.focus(), 50);
  }
  function closePanel(): void {
    panelOpen = false;
    panel.hidden = true;
    fab.classList.remove('paper-chat-fab--active');
  }
  fab.addEventListener('click', () => {
    if (panelOpen) closePanel();
    else openPanel();
  });
  panel.querySelector('.paper-chat-close')?.addEventListener('click', closePanel);
  // Esc 键收起
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelOpen) closePanel();
  });

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

    const placeholder = document.createElement('div');
    placeholder.className = 'paper-chat-msg paper-chat-msg--assistant paper-chat-msg--thinking';
    placeholder.textContent = '思考中…';
    stream.appendChild(placeholder);
    stream.scrollTop = stream.scrollHeight;

    try {
      const reply = await sendChat(messages, cfg);
      placeholder.remove();
      const msgEl = appendMessage(stream, 'assistant', reply);
      messages.push({ role: 'assistant', content: reply });
      // 面板收起时,新来消息 → 角标 +1
      if (!panelOpen) {
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

initChat();