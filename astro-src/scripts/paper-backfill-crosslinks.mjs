#!/usr/bin/env node
// astro-src/scripts/paper-backfill-crosslinks.mjs
//
// 启发式批量回填论文 frontmatter 的 related_ideas / related_experiments /
// related_papers / related_concepts 字段。
//
// 问题:大量论文缺少 related_* 跨模块链接。
//
// 设计:
//   - 启发式匹配: shared categories/authors → related_papers,
//     shared concepts → related_concepts
//   - LLM fallback (可选): 需要 LLM_API_URL / LLM_API_KEY 环境变量
//   - 与现有值合并(union),去重
//   - CLI: --dry-run, --apply, --limit N, --all, --llm, --heuristic
//
// 用法:
//   node astro-src/scripts/paper-backfill-crosslinks.mjs --dry-run --limit 10
//   node astro-src/scripts/paper-backfill-crosslinks.mjs --apply --limit 10
//   node astro-src/scripts/paper-backfill-crosslinks.mjs --apply --all --llm
//   node astro-src/scripts/paper-backfill-crosslinks.mjs --heuristic --dry-run

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const PAPERS_ROOT = 'docs/papers';
const IDEAS_ROOT = 'docs/ideas';
const EXPERIMENTS_ROOT = 'docs/experiments';

// ========== 1. 加载 ideas / experiments / papers 索引 ==========

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

// 加载所有论文用于 related_papers 匹配
function loadAllPapers() {
  const out = [];
  function rec(dir) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('_') || entry.name === 'assets') continue;
        if (entry.name.startsWith('topic-seeds-')) continue;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) rec(p);
        else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.txt')) {
          const raw = readFileSync(p, 'utf8');
          const { fm } = extractFrontmatter(raw);
          if (!fm) return;
          const titleMatch = fm.match(/^title:\s*(.+?)$/m);
          const title = titleMatch ? titleMatch[1].replace(/^['"]|['"]$/g, '').trim() : '';
          // 提取 authors
          const authorsMatch = fm.match(/^authors:\s*(.+)$/m);
          const authors = authorsMatch ? authorsMatch[1].replace(/^['"]|['"]$/g, '').split(',').map(a => a.trim().toLowerCase()) : [];
          // 提取 categories (task/method)
          const catsBlock = fm.match(/^categories:\s*\{([^}]+)\}/m);
          const categories = catsBlock ? catsBlock[1].split(',').map(c => c.trim().toLowerCase()) : [];
          const taskMatch = catsBlock ? catsBlock[1].match(/task:\s*\[([^\]]*)\]/) : null;
          const methodMatch = catsBlock ? catsBlock[1].match(/method:\s*\[([^\]]*)\]/) : null;
          const tasks = taskMatch ? taskMatch[1].split(',').map(t => t.trim().toLowerCase()) : [];
          const methods = methodMatch ? methodMatch[1].split(',').map(m => m.trim().toLowerCase()) : [];
          const arxivMatch = p.match(/(\d{4}\.\d{4,5})/);
          const arxivId = arxivMatch ? arxivMatch[1] : null;
          out.push({
            id: arxivId,
            path: p,
            title,
            authors,
            categories: [...tasks, ...methods],
            keywords: extractKeywords(title),
          });
        }
      }
    } catch (e) {
      // skip permission errors
    }
  }
  rec(PAPERS_ROOT);
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

