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
// 安全:本端点只代理 arXiv 域(arxiv.org / export.arxiv.org / arxiv-vanity.com
// 等已知 arXiv 镜像)。任何其他 host 都会被 400 拒绝。这样可以避免 Pages
// 部署被当作开放 SSRF 跳板——任何 LAN / 公网 / 攻击者都不能借我们访问
// 任意目标。CORS 仍为 * 以便浏览器任意域调用。

interface EventContext {
  request: Request;
}

export async function onRequest(context: EventContext): Promise<Response> {
  const req = context.request;
  const url = new URL(req.url);

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
  ]);
  if (!ALLOWED_HOSTS.has(parsedTarget.hostname.toLowerCase())) {
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    ...extra,
  };
}
