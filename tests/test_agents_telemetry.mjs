/**
 * tests/test_agents_telemetry.mjs — Round telemetry (iter #42)
 *
 * 覆盖:
 *   runOneRoundCLI telemetry:
 *    1. rec.telemetry 存在
 *    2. duration_ms = finished_at - started_at
 *    3. llm_calls = 1 + proposals.length * 3
 *    4. approx_tokens = tokens + fbTokens(proposals.length * 250 + * 600)
 *    5. stage_durations_ms 含 designer / feedback / gate / modifier 四个 key
 *    6. 所有 stage_durations_ms >= 0
 *    7. telemetry 字段落进 round_NNN.json(写盘后能读出来)
 *
 *   types 同步:
 *    8. types.mjs + types.ts 都有 telemetry 字段
 *
 * 跑法:node --test tests/test_agents_telemetry.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '..', 'astro-src', 'scripts', 'agents-run.mjs');
const TYPES_MJS = join(__dirname, '..', 'astro-src', 'lib', 'agents', 'types.mjs');
const TYPES_TS = join(__dirname, '..', 'astro-src', 'lib', 'agents', 'types.ts');

process.argv = ['node', '/__never_used__/agents-run.mjs'];
const agentsRun = await import(pathToFileURL(CLI_PATH).href);
const { runAutoLoop } = agentsRun;

describe('runOneRoundCLI telemetry fields', () => {
  let tmpRoot;
  // setup
  tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-telemetry-'));
  process.chdir(tmpRoot);
  // cleanup is via process.on('exit') to be safe — but for a quick test we rely on tmpRoot being tmpfs

  it('round record has telemetry block with all required fields', async () => {
    const r = await runAutoLoop('telemetry smoke', {
      sessionId: 'tm-001',
      maxCycles: 1,
      stopThreshold: 0,
      resume: false,
    });
    assert.equal(r.cycles.length, 1);

    // 读 round JSON,验 telemetry
    const { readFileSync } = await import('node:fs');
    const rec = JSON.parse(readFileSync(join(tmpRoot, 'archive', 'tm-001', 'rounds', 'round_001.json'), 'utf8'));
    assert.ok(rec.telemetry, 'telemetry block missing');
    assert.equal(typeof rec.telemetry.duration_ms, 'number');
    assert.equal(typeof rec.telemetry.llm_calls, 'number');
    assert.equal(typeof rec.telemetry.approx_tokens, 'number');
    assert.ok(rec.telemetry.stage_durations_ms, 'stage_durations_ms missing');
  });

  it('duration_ms matches finished_at - started_at', async () => {
    const { readFileSync } = await import('node:fs');
    const rec = JSON.parse(readFileSync(join(tmpRoot, 'archive', 'tm-001', 'rounds', 'round_001.json'), 'utf8'));
    const actual = rec.finished_at - rec.started_at;
    assert.equal(rec.telemetry.duration_ms, actual);
    assert.ok(rec.telemetry.duration_ms >= 0);
  });

  it('llm_calls = 1 + proposals.length * 3', async () => {
    const { readFileSync } = await import('node:fs');
    const rec = JSON.parse(readFileSync(join(tmpRoot, 'archive', 'tm-001', 'rounds', 'round_001.json'), 'utf8'));
    const expected = 1 + rec.designer.proposals.length * 3;
    assert.equal(rec.telemetry.llm_calls, expected);
  });

  it('approx_tokens = designer + feedback estimate', async () => {
    const { readFileSync } = await import('node:fs');
    const rec = JSON.parse(readFileSync(join(tmpRoot, 'archive', 'tm-001', 'rounds', 'round_001.json'), 'utf8'));
    const n = rec.designer.proposals.length;
    const expected = n * 250 + n * 600;
    assert.equal(rec.telemetry.approx_tokens, expected);
    assert.equal(rec.feedback.total_tokens, expected);
  });

  it('stage_durations_ms has all 4 stage keys, all >= 0', async () => {
    const { readFileSync } = await import('node:fs');
    const rec = JSON.parse(readFileSync(join(tmpRoot, 'archive', 'tm-001', 'rounds', 'round_001.json'), 'utf8'));
    const s = rec.telemetry.stage_durations_ms;
    for (const k of ['designer', 'feedback', 'gate', 'modifier']) {
      assert.ok(k in s, `missing stage ${k}`);
      assert.equal(typeof s[k], 'number');
      assert.ok(s[k] >= 0, `stage ${k} = ${s[k]} < 0`);
    }
  });

  it('telemetry persists across multiple cycles (cycle 2 also has it)', async () => {
    const r = await runAutoLoop('telemetry cycle 2', {
      sessionId: 'tm-002',
      maxCycles: 2,
      stopThreshold: 0,
      resume: false,
    });
    assert.equal(r.cycles.length, 2);

    const { readFileSync } = await import('node:fs');
    for (const c of r.cycles) {
      const fname = c.roundFile.split(/[\\/]/).pop();
      const rec = JSON.parse(readFileSync(join(tmpRoot, 'archive', 'tm-002', 'rounds', fname), 'utf8'));
      assert.ok(rec.telemetry, `${fname} missing telemetry`);
      assert.ok(rec.telemetry.duration_ms >= 0);
    }
  });

  // best-effort cleanup
  it('cleanup tmp', async () => {
    await rm(tmpRoot, { recursive: true, force: true });
    process.chdir(__dirname);
  });
});

describe('RoundRecord schema sync — telemetry field', () => {
  it('types.mjs makeRoundRecord includes telemetry', async () => {
    const src = await readFile(TYPES_MJS, 'utf8');
    assert.match(src, /telemetry:\s*\{/);
    assert.match(src, /duration_ms:\s*0/);
    assert.match(src, /llm_calls:\s*0/);
    assert.match(src, /approx_tokens:\s*0/);
  });

  it('types.ts RoundRecord interface includes telemetry', async () => {
    const src = await readFile(TYPES_TS, 'utf8');
    assert.match(src, /telemetry:\s*\{/);
    assert.match(src, /duration_ms:\s*number/);
    assert.match(src, /llm_calls:\s*number/);
    assert.match(src, /approx_tokens:\s*number/);
    assert.match(src, /stage_durations_ms\?:\s*\{/);
  });
});

describe('round detail page integration', () => {
  const RD = join(__dirname, '..', 'astro-src', 'pages', 'agents', '[sessionId]', '[roundId].astro');

  it('RoundRecord interface includes optional telemetry', async () => {
    const src = await readFile(RD, 'utf8');
    assert.match(src, /telemetry\?:\s*\{/);
    assert.match(src, /duration_ms:\s*number/);
    assert.match(src, /llm_calls:\s*number/);
    assert.match(src, /approx_tokens:\s*number/);
    assert.match(src, /stage_durations_ms\?:\s*\{/);
  });

  it('loads roundTimings server-side for the chart', async () => {
    const src = await readFile(RD, 'utf8');
    assert.match(src, /roundTimings/);
    assert.match(src, /duration_ms/);
  });

  it('renders resume section with copy button + CLI command', async () => {
    const src = await readFile(RD, 'utf8');
    assert.match(src, /agents-auto-resume-section/);
    assert.match(src, /resumeCmd/);
    assert.match(src, /agents-auto-resume-copy-btn/);
    assert.match(src, /--auto-resume/);
  });

  it('renders telemetry SVG chart + stage breakdown', async () => {
    const src = await readFile(RD, 'utf8');
    assert.match(src, /agents-telemetry-chart/);
    assert.match(src, /agents-telemetry-svg/);
    assert.match(src, /stage_durations_ms/);
    assert.match(src, /agents-telemetry-stages-list/);
  });
});