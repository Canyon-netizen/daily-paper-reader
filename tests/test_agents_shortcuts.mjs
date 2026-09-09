/**
 * tests/test_agents_shortcuts.mjs — 键盘快捷键纯逻辑守护。
 *
 * /agents/ 页面 iter #11 加了:
 *   Cmd/Ctrl+Enter → 跑一轮
 *   Cmd/Ctrl+.     → 停止
 *   ?              → 帮助
 *
 * keydown 处理里有几个微妙的逻辑:
 *   1. 在 input/textarea/contenteditable 里按 → 不要拦截
 *   2. metaKey (Mac) 和 ctrlKey (Win/Linux) 都算 mod
 *   3. ? 不带 mod 才触发(避免跟 Ctrl+? 冲突)
 *
 * 这里把这些判断抽成纯函数测。
 *
 * 跑法:node tests/test_agents_shortcuts.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 镜像 /agents/ index.astro 里的 keydown 处理逻辑
function shouldHandleKey(target, e) {
  // 在表单输入框里按 → 不拦截
  const tag = target?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return false;
  const mod = e.metaKey || e.ctrlKey;

  // Cmd/Ctrl+Enter → run
  if (mod && e.key === 'Enter') return { action: 'run' };
  // Cmd/Ctrl+. → abort
  if (mod && e.key === '.') return { action: 'abort' };
  // ? (no mod) → help
  if (e.key === '?' && !mod) return { action: 'help' };
  return false;
}

function fakeTarget(tag, isContentEditable = false) {
  return tag ? { tagName: tag.toUpperCase(), isContentEditable } : null;
}

function fakeEvent(key, mods = {}) {
  return { key, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: false, shiftKey: false };
}

describe('keyboard shortcut handlers', () => {
  describe('input/textarea/contenteditable guard', () => {
    it('does not trigger when target is <input>', () => {
      assert.equal(shouldHandleKey(fakeTarget('input'), fakeEvent('Enter', { meta: true })), false);
    });
    it('does not trigger when target is <textarea>', () => {
      assert.equal(shouldHandleKey(fakeTarget('textarea'), fakeEvent('.', { ctrl: true })), false);
    });
    it('does not trigger when target is contenteditable', () => {
      assert.equal(shouldHandleKey(fakeTarget('div', true), fakeEvent('?')), false);
    });
    it('does trigger when target is <body>', () => {
      assert.deepEqual(shouldHandleKey(fakeTarget('body'), fakeEvent('Enter', { meta: true })), { action: 'run' });
    });
  });

  describe('modifier key detection', () => {
    it('Cmd+Enter (mac) → run', () => {
      assert.deepEqual(shouldHandleKey(fakeTarget('body'), fakeEvent('Enter', { meta: true })), { action: 'run' });
    });
    it('Ctrl+Enter (linux/win) → run', () => {
      assert.deepEqual(shouldHandleKey(fakeTarget('body'), fakeEvent('Enter', { ctrl: true })), { action: 'run' });
    });
    it('Cmd+. (mac) → abort', () => {
      assert.deepEqual(shouldHandleKey(fakeTarget('body'), fakeEvent('.', { meta: true })), { action: 'abort' });
    });
    it('Ctrl+. (linux/win) → abort', () => {
      assert.deepEqual(shouldHandleKey(fakeTarget('body'), fakeEvent('.', { ctrl: true })), { action: 'abort' });
    });
    it('plain Enter (no mod) → does not match run', () => {
      assert.equal(shouldHandleKey(fakeTarget('body'), fakeEvent('Enter')), false);
    });
    it('plain . (no mod) → does not match abort', () => {
      assert.equal(shouldHandleKey(fakeTarget('body'), fakeEvent('.')), false);
    });
  });

  describe('? key', () => {
    it('? alone → help', () => {
      assert.deepEqual(shouldHandleKey(fakeTarget('body'), fakeEvent('?')), { action: 'help' });
    });
    it('Ctrl+? → does NOT match (avoid conflict with browser shortcuts)', () => {
      assert.equal(shouldHandleKey(fakeTarget('body'), fakeEvent('?', { ctrl: true })), false);
    });
    it('Cmd+? → does NOT match', () => {
      assert.equal(shouldHandleKey(fakeTarget('body'), fakeEvent('?', { meta: true })), false);
    });
  });

  it('unrelated keys (a, b, 1, Escape) → false', () => {
    for (const k of ['a', 'b', '1', 'Escape', 'Tab', 'ArrowUp']) {
      assert.equal(shouldHandleKey(fakeTarget('body'), fakeEvent(k)), false, `${k} should not match`);
    }
  });
});
