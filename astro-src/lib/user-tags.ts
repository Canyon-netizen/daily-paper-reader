// astro-src/lib/user-tags.ts
//
// 用户标签层 — 这是 lib/ 模块 re-export settings.ts 的 source of truth。
//
// 历史背景:这个模块曾经拥有自己的 localStorage 读写 + Gist 拉推实现。
// commit (P1-5) 把所有 body 收回 astro-src/scripts/settings.ts,只让
// 这个文件 re-export,确保:
//   - localStorage key 名在 STORAGE_KEYS 字典里集中管理
//   - 所有 selection / hiddenPapers / userTags 写入都 emit 同一个
//     'dpr-user-tags-change' 事件,settings-page.ts 监听后实时刷新
//   - Gist 拉推的 GET→merge→PATCH 逻辑只活在一处
//
// 公开 API 与旧版本完全一致;existing callers (PaperLibrary.astro,
// settings-page.ts) 不需要改 import 路径。

export type {
  UserTag,
  UserTagMap,
  GistUserTagsResult,
} from '../scripts/settings';

export {
  loadUserTags,
  getUserTags,
  setUserTags,
  addTag,
  removeTag,
  clearAllUserTags,
  pullUserTagsFromGist,
  pushUserTagsToGist,
} from './storage';

// 旧 'dpr_user_tags_v1' 常量保留 — 旧调用方可能直接 import 它。
// 实际值由 settings.ts 的 STORAGE_KEYS.userTags 拥有,这里只是 alias。
export const STORAGE_KEY = 'dpr_user_tags_v1';

// 旧 helper 保留 — flattenUserTags / mergeWithPaperTags 不需要 settings.ts
// 的 localStorage 写入权限,可以纯函数形式存在。
import type { UserTag } from '../scripts/settings';
import type { Categories } from './taxonomies';
import { flattenCategories } from './paper';

/** 把用户标签拍平为 (kind+':'+label) 字符串列表(给 paper 列表角标 / 图谱节点染色用)。 */
export function flattenUserTags(tags: UserTag[]): string[] {
  return tags.map((t) => `${t.kind}:${t.label}`);
}

/** 把论文的 frontmatter categories 与用户标签合并,去重。
 *  输出是 `dim:label` 字符串数组,与 flattenCategories 形态一致,可直接喂给:
 *   - tagSet (paper-relations.ts Jaccard 图)
 *   - cytoscape node.data.tags (paper-library.ts)
 *   - 任意 tag chip render 路径
 *
 *  categories 形式:
 *   {venue:["ICML 2025"], task:["rl"], method:[], type:[]}
 *  → flatten 为 ['venue:ICML 2025','task:rl']
 *  与 userTag {kind:'task', label:'reasoning'} 合并后:
 *  → ['venue:ICML 2025','task:rl','user:task:reasoning']
 *  user 这维不强求过白名单,由 UI 决定是否显示。 */
export function mergeWithPaperCategories(
  paperCats: Categories | undefined | null,
  userTags: UserTag[],
): string[] {
  const flat = flattenCategories(paperCats);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of flat) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  for (const ut of userTags || []) {
    const k = `user:${ut.kind}:${ut.label}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** 向后兼容别名 — 旧代码仍可使用 `mergeWithPaperTags`,本批内
 *  暂时保留为 mergeWithPaperCategories 的 wrapper;后续清理。 */
export function mergeWithPaperTags(
  frontmatterTags: string[] | undefined | null,
  userTags: UserTag[],
): string[] {
  // 把 string[] 反推为 Categories — 历史调用方传的是 ['task:rl','query:foo'] 等。
  // 由于旧 'query:<label>' 与新 'task:<label>' 同义,简单按第一个冒号切出 dim/label。
  const ACC: Categories = { venue: [], task: [], method: [], type: [] };
  if (Array.isArray(frontmatterTags)) {
    for (const t of frontmatterTags) {
      if (typeof t !== 'string') continue;
      const s = t.replace(/^query:/, '');
      const idx = s.indexOf(':');
      if (idx > 0) {
        const dim = s.slice(0, idx);
        const label = s.slice(idx + 1);
        if (dim === 'venue' || dim === 'task' || dim === 'method' || dim === 'type') {
          (ACC[dim] as string[]).push(label);
        }
      } else if (s) {
        ACC.task.push(s);
      }
    }
  }
  return mergeWithPaperCategories(ACC, userTags);
}