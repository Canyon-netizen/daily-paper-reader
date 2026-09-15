#!/usr/bin/env node
// astro-src/scripts/paper-compute-resource-tier.mjs
//
// 启发式批量回填论文 frontmatter 的 resource_tier 字段。
//
// 问题:大量论文缺少 resource_tier,无法按算力需求筛选。
//
// 设计:
//   - 用 regex 直接替换 resource_tier 行,**不动其他 YAML**
//   - CRLF-tolerant(Windows 文件 \r\n)
//   - 支持 --dry-run / --apply / --limit N / --all
//   - 启发式规则,不用 LLM
//
// 用法:
//   node astro-src/scripts/paper-compute-resource-tier.mjs --dry-run --limit 10
//   node astro-src/scripts/paper-compute-resource-tier.mjs --apply --limit 10
//   node astro-src/scripts/paper-compute-resource-tier.mjs --apply --all

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const PAPERS_ROOT = 'docs/papers';

// 启发式规则:从 title + abstract 推断 resource_tier
const TIER_PATTERNS = {
  xlarge: [
    // title patterns
    /\b(70B|80B|100B|175B|540B|Trillion)\b/i,
    /\b(gpt-4|gpt4|gemini-ultra|palm-e|palm-2)\b/i,
    /\b(thousands of GPUs?|massive scale|large-scale training)\b/i,
    // abstract patterns
    /\b(thousands of GPU|distributed training|multi-node|cluster)\b/i,
  ],
  large: [
    // title patterns
    /\b(large language model|LLM|GPT-3|gpt-3|PaLM|moe|mix-of-expert)\b/i,
    /\b(8B|13B|30B|34B|40B|65B|70B)\b/i,
    // abstract patterns
    /\b(multiple GPUs?|8 GPU|16 GPU|distributed|thousands of GPU)\b/i,
  ],
  medium: [
    // title patterns
    /\b(7B|6B|3B|2B|1B)\b/i,
    /\b(LLaMA|Llama|Vicuna|Mistral|Qwen|Baichuan)\b/i,
    // abstract patterns
    /\b(single GPU|one GPU|4 GPU|8 GPU|multi-GPU)\b/i,
  ],
  small: [
    // title patterns
    /\b(toy|small-scale|small model|lightweight|efficient)\b/i,
    // abstract patterns
    /\b(single GPU|toy|demo|sample|small-scale|one GPU)\b/i,
  ],
};

