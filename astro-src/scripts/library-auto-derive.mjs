#!/usr/bin/env node
// astro-src/scripts/library-auto-derive.mjs
//
// R7 D.2.5: Auto-derive user libraries from `task:` tags on paper.md.
//
// Walks docs/papers/, extracts task:* tags from each paper frontmatter,
// groups papers by task tag, and writes a derived docs/library/user-libraries.json
// where each `task:` with >= MIN_PAPERS papers becomes an auto_* library.
//
// Output schema matches astro-src/lib/user-libraries/types.ts:
//   { libraries: { [id]: { id, name, statement, hue, papers: { [arxivId]: meta } } } }
//
// Why auto-derive vs hand-curated:
//   - Task dimension is mechanical(论文 frontmatter 已分类),自动派生稳定。
//   - 用户 localStorage 库按"个人研究方向"组织,系统派生按"主题聚合"。
//   - 两者互补:系统派生给"今天有什么新论文"的入口,用户库给"我关注什么"的工作台。
//
// CLI:
//   --root=PATH        papers root (default docs/papers)
//   --out=PATH         output JSON path (default docs/library/user-libraries.auto.json)
//   --dry-run          print to stdout instead of writing
//   --min-papers=N     minimum papers required per task (default 5)
//   --json             JSON output

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_ROOT = 'docs/papers';
const DEFAULT_OUT = 'docs/library/user-libraries.auto.json';

const TASK_TO_LIB = {
  'task:rl':         { name: '强化学习', hue: 'emerald', statement: '从 task:rl 标签自动派生的强化学习文献聚合' },
  'task:llm-agent':  { name: 'LLM Agent', hue: 'cyan',    statement: '从 task:llm-agent 标签自动派生的 LLM 智能体文献聚合' },
  'task:game-ai':    { name: '博弈 AI',   hue: 'purple',  statement: '从 task:game-ai 标签自动派生的博弈论 AI 文献聚合' },
  'task:mas':        { name: '多智能体',  hue: 'sky',     statement: '从 task:mas 标签自动派生的多智能体系统文献聚合' },
  'task:rag':        { name: 'RAG',       hue: 'amber',   statement: '从 task:rag 标签自动派生的检索增强生成文献聚合' },
};

