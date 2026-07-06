#!/usr/bin/env node
// scripts/migrate-flat-docs.mjs
// 把 docs/<日期桶>/<arxiv-id>-<slug>.md 平铺到 docs/papers/<arxiv-id>-<slug>.md
// 默认 dry-run;--apply 才真正改名。Windows 上 fs.renameSync 是原子 FS rename,
// git 会识别为 rename,论文 git log --follow 历史保留。
//
// 用法:
//   node scripts/migrate-flat-docs.mjs            # dry-run,打印计划
//   node scripts/migrate-flat-docs.mjs --apply    # 执行
//
// 旧桶名匹配:
//   docs/YYYYMM/DD/<basename>.md          (单日)
//   docs/YYYYMMDD-YYYYMMDD/<basename>.md  (区间)

import { readdir, rename, mkdir, access } from 'node:fs/promises';
import { join, relative, sep, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DOCS_DIR = join(ROOT, 'docs');
const TARGET_DIR = join(DOCS_DIR, 'papers');

// 跳过这些顶层目录 / 前缀
const EXCLUDED_DIRS = new Set(['tutorial', 'assets', 'plans', 'papers']);
const PREFIX_SKIP_DIR = '_';

const BUCKET_RE = /^(?:\d{6}\/\d{2}|\d{8}-\d{8})\/(?<basename>[^/]+)$/;

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VERBOSE = args.has('--verbose') || args.has('-v');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (EXCLUDED_DIRS.has(e.name) || e.name.startsWith(PREFIX_SKIP_DIR)) continue;
      out.push(...(await walk(full)));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function relToDocs(p) {
  return relative(DOCS_DIR, p).split(sep).join('/');
}

async function main() {
  const all = await walk(DOCS_DIR);
  // 候选:匹配旧桶模式、以 .md 结尾(去 .md 后 basename 即目标文件名)
  const candidates = [];
  for (const f of all) {
    if (!f.endsWith('.md')) continue;
    const rel = relToDocs(f);
    const m = BUCKET_RE.exec(rel);
    if (!m) continue;
    const base = basename(f, '.md');
    // README.md 不是论文
    if (base.toLowerCase() === 'readme') continue;
    candidates.push({ from: f, fromRel: rel, base });
  }

  // 按 basename 分组,检查冲突
  const byBase = new Map();
  for (const c of candidates) {
    if (!byBase.has(c.base)) byBase.set(c.base, []);
    byBase.get(c.base).push(c);
  }

  const stats = { planned: 0, conflicts: 0, moved: 0, txtMoved: 0, warnings: 0 };
  const log = (line) => console.log(line);

  log(`Mode: ${APPLY ? 'APPLY' : 'dry-run'}`);
  log(`Target: ${relToDocs(TARGET_DIR) || 'docs/papers'}`);
  log(`Candidates: ${candidates.length} (across ${byBase.size} unique basenames)`);
  log('');

  for (const [base, group] of byBase.entries()) {
    if (group.length === 1) {
      const c = group[0];
      const newMd = join(TARGET_DIR, `${base}.md`);
      const newTxt = join(TARGET_DIR, `${base}.txt`);
      const oldTxt = c.from.replace(/\.md$/, '.txt');
      stats.planned++;
      if (VERBOSE) log(`  MOVE  ${c.fromRel}  ->  papers/${base}.md`);
      if (APPLY) {
        await mkdir(TARGET_DIR, { recursive: true });
        await rename(c.from, newMd);
        stats.moved++;
        try {
          await access(oldTxt);
          await rename(oldTxt, newTxt);
          stats.txtMoved++;
        } catch { /* no .txt sibling, fine */ }
      }
    } else {
      // 冲突:同一 basename 出现在多个桶。选最短的 fromRel(对齐 build-arxiv-index.mjs 的规则)
      const sorted = [...group].sort((a, b) => a.fromRel.length - b.fromRel.length);
      const winner = sorted[0];
      const losers = sorted.slice(1);
      stats.conflicts++;
      stats.planned++;
      log(`  CONFLICT  basename=${base}`);
      log(`    winner:  ${winner.fromRel}`);
      for (const l of losers) {
        log(`    loser:   ${l.fromRel}   (left in place, manual review)`);
        stats.warnings++;
      }
      const newMd = join(TARGET_DIR, `${base}.md`);
      const newTxt = join(TARGET_DIR, `${base}.txt`);
      const oldTxt = winner.from.replace(/\.md$/, '.txt');
      if (APPLY) {
        await mkdir(TARGET_DIR, { recursive: true });
        await rename(winner.from, newMd);
        stats.moved++;
        try {
          await access(oldTxt);
          await rename(oldTxt, newTxt);
          stats.txtMoved++;
        } catch { /* no .txt sibling, fine */ }
      }
    }
  }

  log('');
  log(`--- Summary ---`);
  log(`Planned:        ${stats.planned}`);
  log(`Conflicts:      ${stats.conflicts}`);
  log(`Warnings:       ${stats.warnings}`);
  if (APPLY) {
    log(`Moved (.md):    ${stats.moved}`);
    log(`Moved (.txt):   ${stats.txtMoved}`);
  } else {
    log(`Run with --apply to execute.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});