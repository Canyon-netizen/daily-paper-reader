// Test file for astro-src/lib/llm/route.ts
import { describe, it, beforeEach } from 'node:test';
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

describe('llm/route', () => {
  let route;

  beforeEach(async () => {
    route = await loadTs('lib/llm/route.ts');
    // Clear cache before each test
    route.invalidateRouteCache();
  });

  describe('resolveRoute', () => {
    it('should return route for analyzer_system', () => {
      const r = route.resolveRoute('analyzer_system');
      assert.strictEqual(r.provider, 'deepseek');
      assert.strictEqual(r.model, 'deepseek-chat');
      assert.strictEqual(r.temperature, 0.2);
      assert.strictEqual(r.isStream, undefined);
    });

    it('should return route for analyzer_deepdive with isStream', () => {
      const r = route.resolveRoute('analyzer_deepdive');
      assert.strictEqual(r.provider, 'deepseek');
      assert.strictEqual(r.model, 'deepseek-chat');
      assert.strictEqual(r.temperature, 0.4);
      assert.strictEqual(r.isStream, true);
    });

    it('should return route for topic_facet', () => {
      const r = route.resolveRoute('topic_facet');
      assert.strictEqual(r.provider, 'deepseek');
      assert.strictEqual(r.model, 'deepseek-chat');
      assert.strictEqual(r.temperature, 0.4);
    });

    it('should return route for topic_summary', () => {
      const r = route.resolveRoute('topic_summary');
      assert.strictEqual(r.temperature, 0.3);
    });

    it('should return route for topic_report with openai provider', () => {
      const r = route.resolveRoute('topic_report');
      assert.strictEqual(r.provider, 'openai');
      assert.strictEqual(r.model, 'gpt-4o-mini');
      assert.strictEqual(r.temperature, 0.6);
      assert.strictEqual(r.isStream, true);
    });

    it('should return route for topic_cand', () => {
      const r = route.resolveRoute('topic_cand');
      assert.strictEqual(r.temperature, 0.3);
    });

    it('should return route for topic_explore', () => {
      const r = route.resolveRoute('topic_explore');
      assert.strictEqual(r.temperature, 0.5);
    });

    it('should return route for topic_chat', () => {
      const r = route.resolveRoute('topic_chat');
      assert.strictEqual(r.temperature, 0.4);
      assert.strictEqual(r.isStream, undefined);
    });

    it('should return route for library_compile with isStream', () => {
      const r = route.resolveRoute('library_compile');
      assert.strictEqual(r.provider, 'deepseek');
      assert.strictEqual(r.model, 'deepseek-chat');
      assert.strictEqual(r.temperature, 0.4);
      assert.strictEqual(r.isStream, true);
    });

    it('should return route for library_relevance with reasoner', () => {
      const r = route.resolveRoute('library_relevance');
      assert.strictEqual(r.provider, 'deepseek');
      assert.strictEqual(r.model, 'deepseek-reasoner');
      assert.strictEqual(r.temperature, 0.2);
    });

    it('should return route for library_concept_def', () => {
      const r = route.resolveRoute('library_concept_def');
      assert.strictEqual(r.model, 'deepseek-chat');
      assert.strictEqual(r.temperature, 0.2);
    });

    it('should return route for library_figure with gemini', () => {
      const r = route.resolveRoute('library_figure');
      assert.strictEqual(r.provider, 'deepseek');
      assert.strictEqual(r.model, 'gemini-2.5-pro');
      assert.strictEqual(r.temperature, 0.2);
    });

    it('should return route for library_digest', () => {
      const r = route.resolveRoute('library_digest');
      assert.strictEqual(r.temperature, 0.3);
    });

    it('should return route for library_digest_synth with isStream', () => {
      const r = route.resolveRoute('library_digest_synth');
      assert.strictEqual(r.isStream, true);
      assert.strictEqual(r.temperature, 0.4);
    });

    it('should return route for library_trend with isStream', () => {
      const r = route.resolveRoute('library_trend');
      assert.strictEqual(r.isStream, true);
      assert.strictEqual(r.temperature, 0.4);
    });

    it('should return route for library_chat with isStream', () => {
      const r = route.resolveRoute('library_chat');
      assert.strictEqual(r.isStream, true);
      assert.strictEqual(r.temperature, 0.4);
    });

    it('should return route for paper.method_debate', () => {
      const r = route.resolveRoute('paper.method_debate');
      assert.strictEqual(r.provider, 'deepseek');
      assert.strictEqual(r.temperature, 0.5);
    });

    it('should return route for paper.deep_extract', () => {
      const r = route.resolveRoute('paper.deep_extract');
      assert.strictEqual(r.temperature, 0.3);
    });

    it('should return route for topic.debate', () => {
      const r = route.resolveRoute('topic.debate');
      assert.strictEqual(r.temperature, 0.7);
    });

    it('should return route for elo.debate', () => {
      const r = route.resolveRoute('elo.debate');
      assert.strictEqual(r.temperature, 0.7);
    });

    it('should return default route for unknown stage', () => {
      const r = route.resolveRoute('unknown_stage_xyz');
      assert.strictEqual(r.provider, 'deepseek');
      assert.strictEqual(r.model, 'deepseek-chat');
      assert.strictEqual(r.temperature, 0.5);
      assert.strictEqual(r.isStream, undefined);
    });

    it('should return default route for empty string', () => {
      const r = route.resolveRoute('');
      assert.strictEqual(r.provider, 'deepseek');
      assert.strictEqual(r.model, 'deepseek-chat');
    });
  });

  describe('invalidateRouteCache', () => {
    it('should clear the route cache', () => {
      // First, populate cache
      route.resolveRoute('analyzer_system');
      // Then invalidate
      route.invalidateRouteCache();
      // Should still work and repopulate
      const r = route.resolveRoute('analyzer_system');
      assert.strictEqual(r.model, 'deepseek-chat');
    });
  });

  describe('cache behavior', () => {
    it('should cache route results', () => {
      const r1 = route.resolveRoute('analyzer_system');
      const r2 = route.resolveRoute('analyzer_system');
      // Should return same object reference (cached)
      assert.strictEqual(r1, r2);
    });
  });
});
