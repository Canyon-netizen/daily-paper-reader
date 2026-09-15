#!/usr/bin/env node
// astro-src/scripts/paper-backfill-crosslinks.mjs
//
// 启发式批量回填论文 frontmatter 的 related_ideas / related_experiments 字段。
//
// 问题:大量论文缺少 related_ideas / related_experiments 跨模块链接。
//
// 设计:
//   - 启发式匹配: tags → ideas/experiments, keyword overlap
//   - LLM fallback (可选): 需要 LLM_BASE_URL 环境变量
//   - 与现有值合并(union),去重
//   - CLI: --dry-run, --apply, --limit N, --all, --use-llm
//
// 用法:
//   node astro-src/scripts/paper-backfill-crosslinks.mjs --dry-run --limit 10
//   node astro-src/scripts/paper-backfill-crosslinks.mjs --apply --limit 10
//   node astro-src/scripts/paper-backfill-crosslinks.mjs --apply --all --use-llm

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const PAPERS_ROOT = 'docs/papers';
const IDEAS_ROOT = 'docs/ideas';
const EXPERIMENTS_ROOT = 'docs/experiments';

// ========== 1. 加载 ideas / experiments 索引 ==========

function loadIdeas() {
  const out = [];
  try {
    for (const f of readdirSync(IDEAS_ROOT, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith('.md')) continue;
      const p = join(IDEAS_ROOT, f.name);
      const raw = readFileSync(p, 'utf8');
      const { fm } = extractFrontmatter(raw);
      const titleMatch = fm.match(/^title:\s*(.+?)$/m);
      const title = titleMatch ? titleMatch[1].replace(/^['"]|['"]$/g, '').trim() : '';
      const id = f.name.replace(/\.md$/, '');
      out.push({ id, path: `docs/ideas/${f.name}`, title, keywords: extractKeywords(title) });
    }
  } catch (e) {
    console.warn(`[loadIdeas] skip: ${e.message}`);
  }
  return out;
}

function loadExperiments() {
  const out = [];
  try {
    for (const f of readdirSync(EXPERIMENTS_ROOT, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith('.md')) continue;
      const p = join(EXPERIMENTS_ROOT, f.name);
      const raw = readFileSync(p, 'utf8');
      const { fm } = extractFrontmatter(raw);
      const titleMatch = fm.match(/^title:\s*(.+?)$/m);
      const title = titleMatch ? titleMatch[1].replace(/^['"]|['"]$/g, '').trim() : '';
      const id = f.name.replace(/\.md$/, '');
      out.push({ id, path: `docs/experiments/${f.name}`, title, keywords: extractKeywords(title) });
    }
  } catch (e) {
    console.warn(`[loadExperiments] skip: ${e.message}`);
  }
  return out;
}

// ========== 2. 关键词提取 ==========

function extractKeywords(text) {
  if (!text) return [];
  // 提取英文单词 + 常见复合词,转小写
  const words = text.toLowerCase()
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'from', 'using', 'based', 'approach', 'method'].includes(w));
  return [...new Set(words)];
}

// ========== 3. 启发式匹配 ==========

/** 从 paper frontmatter 提取 title, tags, abstract */
function extractPaperMeta(fm, body) {
  const titleMatch = fm.match(/^title:\s*(.+?)$/m);
  const title = titleMatch ? titleMatch[1].replace(/^['"]|['"]$/g, '').trim() : '';

  const tagsBlock = fm.match(/^tags:\s*\[([^\]]*)\]/m);
  const tags = tagsBlock ? tagsBlock[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')) : [];

  // 去掉 query: 前缀
  const searchTags = tags.map(t => t.replace(/^query:/i, '')).filter(Boolean);

  const abstractMatch = fm.match(/^abstract_en:\s*(.+?)$/m);
  const abstract = abstractMatch ? abstractMatch[1].replace(/^['"]|['"]$/g, '').trim() : '';

  return { title, tags: searchTags, abstract, keywords: extractKeywords(title + ' ' + abstract) };
}

/** 启发式匹配 ideas */
function matchIdeas(paperMeta, ideas) {
  const matched = new Set();
  const paperKw = new Set(paperMeta.keywords);

  for (const idea of ideas) {
    // 1. tag overlap
    for (const tag of paperMeta.tags) {
      if (idea.title.toLowerCase().includes(tag.toLowerCase()) ||
          idea.id.toLowerCase().includes(tag.toLowerCase())) {
        matched.add(idea.path);
      }
    }
    // 2. keyword overlap
    for (const kw of idea.keywords) {
      if (paperKw.has(kw) && kw.length > 3) {
        matched.add(idea.path);
      }
    }
  }
  return [...matched];
}

/** 启发式匹配 experiments */
function matchExperiments(paperMeta, experiments) {
  const matched = new Set();
  const paperKw = new Set(paperMeta.keywords);

  for (const exp of experiments) {
    // 1. tag overlap
    for (const tag of paperMeta.tags) {
      if (exp.title.toLowerCase().includes(tag.toLowerCase()) ||
          exp.id.toLowerCase().includes(tag.toLowerCase())) {
        matched.add(exp.path);
      }
    }
    // 2. keyword overlap
    for (const kw of exp.keywords) {
      if (paperKw.has(kw) && kw.length > 3) {
        matched.add(exp.path);
      }
    }
  }
  return [...matched];
}

// ========== 4. LLM fallback (可选) ==========

async function callLLMFallback(paperMeta, ideas, experiments) {
  const baseUrl = process.env.LLM_BASE_URL;
  if (!baseUrl) return null;

  const ideaSummaries = ideas.map(i => `  - ${i.id}: ${i.title}`).join('\n');
  const expSummaries = experiments.map(e => `  - ${e.id}: ${e.title}`).join('\n');

  const prompt = `You are a research assistant. Given a paper's metadata, recommend which ideas and experiments from the library are related.

Paper title: ${paperMeta.title}
Paper tags: ${paperMeta.tags.join(', ') || '(none)'}
Paper abstract: ${paperMeta.abstract.slice(0, 500)}

Available ideas:
${ideaSummaries}

Available experiments:
${expSummaries}

Respond with JSON only (no markdown):
{
  "related_ideas": ["docs/ideas/xxx.md", ...],
  "related_experiments": ["docs/experiments/yyy.md", ...]
}
Only include entries that are truly relevant. Return empty arrays if none.`;

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'default',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    });
    if (!res.ok) {
      console.warn(`[LLM] HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    // 尝试解析 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.warn(`[LLM] error: ${e.message}`);
  }
  return null;
}

// ========== 5. Frontmatter 处理 ==========

function extractFrontmatter(raw) {
  const m = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: '', body: raw };
  return { fm: m[1], body: raw.slice(m[0].length) };
}

function readCrosslinks(fm) {
  const out = { related_ideas: [], related_experiments: [], related_writings: [] };
  for (const key of ['related_ideas', 'related_experiments', 'related_writings']) {
    const reBracket = new RegExp(`^\\s+${key}:\\s*\\[([^\\]]*)\\]`, 'm');
    const m1 = fm.match(reBracket);
    if (m1 && m1[1].trim()) {
      out[key] = m1[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      continue;
    }
    const reList = new RegExp(`^\\s+${key}:[ \\t]*\\r?\\n((?:\\s+-\\s+.+(?:\\r?\\n|$))+)`, 'm');
    const m2 = fm.match(reList);
    if (m2) {
      out[key] = m2[1].split(/\r?\n/).map(s => s.replace(/^\s+-\s+/, '').trim()).filter(Boolean);
    }
  }
  return out;
}

function renderCrosslinksBlock(links) {
  return `related_ideas: [${links.related_ideas.map(p => `"${p}"`).join(', ')}]\nrelated_experiments: [${links.related_experiments.map(p => `"${p}"`).join(', ')}]\nrelated_writings: [${links.related_writings.map(p => `"${p}"`).join(', ')}]\n`;
}

function replaceCrosslinks(raw, newLinks) {
  const { fm, body } = extractFrontmatter(raw);
  // 检查是否已有 related_ 开头的字段
  const hasAny = /^\s+related_/.test(fm);
  if (!hasAny) {
    // 没有 related_ 字段,在 frontmatter 末尾添加
    return raw.replace(/(\n---[ \t]*\r?\n)/, `\n${renderCrosslinksBlock(newLinks)}$1`);
  }
  // 逐个替换
  let newFm = fm;
  for (const key of ['related_ideas', 'related_experiments', 'related_writings']) {
    const re = new RegExp(`^(\\s+${key}:\\s*\\[)([^\\]]*)(\\])`, 'm');
    const match = newFm.match(re);
    if (match) {
      const existing = match[2].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      const merged = [...new Set([...existing, ...newLinks[key]])];
      newFm = newFm.replace(re, `$1${merged.map(p => `"${p}"`).join(', ')}$3`);
    }
  }
  return raw.replace(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/, `---\n${newFm}---`);
}

// ========== 6. 文件遍历 ==========

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

// ========== 7. CLI 参数 ==========

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dryRun: false, apply: false, limit: 0, offset: 0, useLlm: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--apply') opts.apply = true;
    else if (a === '--use-llm') opts.useLlm = true;
    else if (a === '--all') opts.limit = 0;
    else if (a.startsWith('--limit=')) opts.limit = parseInt(a.split('=')[1], 10) || 0;
    else if (a === '--limit') opts.limit = parseInt(args[++i], 10) || 0;
    else if (a.startsWith('--offset=')) opts.offset = parseInt(a.split('=')[1], 10) || 0;
    else if (a === '--offset') opts.offset = parseInt(args[++i], 10) || 0;
    else if (a === '--help' || a === '-h') {
      console.log('用法: --dry-run | --apply | --limit N | --offset N | --all | --use-llm');
      process.exit(0);
    }
  }
  if (!opts.dryRun && !opts.apply) opts.dryRun = true;
  return opts;
}

// ========== 8. 主逻辑 ==========

async function main() {
  const opts = parseArgs();
  const mode = opts.apply ? 'apply' : 'dry-run';
  console.log(`[paper-backfill-crosslinks] mode=${mode} llm=${opts.useLlm} limit=${opts.limit || 'all'} offset=${opts.offset}`);

  // 加载 ideas / experiments 索引
  const ideas = loadIdeas();
  const experiments = loadExperiments();
  console.log(`[paper-backfill-crosslinks] loaded ${ideas.length} ideas, ${experiments.length} experiments`);

  const all = walkPapers(PAPERS_ROOT);
  console.log(`[paper-backfill-crosslinks] found ${all.length} papers`);

  let processed = 0, updated = 0, skipped = 0, errors = 0;
  const sample = [];

  for (const file of all) {
    if (opts.offset && processed < opts.offset) {
      processed++;
      continue;
    }
    if (opts.limit && processed >= opts.offset + opts.limit) break;
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

    const current = readCrosslinks(fm);
    const paperMeta = extractPaperMeta(fm, body);

    // 启发式匹配
    let inferredIdeas = matchIdeas(paperMeta, ideas);
    let inferredExps = matchExperiments(paperMeta, experiments);

    // LLM fallback (可选)
    if (opts.useLlm) {
      const llmResult = await callLLMFallback(paperMeta, ideas, experiments);
      if (llmResult) {
        // 验证路径存在
        for (const p of llmResult.related_ideas || []) {
          if (existsSync(p) && !inferredIdeas.includes(p)) inferredIdeas.push(p);
        }
        for (const p of llmResult.related_experiments || []) {
          if (existsSync(p) && !inferredExps.includes(p)) inferredExps.push(p);
        }
      }
    }

    // 合并已有 + 新推断
    const mergedIdeas = [...new Set([...current.related_ideas, ...inferredIdeas])];
    const mergedExps = [...new Set([...current.related_experiments, ...inferredExps])];

    // 检查是否需要更新
    const needsUpdate = mergedIdeas.length !== current.related_ideas.length ||
                        mergedExps.length !== current.related_experiments.length;

    if (!needsUpdate) {
      skipped++;
      continue;
    }

    const newLinks = {
      related_ideas: mergedIdeas,
      related_experiments: mergedExps,
      related_writings: current.related_writings,
    };

    if (opts.apply) {
      const newRaw = replaceCrosslinks(raw, newLinks);
      try {
        writeFileSync(file, newRaw, 'utf8');
        updated++;
        if (sample.length < 5) {
          sample.push({ file: relative(PAPERS_ROOT, file), links: newLinks });
        }
      } catch (e) {
        errors++;
        console.warn(`  [write error] ${file}: ${e.message}`);
      }
    } else {
      updated++;
      if (sample.length < 5) {
        sample.push({
          file: relative(PAPERS_ROOT, file),
          before: { ideas: current.related_ideas, exps: current.related_experiments },
          after: { ideas: mergedIdeas, exps: mergedExps },
        });
      }
    }
  }

  console.log(`\n[paper-backfill-crosslinks] === summary ===`);
  console.log(`  processed: ${processed}`);
  console.log(`  ${opts.apply ? 'updated' : 'would update'}: ${updated}`);
  console.log(`  skipped (no change): ${skipped}`);
  console.log(`  errors: ${errors}`);

  if (sample.length > 0) {
    console.log(`\n  sample (first 5):`);
    for (const s of sample) {
      console.log(`    ${s.file}`);
      if (opts.apply) {
        console.log(`      → ideas: ${s.links.related_ideas.length}, exps: ${s.links.related_experiments.length}`);
      } else {
        console.log(`      before: ideas=${s.before.ideas.length}, exps=${s.before.exps.length}`);
        console.log(`      after:  ideas=${s.after.ideas.length}, exps=${s.after.exps.length}`);
      }
    }
  }
}

main();
