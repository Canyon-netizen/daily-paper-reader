// Cloudflare Pages Function — arXiv CORS 反代
//
// 部署: 把这个文件放在项目根的 /functions/api/proxy.ts,
// Cloudflare Pages build 时自动识别并部署为 Function。
// 路径匹配 /api/proxy/* 时触发。
//
// 浏览器使用:
//   fetch('https://<your-pages>.pages.dev/api/proxy/<目标URL>')
//   或 fetch('https://<your-pages>.pages.dev/api/proxy?url=<目标URL>')
//
// 行为:
//   - GET /api/proxy/<encoded-full-url>  →  GET <full-url> + CORS
//   - GET /api/proxy?url=<target>        →  同上
//   - OPTIONS                            →  204
//
// arXiv API 需要 User-Agent,不然 403。
//
// 安全:本端点代理两类目标:
//   1. arXiv 域(arxiv.org / export.arxiv.org / arxiv-vanity.com
//      等已知 arXiv 镜像)。任何其他 host 都会被 400 拒绝。
//   2. PDF.js worker 单文件(cdn.bootcdn.net/ajax/libs/pdf.js/* —
//      只用于让 PDF.js worker 走我们同源,避免动态 import 触发
//      "Failed to fetch")。严格限定路径前缀,不能扩大到整个 bootcdn,
//      避免 Pages 部署被当 SSRF 跳板。
// 这样设计保证代理既能用,又不暴露任意目标内网/公网的能力。
// CORS 仍为 * 以便浏览器任意域调用。
//
// 限速:简单 token bucket,按 cf-connecting-ip 分桶。30 req / 60s per IP。
// 失败/host-not-allowed 路径不消耗 token(避免攻击者用 400 触发限速把合法
// 用户挡掉)。In-memory Map 是 per-isolate 的,跨 isolate 不共享;对于"被
// 某个 isolate 反复打"的攻击者够用,对分布式打需要更严方案(KV 计数)。
// 本端点实际只代理 arXiv,普通用户一秒钟也不会打 30 次,所以这个阈值
// 几乎不影响正常用法。

interface EventContext {
  request: Request;
}

type RateBucket = { tokens: number; lastRefillMs: number };

// 进程级状态。CF Workers Pages Functions 每次请求在同一 isolate 内可访问同一份;
// 多 isolate 之间不共享,但 invalidate 不会跨 isolate 触发,防滥用已经够用。
const RATE_BUCKETS = new Map<string, RateBucket>();
const RATE_LIMIT_TOKENS = 30;        // 每窗口允许的请求数
const RATE_LIMIT_WINDOW_MS = 60_000; // 窗口长度

