import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mock localStorage before loading the module
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
  get length() { return storage.size; },
  key: (i) => Array.from(storage.keys())[i] ?? null,
};

async function loadTs(relPath) {
  // Note: lib/storage.ts is just a re-export file, so we load from scripts/settings.ts
  // to get the full API that lib/storage.ts re-exports
  const targetPath = relPath === 'lib/storage.ts' ? 'scripts/settings.ts' : relPath;
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', targetPath)],
    bundle: true, format: 'esm', platform: 'node',
    write: false, target: 'es2022',
    external: ['node:fs', 'node:fs/promises', 'node:path', 'node:url'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

function clearStorage() {
  storage.clear();
}

test.describe('storage - STORAGE_KEYS', () => {
  test('STORAGE_KEYS has all expected keys', async () => {
    const mod = await loadTs('lib/storage.ts');
    const keys = mod.STORAGE_KEYS;
    assert.ok(keys.llm);
    assert.ok(keys.provider);
    assert.ok(keys.proxy);
    assert.ok(keys.githubToken);
    assert.ok(keys.gistId);
    assert.ok(keys.topics);
    assert.ok(keys.categories);
    assert.ok(keys.hiddenPapers);
    assert.ok(keys.userTags);
    assert.ok(keys.selection);
    assert.ok(keys.llmProxy);
  });

  test('STORAGE_KEYS values are stable strings', async () => {
    const mod = await loadTs('lib/storage.ts');
    const keys = mod.STORAGE_KEYS;
    for (const [k, v] of Object.entries(keys)) {
      assert.strictEqual(typeof v, 'string', `${k} should be a string`);
      assert.ok(v.length > 0, `${k} should not be empty`);
    }
  });
});

test.describe('storage - GITHUB_REPO_DEFAULT', () => {
  test('has correct default values', async () => {
    const mod = await loadTs('lib/storage.ts');
    assert.deepStrictEqual(mod.GITHUB_REPO_DEFAULT, {
      owner: 'Canyon-netizen',
      repo: 'daily-paper-reader',
      workflow: 'save-paper.yml',
    });
  });
});

test.describe('storage - loadGitHubToken / setGitHubToken', () => {
  test('loadGitHubToken returns empty when not set', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    assert.strictEqual(mod.loadGitHubToken(), '');
  });

  test('setGitHubToken then loadGitHubToken returns the token', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.setGitHubToken('my_test_token');
    assert.strictEqual(mod.loadGitHubToken(), 'my_test_token');
  });

  test('setGitHubToken with empty string removes the token', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.setGitHubToken('some_token');
    mod.setGitHubToken('');
    assert.strictEqual(mod.loadGitHubToken(), '');
  });

  test('loadGitHubToken trims whitespace', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.setGitHubToken('  token_with_spaces  ');
    assert.strictEqual(mod.loadGitHubToken(), 'token_with_spaces');
  });

  test('loadGitHubToken reads legacy key for backward compatibility', async () => {
    clearStorage();
    // Set legacy key directly
    storage.set('dpr_analyzer_gist_token_v1', 'legacy_token_value');
    const mod = await loadTs('lib/storage.ts');
    assert.strictEqual(mod.loadGitHubToken(), 'legacy_token_value');
  });
});

test.describe('storage - getGistToken / setGistToken', () => {
  test('getGistToken is alias for loadGitHubToken', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.setGitHubToken('shared_token');
    assert.strictEqual(mod.getGistToken(), 'shared_token');
  });

  test('setGistToken is alias for setGitHubToken', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.setGistToken('via_gist_alias');
    assert.strictEqual(mod.getGistToken(), 'via_gist_alias');
  });
});

test.describe('storage - loadGitHubRepo / setGitHubRepo', () => {
  test('loadGitHubRepo returns defaults when not set', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    const repo = mod.loadGitHubRepo();
    assert.strictEqual(repo.owner, 'Canyon-netizen');
    assert.strictEqual(repo.repo, 'daily-paper-reader');
    assert.strictEqual(repo.workflow, 'save-paper.yml');
  });

  test('loadGitHubRepo returns custom values when set', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.setGitHubRepo({ owner: 'myowner', repo: 'myrepo', workflow: 'myworkflow.yml' });
    const repo = mod.loadGitHubRepo();
    assert.strictEqual(repo.owner, 'myowner');
    assert.strictEqual(repo.repo, 'myrepo');
    assert.strictEqual(repo.workflow, 'myworkflow.yml');
  });

  test('setGitHubRepo can set partial values', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.setGitHubRepo({ owner: 'newowner' });
    const repo = mod.loadGitHubRepo();
    assert.strictEqual(repo.owner, 'newowner');
    assert.strictEqual(repo.repo, 'daily-paper-reader'); // default
  });
});

