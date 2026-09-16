// astro-src/lib/dashboard/activity-feed.ts
//
// R7 E.4.1: dashboard activity feed.
//
//   - ActivityEvent interface
//   - recordEvent(event): 记录事件
//   - getRecentEvents(limit): 获取最近事件
//   - getEventsByKind(kind, limit): 按类型获取
//   - summarizeByDay(events): 按天统计
//
// Storage: localStorage key `dpr_activity_feed_v1`
//   Schema: { events: ActivityEvent[] } (capped at 500, LRU eviction)

export type ActivityKind =
  | 'paper_added'
  | 'idea_created'
  | 'writing_updated'
  | 'experiment_logged'
  | 'citation_added';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  ts: number; // timestamp ms
  summary: string;
  refId?: string; // related entity id (paper arxivId, writing id, etc.)
}

export interface RecordEventOpts {
  kind: ActivityKind;
  summary: string;
  refId?: string;
}

const STORAGE_KEY = 'dpr_activity_feed_v1';
const MAX_EVENTS = 500;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getStorage(): { events: ActivityEvent[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { events: [] };
  } catch {
    return { events: [] };
  }
}

function setStorage(data: { events: ActivityEvent[] }): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * 记录一个新的活动事件.
 * 自动 LRU 淘汰: 超过 500 条时删除最旧的.
 */
export function recordEvent(opts: RecordEventOpts): ActivityEvent {
  const event: ActivityEvent = {
    id: generateId(),
    kind: opts.kind,
    ts: Date.now(),
    summary: opts.summary,
    refId: opts.refId,
  };

  const storage = getStorage();
  storage.events.unshift(event); // newest first

  // LRU eviction: keep only MAX_EVENTS
  if (storage.events.length > MAX_EVENTS) {
    storage.events = storage.events.slice(0, MAX_EVENTS);
  }

  setStorage(storage);
  return event;
}

/**
 * 获取最近的 N 条事件.
 */
export function getRecentEvents(limit = 20): ActivityEvent[] {
  const storage = getStorage();
  return storage.events.slice(0, limit);
}

/**
 * 按类型获取事件.
 */
export function getEventsByKind(kind: ActivityKind, limit = 20): ActivityEvent[] {
  const storage = getStorage();
  return storage.events.filter((e) => e.kind === kind).slice(0, limit);
}

/**
 * 按天统计事件数量.
 * 返回 { '2026-09-14': 5, '2026-09-15': 3 }
 */
export function summarizeByDay(
  events: ActivityEvent[],
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const event of events) {
    const date = new Date(event.ts).toISOString().split('T')[0];
    result[date] = (result[date] ?? 0) + 1;
  }

  return result;
}

/**
 * 获取所有事件 (供调试).
 */
export function getAllEvents(): ActivityEvent[] {
  const storage = getStorage();
  return storage.events;
}

/**
 * 清空活动 feed.
 */
export function clearActivityFeed(): void {
  setStorage({ events: [] });
}

/**
 * 删除指定 id 的事件.
 */
export function deleteEvent(eventId: string): boolean {
  const storage = getStorage();
  const idx = storage.events.findIndex((e) => e.id === eventId);
  if (idx === -1) return false;

  storage.events.splice(idx, 1);
  setStorage(storage);
  return true;
}

/**
 * Search events by query (case-insensitive).
 * Matches against the summary field.
 *
 * @param query - Search query string
 * @returns Array of matching events
 */
export function searchEvents(query: string): ActivityEvent[] {
  if (!query || query.trim() === '') {
    return getAllEvents();
  }

  const lowerQuery = query.toLowerCase().trim();
  const storage = getStorage();

  return storage.events.filter((event) =>
    event.summary.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Filter events by date range.
 *
 * @param start - Start date (inclusive), ISO string or epoch ms
 * @param end - End date (inclusive), ISO string or epoch ms
 * @returns Array of events in range
 */
export function filterByDateRange(
  start: string | number,
  end: string | number
): ActivityEvent[] {
  // Convert to epoch ms if ISO string
  const startMs = typeof start === 'string' ? new Date(start).getTime() : start;
  const endMs = typeof end === 'string' ? new Date(end).getTime() : end;

  if (isNaN(startMs) || isNaN(endMs)) {
    return [];
  }

  const storage = getStorage();

  return storage.events.filter((event) => event.ts >= startMs && event.ts <= endMs);
}
