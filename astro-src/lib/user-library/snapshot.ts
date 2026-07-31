// astro-src/lib/user-library/snapshot.ts
//
// 把散在两个 localStorage key 里的用户态收敛成一个**只读快照**,交给纯函数
// 筛选层(Stage 10 的 applyLibraryFilters)。
//
// 为什么需要这一层:lib/paper-filter.ts 是纯模块 —— 它不能 import localStorage,
// 否则就没法单测、也会被打进 SSR chunk。所以状态以显式参数注入。
//
// 数据来源有意保持两处:
//   - dpr_user_library_v1(本模块管)→ starred / status / notes / trash
//   - dpr_user_tags_v1 + dpr_hidden_papers_v1(scripts/settings.ts 管)→ userTags / hidden
// user-library **不接管** userTags 和 hiddenPapers:它们现状可用且各自带 Gist
// 同步,迁移是纯风险零收益。快照只读它们。

import { canonicalArxivId } from '../arxiv';
import { loadUserTags, loadHiddenPapers } from '../storage';
import { loadUserLibrary } from './store';
import type { ReadingStatus, UserLibrarySnapshot } from './types';

/**
 * 构建当前用户态快照。**每次筛选调用一次**,不做缓存 —— 610 篇的 Object.keys
 * 遍历是微秒级,缓存反而会引入"事件漏发导致快照过期"的一类 bug。
 */
export function buildUserLibrarySnapshot(): UserLibrarySnapshot {
  const { papers } = loadUserLibrary();

  const starred = new Set<string>();
  const status = new Map<string, ReadingStatus>();
  const notes = new Map<string, string>();

  for (const id of Object.keys(papers)) {
    const s = papers[id];
    if (s.starred) starred.add(id);
    if (s.readingStatus && s.readingStatus !== 'unread') status.set(id, s.readingStatus);
    if (typeof s.note === 'string' && s.note.length > 0) notes.set(id, s.note);
  }

  // hidden / userTags 的 key 在历史上是**带版本号**写进去的(paper-hide.ts 直接
  // 用 dataset.arxivId)。这里统一归一化到 canonical,让筛选层只认一种键。
  const hidden = new Set<string>();
  for (const raw of safeHidden()) {
    const id = canonicalArxivId(raw);
    if (id) hidden.add(id);
  }

  const userTags = new Map<string, ReadonlyArray<{ kind: string; label: string }>>();
  const rawTags = safeUserTags();
  for (const raw of Object.keys(rawTags)) {
    const id = canonicalArxivId(raw);
    if (!id) continue;
    const list = (rawTags[raw] || []).map((t) => ({ kind: t.kind, label: t.label }));
    if (list.length === 0) continue;
    // 同一 canonical id 可能有 v1/v2 两份标签 → 合并去重
    const prev = userTags.get(id);
    if (prev) {
      const seen = new Set(prev.map((t) => `${t.kind}:${t.label}`));
      const merged = prev.concat(list.filter((t) => !seen.has(`${t.kind}:${t.label}`)));
      userTags.set(id, merged);
    } else {
      userTags.set(id, list);
    }
  }

  return { hidden, starred, status, notes, userTags };
}

/** hiddenPapers / userTags 读失败(SSR、隐私模式)一律降级成空,不抛错。 */
function safeHidden(): string[] {
  try {
    return loadHiddenPapers() || [];
  } catch {
    return [];
  }
}

function safeUserTags(): Record<string, Array<{ kind: string; label: string }>> {
  try {
    return (loadUserTags() || {}) as Record<string, Array<{ kind: string; label: string }>>;
  } catch {
    return {};
  }
}

/** 空快照 —— SSR 渲染 / 单测里当默认值用,避免每个调用方各写一遍 new Set()。 */
export function emptyUserLibrarySnapshot(): UserLibrarySnapshot {
  return {
    hidden: new Set<string>(),
    starred: new Set<string>(),
    status: new Map<string, ReadingStatus>(),
    notes: new Map<string, string>(),
    userTags: new Map<string, ReadonlyArray<{ kind: string; label: string }>>(),
  };
}
