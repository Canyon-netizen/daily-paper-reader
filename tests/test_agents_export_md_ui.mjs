/**
 * tests/test_agents_export_md_ui.mjs — `/agents/<sid>/export.astro` 浏览器导出页面 (iter #58)。
 *
 * 覆盖:
 *   1. 文件存在:astro-src/pages/agents/[sessionId]/export.astro
 *   2. 静态文件 getStaticPaths:扫 archive/<sid>/meta.json 出 sid 列表
 *   3. UI 元素:<h1>📦 Export session ... + 3 个按钮 (download / copy / preview)
 *   4. 客户端脚本:buildExportBundle + formatExportMarkdown 两个纯函数(从源文本抽 regex)
 *   5. 客户端脚本:读 localStorage 优先,fallback 到 archive
 *   6. 客户端脚本:download via Blob + URL.createObjectURL
 *   7. 客户端脚本:clipboard.writeText 走 navigator.clipboard API
 *   8. session dashboard 上有 "📦 导出" 链接到 /agents/<sid>/export/
 *   9. CSS 加了 .agents-export-section / .agents-help / .agents-help-warn 三个 class
 *
 * 跑法:node --test tests/test_agents_export_md_ui.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

const exportPageSrc = await readFile(
  join(REPO, 'astro-src', 'pages', 'agents', '[sessionId]', 'export.astro'),
  'utf8',
);
const dashboardSrc = await readFile(
  join(REPO, 'astro-src', 'pages', 'agents', '[sessionId]', 'index.astro'),
  'utf8',
);
const cssSrc = await readFile(
  join(REPO, 'astro-src', 'styles', 'agents.css'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Tests: file existence + structure
// ---------------------------------------------------------------------------

describe('export.astro page structure (iter #58)', () => {
  it('file exists at astro-src/pages/agents/[sessionId]/export.astro', () => {
    const p = join(REPO, 'astro-src', 'pages', 'agents', '[sessionId]', 'export.astro');
    assert.ok(existsSync(p), `${p} must exist`);
  });

  it('exports getStaticPaths that scans archive/*/meta.json', () => {
    assert.match(exportPageSrc, /export async function getStaticPaths/);
    assert.match(exportPageSrc, /join\(process\.cwd\(\), 'archive'\)/);
    assert.match(exportPageSrc, /'meta\.json'/);
  });

  it('uses BaseLayout + Navbar + agents.css', () => {
    assert.match(exportPageSrc, /import BaseLayout/);
    assert.match(exportPageSrc, /import Navbar/);
    assert.match(exportPageSrc, /import '\.\.\/\.\.\/\.\.\/styles\/agents\.css'/);
  });

  it('renders sessionId header + 3 action buttons', () => {
    assert.match(exportPageSrc, /<h1>📦 Export session <code>/);
    assert.match(exportPageSrc, /id="export-download-btn"/);
    assert.match(exportPageSrc, /id="export-copy-btn"/);
    assert.match(exportPageSrc, /id="export-preview-btn"/);
    assert.match(exportPageSrc, /id="export-preview-area"/);
  });

  it('exposes stats counters in DOM (rounds/proposals/applied/syntheses)', () => {
    assert.match(exportPageSrc, /id="export-rounds"/);
    assert.match(exportPageSrc, /id="export-proposals"/);
    assert.match(exportPageSrc, /id="export-applied"/);
    assert.match(exportPageSrc, /id="export-syntheses"/);
  });

  it('CLI equivalent help block shows --export-md usage', () => {
    assert.match(exportPageSrc, /CLI 等价命令/);
    assert.match(exportPageSrc, /--export-md --session/);
    assert.match(exportPageSrc, /--export-md \.\/my-bundle\.md/);
    assert.match(exportPageSrc, /--export-md --json/);
  });
});

