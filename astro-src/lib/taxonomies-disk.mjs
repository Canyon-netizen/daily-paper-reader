// taxonomies-disk.mjs — bun 独立跑 (无 Vite) 时的 fallback。
// 拆到这里是为了让 taxonomies.ts 的静态 dependency graph 不含 node:fs / node:path,
// 这样 Vite 客户端 bundle 不会 externalize 报错。
// 注意:这是一个 .mjs 模块(非 .ts),因为它仅在 server-side / bun 独立脚本里用,
// 永远不会被 Vite 客户端 chunk 拉进去。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readTaxonomiesFromDisk() {
  const p = join(process.cwd(), 'config', 'taxonomies.json');
  return JSON.parse(readFileSync(p, 'utf-8'));
}