/** 从 paper frontmatter 提取 title, tags, abstract, authors, categories */
function extractPaperMeta(fm, body) {
  const titleMatch = fm.match(/^title:\s*(.+?)$/m);
  const title = titleMatch ? titleMatch[1].replace(/^['"]|['"]$/g, '').trim() : '';

  const tagsBlock = fm.match(/^tags:\s*\[([^\]]*)\]/m);
  const tags = tagsBlock ? tagsBlock[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')) : [];

  // 去掉 query: 前缀
  const searchTags = tags.map(t => t.replace(/^query:/i, '')).filter(Boolean);

  const abstractMatch = fm.match(/^abstract_en:\s*(.+?)$/m);
  const abstract = abstractMatch ? abstractMatch[1].replace(/^['"]|['"]$/g, '').trim() : '';

  // 提取 authors
  const authorsMatch = fm.match(/^authors:\s*(.+)$/m);
  const authors = authorsMatch ? authorsMatch[1].replace(/^['"]|['"]$/g, '').split(',').map(a => a.trim().toLowerCase()) : [];

  // 提取 categories (task/method)
  const catsBlock = fm.match(/^categories:\s*\{([^}]+)\}/m);
  const categories = catsBlock ? catsBlock[1].split(',').map(c => c.trim().toLowerCase()) : [];
  const taskMatch = catsBlock ? catsBlock[1].match(/task:\s*\[([^\]]*)\]/) : null;
  const methodMatch = catsBlock ? catsBlock[1].match(/method:\s*\[([^\]]*)\]/) : null;
  const tasks = taskMatch ? taskMatch[1].split(',').map(t => t.trim().toLowerCase()) : [];
  const methods = methodMatch ? methodMatch[1].split(',').map(m => m.trim().toLowerCase()) : [];

  return {
    title,
    tags: searchTags,
    abstract,
    authors,
    categories: [...tasks, ...methods],
    keywords: extractKeywords(title + ' ' + abstract)
  };
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

/** 启发式匹配 related_papers: shared categories/authors */
function matchRelatedPapers(paperMeta, allPapers, currentPath) {
  const matched = new Set();
  const paperAuthors = new Set(paperMeta.authors || []);
  const paperCats = new Set(paperMeta.categories || []);

  for (const p of allPapers) {
    if (p.path === currentPath) continue; // skip self

    // 1. shared authors
    const sharedAuthors = p.authors.filter(a => paperAuthors.has(a));
    if (sharedAuthors.length >= 1) {
      matched.add(p.path);
    }

    // 2. shared categories (task/method)
    const sharedCats = p.categories.filter(c => paperCats.has(c));
    if (sharedCats.length >= 2) {
      matched.add(p.path);
    }
  }
  return [...matched];
}

/** 启发式匹配 related_concepts: shared concepts */
function matchRelatedConcepts(paperMeta, allPapers, currentPath) {
  const matched = new Set();
  const paperKw = new Set(paperMeta.keywords);

  for (const p of allPapers) {
    if (p.path === currentPath) continue; // skip self

    // keyword overlap (concepts are essentially keywords)
    const sharedKw = p.keywords.filter(kw => paperKw.has(kw) && kw.length > 3);
    if (sharedKw.length >= 2) {
      matched.add(p.path);
    }
  }
  return [...matched];
}

// ========== 4. LLM fallback (可选) ==========

async function callLLMFallback(paperMeta, ideas, experiments, allPapers) {
  const baseUrl = process.env.LLM_API_URL || process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseUrl) return null;

  const ideaSummaries = ideas.slice(0, 20).map(i => `  - ${i.id}: ${i.title}`).join('\n');
  const expSummaries = experiments.slice(0, 20).map(e => `  - ${e.id}: ${e.title}`).join('\n');
  const paperSummaries = allPapers.slice(0, 30).map(p => `  - ${p.id || p.path}: ${p.title}`).join('\n');

  const prompt = `You are a research assistant. Given a paper's metadata, recommend which ideas, experiments, and other papers from the library are related.

Paper title: ${paperMeta.title}
Paper tags: ${paperMeta.tags.join(', ') || '(none)'}
Paper authors: ${paperMeta.authors?.join(', ') || '(none)'}
Paper categories: ${paperMeta.categories?.join(', ') || '(none)'}
Paper abstract: ${paperMeta.abstract.slice(0, 500)}

Available ideas:
${ideaSummaries || '(none)'}

Available experiments:
${expSummaries || '(none)'}

Available papers:
${paperSummaries || '(none)'}

Respond with JSON only (no markdown):
{
  "related_ideas": ["docs/ideas/xxx.md", ...],
  "related_experiments": ["docs/experiments/yyy.md", ...],
  "related_papers": ["docs/papers/.../xxx.md", ...],
  "related_concepts": ["concept1", "concept2", ...]
}
Only include entries that are truly relevant. Return empty arrays if none.`;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
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
  const out = {
    related_ideas: [],
    related_experiments: [],
    related_writings: [],
    related_papers: [],
    related_concepts: []
  };
  for (const key of ['related_ideas', 'related_experiments', 'related_writings', 'related_papers', 'related_concepts']) {
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
  return `related_ideas: [${links.related_ideas.map(p => `"${p}"`).join(', ')}]
related_experiments: [${links.related_experiments.map(p => `"${p}"`).join(', ')}]
related_writings: [${links.related_writings.map(p => `"${p}"`).join(', ')}]
related_papers: [${links.related_papers.map(p => `"${p}"`).join(', ')}]
related_concepts: [${links.related_concepts.map(c => `"${c}"`).join(', ')}]
`;
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
  for (const key of ['related_ideas', 'related_experiments', 'related_writings', 'related_papers', 'related_concepts']) {
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
  const opts = { dryRun: false, apply: false, limit: 0, offset: 0, useLlm: false, useHeuristic: true, id: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--apply') opts.apply = true;
    else if (a === '--llm' || a === '--use-llm') opts.useLlm = true;
    else if (a === '--heuristic') opts.useHeuristic = true;
    else if (a === '--all') opts.limit = 0;
    else if (a.startsWith('--id=')) opts.id = a.split('=')[1];
    else if (a === '--id') opts.id = args[++i];
    else if (a.startsWith('--limit=')) opts.limit = parseInt(a.split('=')[1], 10) || 0;
    else if (a === '--limit') opts.limit = parseInt(args[++i], 10) || 0;
    else if (a.startsWith('--offset=')) opts.offset = parseInt(a.split('=')[1], 10) || 0;
    else if (a === '--offset') opts.offset = parseInt(args[++i], 10) || 0;
    else if (a === '--help' || a === '-h') {
      console.log(`用法:
  --dry-run          显示推断结果,不写文件(default)
  --apply            写入 related_* 字段
  --llm              使用 LLM 推断(需 LLM_API_URL/LLM_API_KEY)
  --heuristic        使用启发式匹配(default)
  --id <arxiv>       仅处理指定 arxiv ID 的论文
  --limit N          仅处理前 N 篇
  --offset N         跳过前 N 篇
  --all              处理全部(与 --limit 0 等效)`);
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
  console.log(`[paper-backfill-crosslinks] mode=${mode} llm=${opts.useLlm} heuristic=${opts.useHeuristic} limit=${opts.limit || 'all'} offset=${opts.offset}`);

  // 加载 ideas / experiments 索引
  const ideas = loadIdeas();
  const experiments = loadExperiments();
  const allPapers = loadAllPapers();
  console.log(`[paper-backfill-crosslinks] loaded ${ideas.length} ideas, ${experiments.length} experiments, ${allPapers.length} papers`);

  const all = walkPapers(PAPERS_ROOT);
  console.log(`[paper-backfill-crosslinks] found ${all.length} papers`);

  // 如果指定了 --id,过滤只处理匹配的论文
  const filtered = opts.id
    ? all.filter(f => f.includes(opts.id))
    : all;

  if (opts.id) {
    console.log(`[paper-backfill-crosslinks] filtered to ${filtered.length} papers matching id=${opts.id}`);
  }

  let processed = 0, updated = 0, skipped = 0, errors = 0;
  const sample = [];

  for (const file of filtered) {
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

    // 如果 related_* 已存在,跳过(不覆盖已有数据)
    if (current.related_papers?.length > 0 || current.related_concepts?.length > 0) {
      skipped++;
      continue;
    }

    // 启发式匹配
    let inferredIdeas = [];
    let inferredExps = [];
    let inferredPapers = [];
    let inferredConcepts = [];

    if (opts.useHeuristic) {
      inferredIdeas = matchIdeas(paperMeta, ideas);
      inferredExps = matchExperiments(paperMeta, experiments);
      inferredPapers = matchRelatedPapers(paperMeta, allPapers, file);
      inferredConcepts = matchRelatedConcepts(paperMeta, allPapers, file);
    }

    // LLM fallback (可选)
    if (opts.useLlm) {
      const llmResult = await callLLMFallback(paperMeta, ideas, experiments, allPapers);
      if (llmResult) {
        // 验证路径存在
        for (const p of llmResult.related_ideas || []) {
          if (existsSync(p) && !inferredIdeas.includes(p)) inferredIdeas.push(p);
        }
        for (const p of llmResult.related_experiments || []) {
          if (existsSync(p) && !inferredExps.includes(p)) inferredExps.push(p);
        }
        for (const p of llmResult.related_papers || []) {
          if (existsSync(p) && !inferredPapers.includes(p)) inferredPapers.push(p);
        }
        if (llmResult.related_concepts) {
          inferredConcepts = [...new Set([...inferredConcepts, ...llmResult.related_concepts])];
        }
      }
    }

    // 合并已有 + 新推断
    const mergedIdeas = [...new Set([...current.related_ideas, ...inferredIdeas])];
    const mergedExps = [...new Set([...current.related_experiments, ...inferredExps])];
    const mergedPapers = [...new Set([...current.related_papers, ...inferredPapers])];
    const mergedConcepts = [...new Set([...current.related_concepts, ...inferredConcepts])];

    // 检查是否需要更新
    const needsUpdate = mergedIdeas.length !== current.related_ideas.length ||
                        mergedExps.length !== current.related_experiments.length ||
                        mergedPapers.length !== current.related_papers.length ||
                        mergedConcepts.length !== current.related_concepts.length;

    if (!needsUpdate) {
      skipped++;
      continue;
    }

    const newLinks = {
      related_ideas: mergedIdeas,
      related_experiments: mergedExps,
      related_writings: current.related_writings,
      related_papers: mergedPapers,
      related_concepts: mergedConcepts,
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
          before: { ideas: current.related_ideas, exps: current.related_experiments, papers: current.related_papers, concepts: current.related_concepts },
          after: { ideas: mergedIdeas, exps: mergedExps, papers: mergedPapers, concepts: mergedConcepts },
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
        console.log(`      → ideas: ${s.links?.related_ideas?.length || 0}, exps: ${s.links?.related_experiments?.length || 0}, papers: ${s.links?.related_papers?.length || 0}, concepts: ${s.links?.related_concepts?.length || 0}`);
      } else {
        console.log(`      before: ideas=${s.before.ideas.length}, exps=${s.before.exps.length}, papers=${s.before.papers?.length || 0}, concepts=${s.before.concepts?.length || 0}`);
        console.log(`      after:  ideas=${s.after.ideas.length}, exps=${s.after.exps.length}, papers=${s.after.papers.length}, concepts=${s.after.concepts.length}`);
      }
    }
  }
}

main();
