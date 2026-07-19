#!/usr/bin/env node
// scripts/migrate-papers-by-month.mjs
// 把 docs/papers/ 扁平布局改成 docs/papers/<YYYY>/<MM>/ 子目录布局,
// 按 arxiv id 前缀的 YYMM 分桶(例 `2606.18483v1-foo.md` → `2026/06/2606.18483v1-foo.md`)。
//
// 顶层保留不动:
//   - papers.meta.json(索引)
//   - README.md(顶层说明)
//
// 用法:
//   node scripts/migrate-papers-by-month.mjs            # dry-run,打印计划
//   node scripts/migrate-papers-by-month.mjs --apply    # 执行
//
// 设计:
//   - 用 fs.renameSync 原子改名,git 会识别为 rename,`git log --follow` 保留历史。
//   - 解析失败的 .md 跳过 + warn,继续后续文件(避免单条坏数据中断迁移)。
//   - 同名冲突(basename 在目标子目录已存在)→ 跳过 + 累计 conflicts,人工 review。
//   - biorxiv 文件从文件名里的 YYYY-MM-DD 提年月。

import { readdir, rename, mkdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAPERS_DIR = join(ROOT, 'docs', 'papers');

// 顶层需要保留、不参与迁移的文件
const KEEP_AT_TOP = new Set(['papers.meta.json', 'README.md', 'path-spec.md']);

// arXiv:YYMM.NNNNN + 可选 v# + slug
const ARXIV_RE = /^(?<yymm>\d{4})\.\d{4,5}(?:v\d+)?(?:-|$)/;
// bioRxiv:`biorxiv-10-1101-YYYY-MM-DD-...-v#-...`
const BIORXIV_RE = /^biorxiv-10-\d+-(?<year>\d{4})-(?<month>\d{2})-\d+-/;

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VERBOSE = args.has('--verbose') || args.has('-v');

function log(line) {
  console.log(line);
}

function parseMonth(stem) {
  // arXiv 优先(覆盖典型)
  const m = ARXIV_RE.exec(stem);
  if (m) {
    const yy = m.groups.yymm.slice(0, 2);
    const mm = m.groups.yymm.slice(2);
    const year = `20${yy}`;
    if (Number(mm) < 1 || Number(mm) > 12) {
      return { ok: false, reason: `月份越界 ${yy}-${mm}` };
    }
    return { ok: true, year, month: mm };
  }
  // bioRxiv
  const m2 = BIORXIV_RE.exec(stem);
  if (m2) {
    const { year, month } = m2.groups;
    if (Number(month) < 1 || Number(month) > 12) {
      return { ok: false, reason: `月份越界 ${year}-${month}` };
    }
    return { ok: true, year, month };
  }
  return { ok: false, reason: '既不是 arXiv 也不是 bioRxiv 文件名' };
}

async function exists(p) {
  try {
    await import('node:fs/promises').then(m => m.access(p));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!await exists(PAPERS_DIR)) {
    log(`[ERROR] ${PAPERS_DIR} 不存在,退出`);
    process.exit(1);
  }

  const all = await readdir(PAPERS_DIR);
  const candidates = [];
  const skipped = [];
  for (const name of all) {
    if (KEEP_AT_TOP.has(name)) continue;
    if (name.startsWith('.')) continue;  // 隐藏文件 / dotfiles
    if (!name.endsWith('.md') && !name.endsWith('.txt')) {
      // 非 .md/.txt 也跳过(理论上不该有,防御性)
      skipped.push({ name, reason: '非 .md/.txt 文件' });
      continue;
    }
    const stem = basename(name, /\.[^.]+$/.exec(name)[0]);
    const parsed = parseMonth(stem);
    if (!parsed.ok) {
      skipped.push({ name, reason: parsed.reason });
      continue;
    }
    candidates.push({
      name,
      stem,
      fromRel: `docs/papers/${name}`,
      targetDirRel: `docs/papers/${parsed.year}/${parsed.month}`,
      targetName: name,  // 保留原文件名,只换父目录
    });
  }

  // 按 stem 分组,让 .md + 配套 .txt 走同样的目标目录
  // (都用同一个 targetDir = docs/papers/<YYYY>/<MM>)。
  const byStem = new Map();
  for (const c of candidates) {
    if (!byStem.has(c.stem)) byStem.set(c.stem, []);
    byStem.get(c.stem).push(c);
  }

  let planned = 0;
  let conflicts = 0;
  let movedMd = 0;
  let movedTxt = 0;
  let warnings = 0;

  log(`Mode: ${APPLY ? 'APPLY' : 'dry-run'}`);
  log(`Source: docs/papers/`);
  log(`Candidates: ${candidates.length} 个文件,${byStem.size} 个论文 stem`);
  log('');

  for (const [stem, group] of byStem.entries()) {
    const targetDirRel = group[0].targetDirRel;
    const targetDir = join(ROOT, targetDirRel);
    const mdEntry = group.find((c) => c.name.endsWith('.md'));
    const txtEntry = group.find((c) => c.name.endsWith('.txt'));

    // 冲突检测:同 stem 在目标目录已存在(意味着有别处的同名文件已迁过去)
    const mdTarget = mdEntry ? join(targetDir, mdEntry.name) : null;
    const txtTarget = txtEntry ? join(targetDir, txtEntry.name) : null;

    let hasConflict = false;
    if (mdEntry && await exists(mdTarget)) hasConflict = true;
    if (txtEntry && await exists(txtTarget)) hasConflict = true;

    if (hasConflict) {
      conflicts++;
      warnings++;
      log(`  CONFLICT  target=${targetDirRel}/`);
      if (mdEntry) log(`    skip md:  ${mdEntry.fromRel}  (目标已存在)`);
      if (txtEntry) log(`    skip txt: ${txtEntry.fromRel}  (目标已存在)`);
      continue;
    }

    planned += group.length;  // 每个文件 (.md / .txt) 计 1

    if (VERBOSE) {
      if (mdEntry) log(`  MOVE  ${mdEntry.fromRel}  ->  ${targetDirRel}/${mdEntry.name}`);
      if (txtEntry) log(`  MOVE  ${txtEntry.fromRel}  ->  ${targetDirRel}/${txtEntry.name}`);
    }

    if (APPLY) {
      await mkdir(targetDir, { recursive: true });
      if (mdEntry) {
        await rename(join(PAPERS_DIR, mdEntry.name), mdTarget);
        movedMd++;
      }
      if (txtEntry) {
        await rename(join(PAPERS_DIR, txtEntry.name), txtTarget);
        movedTxt++;
      }
    }
  }

  if (skipped.length) {
    log('');
    log(`Skipped (未迁移,需人工 review):`);
    for (const s of skipped) {
      log(`  ${s.name}  (${s.reason})`);
      warnings++;
    }
  }

  log('');
  log(`--- Summary ---`);
  log(`Planned files:  ${planned}`);
  log(`Conflicts:      ${conflicts}`);
  log(`Warnings:       ${warnings}`);
  if (APPLY) {
    log(`Moved (.md):    ${movedMd}`);
    log(`Moved (.txt):   ${movedTxt}`);
    log(`Run: git add -A && git commit -m 'chore: migrate docs/papers to YYYY/MM subfolders'`);
  } else {
    log(`Run with --apply to execute.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});