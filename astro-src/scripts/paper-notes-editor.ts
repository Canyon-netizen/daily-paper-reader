// /scripts/paper-notes-editor.ts
//
// 论文详情页底部的"我的笔记"区:
//   - textarea 失焦防抖保存到 lib/user-library(setUserNote)
//   - 切换预览 / 编辑模式;预览走 renderMarkdownBody 复用 server 渲染链路
//   - 配额失败时弹 toast(Stage 1 决定的 WriteResult 必须显式处理)
//   - wikilink 自动补全:用户输入 [[ 时弹出下拉,选择后插入 [arxivId] 或 [title]
//
// 数据载体:#paper-notes-section 在 [arxiv].astro 渲染;canonical arxivId 由
// 按钮 #paper-star-btn / #paper-status-btn 的 data-arxiv-id 读出。
//
// 沿用 paper-chat / paper-hide 的容错约定:
//   - DOM / canonicalArxivId 缺失 → 直接 return,不抛错
//   - 顶层 try/catch 包 init(),避免一处错误拖死 ES module bundle

import { debounce } from '../lib/dom-utils';
import { renderMarkdownBody } from '../lib/markdown';
import {
  getUserNote,
  setUserNote,
} from '../lib/user-library';
import { onDprUserLibraryChange } from '../lib/events';
import { showToast } from './toast';

interface PaperIndexEntry {
  id: string;
  canonicalArxivId: string;
  title?: string;
  title_zh?: string;
  title_plain?: string;
  title_zh_plain?: string;
}

