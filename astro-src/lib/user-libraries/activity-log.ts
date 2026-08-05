// astro-src/lib/user-libraries/activity-log.ts
//
// 每条用户文献库的**变更日志** —— 对照 Polaris `library_activity` 表
// (Polaris 后端用 `voyage_logs` + library_id 维度,持久化 voyage 状态变化)。
//
// DPR 是浏览器单页 static site,没有后端;这里用 localStorage 做 append-only
// changelog,每条 mutator 都 trail 一行,UI 在 Govern tab 显示「最近活动」和
// 时间线。
//
// 设计原则:
//   1. **append-only**:只追加,不更新 / 不删除(用户清空库才删对应 lib 的 entries)。
//      这是活动日志的语义底线 —— Polaris 也是 immutable logs。
//   2. **统一存储**:所有 lib 的活动混在同一个 JSON list 里,key
//      `dpr_library_activity_log_v1`,每条带 `libId` 字段,索引靠 libId。
//      不分库分 key 的好处:增删库不需要搬日志;坏处:列表会缓慢增长,需要定期
//      trim(默认 keep 最近 200 条 / 库,可在 settings 里暴露「清空活动日志」按钮)。
//   3. **不阻塞写入**:log 走 requestIdleCallback / setTimeout(0);失败静默不抛。
//      与 lib/user-libraries/store.ts 的「显式失败」语义不同 —— 活动日志丢一条
//      不影响用户态写入,且 toast 弹失败会扰民。
//   4. **detail 自由 schema**:每条活动带 `detail?: Record<string, unknown>`,
//      listLibraryActivity() 接受泛型 narrow —— call-site 自己读字段。
//
// 类型:
//   type LibraryActivityKind =
//     | 'create'
//     | 'rename'
//     | 'statement'
//     | 'hue'
//     | 'definition'
//     | 'visibility'
//     | 'archive'
//     | 'unarchive'
//     | 'add-paper'
//     | 'remove-paper'
//     | 'bulk-add'
//     | 'bulk-remove'
//     | 'paper-meta'
//     | 'bulk-status'
//     | 'concept-override'
//     | 'digest-generated'
//     | 'ingest-run'
//     | 'rescore';

// 通用 detail 类型 —— call-site 在 detail 里塞任意结构。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LibraryActivityDetail = Record<string, any> | undefined;

export interface LibraryActivity {
  /** epoch ms */
  at: number;
  libId: string;
  kind: string;
  /** 简短描述(中文,UI 直接显示) */
  message: string;
  detail?: LibraryActivityDetail;
}

const KEY = 'dpr_library_activity_log_v1';
/** 单库最大保留条数(防 list 无限增长)。 */
const MAX_PER_LIB = 200;
/** 全局总条目上限 —— UI 兜底,极端 case 防止 localStorage 撑爆。 */
const MAX_TOTAL = 4000;

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

function readAll(): LibraryActivity[] {
  if (!storageAvailable()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is LibraryActivity => {
      return !!x && typeof x === 'object'
        && typeof x.at === 'number'
        && typeof x.libId === 'string'
        && typeof x.kind === 'string'
        && typeof x.message === 'string';
    });
  } catch {
    return [];
  }
}

function writeAll(list: LibraryActivity[]): void {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 配额满:trim 到 MAX_TOTAL/2 再写一次;再失败就静默
    try {
      const trimmed = list.slice(Math.max(0, list.length - Math.floor(MAX_TOTAL / 2)));
      localStorage.setItem(KEY, JSON.stringify(trimmed));
    } catch {
      /* swallow — activity log 不是关键路径 */
    }
  }
}

/** 全局总条目上限:trim 掉最早的非 archive / non-create 记录。 */
function trim(list: LibraryActivity[]): LibraryActivity[] {
  if (list.length <= MAX_TOTAL) return list;
  // 按 libId 数量均匀裁掉最老的
  const byLib = new Map<string, LibraryActivity[]>();
  for (const x of list) {
    const arr = byLib.get(x.libId) || [];
    arr.push(x);
    byLib.set(x.libId, arr);
  }
  const out: LibraryActivity[] = [];
  for (const arr of byLib.values()) {
    const keep = Math.max(20, Math.floor(MAX_PER_LIB / Math.max(1, byLib.size)));
    out.push(...arr.slice(-keep));
  }
  return out;
}

/** 追加一条活动。**fire-and-forget**:失败不抛、不影响主流程。 */
export function appendLibraryActivity(
  libId: string,
  kind: string,
  message: string,
  detail?: LibraryActivityDetail,
): void {
  if (!libId || !kind) return;
  if (!storageAvailable()) return;
  const entry: LibraryActivity = { at: Date.now(), libId, kind, message };
  if (detail !== undefined) entry.detail = detail;
  const all = readAll();
  all.push(entry);
  writeAll(trim(all));
}

/** 单库活动倒序(最新在前)。limit 默认 100。 */
export function listLibraryActivity(libId: string, limit = 100): LibraryActivity[] {
  const all = readAll();
  const out: LibraryActivity[] = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const a = all[i];
    if (a && a.libId === libId) {
      out.push(a);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** 全部活动倒序(whole-doc 视图,治理/审计用)。 */
export function listAllActivity(limit = 200): LibraryActivity[] {
  const all = readAll();
  return all.slice(-Math.max(1, limit)).reverse();
}

/** 删单库所有活动(库彻底删除时调用,不留尸)。 */
export function purgeLibraryActivity(libId: string): void {
  if (!storageAvailable()) return;
  const all = readAll();
  const next = all.filter((a) => a.libId !== libId);
  if (next.length !== all.length) writeAll(next);
}

/** 清空全部活动日志(设置页"隐私"按钮)。 */
export function clearLibraryActivity(): void {
  if (!storageAvailable()) return;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** 格式化时间为"3 分钟前 / 2 小时前 / 3 天前 / 2026-08-05"。 */
export function formatActivityTime(at: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - at);
  if (delta < 60_000) return '刚刚';
  if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 24 * 60 * 60_000) return `${Math.floor(delta / (60 * 60_000))} 小时前`;
  if (delta < 7 * 24 * 60 * 60_000) return `${Math.floor(delta / (24 * 60 * 60_000))} 天前`;
  return new Date(at).toISOString().slice(0, 10);
}
