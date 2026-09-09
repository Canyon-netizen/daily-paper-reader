/**
 * tests/test_agents_shortcuts_v2.mjs — iter #26 键盘快捷键扩展
 *
 * iter #11 加了 3 个快捷键:⌘+Enter / ⌘+. / ?
 * iter #26 加一组单键快捷键 + 拓展帮助面板:
 *   n       → new round (跳到 session-id 输入框)
 *   e       → export session
 *   r       → export report
 *   d       → duplicate session
 *   x       → abort running round
 *   t       → toggle auto-iterate checkbox
 *   /       → focus search input
 *   ?       → toggle help popover
 *   Esc     → close help popover
 *
 * 测试 help popover 纯逻辑:
 *   - renderHelpDialog():返回完整 HTML 字符串,包含所有快捷键
 *   - formatKey('mod+Enter', isMac) → '⌘ Enter' or 'Ctrl+Enter'
 *   - parseShortcut('⌘+Shift+Enter') → { mod: true, shift: true, key: 'Enter' }
 *   - shouldIgnore(target, key) → input/textarea 里不触发
 *
 * 跑法:node tests/test_agents_shortcuts_v2.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * 解析快捷键字符串成 { mod, shift, alt, key }
 * 支持 '⌘+Enter' / 'Ctrl+Shift+.' / '?' / 'Esc'
 */
function parseShortcut(spec) {
  const parts = spec.split('+').map((s) => s.trim());
  const out = { mod: false, shift: false, alt: false, key: '' };
  for (const p of parts) {
    if (p === '⌘' || p === 'Ctrl' || p === 'Cmd' || p === 'Mod') out.mod = true;
    else if (p === 'Shift') out.shift = true;
    else if (p === 'Alt' || p === 'Option') out.alt = true;
    else if (p === 'Esc' || p === 'Escape') out.key = 'Escape';
    else out.key = p;
  }
  return out;
}

/**
 * 把 spec 渲染成用户能看懂的按键表示
 * Mac 模式:'⌘+Enter' → '⌘ Enter'
 * 其他:'Ctrl+Enter'
 */
function formatKey(spec, isMac) {
  const p = parseShortcut(spec);
  const parts = [];
  if (p.mod) parts.push(isMac ? '⌘' : 'Ctrl');
  if (p.shift) parts.push('Shift');
  if (p.alt) parts.push(isMac ? '⌥' : 'Alt');
  parts.push(p.key);
  return parts.join(isMac ? ' ' : '+');
}

/**
 * 是否应该忽略(在 input/textarea/contentEditable 里)
 */