/** 从 raw frontmatter + body 推断 resource_tier。 */
function inferResourceTier(rawFm, body) {
  const titleMatch = rawFm.match(/^title:\s*(.+?)$/m);
  const title = titleMatch ? titleMatch[1].replace(/^['"]|['"]$/g, '').trim() : '';

  // 优先检查 xlarge(最大算力)
  for (const pattern of TIER_PATTERNS.xlarge) {
    if (pattern.test(title) || pattern.test(body.slice(0, 2000))) {
      return 'xlarge';
    }
  }
  // 再检查 large
  for (const pattern of TIER_PATTERNS.large) {
    if (pattern.test(title) || pattern.test(body.slice(0, 2000))) {
      return 'large';
    }
  }
  // 再检查 small(显式提到小规模)
  for (const pattern of TIER_PATTERNS.small) {
    if (pattern.test(title) || pattern.test(body.slice(0, 2000))) {
      return 'small';
    }
  }
  // 默认 medium(7B 左右是最常见的中等规模)
  for (const pattern of TIER_PATTERNS.medium) {
    if (pattern.test(title) || pattern.test(body.slice(0, 2000))) {
      return 'medium';
    }
  }
  // 如果没有任何匹配,默认 medium
  return 'medium';
}

/** 提取 raw frontmatter(--- ... ---之间的内容,不含 fence)。
 *  CRLF-tolerant。 */
function extractFrontmatter(raw) {
  const m = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: '', body: raw };
  return { fm: m[1], body: raw.slice(m[0].length) };
}

/** 从 raw frontmatter 读取当前的 resource_tier 值。 */
function readResourceTier(fm) {
  const m = fm.match(/^resource_tier:\s*(.*?)$/m);
  if (!m) return '';
  return m[1].replace(/^['"]|['"]$/g, '').trim();
}

/** 用 regex 替换 resource_tier 行。CRLF-tolerant。
 *  如果没有 resource_tier 行,在 frontmatter 末尾添加。 */
function replaceResourceTier(raw, newTier) {
  const re = /^(resource_tier:\s*.*)$/m;
  const m = raw.match(re);
  if (m) {
    // 已有 resource_tier,替换值
    return raw.replace(re, `resource_tier: ${newTier}`);
  }
  // 没有 resource_tier,在 frontmatter 末尾添加
  const fmEndMatch = raw.match(/\r?\n---/);
  if (fmEndMatch) {
    const fmEnd = fmEndMatch.index;
    return raw.slice(0, fmEnd) + `\nresource_tier: ${newTier}` + raw.slice(fmEnd);
  }
  return raw;
}

function needsUpdate(currentTier) {
  return !currentTier || !['small', 'medium', 'large', 'xlarge'].includes(currentTier);
}

function walkPapers(root) {
  const out = [];
  function rec(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name === 'assets') continue;
      // 跳过 topic-seeds 主题种子文件(不是论文)
      if (entry.isFile() && entry.name.startsWith('topic-seeds-')) continue;
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
  const opts = { dryRun: false, apply: false, limit: 0 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--apply') opts.apply = true;
    else if (a === '--all') opts.limit = 0;
    else if (a.startsWith('--limit=')) opts.limit = parseInt(a.split('=')[1], 10) || 0;
    else if (a === '--limit') opts.limit = parseInt(args[++i], 10) || 0;
    else if (a === '--help' || a === '-h') {
      console.log('用法: --dry-run | --apply | --limit N | --all');
      process.exit(0);
    }
  }
  if (!opts.dryRun && !opts.apply) opts.dryRun = true;
  return opts;
}

function main() {
  const opts = parseArgs();
  console.log(`[paper-compute-resource-tier] mode=${opts.apply ? 'apply' : 'dry-run'} limit=${opts.limit || 'all'}`);

  const all = walkPapers(PAPERS_ROOT);
  console.log(`[paper-compute-resource-tier] found ${all.length} papers`);

  let processed = 0, updated = 0, skipped = 0, errors = 0;
  const sample = [];
  const tierCounts = { small: 0, medium: 0, large: 0, xlarge: 0 };

  for (const file of all) {
    if (opts.limit && processed >= opts.limit) break;
    processed++;
    let raw;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (e) {
      errors++;
      continue;
    }
    const { fm, body } = extractFrontmatter(raw);
    if (!fm) {
      errors++;
      continue;
    }

    const currentTier = readResourceTier(fm);
    const inferredTier = inferResourceTier(fm, body);

    tierCounts[inferredTier] = (tierCounts[inferredTier] || 0) + 1;

    if (!needsUpdate(currentTier)) {
      skipped++;
      continue;
    }

    if (opts.apply) {
      const newRaw = replaceResourceTier(raw, inferredTier);
      if (newRaw !== raw) {
        try {
          writeFileSync(file, newRaw, 'utf8');
          updated++;
          if (sample.length < 5) {
            sample.push({ file: relative(PAPERS_ROOT, file), tier: inferredTier });
          }
        } catch (e) {
          errors++;
          console.warn(`  [skip write error] ${file}: ${e.message}`);
        }
      } else {
        skipped++;
      }
    } else {
      updated++;
      if (sample.length < 5) {
        sample.push({ file: relative(PAPERS_ROOT, file), current: currentTier, inferred: inferredTier });
      }
    }
  }

  console.log(`\n[paper-compute-resource-tier] === summary ===`);
  console.log(`  processed: ${processed}`);
  console.log(`  ${opts.apply ? 'updated' : 'would update'}: ${updated}`);
  console.log(`  skipped (already filled): ${skipped}`);
  console.log(`  errors: ${errors}`);
  console.log(`\n  tier distribution:`);
  console.log(`    small:   ${tierCounts.small}`);
  console.log(`    medium:  ${tierCounts.medium}`);
  console.log(`    large:   ${tierCounts.large}`);
  console.log(`    xlarge:  ${tierCounts.xlarge}`);
  if (sample.length > 0) {
    console.log(`\n  sample (first 5):`);
    for (const s of sample) {
      console.log(`    ${s.file}`);
      if (opts.apply) {
        console.log(`      → tier: ${s.tier}`);
      } else {
        console.log(`      current: "${s.current}" → inferred: ${s.inferred}`);
      }
    }
  }
}

main();
