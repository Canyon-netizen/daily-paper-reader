import { describe, it } from 'node:test';
import assert from 'node:assert';

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

// Test 1: parseSection extracts section letter
describe('parseSection', () => {
  const parseSection = (line) => {
    const match = line.match(/\(R7\s+([A-J])\./);
    return match ? match[1] : null;
  };

  it('should extract section A', () => {
    const result = parseSection('abc1234 feat(core): test (R7 A.1.1)');
    assert.strictEqual(result, 'A');
  });

  it('should extract section J', () => {
    const result = parseSection('def5678 chore: update (R7 J.3.2)');
    assert.strictEqual(result, 'J');
  });

  it('should return null for non-R7 commit', () => {
    const result = parseSection('abc1234 some commit');
    assert.strictEqual(result, null);
  });
});

// Test 2: groupBySection
describe('groupBySection', () => {
  const groupBySection = (commits) => {
    const groups = {};
    for (const section of Object.keys(SECTIONS)) {
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

  it('should count commits per section', () => {
    const commits = [
      'abc1234 feat(a): test (R7 A.1)',
      'def5678 fix(a): test (R7 A.2)',
      'ghi9012 chore(b): test (R7 B.1)'
    ];
    const groups = groupBySection(commits);
    assert.strictEqual(groups.A.length, 2);
    assert.strictEqual(groups.B.length, 1);
    assert.strictEqual(groups.C.length, 0);
  });
});

// Test 3: formatTable
describe('formatTable', () => {
  const formatTable = (groups) => {
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

    table += ` Total                                                         ${total}\n`;
    return table;
  };

  it('should include all sections in table', () => {
    const groups = { A: [1], B: [], C: [1, 2], D: [], E: [], F: [], G: [], H: [], I: [], J: [] };
    const table = formatTable(groups);
    assert.ok(table.includes('A. Core/Architecture'));
    assert.ok(table.includes('J. Meta/Process'));
    assert.ok(table.includes('Total'));
  });
});
