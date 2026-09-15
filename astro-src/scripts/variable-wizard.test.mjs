#!/usr/bin/env node
// astro-src/scripts/variable-wizard.test.mjs
//
// Tests for R7 E.2.2 variable design wizard helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/experiments/variable-wizard.ts');
const {
  emptyVariableSet,
  isValidVariable,
  renderVariableSetMarkdown,
  collectVariablesFromWizard,
  renderVariableItemHtml,
  renderVariableGroupHtml,
} = mod;

// ----- emptyVariableSet / isValidVariable -----

test('emptyVariableSet: 3 groups all empty arrays', () => {
  const s = emptyVariableSet();
  assert.deepEqual(s, { independent: [], dependent: [], controlled: [] });
});

test('isValidVariable: null / undefined / empty fails', () => {
  assert.equal(isValidVariable(null), false);
  assert.equal(isValidVariable(undefined), false);
  assert.equal(isValidVariable({ name: '', type: 'continuous' }), false);
});

test('isValidVariable: missing type fails', () => {
  assert.equal(isValidVariable({ name: 'x' }), false);
});

test('isValidVariable: invalid type fails', () => {
  assert.equal(isValidVariable({ name: 'x', type: 'nope' }), false);
});

test('isValidVariable: name + valid type succeeds', () => {
  assert.equal(isValidVariable({ name: 'x', type: 'continuous' }), true);
  assert.equal(isValidVariable({ name: 'y', type: 'binary' }), true);
});

// ----- renderVariableSetMarkdown -----

test('renderVariableSetMarkdown: empty set returns empty string', () => {
  assert.equal(renderVariableSetMarkdown(emptyVariableSet()), '');
});

test('renderVariableSetMarkdown: renders 3 sections with type + unit + range', () => {
  const set = {
    independent: [
      { name: 'learning_rate', type: 'continuous', unit: '', range: '1e-5..1e-1', description: '' },
    ],
    dependent: [
      { name: 'accuracy', type: 'continuous', unit: '%', range: '0..100', description: 'final test accuracy' },
    ],
    controlled: [
      { name: 'seed', type: 'categorical', unit: '', range: '0,1,2', description: '' },
    ],
  };
  const md = renderVariableSetMarkdown(set);
  assert.match(md, /## 自变量 \(Independent\)/);
  assert.match(md, /## 因变量 \(Dependent\)/);
  assert.match(md, /## 控制变量 \(Controlled\)/);
  assert.match(md, /\*\*learning_rate\*\* \(`continuous`\)/);
  assert.match(md, /\*\*accuracy\*\* \(`continuous`, %\)/);
  assert.match(md, /取值范围: `0\.\.100`/);
  assert.match(md, /final test accuracy/);
});

test('renderVariableSetMarkdown: skips invalid entries', () => {
  const set = {
    independent: [
      { name: '', type: 'continuous' }, // invalid
      { name: 'lr', type: 'continuous' },
    ],
    dependent: [],
    controlled: [],
  };
  const md = renderVariableSetMarkdown(set);
  assert.match(md, /\*\*lr\*\*/);
  assert.ok(!md.includes('** **') || !md.includes('** \t'));
});

test('renderVariableSetMarkdown: skips empty groups', () => {
  const set = {
    independent: [{ name: 'lr', type: 'continuous' }],
    dependent: [],
    controlled: [],
  };
  const md = renderVariableSetMarkdown(set);
  assert.ok(!md.includes('## 因变量'));
});

// ----- collectVariablesFromWizard -----

test('collectVariablesFromWizard: null root returns empty set', () => {
  const r = collectVariablesFromWizard(null);
  assert.deepEqual(r, emptyVariableSet());
});

test('collectVariablesFromWizard: extracts variables from mock DOM', () => {
  // 用最少的 DOM mock 实现 querySelector
  function makeItem({ name, type, unit = '', range = '', desc = '' }) {
    return {
      querySelector(sel) {
        if (sel.includes('name')) return { value: name };
        if (sel.includes('type')) return { value: type };
        if (sel.includes('unit')) return { value: unit };
        if (sel.includes('range')) return { value: range };
        if (sel.includes('desc')) return { value: desc };
        return null;
      },
    };
  }
  const root = {
    querySelector(sel) {
      if (sel === '[data-variable-group="independent"]') {
        return {
          querySelectorAll() {
            return [
              makeItem({ name: 'lr', type: 'continuous' }),
              makeItem({ name: '', type: 'continuous' }), // invalid → skip
            ];
          },
        };
      }
      return null;
    },
  };
  const r = collectVariablesFromWizard(root);
  assert.equal(r.independent.length, 1);
  assert.equal(r.independent[0].name, 'lr');
  assert.deepEqual(r.dependent, []);
});

// ----- renderVariableItemHtml -----

test('renderVariableItemHtml: contains all required input placeholders', () => {
  const html = renderVariableItemHtml(0);
  for (const sel of ['data-variable-name', 'data-variable-type', 'data-variable-unit', 'data-variable-range', 'data-variable-desc']) {
    assert.match(html, new RegExp(sel));
  }
  assert.match(html, /data-variable-item/);
  assert.match(html, /data-variable-remove/);
});

test('renderVariableItemHtml: type select has 4 options', () => {
  const html = renderVariableItemHtml(0);
  const opts = html.match(/<option[^>]*value="(continuous|categorical|ordinal|binary)"/g) || [];
  assert.equal(opts.length, 4);
});

// ----- renderVariableGroupHtml -----

test('renderVariableGroupHtml: includes group slug + label + add button', () => {
  const html = renderVariableGroupHtml('independent', '自变量');
  assert.match(html, /data-variable-group="independent"/);
  assert.match(html, /自变量/);
  assert.match(html, /data-add-variable="independent"/);
});