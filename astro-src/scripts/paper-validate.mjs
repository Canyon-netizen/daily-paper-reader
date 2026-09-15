#!/usr/bin/env node
// astro-src/scripts/paper-validate.mjs
//
// Validate paper.md frontmatter against the canonical schema (R7 A.2.1).
//
// Goals:
//   - Catch broken papers at write-time (missing required field → fail CI)
//   - Score range check (0..1 or 1..10 — handle both scales seen historically)
//   - Abstract body length sanity (A.2.2 follow-up)
//
// CLI:
//   --check       list papers that fail, exit 0
//   --ci          same as --check but exit 1 if any fail (for CI gate)
//   --limit=N     only process first N failures (default Infinity)
//   --json        emit JSON report instead of human-readable summary
//
// Verification:
//   node astro-src/scripts/paper-validate.mjs --check --limit=10

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PAPERS_ROOT = 'docs/papers';

// Core fields every paper.md is expected to have.
// arxiv id lives in the filename (YYYY/MM/DD/<id>vN-<slug>.md), not frontmatter.
const REQUIRED_FIELDS = [
  'title',
  'title_zh',
  'authors',
  'date',
  'pdf',
  'score',
  'tldr',
  'source',
];

// Recommended but not required (warn-only).
const OPTIONAL_FIELDS = [
  'motivation',
  'method',
  'result',
  'conclusion',
  'categories',
];

const TLDR_MIN_CHARS = 50;
const ABSTRACT_MIN_CHARS = 100;

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { fm: null, body: raw };
  return { fm: m[1], body: raw.slice(m[0].length) };
}

function extractScalar(fm, key) {
  if (!fm) return '';
  // 简单 key: value(不含 # list-form 开头的行)
  const re = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm');
  const m = fm.match(re);
  return m ? m[1].replace(/^['"]|['"]$/g, '').trim() : '';
}

function validatePaper(filePath) {
  const errors = [];
  const warnings = [];

  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    return { path: filePath, errors: [`read-error: ${e.message}`], warnings };
  }

  const { fm, body } = parseFrontmatter(raw);
  if (!fm) {
    return { path: filePath, errors: ['no-frontmatter'], warnings };
  }

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    const v = extractScalar(fm, field);
    if (!v) errors.push(`missing required field: ${field}`);
  }

  // Score range: accept 0..1 or 0..10 (some legacy scores are 0-10)
  const scoreRaw = extractScalar(fm, 'score');
  const score = parseFloat(scoreRaw);
  if (Number.isFinite(score)) {
    if (score < 0 || score > 10) {
      errors.push(`score out of range: ${scoreRaw} (expected 0..10)`);
    }
  }

  // Optional fields → warn-only
  for (const field of OPTIONAL_FIELDS) {
    if (!extractScalar(fm, field)) warnings.push(`optional field empty: ${field}`);
  }

  // Body length checks (A.2.2): TLDR body present, abstract body sufficient
  const tldr = extractScalar(fm, 'tldr').replace(/\s+/g, '');
  if (tldr && tldr.length < TLDR_MIN_CHARS) {
    warnings.push(`tldr too short: ${tldr.length} chars (min ${TLDR_MIN_CHARS})`);
  }
  // Abstract: derived from body ## Abstract section if present
  const abstractMatch = body.match(/##\s*Abstract\s*\n+([\s\S]+?)(?=\n##\s|\n*$)/);
  if (abstractMatch) {
    const abstract = abstractMatch[1].replace(/\s+/g, '');
    if (abstract.length < ABSTRACT_MIN_CHARS) {
      warnings.push(`abstract too short: ${abstract.length} chars (min ${ABSTRACT_MIN_CHARS})`);
    }
  }

  return { path: filePath, errors, warnings };
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

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { check: false, ci: false, limit: Infinity, json: false };
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
  const all = walkPapers(PAPERS_ROOT);
  console.error(`[paper-validate] scanning ${all.length} papers`);

  const failed = [];
  const warned = [];
  for (const f of all) {
    const r = validatePaper(f);
    if (r.errors.length) failed.push(r);
    if (r.warnings.length) warned.push(r);
    if (opts.limit !== Infinity && failed.length >= opts.limit) break;
  }

  if (opts.json) {
    console.log(JSON.stringify({
      total: all.length,
      failed_count: failed.length,
      warned_count: warned.length,
      failed: failed.slice(0, 50),
      warned_sample: warned.slice(0, 10),
    }, null, 2));
  } else {
    console.log(`\n[paper-validate] === summary ===`);
    console.log(`  total: ${all.length}`);
    console.log(`  failed: ${failed.length}`);
    console.log(`  warned: ${warned.length}`);
    if (failed.length) {
      console.log(`\n  failed (first 10):`);
      for (const r of failed.slice(0, 10)) {
        console.log(`    ${relative(PAPERS_ROOT, r.path)}: ${r.errors.join('; ')}`);
      }
    }
    if (warned.length && !opts.ci) {
      console.log(`\n  warned sample (first 5):`);
      for (const r of warned.slice(0, 5)) {
        console.log(`    ${relative(PAPERS_ROOT, r.path)}: ${r.warnings.join('; ')}`);
      }
    }
  }

  if (opts.ci && failed.length) process.exit(1);
}

// CLI guard for testability
const isCLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCLI) {
  main();
}

// Re-export for tests
export { parseFrontmatter, extractScalar, validatePaper, walkPapers, REQUIRED_FIELDS, OPTIONAL_FIELDS };
import { pathToFileURL } from 'node:url';