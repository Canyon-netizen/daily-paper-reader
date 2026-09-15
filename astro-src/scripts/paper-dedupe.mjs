#!/usr/bin/env node
// astro-src/scripts/paper-dedupe.mjs
//
// Find duplicate paper.md files by canonical arxiv id (R7 A.2.3).
//
// arxiv id lives in the filename: docs/papers/YYYY/MM/DD/<id>v<N>-<slug>.md.
// Two papers with the same canonical id (ignoring the v<N> suffix) are duplicates;
// we keep the highest version, and (with --delete) unlink the rest.
//
// Why: translate_parallel could write the same paper twice under different
// date directories (one per fetch window). After dedup we keep 1 per canonical
// id. See translate_polaris.dedup_paper_files for the same logic applied at
// pipeline-write time.
//
// CLI:
//   --check           list duplicates, do nothing
//   --check --json    emit machine-readable report
//   --delete          unlink duplicate files (keeps highest version)
//
// Verification:
//   node astro-src/scripts/paper-dedupe.mjs --check | head -20

import { readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';

const PAPERS_ROOT = 'docs/papers';

const ID_RE = /^(\d{4}\.\d{4,5})(v(\d+))?/;

/** Extract canonical id + version from a filename stem like "2606.06087v1-latentskill". */
function parseArxivIdFromFilename(filename) {
  // filename 不含 .md 后缀;e.g. "2606.06087v1-latentskill"
  const stem = filename.replace(/\.md$/, '');
  const m = stem.match(ID_RE);
  if (!m) return null;
  return {
    canonical: m[1],
    version: m[3] ? parseInt(m[3], 10) : 0,
  };
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

export function findDuplicates(root = PAPERS_ROOT) {
  const files = walkPapers(root);
  /** canonical -> [{ path, version }] */
  const byId = new Map();
  for (const f of files) {
    const filename = f.split('/').pop();
    const parsed = parseArxivIdFromFilename(filename);
    if (!parsed) continue;
    const arr = byId.get(parsed.canonical) ?? [];
    arr.push({ path: f, version: parsed.version });
    byId.set(parsed.canonical, arr);
  }

  const dupGroups = [];
  for (const [canonical, entries] of byId) {
    if (entries.length <= 1) continue;
    entries.sort((a, b) => b.version - a.version);
    dupGroups.push({
      canonical,
      keep: entries[0],
      remove: entries.slice(1),
    });
  }
  return { total: files.length, dupGroups };
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    check: args.includes('--check') || args.length === 0,
    json: args.includes('--json'),
    delete: args.includes('--delete'),
  };
}

function main() {
  const opts = parseArgs();
  const { total, dupGroups } = findDuplicates();

  const totalDups = dupGroups.reduce((s, g) => s + g.remove.length, 0);

  if (opts.json) {
    console.log(JSON.stringify({
      total_papers: total,
      duplicate_groups: dupGroups.length,
      duplicate_files: totalDups,
      groups: dupGroups.slice(0, 50),
    }, null, 2));
  } else {
    console.log(`\n[paper-dedupe] === summary ===`);
    console.log(`  total: ${total}`);
    console.log(`  duplicate groups: ${dupGroups.length}`);
    console.log(`  duplicate files (would delete): ${totalDups}`);
    if (dupGroups.length) {
      console.log(`\n  first 10 groups (canonical → keep / remove):`);
      for (const g of dupGroups.slice(0, 10)) {
        console.log(`    ${g.canonical}: keep=${relative(PAPERS_ROOT, g.keep.path)} (v${g.keep.version})`);
        for (const r of g.remove) {
          console.log(`      remove: ${relative(PAPERS_ROOT, r.path)} (v${r.version})`);
        }
      }
    }
  }

  if (opts.delete && totalDups > 0) {
    let deleted = 0;
    for (const g of dupGroups) {
      for (const r of g.remove) {
        try {
          unlinkSync(r.path);
          deleted++;
        } catch (e) {
          console.warn(`  [warn] could not delete ${r.path}: ${e.message}`);
        }
      }
    }
    console.log(`\n[paper-dedupe] deleted ${deleted} files`);
  }
}

// CLI guard
const isCLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCLI) {
  main();
}

export { parseArxivIdFromFilename, walkPapers };
import { pathToFileURL } from 'node:url';