describe('export.astro client script (iter #58)', () => {
  it('defines buildExportBundle pure function (mirror of CLI)', () => {
    // iter #59: 浏览器页 import 自 lib/agents/export-bundle.mjs,不再 inline 定义
    assert.match(
      exportPageSrc,
      /import\s*\{[^}]*buildExportBundle[^}]*\}\s*from\s*['"][^'"]*lib\/agents\/export-bundle\.mjs['"]/,
    );
  });

  it('defines formatExportMarkdown pure function (mirror of CLI)', () => {
    // iter #59: 同上,从 lib import
    assert.match(
      exportPageSrc,
      /import\s*\{[^}]*formatExportMarkdown[^}]*\}\s*from\s*['"][^'"]*lib\/agents\/export-bundle\.mjs['"]/,
    );
  });

  it('reads localStorage keys dpr_agents_rounds_<sid> + dpr_agents_meta_<sid>', () => {
    // keys 由 ROUNDS_KEY(sid)/META_KEY(sid) 派生,sid 形参 → 模板字符串 ${sid}
    assert.match(exportPageSrc, /ROUNDS_KEY = \(sid\) => `dpr_agents_rounds_\$\{sid\}`/);
    assert.match(exportPageSrc, /META_KEY = \(sid\) => `dpr_agents_meta_\$\{sid\}`/);
    assert.match(exportPageSrc, /localStorage\.getItem\(ROUNDS_KEY\(sessionId\)\)/);
    assert.match(exportPageSrc, /localStorage\.getItem\(META_KEY\(sessionId\)\)/);
  });

  it('downloadBundle uses Blob + URL.createObjectURL + a.download', () => {
    assert.match(exportPageSrc, /new Blob\(\[content\]/);
    assert.match(exportPageSrc, /URL\.createObjectURL\(blob\)/);
    assert.match(exportPageSrc, /a\.download = filename/);
    assert.match(exportPageSrc, /a\.click\(\)/);
    assert.match(exportPageSrc, /URL\.revokeObjectURL/);
  });

  it('copyToClipboard uses navigator.clipboard.writeText', () => {
    assert.match(exportPageSrc, /navigator\.clipboard\.writeText/);
  });

  it('wires 3 button click handlers', () => {
    assert.match(exportPageSrc, /export-download-btn'\)\.addEventListener\('click'/);
    assert.match(exportPageSrc, /export-copy-btn'\)\.addEventListener\('click'/);
    assert.match(exportPageSrc, /export-preview-btn'\)\.addEventListener\('click'/);
  });

  it('boots by calling buildCurrentBundle + formatExportMarkdown on load', () => {
    assert.match(exportPageSrc, /\(async \(\) => \{[\s\S]*?buildCurrentBundle/);
    assert.match(exportPageSrc, /lastMd = formatExportMarkdown\(bundle\)/);
  });
});

describe('session dashboard links to export page (iter #58)', () => {
  it('dashboard has 📦 导出 section', () => {
    assert.ok(
      dashboardSrc.includes('📦 导出'),
      'dashboard must include 📦 导出 section',
    );
  });

  it('dashboard link points to /agents/<sid>/export/', () => {
    assert.match(
      dashboardSrc,
      /href=\{`\$\{base\}\/agents\/\$\{sessionId\}\/export\/`\}/,
      'dashboard must link to /agents/<sid>/export/',
    );
  });

  it('dashboard shows CLI equivalent hint', () => {
    assert.match(dashboardSrc, /--export-md --session \{sessionId\}/);
  });
});

describe('CSS classes for export page (iter #58)', () => {
  it('defines .agents-export-section + textarea styling', () => {
    assert.match(cssSrc, /\.agents-export-section/);
    assert.match(cssSrc, /\.agents-export-section textarea/);
  });

  it('defines .agents-help + .agents-help-warn', () => {
    assert.match(cssSrc, /\.agents-help \{/);
    assert.match(cssSrc, /\.agents-help-warn/);
  });
});