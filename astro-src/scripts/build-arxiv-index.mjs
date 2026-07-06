// Build public/arxiv-index.json — maps arxivId → repo-relative docs path.
// 跑法:  node astro-src/scripts/build-arxiv-index.mjs
//     或: bun astro-src/scripts/build-arxiv-index.mjs
//
// 设计要点:
//   - 扫描 docs/**.md,以文件名 "<arxivId>-<slug>.md" 提 ID
//   - 同 ID 多个版本(v1/v2)只留 path 最短的
//   - 失败兜底:docs 不存在时仍写 {}(不阻塞 dev)
//   - 输出扁平 hash map,前端 O(1) 命中,
//     每条 ~50B × 上千条 ≈ 上百 KB,可接受
//
// 这文件:被 package.json 的 predev/prebuild 钩子触发,
// 不被 Astro 自身 require,所以用 .mjs 够用,不进 TS 编译路径。

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const DOCS_DIR = join(ROOT, 'docs');
const OUT = join(ROOT, 'public', 'arxiv-index.json');

// 文件名: <arxivId>-<slug>.md
// arXiv ID: YYMM.NNNNN(可选 vN 尾巴),版本号 'v' 前必须有数字 + '.'
// 例: 2606.26474v1, 1706.03762, 2401.01234v3
const ID_RE = /^(\d{4}\.\d{4,5}(?:v\d+)?)(?:[.-]|$)/;

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(p));
    else if (name.isFile() && p.endsWith('.md')) out.push(p);
  }
  return out;
}

function main() {
  const files = walk(DOCS_DIR);
  // id -> shortest path
  const idx = Object.create(null);
  let matched = 0;
  for (const f of files) {
    const base = f.split(/[\\/]/).pop();
    const m = base.match(ID_RE);
    if (!m) continue;
    const id = m[1];
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    const prev = idx[id];
    if (!prev || rel.length < prev.length) idx[id] = rel;
    matched++;
  }

  // 排序让 git diff 稳定
  const sorted = Object.fromEntries(Object.entries(idx).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OUT, JSON.stringify(sorted) + '\n', 'utf-8');

  const ids = Object.keys(sorted);
  // eslint-disable-next-line no-console
  console.log(`[arxiv-index] scanned ${files.length} md files, indexed ${ids.length} arxiv ids -> public/arxiv-index.json`);
  if (ids.length && ids.length < 5) {
    // eslint-disable-next-line no-console
    console.log(`  sample: ${ids.slice(0, 5).join(', ')}`);
  }
}

main();
