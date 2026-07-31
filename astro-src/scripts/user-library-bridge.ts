// astro-src/scripts/user-library-bridge.ts
//
// 浏览器侧的 user-library 同步桥(Stage 2 UI 层)。
//
// 为什么不直接 import lib/user-library/gist.ts:
// lib 模块是给 lib 层(SSR、本地筛选)用的,不要被打进客户端大 bundle。
// 这里只 re-export 浏览器真正用到的 3 个函数 + 包装 hint / gistId 字段回填 UI。
//
// 动态 import 是为了 lib 编辑后能 hot-reload,不必 hooks 整个 settings 重载。

import {
  getLibraryGistId,
  pullUserLibraryFromGist,
  pushUserLibraryToGist,
} from '../lib/user-library/gist';

export function getGistIdSync(): string {
  return getLibraryGistId();
}

function setHint(el: HTMLElement, msg: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  el.textContent = msg;
  el.dataset.kind = kind;
}

export async function syncLibraryPush(
  hint: HTMLElement | null,
  onIdCreated?: () => void,
): Promise<void> {
  if (!hint) return;
  setHint(hint, '推送中…', 'info');
  const r = await pushUserLibraryToGist();
  if (r.ok) {
    setHint(hint, `✓ 已推送 (${r.mergedPapers} 篇)`, 'ok');
    if (onIdCreated) onIdCreated();
  } else {
    setHint(hint, `✗ ${r.reason || 'unknown'}`, 'error');
  }
}

export async function syncLibraryPull(hint: HTMLElement | null): Promise<void> {
  if (!hint) return;
  setHint(hint, '拉取中…', 'info');
  const r = await pullUserLibraryFromGist();
  if (r.ok) {
    const note = r.conflicts && r.conflicts > 0
      ? `✓ 拉取 ${r.writtenPapers} 篇新增,${r.conflicts} 条笔记冲突已保留双份待校对`
      : `✓ 拉取 ${r.writtenPapers} 篇新增`;
    setHint(hint, note, 'ok');
  } else {
    setHint(hint, `✗ ${r.reason || 'unknown'}`, 'error');
  }
}
