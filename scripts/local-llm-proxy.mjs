// scripts/local-llm-proxy.mjs
//
// Local LLM reverse proxy — sits between the browser and the upstream LLM provider.
//
// Why this exists (2026-09-08):
//   - 让浏览器把 LLM 请求发到 localhost,而不是直接把 API key 写到 Authorization
//     header 直连第三方 provider。Server-side 注入 key,client 永远不持有明文。
//   - 每个调用写到 JSONL 日志(timestamp / status / latency / model / chars / tokens),
//     排查「为啥这次 LLM 出错」「这个月 token 花了多少」不用接 provider 控制台。
//   - CORS-friendly: 浏览器 fetch 没 Origin 限制,本地部署也跑得通。
//
// Usage:
//   1) 启脚本: bash scripts/local-llm-proxy.sh    # 默认 127.0.0.1:8124
//   2) 客户端: localStorage `dpr_llm_proxy_v1` = "http://localhost:8124"
//      (BaseLayout 的 .env 注入会自动预填这一项,只要 .env 里有 DPR_LLM_PROXY_URL)
//   3) 浏览器发的 /v1/chat/completions 请求会被转发到 .env 里的 MINIMAX_BASE_URL
//
// .env 必填字段(只要缺一个就启动报错):
//   MINIMAX_API_KEY    上游 API key(server-side 注入,browser 永远看不到)
//   MINIMAX_BASE_URL   上游 OpenAI 兼容 base,默认 https://api.minimaxi.com/v1
//   LLM_MODEL          默认模型名,默认 MiniMax-M3
//
// 可选覆盖:
//   LLM_PROXY_PORT     端口,默认 8124
//   LLM_PROXY_HOST     监听地址,默认 127.0.0.1(loopback only,避免暴露给 LAN)
//   LLM_PROXY_LOG      日志文件路径,默认 logs/llm-proxy.jsonl

import http from 'node:http';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.LLM_PROXY_PORT || 8124);
// 默认 loopback only — 这是开发工具,不是公开代理。需要 LAN 调试时显式
// 设 LLM_PROXY_HOST=0.0.0.0。但即便如此,API key 还是绑死在 server,LAN 访问者
// 也只能拿 proxy,拿不到 key。
const HOST = process.env.LLM_PROXY_HOST || '127.0.0.1';
const LOG_FILE = process.env.LLM_PROXY_LOG || join(process.cwd(), 'logs', 'llm-proxy.jsonl');

