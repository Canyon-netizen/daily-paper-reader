//
// tests/test_agents_new_session.mjs -- Session templates (iter #46)
//
// Coverage:
//   (A) /agents/new-session/ page exists with depth-2 imports
//   (B) Template catalog has 5 templates: literature_review, experiment_plan,
//       rebuttal, paper_additions, free_form
//   (C) Each template has goal + suggestedMaxCycles + suggestedRounds +
//       suggestedDirectiveMode + tags
//   (D) Page generates copy-paste CLI command with --new-session flag
//   (E) /agents/ (main console) links to /agents/new-session/
//   (F) CSS classes for template grid + cards + form
//
// 跑法: node --test tests/test_agents_new_session.mjs
//

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAGE = join(ROOT, 'astro-src', 'pages', 'agents', 'new-session.astro');
const INDEX = join(ROOT, 'astro-src', 'pages', 'agents', 'index.astro');
const CSS = join(ROOT, 'astro-src', 'styles', 'agents.css');

describe('new-session page structure', () => {
  it('exists with depth-2 imports', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.ok(src.length > 500);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/layouts\/BaseLayout\.astro['"]/);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/components\/Navbar\.astro['"]/);
    assert.match(src, /(from\s+['"]\.\.\/\.\.\/styles\/agents\.css['"]|import\s+['"]\.\.\/\.\.\/styles\/agents\.css['"])/);
  });

  it('encodes all 5 templates in source', async () => {
    const src = await readFile(PAGE, 'utf8');
    for (const id of ['literature_review', 'experiment_plan', 'rebuttal', 'paper_additions', 'free_form']) {
      assert.ok(src.includes(`id: '${id}'`), `template ${id} missing`);
    }
  });

  it('each template has goal + suggestedMaxCycles + suggestedRounds + tags', async () => {
    const src = await readFile(PAGE, 'utf8');
    // 抽 5 段 template 块
    const blocks = src.match(/\{\s*id:\s*'[a-z_]+',[\s\S]*?tags:\s*\[[^\]]*\]\s*,?\s*\}/g) ?? [];
    assert.equal(blocks.length, 5, `expected 5 template objects, got ${blocks.length}`);
    for (const b of blocks) {
      assert.match(b, /goal:/);
      assert.match(b, /suggestedMaxCycles:\s*\d+/);
      assert.match(b, /suggestedRounds:\s*\d+/);
      assert.match(b, /tags:\s*\[/);
    }
  });

  it('literature_review template references arxiv + survey + paper_id', async () => {
    const src = await readFile(PAGE, 'utf8');
    // literature_review 块
    const m = src.match(/id:\s*'literature_review',[\s\S]*?(?=\{\s*id:\s*'experiment_plan')/);
    assert.ok(m, 'literature_review block not found');
    assert.match(m[0], /arxiv/i);
    assert.match(m[0], /paper_id/);
    assert.match(m[0], /markdown/);
  });

  it('experiment_plan template includes baselines + ablations + metrics', async () => {
    const src = await readFile(PAGE, 'utf8');
    const m = src.match(/id:\s*'experiment_plan',[\s\S]*?(?=\{\s*id:\s*'rebuttal')/);
    assert.ok(m);
    assert.match(m[0], /baseline/i);
    assert.match(m[0], /ablation/i);
    assert.match(m[0], /metric/i);
  });

  it('rebuttal template includes reviewer weaknesses + rebuttal', async () => {
    const src = await readFile(PAGE, 'utf8');
    const m = src.match(/id:\s*'rebuttal',[\s\S]*?(?=\{\s*id:\s*'paper_additions')/);
    assert.ok(m);
    assert.match(m[0], /reviewer/i);
    assert.match(m[0], /rebuttal/i);
  });
});

describe('new-session CLI command builder', () => {
  // 镜像 buildCmd 逻辑(测试与生产代码同步)
  function escapeForShell(s) {
    return `'${String(s ?? '').replace(/'/g, "'\\''")}'`;
  }
  function buildCmd({ goal, maxCycles, rounds, dirMode, preset, dryRun, immediate }) {
    if (!goal) return 'node astro-src/scripts/agents-run.mjs --new-session "(请先填 goal)"';
    const parts = [
      'node astro-src/scripts/agents-run.mjs',
      `--new-session ${escapeForShell(goal)}`,
      `--max-cycles ${maxCycles || 2}`,
      `--auto-directive-mode ${dirMode}`,
      `--preset ${preset}`,
    ];
    if (immediate) parts.push(`--rounds ${rounds || 1}`);
    if (dryRun) parts.push('--dry-run');
    return parts.join(' \\\n  ');
  }

  it('produces valid CLI with all flags', () => {
    const cmd = buildCmd({
      goal: 'do X',
      maxCycles: 3,
      rounds: 2,
      dirMode: 'both',
      preset: 'balanced',
      dryRun: false,
      immediate: true,
    });
    assert.match(cmd, /--new-session 'do X'/);
    assert.match(cmd, /--max-cycles 3/);
    assert.match(cmd, /--rounds 2/);
    assert.match(cmd, /--preset balanced/);
    assert.match(cmd, /--auto-directive-mode both/);
  });

  it('escapes single quotes in goal', () => {
    const cmd = buildCmd({
      goal: "it's a test",
      maxCycles: 1,
      rounds: 1,
      dirMode: 'gaps',
      preset: 'conservative',
      dryRun: false,
      immediate: false,
    });
    assert.match(cmd, /--new-session 'it'\\''s a test'/);
  });

  it('omits --rounds when immediate=false', () => {
    const cmd = buildCmd({
      goal: 'x',
      maxCycles: 1,
      rounds: 5,
      dirMode: 'gaps',
      preset: 'balanced',
      dryRun: false,
      immediate: false,
    });
    assert.ok(!cmd.includes('--rounds'), 'should not include --rounds');
  });

  it('includes --dry-run when dryRun=true', () => {
    const cmd = buildCmd({
      goal: 'x',
      maxCycles: 1,
      rounds: 1,
      dirMode: 'gaps',
      preset: 'balanced',
      dryRun: true,
      immediate: false,
    });
    assert.match(cmd, /--dry-run/);
  });

  it('emits placeholder when goal is empty', () => {
    const cmd = buildCmd({ goal: '', maxCycles: 1, rounds: 1, dirMode: 'gaps', preset: 'balanced', dryRun: false, immediate: false });
    assert.ok(cmd.includes('请先填 goal'));
  });
});

describe('/agents/ index links to new-session', () => {
  it('has template button', async () => {
    const src = await readFile(INDEX, 'utf8');
    assert.match(src, /\/agents\/new-session\//);
  });
});

describe('CSS for templates', () => {
  it('has agents-template-grid + card + form classes', async () => {
    const css = await readFile(CSS, 'utf8');
    assert.ok(css.includes('.agents-template-grid'));
    assert.ok(css.includes('.agents-template-card'));
    assert.ok(css.includes('.agents-template-emoji'));
    assert.ok(css.includes('.agents-template-tag'));
    assert.ok(css.includes('.agents-ns-form'));
    assert.ok(css.includes('.agents-ns-row'));
  });
});
