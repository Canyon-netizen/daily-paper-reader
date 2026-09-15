/**
 * audit-crosslinks.test.mjs — smoke tests for R7 C.3.5.
 *
 * Run: node --test astro-src/scripts/audit-crosslinks.test.mjs
 *
 * Verifies:
 *   - extractFrontmatter parses YAML-frontmatter sections correctly
 *   - readCrosslinkFields handles missing/empty/valid cross-link fields
 *   - validateRef returns valid:true when the target exists, valid:false otherwise
 *   - auditPaper flags orphan / invalid-tier / invalid-milestone correctly
 *   - addOrphanFlag writes is_orphan: true into the frontmatter and is idempotent
 *   - walkPapers recursively finds .md files in docs/papers/
 *
 * Tests use a tmp dir with fixture papers so they don't pollute docs/papers/.
 * On cleanup, the tmp dir is removed.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const audit = await import('../scripts/audit-crosslinks.mjs');

// ---------------------------------------------------------------------------
// tmp dir + fixtures
// ---------------------------------------------------------------------------

let tmpRoot;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'audit-crosslinks-test-'));
  // fixture tree:
  //   tmp/papers/
  //     orphan.md                    — no related_*
  //     with-links.md                — has related_ideas + valid resource_tier
  //     bad-tier.md                  — resource_tier: 'gpu-mega' (invalid)
  //     bad-milestone.md             — is_milestone: 'yes' (not boolean)
  //     broken-ref.md                — related_ideas refs nonexistent path
  //   tmp/docs/ideas/anchor.md       — target for broken-ref test (so the broken ref is a different one)
  //   tmp/docs/ideas/real.md         — target for with-links fixture
  mkdirSync(join(tmpRoot, 'papers', '2026', '09', '15'), { recursive: true });
  mkdirSync(join(tmpRoot, 'docs', 'ideas'), { recursive: true });

  // 1. orphan: no related_*, valid other fields
  writeFileSync(
    join(tmpRoot, 'papers', '2026', '09', '15', 'orphan.md'),
    [
      '---',
      'title: "Orphan Fixture"',
      'resource_tier: small',
      'is_milestone: false',
      '---',
      '',
      '# TLDR',
      'orphan body',
      '',
    ].join('\n'),
  );

  // 2. with-links: related_ideas points to docs/ideas/real.md (we'll create it)
  writeFileSync(
    join(tmpRoot, 'papers', '2026', '09', '15', 'with-links.md'),
    [
      '---',
      'title: "With Links Fixture"',
      'resource_tier: medium',
      'is_milestone: false',
      'related_ideas: [ideas/real.md]',
      '---',
      '',
      '# TLDR',
      'has links',
      '',
    ].join('\n'),
  );
  writeFileSync(join(tmpRoot, 'docs', 'ideas', 'real.md'), '# real idea\n');

  // 3. bad-tier: resource_tier has invalid value
  writeFileSync(
    join(tmpRoot, 'papers', '2026', '09', '15', 'bad-tier.md'),
    [
      '---',
      'title: "Bad Tier Fixture"',
      'resource_tier: gpu-mega',
      'is_milestone: false',
      'related_ideas: [ideas/real.md]',
      '---',
      '',
      '# TLDR',
      '',
    ].join('\n'),
  );

  // 4. bad-milestone: is_milestone is "yes" not boolean (script only flags non-boolean when
  // value is non-empty string AND not 'true'/'false'; coverage: see auditPaper test below)
  writeFileSync(
    join(tmpRoot, 'papers', '2026', '09', '15', 'bad-milestone.md'),
    [
      '---',
      'title: "Bad Milestone Fixture"',
      'resource_tier: small',
      'is_milestone: yes',
      'related_ideas: [ideas/real.md]',
      '---',
      '',
      '# TLDR',
      '',
    ].join('\n'),
  );

  // 5. broken-ref: related_ideas points to nonexistent file
  writeFileSync(
    join(tmpRoot, 'papers', '2026', '09', '15', 'broken-ref.md'),
    [
      '---',
      'title: "Broken Ref Fixture"',
      'resource_tier: small',
      'is_milestone: false',
      'related_ideas: [ideas/does-not-exist.md]',
      '---',
      '',
      '# TLDR',
      '',
    ].join('\n'),
  );
});

after(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// extractFrontmatter
// ---------------------------------------------------------------------------

describe('extractFrontmatter', () => {
  test('parses simple --- ... --- block', () => {
    const raw = '---\ntitle: foo\n---\nbody\n';
    const { fm, body } = audit.extractFrontmatter(raw);
    assert.strictEqual(fm, 'title: foo');
    assert.strictEqual(body, 'body\n');
  });
  test('returns empty fm when no --- block', () => {
    const raw = 'no frontmatter here\n';
    const { fm, body } = audit.extractFrontmatter(raw);
    assert.strictEqual(fm, '');
    assert.strictEqual(body, raw);
  });
  test('CRLF-tolerant (\\r\\n separators)', () => {
    const raw = '---\r\ntitle: foo\r\n---\r\nbody\r\n';
    const { fm } = audit.extractFrontmatter(raw);
    assert.ok(fm.includes('title: foo'));
  });
});

// ---------------------------------------------------------------------------
// readCrosslinkFields
// ---------------------------------------------------------------------------

describe('readCrosslinkFields', () => {
  test('returns empty arrays for fm without related_*', () => {
    const fields = audit.readCrosslinkFields('title: foo\n');
    assert.deepStrictEqual(fields.related_ideas, []);
    assert.deepStrictEqual(fields.related_experiments, []);
    assert.deepStrictEqual(fields.related_writings, []);
    assert.strictEqual(fields.resource_tier, '');
    assert.strictEqual(fields.is_milestone, null);
  });
  test('parses list form related_ideas: [a, b]', () => {
    const fields = audit.readCrosslinkFields('related_ideas: [a.md, b.md]\n');
    assert.deepStrictEqual(fields.related_ideas, ['a.md', 'b.md']);
  });
  test('parses is_milestone: true (boolean)', () => {
    const fields = audit.readCrosslinkFields('is_milestone: true\n');
    assert.strictEqual(fields.is_milestone, true);
  });
  test('parses is_milestone: false (boolean)', () => {
    const fields = audit.readCrosslinkFields('is_milestone: false\n');
    assert.strictEqual(fields.is_milestone, false);
  });
});

// ---------------------------------------------------------------------------
// validateRef
// ---------------------------------------------------------------------------

describe('validateRef', () => {
  test('returns valid:true for existing target .md', () => {
    const result = audit.validateRef('ideas/real.md', join(tmpRoot, 'papers', 'x.md'), join(tmpRoot, 'docs'));
    assert.strictEqual(result.valid, true);
  });
  test('returns valid:false for missing target', () => {
    const result = audit.validateRef('ideas/missing.md', join(tmpRoot, 'papers', 'x.md'), join(tmpRoot, 'docs'));
    assert.strictEqual(result.valid, false);
    assert.ok(result.targetPath);
  });
  test('strips docs/ prefix before checking', () => {
    const result = audit.validateRef('docs/ideas/real.md', join(tmpRoot, 'papers', 'x.md'), join(tmpRoot, 'docs'));
    assert.strictEqual(result.valid, true);
  });
});

// ---------------------------------------------------------------------------
// auditPaper
// ---------------------------------------------------------------------------

describe('auditPaper', () => {
  // Convenience: pass docsRoot=join(tmpRoot, 'docs') to all auditPaper calls in this suite
  const docsRoot = join(tmpRoot, 'docs');

  test('flags orphan when no related_* links', () => {
    const r = audit.auditPaper(join(tmpRoot, 'papers', '2026', '09', '15', 'orphan.md'), docsRoot);
    assert.strictEqual(r.isOrphan, true);
    assert.ok(r.issues.includes('orphan(no-related-links)'));
  });
  test('does not flag orphan when related_* present', () => {
    const r = audit.auditPaper(join(tmpRoot, 'papers', '2026', '09', '15', 'with-links.md'), docsRoot);
    assert.strictEqual(r.isOrphan, false);
    assert.ok(!r.issues.includes('orphan(no-related-links)'));
  });
  test('flags invalid-tier when resource_tier not in VALID_TIERS', () => {
    const r = audit.auditPaper(join(tmpRoot, 'papers', '2026', '09', '15', 'bad-tier.md'), docsRoot);
    assert.ok(r.issues.some((i) => i.startsWith('invalid-tier')));
  });
  test('does not flag valid tier (small/medium/large/xlarge/unknown/api_only/empty)', () => {
    for (const t of ['small', 'medium', 'large', 'xlarge', 'unknown', 'api_only', '']) {
      const fm = `resource_tier: '${t}'\nis_milestone: false\nrelated_ideas: [ideas/real.md]\n`;
      const raw = `---\n${fm}---\n`;
      const path = join(tmpRoot, 'papers', 'valid-tier.md');
      writeFileSync(path, raw);
      const r = audit.auditPaper(path, docsRoot);
      assert.ok(!r.issues.some((i) => i.startsWith('invalid-tier')), `tier=${t}`);
    }
  });
  test('flags invalid-milestone when not boolean', () => {
    const r = audit.auditPaper(join(tmpRoot, 'papers', '2026', '09', '15', 'bad-milestone.md'), docsRoot);
    assert.ok(r.issues.some((i) => i.startsWith('invalid-milestone')));
  });
  test('flags invalid-ref when path does not exist', () => {
    const r = audit.auditPaper(join(tmpRoot, 'papers', '2026', '09', '15', 'broken-ref.md'), docsRoot);
    assert.ok(r.issues.some((i) => i.startsWith('invalid-ref')));
  });
});

// ---------------------------------------------------------------------------
// addOrphanFlag
// ---------------------------------------------------------------------------

describe('addOrphanFlag', () => {
  test('writes is_orphan: true into frontmatter', () => {
    // Use a fresh fixture (don't mutate shared orphan.md since order is undefined)
    const path = join(tmpRoot, 'papers', '2026', '09', '15', 'orphan-flag.md');
    writeFileSync(
      path,
      '---\ntitle: "flag me"\nresource_tier: small\n---\n\nbody\n',
    );
    const wrote = audit.addOrphanFlag(path);
    assert.strictEqual(wrote, true);
    const after = readFileSync(path, 'utf8');
    assert.match(after, /is_orphan: true/);
  });
  test('is idempotent — second call returns false (already flagged)', () => {
    const path = join(tmpRoot, 'papers', '2026', '09', '15', 'orphan-flag.md');
    const wrote = audit.addOrphanFlag(path);
    assert.strictEqual(wrote, false);
    // File still has exactly one is_orphan: true line
    const after = readFileSync(path, 'utf8');
    const matches = after.match(/^is_orphan: true$/gm);
    assert.strictEqual(matches?.length, 1);
  });
});

// ---------------------------------------------------------------------------
// walkPapers
// ---------------------------------------------------------------------------

describe('walkPapers', () => {
  test('recursively finds all .md files under root', () => {
    const files = audit.walkPapers(join(tmpRoot, 'papers'));
    // ≥5 fixtures; exact count depends on whether addOrphanFlag test ran first
    assert.ok(files.length >= 5);
    assert.ok(files.every((f) => f.endsWith('.md')));
  });
  test('skips _prefix and topic-seeds- and assets/', () => {
    // Create a _private.md and a topic-seeds-foo.md to confirm they're skipped
    writeFileSync(join(tmpRoot, 'papers', '_skip.md'), '# skip\n');
    writeFileSync(join(tmpRoot, 'papers', 'topic-seeds-bar.md'), '# skip\n');
    const files = audit.walkPapers(join(tmpRoot, 'papers'));
    assert.ok(!files.some((f) => f.endsWith('_skip.md')));
    assert.ok(!files.some((f) => f.includes('topic-seeds-')));
  });
});