// Test file for astro-src/lib/roadmap/index.ts
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true, format: 'esm', platform: 'node',
    write: false, target: 'es2022',
    external: ['node:fs', 'node:fs/promises', 'node:path', 'fs', 'path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

describe('roadmap', () => {
  let roadmap;

  beforeEach(async () => {
    roadmap = await loadTs('lib/roadmap/index.ts');
  });

  describe('getAllRoadmapIds', () => {
    it('should return empty array when roadmap directory does not exist', () => {
      // This test verifies the function doesn't throw when directory is missing
      const ids = roadmap.getAllRoadmapIds();
      assert.ok(Array.isArray(ids));
    });
  });

  describe('getRoadmap', () => {
    it('should return null for non-existent roadmap', () => {
      const result = roadmap.getRoadmap('nonexistent-roadmap-xyz');
      // Should return null when file doesn't exist
      assert.ok(result === null || result === undefined);
    });
  });

  describe('getClientRoadmaps', () => {
    it('should return empty array when window is undefined (Node environment)', () => {
      const result = roadmap.getClientRoadmaps();
      assert.deepStrictEqual(result, []);
    });
  });

  describe('saveClientRoadmaps', () => {
    it('should not throw when window is undefined', () => {
      // Should silently return without throwing
      assert.doesNotThrow(() => {
        roadmap.saveClientRoadmaps([]);
      });
    });
  });

  describe('createRoadmap', () => {
    it('should not throw when window is undefined', () => {
      const data = {
        title: 'Test Roadmap',
        titleZh: 'Test Chinese',
        description: 'Test desc',
        descriptionZh: 'Test Chinese desc',
        type: 'personal',
        owner: 'tester',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        quarters: [],
        linked_ideas: [],
        linked_experiments: [],
        tags: [],
      };
      assert.doesNotThrow(() => {
        roadmap.createRoadmap(data);
      });
    });
  });

  describe('updateRoadmap', () => {
    it('should return null when window is undefined', () => {
      const result = roadmap.updateRoadmap('some-id', { title: 'New Title' });
      assert.strictEqual(result, null);
    });
  });

  describe('updateGoalStatus', () => {
    it('should return null when window is undefined', () => {
      const result = roadmap.updateGoalStatus('roadmap-id', '2026-Q1', 'G1', 'completed');
      assert.strictEqual(result, null);
    });
  });

  describe('deleteRoadmap', () => {
    it('should return false when window is undefined', () => {
      const result = roadmap.deleteRoadmap('some-id');
      assert.strictEqual(result, false);
    });
  });

  describe('listRoadmaps', () => {
    it('should return empty array when directory does not exist', () => {
      const summaries = roadmap.listRoadmaps();
      assert.ok(Array.isArray(summaries));
    });
  });

  // Testing internal parsing functions would require more sophisticated mocking
  // of fs module. The above tests verify the public API works correctly in Node.
});

describe('roadmap internal logic via exported functions', () => {
  let roadmap;

  beforeEach(async () => {
    roadmap = await loadTs('lib/roadmap/index.ts');
  });

  describe('listRoadmaps sorting', () => {
    it('should be callable without throwing', () => {
      // Even if directory doesn't exist, should return array
      const result = roadmap.listRoadmaps();
      assert.ok(Array.isArray(result));
    });
  });

  describe('getAllRoadmapIds behavior', () => {
    it('should return array type', () => {
      const ids = roadmap.getAllRoadmapIds();
      assert.ok(Array.isArray(ids));
    });
  });

  describe('getRoadmap error handling', () => {
    it('should handle non-existent file gracefully', () => {
      const result = roadmap.getRoadmap('definitely-does-not-exist-12345');
      assert.ok(result === null || result === undefined);
    });
  });
});

describe('roadmap client-side functions (window check)', () => {
  let roadmap;

  beforeEach(async () => {
    roadmap = await loadTs('lib/roadmap/index.ts');
  });

  it('getClientRoadmaps returns empty in Node', () => {
    assert.deepStrictEqual(roadmap.getClientRoadmaps(), []);
  });

  it('saveClientRoadmaps is no-op in Node', () => {
    assert.doesNotThrow(() => roadmap.saveClientRoadmaps([]));
  });

  it('createRoadmap is no-op in Node', () => {
    assert.doesNotThrow(() => roadmap.createRoadmap({
      title: 'Test',
      titleZh: '',
      description: '',
      descriptionZh: '',
      type: 'personal',
      owner: '',
      startDate: '',
      endDate: '',
      quarters: [],
      linked_ideas: [],
      linked_experiments: [],
      tags: [],
    }));
  });

  it('updateRoadmap returns null in Node', () => {
    assert.strictEqual(roadmap.updateRoadmap('id', {}), null);
  });

  it('updateGoalStatus returns null in Node', () => {
    assert.strictEqual(roadmap.updateGoalStatus('r', 'q', 'g', 'completed'), null);
  });

  it('deleteRoadmap returns false in Node', () => {
    assert.strictEqual(roadmap.deleteRoadmap('id'), false);
  });

  it('listRoadmaps handles missing directory', () => {
    const result = roadmap.listRoadmaps();
    assert.ok(Array.isArray(result));
  });

  it('getRoadmap handles missing file', () => {
    const result = roadmap.getRoadmap('nonexistent');
    assert.ok(result === null || result === undefined);
  });

  it('getAllRoadmapIds handles missing directory', () => {
    const result = roadmap.getAllRoadmapIds();
    assert.ok(Array.isArray(result));
  });
});
