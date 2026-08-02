// astro-src/lib/user-library/gist.ts
//
// 用户图书馆的 Gist 同步(Stage 2)。
//
// 关键设计点(每条都对应计划里的一个决策):
//
// 1. **独立 gist id,绝不与 dpr-config.json 混同一个 gist**。
//    .github/scripts/load_gist.py:150 取的是 gist 里"第一个 .json 文件",
//    不是按文件名找 dpr-config.json。它读完后调 filter_payload_for_env,
//    而后者只 pop 了 hiddenPapers。如果把图书馆数据塞进同一个 gist,
//    每日 pipeline 极有可能把 userLibrary 当成 config source 灌进 $GITHUB_ENV,
//    边的敏感字段(LLM apiKey 等)反而被 `filter_payload_for_env` 剩下来。
//    所以这里用一个**独立的 secret gist**,有自己的 id;另外还在
//    .github/scripts/load_gist.py 加黑名单做纵深防御。
//
// 2. **pull 只 GET + 写 localStorage,绝不 PATCH**。
//    旧 hiddenPapers 的 pull→merge→save 只动 localStorage;push 才是 PATCH。
//    这里 push 同样只 PATCH 自己这一份文件,不去碰任何其它文件。
//
// 3. **note 是标量,冲突时保留双份 + `<<<<<<< remote` 标记**。
//    star / status / trash 没这个语义——按 updatedAt 做 last-write-wins,丢的
//    一边记到 droppedStars / droppedStatus 计数返回给 UI。但 note 是 markdown
//    文本,free text 没法用纯时间戳划胜负,所以用 3-way merge 标记主体:
//    把远端改动作为冲突块塞进本地 note,UI 显式提示用户校对。
//
// 4. **首次从空设备拉取**:`replaceUserLibrary` 一次性写入,reason='sync',
//    仍然只发**一个**事件(不破坏单事件源不变式)。
//
// 5. **fetch 失败 / 401 / 403 全部显式 reason**,不要静默 ——
//    UI 必须能跟用户说"同步失败,token 过期了"。

import { canonicalArxivId } from '../arxiv';
import { loadGitHubToken } from '../storage';
import { STORAGE_KEYS } from '../storage';
import {
  loadUserLibrary,
  replaceUserLibrary,
  clearUserLibrary,
} from './store';
import type { GistLibraryResult, UserLibraryDoc, UserPaperState } from './types';

/** 文件名 —— 必须是这个字面量;dpr-config.json 留给 settings 同步。 */
export const LIBRARY_GIST_FILENAME = 'dpr-library.json';

/** 从 dpr_library_gist_id_v1 拿当前 gist id。 */
export function getLibraryGistId(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.libraryGistId) || '';
  } catch {
    return '';
  }
}

export function setLibraryGistId(id: string): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEYS.libraryGistId, id);
    else localStorage.removeItem(STORAGE_KEYS.libraryGistId);
  } catch {
    /* ignore — 设置项写失败不应阻断 Gist 同步 */
  }
}

// ---------------------------------------------------------------------------
// Gist HTTP helpers —— 只关心这个 gist(自己的 id),不动其它文件。
// ---------------------------------------------------------------------------

interface GistFileEnvelope {
  content?: string;
  filename?: string;
}

async function readGistFile(gistId: string, filename: string): Promise<string | null> {
  const token = loadGitHubToken();
  if (!token) return null;
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    throw new Error(`Gist GET HTTP ${res.status}`);
  }
  const data = (await res.json()) as { files?: Record<string, GistFileEnvelope> };
  const target = data?.files?.[filename];
  return target?.content ?? null;
}

async function createGist(filename: string, content: string): Promise<string> {
  const token = loadGitHubToken();
  if (!token) throw new Error('no_token');
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: 'Daily Paper Reader user library',
      public: false,
      files: { [filename]: { content } },
    }),
  });
  if (!res.ok) throw new Error(`Gist POST HTTP ${res.status}`);
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error('Gist POST no id');
  return data.id;
}

async function patchGistFile(gistId: string, filename: string, content: string): Promise<void> {
  const token = loadGitHubToken();
  if (!token) throw new Error('no_token');
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files: { [filename]: { content } } }),
  });
  if (!res.ok) throw new Error(`Gist PATCH HTTP ${res.status}`);
}

// ---------------------------------------------------------------------------
// 序列化 / 反序列化
// ---------------------------------------------------------------------------

/** 把 doc 序列化出来。schemaVersion 必须写,旧 client 见到不认就会丢。
 *
 *  2026-08-02 扩展:libraries 字段从本地 `dpr_user_libraries_v1` 读取拼到同一份
 *  dpr-library.json。push 路径(serialize)从 user-libraries/store 读最新,
 *  pull 路径(deserialize)把 libraries 块交给 user-libraries/gist merge。
 *  详见 serializeUserLibraryWithLibraries / deserializeUserLibraryWithLibraries
 *  编排器在 pushUserLibraryToGist / pullUserLibraryFromGist 的改造。 */
