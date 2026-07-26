// 主题切换:light → dark → contrast → light 循环
// 状态持久化到 localStorage.dpr_theme_v1

import { emitDprThemeChange } from '../lib/events';

const STORAGE_KEY = 'dpr_theme_v1';
const THEMES = ['light', 'dark', 'contrast'] as const;
type Theme = typeof THEMES[number];

function getCurrentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme') as Theme | null;
  return attr && (THEMES as readonly string[]).includes(attr) ? attr : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* quota / SSR ignore */ }
  // 强类型事件总线(emit helper 同时 fire 新名 + legacy alias,旧 listener 也能收到)
  emitDprThemeChange(document, { theme });
}

function nextTheme(current: Theme): Theme {
  const idx = THEMES.indexOf(current);
  return THEMES[(idx + 1) % THEMES.length];
}

function init() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const current = getCurrentTheme();
    applyTheme(nextTheme(current));
  });
  // 监听跨标签页变化
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && e.newValue && (THEMES as readonly string[]).includes(e.newValue)) {
      applyTheme(e.newValue as Theme);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
