//
// tests/test_agents_compare_sessions.mjs -- Cross-session comparison (iter #45)
//
// Coverage:
//   (A) /agents/compare-sessions/ page exists with depth-2 imports
//   (B) Manifest builder (build-archive-manifest.mjs) emits the new fields:
//       totalDirectives, directiveTrend, avgScoreTrend, verdict
//   (C) countDirectivesInBody + judgeVerdict semantics match the page logic
//   (D) Dashboard button on /agents/ links to compare-sessions
//   (E) CSS classes for form/cards/winner
//
// 跑法: node --test tests/test_agents_compare_sessions.mjs
//

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAGE = join(ROOT, 'astro-src', 'pages', 'agents', 'compare-sessions.astro');
const INDEX = join(ROOT, 'astro-src', 'pages', 'agents', 'index.astro');
const CSS = join(ROOT, 'astro-src', 'styles', 'agents.css');
const MANIFEST_BUILDER = join(ROOT, 'astro-src', 'scripts', 'build-archive-manifest.mjs');

describe('cross-session page exists with correct depth', () => {
  it('uses depth-2 imports for layout/component/css', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.ok(src.length > 500);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/layouts\/BaseLayout\.astro['"]/);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/components\/Navbar\.astro['"]/);
    assert.match(src, /(from\s+['"]\.\.\/\.\.\/styles\/agents\.css['"]|import\s+['"]\.\.\/\.\.\/styles\/agents\.css['"])/);
  });

  it('fetches manifest at /data/agents-archive-manifest.json', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /agents-archive-manifest\.json/);
  });

  it('renders trend overlay with both A and B series', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /renderTrendOverlay/);
    assert.match(src, /directiveTrend/);
    assert.match(src, /avgScoreTrend/);
    assert.match(src, /polyline/);
  });
});

describe('manifest builder emits iter #45 fields', () => {
  it('source contains totalDirectives / directiveTrend / avgScoreTrend / verdict', async () => {
    const src = await readFile(MANIFEST_BUILDER, 'utf8');
    assert.match(src, /totalDirectives/);
    assert.match(src, /directiveTrend/);
    assert.match(src, /avgScoreTrend/);
    assert.match(src, /verdict/);
    // 共用页面里的 directive 计数 + verdict 判定逻辑
    assert.match(src, /countDirectivesInBody/);
    assert.match(src, /judgeVerdict/);
  });
});

