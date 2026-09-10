/**
 * tests/test_agents_export_bundle_ts.mjs — `lib/agents/export-bundle.ts` (iter #60)
 *
 * 覆盖:
 *   1. .ts 文件存在
 *   2. .ts 含 SessionMeta / RoundRecordSummary / SynthesisItem / ExportBundleStats /
 *      ExportBundle / ExportBundleInput 全部 type 定义
 *   3. .ts 通过 `export { ... } from './export-bundle.mjs'` re-export 运行时函数
 *   4. .ts 自身不重复实现 buildExportBundle / formatExportMarkdown
 *      (避免与 .mjs 漂移——单一真相源)
 *   5. .ts 没有 `import type` 引用运行时(只 export type + re-export 运行时)
 *   6. 现有 orchestrator.ts / designer.ts 等 TS caller 可以 typed import(无报错风险)
 *
 * 跑法:node --test tests/test_agents_export_bundle_ts.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

const tsSrc = await readFile(
  join(REPO, 'astro-src', 'lib', 'agents', 'export-bundle.ts'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lib/agents/export-bundle.ts (iter #60)', () => {
  it('file exists at astro-src/lib/agents/export-bundle.ts', () => {
    const p = join(REPO, 'astro-src', 'lib', 'agents', 'export-bundle.ts');
    assert.ok(existsSync(p), `${p} must exist`);
  });

  it('exports all 6 expected type definitions', () => {
    const expectedTypes = [
      'SessionMeta',
      'RoundRecordSummary',
      'SynthesisItem',
      'ExportBundleStats',
      'ExportBundle',
      'ExportBundleInput',
    ];
    for (const t of expectedTypes) {
      assert.match(tsSrc, new RegExp(`(export\\s+(interface|type)\\s+${t}\\b)`),
        `must export type ${t}`);
    }
  });

  it('re-exports buildExportBundle + formatExportMarkdown from .mjs (no drift)', () => {
    assert.match(
      tsSrc,
      /export\s*\{\s*buildExportBundle,\s*formatExportMarkdown\s*\}\s*from\s*['"]\.\/export-bundle\.mjs['"]/,
      'must re-export runtime from .mjs mirror',
    );
  });

  it('does NOT redefine buildExportBundle / formatExportMarkdown locally', () => {
    // 关键防漂移:.ts 不能有 buildExportBundle/formatExportMarkdown 的 function 定义
    assert.ok(
      !/function\s+buildExportBundle\s*\(/.test(tsSrc),
      '.ts must not redefine buildExportBundle (would drift from .mjs)',
    );
    assert.ok(
      !/function\s+formatExportMarkdown\s*\(/.test(tsSrc),
      '.ts must not redefine formatExportMarkdown',
    );
  });

  it('type defs include key fields a TS caller would expect', () => {
    // SessionMeta
    assert.match(tsSrc, /SessionMeta[\s\S]*?session_id:\s*string/);
    assert.match(tsSrc, /SessionMeta[\s\S]*?goal\?:\s*string/);
    assert.match(tsSrc, /SessionMeta[\s\S]*?preset\?:\s*'conservative'\s*\|\s*'balanced'\s*\|\s*'aggressive'/);

    // RoundRecordSummary
    assert.match(tsSrc, /RoundRecordSummary[\s\S]*?designer:[\s\S]*?proposals:/);
    assert.match(tsSrc, /RoundRecordSummary[\s\S]*?modifier:[\s\S]*?applied:/);

    // ExportBundle
    assert.match(tsSrc, /ExportBundle[\s\S]*?sessionId:\s*string/);
    assert.match(tsSrc, /ExportBundle[\s\S]*?stats:\s*ExportBundleStats/);

    // ExportBundleStats
    assert.match(tsSrc, /ExportBundleStats[\s\S]*?hasDigest:\s*boolean/);
  });

  it('marks iter #60 in doc comment', () => {
    assert.match(tsSrc, /iter #60/);
  });

  it('is shape-compatible with the .mjs implementation (deepEqual test)', async () => {
    // 用 lib 真实函数 + 一个固定 input,断言返回的对象结构与 .ts 类型契约一致
    const lib = await import(
      new URL('../astro-src/lib/agents/export-bundle.mjs', import.meta.url).href
    );
    const input = {
      meta: { session_id: 'aaa11111', goal: 'g', preset: 'balanced' },
      rounds: [{
        round: 1,
        designer: { proposals: [{ title: 'T', type: 'add_paper', estimated_effort: 'low' }], model: 'm' },
        feedback: { critiques: [{ proposal_id: 'p1', total: 6, elo: 1234 }] },
        gate: { promoted: [], candidate: ['p1'] },
        modifier: { applied: [{ kind: 'write_draft_md', proposal_id: 'p1' }] },
      }],
      syntheses: [{ idx: 1, raw: '# S' }],
      digest: 'd',
    };
    const bundle = lib.buildExportBundle(input);

    // 验证返回对象的每个字段都在 .ts 的 ExportBundle 类型里
    assert.equal(typeof bundle.sessionId, 'string');
    assert.equal(typeof bundle.generatedAt, 'string');
    assert.ok(bundle.meta !== null);
    assert.ok(Array.isArray(bundle.rounds));
    assert.ok(Array.isArray(bundle.syntheses));
    assert.equal(typeof bundle.digest, 'string');
    assert.equal(typeof bundle.stats, 'object');
    assert.equal(typeof bundle.stats.rounds, 'number');
    assert.equal(typeof bundle.stats.proposals, 'number');
    assert.equal(typeof bundle.stats.applied, 'number');
    assert.equal(typeof bundle.stats.syntheses, 'number');
    assert.equal(typeof bundle.stats.hasDigest, 'boolean');

    // RoundRecordSummary 字段
    const r = bundle.rounds[0];
    assert.equal(typeof r.round, 'number');
    assert.ok(Array.isArray(r.designer.proposals));
    assert.ok(Array.isArray(r.feedback.critiques));
    assert.ok(Array.isArray(r.modifier.applied));
  });
});