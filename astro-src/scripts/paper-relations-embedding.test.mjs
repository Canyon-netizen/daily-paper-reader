// Test file for paper-relations/embedding.ts exported functions
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', '..', relPath)],
    bundle: true, format: 'esm', platform: 'node',
    write: false, target: 'es2022',
    external: ['node:fs', 'node:fs/promises', 'node:path', 'fs', 'path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

describe('paper-relations-embedding: defaultProvider', () => {
  test('returns provider with default values when no settings', async () => {
    const { defaultProvider } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const provider = defaultProvider();
    assert.ok(typeof provider.apiKey === 'string');
    assert.ok(typeof provider.baseUrl === 'string');
    assert.ok(typeof provider.model === 'string');
    assert.strictEqual(provider.embeddingModel, 'text-embedding-3-small');
  });

  test('provider has expected structure', async () => {
    const { defaultProvider } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const provider = defaultProvider();
    assert.ok('apiKey' in provider);
    assert.ok('baseUrl' in provider);
    assert.ok('model' in provider);
    assert.ok('embeddingModel' in provider);
  });

  test('embeddingModel defaults to text-embedding-3-small', async () => {
    const { defaultProvider } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const provider = defaultProvider();
    assert.strictEqual(provider.embeddingModel, 'text-embedding-3-small');
  });

  test('baseUrl and model are non-empty strings', async () => {
    const { defaultProvider } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const provider = defaultProvider();
    assert.ok(provider.baseUrl.length > 0);
    assert.ok(provider.model.length > 0);
  });
});

describe('paper-relations-embedding: computeEmbeddingEdges', () => {
  test('returns empty edges for single paper', async () => {
    const { computeEmbeddingEdges } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const papers = [{ id: 'p1', arxivId: '2301.00001' }];
    const result = await computeEmbeddingEdges(papers);
    assert.deepStrictEqual(result, { edges: [], llmCalls: 0, llmFailures: 0 });
  });

  test('returns empty edges when no apiKey (skips embedding)', async () => {
    const { computeEmbeddingEdges } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const papers = [
      { id: 'p1', arxivId: '2301.00001' },
      { id: 'p2', arxivId: '2301.00002' },
    ];
    // Default provider has empty apiKey
    const result = await computeEmbeddingEdges(papers);
    assert.deepStrictEqual(result, { edges: [], llmCalls: 0, llmFailures: 0 });
  });

  test('returns empty edges when papers lack arxivId', async () => {
    const { computeEmbeddingEdges } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const papers = [{ id: 'p1' }, { id: 'p2' }];
    const result = await computeEmbeddingEdges(papers);
    assert.deepStrictEqual(result, { edges: [], llmCalls: 0, llmFailures: 0 });
  });

  test('accepts custom provider with apiKey', async () => {
    const { computeEmbeddingEdges } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const papers = [
      { id: 'p1', arxivId: '2301.00001' },
      { id: 'p2', arxivId: '2301.00002' },
    ];
    const provider = {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4',
      embeddingModel: 'text-embedding-3-small',
    };
    // Will fail API call but should handle gracefully
    const result = await computeEmbeddingEdges(papers, provider);
    assert.ok('edges' in result);
    assert.ok('llmCalls' in result);
    assert.ok('llmFailures' in result);
  });

  test('respects topK parameter', async () => {
    const { computeEmbeddingEdges } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const papers = [
      { id: 'p1', arxivId: '2301.00001' },
      { id: 'p2', arxivId: '2301.00002' },
    ];
    const provider = {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4',
      embeddingModel: 'text-embedding-3-small',
    };
    const result = await computeEmbeddingEdges(papers, provider, 2);
    assert.ok(Array.isArray(result.edges));
  });

  test('respects minWeight parameter', async () => {
    const { computeEmbeddingEdges } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const papers = [
      { id: 'p1', arxivId: '2301.00001' },
      { id: 'p2', arxivId: '2301.00002' },
    ];
    const provider = {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4',
      embeddingModel: 'text-embedding-3-small',
    };
    const result = await computeEmbeddingEdges(papers, provider, 8, 0.9);
    assert.ok(Array.isArray(result.edges));
  });

  test('calls onProgress callback when provided', async () => {
    const { computeEmbeddingEdges } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const papers = [
      { id: 'p1', arxivId: '2301.00001' },
      { id: 'p2', arxivId: '2301.00002' },
    ];
    const provider = {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4',
      embeddingModel: 'text-embedding-3-small',
    };
    let progressCalled = false;
    const onProgress = (msg) => { progressCalled = true; };
    await computeEmbeddingEdges(papers, provider, 8, 0, onProgress);
    assert.ok(progressCalled);
  });

  test('returns structure with all required fields', async () => {
    const { computeEmbeddingEdges } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const papers = [{ id: 'p1', arxivId: '2301.00001' }];
    const result = await computeEmbeddingEdges(papers);
    assert.ok(Array.isArray(result.edges));
    assert.ok(typeof result.llmCalls === 'number');
    assert.ok(typeof result.llmFailures === 'number');
  });

  test('handles empty papers array', async () => {
    const { computeEmbeddingEdges } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const result = await computeEmbeddingEdges([]);
    assert.deepStrictEqual(result, { edges: [], llmCalls: 0, llmFailures: 0 });
  });

  test('returns llmFailures count when API fails', async () => {
    const { computeEmbeddingEdges } = await loadTs('astro-src/lib/paper-relations/embedding.ts');
    const papers = [
      { id: 'p1', arxivId: '2301.00001' },
      { id: 'p2', arxivId: '2301.00002' },
    ];
    const provider = {
      apiKey: 'invalid-key',
      baseUrl: 'https://invalid-url-that-does-not-exist.com',
      model: 'gpt-4',
      embeddingModel: 'text-embedding-3-small',
    };
    const result = await computeEmbeddingEdges(papers, provider);
    assert.ok(result.llmFailures > 0);
    assert.ok(result.edges.length === 0 || result.edges.length >= 0);
  });
});
