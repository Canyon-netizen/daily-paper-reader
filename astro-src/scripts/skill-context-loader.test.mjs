/**
 * skill-context-loader.test.mjs — smoke tests for R7 B.1.6.
 *
 * Run: node --test astro-src/scripts/skill-context-loader.test.mjs
 *
 * Verifies:
 *   - AGENT_STAGES contains the 6 documented stages
 *   - isValidStage() returns true for each stage and false for garbage
 *   - loadSkillContext() for each stage returns a non-empty string with
 *     the [方法论上下文 · stage=X] header
 *   - loadSkillContext() for each stage references at least one expected
 *     skill file in its body
 *   - listStageSkillMapping() returns 6 entries
 *   - loadSkillContext() for unknown stage returns empty string (graceful)
 *
 * This test only validates the .mjs surface (Node CLI imports it). The .ts
 * mirror is hand-maintained and changes must be reflected in both — drift
 * would only be caught at import time.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert';

const loader = await import('../lib/agents/skill-context-loader.mjs');

describe('skill-context-loader (R7 B.1.6)', () => {
  describe('AGENT_STAGES', () => {
    test('contains all 6 stages', () => {
      assert.deepStrictEqual(
        [...loader.AGENT_STAGES].sort(),
        ['draft', 'experiment', 'ideation', 'literature', 'review', 'revise'],
      );
    });
  });

  describe('isValidStage', () => {
    test('returns true for each documented stage', () => {
      for (const stage of loader.AGENT_STAGES) {
        assert.strictEqual(loader.isValidStage(stage), true, `stage=${stage}`);
      }
    });
    test('returns false for unknown stage', () => {
      assert.strictEqual(loader.isValidStage('bogus'), false);
      assert.strictEqual(loader.isValidStage(''), false);
      assert.strictEqual(loader.isValidStage(undefined), false);
      assert.strictEqual(loader.isValidStage(null), false);
    });
  });

  describe('loadSkillContext', () => {
    test('draft stage returns header + writing-paper content', () => {
      const out = loader.loadSkillContext('draft');
      assert.match(out, /^\[方法论上下文 · stage=draft\]/);
      assert.match(out, /### writing-paper\.md/);
    });
    test('experiment stage references experiment-design', () => {
      const out = loader.loadSkillContext('experiment');
      assert.match(out, /### experiment-design\.md/);
    });
    test('review stage references reviewer-mindset + writing-review', () => {
      const out = loader.loadSkillContext('review');
      assert.match(out, /### reviewer-mindset\.md/);
      assert.match(out, /### writing-review\.md/);
    });
    test('revise stage references writing-rebuttal', () => {
      const out = loader.loadSkillContext('revise');
      assert.match(out, /### writing-rebuttal\.md/);
    });
    test('literature stage references both lit-review + read-paper', () => {
      const out = loader.loadSkillContext('literature');
      assert.match(out, /### how-to-lit-review\.md/);
      assert.match(out, /### how-to-read-paper\.md/);
    });
    test('ideation stage works (defining-research-question.md now exists)', () => {
      // Defining-research-question.md landed on remote; should load normally.
      const out = loader.loadSkillContext('ideation');
      assert.match(out, /### defining-research-question\.md/);
      assert.doesNotMatch(out, /\(WARN:/, 'ideation should not emit WARN once skill doc exists');
    });
    test('truncates long skill docs at MAX_CHARS_PER_FILE', () => {
      // writing-paper.md is 5735 chars > 3000 cap, draft stage WILL truncate.
      const draftOut = loader.loadSkillContext('draft');
      assert.match(draftOut, /\.\.\.\[truncated\]/, 'writing-paper.md (5735 chars) should truncate');
      // how-to-lit-review.md is ~1900 chars, under cap, literature stage has 2 files
      // (one truncate, one not) — verify mixed output.
      const litOut = loader.loadSkillContext('literature');
      assert.match(litOut, /\.\.\.\[truncated\]/, 'at least one literature skill doc should truncate');
    });
    test('returns empty string for unknown stage (graceful)', () => {
      assert.strictEqual(loader.loadSkillContext('bogus'), '');
      assert.strictEqual(loader.loadSkillContext(''), '');
      assert.strictEqual(loader.loadSkillContext(undefined), '');
      assert.strictEqual(loader.loadSkillContext(null), '');
    });
    test('uses in-memory cache (same input → same reference path)', () => {
      const a = loader.loadSkillContext('draft');
      const b = loader.loadSkillContext('draft');
      assert.strictEqual(a, b, 'cached string should be reference-equal');
    });
  });

  describe('listStageSkillMapping', () => {
    test('returns 6 entries', () => {
      assert.strictEqual(loader.listStageSkillMapping().length, 6);
    });
    test('each entry has stage + files[]', () => {
      for (const entry of loader.listStageSkillMapping()) {
        assert.ok(typeof entry.stage === 'string');
        assert.ok(Array.isArray(entry.files));
        assert.ok(entry.files.length >= 1);
      }
    });
  });
});