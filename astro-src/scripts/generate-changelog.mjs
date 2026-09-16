#!/usr/bin/env node
/**
 * generate-changelog.mjs - Generate CHANGELOG from R7 commits
 * Parses git log --oneline --grep="R7" and groups by scope (A/B/C/D/E/F/G/H/I/J prefix)
 * Usage: node astro-src/scripts/generate-changelog.mjs
 */

import { execSync } from 'child_process';

const SCOPE_PREFIXES = {
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

function parseCommit(line) {
  // Format: <sha> <type>(<scope>): <description> (R7 <id>)
  const match = line.match(/^([a-f0-9]+)\s+(\w+)\(([^)]+)\):\s+(.+)\s+\(R7\s+([A-J])\.?\d+(?:\.\d+)*\)/);
  if (match) {
    return {
      sha: match[1],
      type: match[2],
      scope: match[3],
      description: match[4],
      section: match[5]
    };
  }
  // Fallback: just extract R7 section if present
  const sectionMatch = line.match(/\(R7\s+([A-J])\./);
  if (sectionMatch) {
    return {
      sha: line.substring(0, 7),
      type: 'unknown',
      scope: 'unknown',
      description: line.substring(8),
      section: sectionMatch[1]
    };
  }
  return null;
}

function groupBySection(commits) {
  const groups = {};
  for (const section of Object.keys(SCOPE_PREFIXES)) {
    groups[section] = [];
  }

  for (const commit of commits) {
    const parsed = parseCommit(commit);
    if (parsed && groups[parsed.section]) {
      groups[parsed.section].push(parsed);
    }
  }

  return groups;
}

function formatMarkdown(groups) {
  let md = '# Changelog (R7)\n\n';
  md += 'Generated from R7 commits\n\n';

  for (const [section, prefix] of Object.entries(SCOPE_PREFIXES)) {
    const commits = groups[section];
    if (commits.length === 0) continue;

    md += `## ${section}. ${prefix}\n\n`;
    for (const c of commits) {
      md += `- \`${c.sha}\` ${c.type}(${c.scope}): ${c.description}\n`;
    }
    md += '\n';
  }

  return md;
}

function main() {
  const commits = getR7Commits();
  const groups = groupBySection(commits);
  const md = formatMarkdown(groups);
  console.log(md);
}

main();
