#!/usr/bin/env node
// astro-src/scripts/audit-crosslinks.mjs
//
// 验证 docs/papers/**/*.md 的 cross-link 字段健康度(2026-09-15)。
// 检查:
//   1. related_ideas / related_experiments / related_writings 至少有 1 个非空
//   2. 引用的 path 必须存在(用 existsSync 检查 docs/<path>)
//   3. resource_tier 必须 ∈ {small, medium, large, xlarge} 或 '' (未推断)
//   4. is_milestone 必须是 boolean
//
// CLI:
//   --check: 列出失败论文 + 原因,exit 0
//   --ci: 同 --check 但失败 exit 1
//   --fix: 自动给无 related_* 的论文加 is_orphan: true(在 frontmatter)
//   --json: 输出 JSON 报告
//   --limit N: 只处理 N 篇论文
//
// 用法:
//   node astro-src/scripts/audit-crosslinks.mjs --check --limit 10
//   node astro-src/scripts/audit-crosslinks.mjs --check --ci
//   node astro-src/scripts/audit-crosslinks.mjs --json

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const PAPERS_ROOT = 'docs/papers';
const DOCS_ROOT = 'docs';

const VALID_TIERS = new Set(['small', 'medium', 'large', 'xlarge', '', 'unknown', 'api_only']);

/** 从 raw frontmatter 提取相关字段。 */
export function extractFrontmatter(raw) {
  const m = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: '', body: raw };
  return { fm: m[1], body: raw.slice(m[0].length) };
}

/** 读取 frontmatter 中的 cross-link 字段。 */
export function readCrosslinkFields(fm) {
  const out = {
    related_ideas: [],
    related_experiments: [],
    related_writings: [],
    resource_tier: '',
    is_milestone: null,
  };

  // related_ideas: [...]
  const ideasMatch = fm.match(/^related_ideas:\s*\[([^\]]*)\]/m);
  if (ideasMatch) {
    out.related_ideas = ideasMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }

  // related_experiments: [...]
  const expsMatch = fm.match(/^related_experiments:\s*\[([^\]]*)\]/m);
  if (expsMatch) {
    out.related_experiments = expsMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }

  // related_writings: [...]
  const writesMatch = fm.match(/^related_writings:\s*\[([^\]]*)\]/m);
  if (writesMatch) {
    out.related_writings = writesMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }

  // resource_tier: "small" | ...
  const tierMatch = fm.match(/^resource_tier:\s*(.+)$/m);
  if (tierMatch) {
    out.resource_tier = tierMatch[1].replace(/^['"]|['"]$/g, '').trim();
  }

  // is_milestone: true | false
  const msMatch = fm.match(/^is_milestone:\s*(.+)$/m);
  if (msMatch) {
    const val = msMatch[1].trim();
    out.is_milestone = val === 'true';
  }

  return out;
}

/** 检查引用的 path 是否存在。 */
export function validateRef(ref, filePath) {
  // ref 已经是相对于 docs/ 的完整路径，如 "ideas/xxx.md" 或 "docs/ideas/xxx.md"
  // 统一去掉前缀 "docs/"（如果存在）
  const normalizedRef = ref.replace(/^docs\//, '');
  const targetPath = join(DOCS_ROOT, normalizedRef);
  // 尝试 .md 后缀
  if (existsSync(targetPath + '.md')) return { valid: true };
  if (existsSync(targetPath)) return { valid: true };
  // 尝试目录下的 index.md
  if (existsSync(join(targetPath, 'index.md'))) return { valid: true };
  return { valid: false, targetPath };
}

/** 检查单篇论文的 cross-link 健康度。 */
export function auditPaper(filePath) {
  const issues = [];
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    return { path: filePath, issues: ['read-error'], isOrphan: false };
  }

  const { fm } = extractFrontmatter(raw);
  if (!fm) {
    return { path: filePath, issues: ['no-frontmatter'], isOrphan: false };
  }

  const fields = readCrosslinkFields(fm);

  // 1. 检查 related_* 至少有一个非空
  const hasLinks = fields.related_ideas.length > 0 ||
                   fields.related_experiments.length > 0 ||
                   fields.related_writings.length > 0;

  if (!hasLinks) {
    issues.push('orphan(no-related-links)');
  }

  // 2. 检查引用的 path 是否存在
  const allRefs = [
    ...fields.related_ideas.map(r => ({ type: 'idea', ref: r })),
    ...fields.related_experiments.map(r => ({ type: 'experiment', ref: r })),
    ...fields.related_writings.map(r => ({ type: 'writing', ref: r })),
  ];

  for (const { type, ref } of allRefs) {
    const result = validateRef(ref, filePath);
    if (!result.valid) {
      issues.push(`invalid-ref(${type}:${ref})`);
    }
  }

  // 3. 检查 resource_tier 有效值
  if (!VALID_TIERS.has(fields.resource_tier)) {
    issues.push(`invalid-tier(${fields.resource_tier})`);
  }

  // 4. 检查 is_milestone 是 boolean
  if (fields.is_milestone !== null && typeof fields.is_milestone !== 'boolean') {
    issues.push(`invalid-milestone(${fields.is_milestone})`);
  }

  return {
    path: relative(PAPERS_ROOT, filePath),
    fullPath: filePath,
    issues,
    hasLinks,
    isOrphan: !hasLinks,
    fields,
  };
}

/** 给无 related_* 的论文加 is_orphan: true。 */
export function addOrphanFlag(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    return false;
  }

  const { fm, body } = extractFrontmatter(raw);
  if (!fm) return false;

  // 检查是否已有 is_orphan
  if (/^is_orphan:/m.test(fm)) return false;

  // 在 frontmatter 末尾添加 is_orphan: true
  const newFm = fm + '\nis_orphan: true';
  const newRaw = '---\n' + newFm + '\n---\n' + body;

  try {
    writeFileSync(filePath, newRaw, 'utf8');
    return true;
  } catch (e) {
    console.warn(`  [write error] ${filePath}: ${e.message}`);
    return false;
  }
}

