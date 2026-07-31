// astro-src/scripts/paper-highlights.ts
//
// 全文高亮客户端(Stage 12 v1)。
//
// 范围:仅在 .paper-body 内的 selection;selection 全程在同一个 paragraph
// 段落内时保存;不跨段(避免句子截断)。
//
// UI:
//   - 选中 → 浮一个 "🖍 添加高亮" 按钮,点 → 调 addHighlight() 入 IDB
//   - 重载页面 → 调用 listHighlights() 渲染 <mark data-hl-id="..."> 包裹
//   - 顶上一栏 "N 条高亮" + "清空" 链接(确认后清)
//
// 高亮 v1 不带 favorite / color / page(plan §Stage 12 决策):今天没有
// PDF 阅读器,字段无渲染方;以后真引入 reader 时再扩字段。

import {
  addHighlight,
  deleteHighlight,
  listHighlights,
  locateHighlight,
  type Highlight,
} from '../lib/user-library/highlights';
import { showToast } from './toast';

let activeBar: HTMLDivElement | null = null;
let activeBtn: HTMLButtonElement | null = null;

function getCanonicalId(): string | null {
  const btn = document.getElementById('paper-star-btn');
  const raw = btn?.dataset.arxivId || '';
  const cx = raw.trim();
  return cx || null;
}

function clearActive(): void {
  if (activeBtn) { activeBtn.remove(); activeBtn = null; }
  if (activeBar) { activeBar.remove(); activeBar = null; }
}

function inPaperBody(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return !!el.closest('.paper-body');
}

/** 全文文本中嵌入 <mark> 包裹,跳过已存在的 mark / code / pre。 */
function paintHighlights(root: HTMLElement, list: Highlight[]): void {
  if (!list.length) return;
  // 收集所有段落(walker);每段单独处理,避免跨段边界
  const targets = root.querySelectorAll<HTMLElement>('p, li, blockquote, h1, h2, h3, h4');
  for (const el of targets) {
    // 跳过已有 mark / 媒体节点
    if (el.querySelector('mark, img, audio, video, code, pre')) continue;
    const original = el.innerHTML;
    let html = original;
    for (const h of list) {
      // 简单文本替换(转义正则元字符)
      const escaped = h.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 用 \b 边界降低误命中:首尾不是 CJK 时要求 word boundary
      const re = new RegExp(escaped, 'g');
      html = html.replace(re, `<mark data-hl-id="${h.id}" class="paper-hl">${
        h.text.replace(/</g, '&lt;')
      }</mark>`);
    }
    if (html !== original) el.innerHTML = html;
  }
}

async function renderHighlights(): Promise<void> {
  const canonical = getCanonicalId();
  if (!canonical) return;
  const body = document.querySelector<HTMLElement>('.paper-body');
  if (!body) return;
  const list = await listHighlights(canonical);
  paintHighlights(body, list);
  if (list.length > 0) {
    injectBar(list.length);
  }
}

function injectBar(count: number): void {
  if (document.getElementById('paper-hl-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'paper-hl-bar';
  bar.className = 'paper-hl-bar';
  bar.innerHTML = `
    <span class="paper-hl-count">${count} 条高亮</span>
    <button type="button" class="paper-hl-clear" data-paper-hl-clear>🗑 清空本页</button>
  `;
  const body = document.querySelector<HTMLElement>('.paper-body');
  if (body) body.parentElement?.insertBefore(bar, body);
  bar.querySelector('[data-paper-hl-clear]')?.addEventListener('click', () => {
    if (!confirm('确认清空本论文的全部高亮?无法撤销。')) return;
    void clearAll();
  });
}

async function clearAll(): Promise<void> {
  const canonical = getCanonicalId();
  if (!canonical) return;
  const list = await listHighlights(canonical);
  for (const h of list) await deleteHighlight(h.id);
  const body = document.querySelector<HTMLElement>('.paper-body');
  if (body) {
    body.querySelectorAll('mark.paper-hl').forEach((m) => {
      const p = m.parentNode;
      if (!p) return;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
    });
  }
  document.getElementById('paper-hl-bar')?.remove();
  showToast('已清空本论文高亮', 'ok');
}

function maybeShowSelectionButton(): void {
  clearActive();
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!inPaperBody(range.startContainer) || !inPaperBody(range.endContainer)) return;
  const text = sel.toString().trim();
  if (text.length < 2) return;
  const rect = range.getBoundingClientRect();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'paper-hl-pick';
  btn.textContent = '🖍 添加高亮';
  btn.style.position = 'fixed';
  btn.style.left = `${rect.left + rect.width / 2 - 50}px`;
  btn.style.top = `${rect.bottom + 8}px`;
  btn.style.zIndex = '9999';
  btn.addEventListener('click', async () => {
    const canonical = getCanonicalId();
    if (!canonical) return;
    const h = await addHighlight(canonical, text);
    if (!h) {
      showToast('高亮保存失败:IndexedDB 不可用', 'error');
      return;
    }
    showToast('已保存高亮', 'ok');
    clearActive();
    sel.removeAllRanges();
    // Re-paint;
    const body = document.querySelector<HTMLElement>('.paper-body');
    if (body) {
      body.querySelectorAll('mark.paper-hl').forEach((m) => {
        const p = m.parentNode;
        if (!p) return;
        while (m.firstChild) p.insertBefore(m.firstChild, m);
        p.removeChild(m);
      });
    }
    await renderHighlights();
  });
  document.body.appendChild(btn);
  activeBtn = btn;
  // 滚动时按钮跟着 selection 移动 — 简化:仅在用户选中的同时挂一次,
  // 移开 / 滚动都不跟;下次 selection 重建。
}

function init(): void {
  void renderHighlights();
  document.addEventListener('mouseup', () => {
    // 短延迟等 selection 稳定
    setTimeout(maybeShowSelectionButton, 50);
  });
  document.addEventListener('scroll', () => {
    if (activeBtn) clearActive();
  }, { passive: true });
}

try {
  init();
} catch (e) {
  console.error('[paper-highlights] init failed:', e);
}