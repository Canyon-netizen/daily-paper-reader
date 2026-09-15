#!/usr/bin/env node
// astro-src/scripts/paper-translate-check.mjs
//
// Verify each paper.md has all 5 translation sections (R7 A.2.4):
//   - ## TLDR / ## TL;DR / ## 摘要 / ## Summary
//   - ## 动机
//   - ## 方法
//   - ## 结果
//   - ## 结论 / ## 讨论 / ## 结论与展望 / ## 讨论与可借鉴点
//
// Usage:
//   node astro-src/scripts/paper-translate-check.mjs --check
//   node astro-src/scripts/paper-translate-check.mjs --ci
//   node astro-src/scripts/paper-translate-check.mjs --json

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const PAPERS_ROOT = 'docs/papers';

const REQUIRED_SECTIONS = ['TLDR', 'MOTIVATION', 'METHOD', 'RESULT', 'CONCLUSION'];

// 头部 ## 标记的子串匹配规则(更宽松 — 中文论文 section 经常带前缀如
// "## 研究背景与动机" 而不只是 "## 动机")
const SECTION_ALIASES = {
  TLDR: ['TL;DR', 'TLDR', '摘要', 'Summary'],
  MOTIVATION: ['动机', 'Motivation'],
  METHOD: ['方法', 'Method', 'Methodology'],
  RESULT: ['结果', 'Result', 'Results', '实验'],
  CONCLUSION: ['结论', 'Conclusion', '讨论', '可借鉴'],
};

function hasSection(body, key) {
  // 对每个别名做 "## 之后包含该子串" 的宽松匹配;这样
  // "## 研究背景与动机" 仍能匹配 MOTIVATION(包含 "动机")。
  for (const alias of SECTION_ALIASES[key]) {
    // 用 regex 匹配 "## ...alias..." 形式(alias 可能是中文,所以 \S* 包含中文)
    const re = new RegExp(`^##[^\\n]*${alias}`, 'm');
    if (re.test(body)) return true;
  }
  return false;
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

export function checkPaper(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    return { path: filePath, missing: ['read-error'], present: [] };
  }
  // frontmatter 之后才是 body
  const fmEnd = raw.indexOf('\n---\n', 4);
  const body = fmEnd >= 0 ? raw.slice(fmEnd + 5) : raw;
  const missing = [];
  const present = [];
  for (const key of REQUIRED_SECTIONS) {
    if (hasSection(body, key)) present.push(key);
    else missing.push(key);
  }
  return { path: filePath, missing, present };
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    check: args.includes('--check') || args.length === 0,
    ci: args.includes('--ci'),
    json: args.includes('--json'),
  };
}

function main() {
  const opts = parseArgs();
  const files = walkPapers(PAPERS_ROOT);
  console.error(`[paper-translate-check] scanning ${files.length} papers`);

  const failed = [];
  for (const f of files) {
    const r = checkPaper(f);
    if (r.missing.length > 0 && !(r.missing.length === 1 && r.missing[0] === 'read-error')) {
      failed.push(r);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({
      total: files.length,
      failed_count: failed.length,
      failed_sample: failed.slice(0, 30),
    }, null, 2));
  } else {
    console.log(`\n[paper-translate-check] === summary ===`);
    console.log(`  total: ${files.length}`);
    console.log(`  failed (missing 1+ section): ${failed.length}`);
    if (failed.length) {
      console.log(`\n  first 10 failed:`);
      for (const r of failed.slice(0, 10)) {
        console.log(`    ${relative(PAPERS_ROOT, r.path)}: missing [${r.missing.join(', ')}]`);
      }
    }
  }

  if (opts.ci && failed.length) process.exit(1);
}

const isCLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCLI) {
  main();
}

export { walkPapers, hasSection, SECTION_ALIASES, REQUIRED_SECTIONS };
import { pathToFileURL } from 'node:url';