#!/usr/bin/env node
// astro-src/scripts/errors.test.mjs
//
// Tests for R7 polish: astro-src/lib/errors.ts.
// parseRetryAfter + classifyHttpError + classifyHttpErrorFrom + httpErrorToMessage.

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
    platform: 'neutral',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/errors.ts');
const {
  parseRetryAfter,
  classifyHttpError,
  classifyHttpErrorFrom,
  httpErrorToMessage,
} = mod;

// mock Response (Node 18+ has fetch + Response but headers.get may differ)
function mkRes(status, retryAfter = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) => name.toLowerCase() === 'retry-after' ? retryAfter : null,
    },
  };
}

// ---------- parseRetryAfter ----------
test('parseRetryAfter: null → null', () => {
  assert.equal(parseRetryAfter(null), null);
});

test('parseRetryAfter: undefined → null', () => {
  assert.equal(parseRetryAfter(undefined), null);
});

test('parseRetryAfter: 空字符串 → null', () => {
  assert.equal(parseRetryAfter(''), null);
});

test('parseRetryAfter: 整数 → 整数', () => {
  assert.equal(parseRetryAfter('120'), 120);
});

test('parseRetryAfter: 0 → null (>0 校验)', () => {
  assert.equal(parseRetryAfter('0'), null);
});

test('parseRetryAfter: 负数 → null', () => {
  assert.equal(parseRetryAfter('-10'), null);
});

test('parseRetryAfter: 非数字 → null', () => {
  assert.equal(parseRetryAfter('foo'), null);
});

test('parseRetryAfter: HTTP-date 格式 → null (不解析)', () => {
  // 源仅支持整数秒
  assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT'), null);
});

// ---------- classifyHttpError ----------
test('classifyHttpError: 401 → unauthorized', () => {
  const r = classifyHttpError(mkRes(401));
  assert.equal(r.kind, 'unauthorized');
  assert.equal(r.status, 401);
});

test('classifyHttpError: 403 → forbidden', () => {
  const r = classifyHttpError(mkRes(403));
  assert.equal(r.kind, 'forbidden');
});

test('classifyHttpError: 404 → not_found', () => {
  const r = classifyHttpError(mkRes(404));
  assert.equal(r.kind, 'not_found');
});

test('classifyHttpError: 422 → unprocessable', () => {
  const r = classifyHttpError(mkRes(422));
  assert.equal(r.kind, 'unprocessable');
});

test('classifyHttpError: 429 → rate_limited', () => {
  const r = classifyHttpError(mkRes(429));
  assert.equal(r.kind, 'rate_limited');
});

test('classifyHttpError: 500 → server_error', () => {
  const r = classifyHttpError(mkRes(500));
  assert.equal(r.kind, 'server_error');
});

test('classifyHttpError: 502 → server_error', () => {
  const r = classifyHttpError(mkRes(502));
  assert.equal(r.kind, 'server_error');
});

test('classifyHttpError: 599 → server_error', () => {
  const r = classifyHttpError(mkRes(599));
  assert.equal(r.kind, 'server_error');
});

test('classifyHttpError: 400 → client_error', () => {
  const r = classifyHttpError(mkRes(400));
  assert.equal(r.kind, 'client_error');
});

test('classifyHttpError: 418 → client_error', () => {
  const r = classifyHttpError(mkRes(418));
  assert.equal(r.kind, 'client_error');
});

test('classifyHttpError: 200 → unknown (非错误)', () => {
  const r = classifyHttpError(mkRes(200));
  assert.equal(r.kind, 'unknown');
});

test('classifyHttpError: 600 → unknown (超出 5xx 范围)', () => {
  // 600 >= 600 → false; status >= 400 → false → unknown
  const r = classifyHttpError(mkRes(600));
  assert.equal(r.kind, 'unknown');
});

test('classifyHttpError: retryAfter header 透传', () => {
  const r = classifyHttpError(mkRes(429, '60'));
  assert.equal(r.retryAfter, 60);
});

test('classifyHttpError: 无 Retry-After → null', () => {
  const r = classifyHttpError(mkRes(429));
  assert.equal(r.retryAfter, null);
});

test('classifyHttpError: reason → message', () => {
  const r = classifyHttpError(mkRes(401), 'token 过期');
  assert.equal(r.reason, 'token 过期');
  assert.equal(r.message, 'token 过期');
});

