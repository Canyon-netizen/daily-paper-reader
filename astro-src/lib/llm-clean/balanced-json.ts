// /lib/llm-clean/balanced-json.ts — 从 LLM 输出字符串里提取第一个配对的 { ... } JSON。
//
// 设计目标:
//   - LLM 响应经常被夹在 ```json ...``` fence 或前后 reasoning 文本里;
//   - 简单正则 /\{[\s\S]*\}/ 会把多个对象吞成一个,或把 reasoning 文本吞进去;
//   - 必须按括号配对 + 字符串转义边界推进,才能"切出第一个合法 JSON object"。
//
// 与 topic-search/json-heal.ts 的差别:
//   - json-heal 是 "顶层数组 / 多对象 / 容错修复" 的全集;
//   - 本函数只切"第一个配对的 {...}",适合 paper-analyzer / 单字段 SubQ response。
//
// 在 llm-clean/ 而不是 lib/root:它是 LLM 输出边界的纯字符串工具,跟
// clampText / normalizeQuery 同性质。
//
// 不依赖任何业务模块,可独立单测。

/** 从字符串里提取第一个配对的 { ... } JSON 块(跳过字符串里的 `{` `}`)。
 *  返回匹配的子串或 null。
 *
 *  行为:
 *   - 不识别 ```json ... ``` fence;caller 自行 strip 后调用;
 *   - 不识别 `[{...}, {...}]` 数组整体(只切第一个顶层 object);
 *     caller 若是顶层数组,自己剥 `[ ]` 再调;
 *   - 对半截 JSON(`{ "k": 1`)也返回 null(配对失败)。 */
export function extractBalancedJson(s: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (start === -1) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start !== -1) {
        return s.slice(start, i + 1);
      }
    }
  }
  return null;
}