#!/usr/bin/env node
// scripts/migrate-papers-by-day.mjs
// 把 docs/papers/<YYYY>/<MM>/ 拆成 <YYYY>/<MM>/<DD>/,DD 来源:
//   1) .md 文件优先读 frontmatter 的 `date: YYYY-MM-DD`
//   2) .txt 孤儿先查同 stem .md 的日期(sibling-frontmatter)
//   3) 都没有 → arxiv id YYMM + day='01'(arxiv-yymm-fallback)
//   4) bioRxiv 文件名直接提 YYYY-MM-DD
// 跨月论文(如 arxiv YYMM=2607 但 date=2026-06-30)会从错误月份搬到正确月份,
// 这是为了顺手修 commit 3166d40 留下的 bug(分桶用了 arxiv YYMM 而非发表日)。
//
// 顶层保留不动:
//   - papers.meta.json(索引)
//   - README.md(顶层说明)
//
// 用法:
//   node scripts/migrate-papers-by-day.mjs            # dry-run,打印计划
//   node scripts/migrate-papers-by-day.mjs --apply    # 执行
//
// 设计沿用 scripts/migrate-papers-by-month.mjs:
//   - fs.renameSync 原子改名,git 识别为 rename,`git log --follow` 保留历史。
//   - 同 stem .md + .txt 必须去同一个 YYYY/MM/DD/(不一致时以 .md 为准,warn)。
//   - dry-run 默认 quiet,带 --verbose 看每条移动。

import { readdir, rename, mkdir, readFile } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAPERS_DIR = join(ROOT, 'docs', 'papers');

// 顶层需要保留、不参与迁移的文件
const KEEP_AT_TOP = new Set(['papers.meta.json', 'README.md', 'path-spec.md']);