function walkPapers(root) {
  const out = [];
  if (!existsSync(root)) return out;
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

function extractArxivId(filename) {
  // 文件名格式: ".../<arxiv-id>-<slug>.md" 或 ".../<arxiv-id>v<N>-<slug>.md"。
  // 先取 basename(否则路径里的 '-' 会被误切),再抽 4位.4-5位 段。
  // arxiv id 形如 2606.06087 或 2606.06087v1(带版本后缀)。
  const stem = basename(filename).replace(/\.md$/, '');
  const first = stem.split('-')[0];
  const m = first.match(/^(\d{4}\.\d{4,5})(v\d+)?$/);
  return m ? m[1] : null;
}

function extractTaskTags(content) {
  // 两个来源,先 frontmatter 抽 tags: [task:rl, ...](老格式),
  // 再抽 categories: { task: [rl, mas] }(新格式 —— astro build 派生)。
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return [];
  const fm = fmMatch[1];
  const out = [];

  // 老格式 tags: [task:rl, ...]
  const tagsLine = fm.match(/^tags:\s*\[([^\]]*)\]/m);
  if (tagsLine) {
    for (const t of tagsLine[1].split(',')) {
      const v = t.trim().replace(/^['"]|['"]$/g, '');
      if (v.startsWith('task:')) out.push(v);
    }
  }

  // 新格式 categories.task: [rl, mas]
  // 注:fm 末位不一定有 \n(下一个 --- 在新行),所以让 trailing \n optional
  const taskBlock = fm.match(/^\s+task:\s*\n((?:\s+-\s+\S+\s*(?:\n|$))+)/m);
  if (taskBlock) {
    const items = taskBlock[1].match(/^\s+-\s+(\S+)/gm) || [];
    for (const it of items) {
      const label = it.replace(/^\s+-\s+/, '').trim();
      if (label) out.push(`task:${label}`);
    }
  }

  return [...new Set(out)];
}

/**
 * 扫描 root 下所有 paper.md,按 task:* tag 聚合论文 id。
 * 返回 { 'task:rl': ['2401.01234', ...], ... }
 */
export function collectTaskTags(root = DEFAULT_ROOT) {
  const taskToPapers = new Map();
  for (const f of walkPapers(root)) {
    const id = extractArxivId(f);
    if (!id) continue;
    let content;
    try {
      content = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const tag of extractTaskTags(content)) {
      if (!tag.startsWith('task:')) continue;
      if (!taskToPapers.has(tag)) taskToPapers.set(tag, []);
      taskToPapers.get(tag).push(id);
    }
  }
  return taskToPapers;
}

/**
 * 根据 TASK_TO_LIB 映射 + taskToPapers 聚合数据,生成派生库对象。
 *
 * - 仅生成 papers.length >= minPapers 的任务
 * - id 形如 auto_<task-name>
 * - papers 字段是 { [arxivId]: { status: 'candidate', addedAt } } 形式,
 *   匹配 UserLibrary.papers 的 schema
 */
export function deriveLibraries(taskToPapers, opts = {}) {
  const minPapers = opts.minPapers ?? 5;
  const out = {};
  for (const [task, libConfig] of Object.entries(TASK_TO_LIB)) {
    const papers = taskToPapers.get(task) || [];
    if (papers.length < minPapers) continue;
    const slug = task.replace(/^task:/, '');
    const id = `auto_${slug}`;
    const now = new Date().toISOString().slice(0, 10);
    const papersObj = {};
    for (const p of papers) {
      papersObj[p] = { status: 'candidate', addedAt: now };
    }
    out[id] = {
      id,
      name: libConfig.name,
      statement: libConfig.statement,
      hue: libConfig.hue,
      categories: [{ id: slug, label: task }],
      rubric: [],
      papers: papersObj,
      stages: [],
      drafts: [],
      autoDerived: true,
      sourceTask: task,
      createdAt: now,
      updatedAt: now,
    };
  }
  return out;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { root: DEFAULT_ROOT, out: DEFAULT_OUT, dryRun: false, minPapers: 5, json: false };
  for (const a of args) {
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else if (a.startsWith('--root=')) opts.root = a.split('=')[1];
    else if (a.startsWith('--out=')) opts.out = a.split('=')[1];
    else if (a.startsWith('--min-papers=')) opts.minPapers = parseInt(a.split('=')[1], 10) || 5;
    else if (a === '--help' || a === '-h') {
      console.log('用法: --root=PATH | --out=PATH | --dry-run | --min-papers=N | --json');
      process.exit(0);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs();
  const taskToPapers = collectTaskTags(opts.root);
  const libraries = deriveLibraries(taskToPapers, { minPapers: opts.minPapers });

  const summary = {
    totalTasksScanned: taskToPapers.size,
    taskCounts: Object.fromEntries(
      [...taskToPapers.entries()].map(([k, v]) => [k, v.length]),
    ),
    derivedLibraryCount: Object.keys(libraries).length,
    derivedLibraryIds: Object.keys(libraries),
  };

  if (opts.json || opts.dryRun) {
    const doc = { schemaVersion: 1, libraries };
    console.log(JSON.stringify({ ...doc, _summary: summary }, null, 2));
    if (!opts.dryRun) {
      writeFileSync(opts.out, JSON.stringify(doc, null, 2));
      console.error(`[library-auto-derive] wrote ${opts.out}`);
    }
    return;
  }

  // human-friendly output
  console.log(`\n[library-auto-derive] === summary ===`);
  console.log(`  papers root:          ${opts.root}`);
  console.log(`  task tags found:      ${taskToPapers.size}`);
  for (const [task, ids] of [...taskToPapers.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
    const inConfig = task in TASK_TO_LIB;
    const marker = inConfig ? '✓' : '·';
    console.log(`    ${marker} ${task.padEnd(20)} ${ids.length} papers`);
  }
  console.log(`  derived libraries:    ${summary.derivedLibraryCount}`);
  for (const id of summary.derivedLibraryIds) {
    const lib = libraries[id];
    console.log(`    ${id} (${Object.keys(lib.papers).length} papers, hue=${lib.hue})`);
  }
  console.log(`  output:               ${opts.out}`);

  const doc = { schemaVersion: 1, libraries };
  writeFileSync(opts.out, JSON.stringify(doc, null, 2));
  console.log(`\n  wrote ${opts.out}`);
}

const isCLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCLI) {
  main();
}

export { walkPapers, extractArxivId, extractTaskTags, TASK_TO_LIB };