test('classifyHttpError: 无 reason → 默认 message', () => {
  const r = classifyHttpError(mkRes(401));
  assert.match(r.message, /认证失败/);
});

// ---------- classifyHttpErrorFrom ----------
test('classifyHttpErrorFrom: 401 → unauthorized', () => {
  const r = classifyHttpErrorFrom(401, 'body', null, 'no token');
  assert.equal(r.kind, 'unauthorized');
  assert.equal(r.body, 'body');
  assert.equal(r.reason, 'no token');
  assert.equal(r.retryAfter, null);
});

test('classifyHttpErrorFrom: 403 forbidden', () => {
  assert.equal(classifyHttpErrorFrom(403).kind, 'forbidden');
});

test('classifyHttpErrorFrom: 404 not_found', () => {
  assert.equal(classifyHttpErrorFrom(404).kind, 'not_found');
});

test('classifyHttpErrorFrom: 422 unprocessable', () => {
  assert.equal(classifyHttpErrorFrom(422).kind, 'unprocessable');
});

test('classifyHttpErrorFrom: 429 rate_limited', () => {
  assert.equal(classifyHttpErrorFrom(429).kind, 'rate_limited');
});

test('classifyHttpErrorFrom: 500 server_error', () => {
  assert.equal(classifyHttpErrorFrom(500).kind, 'server_error');
});

test('classifyHttpErrorFrom: 400 client_error', () => {
  assert.equal(classifyHttpErrorFrom(400).kind, 'client_error');
});

test('classifyHttpErrorFrom: 200 unknown', () => {
  assert.equal(classifyHttpErrorFrom(200).kind, 'unknown');
});

test('classifyHttpErrorFrom: retryAfter 整数解析', () => {
  const r = classifyHttpErrorFrom(429, 'body', '120');
  assert.equal(r.retryAfter, 120);
});

test('classifyHttpErrorFrom: retryAfter undefined → null', () => {
  assert.equal(classifyHttpErrorFrom(429).retryAfter, null);
});

test('classifyHttpErrorFrom: retryAfter "0" → null', () => {
  assert.equal(classifyHttpErrorFrom(429, '', '0').retryAfter, null);
});

test('classifyHttpErrorFrom: body 透传', () => {
  const r = classifyHttpErrorFrom(404, '{"msg":"not found"}');
  assert.equal(r.body, '{"msg":"not found"}');
});

test('classifyHttpErrorFrom: 无 body → undefined', () => {
  assert.equal(classifyHttpErrorFrom(404).body, undefined);
});

test('classifyHttpErrorFrom: reason 透传', () => {
  assert.equal(classifyHttpErrorFrom(401, '', null, 'expired').reason, 'expired');
});

// ---------- httpErrorToMessage ----------
test('httpErrorToMessage: 含 status + body', () => {
  const c = classifyHttpErrorFrom(404, 'not here');
  const m = httpErrorToMessage(c);
  assert.match(m, /HTTP 404/);
  assert.match(m, /not here/);
});

test('httpErrorToMessage: 含 reason', () => {
  const c = classifyHttpErrorFrom(401, '', null, 'token expired');
  const m = httpErrorToMessage(c);
  assert.match(m, /HTTP 401/);
  assert.match(m, /token expired/);
});

test('httpErrorToMessage: 含 reason + body', () => {
  const c = classifyHttpErrorFrom(500, 'oops', null, 'server down');
  const m = httpErrorToMessage(c);
  assert.match(m, /HTTP 500/);
  assert.match(m, /server down/);
  assert.match(m, /oops/);
});

test('httpErrorToMessage: body > 200 字符截断', () => {
  const big = 'x'.repeat(300);
  const c = classifyHttpErrorFrom(404, big);
  const m = httpErrorToMessage(c);
  // 截断到 200
  assert.ok(m.includes('x'.repeat(200)));
  assert.ok(!m.includes('x'.repeat(201)));
});

test('httpErrorToMessage: 无 status → 走 message 兜底', () => {
  // network kind 不带 status
  const c = {
    kind: 'network',
    retryAfter: null,
    message: '网络失败',
  };
  const m = httpErrorToMessage(c);
  assert.equal(m, '网络失败');
});

test('httpErrorToMessage: 仅 status 无 reason 无 body', () => {
  const c = classifyHttpErrorFrom(500);
  const m = httpErrorToMessage(c);
  assert.equal(m, 'HTTP 500');
});