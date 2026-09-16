#!/usr/bin/env node
// astro-src/scripts/audit-secrets.test.mjs
//
// Tests for R7 I.3.3 secrets auditor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanFile, auditSecrets } from '../../scripts/audit-secrets.mjs';

// helper
function makeWorkflow(content) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-secrets-'));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  const file = join(dir, '.github', 'workflows', 'fake.yml');
  writeFileSync(file, content, 'utf8');
  return join(dir, '.github', 'workflows');
}

test('scanFile: 干净 workflow 无 finding', () => {
  const dir = makeWorkflow(`
name: ok
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - run: echo "hello"
`);
  const findings = scanFile(join(dir, 'fake.yml'));
  assert.deepEqual(findings, []);
});

test('scanFile: GITHUB_TOKEN 引用合法', () => {
  const dir = makeWorkflow(`
name: ok
on: push
jobs:
  build:
    steps:
      - run: echo "\${{ secrets.GITHUB_TOKEN }}"
`);
  const findings = scanFile(join(dir, 'fake.yml'));
  assert.deepEqual(findings, []);
});

test('scanFile: github.token 合法', () => {
  const dir = makeWorkflow(`
name: ok
on: push
jobs:
  build:
    steps:
      - run: echo "\${{ github.token }}"
`);
  const findings = scanFile(join(dir, 'fake.yml'));
  assert.deepEqual(findings, []);
});

test('scanFile: 注释里的 token 忽略', () => {
  const dir = makeWorkflow(`
name: ok
on: push
# token: 这是一个 token 字段的说明
jobs:
  build:
    steps:
      - run: echo hi
`);
  const findings = scanFile(join(dir, 'fake.yml'));
  assert.deepEqual(findings, []);
});

test('scanFile: 硬编码 api_key 检出', () => {
  const dir = makeWorkflow(`
name: bad
on: push
jobs:
  build:
    env:
      api_key: "abcd1234efgh5678ijkl9012mnop"
    steps:
      - run: echo \$api_key
`);
  const findings = scanFile(join(dir, 'fake.yml'));
  assert.ok(findings.length >= 1);
  assert.ok(findings.some((f) => f.rule === 'hardcoded-api-key'));
});

test('scanFile: 硬编码 password 检出', () => {
  const dir = makeWorkflow(`
name: bad
on: push
jobs:
  build:
    env:
      PASSWORD: "supersecret123"
    steps:
      - run: echo hi
`);
  const findings = scanFile(join(dir, 'fake.yml'));
  assert.ok(findings.some((f) => f.rule === 'hardcoded-password'));
});

test('scanFile: 短字符串 password 不检出(< 6 char)', () => {
  const dir = makeWorkflow(`
name: ok
on: push
jobs:
  build:
    env:
      PASSWORD: "abc"
    steps:
      - run: echo hi
`);
  const findings = scanFile(join(dir, 'fake.yml'));
  assert.deepEqual(findings, []);
});

test('scanFile: echo secret 检出', () => {
  const dir = makeWorkflow(`
name: bad
on: push
jobs:
  build:
    steps:
      - run: echo \${{ secrets.SOME_KEY }}
`);
  const findings = scanFile(join(dir, 'fake.yml'));
  assert.ok(findings.some((f) => f.rule === 'echo-secret'));
});

test('auditSecrets: 扫整个目录', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-full-'));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(dir, '.github', 'workflows', 'a.yml'), 'name: a\non: push\n', 'utf8');
  writeFileSync(join(dir, '.github', 'workflows', 'b.yml'), 'name: b\non: push\n', 'utf8');
  const r = auditSecrets(join(dir, '.github', 'workflows'));
  assert.equal(r.scannedFiles, 2);
});

test('auditSecrets: bySeverity 计数正确', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-sev-'));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(
    join(dir, '.github', 'workflows', 'bad.yml'),
    'name: x\nenv:\n  api_key: "1234567890abcdef1234"\n',
    'utf8'
  );
  const r = auditSecrets(join(dir, '.github', 'workflows'));
  assert.ok(r.bySeverity.high >= 1);
});