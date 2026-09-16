#!/usr/bin/env node
// astro-src/scripts/coverage.mjs
//
// R7 I.2.4: coverage report + badge.
//
// 运行 node test with --experimental-test-coverage,输出 JSON summary 到
// coverage/coverage-summary.json。

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COVERAGE_DIR = join(__dirname, '..', '..', 'coverage');
const SUMMARY_FILE = join(COVERAGE_DIR, 'coverage-summary.json');

/** 确保 coverage 目录存在。 */
function ensureCoverageDir() {
  if (!existsSync(COVERAGE_DIR)) {
    mkdirSync(COVERAGE_DIR, { recursive: true });
  }
}

/** 运行测试并收集 coverage。 */
async function runCoverage() {
  return new Promise((resolve, reject) => {
    const testPattern = join(__dirname, '*.test.mjs');
    const args = [
      '--test',
      '--experimental-test-coverage',
      testPattern,
    ];

    console.log('Running tests with coverage...');
    console.log(`Command: node ${args.join(' ')}`);

    const proc = spawn('node', args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      cwd: join(__dirname, '..', '..'),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(text);
    });

    proc.stderr?.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(text);
    });

    proc.on('close', (code) => {
      // 解析 coverage 输出
      const summary = parseCoverageOutput(stdout + stderr);
      resolve({ code, summary });
    });

    proc.on('error', reject);
  });
}

/** 从 node --test --experimental-test-coverage 输出解析 coverage summary。 */
function parseCoverageOutput(output) {
  // Node.js 20+ 的 coverage 输出格式:
  // Test files:        X tests
  // Suites:            X suites
  # Tests:           X tests passed
  # Todo:            X todo
  # Skipped:         X skipped
  # Coverage:        X% (lines: X% , functions: X% , branches: X% , statements: X%)
  //
  # Slowest test cases:

  const result = {
    timestamp: new Date().toISOString(),
    testFiles: 0,
    suites: 0,
    tests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    todo: 0,
    coverage: {
      lines: 0,
      functions: 0,
      branches: 0,
      statements: 0,
    },
  };

  const lines = output.split('\n');
  for (const line of lines) {
    const m = line.match(/Test files:\s*(\d+)/);
    if (m) result.testFiles = parseInt(m[1], 10);

    const s = line.match(/Suites:\s*(\d+)/);
    if (s) result.suites = parseInt(s[1], 10);

    const tp = line.match(/# Tests:\s*(\d+)/);
    if (tp) result.tests = parseInt(tp[1], 10);

    const pp = line.match(/(\d+) tests passed/);
    if (pp) result.passed = parseInt(pp[1], 10);

    const fp = line.match(/(\d+) tests failed/);
    if (fp) result.failed = parseInt(fp[1], 10);

    const sp = line.match(/# Skipped:\s*(\d+)/);
    if (sp) result.skipped = parseInt(sp[1], 10);

    const td = line.match(/# Todo:\s*(\d+)/);
    if (td) result.todo = parseInt(td[1], 10);

    // Coverage: 85.42% (lines: 82.31% , functions: 89.47% , branches: 75% , statements: 85.42%)
    const cv = line.match(/Coverage:\s*([\d.]+)%/);
    if (cv) {
      result.coverage.lines = parseFloat(cv[1]);
    }
    const cvLines = line.match(/lines:\s*([\d.]+)%/);
    if (cvLines) result.coverage.lines = parseFloat(cvLines[1]);
    const cvFn = line.match(/functions:\s*([\d.]+)%/);
    if (cvFn) result.coverage.functions = parseFloat(cvFn[1]);
    const cvBr = line.match(/branches:\s*([\d.]+)%/);
    if (cvBr) result.coverage.branches = parseFloat(cvBr[1]);
    const cvSt = line.match(/statements:\s*([\d.]+)%/);
    if (cvSt) result.coverage.statements = parseFloat(cvSt[1]);
  }

  return result;
}

/** 生成 badge SVG。 */
function generateBadge(summary) {
  const pct = Math.round(summary.coverage.lines);
  let color = '#red';
  if (pct >= 80) color = '#4c1';
  else if (pct >= 60) color = '#f59e0b';
  else if (pct >= 40) color = '#orange';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20">
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="round">
    <rect width="100" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#round)">
    <rect width="60" height="20" fill="#555"/>
    <rect x="60" width="40" height="20" fill="${color}"/>
    <rect width="100" height="20" fill="url(#smooth)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text x="35" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="300">coverage</text>
    <text x="35" y="140" transform="scale(.1)" textLength="300">coverage</text>
    <text x="80" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="400">${pct}%</text>
    <text x="80" y="140" transform="scale(.1)" textLength="400">${pct}%</text>
  </g>
</svg>`;
}

async function main() {
  ensureCoverageDir();

  const { code, summary } = await runCoverage();

  // 写入 JSON summary
  writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  console.log(`\nCoverage summary written to: ${SUMMARY_FILE}`);

  // 写入 badge
  const badgePath = join(COVERAGE_DIR, 'coverage-badge.svg');
  writeFileSync(badgePath, generateBadge(summary));
  console.log(`Badge written to: ${badgePath}`);

  console.log('\n=== Coverage Summary ===');
  console.log(`Lines: ${summary.coverage.lines}%`);
  console.log(`Functions: ${summary.coverage.functions}%`);
  console.log(`Branches: ${summary.coverage.branches}%`);
  console.log(`Statements: ${summary.coverage.statements}%`);
  console.log(`Tests: ${summary.passed} passed, ${summary.failed} failed`);

  // 返回码:有 failed tests 时非 0
  process.exit(code ?? (summary.failed > 0 ? 1 : 0));
}

main().catch((err) => {
  console.error('Coverage failed:', err);
  process.exit(1);
});
