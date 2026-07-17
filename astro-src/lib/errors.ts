// /lib/errors.ts — 把不同 HTTP API(GitHub、arXiv、LLM provider 等)的"分类
// status code 到 错误种类"逻辑收到一处。三个 caller (conferences.ts × 2,
// paper-analyzer.ts × 3, topic-search.ts × 0-?) 之前各自硬编码 if/else 链
// 判断 401/403/404/422,文案也各自不同。
//
// 我们只抽**分类**这个动作,文案由 caller 根据分类 + 自己上下文拼。
// 这样不抽象过头:每条文案里的"check repo/workflow scope" / "maybe not
// OpenAI compatible" / "Token 过期"等具体提示留在 caller 里, 只有 "401 是
// auth / 403 是权限或限流 / 404 是没找到 / 422 是入参无效 / 其他" 这个映射
// 收编。

export type HttpErrorKind =
  | 'unauthorized' // 401
  | 'forbidden' // 403
  | 'not_found' // 404
  | 'unprocessable' // 422 (GitHub 入参校验失败)
  | 'rate_limited' // 429
  | 'server_error' // 5xx
  | 'client_error' // 其他 4xx (4xx not in 401/403/404/422/429)
  | 'network' // fetch 抛 TypeError 而非 res.ok=false
  | 'unknown'; // 兜底

export interface ClassifiedHttpError {
  kind: HttpErrorKind;
  status?: number;
  retryAfter?: number | null;
  /** 含 Retry-After header 时设值(秒)。GitHub 返回 int 或 HTTP-date,
   * parseRetryAfter 仅支持 int(已在 conferences.ts 实现),这里只透传,
   * 不重复实现。 */
  body?: string;
  reason?: string;
  message: string;
}

/** 解析 Retry-After。仅支持整数秒。`null` = 不存在 / 解析失败。
 *  与 conferences.ts:parseRetryAfter 完全一致,提到共享层避免将来又有
 *  caller 自己写一份。 */
export function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** 默认仅凭 status 给出 user-facing 的简短提示。各 caller 会按自己上下文
 *  重写。这只是兜底,主要让 caller 在四种 path 上行为一致。 */
function defaultHint(kind: HttpErrorKind): string {
  switch (kind) {
    case 'unauthorized':
      return '认证失败,检查 token / API key 是否有效';
    case 'forbidden':
      return '权限不足或被限流,检查 scope 或稍后重试';
    case 'not_found':
      return '请求的资源不存在,检查路径或 ID';
    case 'unprocessable':
      return '请求参数校验失败';
    case 'rate_limited':
      return '触发限流,稍后重试';
    case 'server_error':
      return '上游服务临时错误,稍后重试';
    case 'client_error':
      return '客户端请求错误';
    case 'network':
      return '网络失败,检查代理/CORS';
    case 'unknown':
    default:
      return '未知错误';
  }
}

/** 分类一个 fetch Response 或一个原始 status + body 字符串。
 *
 * 使用方式 1(完整 Response):
 *   const r = await fetch(...);
 *   if (!r.ok) throw classifyHttpError(r).message;
 *
 * 使用方式 2(已经被 caller 拆好的 status + body, 避免再读一次):
 *   classifyHttpErrorFrom(404, body, retryAfterHeader)
 */
export function classifyHttpError(
  res: Response,
  reason?: string,
): ClassifiedHttpError {
  const status = res.status;
  const kind: HttpErrorKind = (
    status === 401 ? 'unauthorized'
    : status === 403 ? 'forbidden'
    : status === 404 ? 'not_found'
    : status === 422 ? 'unprocessable'
    : status === 429 ? 'rate_limited'
    : status >= 500 && status < 600 ? 'server_error'
    : status >= 400 && status < 500 ? 'client_error'
    : 'unknown'
  );
  // Note: caller is expected to attach body via second pass; here we only
  // surface status, kind, reason.
  return {
    kind,
    status,
    retryAfter: parseRetryAfter(res.headers?.get?.('Retry-After')),
    reason,
    message: reason ?? defaultHint(kind),
  };
}

export function classifyHttpErrorFrom(
  status: number,
  body?: string,
  retryAfter?: string | null,
  reason?: string,
): ClassifiedHttpError {
  const kind: HttpErrorKind = (
    status === 401 ? 'unauthorized'
    : status === 403 ? 'forbidden'
    : status === 404 ? 'not_found'
    : status === 422 ? 'unprocessable'
    : status === 429 ? 'rate_limited'
    : status >= 500 && status < 600 ? 'server_error'
    : status >= 400 && status < 500 ? 'client_error'
    : 'unknown'
  );
  return {
    kind,
    status,
    retryAfter: parseRetryAfter(retryAfter ?? null),
    body,
    reason,
    message: reason ?? defaultHint(kind),
  };
}

/** Convenience: 抛一个按分类填好文案的 Error。Caller 应该仍自己 wrap 文案,
 *  这里只提供一个 "稳的 raw 文案" 兜底。 */
export function httpErrorToMessage(c: ClassifiedHttpError): string {
  const tail = c.reason ? ` (${c.reason})` : '';
  const bodyTail = c.body ? `: ${c.body.slice(0, 200)}` : '';
  if (c.status !== undefined) {
    return `HTTP ${c.status}${tail}${bodyTail}`.trim();
  }
  return c.message;
}
