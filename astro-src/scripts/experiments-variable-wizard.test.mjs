#!/usr/bin/env node
// astro-src/scripts/experiments-variable-wizard.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/variable-wizard.ts.
// emptyVariableSet + isValidVariable + renderVariableSetMarkdown +
// renderVariableItemHtml + renderVariableGroupHtml + collectVariablesFromWizard。

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
  renderVariableItemHtml,
  renderVariableGroupHtml,
  collectVariablesFromWizard,
} = mod;

// ---------- emptyVariableSet ----------
test('emptyVariableSet: 三个空数组', () => {
  const r = emptyVariableSet();
  assert.deepEqual(r.independent, []);
  assert.deepEqual(r.dependent, []);
  assert.deepEqual(r.controlled, []);
});

test('emptyVariableSet: 返回新对象(非共享引用)', () => {
  const a = emptyVariableSet();
  const b = emptyVariableSet();
  a.independent.push({ name: 'x', type: 'continuous' });
  assert.equal(b.independent.length, 0);
});

// ---------- isValidVariable ----------
test('isValidVariable: 合法 minimal → true', () => {
  assert.equal(isValidVariable({ name: 'x', type: 'continuous' }), true);
});

test('isValidVariable: 4 type 都合法', () => {
  for (const t of ['continuous', 'categorical', 'ordinal', 'binary']) {
    assert.equal(isValidVariable({ name: 'x', type: t }), true);
  }
});

test('isValidVariable: name 空 → false', () => {
  assert.equal(isValidVariable({ name: '', type: 'continuous' }), false);
  assert.equal(isValidVariable({ name: '   ', type: 'continuous' }), false);
});

test('isValidVariable: name 非 string → false', () => {
  assert.equal(isValidVariable({ name: 123, type: 'continuous' }), false);
});

test('isValidVariable: 缺 name → false', () => {
  assert.equal(isValidVariable({ type: 'continuous' }), false);
});

test('isValidVariable: 未知 type → false', () => {
  assert.equal(isValidVariable({ name: 'x', type: 'unknown' }), false);
});

test('isValidVariable: type 非 string → false', () => {
  assert.equal(isValidVariable({ name: 'x', type: 1 }), false);
});

test('isValidVariable: null → false', () => {
  assert.equal(isValidVariable(null), false);
});

test('isValidVariable: undefined → false', () => {
  assert.equal(isValidVariable(undefined), false);
});

test('isValidVariable: 非对象 → false', () => {
  assert.equal(isValidVariable('string'), false);
  assert.equal(isValidVariable(123), false);
});

// ---------- renderVariableSetMarkdown ----------
test('renderVariableSetMarkdown: 空 → 空字符串', () => {
  assert.equal(renderVariableSetMarkdown(emptyVariableSet()), '');
});

