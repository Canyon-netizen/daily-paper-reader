import { describe, it } from 'node:test';
import assert from 'node:assert';

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

// Test 1: parseCommit with full format
describe('parseCommit', () => {
  const parseCommit = (line) => {
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
  };

  it('should parse full commit format', () => {
    const line = 'abc1234 feat(core): add feature (R7 A.1.1)';
    const result = parseCommit(line);
    assert.strictEqual(result.sha, 'abc1234');
    assert.strictEqual(result.type, 'feat');
    assert.strictEqual(result.scope, 'core');
    assert.strictEqual(result.section, 'A');
  });

  it('should parse commit with section only', () => {
    const line = 'def5678 fix(bug): resolve issue (R7 B.2)';
    const result = parseCommit(line);
    assert.strictEqual(result.sha, 'def5678');
    assert.strictEqual(result.section, 'B');
  });

  it('should return null for non-R7 commit', () => {
    const line = 'abc1234 some random commit';
    const result = parseCommit(line);
    assert.strictEqual(result, null);
  });
});

// Test 2: groupBySection
describe('groupBySection', () => {
  const groupBySection = (commits) => {
    const groups = {};
    for (const section of Object.keys(SCOPE_PREFIXES)) {
      groups[section] = [];
    }

    for (const commit of commits) {
      const match = commit.match(/\(R7\s+([A-J])\./);
      if (match && groups[match[1]]) {
        groups[match[1]].push(commit);
      }
    }
    return groups;
  };

  it('should group commits by section', () => {
    const commits = [
      'abc1234 feat(a): test (R7 A.1)',
      'def5678 fix(b): test (R7 B.1)',
      'ghi9012 chore(c): test (R7 C.1)'
    ];
    const groups = groupBySection(commits);
    assert.strictEqual(groups.A.length, 1);
    assert.strictEqual(groups.B.length, 1);
    assert.strictEqual(groups.C.length, 1);
  });

  it('should handle empty commits array', () => {
    const groups = groupBySection([]);
    assert.strictEqual(groups.A.length, 0);
    assert.strictEqual(groups.J.length, 0);
  });
});

// Test 3: formatMarkdown
describe('formatMarkdown', () => {
  const formatMarkdown = (groups) => {
    let md = '# Changelog (R7)\n\n';
    for (const [section, prefix] of Object.entries(SCOPE_PREFIXES)) {
      const commits = groups[section];
      if (commits.length === 0) continue;
      md += `## ${section}. ${prefix}\n\n`;
      for (const c of commits) {
        md += `- ${c}\n`;
      }
      md += '\n';
    }
    return md;
  };

  it('should format markdown correctly', () => {
    const groups = {
      A: ['abc1234 feat(core): test'],
      B: []
    };
    const md = formatMarkdown(groups);
    assert.ok(md.includes('# Changelog (R7)'));
    assert.ok(md.includes('## A. Core/Architecture'));
    assert.ok(!md.includes('## B.'));
  });
});
