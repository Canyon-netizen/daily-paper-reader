#!/usr/bin/env node
// astro-src/scripts/paper-backfill-categories.mjs
//
// 启发式批量回填论文 frontmatter 的 categories 字段(2026-09-14 论文 audit P0-1)。
//
// 问题:1153 篇论文的 categories: { venue:[], task:[], method:[], type:[] } 全部为空,
//       导致无法按 venue/task/method/type 筛选。
//
// 设计(v2 - 2026-09-14 修):
//   - 用 regex 直接替换 categories 块,**不动其他 YAML**(避免 gray-matter 重序列化)
//   - CRLF-tolerant(Windows 文件 \r\n)
//   - 已填的不覆盖(用 --force 可强制)
//   - 支持 --limit N 和 --limit=N 两种语法
//
// 用法:
//   node astro-src/scripts/paper-backfill-categories.mjs --dry-run --limit 10
//   node astro-src/scripts/paper-backfill-categories.mjs --apply --limit 10
//   node astro-src/scripts/paper-backfill-categories.mjs --apply --all

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const PAPERS_ROOT = 'docs/papers';

const METHOD_KEYWORDS = [
  'self-distillation', 'self-distill', 'rlhf', 'dpo', 'ppo', 'mcts',
  'world-model', 'rag', 'chain-of-thought', 'cot', 'mamba', 'ssm',
  'constitutional-ai', 'mechanistic-interpretability', 'circuit-analysis',
  'diffusion', 'flow-matching', 'steering', 'sparse-autoencoder',
  'multi-agent', 'agent', 'tool-use', 'function-calling',
  'reinforcement-learning', 'rl', 'llm', 'language-model',
  'transformer', 'attention', 'long-context', 'prompt',
  'embedding', 'retrieval', 'compression', 'quantization',
  'fine-tuning', 'distillation', 'pruning',
];

const TYPE_PATTERNS = [
  { type: 'survey', match: /\b(survey|review|tutorial|overview)\b/i },
  { type: 'benchmark', match: /\b(benchmark|dataset|corpus|evaluation suite)\b/i },
  { type: 'theoretical', match: /\b(theoretical|proof|theorem|convergence|complexity bound|theory)\b/i },
  { type: 'empirical', match: /\b(experiment|empirical|benchmark result|ablation)\b/i },
  { type: 'analysis', match: /\b(analysis|investigation|understanding|study)\b/i },
  { type: 'reproducibility', match: /\b(reproducibility|replication|reproduce)\b/i },
];

const VENUE_PATTERNS = [
  { venue: 'ICLR', match: /\bICLR\b/i },
  { venue: 'NeurIPS', match: /\bNeurIPS\b/i },
  { venue: 'ICML', match: /\bICML\b/i },
  { venue: 'ACL', match: /\bACL\b/i },
  { venue: 'EMNLP', match: /\bEMNLP\b/i },
  { venue: 'CVPR', match: /\bCVPR\b/i },
  { venue: 'ECCV', match: /\bECCV\b/i },
  { venue: 'ICCV', match: /\bICCV\b/i },
  { venue: 'AAAI', match: /\bAAAI\b/i },
  { venue: 'IJCAI', match: /\bIJCAI\b/i },
  { venue: 'TMLR', match: /\bTMLR\b/i },
  { venue: 'JMLR', match: /\bJMLR\b/i },
  { venue: 'Nature', match: /\bNature\b/i },
  { venue: 'Science', match: /\bScience\b/i },
];

/** 从 raw frontmatter + body 派生 categories 4 个字段。
 *  v2 行为:**与现有值合并**(union),不覆盖已有 items。已填的 key 直接保留。 */
function inferCategories(rawFm, body, current) {
  // 提取 title, tags 用 regex(不解析 YAML,保持鲁棒)
  const titleMatch = rawFm.match(/^title:\s*(.+?)$/m);
  const title = titleMatch ? titleMatch[1].replace(/^['"]|['"]$/g, '').trim() : '';

  const tagsBlock = rawFm.match(/^tags:\s*\[([^\]]*)\]/m);
  const tags = tagsBlock ? tagsBlock[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')) : [];

  const haystack = `${title}\n${body.slice(0, 1500)}`;

  // task: 现有值 + tags(query:xxx) + 关键词
  const task = new Set(current.task || []);
  for (const tag of tags) {
    const m = tag.match(/^query:(.+)$/i);
    if (m) task.add(m[1]);
  }
  for (const kw of ['game-ai', 'rlhf', 'multi-agent', 'llm-agent', 'rag', 'world-model']) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(haystack)) task.add(kw);
  }

  // method: 现有值 + METHOD_KEYWORDS
  const method = new Set(current.method || []);
  for (const kw of METHOD_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(haystack)) method.add(kw);
  }

  // type: 现有值 + 启发;有的话不覆盖,否则启发
  const type = new Set(current.type || []);
  if (type.size === 0) {
    for (const { type: t, match } of TYPE_PATTERNS) {
      if (match.test(haystack)) {
        type.add(t);
        break;
      }
    }
    if (type.size === 0) type.add('empirical');
  }

  // venue: 现有值 + 启发
  const venue = new Set(current.venue || []);
  for (const { venue: v, match } of VENUE_PATTERNS) {
    if (match.test(haystack)) venue.add(v);
  }

  return {
    venue: [...venue].slice(0, 6),
    task: [...task].slice(0, 8),
    method: [...method].slice(0, 8),
    type: [...type].slice(0, 3),
  };
}

