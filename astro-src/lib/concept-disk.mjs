// concept-disk.mjs — 概念层文件系统访问层。
//
// 拆到这里是为了让 concepts-index.ts 的静态 dependency graph 不含 node:fs / node:path,
// 这样 Vite 客户端 bundle 不会 externalize 报错。
//
// 注意:这是一个 .mjs 模块(非 .ts),仅在 server-side / bun 独立脚本里用,
// 永远不会被 Vite 客户端 chunk 拉进去。
//
// 真值来源:docs/papers/<YYYY>/<MM>/<arxivid>-*.md 的 frontmatter `concepts:` 段。
// 这里**不读** gitignored 的 wiki/concepts/(CI 上不存在,Stage 9 前的页面空态就是这个导致的)。

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

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
  return relative(base, abs).replace(/\\/g, '/');
}

export const DOCS_DIR = join(process.cwd(), 'docs');