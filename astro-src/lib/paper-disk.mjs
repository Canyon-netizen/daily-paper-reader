// paper-disk.mjs — Paper MD 文件系统访问层。
// 拆到这里是为了让 paper.ts 的静态 dependency graph 不含 node:fs / node:path,
// 这样 Vite 客户端 bundle 不会 externalize 报错。
// 注意:这是一个 .mjs 模块(非 .ts),仅在 server-side / bun 独立脚本里用,
// 永远不会被 Vite 客户端 chunk 拉进去。

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export async function readTextFile(absPath) {
  return readFile(absPath, 'utf-8');
}

export async function readDirEntries(dir) {
  return readdir(dir, { withFileTypes: true });
}

export function joinPath(...parts) {
  return join(...parts);
}

export function relativeTo(base, abs) {
  // 把 Windows 反斜杠统一成 forward slash(原本就在 .replace 范围)
  return relative(base, abs).replace(/\\/g, '/');
}

// 复用一份 docs 根路径常量,避免 paper.ts 顶层 process.cwd() + join()。
export const DOCS_DIR = join(process.cwd(), 'docs');