test.describe('storage - LLM_DEFAULTS', () => {
  test('LLM_DEFAULTS has expected structure', async () => {
    const mod = await loadTs('lib/storage.ts');
    assert.strictEqual(mod.LLM_DEFAULTS.baseUrl, 'https://api.deepseek.com');
    assert.strictEqual(mod.LLM_DEFAULTS.model, 'deepseek-chat');
  });
});

test.describe('storage - loadSettings / loadProvider', () => {
  test('loadSettings returns defaults when not set', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    const settings = mod.loadSettings();
    assert.strictEqual(settings.apiKey, '');
    assert.strictEqual(settings.baseUrl, 'https://api.deepseek.com');
    assert.strictEqual(settings.model, 'deepseek-chat');
  });

  test('loadSettings returns stored settings', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    const stored = { apiKey: 'secret123', baseUrl: 'https://custom.api', model: 'custom-model' };
    storage.set(mod.STORAGE_KEYS.llm, JSON.stringify(stored));
    const settings = mod.loadSettings();
    assert.strictEqual(settings.apiKey, 'secret123');
    assert.strictEqual(settings.baseUrl, 'https://custom.api');
    assert.strictEqual(settings.model, 'custom-model');
  });

  test('loadProvider returns default when not set', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    assert.strictEqual(mod.loadProvider(), 'deepseek');
  });

  test('loadProvider returns stored provider', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    storage.set(mod.STORAGE_KEYS.provider, 'moonshot');
    assert.strictEqual(mod.loadProvider(), 'moonshot');
  });
});

test.describe('storage - hidden papers', () => {
  test('loadHiddenPapers returns empty array when not set', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    assert.deepStrictEqual(mod.loadHiddenPapers(), []);
  });

  test('addHiddenPaper adds a paper', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    const result = mod.addHiddenPaper('2301.12345');
    assert.strictEqual(result, true);
    assert.deepStrictEqual(mod.loadHiddenPapers(), ['2301.12345']);
  });

  test('addHiddenPaper returns false for duplicate', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.addHiddenPaper('2301.12345');
    const result = mod.addHiddenPaper('2301.12345');
    assert.strictEqual(result, false);
    assert.deepStrictEqual(mod.loadHiddenPapers(), ['2301.12345']);
  });

  test('addHiddenPaper returns false for empty id', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    assert.strictEqual(mod.addHiddenPaper(''), false);
    // Note: whitespace-only string is truthy in JS, so it would be added (not a falsy check)
    // This matches the implementation which only checks !arxivId (empty string)
  });

  test('removeHiddenPaper removes existing paper', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.addHiddenPaper('2301.12345');
    mod.addHiddenPaper('2302.23456');
    const result = mod.removeHiddenPaper('2301.12345');
    assert.strictEqual(result, true);
    assert.deepStrictEqual(mod.loadHiddenPapers(), ['2302.23456']);
  });

  test('removeHiddenPaper returns false for non-existent paper', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    const result = mod.removeHiddenPaper('2301.12345');
    assert.strictEqual(result, false);
  });

  test('isPaperHidden returns correct status', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    assert.strictEqual(mod.isPaperHidden('2301.12345'), false);
    mod.addHiddenPaper('2301.12345');
    assert.strictEqual(mod.isPaperHidden('2301.12345'), true);
    assert.strictEqual(mod.isPaperHidden(''), false);
  });
});

