// Build public/arxiv-index.json — maps arxivId → repo-relative docs path.
// 跑法:  node astro-src/scripts/build-arxiv-index.mjs
//     或: bun astro-src/scripts/build-arxiv-index.mjs
//
// 设计要点:
//   - 扫描 docs/**.md,以文件名 "<arxivId>-<slug>.md" 提 ID
//   - 同一 canonical id(去掉 vN)多个版本只保留【最高版本】的 path;
//     并为 canonical id 及每个见过的版本 id 都建立别名,统一指向最高版本笔记,
//     这样前端无论用 v1/v2 还是无版本 id 查询都能命中当前笔记
//     (旧版本被 maintain-version-refresh 刷新后,别名仍解析到新笔记)。
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

// 从带版本 id 拆出 canonical id 与版本号(无版本按 v0 处理,让任意带版本 id 胜出)。
function splitVersion(id) {
  const m = id.match(/^(\d{4}\.\d{4,5})(?:v(\d+))?$/);
  if (!m) return { canonical: id, version: 0 };
  return { canonical: m[1], version: m[2] ? Number(m[2]) : 0 };
}

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
  // canonical id -> { version, rel, seenIds:Set } —— 每个 canonical 只保留最高版本笔记
  const best = Object.create(null);
  let matched = 0;
  for (const f of files) {
    const base = f.split(/[\\/]/).pop();
    const m = base.match(ID_RE);
    if (!m) continue;
    const id = m[1];
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    const { canonical, version } = splitVersion(id);
    matched++;
    const prev = best[canonical];
    if (!prev) {
      best[canonical] = { version, rel, seenIds: new Set([id]) };
      continue;
    }
    prev.seenIds.add(id);
    // 版本更高胜出;版本相同则取更短 path(稳定兜底)
    if (version > prev.version || (version === prev.version && rel.length < prev.rel.length)) {
      prev.version = version;
      prev.rel = rel;
    }
  }

  // 展开为扁平别名表:canonical id + 见过的每个版本 id 都指向最高版本 path。
  const idx = Object.create(null);
  for (const [canonical, info] of Object.entries(best)) {
    idx[canonical] = info.rel;
    for (const seen of info.seenIds) idx[seen] = info.rel;
  }

  // 排序让 git diff 稳定
  const sorted = Object.fromEntries(Object.entries(idx).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OUT, JSON.stringify(sorted) + '\n', 'utf-8');

  const ids = Object.keys(sorted);
  // eslint-disable-next-line no-console
  console.log(`[arxiv-index] scanned ${files.length} md files, matched ${matched}, indexed ${ids.length} arxiv ids (含版本别名) -> public/arxiv-index.json`);
  if (ids.length && ids.length < 5) {
    // eslint-disable-next-line no-console
    console.log(`  sample: ${ids.slice(0, 5).join(', ')}`);
  }
}

main();
