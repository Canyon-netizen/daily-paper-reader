#!/usr/bin/env node
// astro-src/scripts/paper-mark-milestones.mjs
//
// 启发式标记论文是否为里程碑(is_milestone)。
// 不依赖 LLM,纯本地启发。
// 判定规则: 引用数 >= N (默认 5) 或在白名单中
//
// 用法:
//   node astro-src/scripts/paper-mark-milestones.mjs --check --limit 10
//   node astro-src/scripts/paper-mark-milestones.mjs --check --threshold 0.6
//   node astro-src/scripts/paper-mark-milestones.mjs --apply --threshold 0.6
//   node astro-src/scripts/paper-mark-milestones.mjs --apply --all
//   node astro-src/scripts/paper-mark-milestones.mjs --apply --threshold 5 (use citation count)

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const PAPERS_ROOT = 'docs/papers';
const WHITELIST_PATH = 'docs/library/milestone-whitelist.md';
const CURRENT_YEAR = 2026;

const TOP_VENUES = ['NeurIPS', 'ICML', 'ICLR', 'ACL', 'CVPR', 'ICCV', 'ECCV'];
const BREAKTHROUGH_KEYWORDS = ['first', 'novel', 'breakthrough', 'pioneer', 'introducing', 'revolutionary', 'paradigm shift'];
const HIGH_RESOURCE_TIERS = ['frontier', 'large'];
const DEFAULT_CITATION_THRESHOLD = 5;

/** 解析 CLI 参数 */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { check: false, apply: false, limit: 0, threshold: 0.6, citationThreshold: DEFAULT_CITATION_THRESHOLD, useCitationThreshold: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--check') opts.check = true;
    else if (a === '--apply') opts.apply = true;
    else if (a === '--all') opts.limit = 0;
    else if (a.startsWith('--limit=')) opts.limit = parseInt(a.split('=')[1], 10) || 0;
    else if (a === '--limit') opts.limit = parseInt(args[++i], 10) || 0;
    else if (a.startsWith('--threshold=')) {
      const val = parseFloat(a.split('=')[1]);
      if (val >= 1) {
        // >= 1 means use as citation threshold directly
        opts.citationThreshold = val;
        opts.useCitationThreshold = true;
      } else {
        opts.threshold = val || 0.6;
      }
    }
    else if (a === '--threshold') {
      const val = parseFloat(args[++i]);
      if (val >= 1) {
        opts.citationThreshold = val;
        opts.useCitationThreshold = true;
      } else {
        opts.threshold = val || 0.6;
      }
    }
    else if (a === '--help' || a === '-h') {
      console.log(`用法:
  --check              显示推断结果,不写文件
  --apply              写入 is_milestone: true
  --limit N            仅处理前 N 篇
  --threshold 0.6     启发分数阈值(default 0.6)
  --threshold N        N >= 1 时视为引用数阈值(default 5)
  --all                处理全部(与 --limit 0 等效)`);
      process.exit(0);
    }
  }
  if (!opts.check && !opts.apply) opts.check = true;
  return opts;
}

/** 读取白名单文件,返回 { arxiv_id: reason } */
function loadWhitelist() {
  const out = {};
  if (!existsSync(WHITELIST_PATH)) return out;
  try {
    const raw = readFileSync(WHITELIST_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const commaIdx = trimmed.indexOf(',');
      if (commaIdx === -1) continue;
      const id = trimmed.slice(0, commaIdx).trim();
      const reason = trimmed.slice(commaIdx + 1).trim();
      if (id) out[id] = reason;
    }
  } catch (e) {
    console.warn(`[warn] fail load whitelist: ${e.message}`);
  }
  return out;
}

/** 提取 raw frontmatter + body */
function extractFrontmatter(raw) {
  const m = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: '', body: raw };
  return { fm: m[1], body: raw.slice(m[0].length) };
}

/** 从 frontmatter 提取 is_milestone */
function readIsMilestone(fm) {
  const m = fm.match(/^\s*is_milestone:\s*(.+)$/m);
  if (!m) return null;
  const val = m[1].trim().toLowerCase();
  return val === 'true' || val === 'yes' || val === '1';
}