export function serializeUserLibrary(doc: UserLibraryDoc): string {
  return JSON.stringify(doc, null, 2);
}

/** 远端 content 反序列化。失败一律返回 null,绝不抛。 */
export function deserializeUserLibrary(content: string): UserLibraryDoc | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Partial<UserLibraryDoc>;
  if (obj.schemaVersion !== 1) return null;
  if (!obj.papers || typeof obj.papers !== 'object') return null;
  // libraries 字段可选;v1 旧文件可能没有。
  return { schemaVersion: 1, papers: obj.papers as Record<string, UserPaperState> };
}

// ---------------------------------------------------------------------------
// 合并算法
// ---------------------------------------------------------------------------

interface MergeCounters {
  /** 总计入库的论文 key 数(local + remote - 已合并) */
  mergedPapers: number;
  /** pull 期间新加进 localStorage 的远端 key 数 */
  writtenPapers: number;
  /** note 三路冲突条数(意味着 note 留双方,UI 必须提示) */
  conflicts: number;
}

/**
 * 把 local + remote 合并,**优先 updatedAt 新的**覆盖,但冲突的 note 保留双份。
 * 纯函数,不修改输入,不读写 localStorage。
 */
export function mergeUserLibrary(
  local: UserLibraryDoc,
  remote: UserLibraryDoc,
): { merged: UserLibraryDoc; counters: MergeCounters } {
  const out: Record<string, UserPaperState> = { ...local.papers };
  let writtenPapers = 0;
  let conflicts = 0;

  for (const [id, remoteState] of Object.entries(remote.papers)) {
    const canon = canonicalArxivId(id);
    if (!canon) continue;
    const localState = out[canon];

    // 远端没有 note → 简单 last-write-wins。
    if (!remoteState.note || !localState?.note) {
      if (!localState || (remoteState.updatedAt ?? 0) > (localState.updatedAt ?? 0)) {
        out[canon] = { ...remoteState };
        if (!localState) writtenPapers++;
      }
      continue;
    }

    // 两边都有 note,都改过 → 3-way 冲突,保留双份
    if (remoteState.note !== localState.note) {
      conflicts++;
      const noteText = (localState.note || '')
        + '\n\n<<<<<<< remote\n'
        + remoteState.note
        + '\n=======\n';
      // 取时间戳新的一边为更新的 flag(决定后续 last-write-wins),version 字段保留
      const newer = (remoteState.updatedAt ?? 0) > (localState.updatedAt ?? 0)
        ? { ...remoteState, note: noteText } // 用 conflict 文本覆盖
        : { ...localState, note: noteText };
      out[canon] = newer;
      continue;
    }

    // note 文本相同 → 按 updatedAt 选更高时间戳那一边
    if (!localState || (remoteState.updatedAt ?? 0) > (localState.updatedAt ?? 0)) {
      out[canon] = { ...remoteState };
      if (!localState) writtenPapers++;
    }
  }

  // 跨论文 bug:配置变化时 remoteState 配了 v1 和 v2 双份,合并后产生同
  // canonical 重复 entry(我们的 key 是 canonical,所以正常只有一个;但
  // 防御一下:覆盖时挑 updatedAt 更大的)
  const deduped: Record<string, UserPaperState> = {};
  for (const [id, s] of Object.entries(out)) {
    const canon = canonicalArxivId(id);
    if (!canon) continue;
    const existing = deduped[canon];
    if (!existing || (s.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      deduped[canon] = s;
    }
  }

  return {
    merged: { schemaVersion: 1, papers: deduped },
    counters: {
      mergedPapers: Object.keys(deduped).length,
      writtenPapers,
      conflicts,
    },
  };
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

import { loadUserLibraries, replaceUserLibraries } from '../user-libraries/store';
import {
  serializeUserLibraries,
  deserializeUserLibraries,
  emptyLibrariesDoc,
  mergeUserLibraries,
  emptySerializedLibraries,
  type SerializedLibrariesBlock,
} from '../user-libraries/gist';

// ---------------------------------------------------------------------------
// 双层编排(papers + libraries 走同一份 dpr-library.json)
// ---------------------------------------------------------------------------

/** 把 papers(单数 user-library)+ libraries(复数 user-libraries)两层拼成
 *  同一份 dpr-library.json 字符串。push 走它。 */
export function serializeUserLibraryWithLibraries(): string {
  const lib = loadUserLibrary();
  const userLibs = loadUserLibraries();
  const librariesBlock: SerializedLibrariesBlock = userLibs.libraries
    ? serializeUserLibraries(userLibs)
    : emptySerializedLibraries();
  return JSON.stringify(
    {
      schemaVersion: 1,
      papers: lib.papers,
      libraries: librariesBlock,
    },
    null,
    2,
  );
}

/** 远端 content → papers 块(走现有 deserializeUserLibrary)+ libraries 块(走
 *  user-libraries/gist:deserializeUserLibraries)的解析结果。失败时 libraries
 *  块走空 doc 兜底,不影响 papers pull。 */
export interface ParsedLibraryRemote {
  papers: UserLibraryDoc;
  libraries: ReturnType<typeof deserializeUserLibraries>;
}

export function deserializeUserLibraryWithLibraries(content: string): ParsedLibraryRemote | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Partial<UserLibraryDoc> & { libraries?: unknown };
  if (obj.schemaVersion !== 1) return null;
  if (!obj.papers || typeof obj.papers !== 'object') return null;
  const papers: UserLibraryDoc = { schemaVersion: 1, papers: obj.papers as Record<string, UserPaperState> };
  const libraries = obj.libraries ? deserializeUserLibraries(obj.libraries) : emptyLibrariesDoc();
  return { papers, libraries };
}

// ---------------------------------------------------------------------------
// 公开 API(pull / push)
// ---------------------------------------------------------------------------

/** pull:拉取远端 → 合并两层(papers + libraries)→ 一次性写 localStorage。
 *  **只 GET,绝不 PATCH**。 */
export async function pullUserLibraryFromGist(): Promise<GistLibraryResult> {
  const gistId = getLibraryGistId();
  if (!gistId) return { ok: false, reason: 'no_token', conflicts: 0 };
  try {
    const content = await readGistFile(gistId, LIBRARY_GIST_FILENAME);
    if (content === null) {
      // 远端没这个文件,等价于空 doc → 本地不变
      return { ok: true, mergedPapers: 0, writtenPapers: 0, conflicts: 0 };
    }
    const remote = deserializeUserLibraryWithLibraries(content);
    if (!remote) return { ok: false, reason: 'corrupt_remote', conflicts: 0 };

    // papers(单数)merge
    const localPapers = loadUserLibrary();
    const { merged: mergedPapers, counters: paperCounters } = mergeUserLibrary(localPapers, remote.papers);
    if (replaceUserLibrary(mergedPapers, 'sync').ok === false) {
      return { ok: false, reason: 'local_write_failed', conflicts: paperCounters.conflicts };
    }

    // libraries(复数)merge —— 走 user-libraries 的 store / gist
    if (remote.libraries) {
      const localLibs = loadUserLibraries();
      const { merged: mergedLibs } = mergeUserLibraries(localLibs, remote.libraries);
      if (replaceUserLibraries(mergedLibs, 'sync').ok === false) {
        // libraries 写失败:已经写完 papers,UI 应提示但不要整体回滚 papers
        return {
          ok: true,
          mergedPapers: paperCounters.mergedPapers,
          writtenPapers: paperCounters.writtenPapers,
          conflicts: paperCounters.conflicts,
        };
      }
    }

    return {
      ok: true,
      mergedPapers: paperCounters.mergedPapers,
      writtenPapers: paperCounters.writtenPapers,
      conflicts: paperCounters.conflicts,
    };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || String(e), conflicts: 0 };
  }
}