export function walkPapers(root) {
  const out = [];
  function rec(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name === 'assets') continue;
      if (entry.name.startsWith('topic-seeds-')) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) rec(p);
      else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.txt')) {
        out.push(p);
      }
    }
  }
  rec(root);
  return out;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    check: false,
    ci: false,
    fix: false,
    json: false,
    limit: 0,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--check') opts.check = true;
    else if (a === '--ci') { opts.ci = true; opts.check = true; }
    else if (a === '--fix') opts.fix = true;
    else if (a === '--json') opts.json = true;
    else if (a.startsWith('--limit=')) opts.limit = parseInt(a.split('=')[1], 10) || 0;
    else if (a === '--limit') opts.limit = parseInt(args[++i], 10) || 0;
    else if (a === '--help' || a === '-h') {
      console.log('用法: --check | --ci | --fix | --json | --limit N');
      process.exit(0);
    }
  }
  // 默认行为
  if (!opts.check && !opts.fix && !opts.json) opts.check = true;
  return opts;
}

function main() {
  const opts = parseArgs();

  const all = walkPapers(PAPERS_ROOT);
  console.log(`[audit-crosslinks] found ${all.length} papers`);

  const results = [];
  let processed = 0, orphans = 0, invalidRefs = 0, badTier = 0, badMilestone = 0, fixed = 0;

  for (const file of all) {
    if (opts.limit && processed >= opts.limit) break;
    processed++;

    const result = auditPaper(file);
    results.push(result);

    if (result.isOrphan) orphans++;
    if (result.issues.some(i => i.startsWith('invalid-ref'))) invalidRefs++;
    if (result.issues.some(i => i.startsWith('invalid-tier'))) badTier++;
    if (result.issues.some(i => i.startsWith('invalid-milestone'))) badMilestone++;

    // --fix 模式:给 orphan 加 is_orphan: true
    if (opts.fix && result.isOrphan) {
      if (addOrphanFlag(file)) {
        fixed++;
        if (opts.check) {
          console.log(`  [fixed] ${result.path}`);
        }
      }
    }
  }

  const papersWithLinks = processed - orphans;
  const failed = orphans + invalidRefs + badTier + badMilestone;

  // 输出报告
  if (opts.json) {
    const report = {
      papers_total: processed,
      papers_with_links: papersWithLinks,
      orphans,
      invalid_refs: invalidRefs,
      bad_tier: badTier,
      bad_milestone: badMilestone,
      summary: failed > 0 ? 'FAILED' : 'PASSED',
      details: results.filter(r => r.issues.length > 0).map(r => ({
        path: r.path,
        issues: r.issues,
      })),
    };
    console.log(JSON.stringify(report, null, 2));
  } else if (opts.check) {
    console.log(`\n[audit-crosslinks] === summary ===`);
    console.log(`  papers_total: ${processed}`);
    console.log(`  papers_with_links: ${papersWithLinks}`);
    console.log(`  orphans: ${orphans}`);
    console.log(`  invalid_refs: ${invalidRefs}`);
    console.log(`  bad_tier: ${badTier}`);
    console.log(`  bad_milestone: ${badMilestone}`);
    if (opts.fix) {
      console.log(`  fixed: ${fixed}`);
    }

    if (failed > 0) {
      console.log(`\n  failed papers:`);
      for (const r of results) {
        if (r.issues.length > 0) {
          console.log(`    ${r.path}: ${r.issues.join(', ')}`);
        }
      }
    }
  }

  // exit code
  if (opts.ci && failed > 0) {
    process.exit(1);
  }
}

// 只在直接作为 CLI 调用时跑 main();被 test 导入时不跑。
const isCLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCLI) {
  main();
}