/** 从 frontmatter 提取 score - 支持带空格格式 */
function readScore(fm) {
  const m = fm.match(/^\s*score:\s*(.+)$/m);
  if (!m) return null;
  return parseFloat(m[1]);
}

/** 从 frontmatter 提取 date */
function readDate(fm) {
  const m = fm.match(/^\s*date:\s*(\d{4}-\d{2}-\d{2})/m);
  if (!m) return null;
  return m[1];
}

/** 从 frontmatter 提取 title */
function readTitle(fm) {
  const m = fm.match(/^\s*title:\s*(.+)$/m);
  if (!m) return '';
  return m[1].replace(/^['"]|['"]$/g, '').trim();
}

/** 从 frontmatter 提取 categories.venue - 支持 YAML 块格式和行内格式 */
function readVenue(fm) {
  // 行内格式: categories: { venue: [], task: [], method: [], type: [] }
  const inlineMatch = fm.match(/categories:\s*\{[^}]*venue:\s*\[([^\]]*)\]/);
  if (inlineMatch) {
    return inlineMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  // 块格式
  const m = fm.match(/^\s*categories:\s*\r?\n((?:[ \t]+[^\r\n]+\r?\n)*)/m);
  if (!m) return [];
  const block = m[1];
  const venueMatch = block.match(/^\s*venue:\s*\[([^\]]*)\]/m);
  if (venueMatch) {
    return venueMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  // list form
  const venueList = [];
  for (const line of block.split('\n')) {
    const vm = line.match(/^\s+-venue:\s*(.+)/);
    if (vm) venueList.push(vm[1].trim());
  }
  return venueList;
}

/** 从 frontmatter 提取 resource_tier */
function readResourceTier(fm) {
  const m = fm.match(/^\s*resource_tier:\s*(.+)$/m);
  if (!m) return null;
  return m[1].trim().replace(/^['"]|['"]$/g, '');
}

/** 启发式计算里程碑分数 */
function computeMilestoneScore(fm) {
  let score = 0;
  const reasons = [];

  const paperScore = readScore(fm);
  // score 存储为 0-10 小数, 0.85 表示 8.5 分
  if (paperScore !== null && paperScore >= 0.85) {
    score += 0.4;
    reasons.push(`score=${paperScore}>=0.85 (+0.4)`);
  }

  const venue = readVenue(fm);
  const topVenueCount = venue.filter(v => TOP_VENUES.includes(v)).length;
  if (topVenueCount > 0) {
    score += Math.min(0.25, topVenueCount * 0.1);
    reasons.push(`top-venue x${topVenueCount} (+${Math.min(0.25, topVenueCount * 0.1).toFixed(2)})`);
  }

  const date = readDate(fm);
  if (date) {
    const year = parseInt(date.slice(0, 4), 10);
    if (year < CURRENT_YEAR) {
      score += 0.15;
      reasons.push(`year=${year}<${CURRENT_YEAR} (+0.15)`);
    }
  }

  const title = readTitle(fm);
  const lowerTitle = title.toLowerCase();
  const keywordMatches = BREAKTHROUGH_KEYWORDS.filter(kw => lowerTitle.includes(kw));
  if (keywordMatches.length > 0) {
    score += 0.2;
    reasons.push(`keyword=${keywordMatches.join('/')} (+0.2)`);
  }

  // resource_tier 加分: frontier/large 表示大模型实验,更有可能是里程碑
  const tier = readResourceTier(fm);
  if (tier && HIGH_RESOURCE_TIERS.includes(tier)) {
    score += 0.2;
    reasons.push(`resource_tier=${tier} (+0.2)`);
  }

  return { total: Math.min(1, score), reasons: reasons.join('; ') };
}

/** 替换 is_milestone 字段 */
function replaceIsMilestone(raw, value) {
  const fmEndMatch = raw.match(/\r?\n---/);
  if (!fmEndMatch) return raw;

  const fmEnd = fmEndMatch.index;
  const before = raw.slice(0, fmEnd);
  const after = raw.slice(fmEnd);

  // 检查是否已有 is_milestone 字段
  const hasField = /^\s*is_milestone:\s*/m.test(before);
  if (hasField) {
    // 替换现有值
    return raw.replace(/^\s*is_milestone:\s*.+$/m, `is_milestone: ${value}`);
  } else {
    // 在 frontmatter 末尾添加
    return before + `\nis_milestone: ${value}` + after;
  }
}

/** 遍历论文文件 */
function walkPapers(root) {
  const out = [];
  function rec(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name === 'assets') continue;
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

/** 从文件路径提取 arxiv ID */
function extractArxivId(file) {
  const name = file.split(/[/\\]/).pop(); // e.g. 2301.12345-title.md
  const m = name.match(/^(\d{4}\.\d{4,5})(?:v\d+)?-/);
  return m ? m[1] : null;
}

function main() {
  const opts = parseArgs();
  const mode = opts.apply ? 'apply' : 'check';
  console.log(`[paper-mark-milestones] mode=${mode} threshold=${opts.threshold} limit=${opts.limit || 'all'}`);

  const whitelist = loadWhitelist();
  if (Object.keys(whitelist).length > 0) {
    console.log(`[paper-mark-milestones] loaded ${Object.keys(whitelist).length} whitelist entries`);
  }

  const all = walkPapers(PAPERS_ROOT);
  console.log(`[paper-mark-milestones] found ${all.length} papers\n`);

  let processed = 0, marked = 0, skipped = 0, errors = 0;
  const results = [];

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

    const { fm } = extractFrontmatter(raw);
    if (!fm) {
      errors++;
      continue;
    }

    const arxivId = extractArxivId(file);
    const currentMilestone = readIsMilestone(fm);

    // 白名单优先
    if (whitelist[arxivId]) {
      if (opts.apply && !currentMilestone) {
        const newRaw = replaceIsMilestone(raw, true);
        try {
          writeFileSync(file, newRaw, 'utf8');
          marked++;
          results.push({ file: relative(PAPERS_ROOT, file), status: 'whitelisted', reason: whitelist[arxivId] });
        } catch (e) {
          errors++;
        }
      } else {
        marked++;
        results.push({ file: relative(PAPERS_ROOT, file), status: 'whitelisted', reason: whitelist[arxivId] });
      }
      continue;
    }

    // 已标记的跳过
    if (currentMilestone === true) {
      skipped++;
      continue;
    }

    // 启发式计算
    const { total, reasons } = computeMilestoneScore(fm);
    const isMilestone = total >= opts.threshold;

    if (opts.check) {
      results.push({
        file: relative(PAPERS_ROOT, file),
        score: total.toFixed(2),
        isMilestone,
        reasons: reasons || '(no signal)',
      });
    } else if (opts.apply && isMilestone) {
      const newRaw = replaceIsMilestone(raw, true);
      try {
        writeFileSync(file, newRaw, 'utf8');
        marked++;
        results.push({ file: relative(PAPERS_ROOT, file), status: 'marked', score: total.toFixed(2), reasons });
      } catch (e) {
        errors++;
      }
    } else {
      if (!isMilestone) skipped++;
    }
  }

  // 输出
  console.log(`\n=== summary ===`);
  console.log(`  processed: ${processed}`);
  console.log(`  ${opts.apply ? 'marked' : 'would mark'}: ${marked}`);
  console.log(`  skipped: ${skipped}`);
  console.log(`  errors: ${errors}`);

  if (opts.check && results.length > 0) {
    console.log(`\n=== results (first 20) ===`);
    for (const r of results.slice(0, 20)) {
      if (r.status === 'whitelisted') {
        console.log(`  [whitelist] ${r.file} → ${r.reason}`);
      } else {
        console.log(`  ${r.file} score=${r.score} milestone=${r.isMilestone} ${r.reasons}`);
      }
    }
  } else if (opts.apply && results.length > 0) {
    console.log(`\n=== marked (first 20) ===`);
    for (const r of results.slice(0, 20)) {
      console.log(`  ${r.file} ${r.score ? `score=${r.score}` : ''} ${r.reason || r.reasons || ''}`);
    }
  }
}

main();
