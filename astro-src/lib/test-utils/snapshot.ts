// astro-src/lib/test-utils/snapshot.ts
//
// R7 I.2.3: snapshot testing utilities.
//
// 提供 assertSnapshot 函数用于 LLM 输出稳定性测试。snapshot 存储在
// astro-src/scripts/__snapshots__/*.json

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SnapshotOptions {
  /** 是否更新 snapshot(用于 CI update 或本地调试) */
  update?: boolean;
  /** snapshot 文件名(默认用 test name) */
  fileName?: string;
}

const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', '__snapshots__');

/** 确保 snapshot 目录存在。 */
function ensureSnapshotDir() {
  if (!existsSync(SNAPSHOT_DIR)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
}

/** 获取 snapshot 文件路径。 */
function getSnapshotPath(name: string): string {
  // sanitize name for file system
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
  return join(SNAPSHOT_DIR, `${safeName}.json`);
}

/** 序列化 value 为确定性 JSON(string keys sorted)。
 * 这是 snapshot 的核心:同输入 → 同输出。 */
export function serializeForSnapshot(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort(), 2);
}

/** 读取已有的 snapshot。 */
function readSnapshot(name: string): string | null {
  const path = getSnapshotPath(name);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

/** 写入 snapshot。 */
function writeSnapshot(name: string, value: string): void {
  ensureSnapshotDir();
  const path = getSnapshotPath(name);
  writeFileSync(path, value, 'utf-8');
}

/** 断言 value 与 snapshot 匹配。
 *
 * @param name snapshot 名称(通常用 test 名称)
 * @param value 要比对的值(任意可序列化对象)
 * @param opts.update = true 时,强制更新 snapshot
 *
 * 用法:
 *   assertSnapshot('llm-output-1', result);
 *
 * Snapshot 存储在 astro-src/scripts/__snapshots__/llm-output-1.json
 */
export function assertSnapshot(
  name: string,
  value: unknown,
  opts: SnapshotOptions = {},
): { passed: boolean; message: string } {
  const serialized = serializeForSnapshot(value);
  const existing = readSnapshot(name);

  if (opts.update) {
    writeSnapshot(name, serialized);
    return { passed: true, message: `Snapshot updated: ${name}` };
  }

  if (existing === null) {
    // 首次:自动创建
    writeSnapshot(name, serialized);
    return { passed: true, message: `Snapshot created: ${name}` };
  }

  if (serialized === existing) {
    return { passed: true, message: `Snapshot matched: ${name}` };
  }

  return {
    passed: false,
    message: `Snapshot mismatch: ${name}\nExpected:\n${existing}\n\nActual:\n${serialized}`,
  };
}

/** 获取 snapshot 列表(用于清理或对比)。 */
export function listSnapshots(): string[] {
  ensureSnapshotDir();
  const { readdirSync } = require('node:fs');
  try {
    return readdirSync(SNAPSHOT_DIR)
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => f.replace('.json', ''));
  } catch {
    return [];
  }
}

/** 删除指定 snapshot。 */
export function deleteSnapshot(name: string): void {
  const { unlinkSync } = require('node:fs');
  const path = getSnapshotPath(name);
  try {
    unlinkSync(path);
  } catch {
    // ignore if not exists
  }
}
