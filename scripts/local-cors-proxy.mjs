// Local CORS proxy for paper-analyzer dev usage.
// Usage: GET http://localhost:8123/?url=<encoded target URL>
// All targets go through Node's native fetch, so this works for arXiv (XML),
// arxiv.org/pdf/* (PDF), and any other fetch the analyzer needs.

import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PROXY_PORT || 8123);
// 默认只绑 loopback,需要 LAN 调试(手机/容器)时显式 PROXY_HOST=0.0.0.0。
// ALLOW 白名单仍生效,所以不是开放代理,只是避免无意中暴露给 LAN。
const HOST = process.env.PROXY_HOST || '127.0.0.1';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const target = url.searchParams.get('url');
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Missing ?url=<encoded target URL>\n');
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Invalid url: ${target}\n`);
    return;
  }

  // Allowlist so a misbehaving page can't use this as an open relay.
  const ALLOW = [
    'arxiv.org',
    'export.arxiv.org',
    // PDF.js worker / module CDN
    'cdn.bootcdn.net',
    'cdn.jsdelivr.net',
    'unpkg.com',
  ];
  if (!ALLOW.includes(parsed.hostname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Host not allowed: ${parsed.hostname}\n`);
    return;
  }

  console.log(`[proxy] -> ${target}`);
  try {
    const upstream = await fetch(target, {
      redirect: 'follow',
      headers: { 'User-Agent': 'dpr-local-proxy/1.0' },
    });
    console.log(`[proxy] <- ${upstream.status} ${upstream.statusText} from ${target}`);

    // Forward status + content-type so callers can inspect response codes.
    const headers = { ...upstream.headers };
    delete headers['content-encoding']; // we forward raw bytes, no double-encoding
    delete headers['access-control-allow-origin'];

    // 强制按 URL 后缀设 MIME,避免 bootcdn/jsdelivr 在某些路径下返回 text/html
    // 导致浏览器拒绝作为 module script 执行("Strict MIME type checking")
    const path = parsed.pathname.toLowerCase();
    if (path.endsWith('.mjs')) headers['content-type'] = 'application/javascript; charset=utf-8';
    else if (path.endsWith('.js'))  headers['content-type'] = 'application/javascript; charset=utf-8';
    else if (path.endsWith('.json')) headers['content-type'] = 'application/json; charset=utf-8';
    else if (path.endsWith('.wasm')) headers['content-type'] = 'application/wasm';
    else if (path.endsWith('.css'))  headers['content-type'] = 'text/css; charset=utf-8';

    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

    res.writeHead(upstream.status);

    if (!upstream.body) {
      res.end();
      return;
    }

    // Stream the body so big PDFs don't blow up memory.
    const reader = upstream.body.getReader();
    const pump = async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        if (!res.write(value)) {
          await new Promise((r) => res.once('drain', r));
        }
      }
    };
    pump().catch((err) => {
      console.error('[proxy] stream error:', err);
      try { res.destroy(err); } catch {}
    });
  } catch (err) {
    console.error('[proxy] fetch error:', err);
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Upstream fetch failed: ${err?.message || err}\n`);
  }
});

server.on('error', (err) => {
  console.error('[proxy] server error:', err);
});

server.on('clientError', (err, socket) => {
  console.error('[proxy] client error:', err.message);
  try { socket.destroy(); } catch {}
});

server.listen(PORT, HOST, () => {
  console.log(`[proxy] listening on http://${HOST}:${PORT}`);
});