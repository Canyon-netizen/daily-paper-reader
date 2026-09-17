#!/usr/bin/env node
// astro-src/scripts/errors.test.mjs
//
// Tests for R7 polish: astro-src/lib/errors.ts.
// classifyHttpError (Response → ClassifiedHttpError) +
// classifyHttpErrorFrom (status + body → ClassifiedHttpError) +
// parseRetryAfter (int 秒数 → number | null) +
// httpErrorToMessage (ClassifiedHttpError → string)。

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
  classifyHttpError,
  classifyHttpErrorFrom,
  parseRetryAfter,
  httpErrorToMessage,
} = mod;

// ---------- parseRetryAfter ---
test('parseRetry: 数字字符串 → 数字', () => {
  assert.equal(parseRetryAfter('120'), 120);
});

test('parseRetry: "0" → null(必须 > 0)', () => {
  assert.equal(parseRetryAfter('0'), null);
});

test('parseRetry: 负数 → null', () => {
  assert.equal(parseRetryAfter('-1'), null);
});

test('parseRetry: 非数字 → null', () => {
  assert.equal(parseRetryAfter('abc'), null);
});

test('parseRetry: HTTP-date → null(不解析)', () => {
  assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT'), null);
});

test('parseRetry: null → null', () => {
  assert.equal(parseRetryAfter(null), null);
});

test('parseRetry: undefined → null', () => {
  assert.equal(parseRetryAfter(undefined), null);
});

test('parseRetry: 空字符串 → null', () => {
  assert.equal(parseRetryAfter(''), null);
});

test('parseRetry: "60.5" → 60(取整)', () => {
  assert.equal(parseRetryAfter('60.5'), 60);
});

test('parseRetry: "60abc" → 60(前缀数字)', () => {
  assert.equal(parseRetryAfter('60abc'), 60);
});

// ---------- classifyHttpError (Response) ---
const mkResponse = (status, opts = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get: (name) => {
      if (name === 'Retry-After') return opts.retryAfter ?? null;
      return null;
    },
  },
});

test('classify: 401 → unauthorized', () => {
  const r = classifyHttpError(mkResponse(401));
  assert.equal(r.kind, 'unauthorized');
  assert.equal(r.status, 401);
});

test('classify: 403 → forbidden', () => {
  const r = classifyHttpError(mkResponse(403));
  assert.equal(r.kind, 'forbidden');
});

test('classify: 404 → not_found', () => {
  const r = classifyHttpError(mkResponse(404));
  assert.equal(r.kind, 'not_found');
});

test('classify: 422 → unprocessable', () => {
  const r = classifyHttpError(mkResponse(422));
  assert.equal(r.kind, 'unprocessable');
});

test('classify: 429 → rate_limited', () => {
  const r = classifyHttpError(mkResponse(429));
  assert.equal(r.kind, 'rate_limited');
});

test('classify: 500 → server_error', () => {
  const r = classifyHttpError(mkResponse(500));
  assert.equal(r.kind, 'server_error');
});

test('classify: 503 → server_error', () => {
  const r = classifyHttpError(mkResponse(503));
  assert.equal(r.kind, 'server_error');
});

test('classify: 599 → server_error', () => {
  const r = classifyHttpError(mkResponse(599));
  assert.equal(r.kind, 'server_error');
});

test('classify: 400 → client_error(其他 4xx)', () => {
  const r = classifyHttpError(mkResponse(400));
  assert.equal(r.kind, 'client_error');
});

test('classify: 405 → client_error', () => {
  const r = classifyHttpError(mkResponse(405));
  assert.equal(r.kind, 'client_error');
});

test('classify: 499 → client_error', () => {
  const r = classifyHttpError(mkResponse(499));
  assert.equal(r.kind, 'client_error');
});

test('classify: 600 → unknown', () => {
  const r = classifyHttpError(mkResponse(600));
  assert.equal(r.kind, 'unknown');
});

test('classify: 200 → unknown(没分类)', () => {
  const r = classifyHttpError(mkResponse(200));
  assert.equal(r.kind, 'unknown');
});

test('classify: reason 传入', () => {
  const r = classifyHttpError(mkResponse(404), 'paper not in library');
  assert.equal(r.reason, 'paper not in library');
});

test('classify: reason 优先于 defaultHint', () => {
  const r = classifyHttpError(mkResponse(404), 'custom reason');
  assert.equal(r.message, 'custom reason');
});

test('classify: 无 reason → message = defaultHint', () => {
  const r = classifyHttpError(mkResponse(401));
  assert.match(r.message, /认证/);
});

test('classify: retryAfter 透传', () => {
  const r = classifyHttpError(mkResponse(429, { retryAfter: '120' }));
  assert.equal(r.retryAfter, 120);
});

test('classify: 缺 retryAfter → null', () => {
  const r = classifyHttpError(mkResponse(429));
  assert.equal(r.retryAfter, null);
});

// ---------- classifyHttpErrorFrom ---
test('from: 401 → unauthorized', () => {
  const r = classifyHttpErrorFrom(401);
  assert.equal(r.kind, 'unauthorized');
  assert.equal(r.status, 401);
});

