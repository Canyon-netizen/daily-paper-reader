// 论文 RAG 检索核心算法 — 纯 ESM、无浏览器依赖。
//
// 抽出来是为了让 Python 端到端测试能直接 spawn `node paper-retrieval-core.mjs`
// 验证,不依赖 tsx/TypeScript 编译管线。
//
// 提供:
//   - segmentText(txt): 把论文纯文本切块并标记每块首行是否像标题
//   - findSectionBlock(blocks, ref): 找 §X.Y / 关键词对应段起点
//   - collectSection(blocks, startIdx, maxChars): 拿到下一标题为止
//   - rankSegmentsByQuery(segments, query, topK): TF 排序
//   - withNeighborhood(topHits, segments): 加前后 1 段上下文并排序
//
// paper-fulltext.ts 的 getSection / searchInTxt 只是这些纯逻辑 +
// loadLocalTxt loadLocal 的薄壳。

// ---------------------------------------------------------------------------
// 段切分 + 标题识别
// ---------------------------------------------------------------------------

/**
 * 把论文文本按双换行(\n\s*\n)切成段落块,识别每块首行是否像标题。
 *
 * @param {string} txt
 * @returns {{ text: string, heading: string | null }[]}
 */
export function segmentText(txt) {
  const blocks = txt.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((text) => {
    const firstLine = text.split('\n')[0].trim();
    return { text, heading: isHeadingLine(firstLine) ? firstLine : null };
  });
}

/**
 * 启发式判断一行是否像 LaTeX/PDF 章节标题。
 * 规则:不要太长、不以句末标点结尾,匹配编号 / § / 全大写短行。
 */
export function isHeadingLine(l) {
  if (l.length < 3 || l.length > 140) return false;
  if (/[.!?。！？]\s*$/.test(l)) return false;
  // 编号开头 1. / 1.1 / §3 / 3.2
  if (/^([0-9]+\.)+[0-9]*\s+\S/.test(l)) return true;
  // 单编号 + 标题词 "4 Experiments" / "5 Conclusion" / "6 Appendix"
  // ar5iv 经常把 chapter 渲染成无小数点格式,这里补回来。
  if (/^\d+\s+[A-Z][A-Za-z]/.test(l)) return true;
  // 罗马数字 "IV. Conclusion"
  if (/^[IVX]+\.\s+\S/.test(l)) return true;
  // § 编号 "§3" / "§3.2"
  if (/^§\s*\d+/.test(l)) return true;
  // 全大写短行("EXPERIMENTS" / "RELATED WORK")
  const words = l.split(/\s+/).filter(Boolean);
  if (words.length > 12) return false;
  if (l === l.toUpperCase() && /[A-Z]/.test(l)) return true;
  return false;
}

/**
 * 在 segmented 数组里找 ref 对应的段起点。
 * 两种策略:数字编号精确匹配 → 子串回退。
 *
 * @param {{heading: string|null}[]} blocks
 * @param {string} ref "3.2" / "§3" / "Training Pipeline" / "Hypernetwork"
 * @returns {number} startIdx, -1 = 没找到
 */
export function findSectionBlock(blocks, ref) {
  const refNorm = ref.replace(/^§/, '').trim().toLowerCase();
  const refIsNumeric = /^\d+(\.\d+)*$/.test(ref);

  if (refIsNumeric) {
    const prefix = ref + ' ';
    const i = blocks.findIndex(
      (b) => b.heading && b.heading.toLowerCase().startsWith(prefix),
    );
    if (i >= 0) return i;
  }

  // 子串回退:ref 在 heading 里命中(忽略大小写 + 标点)
  const refClean = refNorm.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '');
  return blocks.findIndex((b) => {
    if (!b.heading) return false;
    const hClean = b.heading.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '');
    return hClean.includes(refClean) || refClean.includes(hClean);
  });
}

/**
 * 从 startIdx 开始收集段落,直到下一个 heading(简单策略:任意 heading 都停)。
 *
 * @param {{text: string}[]} blocks
 * @param {number} startIdx
 * @param {number} maxChars
 * @returns {string}
 */
