#!/usr/bin/env node
/**
 * r7-progress.mjs - R7 progress dashboard
 * Parses git log --oneline --grep="R7" and outputs progress table
 * Usage: node astro-src/scripts/r7-progress.mjs
 */

import { execSync } from 'child_process';

const SECTIONS = {
  A: 'Core/Architecture',
  B: 'Data/Pipeline',
  C: 'UI/Frontend',
  D: 'Docs/Content',
  E: 'DevOps/Infra',
  F: 'Testing/QA',
  G: 'Performance',
  H: 'Security',
  I: 'Release/Version',
  J: 'Meta/Process'
};

function getR7Commits() {
  try {
    const output = execSync('git log --oneline --grep="R7"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    return output.trim().split('\n').filter(Boolean);
  } catch (e) {
    return [];
  }
}

function parseSection(line) {
  const match = line.match(/\(R7\s+([A-J])\./);
  return match ? match[1] : null;
}

function groupBySection(commits) {
  const groups = {};
  for (const section of Object.keys(SECTIONS)) {
    groups[section] = [];
  }

  for (const commit of commits) {
    const section = parseSection(commit);
    if (section && groups[section]) {
      groups[section].push(commit);
    }
  }

  return groups;
}

function formatTable(groups) {
  const colWidths = { section: 8, name: 20, count: 6 };
  let table = '\n';
  table += ' R7 Progress Dashboard\n';
  table += '======================\n\n';
  table += ` ${'Section'.padEnd(colWidths.section)} ${'Name'.padEnd(colWidths.name)} ${'Done'.padEnd(colWidths.count)}\n`;
  table += ` ${'-'.repeat(colWidths.section)} ${'-'.repeat(colWidths.name)} ${'-'.repeat(colWidths.count)}\n`;

  let total = 0;
  for (const [section, name] of Object.entries(SECTIONS)) {
    const count = groups[section].length;
    total += count;
    table += ` ${section.padEnd(colWidths.section)} ${name.padEnd(colWidths.name)} ${count.toString().padEnd(colWidths.count)}\n`;
  }

  table += ` ${'-'.repeat(colWidths.section)} ${'-'.repeat(colWidths.name)} ${'-'.repeat(colWidths.count)}\n`;
  table += ` Total                                                         ${total}\n`;

  return table;
}

function main() {
  const commits = getR7Commits();
  const groups = groupBySection(commits);
  const table = formatTable(groups);
  console.log(table);
}

main();
