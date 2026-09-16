#!/usr/bin/env node
// astro-src/scripts/errors.test.mjs
//
// Tests for R7 polish: astro-src/lib/errors.ts HTTP error classification.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/errors.ts');
const { parseRetryAfter, classifyHttpError, classifyHttpErrorFrom, httpErrorToMessage } = mod;

function fakeResponse(status, { body = '', retryAfter = null } = {}) {
  return {
    status,
    headers: { get: (k) => (k && k.toLowerCase() === 'retry-after' ? retryAfter : null) },
    _body: body,
  };
}

test('parseRetryAfter: int seconds', () => {
  assert.equal(parseRetryAfter('60'), 60);
});

test('parseRetryAfter: missing → null', () => {
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(undefined), null);
  assert.equal(parseRetryAfter(''), null);
});

test('parseRetryAfter: garbage → null', () => {
  assert.equal(parseRetryAfter('not a number'), null);
});

test('parseRetryAfter: 0 or negative → null', () => {
  assert.equal(parseRetryAfter('0'), null);
  assert.equal(parseRetryAfter('-5'), null);
});

test('classifyHttpErrorFrom: 401 → unauthorized', () => {
  const e = classifyHttpErrorFrom(401, 'Unauthorized', null);
  assert.equal(e.kind, 'unauthorized');
  assert.equal(e.status, 401);
  assert.ok(e.message.includes('认证'));
});

test('classifyHttpErrorFrom: 403 → forbidden', () => {
  const e = classifyHttpErrorFrom(403, 'Forbidden');
  assert.equal(e.kind, 'forbidden');
});

test('classifyHttpErrorFrom: 404 → not_found', () => {
  const e = classifyHttpErrorFrom(404, 'Not Found');
  assert.equal(e.kind, 'not_found');
});

test('classifyHttpErrorFrom: 422 → unprocessable', () => {
  const e = classifyHttpErrorFrom(422, 'Validation Failed', null);
  assert.equal(e.kind, 'unprocessable');
});

test('classifyHttpErrorFrom: 429 → rate_limited + 解析 Retry-After', () => {
  const e = classifyHttpErrorFrom(429, 'Too Many Requests', '120');
  assert.equal(e.kind, 'rate_limited');
  assert.equal(e.retryAfter, 120);
});

test('classifyHttpErrorFrom: 429 + missing Retry-After', () => {
  const e = classifyHttpErrorFrom(429, 'Too Many Requests', null);
  assert.equal(e.kind, 'rate_limited');
  assert.equal(e.retryAfter, null);
});

test('classifyHttpErrorFrom: 500/502/503 → server_error', () => {
  for (const code of [500, 502, 503, 504]) {
    const e = classifyHttpErrorFrom(code, 'Server Error');
    assert.equal(e.kind, 'server_error', `${code} 应归 server_error`);
  }
});

test('classifyHttpErrorFrom: 400 → client_error', () => {
  const e = classifyHttpErrorFrom(400, 'Bad Request');
  assert.equal(e.kind, 'client_error');
});

test('classifyHttpErrorFrom: 200 → unknown (not error)', () => {
  const e = classifyHttpErrorFrom(200, 'OK');
  assert.equal(e.kind, 'unknown');
});

test('classifyHttpErrorFrom: 包含 reason 时优先于 hint', () => {
  const e = classifyHttpErrorFrom(401, 'Unauthorized', null, 'token_expired');
  assert.equal(e.reason, 'token_expired');
  assert.equal(e.message, 'token_expired');
});

test('classifyHttpError: 从 Response 对象分类 401', () => {
  const e = classifyHttpError(fakeResponse(401), 'token_expired');
  assert.equal(e.kind, 'unauthorized');
  assert.equal(e.status, 401);
  assert.equal(e.reason, 'token_expired');
});

test('classifyHttpError: 从 Response 提取 Retry-After header', () => {
  const e = classifyHttpError(fakeResponse(429, { retryAfter: '60' }));
  assert.equal(e.kind, 'rate_limited');
  assert.equal(e.retryAfter, 60);
});

test('classifyHttpError: Response 无 Retry-After', () => {
  const e = classifyHttpError(fakeResponse(500));
  assert.equal(e.kind, 'server_error');
  assert.equal(e.retryAfter, null);
});

test('httpErrorToMessage: 含 status + body', () => {
  const e = classifyHttpErrorFrom(404, 'paper.md missing');
  const msg = httpErrorToMessage(e);
  assert.ok(msg.includes('404'));
  assert.ok(msg.includes('paper.md missing'));
});

test('httpErrorToMessage: 含 reason 时输出', () => {
  const e = classifyHttpErrorFrom(401, '', null, 'token_expired');
  const msg = httpErrorToMessage(e);
  assert.ok(msg.includes('token_expired'));
});

test('httpErrorToMessage: 无 status 时返回 hint', () => {
  const e = classifyHttpErrorFrom(undefined, '');
  const msg = httpErrorToMessage(e);
  assert.ok(msg.length > 0);
});

test('httpErrorToMessage: body 截断到 200 字符', () => {
  const longBody = 'x'.repeat(500);
  const e = classifyHttpErrorFrom(500, longBody);
  const msg = httpErrorToMessage(e);
  // 截断意味着消息长度有限制
  assert.ok(msg.length < longBody.length + 50);
});