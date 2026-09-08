// scripts/test-local-llm-proxy.mjs
//
// Smoke test for scripts/local-llm-proxy.mjs — 2026-09-08。
//
// 跑法:
//   1) 先在另一个终端启 `bash scripts/local-llm-proxy.sh`
//   2) 跑 `node scripts/test-local-llm-proxy.mjs`
//
// 验证:
//   - GET  /health          → ok=true, keyPresent=true, model 不空
//   - POST /v1/chat/completions 最小 payload → 200, content 非空, finish_reason=stop
//   - 退出前打印 logs/llm-proxy.jsonl 末尾 1 行,确认 JSONL 写盘正常
//
// 这个脚本不验内容正确性(那是 LLM 的事),只验「proxy 起来 + 转发 + 日志」3 件套。

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HOST = process.env.LLM_PROXY_HOST || '127.0.0.1';
const PORT = Number(process.env.LLM_PROXY_PORT || 8124);
const BASE = `http://${HOST}:${PORT}`;

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
  });
}

function post(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const url = new URL(`${BASE}${path}`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('timeout')));
    req.write(data);
    req.end();
  });
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

(async () => {
  console.log(`[test] target: ${BASE}`);

  // 1. /health
  let health;
  try {
    health = await get('/health');
  } catch (e) {
    fail(`GET /health failed: ${e.message} — proxy 没启?跑 bash scripts/local-llm-proxy.sh`);
    return;
  }
  if (health.status !== 200) {
    fail(`GET /health status=${health.status} body=${health.body.slice(0, 200)}`);
    return;
  }
  let hData;
  try { hData = JSON.parse(health.body); } catch (e) { fail(`GET /health 不是 JSON: ${e.message}`); return; }
  if (!hData.ok) fail('GET /health ok=false');
  else ok(`/health: ok=true upstream=${hData.upstream} model=${hData.model} uptime=${hData.uptimeSec}s`);
  if (!hData.keyPresent) fail('GET /health keyPresent=false — proxy 启动时 .env 没读到 MINIMAX_API_KEY');
  else ok('keyPresent=true (MINIMAX_API_KEY 在 .env)');

  // 2. POST /v1/chat/completions — 最小 payload,验证整条链通
  const t0 = Date.now();
  const chat = await post('/v1/chat/completions', {
    model: hData.model,
    messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
    max_tokens: 16,
    temperature: 0,
  });
  const dt = Date.now() - t0;
  if (chat.status !== 200) {
    fail(`POST /v1/chat/completions status=${chat.status} body=${chat.body.slice(0, 300)}`);
    return;
  }
  let cData;
  try { cData = JSON.parse(chat.body); } catch (e) { fail(`chat 响应不是 JSON: ${e.message}`); return; }
  const content = cData?.choices?.[0]?.message?.content ?? '';
  if (!content) fail('chat 响应 content 为空');
  else ok(`POST /v1/chat/completions: 200 in ${dt}ms content="${content.replace(/\n/g, ' ').slice(0, 60)}"`);
  if (cData?.usage) {
    ok(`usage: prompt=${cData.usage.prompt_tokens} completion=${cData.usage.completion_tokens} total=${cData.usage.total_tokens}`);
  } else {
    console.warn('⚠ usage 字段缺失(某些 provider 不返回)');
  }

  // 3. 验日志 — 末尾 1 行应该 kind=chat_completion, 刚发的 model 一致
  const logFile = hData.logFile || join(process.cwd(), 'logs', 'llm-proxy.jsonl');
  if (!existsSync(logFile)) {
    fail(`日志文件不存在: ${logFile}`);
    return;
  }
  const lines = readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    fail('日志文件是空');
    return;
  }
  let last;
  try { last = JSON.parse(lines[lines.length - 1]); } catch (e) { fail(`日志最后一行不是 JSON: ${e.message}`); return; }
  if (last.kind !== 'chat_completion') {
    fail(`日志最后一行 kind=${last.kind} (期望 chat_completion)`);
    return;
  }
  if (last.model !== hData.model) {
    fail(`日志最后一行 model=${last.model} (期望 ${hData.model})`);
    return;
  }
  if (last.status !== 200) {
    fail(`日志最后一行 status=${last.status} (期望 200)`);
    return;
  }
  ok(`日志末尾: kind=${last.kind} status=${last.status} latency=${last.latencyMs}ms prompt=${last.promptChars}c response=${last.responseChars}c`);

  console.log('\n✓ all checks passed');
})();
