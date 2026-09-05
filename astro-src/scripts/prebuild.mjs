#!/usr/bin/env node
// astro-src/scripts/prebuild.mjs
//
// 并行跑 3 个 prebuild 脚本,替代 package.json 里的串行 && 链。
// Phase J4 — 三个脚本之间无 IO 依赖(都写自己的 public/* 输出),可安全并行。
//
// 行为:
//   - spawn 3 个 child process
//   - 把每个脚本的 stdout/stderr 前缀 [script-name] 后实时打印
//   - 任一 exit code != 0 立即 kill 其他并以非零退出
//   - 全成功 → exit 0
//
// 收益:之前 ~32s 串行 → 现在 ~14s 并行(取决于最慢的脚本,通常是 copy-docs-assets)。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = [
  { name: 'arxiv-index', cmd: 'node', args: [join(HERE, 'build-arxiv-index.mjs')] },
  { name: 'copy-docs', cmd: 'node', args: [join(HERE, 'copy-docs-assets.mjs')] },
  { name: 'search-corpus', cmd: 'node', args: [join(HERE, 'build-search-corpus.mjs')] },
];

const children = [];
let failed = false;

for (const s of SCRIPTS) {
  const c = spawn(s.cmd, s.args, { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push({ name: s.name, child: c });
  const prefix = `[${s.name}]`;
  c.stdout.on('data', (b) => process.stdout.write(prefixLines(prefix, b.toString())));
  c.stderr.on('data', (b) => process.stderr.write(prefixLines(prefix, b.toString())));
  c.on('exit', (code) => {
    if (code !== 0 && !failed) {
      failed = true;
      console.error(`\n[prebuild] ${s.name} exited with code ${code}, killing others...`);
      for (const other of children) {
        if (other.child !== c && !other.child.killed) other.child.kill();
      }
    }
  });
}

// wait for all
const exitCode = await new Promise((resolve) => {
  let remaining = SCRIPTS.length;
  for (const { child } of children) {
    child.on('exit', (code) => {
      remaining -= 1;
      if (remaining === 0) {
        resolve(failed ? 1 : 0);
      }
    });
  }
});

function prefixLines(prefix, text) {
  // 给每一行加 prefix (除空行),让 3 个脚本输出交错时仍能区分
  return text.split('\n').map((line, i, arr) => {
    if (i === arr.length - 1 && line === '') return line;
    return line ? `${prefix} ${line}` : line;
  }).join('\n');
}

process.exit(exitCode);
