// topic-search 并发/工具助手 —— 从 topic-search.ts 抽出（模块化重构 step 3）。
// 纯函数，无模块状态、无 DOM。

// 生成随机短 id（用于 session / subq / facet 等）。
export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// 简单的 worker-pool 并发(限制同时在飞的 Promise 数)。
// items: 任务列表;limit: 并发上限;fn: 单个任务。
// onProgress(done) 在每个任务完成(成功或失败)后回调一次。
export async function runConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
  onDoneItem?: (item: T, idx: number, result: R | null, error: Error | null) => void,
): Promise<{ ok: Array<{ item: T; result: R }>; err: Array<{ item: T; error: Error }> }> {
  const results: Array<{ item: T; result: R } | null> = new Array(items.length).fill(null);
  const errors: Array<{ item: T; error: Error } | null> = new Array(items.length).fill(null);
  let cursor = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        const result = await fn(items[idx], idx);
        results[idx] = { item: items[idx], result };
        onDoneItem?.(items[idx], idx, result, null);
      } catch (e) {
        const err = e as Error;
        errors[idx] = { item: items[idx], error: err };
        onDoneItem?.(items[idx], idx, null, err);
      } finally {
        done++;
        onProgress?.(done, items.length);
      }
    }
  }

  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return {
    ok: results.filter((r): r is { item: T; result: R } => r !== null),
    err: errors.filter((r): r is { item: T; error: Error } => r !== null),
  };
}
