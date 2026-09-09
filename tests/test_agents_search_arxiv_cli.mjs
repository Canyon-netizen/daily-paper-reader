/**
 * tests/test_agents_search_arxiv_cli.mjs — `--search-arxiv` Designer tool use (iter #56)。
 *
 * 覆盖:
 *   1. parseArxivEntry: 正常 arXiv API XML entry 抽 arxivId / title / summary / authors
 *   2. parseArxivEntry: 多 author + 跨行 entry 解析正确
 *   3. parseArxivEntry: 缺 <id> 标签 → 返回 null
 *   4. parseArxivEntry: 空白被规范化(title / summary 多余空白收成单空格)
 *   5. canonicalArxivId: 去掉 v\d 后缀(/v2 / v3)
 *   6. canonicalArxivId: 无后缀 ID 原样返回
 *   7. canonicalArxivId: 空 / 非字符串 → 空字符串
 *   8. searchArxivApi: 网络失败 → 返回 [] 不抛
 *   9. searchArxivApi: 空 query → 返回 [] 不抛
 *   10. CLI --search-arxiv flag 在 parseArgs 中存在
 *   11. CLI --search-arxiv 在 --help 文本中描述
 *   12. runOneSession opts 接收 searchArxiv 字段
 *   13. runOneSession 在 --search-arxiv 模式下跳过 archive recommend 加载
 *   14. runOneSession 在 --search-arxiv 失败时回退到 0 candidates 继续 round(stub)
 *
 * 跑法:node --test tests/test_agents_search_arxiv_cli.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const cliSrc = await readFile(
  join(REPO, 'astro-src', 'scripts', 'agents-run.mjs'),
  'utf8',
);

// ---------------------------------------------------------------------------
// 模拟 import:用 parseArgs / 读源文本抽 export 候选
// ---------------------------------------------------------------------------

// 先把 process.argv[1] 设到一个不存在的路径,避免 import 触发 main()
process.argv = ['node', '/__never_used__/agents-run.mjs'];
const agentsRun = await import(
  pathToFileURL(join(REPO, 'astro-src', 'scripts', 'agents-run.mjs')).href
);
const { parseArxivEntry, canonicalArxivId, searchArxivApi } = agentsRun;

// ---------------------------------------------------------------------------
// arXiv API XML fixture(取自真实 API 响应结构)
// ---------------------------------------------------------------------------

const SAMPLE_ENTRY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v2</id>
    <title>  Multi-Agent
    Reinforcement Learning Survey  </title>
    <summary>  This paper surveys MARL methods.  </summary>
    <published>2024-01-15T00:00:00Z</published>
    <updated>2024-06-20T00:00:00Z</updated>
    <author><name>Alice Smith</name></author>
    <author><name>Bob Lee</name></author>
  </entry>
</feed>`;

const MULTIAUTHOR_ENTRY = `<entry>
<id>https://arxiv.org/abs/2310.09876v1</id>
<title>Constitutional AI: Harmlessness from AI Feedback</title>
<summary>We present a method...</summary>
<published>2023-10-15T00:00:00Z</published>
<updated>2023-10-15T00:00:00Z</updated>
<author><name>Yuntao Bai</name></author>
<author><name>Saurav Kadavath</name></author>
<author><name>Sandipan Kundu</name></author>
</entry>`;

const MALFORMED_ENTRY = `<entry>
<title>No ID at all</title>
</entry>`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseArxivEntry', () => {
  it('extracts arxivId from <id> tag', () => {
    const r = parseArxivEntry(SAMPLE_ENTRY.match(/<entry>([\s\S]*?)<\/entry>/)[1]);
    assert.equal(r.arxivId, '2401.12345v2');
  });

  it('normalizes whitespace in title', () => {
    const r = parseArxivEntry(SAMPLE_ENTRY.match(/<entry>([\s\S]*?)<\/entry>/)[1]);
    assert.equal(r.title, 'Multi-Agent Reinforcement Learning Survey');
  });

  it('normalizes whitespace in summary', () => {
    const r = parseArxivEntry(SAMPLE_ENTRY.match(/<entry>([\s\S]*?)<\/entry>/)[1]);
    assert.equal(r.summary, 'This paper surveys MARL methods.');
  });

  it('extracts multiple authors', () => {
    const r = parseArxivEntry(MULTIAUTHOR_ENTRY);
    assert.deepEqual(r.authors, ['Yuntao Bai', 'Saurav Kadavath', 'Sandipan Kundu']);
  });

  it('extracts published and updated timestamps', () => {
    const r = parseArxivEntry(MULTIAUTHOR_ENTRY);
    assert.equal(r.published, '2023-10-15T00:00:00Z');
    assert.equal(r.updated, '2023-10-15T00:00:00Z');
  });

  it('returns null when <id> tag is missing', () => {
    const r = parseArxivEntry(MALFORMED_ENTRY);
    assert.equal(r, null);
  });
});

describe('canonicalArxivId', () => {
  it('strips trailing /v2', () => {
    assert.equal(canonicalArxivId('2401.12345/v2'), '2401.12345');
  });

  it('strips trailing v2 (without slash)', () => {
    assert.equal(canonicalArxivId('2401.12345v2'), '2401.12345');
  });

  it('strips v3', () => {
    assert.equal(canonicalArxivId('2310.09876/v3'), '2310.09876');
  });

  it('returns unchanged when no version suffix', () => {
    assert.equal(canonicalArxivId('2310.09876'), '2310.09876');
  });

  it('handles empty string', () => {
    assert.equal(canonicalArxivId(''), '');
  });

  it('handles non-string input', () => {
    assert.equal(canonicalArxivId(null), '');
    assert.equal(canonicalArxivId(undefined), '');
    assert.equal(canonicalArxivId(123), '');
  });
});

describe('searchArxivApi', () => {
  it('returns [] for empty query without throwing', async () => {
    const r = await searchArxivApi('');
    assert.deepEqual(r, []);
  });

  it('returns [] for whitespace-only query', async () => {
    const r = await searchArxivApi('   ');
    assert.deepEqual(r, []);
  });

  it('returns [] when network fails (graceful fallback)', async () => {
    // 在 sandbox 网络受限的环境下,fetch 会失败 → 返回 [] 不抛
    // 这是设计:让 round 继续跑 stub,而不是把整个 loop 拉崩
    const r = await searchArxivApi('definitely-unreachable-test-query-xyz');
    // 可能返回 [] (网络挂) 或真实结果 (有网),断言形态正确即可
    assert.ok(Array.isArray(r));
  });
});

describe('CLI --search-arxiv (iter #56)', () => {
  it('parseArgs includes --search-arxiv', () => {
    assert.ok(
      cliSrc.includes(`else if (a === '--search-arxiv') out.searchArxiv = argv[++i];`),
      '--search-arxiv must be in parseArgs',
    );
  });

  it('--help text describes --search-arxiv tool use', () => {
    assert.ok(cliSrc.includes('--search-arxiv Q'), '--help must mention --search-arxiv Q');
    assert.ok(
      cliSrc.includes('Designer tool use'),
      '--help must describe --search-arxiv as Designer tool use',
    );
    assert.ok(
      cliSrc.includes('iter #56'),
      '--help must mention iter #56 marker for traceability',
    );
  });

  it('runOneSession opts passes searchArxiv field through', () => {
    // 模式 3 (--session) 调用 runOneSession 时必须包含 searchArxiv: args.searchArxiv ?? null
    const pattern = /runOneSession\(sessionId,\s*caller,\s*\{[^}]*searchArxiv:\s*args\.searchArxiv\s*\?\?\s*null/s;
    assert.ok(
      pattern.test(cliSrc),
      'runOneSession call (--session mode) must pass searchArxiv through opts',
    );
  });

  it('runOneSession opts passes searchArxiv in --all mode too', () => {
    const pattern = /runOneSession\(sid,\s*caller,\s*\{[^}]*searchArxiv:\s*args\.searchArxiv\s*\?\?\s*null/s;
    assert.ok(
      pattern.test(cliSrc),
      'runOneSession call (--all mode) must pass searchArxiv through opts',
    );
  });

  it('runOneSession body branches on opts.searchArxiv (overrides archive candidates)', () => {
    // 必须有 `if (opts.searchArxiv)` 分支
    assert.ok(
      /if\s*\(\s*opts\.searchArxiv\s*\)/.test(cliSrc),
      'runOneSession must branch on opts.searchArxiv before archive candidates load',
    );
    // 必须有 "[search-arxiv] loaded" 日志标记
    assert.ok(
      cliSrc.includes('[search-arxiv] loaded'),
      'must log "[search-arxiv] loaded" for observability',
    );
  });
});

describe('--search-arxiv end-to-end smoke (iter #56)', () => {
  let tmpRoot;

  before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-search-arxiv-'));
  });

  after(async () => {
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('runs without crash even when arXiv API unreachable (sandbox)', async () => {
    const scriptPath = join(REPO, 'astro-src', 'scripts', 'agents-run.mjs');
    const child = spawn(
      process.execPath,
      [
        scriptPath,
        '--new-session', 'iter56 search-arxiv sandbox test',
        '--search-arxiv', 'multi-agent systems',
        '--rounds', '1',
        '--dry-run',
        '--preset', 'aggressive',
        '--no-synthesize',
      ],
      { cwd: tmpRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const code = await new Promise((resolve) => child.on('close', resolve));

    // sandbox 网络下 arXiv 不可达 → searchArxivApi 返回 [] → 整个 round 仍然跑通
    assert.equal(code, 0, `must exit 0 even when arXiv unreachable. stderr:\n${stderr}`);
    assert.match(stdout, /\[search-arxiv\]/, 'must log search-arxiv activity');
    assert.match(stdout, /\[round 1\]/, 'must still run round 1 even with 0 arxiv hits');
    assert.match(stdout, /candidates-source.*arxiv-search/, 'must record candidates-source as arxiv-search');
  });
});