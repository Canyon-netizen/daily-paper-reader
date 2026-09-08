#!/usr/bin/env node
// astro-src/scripts/concept-heal.mjs
//
// Heal public/wiki/concepts/_graph.json from LLM extraction artifacts:
//
//   1. Paper-title-as-concept: label 含冒号且 > 35 字符 → 折成冒号前部分
//   2. Over-long labels (> 60 字符) → 截到 60 + …
//   3. Trailing junk chars
//   4. Counts: 列出 before/after 统计
//
// 写回原文件 (in-place),并写一份 .heal-report.json 审计轨迹。
//
// 使用:
//   node astro-src/scripts/concept-heal.mjs
//   node astro-src/scripts/concept-heal.mjs --dry-run     # 只打印,不写
//
// 约束:不动 edges,不动 nodes.id / kind / weight / category,只改 label 字段。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const GRAPH_PATH = join(ROOT, 'public', 'wiki', 'concepts', '_graph.json');
const REPORT_PATH = join(ROOT, 'public', 'wiki', 'concepts', '_graph.heal-report.json');

const DRY_RUN = process.argv.includes('--dry-run');

/** 同 pages/concepts.astro 的 cleanConceptLabel —— 保持单一来源 */
function cleanConceptLabel(raw) {
  let s = (raw || '').trim();
  if (!s) return s;
  if (s.length > 50 && s.includes(':')) {
    s = s.split(':')[0].trim();
  }
  if (s.length > 40) {
    const cut = s.slice(0, 35);
    const lastSpace = cut.lastIndexOf(' ');
    s = (lastSpace > 12 ? cut.slice(0, lastSpace) : cut).trim() + '…';
  }
  s = s.replace(/[…\-\s]+$/, '');
  return s;
}

if (!existsSync(GRAPH_PATH)) {
  console.error(`[heal] 找不到 ${GRAPH_PATH}`);
  process.exit(1);
}

console.log(`[heal] 读取 ${GRAPH_PATH}`);
const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8'));
const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
const edges = Array.isArray(graph?.edges) ? graph.edges : [];

let cleaned = 0;
let unchanged = 0;
const samples = [];
const originalById = new Map();

for (const n of nodes) {
  if (n.kind !== 'concept') continue;
  const original = n.label || n.id || '';
  const healed = cleanConceptLabel(original);
  originalById.set(n.id, original);
  if (healed !== original) {
    n.label = healed;
    cleaned++;
    if (samples.length < 30) {
      samples.push({ id: n.id, from: original, to: healed });
    }
  } else {
    unchanged++;
  }
}

const report = {
  healedAt: new Date().toISOString(),
  totalConcepts: nodes.filter((n) => n.kind === 'concept').length,
  cleaned,
  unchanged,
  samples,
  dryRun: DRY_RUN,
};

console.log(`[heal] 概念节点: ${report.totalConcepts}, 清洗: ${cleaned}, 未变: ${unchanged}`);
console.log(`[heal] 前 ${samples.length} 条样本:`);
for (const s of samples.slice(0, 10)) {
  console.log(`  ${s.id}: "${s.from}" → "${s.to}"`);
}

if (DRY_RUN) {
  console.log('[heal] --dry-run,未写回');
  process.exit(0);
}

// 写回 graph (深拷贝不改 schema)
const out = { ...graph, nodes, edges };
writeFileSync(GRAPH_PATH, JSON.stringify(out, null, 2), 'utf8');
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
console.log(`[heal] 写回 ${GRAPH_PATH}`);
console.log(`[heal] 审计 ${REPORT_PATH}`);