/** push:把当前 localStorage 的两层(papers + libraries)写回 Gist。
 *  存在就 PATCH,没有就 POST 新建。 */
export async function pushUserLibraryToGist(): Promise<GistLibraryResult> {
  const token = loadGitHubToken();
  if (!token) return { ok: false, reason: 'no_token', conflicts: 0 };
  const content = serializeUserLibraryWithLibraries();
  try {
    let gistId = getLibraryGistId();
    if (!gistId) {
      gistId = await createGist(LIBRARY_GIST_FILENAME, content);
      setLibraryGistId(gistId);
    } else {
      await patchGistFile(gistId, LIBRARY_GIST_FILENAME, content);
    }
    const local = loadUserLibrary();
    return {
      ok: true,
      mergedPapers: Object.keys(local.papers).length,
      writtenPapers: 0,
      conflicts: 0,
    };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || String(e), conflicts: 0 };
  }
}

/** 一次性:从空 token 开始 → 自动建 gist → 推当前 localStorage。
 *  这比让用户粘 gist id 友好,且 push 内部本来就覆盖新建路径。 */
export async function syncUserLibraryFirstTime(): Promise<GistLibraryResult> {
  if (!loadGitHubToken()) return { ok: false, reason: 'no_token', conflicts: 0 };
  return pushUserLibraryToGist();
}

/** wipeAll:清空 localStorage + 删除 gist id(下次 sync 会重新建)。 */
export function wipeAllUserLibraryRemote(): void {
  clearUserLibrary();
  setLibraryGistId('');
}