// arxiv: YYMM.NNNNN + 可选 v# + slug (与 migrate-by-month 共用)
const ARXIV_RE = /^(?<yymm>\d{4})\.\d{4,5}(?:v\d+)?(?:-|$)/;
// bioRxiv: biorxiv-10-1101-YYYY-MM-DD-...
const BIORXIV_RE = /^biorxiv-10-\d+-(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})-/;
// markdown frontmatter date 字段
const FRONTMATTER_DATE_RE = /^date:\s*['"]?(\d{4})-(\d{2})-(\d{2})['"]?/m;

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VERBOSE = args.has('--verbose') || args.has('-v');

function log(line) {
  console.log(line);
}

function parseDayFromFilename(stem) {
  // bioRxiv 文件名带 YYYY-MM-DD,作为冗余 fallback
  const m = BIORXIV_RE.exec(stem);
  if (m) {
    return { ok: true, year: m.groups.year, month: m.groups.month, day: m.groups.day, source: 'filename-biorxiv' };
  }
  // arxiv YYMM 只能给 YYYY/MM,DD 留 01
  const a = ARXIV_RE.exec(stem);
  if (a) {
    const yy = a.groups.yymm.slice(0, 2);
    const mm = a.groups.yymm.slice(2);
    if (Number(mm) < 1 || Number(mm) > 12) {
      return { ok: false, reason: `月份越界 ${yy}-${mm}` };
    }
    return { ok: true, year: `20${yy}`, month: mm, day: '01', source: 'arxiv-yymm-fallback' };
  }
  return { ok: false, reason: '既不是 arXiv 也不是 bioRxiv 文件名' };
}

async function readDateFromMd(mdPath) {
  try {
    const text = await readFile(mdPath, 'utf-8');
    const m = FRONTMATTER_DATE_RE.exec(text);
    if (!m) return { ok: false, reason: 'no date: in frontmatter' };
    const [, year, month, day] = m;
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) {
      return { ok: false, reason: `date 越界 ${year}-${month}-${day}` };
    }
    return { ok: true, year, month, day, source: 'frontmatter' };
  } catch (e) {
    return { ok: false, reason: `read md failed: ${e.message}` };
  }
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

  // 第一遍:全量扫描,收集每个文件的 source dir (YYYY/MM) + filename
  const all = await readdir(PAPERS_DIR);
  const topLevelEntries = [];
  for (const name of all) {
    if (KEEP_AT_TOP.has(name)) continue;
    if (name.startsWith('.')) continue;
    const fullPath = join(PAPERS_DIR, name);
    const stat = await import('node:fs/promises').then(m => m.stat(fullPath));
    if (!stat.isFile()) continue;  // 子目录 (2025/ 2026/) 跳过,只处理顶级
    if (!name.endsWith('.md') && !name.endsWith('.txt')) continue;
    topLevelEntries.push({ name, fullPath });
  }

  // 第二遍:递归扫描 YYYY/MM/ 下的所有 .md / .txt
  const monthlyEntries = [];
  async function scanMonthDir(monthDirAbs, monthDirRel) {
    const ents = await readdir(monthDirAbs);
    for (const name of ents) {
      if (name.startsWith('.')) continue;
      if (!name.endsWith('.md') && !name.endsWith('.txt')) continue;
      monthlyEntries.push({
        name,
        fullPath: join(monthDirAbs, name),
        currentRel: `${monthDirRel}/${name}`,
      });
    }
  }
  const yearDirs = await readdir(PAPERS_DIR);
  for (const yearName of yearDirs) {
    if (KEEP_AT_TOP.has(yearName)) continue;
    if (!/^\d{4}$/.test(yearName)) continue;  // 跳过非年份目录
    const yearAbs = join(PAPERS_DIR, yearName);
    const yearStat = await import('node:fs/promises').then(m => m.stat(yearAbs));
    if (!yearStat.isDirectory()) continue;
    const monthNames = await readdir(yearAbs);
    for (const monthName of monthNames) {
      const monthAbs = join(yearAbs, monthName);
      const monthStat = await import('node:fs/promises').then(m => m.stat(monthAbs));
      if (!monthStat.isDirectory()) continue;
      await scanMonthDir(monthAbs, `docs/papers/${yearName}/${monthName}`);
    }
  }

  const allEntries = [...topLevelEntries, ...monthlyEntries];
  log(`Mode: ${APPLY ? 'APPLY' : 'dry-run'}`);
  log(`Source: docs/papers/ (recursive)`);
  log(`Found: ${allEntries.length} files (top-level=${topLevelEntries.length}, monthly=${monthlyEntries.length})`);

  // 按 stem 分组 .md / .txt
  const byStem = new Map();
  for (const e of allEntries) {
    const stem = basename(e.name, /\.[^.]+$/.exec(e.name)[0]);
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(e);
  }
  log(`Unique stems: ${byStem.size}`);
  log('');

  // 第一次 pass:收集所有 .md 的 date 进 map,后续 .txt 孤儿可用。
  // 注意:很多论文 .md 和 .txt stem 不一致(.md 无 slug, .txt 有 slug),所以
  // 还得按 arxiv id 前缀再收集一份 → mdDateByArxivId,用于 cross-stem fallback。
  const stemDateMap = new Map();  // stem → { year, month, day, source }
  const mdDateByArxivId = new Map();  // arxiv id (e.g. 2607.09330v1) → date
  const ARXIV_ID_FROM_STEM_RE = /^(\d{4}\.\d{4,5}v\d+)/;
  for (const [stem, group] of byStem.entries()) {
    const md = group.find((e) => e.name.endsWith('.md'));
    if (!md) continue;
    const d = await readDateFromMd(md.fullPath);
    if (d.ok) {
      stemDateMap.set(stem, d);
      const m = ARXIV_ID_FROM_STEM_RE.exec(stem);
      if (m) mdDateByArxivId.set(m[1], d);
    }
  }
  log(`Frontmatter dates collected from ${stemDateMap.size} .md files (${mdDateByArxivId.size} unique arxiv ids)`);
  log('');

  let planned = 0;
  let conflicts = 0;
  let warnings = 0;
  let movedMd = 0;
  let movedTxt = 0;
  let crossMonthMoves = 0;
  let orphanTxt = 0;
  const disagreementList = [];
  const fallbackList = [];

  for (const [stem, group] of byStem.entries()) {
    const mdEntry = group.find((e) => e.name.endsWith('.md'));
    const txtEntry = group.find((e) => e.name.endsWith('.txt'));

    // 先确定这个 stem 的目标 bucket
    let bucket;
    let bucketSource;
    if (mdEntry) {
      // .md 存在 → 它的 frontmatter date 是权威
      const mdDate = stemDateMap.get(stem);
      if (mdDate) {
        bucket = { year: mdDate.year, month: mdDate.month, day: mdDate.day };
        bucketSource = mdDate.source;
      } else {
        // .md 没有 date 字段 → fallback 到文件名
        const fb = parseDayFromFilename(stem);
        if (!fb.ok) {
          warnings++;
          log(`  SKIP  ${stem}  (.md 无 date 且文件名无法解析: ${fb.reason})`);
          continue;
        }
        bucket = { year: fb.year, month: fb.month, day: fb.day };
        bucketSource = fb.source;
        warnings++;
        fallbackList.push(`${stem}: ${fb.source}`);
      }
    } else {
      // 只有 .txt (orphan) → 优先查同 stem .md;stem 不一致时按 arxiv id 查 .md;
      // 都没有 → arxiv YYMM + day=01 fallback。
      let sibDate = stemDateMap.get(stem);
      if (!sibDate) {
        const m = ARXIV_ID_FROM_STEM_RE.exec(stem);
        if (m) sibDate = mdDateByArxivId.get(m[1]);
        if (sibDate) bucketSource = `arxiv-id-sibling-${sibDate.source}`;
      } else {
        bucketSource = `sibling-${sibDate.source}`;
      }
      if (sibDate) {
        bucket = { year: sibDate.year, month: sibDate.month, day: sibDate.day };
        orphanTxt++;
      } else {
        const fb = parseDayFromFilename(stem);
        if (!fb.ok) {
          warnings++;
          log(`  SKIP  ${stem}  (.txt 孤儿且文件名无法解析: ${fb.reason})`);
          continue;
        }
        bucket = { year: fb.year, month: fb.month, day: fb.day };
        bucketSource = fb.source;
        warnings++;
        fallbackList.push(`${stem}: ${fb.source} (.txt 孤儿)`);
        orphanTxt++;
      }
    }

    const targetDirRel = `docs/papers/${bucket.year}/${bucket.month}/${bucket.day}`;
    const targetDirAbs = join(PAPERS_DIR, bucket.year, bucket.month, bucket.day);

    // 跨月检测:文件当前所在月 vs 目标月不一致
    for (const e of group) {
      const cur = e.currentRel || `docs/papers/${e.name}`;
      const curMonthMatch = cur.match(/docs\/papers\/(\d{4})\/(\d{2})\//);
      if (curMonthMatch) {
        const curY = curMonthMatch[1], curM = curMonthMatch[2];
        if (curY !== bucket.year || curM !== bucket.month) {
          crossMonthMoves++;
          if (VERBOSE) {
            log(`  CROSS-MONTH  ${cur}  ->  ${targetDirRel}/${e.name}  (was ${curY}/${curM}, bucket from ${bucketSource})`);
          }
        }
      } else {
        // 顶级 (没有月份目录) → 也算搬迁
        if (VERBOSE) {
          log(`  TOP-LEVEL  ${cur}  ->  ${targetDirRel}/${e.name}  (bucket from ${bucketSource})`);
        }
      }
    }

    // 冲突检测
    const mdTarget = mdEntry ? join(targetDirAbs, mdEntry.name) : null;
    const txtTarget = txtEntry ? join(targetDirAbs, txtEntry.name) : null;
    let hasConflict = false;
    if (mdEntry && await exists(mdTarget)) hasConflict = true;
    if (txtEntry && await exists(txtTarget)) hasConflict = true;

    if (hasConflict) {
      conflicts++;
      warnings++;
      log(`  CONFLICT  target=${targetDirRel}/`);
      if (mdEntry) log(`    skip md:  ${mdEntry.currentRel || mdEntry.name}`);
      if (txtEntry) log(`    skip txt: ${txtEntry.currentRel || txtEntry.name}`);
      continue;
    }

    planned += group.length;

    if (VERBOSE) {
      if (mdEntry) log(`  MOVE  ${mdEntry.currentRel || `docs/papers/${mdEntry.name}`}  ->  ${targetDirRel}/${mdEntry.name}  [${bucketSource}]`);
      if (txtEntry) log(`  MOVE  ${txtEntry.currentRel || `docs/papers/${txtEntry.name}`}  ->  ${targetDirRel}/${txtEntry.name}  [${bucketSource}]`);
    }

    if (APPLY) {
      await mkdir(targetDirAbs, { recursive: true });
      if (mdEntry) {
        await rename(mdEntry.fullPath, mdTarget);
        movedMd++;
      }
      if (txtEntry) {
        await rename(txtEntry.fullPath, txtTarget);
        movedTxt++;
      }
    }
  }

  log('');
  log(`--- Summary ---`);
  log(`Planned files:        ${planned}`);
  log(`  of which .md:       ${movedMd || byStem.size > 0 ? Math.ceil(planned / 2) : 0}`);  // 粗略
  log(`Cross-month moves:    ${crossMonthMoves}`);
  log(`Orphan .txt files:    ${orphanTxt}`);
  log(`Fallbacks used:       ${fallbackList.length}`);
  log(`Conflicts:            ${conflicts}`);
  log(`Warnings:             ${warnings}`);
  if (fallbackList.length) {
    log('');
    log(`Fallback list:`);
    for (const f of fallbackList.slice(0, 30)) log(`  ${f}`);
    if (fallbackList.length > 30) log(`  ... (${fallbackList.length - 30} more)`);
  }
  if (APPLY) {
    log('');
    log(`Run: git add -A && git status  (期望看到 ~531 行 R100)`);
    log(`Then: git commit -m 'chore: migrate docs/papers to YYYY/MM/DD subfolders (date from frontmatter)'`);
  } else {
    log('');
    log(`Run with --apply to execute.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
