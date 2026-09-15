#!/usr/bin/env node
// astro-src/scripts/library-validate.mjs
//
// Validate a user-libraries JSON dump against the schema defined in
// astro-src/lib/user-libraries/types.ts (R7 D.2.1).
//
// What this catches:
//   - Missing required fields (id, name, statement, hue, papers, etc.)
//   - name length out of [1, 32]
//   - hue not in the 7-color palette
//   - paper entries with invalid status enum
//   - papers keys not in canonical arxiv id form (\d{4}\.\d{4,5})
//
// Usage:
//   node astro-src/scripts/library-validate.mjs --check
//   node astro-src/scripts/library-validate.mjs --check --path=path/to/user-libraries.json
//   node astro-src/scripts/library-validate.mjs --ci
//   node astro-src/scripts/library-validate.mjs --json
//
// Default path: docs/library/user-libraries.json (not present on disk
// by default — user data lives in browser localStorage; this script
// is for CI checks on exported dumps).

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_PATH = 'docs/library/user-libraries.json';

const REQUIRED_FIELDS = [
  'id', 'name', 'statement', 'hue', 'categories', 'rubric',
  'papers', 'stages', 'drafts',
];

const VALID_HUES = new Set([
  'orange', 'cyan', 'purple', 'emerald', 'amber', 'rose', 'sky',
]);

const VALID_STATUS = new Set([
  'candidate', 'included', 'excluded', 'starred',
]);

const ARXIV_ID_RE = /^\d{4}\.\d{4,5}$/;

function loadLibraries(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { __parse_error: e.message };
  }
}

export function validateLibrary(lib, libId) {
  const errors = [];
  const warnings = [];

  for (const f of REQUIRED_FIELDS) {
    if (!(f in lib)) errors.push(`missing required field: ${f}`);
  }

  if (typeof lib.name === 'string') {
    if (lib.name.length < 1 || lib.name.length > 32) {
      errors.push(`name length must be 1-32, got ${lib.name.length}`);
    }
  }

  if (lib.hue && !VALID_HUES.has(lib.hue)) {
    errors.push(`invalid hue: ${lib.hue} (must be one of ${[...VALID_HUES].join(', ')})`);
  }

  // categories should be array (allow empty)
  if (lib.categories && !Array.isArray(lib.categories)) {
    errors.push('categories must be array');
  }

  // rubric should be array (allow empty)
  if (lib.rubric && !Array.isArray(lib.rubric)) {
    errors.push('rubric must be array');
  }

  // papers: object keyed by canonicalArxivId, each value has status enum
  if (lib.papers && typeof lib.papers === 'object' && !Array.isArray(lib.papers)) {
    for (const [arxivId, meta] of Object.entries(lib.papers)) {
      if (!ARXIV_ID_RE.test(arxivId)) {
        errors.push(`invalid paper arxivId: ${arxivId}`);
      }
      if (!meta || typeof meta !== 'object') {
        errors.push(`papers.${arxivId} must be object`);
        continue;
      }
      if (meta.status && !VALID_STATUS.has(meta.status)) {
        errors.push(`papers.${arxivId}.status invalid: ${meta.status}`);
      }
    }
  }

  if (lib.stages && !Array.isArray(lib.stages)) {
    errors.push('stages must be array');
  }

  if (lib.drafts && !Array.isArray(lib.drafts)) {
    errors.push('drafts must be array');
  }

  return { libId, errors, warnings };
}

export function validateLibraries(doc) {
  if (!doc || typeof doc !== 'object') {
    return { ok: false, errors: ['document is not an object'] };
  }
  if (doc.__parse_error) {
    return { ok: false, errors: [`JSON parse error: ${doc.__parse_error}`] };
  }
  if (!doc.libraries || typeof doc.libraries !== 'object') {
    return { ok: false, errors: ['missing top-level "libraries" object'] };
  }

  const results = [];
  for (const [libId, lib] of Object.entries(doc.libraries)) {
    results.push(validateLibrary(lib, libId));
  }
  return { ok: true, results };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { check: false, ci: false, json: false, path: DEFAULT_PATH };
  for (const a of args) {
    if (a === '--check') opts.check = true;
    else if (a === '--ci') { opts.ci = true; opts.check = true; }
    else if (a === '--json') opts.json = true;
    else if (a.startsWith('--path=')) opts.path = a.split('=')[1];
    else if (a === '--help' || a === '-h') {
      console.log('用法: --check | --ci | --json | --path=PATH');
      process.exit(0);
    }
  }
  if (!opts.check && !opts.json) opts.check = true;
  return opts;
}

function main() {
  const opts = parseArgs();

  if (!existsSync(opts.path)) {
    if (opts.json) {
      console.log(JSON.stringify({
        ok: false, errors: [`file not found: ${opts.path}`],
        note: 'user libraries live in browser localStorage by default; this script validates exported dumps',
      }, null, 2));
    } else {
      console.log(`\n[library-validate] file not found: ${opts.path}`);
      console.log(`  (user libraries live in browser localStorage; this script validates exported dumps)`);
      console.log(`  pass --path=/path/to/dump.json to check an exported file`);
    }
    if (opts.ci) process.exit(1);
    return;
  }

  const doc = loadLibraries(opts.path);
  const result = validateLibraries(doc);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (!result.ok) {
      console.log(`\n[library-validate] FAIL: ${result.errors.join('; ')}`);
    } else {
      console.log(`\n[library-validate] scanning ${result.results.length} libraries in ${basename(opts.path)}`);
      const failed = result.results.filter((r) => r.errors.length > 0);
      const warned = result.results.filter((r) => r.warnings.length > 0);
      console.log(`  failed: ${failed.length}`);
      console.log(`  warned: ${warned.length}`);
      if (failed.length) {
        console.log(`\n  first 10 failed:`);
        for (const r of failed.slice(0, 10)) {
          console.log(`    ${r.libId}: ${r.errors.join('; ')}`);
        }
      }
    }
  }

  if (opts.ci && (!result.ok || result.results.some((r) => r.errors.length > 0))) {
    process.exit(1);
  }
}

const isCLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCLI) {
  main();
}