function readDotEnv() {
  // 跟 BaseLayout.astro 保持同样的 .env 解析规则(key 大写化 / strip 引号),
  // 这样脚本和 Astro 模板看到的 env 是同一份。
  const env = {};
  try {
    const txt = readFileSync(join(process.cwd(), '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      env[m[1].toUpperCase()] = v;
    }
  } catch (err) {
    console.warn(`[llm-proxy] .env not found or unreadable: ${err.message}`);
  }
  return env;
}

const env = readDotEnv();
const UPSTREAM_KEY = env.MINIMAX_API_KEY || env.LLM_API_KEY || '';
const DEFAULT_MODEL = (env.LLM_MODEL || 'MiniMax-M3').replace(/^minimax\//, '');
// .env 经常写 `https://api.minimaxi.com/anthropic`(Anthropic Messages 端点,给 Python pipeline 用),
// 但 proxy 转发的是 OpenAI 兼容 /v1/chat/completions,所以**总是**用 /v1 后缀,
// 跟 BaseLayout.astro::readEnvLLMConfig 保持一致。基址 host 部分尊重 .env 配置。
let UPSTREAM_BASE;
if (env.MINIMAX_BASE_URL) {
  try {
    const u = new URL(env.MINIMAX_BASE_URL);
    UPSTREAM_BASE = `${u.protocol}//${u.host}/v1`;
  } catch {
    UPSTREAM_BASE = 'https://api.minimaxi.com/v1';
  }
} else {
  UPSTREAM_BASE = 'https://api.minimaxi.com/v1';
}
UPSTREAM_BASE = UPSTREAM_BASE.replace(/\/+$/, '');

if (!UPSTREAM_KEY) {
  console.error('[llm-proxy] FATAL: MINIMAX_API_KEY (or LLM_API_KEY) not set in .env — refusing to start.');
  console.error('           Without a server-side key, the proxy would forward unsigned requests that upstream rejects.');
  process.exit(1);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function readBody(req, limitBytes = 10 * 1024 * 1024) {
  // 10 MB 上限 — chat/completions body 一般 < 100 KB,但 deep extract 可能塞整篇 PDF 文本,
  // 设大一点避免截断。Cloudflare-fronted provider 自己有 WAF body size 限制,这里不卡死。
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error(`Request body exceeded ${limitBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function logLine(obj) {
  try {
    // 启动时再 ensure logs/ 存在,避免日志写到不存在的目录导致首次调用 500
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify(obj) + '\n');
  } catch (err) {
    // 日志写不进不能影响业务 — 至少在 stderr 留个痕迹
    console.error('[llm-proxy] log write failed:', err.message);
  }
}

async function handleChatCompletions(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    logLine({ ts: new Date().toISOString(), kind: 'body_read_error', error: err.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: err.message, type: 'invalid_request_error' } }));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (err) {
    logLine({ ts: new Date().toISOString(), kind: 'json_parse_error', error: err.message, bodyLen: body.length });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }));
    return;
  }

  // 强制覆盖 model — 客户端可以传任意 model 名,但 proxy 只信任 .env 里的。
  // 这样能防止「客户端填错 model 名 → proxy 拿着 server key 打了贵的模型」。
  // 想用别的模型就改 .env 重启。
  const model = payload.model || DEFAULT_MODEL;

  // 统计 prompt chars — 用于排查「这个调用为啥这么慢」。OpenAI usage 给的是
  // token 数,这里再补一个 char 数,tokenizer 不同也能横向比较。
  const promptChars = Array.isArray(payload.messages)
    ? payload.messages.reduce((s, m) => {
        const c = m?.content;
        if (typeof c === 'string') return s + c.length;
        // 多模态 content 是 array of parts
        if (Array.isArray(c)) return s + c.reduce((s2, p) => s2 + (typeof p?.text === 'string' ? p.text.length : 0), 0);
        return s;
      }, 0)
    : 0;

  const t0 = Date.now();
  let upstreamRes;
  let upstreamBody;
  try {
    upstreamRes = await fetch(`${UPSTREAM_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${UPSTREAM_KEY}`,
      },
      body: JSON.stringify({ ...payload, model }),
    });
    upstreamBody = await upstreamRes.text();
  } catch (err) {
    const latencyMs = Date.now() - t0;
    logLine({
      ts: new Date().toISOString(),
      kind: 'upstream_fetch_error',
      model,
      latencyMs,
      promptChars,
      status: 0,
      error: err.message,
    });
    console.error(`[llm-proxy] upstream fetch failed (${latencyMs}ms): ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Upstream fetch failed: ${err.message}`, type: 'upstream_error' } }));
    return;
  }

  const latencyMs = Date.now() - t0;
  const status = upstreamRes.status;
  const responseChars = upstreamBody.length;

  // 解析 usage — OpenAI 标准字段(prompt_tokens / completion_tokens / total_tokens)。
  // 解析失败也不阻塞转发 — usage 缺失就置 null。
  let usage = null;
  try {
    const parsed = JSON.parse(upstreamBody);
    usage = parsed.usage || null;
  } catch {
    // 非 JSON 响应(罕见,某些 provider 在 5xx 时返纯文本)就当 null
  }

  // 错误响应也写日志 — 排查「prompt 是不是太长被截了」「模型是不是越权」全靠这些
  const errorMessage = status >= 400 ? safeExtractErrorMessage(upstreamBody) : null;

  logLine({
    ts: new Date().toISOString(),
    kind: 'chat_completion',
    model,
    status,
    latencyMs,
    promptChars,
    responseChars,
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
    error: errorMessage,
    // 客户端传的 stage tag(如果有) — paper-analyzer 已经在传 libraryId,
    // 但 proxy 看不到 messages 之外的字段。留口子让 client 通过 X-LLM-Tag header 传。
    clientTag: req.headers['x-llm-tag'] || null,
  });

  // 控制台同步一行,grep 友好
  const consoleLine = `[llm-proxy] ${status} ${latencyMs}ms model=${model} p=${promptChars}c=${responseChars}` +
    (usage ? ` tokens=${usage.total_tokens ?? `${usage.prompt_tokens}+${usage.completion_tokens}`}` : '');
  if (status >= 400) console.error(consoleLine);
  else console.log(consoleLine);

  // 透传上游 content-type(通常 application/json),让客户端拿到的就是 OpenAI 标准格式
  const ct = upstreamRes.headers.get('content-type') || 'application/json';
  res.writeHead(status, { 'Content-Type': ct });
  res.end(upstreamBody);
}

function safeExtractErrorMessage(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || parsed?.message || body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 健康检查 — /settings/ 页面的「测试代理」按钮会打这里,确认 proxy 在跑、
  // .env key 没失效。
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      upstream: UPSTREAM_BASE,
      model: DEFAULT_MODEL,
      keyPresent: !!UPSTREAM_KEY,
      keyPreview: UPSTREAM_KEY ? `${UPSTREAM_KEY.slice(0, 4)}…${UPSTREAM_KEY.slice(-4)}` : null,
      logFile: LOG_FILE,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
    }));
    return;
  }

  // 唯一业务端点 — 透传到上游 /chat/completions
  if (req.url?.startsWith('/v1/chat/completions') && req.method === 'POST') {
    await handleChatCompletions(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Not Found — only POST /v1/chat/completions and GET /health are served' }));
});

server.on('error', (err) => {
  console.error('[llm-proxy] server error:', err.message);
});

server.on('clientError', (err, socket) => {
  console.error('[llm-proxy] client error:', err.message);
  try { socket.destroy(); } catch {}
});

server.listen(PORT, HOST, () => {
  console.log(`[llm-proxy] listening on http://${HOST}:${PORT}`);
  console.log(`[llm-proxy] upstream: ${UPSTREAM_BASE}`);
  console.log(`[llm-proxy] default model: ${DEFAULT_MODEL}`);
  console.log(`[llm-proxy] log file: ${LOG_FILE}`);
  console.log(`[llm-proxy] health: http://${HOST}:${PORT}/health`);
});

// 优雅关闭 — Ctrl-C 时把当前在飞的请求标记成「shutting down」便于日志区分
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[llm-proxy] received ${sig}, shutting down...`);
    logLine({ ts: new Date().toISOString(), kind: 'shutdown', uptimeSec: Math.round(process.uptime()) });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