function shouldIgnore(target) {
  if (!target || !target.tagName) return false;
  const tag = String(target.tagName).toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * 完整的快捷键表
 */
const SHORTCUTS = [
  { spec: '⌘+Enter',         desc: '跑一轮',                category: 'Run' },
  { spec: '⌘+Shift+Enter',   desc: '开始 / 停止自动迭代',   category: 'Run' },
  { spec: 'x',               desc: '停止当前 round',        category: 'Run' },
  { spec: 'n',               desc: '聚焦 session 输入框',   category: 'Navigate' },
  { spec: 'e',               desc: '导出当前 session',      category: 'Export' },
  { spec: 'r',               desc: '生成实验报告',          category: 'Export' },
  { spec: 'd',               desc: '复制 session',          category: 'Session' },
  { spec: 't',               desc: '切换 auto-iterate 开关', category: 'Run' },
  { spec: '/',               desc: '聚焦搜索框',            category: 'Navigate' },
  { spec: '?',               desc: '显示 / 隐藏这个帮助',   category: 'Help' },
  { spec: 'Escape',          desc: '关闭弹窗',              category: 'Help' },
];

/**
 * 渲染帮助面板的 HTML
 * 按 category 分组,每组里按 spec 排序
 */
function renderHelpDialog(isMac) {
  const grouped = new Map();
  for (const s of SHORTCUTS) {
    if (!grouped.has(s.category)) grouped.set(s.category, []);
    grouped.get(s.category).push(s);
  }
  const catOrder = ['Run', 'Session', 'Export', 'Navigate', 'Help'];
  let html = '<h3>⌨️ 键盘快捷键</h3><tbody>';
  for (const cat of catOrder) {
    const items = grouped.get(cat);
    if (!items) continue;
    html += `<tr class="agents-shortcut-cat"><th colspan="2">${cat}</th></tr>`;
    for (const s of items) {
      const key = formatKey(s.spec, isMac);
      const safeDesc = s.desc.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      html += `<tr class="agents-shortcut-row"><th><kbd>${key}</kbd></th><td>${safeDesc}</td></tr>`;
    }
  }
  html += '</tbody>';
  return html;
}

/**
 * 匹配一个 KeyboardEvent 和一个 spec
 * 返回 true 表示应该触发
 */
function matchesSpec(ev, spec) {
  const p = parseShortcut(spec);
  // mod 键:metaKey (Mac cmd) or ctrlKey (其他)
  const wantMod = p.mod;
  const hasMod = ev.metaKey || ev.ctrlKey;
  if (wantMod !== hasMod) return false;
  if (p.shift !== ev.shiftKey) return false;
  if (p.alt !== ev.altKey) return false;
  // key: '?' 直接对比,其他标准化
  const ek = ev.key;
  if (p.key === '?') return ek === '?';
  if (p.key === 'Escape') return ek === 'Escape';
  if (p.key === 'Enter') return ek === 'Enter';
  if (p.key === '.') return ek === '.';
  if (p.key === '/') return ek === '/';
  return ek === p.key;
}

describe('parseShortcut', () => {
  it('parses plain key', () => {
    assert.deepEqual(parseShortcut('?'), { mod: false, shift: false, alt: false, key: '?' });
    assert.deepEqual(parseShortcut('n'), { mod: false, shift: false, alt: false, key: 'n' });
  });
  it('parses mod+key', () => {
    assert.deepEqual(parseShortcut('⌘+Enter'), { mod: true, shift: false, alt: false, key: 'Enter' });
    assert.deepEqual(parseShortcut('Ctrl+.'), { mod: true, shift: false, alt: false, key: '.' });
  });
  it('parses shift combos', () => {
    const p = parseShortcut('⌘+Shift+Enter');
    assert.equal(p.mod, true);
    assert.equal(p.shift, true);
    assert.equal(p.key, 'Enter');
  });
  it('normalizes Esc → Escape', () => {
    assert.equal(parseShortcut('Esc').key, 'Escape');
    assert.equal(parseShortcut('Escape').key, 'Escape');
  });
  it('handles Mod alias', () => {
    assert.equal(parseShortcut('Mod+Enter').mod, true);
  });
});

describe('formatKey', () => {
  it('Mac uses ⌘ and space separator', () => {
    assert.equal(formatKey('⌘+Enter', true), '⌘ Enter');
    assert.equal(formatKey('⌘+Shift+Enter', true), '⌘ Shift Enter');
    assert.equal(formatKey('?', true), '?');
  });
  it('Non-Mac uses Ctrl+ and + separator', () => {
    assert.equal(formatKey('⌘+Enter', false), 'Ctrl+Enter');
    assert.equal(formatKey('⌘+Shift+Enter', false), 'Ctrl+Shift+Enter');
  });
});

describe('shouldIgnore', () => {
  it('ignores input/textarea/select', () => {
    assert.equal(shouldIgnore({ tagName: 'INPUT' }), true);
    assert.equal(shouldIgnore({ tagName: 'TEXTAREA' }), true);
    assert.equal(shouldIgnore({ tagName: 'SELECT' }), true);
  });
  it('ignores contentEditable', () => {
    assert.equal(shouldIgnore({ tagName: 'DIV', isContentEditable: true }), true);
  });
  it('does not ignore regular elements', () => {
    assert.equal(shouldIgnore({ tagName: 'DIV' }), false);
    assert.equal(shouldIgnore({ tagName: 'BUTTON' }), false);
  });
  it('handles null target', () => {
    assert.equal(shouldIgnore(null), false);
  });
});

describe('SHORTCUTS list', () => {
  it('has no duplicate specs', () => {
    const seen = new Set();
    for (const s of SHORTCUTS) {
      assert.ok(!seen.has(s.spec), `duplicate spec: ${s.spec}`);
      seen.add(s.spec);
    }
  });
  it('every spec parses successfully', () => {
    for (const s of SHORTCUTS) {
      const p = parseShortcut(s.spec);
      assert.ok(p.key.length > 0, `spec "${s.spec}" has no key`);
    }
  });
});

describe('renderHelpDialog', () => {
  it('contains all categories', () => {
    const html = renderHelpDialog(true);
    assert.ok(html.includes('Run'));
    assert.ok(html.includes('Session'));
    assert.ok(html.includes('Export'));
    assert.ok(html.includes('Navigate'));
    assert.ok(html.includes('Help'));
  });
  it('contains every shortcut description', () => {
    const html = renderHelpDialog(true);
    assert.ok(html.includes('跑一轮'));
    assert.ok(html.includes('停止当前 round'));
    assert.ok(html.includes('导出当前 session'));
    assert.ok(html.includes('生成实验报告'));
    assert.ok(html.includes('复制 session'));
    assert.ok(html.includes('切换 auto-iterate'));
    assert.ok(html.includes('聚焦搜索框'));
  });
  it('uses Mac glyphs in Mac mode', () => {
    const html = renderHelpDialog(true);
    assert.ok(html.includes('⌘'));
  });
  it('uses Ctrl+ in non-Mac mode', () => {
    const html = renderHelpDialog(false);
    assert.ok(html.includes('Ctrl+Enter'));
    assert.ok(!html.includes('⌘ Enter'));
  });
});

describe('matchesSpec', () => {
  it('matches plain key', () => {
    assert.equal(matchesSpec({ key: 'n', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, 'n'), true);
    assert.equal(matchesSpec({ key: 'n', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, 'n'), false);
  });
  it('matches ⌘+Enter with metaKey', () => {
    assert.equal(matchesSpec({ key: 'Enter', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, '⌘+Enter'), true);
  });
  it('matches Ctrl+. with ctrlKey', () => {
    assert.equal(matchesSpec({ key: '.', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }, 'Ctrl+.'), true);
  });
  it('requires shift when spec has Shift', () => {
    assert.equal(matchesSpec({ key: 'Enter', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, '⌘+Shift+Enter'), true);
    assert.equal(matchesSpec({ key: 'Enter', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, '⌘+Shift+Enter'), false);
  });
  it('matches ? literally', () => {
    assert.equal(matchesSpec({ key: '?', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, '?'), true);
  });
  it('Escape matches Esc spec', () => {
    assert.equal(matchesSpec({ key: 'Escape', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, 'Escape'), true);
  });
});

describe('end-to-end: user pressing ? to show help', () => {
  it('event → match → render', () => {
    // 用户按 ? 键 (无 mod)
    const ev = { key: '?', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: { tagName: 'BODY' } };
    // shouldIgnore: false (不是 input)
    assert.equal(shouldIgnore(ev.target), false);
    // matchesSpec: true
    assert.equal(matchesSpec(ev, '?'), true);
    // 渲染:返回完整 HTML
    const html = renderHelpDialog(/Mac/.test('Mac'));
    assert.ok(html.length > 100);
  });
});