function init(): void {
  const section = document.getElementById('paper-notes-section');
  const textarea = document.getElementById('paper-notes-textarea') as HTMLTextAreaElement | null;
  const preview = document.getElementById('paper-notes-preview');
  const toggle = document.getElementById('paper-notes-toggle') as HTMLButtonElement | null;
  const saved = document.getElementById('paper-notes-saved');
  if (!section || !textarea || !preview || !toggle) return;

  // 取 canonicalArxivId —— 优先级:笔记按钮上的 data-arxiv-id > #paper-library-state 段
  let canonicalId =
    (document.getElementById('paper-star-btn')?.dataset.arxivId || '').trim() ||
    (document.getElementById('paper-library-state')?.dataset.canonicalArxivId || '').trim();
  if (!canonicalId || canonicalId === ' ') return;

  // 解析 paper index (用于 wikilink 自动补全)
  let paperIndex: PaperIndexEntry[] = [];
  try {
    const indexJson = section.dataset.paperIndex;
    if (indexJson) {
      paperIndex = JSON.parse(indexJson);
    }
  } catch {
    // 解析失败则没有自动补全
    paperIndex = [];
  }

  // 构建 wikilink resolver (用于渲染)
  const wikilinkResolver = new Map<string, { slug: string; display_name: string }>();
  for (const p of paperIndex) {
    const slug = p.canonicalArxivId;
    const display = p.title_zh_plain || p.title_plain || p.title_zh || p.title || slug;
    wikilinkResolver.set(slug, { slug, display_name: display });
    // 也按 title 索引(用于 [[title]] 形式的 wikilink)
    const titleLower = (p.title_plain || p.title || '').toLowerCase();
    if (titleLower && !wikilinkResolver.has(titleLower)) {
      wikilinkResolver.set(titleLower, { slug, display_name: display });
    }
    const titleZhLower = (p.title_zh_plain || p.title_zh || '').toLowerCase();
    if (titleZhLower && !wikilinkResolver.has(titleZhLower)) {
      wikilinkResolver.set(titleZhLower, { slug, display_name: display });
    }
  }

  // wikilink 自动补全相关
  let dropdown: HTMLUListElement | null = null;
  let dropdownItems: PaperIndexEntry[] = [];
  let selectedIndex = -1;
  let currentQuery = '';

  function createDropdown(): void {
    if (dropdown) return;
    dropdown = document.createElement('ul');
    dropdown.id = 'wikilink-dropdown';
    dropdown.className = 'wikilink-dropdown';
    dropdown.hidden = true;
    // 插入到 textarea 后面
    textarea!.parentElement?.appendChild(dropdown);
  }

  function showDropdown(items: PaperIndexEntry[], query: string): void {
    if (!dropdown) createDropdown();
    if (!dropdown) return;

    dropdownItems = items;
    currentQuery = query;
    selectedIndex = -1;

    if (items.length === 0) {
      dropdown.hidden = true;
      return;
    }

    dropdown.innerHTML = items
      .slice(0, 10)
      .map(
        (p, i) => `
        <li class="wikilink-dropdown-item" data-index="${i}" tabindex="-1">
          <span class="wikilink-dropdown-id">${p.canonicalArxivId}</span>
          <span class="wikilink-dropdown-title">${(p.title_zh_plain || p.title_plain || p.title_zh || p.title || '').slice(0, 60)}</span>
        </li>
      `
      )
      .join('');

    // 定位到 textarea 光标下方
    const rect = textarea!.getBoundingClientRect();
    dropdown.style.position = 'absolute';
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.width = `${rect.width}px`;
    dropdown.hidden = false;
  }

  function hideDropdown(): void {
    if (dropdown) {
      dropdown.hidden = true;
    }
    dropdownItems = [];
    selectedIndex = -1;
    currentQuery = '';
  }

  function selectItem(index: number): void {
    if (index < 0 || index >= dropdownItems.length) return;
    const p = dropdownItems[index];
    // 插入 [[arxivId]] 形式的 wikilink
    const insertText = `[[${p.canonicalArxivId}]]`;

    // 找到 [[ 开头位置并替换
    const text = textarea!.value;
    const cursorPos = textarea!.selectionStart;
    const beforeCursor = text.slice(0, cursorPos);
    const afterCursor = text.slice(cursorPos);

    // 找最近的开括号 [[
    const openBracketsIdx = beforeCursor.lastIndexOf('[[');
    if (openBracketsIdx === -1) return;

    // 替换 [[query 为 [[arxivId]]
    const newBefore = beforeCursor.slice(0, openBracketsIdx) + insertText;
    textarea!.value = newBefore + afterCursor;

    // 移动光标到插入内容后面
    const newCursorPos = newBefore.length;
    textarea!.setSelectionRange(newCursorPos, newCursorPos);

    hideDropdown();
    textarea!.focus();
  }

  function filterPapers(query: string): PaperIndexEntry[] {
    if (!query) return [];
    const q = query.toLowerCase().trim();
    return paperIndex
      .filter((p) => {
        // 优先匹配 arxivId
        if (p.canonicalArxivId.toLowerCase().includes(q)) return true;
        // 再匹配 title
        const title = p.title_plain || p.title || '';
        const titleZh = p.title_zh_plain || p.title_zh || '';
        return title.toLowerCase().includes(q) || titleZh.toLowerCase().includes(q);
      })
      .slice(0, 10);
  }

  // 监听 input 事件处理 wikilink 自动补全
  textarea.addEventListener('input', () => {
    const text = textarea.value;
    const cursorPos = textarea.selectionStart;
    const beforeCursor = text.slice(0, cursorPos);

    // 检测是否在输入 [[
    const lastOpenBrackets = beforeCursor.lastIndexOf('[[');
    if (lastOpenBrackets === -1) {
      hideDropdown();
      return;
    }

    // 检查 [[ 后面是否有 ]] (即已完成输入)
    const afterOpen = beforeCursor.slice(lastOpenBrackets + 2);
    if (afterOpen.includes(']]')) {
      hideDropdown();
      return;
    }

    // 提取查询词
    const query = afterOpen;
    const items = filterPapers(query);
    showDropdown(items, query);
  });

  // 键盘导航
  textarea.addEventListener('keydown', (e) => {
    if (!dropdown || dropdown.hidden) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, dropdownItems.length - 1);
        updateDropdownSelection();
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateDropdownSelection();
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          selectItem(selectedIndex);
        }
        break;
      case 'Escape':
        e.preventDefault();
        hideDropdown();
        break;
      case 'Tab':
        e.preventDefault();
        if (selectedIndex >= 0) {
          selectItem(selectedIndex);
        }
        break;
    }
  });

  function updateDropdownSelection(): void {
    if (!dropdown) return;
    const items = dropdown.querySelectorAll('.wikilink-dropdown-item');
    items.forEach((item, i) => {
      item.classList.toggle('is-selected', i === selectedIndex);
    });
    if (selectedIndex >= 0) {
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }

  // 点击其他地方关闭下拉
  document.addEventListener('click', (e) => {
    if (dropdown && !dropdown.contains(e.target as Node) && e.target !== textarea) {
      hideDropdown();
    }
  });

  // 点击下拉选项
  if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.wikilink-dropdown-item')) {
        const item = target.closest('.wikilink-dropdown-item') as HTMLElement;
        const idx = parseInt(item.dataset.index || '-1', 10);
        if (idx >= 0) selectItem(idx);
      }
    });
  }

  // 初始内容:从 user-library 读;空 = placeholder
  textarea.value = getUserNote(canonicalId);

  // 防抖保存:停顿 1000ms 后写;失焦立即写一次
  const debouncedSave = debounce((text: string) => {
    const res = setUserNote(canonicalId, text);
    if (!res.ok) {
      const msg =
        res.reason === 'quota'
          ? '笔记保存失败:本地存储已满。考虑清理或关闭一些其它标签页。'
          : '笔记保存失败:本地存储不可用';
      showToast(msg, 'error');
      return;
    }
    if (res.changed) flashSaved();
  }, 1000);

  textarea.addEventListener('input', () => {
    debouncedSave(textarea.value);
  });
  textarea.addEventListener('blur', () => {
    // 失焦强制立即写,不等防抖尾巴
    const res = setUserNote(canonicalId, textarea.value);
    if (!res.ok) {
      const msg =
        res.reason === 'quota'
          ? '笔记保存失败:本地存储已满'
          : '笔记保存失败:本地存储不可用';
      showToast(msg, 'error');
      return;
    }
    if (res.changed) flashSaved();
  });

  // 预览 / 编辑切换
  toggle.addEventListener('click', () => {
    const showingPreview = !preview.hidden;
    if (showingPreview) {
      // → 切回编辑
      preview.hidden = true;
      textarea.hidden = false;
      toggle.classList.remove('is-preview');
      toggle.textContent = '👁 预览';
      textarea.focus();
    } else {
      // → 切预览,渲染 markdown (含 wikilink)
      const html = renderMarkdownBody(textarea.value || '*(暂无笔记)*', { wikilinkResolver });
      preview.innerHTML = html;
      preview.hidden = false;
      textarea.hidden = true;
      toggle.classList.add('is-preview');
      toggle.textContent = '✏ 编辑';
    }
  });

  function flashSaved(): void {
    if (!saved) return;
    saved.hidden = false;
    window.setTimeout(() => {
      saved.hidden = true;
    }, 1500);
  }

  // 跨 tab / Gist pull 同步后刷新 textarea。如果当前正在编辑,不要打断用户;
  // 为了简单,只在 textarea 没聚焦时同步值。
  const off = onDprUserLibraryChange(window, (detail) => {
    if (!detail.ids.includes(canonicalId)) return;
    if (document.activeElement === textarea) return;
    const cur = getUserNote(canonicalId);
    if (textarea.value !== cur) textarea.value = cur;
  });
  // 不主动 off —— 页面卸载时 GC 回收。
  void off;
}

try {
  init();
} catch (e) {
  console.error('[paper-notes-editor] init failed:', e);
}