/** 提取 raw frontmatter(--- ... ---之间的内容,不含 fence)。
 *  CRLF-tolerant。 */
function extractFrontmatter(raw) {
  const m = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: '', body: raw };
  return { fm: m[1], body: raw.slice(m[0].length) };
}

/** 从 raw frontmatter 提取 categories 块内容(每个 key 的 list)。CRLF-tolerant。 */
function readCategories(fm) {
  const out = { venue: [], task: [], method: [], type: [] };
  for (const key of ['venue', 'task', 'method', 'type']) {
    const reBracket = new RegExp(`^\\s+${key}:\\s*\\[([^\\]]*)\\]`, 'm');
    const m1 = fm.match(reBracket);
    if (m1) {
      out[key] = m1[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      continue;
    }
    const reList = new RegExp(`^\\s+${key}:[ \\t]*\\r?\\n((?:\\s+-\\s+.+(?:\\r?\\n|$))+)`, 'm');
    const m2 = fm.match(reList);
    if (m2) {
      out[key] = m2[1].split(/\r?\n/).map((s) => s.replace(/^\s+-\s+/, '').trim()).filter(Boolean);
    }
  }
  return out;
}

function needsUpdate(cats) {
  return !cats.venue?.length || !cats.task?.length || !cats.method?.length || !cats.type?.length;
}

function renderCategoriesBlock(cats) {
  return `categories:\n${renderList('venue', cats.venue)}${renderList('task', cats.task)}${renderList('method', cats.method)}${renderList('type', cats.type)}`;
}

function renderList(key, items) {
  if (items.length === 0) return `  ${key}: []\n`;
  return `  ${key}:\n${items.map((it) => `    - ${it}`).join('\n')}\n`;
}

/** 用 regex 找并替换 categories 块(不重序列化其他 YAML)。CRLF-tolerant。
 *  categories 块结构:
 *    categories:
 *      venue: []        ← inline form
 *    或
 *      task:
 *        - item1        ← list form
 *    块结束:下一个非缩进的 top-level field,或 frontmatter 结束的 ---。 */
function replaceCategoriesBlock(raw, newCats) {
  // 找 `categories:` 之后的所有缩进行,直到下一个非缩进行(top-level field 或 ---)
  const re = /categories:[ \t]*\r?\n((?:[ \t]+.+(?:\r?\n|$))+)/;
  const m = raw.match(re);
  if (!m) {
    // 没有 categories 块,在 frontmatter 末尾加一个
    const fmEndMatch = raw.match(/\r?\n---/);
    if (fmEndMatch) {
      const fmEnd = fmEndMatch.index;
      return raw.slice(0, fmEnd) + '\n' + renderCategoriesBlock(newCats) + raw.slice(fmEnd);
    }
    return raw;
  }
  // 找到完整 categories 块(包含 categories: 行),替换之
  return raw.slice(0, m.index) + renderCategoriesBlock(newCats) + raw.slice(m.index + m[0].length);
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
  const opts = { dryRun: false, apply: false, limit: 0, force: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--apply') opts.apply = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--all') opts.limit = 0;
    else if (a.startsWith('--limit=')) opts.limit = parseInt(a.split('=')[1], 10) || 0;
    else if (a === '--limit') opts.limit = parseInt(args[++i], 10) || 0;
    else if (a === '--help' || a === '-h') {
      console.log('用法: --dry-run | --apply | --limit N | --all | --force');
      process.exit(0);
    }
  }
  if (!opts.dryRun && !opts.apply) opts.dryRun = true;
  return opts;
}

function main() {
  const opts = parseArgs();
  console.log(`[paper-backfill-categories v2] mode=${opts.apply ? 'apply' : 'dry-run'} ${opts.force ? '(force)' : '(skip already-filled)'} limit=${opts.limit || 'all'}`);

  const all = walkPapers(PAPERS_ROOT);
  console.log(`[paper-backfill-categories v2] found ${all.length} papers`);

  let processed = 0, updated = 0, skipped = 0, errors = 0;
  const sample = [];

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

    const current = readCategories(fm);
    const inferred = inferCategories(fm, body, current);

    if (!needsUpdate(current) && !opts.force) {
      skipped++;
      continue;
    }

    if (opts.apply) {
      const newRaw = replaceCategoriesBlock(raw, inferred);
      if (newRaw !== raw) {
        try {
          writeFileSync(file, newRaw, 'utf8');
          updated++;
          if (sample.length < 5) {
            sample.push({ file: relative(PAPERS_ROOT, file), cats: inferred });
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
        sample.push({ file: relative(PAPERS_ROOT, file), before: current, after: inferred });
      }
    }
  }

  console.log(`\n[paper-backfill-categories v2] === summary ===`);
  console.log(`  processed: ${processed}`);
  console.log(`  ${opts.apply ? 'updated' : 'would update'}: ${updated}`);
  console.log(`  skipped (already filled): ${skipped}`);
  console.log(`  errors: ${errors}`);
  if (sample.length > 0) {
    console.log(`\n  sample (first 5):`);
    for (const s of sample) {
      console.log(`    ${s.file}`);
      if (opts.apply) {
        console.log(`      → cats: ${JSON.stringify(s.cats)}`);
      } else {
        console.log(`      before: ${JSON.stringify(s.before)}`);
        console.log(`      after:  ${JSON.stringify(s.after)}`);
      }
    }
  }
}

main();