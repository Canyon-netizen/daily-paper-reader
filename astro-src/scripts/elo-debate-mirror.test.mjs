/**
 * elo-debate-mirror.test.mjs — Drift test for TS/JS dual implementation.
 *
 * Run: node --import tsx --test astro-src/scripts/elo-debate-mirror.test.mjs
 *
 * This test compares:
 *   - astro-src/lib/elo-debate.ts (TypeScript source-of-truth)
 *   - astro-src/lib/elo-debate.mjs (JavaScript mirror for Node CLI)
 *
 * It verifies that both implementations produce identical results for:
 *   - expectedScore(a, b)
 *   - updateElo(a, b, winner) for all winner states
 *   - swissPairs(ideas)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { expectedScore as expectedScoreMJS, updateElo as updateEloMJS, swissPairs as swissPairsMJS } from '../lib/elo-debate.mjs';

// Dynamic import for TypeScript file via tsx loader
const tsModule = await import('../lib/elo-debate.ts');
const expectedScoreTS = tsModule.expectedScore;
const updateEloTS = tsModule.updateElo;
const swissPairsTS = tsModule.swissPairs;

// ---------------------------------------------------------------------------
// Deterministic RNG (LCG) for reproducible test scenarios
// ---------------------------------------------------------------------------

class LCG {
  constructor(seed = 12345) {
    this.state = seed;
  }

  // Returns number in [0, 1)
  next() {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }

  // Returns integer in [min, max)
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min)) + min;
  }
}

// ---------------------------------------------------------------------------
// Helper: Generate random ideas
// ---------------------------------------------------------------------------

function generateRandomIdeas(rng, count) {
  const ideas = [];
  for (let i = 0; i < count; i++) {
    ideas.push({
      id: `idea-${i}`,
      elo_rating: rng.nextInt(1100, 1300),
    });
  }
  return ideas;
}

// ---------------------------------------------------------------------------
// Test: expectedScore — float comparison
// ---------------------------------------------------------------------------

test('expectedScore: TS and MJS produce identical results', () => {
  const rng = new LCG(42);

  for (let i = 0; i < 20; i++) {
    const a = rng.nextInt(800, 2000);
    const b = rng.nextInt(800, 2000);

    const ts = expectedScoreTS(a, b);
    const mjs = expectedScoreMJS(a, b);

    assert.strictEqual(
      Math.abs(ts - mjs) < 1e-9,
      true,
      `expectedScore(${a}, ${b}): TS=${ts}, MJS=${mjs}`
    );
  }
});

// ---------------------------------------------------------------------------
// Test: updateElo — exact tuple match
// ---------------------------------------------------------------------------

test('updateElo: TS and MJS produce identical results (all winner states)', () => {
  const rng = new LCG(99);

  for (let i = 0; i < 20; i++) {
    const a = rng.nextInt(1000, 1800);
    const b = rng.nextInt(1000, 1800);

    // Test 'a' wins
    const tsA = updateEloTS(a, b, 'a');
    const mjsA = updateEloMJS(a, b, 'a');
    assert.deepStrictEqual(tsA, mjsA, `updateElo(${a}, ${b}, 'a')`);

    // Test 'b' wins
    const tsB = updateEloTS(a, b, 'b');
    const mjsB = updateEloMJS(a, b, 'b');
    assert.deepStrictEqual(tsB, mjsB, `updateElo(${a}, ${b}, 'b')`);

    // Test 'tie'
    const tsTie = updateEloTS(a, b, 'tie');
    const mjsTie = updateEloMJS(a, b, 'tie');
    assert.deepStrictEqual(tsTie, mjsTie, `updateElo(${a}, ${b}, 'tie')`);
  }
});

// ---------------------------------------------------------------------------
// Test: swissPairs — pair-by-pair comparison
// ---------------------------------------------------------------------------

test('swissPairs: TS and MJS produce identical results', () => {
  const rng = new LCG(777);

  for (let i = 0; i < 20; i++) {
    const count = rng.nextInt(4, 12);
    const ideas = generateRandomIdeas(rng, count);

    const tsPairs = swissPairsTS(ideas);
    const mjsPairs = swissPairsMJS(ideas);

    // Same number of pairs
    assert.strictEqual(
      tsPairs.length,
      mjsPairs.length,
      `swissPairs: pair count mismatch for ${count} ideas`
    );

    // Compare each pair: id and elo_rating
    for (let j = 0; j < tsPairs.length; j++) {
      const [tsA, tsB] = tsPairs[j];
      const [mjsA, mjsB] = mjsPairs[j];

      assert.strictEqual(tsA.id, mjsA.id, `Pair ${j}: id mismatch for A`);
      assert.strictEqual(tsA.elo_rating, mjsA.elo_rating, `Pair ${j}: elo_rating mismatch for A`);
      assert.strictEqual(tsB.id, mjsB.id, `Pair ${j}: id mismatch for B`);
      assert.strictEqual(tsB.elo_rating, mjsB.elo_rating, `Pair ${j}: elo_rating mismatch for B`);
    }
  }
});

// ---------------------------------------------------------------------------
// Edge Case: All-1200 Elo (N/2 pairs, odd one dropped)
// ---------------------------------------------------------------------------

test('Edge: swissPairs all-1200 Elo drops odd idea', () => {
  const oddCounts = [3, 5, 7, 9];
  for (const count of oddCounts) {
    const ideas = [];
    for (let i = 0; i < count; i++) {
      ideas.push({ id: `idea-${i}`, elo_rating: 1200 });
    }

    const tsPairs = swissPairsTS(ideas);
    const mjsPairs = swissPairsMJS(ideas);

    // Should produce floor(N/2) pairs
    const expectedPairs = Math.floor(count / 2);
    assert.strictEqual(tsPairs.length, expectedPairs, `Expected ${expectedPairs} pairs for ${count} ideas (TS)`);
    assert.strictEqual(mjsPairs.length, expectedPairs, `Expected ${expectedPairs} pairs for ${count} ideas (MJS)`);
  }
});

// ---------------------------------------------------------------------------
// Edge Case: Elo K=32 sanity check (A beats B from 1200)
// ---------------------------------------------------------------------------

test('Edge: updateElo K=32 sanity (A 1200 beats B 1200)', () => {
  const [newA, newB] = updateEloMJS(1200, 1200, 'a');

  // Expected: A = 1200 + 32 * (1 - 0.5) = 1200 + 16 = 1216
  //           B = 1200 - 32 * 0.5     = 1200 - 16 = 1184
  assert.strictEqual(newA, 1216, `A should be 1216, got ${newA}`);
  assert.strictEqual(newB, 1184, `B should be 1184, got ${newB}`);
});

// ---------------------------------------------------------------------------
// Edge Case: Tie returns unchanged Elo
// ---------------------------------------------------------------------------

test('Edge: updateElo tie returns unchanged values', () => {
  const [newA, newB] = updateEloMJS(1500, 1500, 'tie');

  assert.strictEqual(newA, 1500, `A should remain 1500, got ${newA}`);
  assert.strictEqual(newB, 1500, `B should remain 1500, got ${newB}`);
});