export function collectSection(blocks, startIdx, maxChars) {
  if (startIdx < 0 || startIdx >= blocks.length) return '';
  const out = [];
  let bytes = 0;
  for (let i = startIdx; i < blocks.length; i++) {
    if (i > startIdx && blocks[i].heading !== null) break;
    const blockText = blocks[i].text;
    if (bytes + blockText.length > maxChars) {
      out.push(blockText.slice(0, maxChars - bytes));
      out.push('\n[...该章节已截断...]');
      break;
    }
    out.push(blockText);
    bytes += blockText.length;
  }
  return out.join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// 关键词检索 — TF 排序
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'and', 'in', 'on', 'for', 'is', 'are',
  'with', 'that', 'this', 'as', 'by', 'we', 'our', 'it', 'be',
  '的', '了', '在', '是', '和', '与', '或', '把', '被',
]);

/**
 * 把查询切成有意义 token(过滤停用词 + 长度 < 2)。
 */
export function tokenize(query) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * 对每段按 token 命中数排序。长段降权避免"长段落靠量取胜"。
 *
 * @param {string[]} segments
 * @param {string} query
 * @param {number} topK
 * @returns {{idx: number, score: number}[]}
 */
export function rankSegmentsByQuery(segments, query, topK) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const hits = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].toLowerCase();
    let score = 0;
    for (const t of tokens) {
      const matches = seg.split(t).length - 1;
      score += matches * (300 / Math.max(80, segments[i].length));
    }
    if (score > 0) hits.push({ idx: i, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topK);
}

/**
 * 给 top hits 加前后 1 段上下文,按文档原序排好。
 *
 * @param {{idx: number}[]} topHits
 * @param {string[]} segments
 * @returns {{ idx: number, isPrimary: boolean }[]}
 */
export function withNeighborhood(topHits, segments) {
  const seen = new Set();
  const ordered = [];
  for (const h of topHits) {
    for (let j = Math.max(0, h.idx - 1); j <= Math.min(segments.length - 1, h.idx + 1); j++) {
      if (!seen.has(j)) {
        seen.add(j);
        ordered.push({ idx: j, isPrimary: false });
      }
    }
  }
  ordered.sort((a, b) => a.idx - b.idx);
  for (const it of ordered) {
    if (topHits.some((h) => h.idx === it.idx)) it.isPrimary = true;
  }
  return ordered;
}

/**
 * CLI 入口 — Python 测试 spawn `node` 调这个:
 *   echo '{"txt":"...","ref":"3.2"}' | node paper-retrieval-core.mjs getSection
 *   echo '{"txt":"...","query":"foo","topK":4}' | node paper-retrieval-core.mjs search
 *
 * 输出 JSON:
 *   getSection → { result: "<text>" | null }
 *   search → { result: string[] | null }
 */
async function main() {
  const [, , cmd] = process.argv;
  if (!cmd) {
    console.error('usage: node paper-retrieval-core.mjs <getSection|search>');
    process.exit(2);
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

  if (cmd === 'getSection') {
    const blocks = segmentText(input.txt);
    const startIdx = findSectionBlock(blocks, input.ref);
    const text = startIdx < 0 ? null : collectSection(blocks, startIdx, input.maxChars || 6000);
    process.stdout.write(JSON.stringify({ result: text }));
    return;
  }
  if (cmd === 'search') {
    const segments = input.txt.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const hits = rankSegmentsByQuery(segments, input.query, input.topK || 4);
    if (!hits.length) {
      process.stdout.write(JSON.stringify({ result: null }));
      return;
    }
    const ordered = withNeighborhood(hits, segments);
    const result = ordered.map(
      (it) => `${it.isPrimary ? '★ ' : '  '}${segments[it.idx]}`,
    );
    process.stdout.write(JSON.stringify({ result }));
    return;
  }
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}

// 仅在直接执行时跑 main,import 时不跑。
// 动态 import('node:url') 而非静态 import — Vite/Astro 在 bundle 浏览器侧模块
// 时会把静态 `node:url` externalize 成 stub,触发 fileURLToPath 报错;
// node:url 只在 CLI 直接跑这个 .mjs 时用,SSR 侧不会触碰。
const { fileURLToPath } = await import('node:url');
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.stack || e.message);
    process.exit(1);
  });
}
