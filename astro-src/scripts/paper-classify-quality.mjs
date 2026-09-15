#!/usr/bin/env node
// astro-src/scripts/paper-classify-quality.mjs
//
// Heuristic quality classifier for paper.md (R7 A.3.3).
//
// Flags papers whose frontmatter / body suggest the LLM pipeline
// produced a low-quality entry. The output helps the freshness /
// audit scripts and the library ingest pass prioritize cleanup.
//
// Rules:
//   - tldr_too_short:     tldr < 30 chars (suggests LLM truncated)
//   - no_abstract:        ## Abstract section missing or < 50 chars
//   - score_suspicious:   score < 0.05 or > 0.95 (extreme values often
//                         mean the relevance pipeline gave up or
//                         hallucinated)
//   - no_method_section:  no ## 方法 / ## Method header in body
//
// CLI:
//   --check       list papers with 1+ flags, exit 0
//   --ci          exit 1 if any paper has flags
//   --json        emit JSON report
//   --limit=N     only process first N papers
//
// Verification:
//   node astro-src/scripts/paper-classify-quality.mjs --check --limit=5

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const PAPERS_ROOT = 'docs/papers';

const QUALITY_RULES = [
  { name: 'tldr_too_short', check: (f) => f.tldr && f.tldr.length < 30 },
  { name: 'no_abstract', check: (_, body) => {
    const m = body.match(/##\s*Abstract\s*\n+([\s\S]+?)(?=\n##\s|\n*$)/);
    return !m || m[1].trim().length < 50;
  }},
  { name: 'score_suspicious', check: (f) => {
    const s = parseFloat(f.score);
    if (!Number.isFinite(s)) return false;
    // 接受两种 scale:0..1(新 LLM) 或 0..10(legacy)。
    // 用 max(1, s) 推断 scale:若 s > 1,scale 是 0..10;否则 0..1。
    const scale = s > 1 ? 10 : 1;
    return s < 0.05 * scale || s > 0.95 * scale;
  }},
  { name: 'no_method_section', check: (_, body) => {
    // 宽松匹配,允许 ## 研究方法 / ## 方法 / ## Method 等
    return !/^##[^\n]*(方法|Method)/m.test(body);
  }},
];

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) out[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
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

export function classifyPaper(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    return { path: filePath, issues: ['read-error'] };
  }
  const fmEnd = raw.indexOf('\n---\n', 4);
  const fm = parseFrontmatter(raw);
  const body = fmEnd >= 0 ? raw.slice(fmEnd + 5) : raw;
  const issues = QUALITY_RULES.filter((r) => r.check(fm, body)).map((r) => r.name);
  return { path: filePath, issues };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { check: false, ci: false, json: false, limit: Infinity };
  for (const a of args) {
    if (a === '--check') opts.check = true;
    else if (a === '--ci') { opts.ci = true; opts.check = true; }
    else if (a === '--json') opts.json = true;
    else if (a.startsWith('--limit=')) opts.limit = parseInt(a.split('=')[1], 10) || Infinity;
    else if (a === '--help' || a === '-h') {
      console.log('用法: --check | --ci | --json | --limit=N');
      process.exit(0);
    }
  }
  if (!opts.check && !opts.json) opts.check = true;
  return opts;
}

function main() {
  const opts = parseArgs();
  const files = walkPapers(PAPERS_ROOT);
  console.error(`[paper-classify-quality] scanning ${files.length} papers`);

  const flagged = [];
  let processed = 0;
  for (const f of files) {
    if (processed >= opts.limit) break;
    processed++;
    const r = classifyPaper(f);
    if (r.issues.length > 0) flagged.push(r);
  }

  // Aggregate issue counts
  const issueCounts = new Map();
  for (const r of flagged) {
    for (const i of r.issues) {
      issueCounts.set(i, (issueCounts.get(i) ?? 0) + 1);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({
      total: files.length,
      flagged_count: flagged.length,
      issue_counts: Object.fromEntries(issueCounts),
      flagged_sample: flagged.slice(0, 50),
    }, null, 2));
  } else {
    console.log(`\n[paper-classify-quality] === summary ===`);
    console.log(`  total: ${files.length}`);
    console.log(`  flagged: ${flagged.length}`);
    if (issueCounts.size) {
      console.log(`  issue counts:`);
      for (const [name, count] of issueCounts.entries()) {
        console.log(`    ${name}: ${count}`);
      }
    }
    if (flagged.length && opts.check) {
      console.log(`\n  first 10 flagged:`);
      for (const r of flagged.slice(0, 10)) {
        console.log(`    ${relative(PAPERS_ROOT, r.path)}: [${r.issues.join(', ')}]`);
      }
    }
  }

  if (opts.ci && flagged.length) process.exit(1);
}

const isCLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCLI) {
  main();
}

export { walkPapers, QUALITY_RULES, parseFrontmatter };
import { pathToFileURL } from 'node:url';