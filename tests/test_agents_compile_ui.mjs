/**
 * tests/test_agents_compile_ui.mjs — /agents/<sid>/compile.astro 浏览器装配页 (iter #62)。
 *
 * 覆盖:
 *   1. 文件存在:astro-src/pages/agents/[sessionId]/compile.astro
 *   2. getStaticPaths:扫 archive/<sid>/meta.json 出 sid 列表
 *   3. UI 元素:<h1>📄 Compile session ... + 4 个按钮 + format/class 下拉
 *   4. 客户端脚本:从 paper-compiler.mjs 导入 buildPaperDraft / formatPaperLatex / formatPaperMarkdown / formatBibtex
 *   5. 客户端脚本:从 localStorage 读 rounds + meta,合成 pseudo-deliverables
 *   6. 客户端脚本:format 切换实时重新渲染
 *   7. 客户端脚本:Download 触发 3 个文件下载(.tex / .md / .bib)
 *   8. 客户端脚本:clipboard 走 navigator.clipboard API
 *   9. session dashboard 上有 "📄 浏览器装配" 链接到 /agents/<sid>/compile/
 *
 * 跑法:node --test tests/test_agents_compile_ui.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

const compilePage = join(REPO, 'astro-src', 'pages', 'agents', '[sessionId]', 'compile.astro');
const dashboardPage = join(REPO, 'astro-src', 'pages', 'agents', '[sessionId]', 'index.astro');

const compilePageExists = existsSync(compilePage);
const compilePageSrc = compilePageExists ? await readFile(compilePage, 'utf8') : '';
const dashboardSrc = await readFile(dashboardPage, 'utf8');

// ---------------------------------------------------------------------------

describe('compile.astro page exists', () => {
  it('astro-src/pages/agents/[sessionId]/compile.astro is present', () => {
    assert.ok(compilePageExists, 'compile.astro not found');
  });
});

describe('compile.astro page structure', () => {
  it('imports BaseLayout + Navbar + agents.css', () => {
    assert.match(compilePageSrc, /import BaseLayout from/);
    assert.match(compilePageSrc, /import Navbar from/);
    assert.match(compilePageSrc, /import '\.\.\/\.\.\/\.\.\/styles\/agents\.css'/);
  });

  it('defines getStaticPaths that enumerates archive/ with meta.json', () => {
    assert.match(compilePageSrc, /export async function getStaticPaths\(\)/);
    assert.match(compilePageSrc, /archive/);
    assert.match(compilePageSrc, /meta\.json/);
  });

  it('renders the session id in the header', () => {
    assert.match(compilePageSrc, /<h1>📄 Compile session <code>\{sessionId\}<\/code><\/h1>/);
  });

  it('renders the breadcrumb back to /agents/ and session detail', () => {
    assert.match(compilePageSrc, /← Agents Console/);
    assert.match(compilePageSrc, /\/agents\/\$\{sessionId\}\//);
    assert.match(compilePageSrc, /<span>compile<\/span>/);
  });

  it('exposes 4 action buttons: download / copy / refresh / back', () => {
    assert.match(compilePageSrc, /id="compile-download-btn"/);
    assert.match(compilePageSrc, /id="compile-copy-btn"/);
    assert.match(compilePageSrc, /id="compile-refresh-btn"/);
    assert.match(compilePageSrc, /← Back/);
  });

  it('exposes a format selector (latex / markdown / bib)', () => {
    assert.match(compilePageSrc, /id="compile-format"/);
    assert.match(compilePageSrc, /<option value="latex">LaTeX/);
    assert.match(compilePageSrc, /<option value="markdown">Markdown/);
    assert.match(compilePageSrc, /<option value="bib">BibTeX/);
  });

  it('exposes a document class selector (article / acmart / ieeeconf / iclr2026)', () => {
    assert.match(compilePageSrc, /id="compile-class"/);
    assert.match(compilePageSrc, /<option value="article">article/);
    assert.match(compilePageSrc, /<option value="acmart">acmart/);
    assert.match(compilePageSrc, /<option value="ieeeconf">IEEE/);
    assert.match(compilePageSrc, /<option value="iclr2026">iclr2026/);
  });

  it('exposes a stats row with rounds / deliverables / references / sections', () => {
    assert.match(compilePageSrc, /id="compile-rounds"/);
    assert.match(compilePageSrc, /id="compile-deliverables"/);
    assert.match(compilePageSrc, /id="compile-references"/);
    assert.match(compilePageSrc, /id="compile-sections"/);
    assert.match(compilePageSrc, /id="compile-source-tag"/);
  });

  it('exposes a preview textarea + preview title', () => {
    assert.match(compilePageSrc, /id="compile-preview-area"/);
    assert.match(compilePageSrc, /id="compile-preview-title"/);
  });

  it('shows the empty-state warning when no localStorage rounds', () => {
    assert.match(compilePageSrc, /id="compile-empty-warn"/);
    assert.match(compilePageSrc, /⚠️/);
  });

  it('explains CLI equivalent + download instructions', () => {
    assert.match(compilePageSrc, /--compile-paper/);
    assert.match(compilePageSrc, /pdflatex/);
    assert.match(compilePageSrc, /xelatex/);
  });
});

describe('compile.astro client script', () => {
  it('imports the 4 paper-compiler functions from the shared mjs', () => {
    assert.match(compilePageSrc, /import \{[\s\S]*buildPaperDraft/);
    assert.match(compilePageSrc, /import \{[\s\S]*formatPaperLatex/);
    assert.match(compilePageSrc, /import \{[\s\S]*formatPaperMarkdown/);
    assert.match(compilePageSrc, /import \{[\s\S]*formatBibtex/);
    assert.match(compilePageSrc, /from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/agents\/paper-compiler\.mjs'/);
  });

  it('reads localStorage meta and rounds with dpr_agents_{meta,rounds}_<sid> keys', () => {
    assert.match(compilePageSrc, /ROUNDS_KEY\s*=\s*\(sid\)\s*=>\s*`dpr_agents_rounds_\$\{sid\}`/);
    assert.match(compilePageSrc, /META_KEY\s*=\s*\(sid\)\s*=>\s*`dpr_agents_meta_\$\{sid\}`/);
    assert.match(compilePageSrc, /localStorage\.getItem\(META_KEY\(sessionId\)\)/);
    assert.match(compilePageSrc, /localStorage\.getItem\(ROUNDS_KEY\(sessionId\)\)/);
  });

  it('synthesizes pseudo-deliverables from localStorage round proposals', () => {
    assert.match(compilePageSrc, /function extractDeliverableLikeFromRounds/);
    assert.match(compilePageSrc, /r\?\.designer\?\.proposals/);
    assert.match(compilePageSrc, /draft/);
    assert.match(compilePageSrc, /review/);
    assert.match(compilePageSrc, /experiment/);
    assert.match(compilePageSrc, /paper_addition/);
    assert.match(compilePageSrc, /rebuttal/);
  });

  it('calls buildPaperDraft and routes the output by format', () => {
    assert.match(compilePageSrc, /buildPaperDraft\(\{/);
    assert.match(compilePageSrc, /formatPaperLatex\(draft/);
    assert.match(compilePageSrc, /formatPaperMarkdown\(draft\)/);
    assert.match(compilePageSrc, /formatBibtex\(draft\.bibliography\)/);
  });

  it('wires format-selector change to re-render', () => {
    assert.match(compilePageSrc, /id="compile-format"[\s\S]*addEventListener\('change'/);
  });

  it('wires class-selector change to re-render LaTeX only', () => {
    assert.match(compilePageSrc, /id="compile-class"[\s\S]*addEventListener\('change'/);
    assert.match(compilePageSrc, /getCurrentFormat\(\)\s*===\s*['"]latex['"]/);
  });

  it('downloads the full 3-file suite (paper.tex + paper.md + refs.bib)', () => {
    assert.match(compilePageSrc, /function downloadFile/);
    assert.match(compilePageSrc, /URL\.createObjectURL/);
    assert.match(compilePageSrc, /a\.download = filename/);
    assert.match(compilePageSrc, /\$\{sid\}-paper\.tex/);
    assert.match(compilePageSrc, /\$\{sid\}-paper\.md/);
    assert.match(compilePageSrc, /\$\{sid\}-refs\.bib/);
  });

  it('copies preview to clipboard via navigator.clipboard.writeText', () => {
    assert.match(compilePageSrc, /navigator\.clipboard\.writeText/);
  });

  it('boots by calling buildCurrentDraft + renderStats + renderPreview on load', () => {
    assert.match(compilePageSrc, /function boot\(\)/);
    assert.match(compilePageSrc, /buildCurrentDraft\(\)/);
    assert.match(compilePageSrc, /renderStats\(draft, source\)/);
    assert.match(compilePageSrc, /renderPreview\(draft, getCurrentFormat/);
  });
});

describe('compile.astro documents iter #62 in its own page', () => {
  it('mentions iter #61 (CLI --compile-paper) as the source of truth', () => {
    assert.match(compilePageSrc, /iter #61/);
    assert.match(compilePageSrc, /--compile-paper/);
  });

  it('mentions iter #62 in the explanation section', () => {
    assert.match(compilePageSrc, /iter #62/);
  });
});

describe('session dashboard links to compile.astro', () => {
  it('renders a "📄 浏览器装配" link to /agents/<sid>/compile/', () => {
    assert.match(dashboardSrc, /\/agents\/\$\{sessionId\}\/compile\//);
    assert.match(dashboardSrc, /📄 浏览器装配/);
  });

  it('shows the CLI --compile-paper equivalent next to the link', () => {
    assert.match(dashboardSrc, /--compile-paper/);
  });
});
