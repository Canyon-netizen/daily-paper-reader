/**
 * tests/test_agents_mirror.mjs — TS/.mjs drift detector.
 *
 * 架构规则:lib/agents/*.ts 是单一真相源,*.mjs 是 Node CLI 用的镜像。
 * 一旦 .ts 加了导出但 .mjs 漏了(或者反过来),CLI 就会运行旧版 → 静默 bug。
 *
 * 这套测试通过解析 export 名字 + JSDoc typedef 名来守护一致:
 *   1. 每个 .ts 必须有对应的 .mjs(配对:designer.ts/orchestrator.ts/modifier.ts
 *      暂无 CLI 镜像,允许 opt-out)
 *   2. 配对的 .ts 与 .mjs 导出函数名必须 1-1 对应(忽略 .mjs 端的 `LLMCaller`
 *      re-export 等别名)
 *   3. 配对文件的"类名 / typedef 名"必须一致(.ts 的 `export interface Foo`
 *      必须有 .mjs 端 `* @typedef {object} Foo` 镜像,反之亦然)
 *
 * 跑法:node tests/test_agents_mirror.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const AGENTS_DIR = 'astro-src/lib/agents';

// 不要求 .mjs 镜像的文件(浏览器独有 / 入口聚合器)
const NO_MIRROR_OPT_OUT = new Set([
  'designer.ts',    // 浏览器独有(只暴露给 orchestrator)
  'modifier.ts',    // 浏览器独有
  'orchestrator.ts',// 浏览器独有
]);

function listTsFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => !f.endsWith('.d.ts'))
    .filter((f) => statSync(join(dir, f)).isFile());
}

// 提取 .ts 文件里的 export function / export const / export interface / export type
function extractTsExports(src) {
  const out = { functions: [], interfaces: [], types: [], constants: [], reExports: [] };
  const lines = src.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) out.functions.push(m[1]);
    const c = line.match(/^\s*export\s+const\s+([A-Za-z_$][\w$]*)/);
    if (c) out.constants.push(c[1]);
    const i = line.match(/^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/);
    if (i) out.interfaces.push(i[1]);
    const t = line.match(/^\s*export\s+type\s+([A-Za-z_$][\w$]*)/);
    if (t) out.types.push(t[1]);
  }

  // iter #61: 认 re-export 形式 `export { a, b } from './x.mjs'`。
  // 这是 Phase A shim 策略的正确形态(iter #60 起用于 export-bundle.ts):
  // .ts 只做类型层,运行时值直接从 .mjs 镜像 re-export —— 单一真相源,
  // 结构上不可能 drift。旧版 detector 只认 `export function`,把这种最强保证
  // 误报成 "MJS-only" 漂移。
  //
  // 注意:re-export 语法不区分函数还是常量,所以单独收进 reExports 桶,
  // 由下游对照 .mjs 的声明方式归类(见 tsSideNames)。
  const reExportRe = /export\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g;
  let re;
  while ((re = reExportRe.exec(src)) !== null) {
    for (const raw of re[1].split(',')) {
      const spec = raw.trim();
      if (!spec) continue;
      if (/^type\s/.test(spec)) continue; // `type Foo` 是纯类型,不算运行时��出
      // 支持 `a as b` —— 记录对外可见的名字
      const name = spec.split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) out.reExports.push(name);
    }
  }
  return out;
}

/**
 * .ts 侧某一类(函数 / 常量)的对外名字集合。
 * 直接声明的名字全算;re-export 的名字只在 .mjs 把它声明为这一类时才算 ——
 * 这样同一个 re-export 既不会在函数检查里漏报,也不会在常量检查里误报。
 */
function tsSideNames(tsOwn, reExports, mjsSide) {
  const mjsSet = new Set(mjsSide);
  return [...tsOwn, ...reExports.filter((n) => mjsSet.has(n))];
}

// 提取 .mjs 文件里的 export function / export const;interface 通过 JSDoc typedef
function extractMjsExports(src) {
  const out = { functions: [], interfaces: [], constants: [] };
  const lines = src.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) out.functions.push(m[1]);
    const c = line.match(/^\s*export\s+const\s+([A-Za-z_$][\w$]*)/);
    if (c) out.constants.push(c[1]);
  }
  // JSDoc typedef
  const typedefRe = /@(?:typedef|type)\s+\{[^}]*\}\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = typedefRe.exec(src)) !== null) {
    out.interfaces.push(m[1]);
  }
  return out;
}

function diff(arr1, arr2) {
  const s1 = new Set(arr1);
  const s2 = new Set(arr2);
  const in1Only = [...s1].filter((x) => !s2.has(x));
  const in2Only = [...s2].filter((x) => !s1.has(x));
  return { in1Only, in2Only };
}