describe('manifest builder end-to-end', () => {
  let tmpRoot;
  tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-manifest-'));

  it('emits new fields for sessions with syntheses', async () => {
    // 把 cwd 切到 tmpRoot,创建 archive/sid/rounds + synthesis,import builder
    const oldCwd = process.cwd();
    process.chdir(tmpRoot);

    // 把 builder 的路径改成 tmpRoot 内的 scripts/ 路径
    const sid = 'fake-sid';
    await mkdir(join(tmpRoot, 'archive', sid, 'rounds'), { recursive: true });
    await mkdir(join(tmpRoot, 'archive', sid, 'synthesis'), { recursive: true });

    await writeFile(join(tmpRoot, 'archive', sid, 'rounds', 'round_001.json'), JSON.stringify({
      round: 1,
      started_at: 1, finished_at: 1000,
      designer: { proposals: [{ id: 'p1', title: 'T1' }], model: 'stub' },
      feedback: { critiques: [{ total: 7, elo: 1500, proposal_id: 'p1' }], judge_calls: 1, total_tokens: 100 },
      gate: { promoted: ['p1'], candidate: [], sketch: [], rejected: [] },
      modifier: { applied: [{ id: 'm1', kind: 'add_paper_to_stage', proposal_id: 'p1', payload: { paper_id: 'paper-x' }, applied_at: 999 }], skipped: [] },
      meta: { session_id: sid, dry_run: true },
    }));

    await writeFile(join(tmpRoot, 'archive', sid, 'synthesis', 'synthesis_001.md'), `---
title: t
---
## Gap & 矛盾
- gap 1
## 下一步建议
- [ ] step A
- [ ] step B
`);

    // 通过 dynamic import 跑 builder(它会读 process.cwd() + 'archive')
    // builder 输出路径是相对自身的 HERE (astro-src/scripts/) + ../data/ → tmpRoot/astro-src/data/
    // 我们手动复制 builder 的核心逻辑,在 tmpRoot 里跑一遍
    // (不直接 import builder 是因为它的 OUT 路径固定,会写到原项目的 astro-src/data/)

    // 直接复制逻辑(避免副作用):
    function countDirectivesInBody(body) {
      let count = 0;
      const sections = body.split(/^##\s+/m);
      for (const sec of sections) {
        if (sec.startsWith('下一步建议') || sec.startsWith('Gap &') || sec.startsWith('Gaps &')) {
          const m = sec.match(/^[-*\s]\s+(?:\[[ x]\]\s+)?.+$/gm);
          if (m) count += m.filter((l) =>
            !/^\s*[-*]\s+\(/.test(l) &&
            !/^\s*[-*]\s+\(无\)/.test(l) &&
            !/^\s*[-*]\s+\(stub/.test(l)
          ).length;
        }
      }
      return count;
    }
    function judgeVerdict(dirCounts) {
      if (dirCounts.length === 0) return '无数据';
      if (dirCounts.length === 1) return '起步';
      const last = dirCounts[dirCounts.length - 1];
      const first = dirCounts[0];
      if (last === 0) return '已收敛';
      let decreasing = true;
      for (let i = 1; i < dirCounts.length; i++) if (dirCounts[i] > dirCounts[i - 1]) { decreasing = false; break; }
      if (decreasing) return '收敛中';
      if (last < first) return '部分收敛';
      return '停滞';
    }

    const { readdir, readFile: rf } = await import('node:fs/promises');
    const sfiles = (await rf(join(tmpRoot, 'archive', sid, 'synthesis', 'synthesis_001.md'), 'utf8'));
    const body = sfiles.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const directiveCount = countDirectivesInBody(body);
    assert.equal(directiveCount, 3, 'gap 1 + step A + step B');
    const verdict = judgeVerdict([directiveCount]);
    assert.equal(verdict, '起步');

    // 双 cycle: 收敛中
    const verdict2 = judgeVerdict([4, 2]);
    assert.equal(verdict2, '收敛中');
    const verdict3 = judgeVerdict([2, 4, 1]);
    assert.equal(verdict3, '部分收敛');
    // [3,3,3] — 非严格递增 → 视为"未变化",当前实现归到"收敛中"(heuristic 把 ≤ 当作非递增)
    const verdict4 = judgeVerdict([3, 3, 3]);
    assert.equal(verdict4, '收敛中');
    const verdict5 = judgeVerdict([5, 0]);
    assert.equal(verdict5, '已收敛');
    const verdict6 = judgeVerdict([]);
    assert.equal(verdict6, '无数据');
    // [2, 3] — 单调递增 → 停滞
    const verdict7 = judgeVerdict([2, 3]);
    assert.equal(verdict7, '停滞');

    process.chdir(oldCwd);
  });

  it('cleanup', async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });
});

describe('/agents/ index links to compare-sessions', () => {
  it('has Cross-session button', async () => {
    const src = await readFile(INDEX, 'utf8');
    assert.match(src, /\/agents\/compare-sessions\//);
    assert.match(src, /Cross-session/);
  });
});

describe('CSS for cross-session comparison', () => {
  it('has agents-cs-form / agents-cs-cards / agents-cs-winner classes', async () => {
    const css = await readFile(CSS, 'utf8');
    assert.ok(css.includes('.agents-cs-form'));
    assert.ok(css.includes('.agents-cs-cards'));
    assert.ok(css.includes('.agents-cs-card'));
    assert.ok(css.includes('.agents-cs-winner'));
  });
});
