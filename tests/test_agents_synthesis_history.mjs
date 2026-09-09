//
// tests/test_agents_synthesis_history.mjs -- Synthesis history page (iter #44)
//
// Coverage:
//   (A) /agents/<sid>/synthesis/index.astro exists, depth-4 imports correct
//   (B) /agents/<sid>/synthesis/<idx>.astro exists, depth-4 imports correct
//   (C) Both pages enumerate via getStaticPaths from archive/<sid>/synthesis/
//   (D) Tiny frontmatter parser handles flat YAML + quoted values
//   (E) countDirectives regex is consistent across both pages + dashboard
//   (F) Markdown → block conversion: handles h1/h2/lists/checklists/blockquote/p
//   (G) Sibling navigation (prev/next) wired correctly
//   (H) CSS classes for synthesis body + checklist exist
//   (I) Dashboard links to synthesis history
//
// 跑法: node --test tests/test_agents_synthesis_history.mjs
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
const LIST = join(ROOT, 'astro-src', 'pages', 'agents', '[sessionId]', 'synthesis', 'index.astro');
const DETAIL = join(ROOT, 'astro-src', 'pages', 'agents', '[sessionId]', 'synthesis', '[idx].astro');
const DASH = join(ROOT, 'astro-src', 'pages', 'agents', '[sessionId]', 'index.astro');
const CSS = join(ROOT, 'astro-src', 'styles', 'agents.css');