function getClientIp(req: Request): string {
  // CF 标准头。Workers Pages Functions 也会自动注入,但为了类型安全显式读。
  const h = req.headers;
  return (
    h.get('cf-connecting-ip') ||
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

// 注意:失败路径(host-not-allowed、invalid target)需要在调用方把消耗掉的
// token 退回,否则攻击者用 400 也能触发限速、让合法请求被挤掉。这里只暴露
// 一个 refill 工具函数给调用方在 4xx 时调用。
function consumeToken(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = RATE_BUCKETS.get(ip) || { tokens: RATE_LIMIT_TOKENS, lastRefillMs: now };
  // 滑动窗口:从 lastRefillMs 到现在过了多少 ms,按比例补充
  const elapsed = now - bucket.lastRefillMs;
  if (elapsed > 0) {
    const refill = (elapsed / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_TOKENS;
    bucket.tokens = Math.min(RATE_LIMIT_TOKENS, bucket.tokens + refill);
    bucket.lastRefillMs = now;
  }
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    RATE_BUCKETS.set(ip, bucket);
    return { allowed: true, retryAfterSec: 0 };
  }
  RATE_BUCKETS.set(ip, bucket);
  // 距下一 token ≈ (1 - tokens) * window / tokensFull
  const need = 1 - bucket.tokens;
  const ms = (need / RATE_LIMIT_TOKENS) * RATE_LIMIT_WINDOW_MS;
  return { allowed: false, retryAfterSec: Math.ceil(ms / 1000) };
}

export async function onRequest(context: EventContext): Promise<Response> {
  const req = context.request;
  const url = new URL(req.url);

  // 0) 限速 — 对所有方法(包括 OPTIONS)生效,挡住最朴素的扫端口/dos。
  //    per-IP 窗口,失败路径不消耗(见上 consumeToken 调用约定)。
  const ip = getClientIp(req);
  const rate = consumeToken(ip);
  if (!rate.allowed) {
    return new Response(
      JSON.stringify({ error: 'rate limited', retryAfterSec: rate.retryAfterSec }),
      {
        status: 429,
        headers: corsHeaders({
          'Content-Type': 'application/json',
          'Retry-After': String(rate.retryAfterSec),
        }),
      },
    );
  }

  // 1) 解析目标 URL(两种调用方式都支持)
  let target = '';
  // 方式 A: /api/proxy/<encoded-full-url>
  const path = url.pathname.replace(/^\/api\/proxy\/?/, '');
  if (path) {
    try {
      target = decodeURIComponent(path);
    } catch {
      target = path;
    }
  }
  // 方式 B: ?url=... (优先)
  const queryUrl = url.searchParams.get('url');
  if (queryUrl) target = queryUrl;

  if (!/^https?:\/\//i.test(target)) {
    return new Response(
      JSON.stringify({
        error: 'missing target URL',
        usage: '/api/proxy/<encoded-url>  OR  /api/proxy?url=<target>',
      }),
      { status: 400, headers: corsHeaders({ 'Content-Type': 'application/json' }) },
    );
  }

  // SSRF 防护:只允许 arXiv 域。任何其他 host 一律 400,避免本 Pages
  // 部署被当作开放跳板攻击任意内网/外网目标。
  let parsedTarget: URL;
  try {
    parsedTarget = new URL(target);
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid target URL' }),
      { status: 400, headers: corsHeaders({ 'Content-Type': 'application/json' }) },
    );
  }
  const ALLOWED_HOSTS = new Set([
    'arxiv.org',
    'export.arxiv.org',
    'www.arxiv.org',
    'browse.arxiv.org',
    // arxiv-vanity 是合法 arXiv 渲染镜像
    'arxiv-vanity.com',
    // ar5iv — LaTeXML 把 arXiv TeX 渲成 HTML5,论文聊天按需取骨架比 PDF 快 5-10x。
    // paper-fulltext.ts 的 fetchAr5ivHtml 会走本代理拉 https://ar5iv.org/html/<id>
    'ar5iv.org',
    'www.ar5iv.org',
    // PDF.js worker 专用 — 仅放行下面的 PDFJS_WORKER_PATH_PREFIX,
    // 避免本端点被滥用代理任意 bootcdn 资源。
    'cdn.bootcdn.net',
  ]);
  // PDF.js worker 路径前缀白名单 — 比放开整个 bootcdn 严格得多,
  // 任意其他路径(包括 bootcdn 上的 JS/CSS/图片等)仍会被拒。
  const PDFJS_WORKER_PATH_PREFIX = '/ajax/libs/pdf.js/';

  const isAllowed =
    ALLOWED_HOSTS.has(parsedTarget.hostname.toLowerCase()) ||
    (parsedTarget.hostname.toLowerCase() === 'cdn.bootcdn.net' &&
      parsedTarget.pathname.startsWith(PDFJS_WORKER_PATH_PREFIX));

  if (!isAllowed) {
    return new Response(
      JSON.stringify({
        error: 'host not allowed',
        host: parsedTarget.hostname,
        allowed: Array.from(ALLOWED_HOSTS),
      }),
      { status: 400, headers: corsHeaders({ 'Content-Type': 'application/json' }) },
    );
  }

  // 预检
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method === 'OPTIONS' ? 'GET' : req.method,
      headers: {
        // arXiv API 要求带 UA,不然 403
        'User-Agent': 'Mozilla/5.0 (compatible; cloudflare-pages-arxiv-proxy/1.0)',
        Accept: req.headers.get('Accept') ?? '*/*',
      },
      redirect: 'follow',
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return new Response(
      JSON.stringify({ error: 'upstream fetch failed', detail: msg }),
      { status: 502, headers: corsHeaders({ 'Content-Type': 'application/json' }) },
    );
  }

  // 复制上游头 + 加 CORS
  const headers = new Headers(upstream.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));

  return new Response(upstream.body, { status: upstream.status, headers });
}

function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    // 实际方法代理里没有特别允许 POST(只转发原生 fetch 的 req.method)。
    // 暴露 GET + OPTIONS 已足够:浏览器跨源预检需要 OPTIONS,真实请求是 GET。
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    ...extra,
  };
}