test('renderVariableSetMarkdown: 含 independent → "## 自变量"', () => {
  const r = renderVariableSetMarkdown({
    independent: [{ name: 'lr', type: 'continuous', unit: 'log10', range: '1e-5..1e-1' }],
    dependent: [],
    controlled: [],
  });
  assert.match(r, /## 自变量 \(Independent\)/);
});

test('renderVariableSetMarkdown: 含 dependent → "## 因变量"', () => {
  const r = renderVariableSetMarkdown({
    independent: [],
    dependent: [{ name: 'acc', type: 'continuous' }],
    controlled: [],
  });
  assert.match(r, /## 因变量 \(Dependent\)/);
});

test('renderVariableSetMarkdown: 含 controlled → "## 控制变量"', () => {
  const r = renderVariableSetMarkdown({
    independent: [],
    dependent: [],
    controlled: [{ name: 'seed', type: 'categorical' }],
  });
  assert.match(r, /## 控制变量 \(Controlled\)/);
});

test('renderVariableSetMarkdown: 输出含变量名 + 类型', () => {
  const r = renderVariableSetMarkdown({
    independent: [{ name: 'lr', type: 'continuous' }],
    dependent: [],
    controlled: [],
  });
  assert.match(r, /\*\*lr\*\*/);
  assert.match(r, /`continuous`/);
});

test('renderVariableSetMarkdown: 含 unit', () => {
  const r = renderVariableSetMarkdown({
    independent: [{ name: 'lr', type: 'continuous', unit: 'log10' }],
    dependent: [],
    controlled: [],
  });
  assert.match(r, /, log10/);
});

test('renderVariableSetMarkdown: 含 range', () => {
  const r = renderVariableSetMarkdown({
    independent: [{ name: 'lr', type: 'continuous', range: '1e-5..1e-1' }],
    dependent: [],
    controlled: [],
  });
  assert.match(r, /取值范围: `1e-5\.\.1e-1`/);
});

test('renderVariableSetMarkdown: 含 description', () => {
  const r = renderVariableSetMarkdown({
    independent: [{ name: 'lr', type: 'continuous', description: 'learning rate' }],
    dependent: [],
    controlled: [],
  });
  assert.match(r, /— learning rate/);
});

test('renderVariableSetMarkdown: 多组都输出', () => {
  const r = renderVariableSetMarkdown({
    independent: [{ name: 'lr', type: 'continuous' }],
    dependent: [{ name: 'acc', type: 'continuous' }],
    controlled: [{ name: 'seed', type: 'categorical' }],
  });
  assert.match(r, /## 自变量/);
  assert.match(r, /## 因变量/);
  assert.match(r, /## 控制变量/);
});

test('renderVariableSetMarkdown: 顺序独立→依赖→控制', () => {
  const r = renderVariableSetMarkdown({
    independent: [{ name: 'i', type: 'continuous' }],
    dependent: [{ name: 'd', type: 'continuous' }],
    controlled: [{ name: 'c', type: 'continuous' }],
  });
  const iPos = r.indexOf('自变量');
  const dPos = r.indexOf('因变量');
  const cPos = r.indexOf('控制变量');
  assert.ok(iPos < dPos);
  assert.ok(dPos < cPos);
});

test('renderVariableSetMarkdown: 非法 variable 跳过', () => {
  // { name: '' } 不合法 → 跳过
  const r = renderVariableSetMarkdown({
    independent: [
      { name: '', type: 'continuous' }, // 非法
      { name: 'lr', type: 'continuous' }, // 合法
    ],
    dependent: [],
    controlled: [],
  });
  assert.match(r, /\*\*lr\*\*/);
});

// ---------- renderVariableItemHtml ----------
test('renderVariableItemHtml: 含 5 data 属性', () => {
  const h = renderVariableItemHtml(0);
  assert.match(h, /data-variable-name/);
  assert.match(h, /data-variable-type/);
  assert.match(h, /data-variable-unit/);
  assert.match(h, /data-variable-range/);
  assert.match(h, /data-variable-desc/);
});

test('renderVariableItemHtml: 含 4 个 type 选项', () => {
  const h = renderVariableItemHtml(0);
  assert.match(h, /value="continuous"/);
  assert.match(h, /value="categorical"/);
  assert.match(h, /value="ordinal"/);
  assert.match(h, /value="binary"/);
});

test('renderVariableItemHtml: 删除按钮 aria-label 包含 index+1', () => {
  const h = renderVariableItemHtml(2);
  assert.match(h, /aria-label="删除变量 3"/);
});

test('renderVariableItemHtml: 不同 index 都返回同一模板', () => {
  const a = renderVariableItemHtml(0);
  const b = renderVariableItemHtml(5);
  // 主要差别在 aria-label
  assert.match(a, /aria-label="删除变量 1"/);
  assert.match(b, /aria-label="删除变量 6"/);
});

// ---------- renderVariableGroupHtml ----------
test('renderVariableGroupHtml: 3 group 都接受', () => {
  for (const g of ['independent', 'dependent', 'controlled']) {
    const h = renderVariableGroupHtml(g, `${g} label`);
    const expected = `data-variable-group="${g}"`;
    assert.match(h, new RegExp(expected));
  }
});

test('renderVariableGroupHtml: 含添加按钮', () => {
  const h = renderVariableGroupHtml('independent', '自变量');
  assert.match(h, /data-add-variable="independent"/);
});

test('renderVariableGroupHtml: 含 h3 标题', () => {
  const h = renderVariableGroupHtml('independent', 'My Label');
  assert.match(h, /<h3>My Label<\/h3>/);
});

// ---------- collectVariablesFromWizard (mock DOM) ---
test('collectVariablesFromWizard: null root → 空集', () => {
  assert.deepEqual(collectVariablesFromWizard(null), emptyVariableSet());
});

// 简易 DOM mock
function mkInput(value) {
  return { value };
}

function mkItem(name, type = 'continuous', unit = '', range = '', desc = '') {
  return {
    querySelector: (sel) => {
      if (sel === '[data-variable-name]') return mkInput(name);
      if (sel === '[data-variable-type]') return mkInput(type);
      if (sel === '[data-variable-unit]') return mkInput(unit);
      if (sel === '[data-variable-range]') return mkInput(range);
      if (sel === '[data-variable-desc]') return mkInput(desc);
      return null;
    },
  };
}

function mkGroup(slug, items) {
  return {
    querySelector: (sel) => {
      if (sel === `[data-variable-group="${slug}"]`) return {
        querySelectorAll: () => items,
      };
      return null;
    },
  };
}

test('collectVariablesFromWizard: 独立变量抽取', () => {
  const root = mkGroup('independent', [
    mkItem('lr', 'continuous', 'log10', '1e-5..1e-1', 'learning rate'),
  ]);
  // 调整:querySelector 接受任意 [data-variable-group="..."] → 返回组
  const realRoot = {
    querySelector: (sel) => {
      const m = sel.match(/data-variable-group="(\w+)"/);
      if (!m) return null;
      return {
        querySelectorAll: () => m[1] === 'independent' ? [
          mkItem('lr', 'continuous', 'log10', '1e-5..1e-1', 'learning rate'),
        ] : [],
      };
    },
  };
  const r = collectVariablesFromWizard(realRoot);
  assert.equal(r.independent.length, 1);
  assert.equal(r.independent[0].name, 'lr');
  assert.equal(r.independent[0].type, 'continuous');
  assert.equal(r.independent[0].unit, 'log10');
});

test('collectVariablesFromWizard: 缺 name → 跳过', () => {
  const realRoot = {
    querySelector: () => ({
      querySelectorAll: () => [mkItem('', 'continuous')],
    }),
  };
  const r = collectVariablesFromWizard(realRoot);
  assert.equal(r.independent.length, 0);
});

test('collectVariablesFromWizard: 缺 type → 默认 continuous', () => {
  const item = {
    querySelector: (sel) => {
      if (sel === '[data-variable-name]') return mkInput('x');
      if (sel === '[data-variable-type]') return mkInput(''); // 空
      return mkInput('');
    },
  };
  const realRoot = {
    querySelector: () => ({ querySelectorAll: () => [item] }),
  };
  const r = collectVariablesFromWizard(realRoot);
  assert.equal(r.independent[0].type, 'continuous');
});

test('collectVariablesFromWizard: unit 空 → undefined', () => {
  const item = {
    querySelector: (sel) => {
      if (sel === '[data-variable-name]') return mkInput('x');
      if (sel === '[data-variable-type]') return mkInput('continuous');
      if (sel === '[data-variable-unit]') return mkInput('   '); // 仅空白
      return mkInput('');
    },
  };
  const realRoot = {
    querySelector: () => ({ querySelectorAll: () => [item] }),
  };
  const r = collectVariablesFromWizard(realRoot);
  assert.equal(r.independent[0].unit, undefined);
});

test('collectVariablesFromWizard: 三组都抽', () => {
  const root = {
    querySelector: (sel) => {
      const m = sel.match(/data-variable-group="(\w+)"/);
      if (!m) return null;
      return {
        querySelectorAll: () => [mkItem(`${m[1]}_var`, 'continuous')],
      };
    },
  };
  const r = collectVariablesFromWizard(root);
  assert.equal(r.independent.length, 1);
  assert.equal(r.dependent.length, 1);
  assert.equal(r.controlled.length, 1);
});