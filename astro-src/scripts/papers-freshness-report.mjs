#!/usr/bin/env node
// astro-src/scripts/papers-freshness-report.mjs
//
// Staleness report: detect when the corpus has stopped ingesting new
// arXiv papers (R7 A.3.1).
//
// Why mtime doesn't work here: git operations (commit / rebase / merge)
// refresh the filesystem mtime even for old papers, so mtime no longer
// reflects "last fetched". Instead we look at each paper's frontmatter
// `date` field (the paper's arxiv submission date) and find the max —
// if the newest paper on disk is more than --warn-days old, the
// pipeline silently stopped.
//
// CLI:
//   --warn-days=N     threshold in days (default 7)
//   --json            emit JSON instead of human summary
//   --ci              exit 1 if max-date is older than threshold
//
// Verification:
//   node astro-src/scripts/papers-freshness-report.mjs --warn-days=7 --ci

import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const PAPERS_ROOT = 'docs/papers';

function daysBetween(date1, date2) {
  return Math.floor(Math.abs(date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));
}

function walkPapers(root) {
  const out = [];
  function rec(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name === 'assets' || entry.name.startsWith('topic-seeds-')) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) rec(p);
      else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
        out.push(p);
      }
    }
  }
  rec(root);
  return out;
}

/** 从 paper frontmatter 的 `date` 字段抽出 YYYY-MM-DD。 */
function extractPaperDate(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const m = raw.match(/^date:\s*['"]?(\d{4}-\d{2}-\d{2})/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function computeFreshness(root = PAPERS_ROOT, opts = {}) {
  const warnDays = opts.warnDays ?? 7;
  const now = opts.now ?? new Date();
  const files = walkPapers(root);
  let newestDateStr = null;
  let newestDate = null;
  let missingDate = 0;
  for (const f of files) {
    const d = extractPaperDate(f);
    if (!d) { missingDate++; continue; }
    if (!newestDateStr || d > newestDateStr) {
      newestDateStr = d;
      newestDate = new Date(d + 'T00:00:00Z');
    }
  }
  const daysSince = newestDate ? daysBetween(newestDate, now) : Infinity;
  return {
    total: files.length,
    warnDays,
    now: now.toISOString(),
    newestPaperDate: newestDateStr,
    daysSinceNewest: daysSince,
    missingDateCount: missingDate,
    isStale: daysSince > warnDays,
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { json: false, ci: false, warnDays: 7 };
  for (const a of args) {
    if (a === '--json') opts.json = true;
    else if (a === '--ci') opts.ci = true;
    else if (a.startsWith('--warn-days=')) opts.warnDays = parseInt(a.split('=')[1], 10) || 7;
    else if (a === '--help' || a === '-h') {
      console.log('用法: --warn-days=N (default 7) | --json | --ci');
      process.exit(0);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs();
  const report = computeFreshness(PAPERS_ROOT, { warnDays: opts.warnDays });

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n[papers-freshness-report] === summary ===`);
    console.log(`  threshold:        ${report.warnDays} days`);
    console.log(`  total papers:     ${report.total}`);
    console.log(`  newest paper:     ${report.newestPaperDate ?? '(none)'}`);
    console.log(`  days since newest: ${report.daysSinceNewest}`);
    console.log(`  missing date:     ${report.missingDateCount}`);
    console.log(`  status:           ${report.isStale ? '⚠️  STALE' : '✓ fresh'}`);
  }

  if (opts.ci && report.isStale) process.exit(1);
}

const isCLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCLI) {
  main();
}

export { walkPapers, extractPaperDate, daysBetween };
import { pathToFileURL } from 'node:url';