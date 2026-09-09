#!/usr/bin/env node
/**
 * astro-src/scripts/check-import-depth.mjs
 *
 * 检查 astro-src/pages/ 下每个 .astro 文件的相对 import 深度是否正确。
 *
 * 深度规则:
 *   pages/<name>.astro                  → depth=1,期望 '../'
 *   pages/<dir>/<name>.astro            → depth=2,期望 '../../'
 *   pages/<dir>/<subdir>/<name>.astro   → depth=3,期望 '../../../'
 *
 * 不匹配则报错并 exit 1。运行方式:
 *   node astro-src/scripts/check-import-depth.mjs
 *
 * 仅作 pre-commit / pre-deploy 检查,不入主流程。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const PAGES = join(ROOT, 'astro-src', 'pages');

const TARGETS = new Set(['layouts', 'components', 'styles']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (entry.endsWith('.astro')) out.push(p);
  }
  return out;
}

const importRe = /^\s*import\s+(?:[^'"\n]+from\s+)?['"]([^'"]+)['"]/gm;

let errors = 0;
const files = walk(PAGES);
for (const file of files) {
  const rel = relative(PAGES, file).split(sep);
  // depth 1: [name].astro
  // depth 2: [dir, name].astro
  // depth 3: [dir, subdir, name].astro
  const depth = rel.length;
  const expectedPrefix = '../'.repeat(depth);
  const src = readFileSync(file, 'utf8');
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const imp = m[1];
    // only relative imports
    if (!imp.startsWith('.')) continue;
    // split path segments
    const segs = imp.split('/');
    // skip leading . and ..
    let ups = 0;
    for (const seg of segs) {
      if (seg === '..') ups++;
      else break;
    }
    const tail = segs.slice(ups);
    if (!TARGETS.has(tail[0])) continue;
    const expectedUps = depth;
    if (ups !== expectedUps) {
      const want = '../'.repeat(expectedUps) + tail.join('/');
      console.error(
        `❌ ${relative(ROOT, file)}\n` +
        `   depth=${depth}, import=${imp}\n` +
        `   expected ${expectedUps} ups (${want})\n`,
      );
      errors++;
    }
  }
}

if (errors) {
  console.error(`\n${errors} wrong-depth import(s) found`);
  process.exit(1);
}
console.log(`✓ All ${files.length} page imports have correct relative depth`);
