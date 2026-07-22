// topic-search JSON 自愈层 —— 从 topic-search.ts 抽出（模块化重构 step 2）。
//
// 纯函数，无模块状态、无 DOM、无 I/O。负责把 LLM 返回的（可能被 max_tokens
// 截断、或裹着 <think>/```json 围栏的）文本还原成可 JSON.parse 的顶层 JSON。

// 括号栈扫描 + 截断自愈：从 stripped 里抓出顶层 JSON（数组或对象）。
//   - 完整闭合 → 精确切出 [start, end]。
//   - 扫到结尾仍未闭合(被截断)→ 按未闭合的括号栈补齐 " / } / ],丢掉末尾残缺一小段,
//     尽量还原成可 parse 的 JSON。
// opener 由调用方按首个结构字符给定('[' 或 '{'),避免误抓另一种括号。
export function extractTopLevelJsonWithHeal(stripped: string, opener: '[' | '{'): string | null {
  const startIdx = stripped.indexOf(opener);
  if (startIdx < 0) return null;
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < stripped.length; i++) {
    const ch = stripped[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (stack.length === 0) return stripped.slice(startIdx, i + 1); // 完整闭合
    }
  }
  // 未闭合 → 截断自愈
  let trial = stripped.slice(startIdx);
  if (inStr) {
    // 截在字符串值中间(如 "reason":"…核心路)→ 先补收尾引号
    trial += '"';
  } else {
    // 截在元素之间留了悬挂逗号(如 [{a},{b},)→ 去掉,否则 [..,] 非法
    trial = trial.replace(/,\s*$/, '');
  }
  // 按未闭合的括号栈 LIFO 补齐(最内层先闭合)
  for (let i = stack.length - 1; i >= 0; i--) trial += stack[i];
  return trial;
}

// 从(已剥 think/fence 的)stripped 里提取顶层 JSON;jsonOnly=false 时原样返回 stripped。
export function finalizeLLMJson(
  content: string,
  stripped: string,
  finishReason: string,
  jsonOnly: boolean,
  expectedTopLevel?: '[' | '{',
): string {
  if (!jsonOnly) {
    if (!stripped) throw new Error(`LLM 返回为空 (finish_reason=${finishReason})`);
    return stripped;
  }
  // jsonOnly:用带截断自愈的括号栈扫描提取顶层 JSON(数组或对象)。
  // 关键:顶层数组**不能**用 extractBalancedJson(只识别第一个 {...},会把
  // [{a},{b},{c}] 截成单个 {a});也不能用 lastIndexOf(']')(截断时会误取内层
  // aliases 的 ],得到括号不配对的串)。extractTopLevelJsonWithHeal 对完整/被
  // max_tokens 截断两种情况都能还原成可 parse 的 JSON。
  const headIdx = stripped.search(/\S/);
  if (headIdx < 0) throw new Error(`LLM 返回为空(finish_reason=${finishReason}, 返回前 200 字符: ${content.slice(0, 200).replace(/\s+/g, ' ')})`);
  const head = stripped[headIdx];
  // head 不是 [ / { 时说明 LLM 先输出了思考/说明文字。此时优先用调用方给的
  // expectedTopLevel(decompose 传 '{');没给才按"数组优先"猜:首个 [ 若出现在
  // 首个 { 之前就当数组,否则当对象。注意真实首字符永远优先于 expectedTopLevel,
  // 以支持 legacy 数组 fallback(某些 provider 仍返回数组)。
  let opener: '[' | '{';
  if (head === '[') opener = '[';
  else if (head === '{') opener = '{';
  else if (expectedTopLevel) opener = expectedTopLevel;
  else {
    const bi = stripped.indexOf('[');
    const oi = stripped.indexOf('{');
    opener = bi !== -1 && (oi === -1 || bi < oi) ? '[' : '{';
  }
  const extracted = extractTopLevelJsonWithHeal(stripped, opener);
  if (!extracted) {
    throw new Error(`LLM 未输出 JSON(finish_reason=${finishReason}, 返回前 200 字符: ${content.slice(0, 200).replace(/\s+/g, ' ')})`);
  }
  return extracted;
}
