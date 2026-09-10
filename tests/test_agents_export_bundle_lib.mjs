/**
 * tests/test_agents_export_bundle_lib.mjs — `lib/agents/export-bundle.mjs` (iter #59)
 *
 * 覆盖:
 *   1. 文件存在:astro-src/lib/agents/export-bundle.mjs
 *   2. CLI 从 lib re-export(向后兼容):agents-run.mjs 用 `export { ... } from`
 *   3. 浏览器页从 lib import(不再 inline 定义)
 *   4. lib 自身:buildExportBundle 行为(同 iter #57 的断言)
 *   5. lib 自身:formatExportMarkdown footer 标记为 iter #59
 *   6. lib + CLI 输出字节级一致(cross-surface consistency)
 *
 * 跑法:node --test tests/test_agents_export_bundle_lib.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 防 main() 触发
process.argv = ['node', '/__never_used__/agents-run.mjs'];

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

const libSrc = await readFile(
  join(REPO, 'astro-src', 'lib', 'agents', 'export-bundle.mjs'),
  'utf8',
);
const cliSrc = await readFile(
  join(REPO, 'astro-src', 'scripts', 'agents-run.mjs'),
  'utf8',
);
const browserSrc = await readFile(
  join(REPO, 'astro-src', 'pages', 'agents', '[sessionId]', 'export.astro'),
  'utf8',
);

// 直接 import lib(纯函数,无 IO,无 main 触发)
const lib = await import(
  pathToFileURL(join(REPO, 'astro-src', 'lib', 'agents', 'export-bundle.mjs')).href
);
const { buildExportBundle, formatExportMarkdown } = lib;

// ---------------------------------------------------------------------------
// Tests: file existence + re-export plumbing
// ---------------------------------------------------------------------------

describe('lib/agents/export-bundle.mjs (iter #59)', () => {
  it('file exists at astro-src/lib/agents/export-bundle.mjs', () => {
    const p = join(REPO, 'astro-src', 'lib', 'agents', 'export-bundle.mjs');
    assert.ok(existsSync(p), `${p} must exist`);
  });

  it('CLI agents-run.mjs imports + re-exports from lib', () => {
    // import(本地作用域)+ export { ... }(向后兼容)
    assert.match(
      cliSrc,
      /import\s*\{\s*buildExportBundle,\s*formatExportMarkdown\s*\}\s*from\s*['"][^'"]*lib\/agents\/export-bundle\.mjs['"]/,
    );
    assert.match(
      cliSrc,
      /export\s*\{\s*buildExportBundle,\s*formatExportMarkdown\s*\}\s*;?/,
    );
  });

  it('CLI no longer defines buildExportBundle / formatExportMarkdown locally', () => {
    // iter #59 后,纯函数定义应只在 lib 一处
    assert.ok(!cliSrc.includes('export function buildExportBundle'),
      'CLI must not redefine buildExportBundle (lib is single source)');
    assert.ok(!cliSrc.includes('export function formatExportMarkdown'),
      'CLI must not redefine formatExportMarkdown');
  });

  it('browser export.astro imports from lib (no inline definitions)', () => {
    assert.match(
      browserSrc,
      /import\s*\{[^}]*buildExportBundle[^}]*\}\s*from\s*['"][^'"]*lib\/agents\/export-bundle\.mjs['"]/,
    );
    assert.match(
      browserSrc,
      /import\s*\{[^}]*formatExportMarkdown[^}]*\}\s*from\s*['"][^'"]*lib\/agents\/export-bundle\.mjs['"]/,
    );
    // 确认没有旧的 function 定义
    assert.ok(!browserSrc.includes('function buildExportBundle(input)'),
      'browser must not redefine buildExportBundle');
    assert.ok(!browserSrc.includes('function formatExportMarkdown(bundle)'),
      'browser must not redefine formatExportMarkdown');
  });

  it('lib has doc comment marking iter #59', () => {
    assert.match(libSrc, /iter #59/);
  });
});

// ---------------------------------------------------------------------------
// Tests: lib 函数行为(关键功能)
// ---------------------------------------------------------------------------

describe('lib buildExportBundle behavior', () => {
  it('empty input → bundle with all-zero stats', () => {
    const b = buildExportBundle({ meta: null });
    assert.equal(b.sessionId, '(unknown)');
    assert.equal(b.stats.rounds, 0);
    assert.equal(b.stats.proposals, 0);
    assert.equal(b.stats.applied, 0);
  });

  it('extracts session_id from meta', () => {
    const b = buildExportBundle({ meta: { session_id: 'abcd1234' } });
    assert.equal(b.sessionId, 'abcd1234');
  });

  it('counts proposals + applied across rounds', () => {
    const b = buildExportBundle({
      rounds: [
        { round: 1, designer: { proposals: [{}, {}, {}] }, modifier: { applied: [{}, {}] } },
        { round: 2, designer: { proposals: [{}] }, modifier: { applied: [{}, {}, {}] } },
      ],
    });
    assert.equal(b.stats.proposals, 4);
    assert.equal(b.stats.applied, 5);
    assert.equal(b.stats.rounds, 2);
  });

  it('hasDigest true only when digest non-empty string', () => {
    assert.equal(buildExportBundle({ digest: '' }).stats.hasDigest, false);
    assert.equal(buildExportBundle({ digest: 'x' }).stats.hasDigest, true);
    assert.equal(buildExportBundle({}).stats.hasDigest, false);
  });
});

describe('lib formatExportMarkdown behavior', () => {
  it('renders markdown with iter #59 footer marker', () => {
    const md = formatExportMarkdown(buildExportBundle({ meta: { session_id: 't1' } }));
    assert.match(md, /Exported by DPR agents export-bundle lib \(iter #59\)/);
  });

  it('null bundle → fallback string', () => {
    const md = formatExportMarkdown(null);
    assert.match(md, /bundle is empty/);
  });

  it('full render includes all section headers', () => {
    const b = buildExportBundle({
      meta: { session_id: 'full1', goal: 'goal-x', created_at: 1700000000000 },
      rounds: [{
        round: 1,
        started_at: 1700000000000,
        finished_at: 1700000001000,
        designer: { proposals: [{ title: 'T1', type: 'add_paper', rationale: 'r', estimated_effort: 'low', risk: 'k' }], model: 'm' },
        feedback: { critiques: [{ proposal_id: 'p1', total: 8.5, elo: 1240, matches: 2, wins: 1 }], judge_calls: 3, total_tokens: 600 },
        gate: { promoted: ['p1'], candidate: [], sketch: [], rejected: [] },
        modifier: { applied: [{ kind: 'write_draft_md', proposal_id: 'p1' }] },
      }],
      syntheses: [{ idx: 1, raw: '# Synth body' }],
      digest: '# Digest body',
    });
    const md = formatExportMarkdown(b);
    for (const h of ['# Agents Session Export', '## 📊 Stats', '## 🎯 Meta', '## 🔄 Rounds', '## 📝 Syntheses', '## 📋 Digest']) {
      assert.ok(md.includes(h), `must contain ${h}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: cross-surface consistency(关键质量保证)
// ---------------------------------------------------------------------------

describe('CLI + browser + lib 三处字节级一致', () => {
  it('same input produces same output across CLI re-export and lib', async () => {
    const input = {
      meta: { session_id: 'cross1', goal: 'g', created_at: 1700000000000, preset: 'balanced', dry_run: true },
      rounds: [{
        round: 1,
        started_at: 1700000000000,
        finished_at: 1700000001000,
        designer: { proposals: [{ title: 'P', type: 'add_paper' }], model: 'm' },
        feedback: { critiques: [{ proposal_id: 'p1', total: 5, elo: 1200, matches: 0, wins: 0 }], judge_calls: 3, total_tokens: 100 },
        gate: { promoted: [], candidate: ['p1'], sketch: [], rejected: [] },
        modifier: { applied: [] },
      }],
      syntheses: [],
      digest: null,
    };

    // 通过 CLI re-export 拿
    const cliModule = await import(
      pathToFileURL(join(REPO, 'astro-src', 'scripts', 'agents-run.mjs')).href
    );
    const cliBundle = cliModule.buildExportBundle(input);
    const cliMd = cliModule.formatExportMarkdown(cliBundle);

    // 直接 lib
    const libBundle = buildExportBundle(input);
    const libMd = formatExportMarkdown(libBundle);

    assert.deepEqual(cliBundle, libBundle, 'bundles must be structurally identical');
    assert.equal(cliMd, libMd, 'markdown output must be byte-identical');
  });
});