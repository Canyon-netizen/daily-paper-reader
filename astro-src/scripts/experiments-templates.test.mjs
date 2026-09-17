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
    external: ['node:fs', 'node:fs/promises', 'node:path', 'fs', 'path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

// Tests for astro-src/lib/experiments/templates.ts
test('experimentTemplates is exported and non-empty', async () => {
  const { experimentTemplates } = await loadTs('../astro-src/lib/experiments/templates.ts');
  assert.ok(Array.isArray(experimentTemplates));
  assert.ok(experimentTemplates.length > 0);
});

test('each template has required fields', async () => {
  const { experimentTemplates } = await loadTs('../astro-src/lib/experiments/templates.ts');
  for (const template of experimentTemplates) {
    assert.ok(template.id, 'template has id');
    assert.ok(template.name, 'template has name');
    assert.ok(template.nameZh, 'template has nameZh');
    assert.ok(template.description, 'template has description');
    assert.ok(template.descriptionZh, 'template has descriptionZh');
    assert.ok(template.title, 'template has title');
    assert.ok(template.titleZh, 'template has titleZh');
    assert.ok(template.hypothesis, 'template has hypothesis');
    assert.ok(template.hypothesisZh, 'template has hypothesisZh');
    assert.ok(template.method, 'template has method');
    assert.ok(template.methodZh, 'template has methodZh');
    assert.ok(template.expectedResults, 'template has expectedResults');
    assert.ok(template.expectedResultsZh, 'template has expectedResultsZh');
    assert.ok(Array.isArray(template.variables), 'variables is array');
    assert.ok(Array.isArray(template.tags), 'tags is array');
  }
});

test('template variables have correct structure', async () => {
  const { experimentTemplates } = await loadTs('../astro-src/lib/experiments/templates.ts');
  for (const template of experimentTemplates) {
    for (const variable of template.variables) {
      assert.ok(variable.name, 'variable has name');
      assert.ok(variable.type === 'independent' || variable.type === 'dependent' || variable.type === 'controlled', 'variable has valid type');
      assert.ok(variable.description, 'variable has description');
    }
  }
});

test('getExperimentTemplate returns template by id', async () => {
  const { getExperimentTemplate, experimentTemplates } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const template = getExperimentTemplate('ablation-study');
  assert.ok(template);
  assert.strictEqual(template.id, 'ablation-study');
  assert.strictEqual(template.name, 'Ablation Study');
});

test('getExperimentTemplate returns template by id: hyperparameter-sweep', async () => {
  const { getExperimentTemplate } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const template = getExperimentTemplate('hyperparameter-sweep');
  assert.ok(template);
  assert.strictEqual(template.id, 'hyperparameter-sweep');
  assert.strictEqual(template.name, 'Hyperparameter Sweep');
});

test('getExperimentTemplate returns template by id: user-study', async () => {
  const { getExperimentTemplate } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const template = getExperimentTemplate('user-study');
  assert.ok(template);
  assert.strictEqual(template.id, 'user-study');
  assert.strictEqual(template.name, 'User Study');
});

test('getExperimentTemplate returns template by id: ab-test', async () => {
  const { getExperimentTemplate } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const template = getExperimentTemplate('ab-test');
  assert.ok(template);
  assert.strictEqual(template.id, 'ab-test');
  assert.strictEqual(template.name, 'A/B Test');
});

test('getExperimentTemplate returns undefined for unknown id', async () => {
  const { getExperimentTemplate } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const template = getExperimentTemplate('nonexistent-template');
  assert.strictEqual(template, undefined);
});

test('getExperimentTemplate returns undefined for empty string', async () => {
  const { getExperimentTemplate } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const template = getExperimentTemplate('');
  assert.strictEqual(template, undefined);
});

test('all template ids are unique', async () => {
  const { experimentTemplates } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const ids = experimentTemplates.map(t => t.id);
  const uniqueIds = new Set(ids);
  assert.strictEqual(ids.length, uniqueIds.size, 'all template ids are unique');
});

test('ablation-study has correct tags', async () => {
  const { getExperimentTemplate } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const template = getExperimentTemplate('ablation-study');
  assert.deepStrictEqual(template.tags, ['ablation', 'analysis', 'architecture']);
});

test('hyperparameter-sweep has correct tags', async () => {
  const { getExperimentTemplate } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const template = getExperimentTemplate('hyperparameter-sweep');
  assert.deepStrictEqual(template.tags, ['hyperparameter', 'optimization', 'tuning']);
});

test('user-study has correct tags', async () => {
  const { getExperimentTemplate } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const template = getExperimentTemplate('user-study');
  assert.deepStrictEqual(template.tags, ['user-study', 'human-feedback', 'evaluation']);
});

test('ab-test has correct tags', async () => {
  const { getExperimentTemplate } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const template = getExperimentTemplate('ab-test');
  assert.deepStrictEqual(template.tags, ['a-b-test', 'production', 'online-evaluation']);
});

test('template variable types are balanced', async () => {
  const { experimentTemplates } = await loadTs('../astro-src/lib/experiments/templates.ts');
  for (const template of experimentTemplates) {
    const types = template.variables.map(v => v.type);
    assert.ok(types.includes('independent'), 'template has independent variable');
    assert.ok(types.includes('dependent'), 'template has dependent variable');
  }
});

test('templates have Chinese translations', async () => {
  const { experimentTemplates } = await loadTs('../astro-src/lib/experiments/templates.ts');
  for (const template of experimentTemplates) {
    assert.ok(template.nameZh.length > 0, 'has Chinese name');
    assert.ok(template.descriptionZh.length > 0, 'has Chinese description');
    assert.ok(template.titleZh.length > 0, 'has Chinese title');
    assert.ok(template.hypothesisZh.length > 0, 'has Chinese hypothesis');
    assert.ok(template.methodZh.length > 0, 'has Chinese method');
    assert.ok(template.expectedResultsZh.length > 0, 'has Chinese expected results');
  }
});

test('ablation-study variable values', async () => {
  const { getExperimentTemplate } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const template = getExperimentTemplate('ablation-study');
  const componentX = template.variables.find(v => v.name === 'Component X');
  assert.deepStrictEqual(componentX.values, ['Present', 'Absent']);
});

test('user-study variable values', async () => {
  const { getExperimentTemplate } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const template = getExperimentTemplate('user-study');
  const condition = template.variables.find(v => v.name === 'Condition');
  assert.deepStrictEqual(condition.values, ['Treatment', 'Control']);
});

test('ab-test variable values', async () => {
  const { getExperimentTemplate } = await loadTs('../astro-src/lib/experiments/templates.ts');
  const template = getExperimentTemplate('ab-test');
  const variant = template.variables.find(v => v.name === 'System Variant');
  assert.deepStrictEqual(variant.values, ['Control (A)', 'Treatment (B)']);
});