test('from: 403 → forbidden', () => {
  const r = classifyHttpErrorFrom(403);
  assert.equal(r.kind, 'forbidden');
});

test('from: 404 → not_found', () => {
  const r = classifyHttpErrorFrom(404);
  assert.equal(r.kind, 'not_found');
});

test('from: 422 → unprocessable', () => {
  const r = classifyHttpErrorFrom(422);
  assert.equal(r.kind, 'unprocessable');
});

test('from: 429 → rate_limited', () => {
  const r = classifyHttpErrorFrom(429);
  assert.equal(r.kind, 'rate_limited');
});

test('from: 500 → server_error', () => {
  const r = classifyHttpErrorFrom(500);
  assert.equal(r.kind, 'server_error');
});

test('from: 502 → server_error', () => {
  const r = classifyHttpErrorFrom(502);
  assert.equal(r.kind, 'server_error');
});

test('from: 400 → client_error', () => {
  const r = classifyHttpErrorFrom(400);
  assert.equal(r.kind, 'client_error');
});

test('from: 410 → client_error', () => {
  const r = classifyHttpErrorFrom(410);
  assert.equal(r.kind, 'client_error');
});

test('from: 600 → unknown', () => {
  const r = classifyHttpErrorFrom(600);
  assert.equal(r.kind, 'unknown');
});

test('from: 200 → unknown', () => {
  const r = classifyHttpErrorFrom(200);
  assert.equal(r.kind, 'unknown');
});

test('from: body 透传', () => {
  const r = classifyHttpErrorFrom(404, 'page not found body');
  assert.equal(r.body, 'page not found body');
});

test('from: retryAfter 解析', () => {
  const r = classifyHttpErrorFrom(429, '', '60');
  assert.equal(r.retryAfter, 60);
});

test('from: retryAfter=null', () => {
  const r = classifyHttpErrorFrom(429, '', null);
  assert.equal(r.retryAfter, null);
});

test('from: retryAfter=undefined', () => {
  const r = classifyHttpErrorFrom(429, '', undefined);
  assert.equal(r.retryAfter, null);
});

test('from: reason 优先 defaultHint', () => {
  const r = classifyHttpErrorFrom(404, '', null, 'my reason');
  assert.equal(r.message, 'my reason');
});

test('from: 无 reason → defaultHint', () => {
  const r = classifyHttpErrorFrom(401, '', null);
  assert.match(r.message, /认证/);
});

// ---------- httpErrorToMessage ---
test('toMessage: 401 + 无 reason → "HTTP 401"', () => {
  const c = classifyHttpErrorFrom(401);
  const m = httpErrorToMessage(c);
  assert.equal(m, 'HTTP 401');
});

test('toMessage: 401 + reason', () => {
  const c = classifyHttpErrorFrom(401, '', null, 'token expired');
  const m = httpErrorToMessage(c);
  assert.match(m, /HTTP 401/);
  assert.match(m, /token expired/);
});

test('toMessage: body 截断到 200 字', () => {
  const long = 'x'.repeat(500);
  const c = classifyHttpErrorFrom(404, long);
  const m = httpErrorToMessage(c);
  // body slice(0, 200) → 200 个 x
  assert.ok(m.includes('x'.repeat(200)));
  assert.ok(!m.includes('x'.repeat(500)));
});

test('toMessage: body 短于 200 完整保留', () => {
  const c = classifyHttpErrorFrom(404, 'short body');
  const m = httpErrorToMessage(c);
  assert.match(m, /short body/);
});

test('toMessage: 无 status → fallback message', () => {
  const c = {
    kind: 'network',
    retryAfter: null,
    message: '网络失败,检查代理/CORS',
  };
  const m = httpErrorToMessage(c);
  assert.equal(m, '网络失败,检查代理/CORS');
});

test('toMessage: reason + body', () => {
  const c = classifyHttpErrorFrom(422, 'invalid input', null, '参数错误');
  const m = httpErrorToMessage(c);
  assert.match(m, /HTTP 422/);
  assert.match(m, /参数错误/);
  assert.match(m, /invalid input/);
});

test('toMessage: 无 reason 无 body → 仅 "HTTP NNN"', () => {
  const c = classifyHttpErrorFrom(500, '');
  const m = httpErrorToMessage(c);
  assert.equal(m, 'HTTP 500');
});

// ---------- 集成 ---
test('集成: classify → toMessage', () => {
  const c = classifyHttpErrorFrom(503, '服务维护中', '30', '稍后重试');
  const m = httpErrorToMessage(c);
  assert.match(m, /HTTP 503/);
  assert.match(m, /稍后重试/);
  assert.match(m, /服务维护中/);
  assert.equal(c.retryAfter, 30);
  assert.equal(c.kind, 'server_error');
});

test('集成: retryAfter 解析 + 透传', () => {
  const c = classifyHttpErrorFrom(429, 'rate limited body', '120');
  assert.equal(c.retryAfter, 120);
  assert.equal(c.kind, 'rate_limited');
  assert.equal(c.body, 'rate limited body');
});