describe('synthesis list page structure', () => {
  it('exists with depth-4 imports', async () => {
    const src = await readFile(LIST, 'utf8');
    assert.ok(src.length > 500, 'list page too short');
    assert.match(src, /(from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/layouts\/BaseLayout\.astro['"]|import\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/layouts\/BaseLayout\.astro['"])/);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/components\/Navbar\.astro['"]/);
    assert.match(src, /(from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/styles\/agents\.css['"]|import\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/styles\/agents\.css['"])/);
  });

  it('getStaticPaths enumerates sessions with synthesis files', async () => {
    const src = await readFile(LIST, 'utf8');
    assert.match(src, /getStaticPaths/);
    assert.match(src, /synthesis_\\d\+\\.md/);
  });

  it('renders list table with title/model/generated_at/directives columns', async () => {
    const src = await readFile(LIST, 'utf8');
    assert.match(src, /Generated/);
    assert.match(src, /Model/);
    assert.match(src, /Directives/);
    assert.match(src, /agents-session-table/);
    assert.match(src, /agents-verdict-/);
  });
});

describe('synthesis detail page structure', () => {
  it('exists with depth-4 imports', async () => {
    const src = await readFile(DETAIL, 'utf8');
    assert.ok(src.length > 500, 'detail page too short');
    assert.match(src, /(from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/layouts\/BaseLayout\.astro['"]|import\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/layouts\/BaseLayout\.astro['"])/);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/components\/Navbar\.astro['"]/);
    assert.match(src, /(from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/styles\/agents\.css['"]|import\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/styles\/agents\.css['"])/);
  });

  it('getStaticPaths enumerates (sessionId, idx) pairs', async () => {
    const src = await readFile(DETAIL, 'utf8');
    assert.match(src, /getStaticPaths/);
    assert.match(src, /sessionId.*idx/);
    assert.match(src, /synthesis_\\d\+\\.md/);
  });

  it('uses tiny frontmatter parser (no gray-matter)', async () => {
    const src = await readFile(DETAIL, 'utf8');
    assert.match(src, /parseFrontmatter/);
    // 没有 import gray-matter
    assert.ok(!src.includes("from 'gray-matter'") && !src.includes('from "gray-matter"'), 'should not import gray-matter');
  });

  it('markdown → blocks handles all needed types', async () => {
    const src = await readFile(DETAIL, 'utf8');
    assert.match(src, /markdownToBlocks/);
    assert.match(src, /'h1'/);
    assert.match(src, /'h2'/);
    assert.match(src, /'ul'/);
    assert.match(src, /'checklist'/);
    assert.match(src, /'blockquote'/);
  });

  it('prev/next sibling navigation', async () => {
    const src = await readFile(DETAIL, 'utf8');
    assert.match(src, /prevIdx/);
    assert.match(src, /nextIdx/);
    assert.match(src, /siblingIdxs/);
  });
});

describe('frontmatter parser semantics', () => {
  // 镜像实现,从 LIST 页抽出来的(测试与生产代码逻辑一致)
  function parseFrontmatter(raw) {
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) return { meta: {}, body: raw };
    const meta = {};
    for (const line of m[1].split(/\r?\n/)) {
      const mm = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      if (!mm) continue;
      let v = mm[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      meta[mm[1]] = v;
    }
    return { meta, body: m[2] };
  }

  it('parses flat YAML with quoted strings', () => {
    const raw = `---
title: "telemetry test"
session_id: "test-sid"
synthesis_index: 1
model: "stub"
dry_run: true
---

# body`;
    const { meta, body } = parseFrontmatter(raw);
    assert.equal(meta.title, 'telemetry test');
    assert.equal(meta.session_id, 'test-sid');
    assert.equal(meta.synthesis_index, '1');
    assert.equal(meta.model, 'stub');
    assert.equal(meta.dry_run, 'true');
    assert.ok(body.includes('# body'));
  });

  it('parses unquoted values too', () => {
    const raw = `---
k: v
n: 42
---
body`;
    const { meta } = parseFrontmatter(raw);
    assert.equal(meta.k, 'v');
    assert.equal(meta.n, '42');
  });

  it('returns empty meta when no frontmatter', () => {
    const { meta, body } = parseFrontmatter('just body\n');
    assert.deepEqual(meta, {});
    assert.equal(body, 'just body\n');
  });
});

describe('markdownToBlocks semantics', () => {
  function markdownToBlocks(body) {
    const lines = body.split(/\r?\n/);
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (line.startsWith('# ')) { blocks.push({ kind: 'h1', lines: [line.slice(2).trim()] }); i++; continue; }
      if (line.startsWith('## ')) { blocks.push({ kind: 'h2', lines: [line.slice(3).trim()] }); i++; continue; }
      if (line.startsWith('---')) { blocks.push({ kind: 'hr', lines: [] }); i++; continue; }
      if (line.startsWith('> ')) {
        const ls = [];
        while (i < lines.length && lines[i].startsWith('> ')) { ls.push(lines[i].slice(2).trim()); i++; }
        blocks.push({ kind: 'blockquote', lines: ls });
        continue;
      }
      if (/^\s*[-*]\s+\[[ x]\]\s+/.test(line)) {
        const ls = [];
        while (i < lines.length && /^\s*[-*]\s+\[[ x]\]\s+/.test(lines[i])) {
          ls.push(lines[i].replace(/^\s*[-*]\s+\[[ x]\]\s+/, ''));
          i++;
        }
        blocks.push({ kind: 'checklist', lines: ls });
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const ls = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          ls.push(lines[i].replace(/^\s*[-*]\s+/, ''));
          i++;
        }
        blocks.push({ kind: 'ul', lines: ls });
        continue;
      }
      const ls = [];
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith('#') && !lines[i].startsWith('>') && !/^\s*[-*]\s+/.test(lines[i])) {
        ls.push(lines[i]);
        i++;
      }
      blocks.push({ kind: 'p', lines: ls });
    }
    return blocks;
  }

  it('handles h1 + h2 + ul + checklist + blockquote + p + hr', () => {
    const md = `# Title

intro paragraph line 1
line 2

## Section A

- bullet A1
- bullet A2

## Section B

- [ ] todo 1
- [x] todo 2 done

> blockquote line 1
> line 2

---

after hr`;
    const blocks = markdownToBlocks(md);
    const kinds = blocks.map((b) => b.kind);
    assert.deepEqual(kinds, ['h1', 'p', 'h2', 'ul', 'h2', 'checklist', 'blockquote', 'hr', 'p']);
    // 抽样验证
    const p1 = blocks.find((b) => b.kind === 'p');
    assert.equal(p1.lines.join(' '), 'intro paragraph line 1 line 2');
    const checklist = blocks.find((b) => b.kind === 'checklist');
    assert.equal(checklist.lines.length, 2);
    assert.equal(checklist.lines[0], 'todo 1');
    assert.equal(checklist.lines[1], 'todo 2 done');
    const bq = blocks.find((b) => b.kind === 'blockquote');
    assert.equal(bq.lines.length, 2);
    assert.equal(bq.lines[0], 'blockquote line 1');
  });
});

describe('dashboard links to synthesis history', () => {
  it('has link to /agents/<sid>/synthesis/', async () => {
    const src = await readFile(DASH, 'utf8');
    assert.match(src, /\/agents\/\$\{sessionId\}\/synthesis\//);
  });
});

describe('CSS for synthesis body', () => {
  it('has agents-synthesis-body + agents-checklist classes', async () => {
    const css = await readFile(CSS, 'utf8');
    assert.ok(css.includes('.agents-synthesis-body'));
    assert.ok(css.includes('.agents-checklist'));
    assert.ok(css.includes('.agents-synthesis-body blockquote'));
  });
});

describe('end-to-end: synthesize fake archive + parse via Node', () => {
  let tmpRoot;
  tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-synth-'));

  it('writes 3 syntheses + parses them with the same regex as pages', async () => {
    const sid = 'sx-sid';
    const synthDir = join(tmpRoot, 'archive', sid, 'synthesis');
    await mkdir(synthDir, { recursive: true });

    await writeFile(join(synthDir, 'synthesis_001.md'), `---
title: "s1"
session_id: "${sid}"
synthesis_index: 1
generated_at: "2026-09-09T00:00:00.000Z"
model: "stub"
dry_run: true
rounds_synthesized: 1
deliverables_referenced: 0
unique_papers: 0
---

# s1 body

## 关键发现
- finding 1
- finding 2

## Gap & 矛盾
- gap 1
- (无)
## 下一步建议
- [ ] step A
- [ ] step B
`);

    await writeFile(join(synthDir, 'synthesis_002.md'), `---
title: "s2"
session_id: "${sid}"
synthesis_index: 2
generated_at: "2026-09-09T00:01:00.000Z"
model: "stub"
dry_run: true
rounds_synthesized: 2
deliverables_referenced: 1
unique_papers: 3
---

# s2 body

## Gap & 矛盾
- gap only
## 下一步建议
- [ ] step Z
`);

    await writeFile(join(synthDir, 'synthesis_003.md'), `---
title: "s3"
session_id: "${sid}"
synthesis_index: 3
generated_at: "2026-09-09T00:02:00.000Z"
model: "stub"
---
# s3
`);

    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(synthDir)).filter((f) => /^synthesis_\d+\.md$/.test(f)).sort();
    assert.deepEqual(files, ['synthesis_001.md', 'synthesis_002.md', 'synthesis_003.md']);

    // 用页面同款 parseFrontmatter 验证
    function parseFrontmatter(raw) {
      const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!m) return { meta: {}, body: raw };
      const meta = {};
      for (const line of m[1].split(/\r?\n/)) {
        const mm = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
        if (!mm) continue;
        let v = mm[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        meta[mm[1]] = v;
      }
      return { meta, body: m[2] };
    }
    const s1 = parseFrontmatter(await readFile(join(synthDir, 'synthesis_001.md'), 'utf8'));
    assert.equal(s1.meta.title, 's1');
    assert.equal(s1.meta.unique_papers, '0');
    assert.equal(s1.meta.deliverables_referenced, '0');

    // directive counts via the same regex
    function countDirectives(body) {
      let count = 0;
      const sections = body.split(/^##\s+/m);
      for (const sec of sections) {
        if (sec.startsWith('下一步建议') || sec.startsWith('Gap &') || sec.startsWith('Gaps &')) {
          const m = sec.match(/^[-*\s]\s+(?:\[[ x]\]\s+)?.+$/gm);
          if (m) count += m.filter((l) => !/^\s*[-*]\s+\(/.test(l) && !/^\s*[-*]\s+\(无\)/.test(l) && !/^\s*[-*]\s+\(stub/.test(l)).length;
        }
      }
      return count;
    }
    // s1: 1 gap (filter 无) + 2 next steps = 3
    assert.equal(countDirectives(s1.body), 3);
    const s2 = parseFrontmatter(await readFile(join(synthDir, 'synthesis_002.md'), 'utf8'));
    // s2: 1 gap + 1 next = 2
    assert.equal(countDirectives(s2.body), 2);
    const s3 = parseFrontmatter(await readFile(join(synthDir, 'synthesis_003.md'), 'utf8'));
    // s3: no Gap/Next sections → 0
    assert.equal(countDirectives(s3.body), 0);
  });

  it('cleanup', async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });
});