test.describe('storage - user tags', () => {
  test('loadUserTags returns empty object when not set', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    assert.deepStrictEqual(mod.loadUserTags(), {});
  });

  test('getUserTags returns empty array for unknown paper', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    assert.deepStrictEqual(mod.getUserTags('2301.12345'), []);
  });

  test('addTag adds a tag to a paper', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    const result = mod.addTag('2301.12345', 'important', '重要');
    assert.strictEqual(result, true);
    const tags = mod.getUserTags('2301.12345');
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].kind, 'important');
    assert.strictEqual(tags[0].label, '重要');
  });

  test('addTag returns false for duplicate tag', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.addTag('2301.12345', 'important', '重要');
    const result = mod.addTag('2301.12345', 'important', '重要');
    assert.strictEqual(result, false);
  });

  test('addTag returns false for invalid inputs', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    assert.strictEqual(mod.addTag('', 'kind', 'label'), false);
    assert.strictEqual(mod.addTag('2301.12345', '', 'label'), false);
    assert.strictEqual(mod.addTag('2301.12345', 'kind', ''), false);
  });

  test('removeTag removes an existing tag', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.addTag('2301.12345', 'important', '重要');
    const result = mod.removeTag('2301.12345', 'important', '重要');
    assert.strictEqual(result, true);
    assert.deepStrictEqual(mod.getUserTags('2301.12345'), []);
  });

  test('removeTag returns false for non-existent tag', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    const result = mod.removeTag('2301.12345', 'nonexistent', '标签');
    assert.strictEqual(result, false);
  });

  test('setUserTags replaces tags for a paper', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.addTag('2301.12345', 'old', '旧');
    mod.setUserTags('2301.12345', [{ kind: 'new', label: '新', addedAt: 1234567890000 }]);
    const tags = mod.getUserTags('2301.12345');
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].kind, 'new');
  });

  test('setUserTags with null removes all tags', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.addTag('2301.12345', 'tag', '标签');
    mod.setUserTags('2301.12345', null);
    assert.deepStrictEqual(mod.getUserTags('2301.12345'), []);
  });

  test('clearAllUserTags clears all tags', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.addTag('2301.12345', 'tag1', '标签1');
    mod.addTag('2302.23456', 'tag2', '标签2');
    const count = mod.clearAllUserTags();
    assert.strictEqual(count, 2);
    assert.deepStrictEqual(mod.loadUserTags(), {});
  });
});

test.describe('storage - Gist functions', () => {
  test('getGistId returns empty when not set', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    assert.strictEqual(mod.getGistId(), '');
  });

  test('setGistId then getGistId returns the id', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.setGistId('abc123gist');
    assert.strictEqual(mod.getGistId(), 'abc123gist');
  });

  test('setGistId with empty string removes the id', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.setGistId('somegist');
    mod.setGistId('');
    assert.strictEqual(mod.getGistId(), '');
  });
});

test.describe('storage - proxy functions', () => {
  test('getCustomProxy returns default when not set', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    assert.strictEqual(mod.getCustomProxy(), 'https://daily-paper-reader.pages.dev/api/proxy');
  });

  test('getCustomProxy returns custom value when set', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    storage.set(mod.STORAGE_KEYS.proxy, 'https://my-proxy.example.com/api');
    assert.strictEqual(mod.getCustomProxy(), 'https://my-proxy.example.com/api');
  });

  test('getCustomProxy adds https if missing', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    storage.set(mod.STORAGE_KEYS.proxy, 'my-proxy.example.com/api');
    assert.strictEqual(mod.getCustomProxy(), 'https://my-proxy.example.com/api');
  });

  test('getCustomProxy trims trailing slashes', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    storage.set(mod.STORAGE_KEYS.proxy, 'https://proxy.example.com/api///');
    assert.strictEqual(mod.getCustomProxy(), 'https://proxy.example.com/api');
  });

  test('setCustomProxy sets and trims value', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.setCustomProxy('  https://new-proxy.example.com/api  ');
    assert.strictEqual(mod.getCustomProxy(), 'https://new-proxy.example.com/api');
  });

  test('setCustomProxy with empty removes the value', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    storage.set(mod.STORAGE_KEYS.proxy, 'someproxy');
    mod.setCustomProxy('');
    assert.strictEqual(mod.getCustomProxy(), 'https://daily-paper-reader.pages.dev/api/proxy');
  });
});

test.describe('storage - LLM proxy functions', () => {
  test('getCustomLLMProxy returns empty when not set', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    assert.strictEqual(mod.getCustomLLMProxy(), '');
  });

  test('setCustomLLMProxy sets custom proxy', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    mod.setCustomLLMProxy('http://localhost:8124');
    assert.strictEqual(mod.getCustomLLMProxy(), 'http://localhost:8124');
  });

  test('getCustomLLMProxy adds http if missing', async () => {
    clearStorage();
    const mod = await loadTs('lib/storage.ts');
    storage.set(mod.STORAGE_KEYS.llmProxy, 'localhost:8124');
    assert.strictEqual(mod.getCustomLLMProxy(), 'http://localhost:8124');
  });
});
