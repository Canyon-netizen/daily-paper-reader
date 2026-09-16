#!/usr/bin/env node
// scripts/audit-secrets.mjs
//
// R7 I.3.3: GitHub Actions secrets 审计。
//
// 扫所有 .github/workflows/*.yml + .github/workflows/*.yaml:
//   1. 检测有没有硬编码 secret 模式(API key / password / token 字面量)
//   2. 检测 echo / run 块里 ${{ secrets.* }} 是否会被 log
//   3. 输出 JSON 报告 + exit code 1(有发现)
//
// 排除 false positives:
//   - ${{ secrets.GITHUB_TOKEN }} 是 GHA 自动注入,合法
//   - ${{ github.token }} 同理
//   - 'token' 出现在注释 / 描述字段忽略

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows');

const PATTERNS = [
  {
    rule: 'hardcoded-api-key',
    severity: 'high',
    re: /(?:api[_-]?key|api[_-]?secret|secret[_-]?key)["']?\s*[:=]\s*["']([A-Za-z0-9_\-]{16,})["']/i,
    description: '疑似硬编码 API key — 应改用 ${{ secrets.* }}',
  },
  {
    rule: 'hardcoded-password',
    severity: 'high',
    re: /(?:password|passwd|pwd)["']?\s*[:=]\s*["']([^"'\s]{6,})["']/i,
    description: '疑似硬编码密码',
  },
  {
    rule: 'hardcoded-token',
    severity: 'high',
    re: /(?<!secrets\.|env\.|github\.)\btoken["']?\s*[:=]\s*["']([A-Za-z0-9_\-]{16,})["']/i,
    description: '疑似硬编码 token',
  },
  {
    rule: 'echo-secret',
    severity: 'medium',
    re: /echo\s+.*\$\{\{\s*secrets\./i,
    description: 'echo secret — 会进 GH Actions 日志,敏感字段不要 echo',
  },
  {
    rule: 'log-secret',
    severity: 'medium',
    re: /run:\s*\|[^]*\$\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}/i,
    description: '在 run: 块里引用 secret — 若该字段会被 echo / log 会泄露',
  },
];

const SAFE_LINE_PATTERNS = [
  /secrets\.GITHUB_TOKEN/,
  /\$\{\{\s*github\.token\s*\}\}/,
  /#.*?(api[_-]?key|password|token)/i,
];

function listWorkflows() {
  try {
    return readdirSync(WORKFLOWS_DIR)
      .filter((f) => /\.(yml|yaml)$/i.test(f))
      .map((f) => join(WORKFLOWS_DIR, f));
  } catch {
    return [];
  }
}

function scanFile(file) {
  const out = [];
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const lines = content.split(/\r?\n/);
  const baseName = file.split('/').pop() || file;

  lines.forEach((line, idx) => {
    if (SAFE_LINE_PATTERNS.some((p) => p.test(line))) return;
    for (const p of PATTERNS) {
      const m = line.match(p.re);
      if (m) {
        out.push({
          workflow: baseName,
          line: idx + 1,
          rule: p.rule,
          match: m[0].slice(0, 80),
          severity: p.severity,
          description: p.description,
        });
      }
    }
  });
  return out;
}

function auditSecrets(workflowsDir = WORKFLOWS_DIR) {
  const files = readdirSync(workflowsDir)
    .filter((f) => /\.(yml|yaml)$/i.test(f))
    .map((f) => join(workflowsDir, f));
  const findings = files.flatMap(scanFile);
  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const f of findings) bySeverity[f.severity]++;
  return { scannedFiles: files.length, findings, bySeverity };
}

// CLI entry
const isMain = import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] || '');
if (isMain) {
  const report = auditSecrets();
  const json = JSON.stringify(report, null, 2);
  if (report.findings.length === 0) {
    console.log(`✓ audit-secrets: 扫了 ${report.scannedFiles} 个 workflow, 未发现硬编码 secret`);
    console.log(json);
    process.exit(0);
  }
  console.error(`✗ audit-secrets: 发现 ${report.findings.length} 条问题`);
  for (const f of report.findings) {
    console.error(`  [${f.severity}] ${f.workflow}:${f.line} ${f.rule} — ${f.description}`);
    console.error(`    match: ${f.match}`);
  }
  console.error(json);
  process.exit(1);
}

export { auditSecrets, scanFile, listWorkflows };