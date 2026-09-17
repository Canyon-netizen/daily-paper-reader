import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true, format: 'esm', platform: 'node',
    write: false, target: 'es2022',
    external: ['node:fs', 'node:fs/promises', 'node:path', 'node:url'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

// Clear cache between tests that depend on process.env
function clearGhTokenCache() {
  // The module has internal cache, we need to re-import to reset it
}

test.describe('lastUpdated', () => {
  test('readGhToken returns empty when no token', async () => {
    // Save original env
    const orig = process.env.GH_TOKEN;
    delete process.env.GH_TOKEN;
    // Also clear any gh_token variant
    for (const k of Object.keys(process.env)) {
      if (k.toUpperCase() === 'GH_TOKEN' && k !== 'GH_TOKEN') {
        delete process.env[k];
      }
    }

    const mod = await loadTs('lib/lastUpdated.ts');
    const result = mod.readGhToken();

    assert.strictEqual(result, '');

    // Restore
    if (orig) process.env.GH_TOKEN = orig;
  });

  test('readGhToken returns GH_TOKEN when present', async () => {
    const orig = process.env.GH_TOKEN;
    process.env.GH_TOKEN = 'test_token_abc123';

    const mod = await loadTs('lib/lastUpdated.ts');
    const result = mod.readGhToken();

    assert.strictEqual(result, 'test_token_abc123');

    // Restore
    if (orig) process.env.GH_TOKEN = orig;
    else delete process.env.GH_TOKEN;
  });

  test('readGhToken finds gh_token (lowercase) variant', async () => {
    const orig = process.env.GH_TOKEN;
    delete process.env.GH_TOKEN;
    process.env.gh_token = 'token_from_lowercase';

    const mod = await loadTs('lib/lastUpdated.ts');
    const result = mod.readGhToken();

    assert.strictEqual(result, 'token_from_lowercase');
    // After finding, it should populate GH_TOKEN
    assert.strictEqual(process.env.GH_TOKEN, 'token_from_lowercase');

    // Restore
    delete process.env.GH_TOKEN;
    delete process.env.gh_token;
    if (orig) process.env.GH_TOKEN = orig;
  });

  test('readGhToken finds GH_TOKEN variant (case insensitive)', async () => {
    const orig = process.env.GH_TOKEN;
    delete process.env.GH_TOKEN;
    process.env.Gh_Token = 'token_from_mixed_case';

    const mod = await loadTs('lib/lastUpdated.ts');
    const result = mod.readGhToken();

    assert.strictEqual(result, 'token_from_mixed_case');
    // After finding, it should populate GH_TOKEN
    assert.strictEqual(process.env.GH_TOKEN, 'token_from_mixed_case');

    // Restore
    delete process.env.GH_TOKEN;
    delete process.env.Gh_Token;
    if (orig) process.env.GH_TOKEN = orig;
  });

  test('readGhToken returns empty string for empty value', async () => {
    const orig = process.env.GH_TOKEN;
    process.env.GH_TOKEN = '';

    const mod = await loadTs('lib/lastUpdated.ts');
    const result = mod.readGhToken();

    assert.strictEqual(result, '');

    // Restore
    if (orig) process.env.GH_TOKEN = orig;
    else delete process.env.GH_TOKEN;
  });

  test('readGhToken prefers standard GH_TOKEN over variants', async () => {
    const orig = process.env.GH_TOKEN;
    process.env.GH_TOKEN = 'standard_token';
    process.env.gh_token = 'lowercase_token';

    const mod = await loadTs('lib/lastUpdated.ts');
    const result = mod.readGhToken();

    assert.strictEqual(result, 'standard_token');

    // Restore
    if (orig) process.env.GH_TOKEN = orig;
    else delete process.env.GH_TOKEN;
    delete process.env.gh_token;
  });
});

test.describe('lastUpdated - pure functions from dependencies', () => {
  test('STORAGE_KEYS exists and has expected keys', async () => {
    const settings = await loadTs('scripts/settings.ts');
    assert.ok(settings.STORAGE_KEYS);
    assert.strictEqual(settings.STORAGE_KEYS.llm, 'dpr_analyzer_v1');
    assert.strictEqual(settings.STORAGE_KEYS.hiddenPapers, 'dpr_hidden_papers_v1');
  });

  test('GITHUB_REPO_DEFAULT has correct structure', async () => {
    const settings = await loadTs('scripts/settings.ts');
    assert.deepStrictEqual(settings.GITHUB_REPO_DEFAULT, {
      owner: 'Canyon-netizen',
      repo: 'daily-paper-reader',
      workflow: 'save-paper.yml',
    });
  });
});