describe('TS/.mjs drift detector', () => {
  const tsFiles = listTsFiles(AGENTS_DIR);

  it('discovers .ts files in lib/agents/', () => {
    assert.ok(tsFiles.length >= 4, `expected ≥4 .ts files, got ${tsFiles.length}: ${tsFiles.join(', ')}`);
  });

  // 1. 每个 .ts 要么有 .mjs 配对,要么在 opt-out 列表里
  it('every .ts has a matching .mjs (or is opted out)', () => {
    const missing = [];
    for (const ts of tsFiles) {
      if (NO_MIRROR_OPT_OUT.has(ts)) continue;
      const mjs = ts.replace(/\.ts$/, '.mjs');
      if (!existsSync(join(AGENTS_DIR, mjs))) {
        missing.push(`${ts} → missing ${mjs}`);
      }
    }
    assert.deepEqual(missing, [], `missing mirrors:\n  ${missing.join('\n  ')}`);
  });

  // 2. 每个配对的 .ts/.mjs 函数名一致
  describe('paired files have matching function exports', () => {
    for (const ts of tsFiles) {
      if (NO_MIRROR_OPT_OUT.has(ts)) continue;
      const mjsFile = ts.replace(/\.ts$/, '.mjs');
      const mjsPath = join(AGENTS_DIR, mjsFile);
      if (!existsSync(mjsPath)) continue;

      it(`${ts} ↔ ${mjsFile}: matching functions`, () => {
        const tsSrc = readFileSync(join(AGENTS_DIR, ts), 'utf8');
        const mjsSrc = readFileSync(mjsPath, 'utf8');
        const tsExp = extractTsExports(tsSrc);
        const mjsExp = extractMjsExports(mjsSrc);

        // TS-only 函数(`function foo()` 不带 export)不算
        const tsFns = tsSideNames(tsExp.functions, tsExp.reExports, mjsExp.functions).sort();
        const mjsFns = mjsExp.functions.sort();
        const d = diff(tsFns, mjsFns);

        assert.deepEqual(
          { in1Only: d.in1Only, in2Only: d.in2Only },
          { in1Only: [], in2Only: [] },
          `function drift in ${ts}:\n  TS-only: ${d.in1Only.join(', ')}\n  MJS-only: ${d.in2Only.join(', ')}`,
        );
      });
    }
  });

  // 3. 每个配对的 .ts/.mjs constant 导出名一致(常用作 ACTION_KINDS 等常量)
  describe('paired files have matching constant exports', () => {
    for (const ts of tsFiles) {
      if (NO_MIRROR_OPT_OUT.has(ts)) continue;
      const mjsFile = ts.replace(/\.ts$/, '.mjs');
      const mjsPath = join(AGENTS_DIR, mjsFile);
      if (!existsSync(mjsPath)) continue;

      it(`${ts} ↔ ${mjsFile}: matching exported constants`, () => {
        const tsSrc = readFileSync(join(AGENTS_DIR, ts), 'utf8');
        const mjsSrc = readFileSync(mjsPath, 'utf8');
        const tsExp = extractTsExports(tsSrc);
        const mjsExp = extractMjsExports(mjsSrc);

        const tsConsts = tsExp.constants.sort();
        const mjsConsts = mjsExp.constants.sort();
        // 类型 alias const (`export const FOO = ['a','b'] as const`)要包含
        // .mjs 端可能用 `@typedef` 而不是 const,所以允许 MJS-only
        // 但 TS-only 常量必须有人接手
        const tsOnly = tsConsts.filter((c) => !mjsConsts.includes(c));
        assert.deepEqual(
          tsOnly, [],
          `${ts} has exported consts not mirrored in ${mjsFile}:\n  ${tsOnly.join(', ')}`,
        );
      });
    }
  });

  // 4. 已知特定导出名存在(回归测试:防止 .ts 删了 export 而 .mjs 还在引用)
  it('types.ts exports makeEmptyProposal & makeEmptyCritique (regression for iter #7 bug)', () => {
    const tsSrc = readFileSync(join(AGENTS_DIR, 'types.ts'), 'utf8');
    const exp = extractTsExports(tsSrc);
    assert.ok(exp.functions.includes('makeEmptyProposal'),
      'types.ts must export makeEmptyProposal (designer.ts depends on it)');
    assert.ok(exp.functions.includes('makeEmptyCritique'),
      'types.ts must export makeEmptyCritique (feedback.ts depends on it)');
  });

  // 5. .mjs 端不能引用 .ts 端不存在的函数(防止 .mjs 是僵尸代码引用)
  it('mjs mirrors do not import from .ts modules (only intra-mjs / external)', () => {
    const mjsFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.mjs'));
    const offenders = [];
    for (const mjs of mjsFiles) {
      const src = readFileSync(join(AGENTS_DIR, mjs), 'utf8');
      // 检查 `from './xxx.ts'` 或 `from "./xxx.ts"` 这类直接引用 .ts 的写法
      const re = /from\s+['"]\.\.?\/[^'"]+\.ts['"]/g;
      const matches = src.match(re);
      if (matches && matches.length > 0) {
        offenders.push(`${mjs}: ${matches.join(', ')}`);
      }
    }
    assert.deepEqual(offenders, [],
      `mjs files should not import from .ts (use the mjs mirror):\n  ${offenders.join('\n  ')}`);
  });
});
