// /lib/llm-clean/normalize.ts — LLM 输出边界归一化 + 文本安全收敛工具。
//
// 集中在这一层的原因:
//   - normalizeQuery / normalizeAliases 在多个 caller 中原本各自实现过
//     [[feedback_subq_fields_whitelist]],集中后只此一份,版本差异灰度
//   - clampText / clampStringArray 给 TopicReport 等 LLM-emitted 文本提供
//     长度收敛护栏,防止 LLM 偶发长输出爆 UI
//
// 不依赖任何业务模块,纯字符串处理。

/**
 * 单个 alias 的字符串化:接受 unknown,过滤空白和非 ASCII token 等。
 * 这是旧 normalizeQuery 的核心职责之一,集中到这里以免三处实现散落。
 */
export function normalizeAliasToken(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const t = raw.trim();
  if (!t) return '';
  // 仅保留 ASCII token (字母/数字/空格/连字符/下划线),剥掉中文/标点。
  return t.replace(/[^A-Za-z0-9 \-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * aliases 数组的标准化:每项过 normalizeAliasToken,去空,去重,剔除主 query 自己。
 */
export function normalizeAliases(
  rawAliases: readonly unknown[] | undefined,
  primaryQuery: string,
): string[] {
  if (!Array.isArray(rawAliases)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const primaryClean = normalizeAliasToken(primaryQuery).toLowerCase();
  for (const a of rawAliases) {
    const t = normalizeAliasToken(a);
    if (!t) continue;
    const key = t.toLowerCase();
    if (key === primaryClean) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * 主 query 标准化:
 *   1) 去掉中文字符
 *   2) 仅保留字母/数字/空格/连字符/下划线
 *   3) 折叠空白
 *   4) 截前 6 个 token (arXiv all: 全文模式 6 个以内足够,过长会被噪声论文污染)
 *
 * 返回空字符串代表"整段中文 / 无 token",caller 自行决定怎么 fallback。
 */
export function normalizeQuery(q: unknown): string {
  if (typeof q !== 'string') return '';
  let s = q.replace(/[一-鿿]+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/[^A-Za-z0-9 \-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const toks = s.split(' ').filter(Boolean);
  if (toks.length > 6) s = toks.slice(0, 6).join(' ');
  return s;
}

/** LLM-emitted 单条文本安全收敛:长度截断 + 数组过滤。 */
export function clampText(s: unknown, max: number): string {
  const t = String(s ?? '').trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** 数组元素的 clampText 包一层,顺便去掉空串。 */
export function clampStringArray(raw: unknown, maxLen: number, eachMax: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const v = clampText(x, eachMax);
    if (v) out.push(v);
    if (out.length >= maxLen) break;
  }
  return out;
}