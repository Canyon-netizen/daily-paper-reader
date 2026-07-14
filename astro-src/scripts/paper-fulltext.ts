// 论文全文骨架抓取与缓存模块
//
// 目标:让 paper-chat 的 system prompt 能拿到论文的章节结构 + 每段首句,
// 而不是只有结构化摘要。回答细节问题时不再说"摘要里没提到"。
//
// 数据源优先级:
//   1) 本地 /papers/{id}.txt — daily pipeline 已抓 PDF 抽正文落在仓库里,
//      SSR 阶段 copy-docs-assets 拷到 public/。秒开、无网络成本、不依赖 8123 代理。
//      但部分新论文可能 .txt 还没生成(早期 pipeline / 漏抓),缺失时降级到 ar5iv。
//   2) ar5iv.org/html/<id> (LaTeXML 渲染,自带结构化 HTML)
//   3) arxiv.org/pdf/<id> + pdf.js (extractPdfTextFromBuffer,已存在于 paper-analyzer.ts)
//   最终回退:摘要模式 (永远不阻断 chat)
//
// 复用约定:fetchWithDiagnosis / canonicalArxivId / CORS_PROXIES 都从 paper-analyzer.ts import。
// 模块被多页 import 时若浏览器环境异常(IndexedDB 不可用等)直接降级,不抛错打断调用方。

import { fetchWithDiagnosis } from './paper-analyzer';

// ============================================================================
// 类型
// ============================================================================

export type FulltextState = 'hit' | 'fresh' | 'abs-only' | 'error';

export interface SkeletonSection {
  level: number;          // 1..4(h1..h4)
  title: string;          // 章节标题
  firstSentence: string;  // 该章节下第一个段落的首句
  formulaCount: number;   // 公式数量(渲染后 MathML/LaTeX 标签数)
  tableCount: number;     // 表格数量
}

export interface FulltextSkeleton {
  // sections 已按文档顺序排好,按重要性给 LLM 看的顺序在 toPromptText() 里再处理
  sections: SkeletonSection[];
  // 本地 .txt 来源时填的完整纯文本(可能比 sections 更全),用于按段落切 8KB 喂 LLM。
  // sections 来源(ar5iv / pdf fallback)通常不带这个字段。
  plainText?: string;
  // 元数据,不一定有
  abstract?: string;
  // arxiv id 的规范化形(无 v# 后缀),用于缓存 key
  canonicalId: string;
  // 缓存时的版本号,如 'v1' / 'v2'
  version: string;
  // 抓取来源标签
  source: 'ar5iv' | 'pdf' | 'abs' | 'txt';
}

export interface FulltextResult {
  state: FulltextState;
  skeleton: FulltextSkeleton | null;
  // 失败时的简短错误,UI tooltip 用
  error?: string;
  // 是否真的拿到了全文骨架(影响 UI badge)
  hasFulltext: boolean;
}

// ============================================================================
// 缓存(IndexedDB,失败降级 localStorage)
// ============================================================================

const CACHE_DB = 'dpr-fulltext';
const CACHE_STORE = 'papers';
const CACHE_VERSION = 1;
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
// 容量上限:超了就截断 sections 数组尾部,保留前面章节
// 一篇论文骨架 5-30KB,30KB 上限基本能塞下整篇核心结构
const MAX_SKELETON_BYTES = 30 * 1024;

interface CacheRecord {
  canonicalId: string;
  version: string;
  skeleton: FulltextSkeleton;
  fetchedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(CACHE_DB, CACHE_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE, { keyPath: 'canonicalId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function localStorageKey(canonicalId: string): string {
  return `dpr_paper_fulltext_v1:${canonicalId}`;
}

function readFromLocalStorage(canonicalId: string): CacheRecord | null {
  try {
    const raw = localStorage.getItem(localStorageKey(canonicalId));
    if (!raw) return null;
    const rec = JSON.parse(raw) as CacheRecord;
    if (!rec?.skeleton || !rec.fetchedAt) return null;
    return rec;
  } catch {
    return null;
  }
}

function writeToLocalStorage(rec: CacheRecord): void {
  try {
    localStorage.setItem(localStorageKey(rec.canonicalId), JSON.stringify(rec));
  } catch {
    /* 配额满 / 隐私模式,静默忽略 */
  }
}

async function cacheGet(canonicalId: string): Promise<CacheRecord | null> {
  const db = await openDB();
  if (db) {
    try {
      const rec = await new Promise<CacheRecord | null>((resolve) => {
        const tx = db.transaction(CACHE_STORE, 'readonly');
        const req = tx.objectStore(CACHE_STORE).get(canonicalId);
        req.onsuccess = () => resolve((req.result as CacheRecord) || null);
        req.onerror = () => resolve(null);
      });
      if (rec) return rec;
    } catch { /* fall through to localStorage */ }
  }
  return readFromLocalStorage(canonicalId);
}

async function cacheSet(rec: CacheRecord): Promise<void> {
  const db = await openDB();
  if (db) {
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        tx.objectStore(CACHE_STORE).put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      return;
    } catch { /* fall through to localStorage */ }
  }
  writeToLocalStorage(rec);
}

function isCacheValid(rec: CacheRecord, currentVersion: string): boolean {
  if (Date.now() - rec.fetchedAt > TTL_MS) return false;
  if (rec.version && currentVersion && rec.version !== currentVersion) return false;
  return true;
}

// ============================================================================
// arXiv id 处理 — 版本号剥离 + 提取
// ============================================================================

export function canonicalArxivId(id: string): string {
  return id.replace(/v\d+$/i, '').trim();
}

export function arxivIdVersion(id: string): string {
  const m = id.match(/v(\d+)$/i);
  return m ? `v${m[1]}` : 'v1';
}

function ar5ivUrl(arxivId: string): string {
  return `https://ar5iv.org/html/${canonicalArxivId(arxivId)}`;
}

// ============================================================================
// 本地 .txt 来源 — daily pipeline 抓 PDF 抽正文,SSR 时已拷到 public/papers/。
// 优先用这个,避免依赖 8123 CORS 代理 + ar5iv 网络抖动。
// ============================================================================

/**
 * 读 /papers/{arxivId}.txt。
 * 返回纯文本;文件不存在 / 太小(< 1KB,通常是 404 HTML 错误页或空)返回 null。
 * 调用方 catch 网络异常继续走 ar5iv 兜底。
 */
export async function loadLocalTxt(arxivId: string): Promise<string | null> {
  const id = canonicalArxivId(arxivId);
  // arxivId 形如 "2606.30015v1" / "2606.30015" → 都要尝试 .txt 后缀
  const candidates = [
    `${id}.txt`,
    `${arxivId}.txt`,  // 兜底带 v# 形式(虽然 public 里只放去重后的,但万一)
  ];
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  for (const name of candidates) {
    try {
      const res = await fetch(`${base}/papers/${name}`);
      if (!res.ok) continue;
      const text = await res.text();
      // sanity check:太短可能是错误页(404 HTML 也很小)
      if (text.length < 1000) continue;
      return text;
    } catch {
      continue;
    }
  }
  return null;
}

// ============================================================================
// 数据获取 — ar5iv HTML(优先)
// ============================================================================

export async function fetchAr5ivHtml(arxivId: string): Promise<string> {
  const url = ar5ivUrl(arxivId);
  const res = await fetchWithDiagnosis(url, `ar5iv 全文(${arxivId})`);
  if (!res.ok) throw new Error(`ar5iv 返回 ${res.status}`);
  const html = await res.text();
  // ar5iv 渲染失败时返的不是 HTML 而是错误页(可能 < 1KB)。做个 sanity check。
  if (html.length < 500 || !/<html/i.test(html)) {
    throw new Error(`ar5iv 返回内容异常(${html.length}B),可能论文 TeX 渲染失败`);
  }
  return html;
}

// ============================================================================
// 骨架抽取 — DOMParser 抽 h1-h4 + 段落首句 + 公式/表格计数
// ============================================================================

function stripVersionSuffix(s: string): string {
  return s.replace(/^\s*\d+(\.\d+)+\s*/, '').trim();
}

function firstSentence(p: string): string {
  const t = p.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  // 简单按 .!?。!? 切首句;超过 280 字直接截断(论文段落首句可能很长)
  const m = t.match(/^[\s\S]*?[.!?。!?](?=\s|$)/);
  const sentence = m ? m[0].trim() : t.slice(0, 280);
  return sentence.length > 320 ? sentence.slice(0, 320) + '…' : sentence;
}

export function extractSkeleton(html: string): FulltextSkeleton {
  // DOMParser 在 SSR 环境(没有 DOM)会抛错,callers 应在浏览器侧调用
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // 优先抓 article 标签(ar5iv 论文正文都在 <article> 里),fallback 到 body
  const root = doc.querySelector('article') || doc.body || doc.documentElement;

  const sections: SkeletonSection[] = [];
  // 限定只在 article 内走,h1 一般是论文标题(不计入"章节");h2 开始是正式 section
  const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4'));

  for (const h of headings) {
    const level = Number(h.tagName.slice(1));
    const titleRaw = (h.textContent || '').trim();
    if (!titleRaw) continue;
    // h1 跳过(论文标题已经在摘要里给 LLM 看过,不算"章节结构")
    if (level === 1) continue;

    // 找该 heading 之后的下一个段落,作为 firstSentence 来源
    let firstParaText = '';
    let walker = h.nextElementSibling;
    let safety = 0;
    while (walker && safety < 30) {
      if (/^H[1-6]$/.test(walker.tagName)) break; // 撞到下一标题就停
      if (walker.tagName === 'P') {
        firstParaText = (walker.textContent || '').trim();
        if (firstParaText) break;
      }
      walker = walker.nextElementSibling;
      safety++;
    }
    // 数公式/表格 — 在 heading 之后到下一个同级 heading 之间的元素里数
    let formulaCount = 0;
    let tableCount = 0;
    let w2 = h.nextElementSibling;
    let s2 = 0;
    while (w2 && s2 < 60) {
      if (/^H[1-6]$/.test(w2.tagName)) break;
      formulaCount += w2.querySelectorAll(
        'math, .ltx_equation, [role="math"], .MathJax, .mwe-math-mathml-display, .mwe-math-mathml-inline',
      ).length;
      tableCount += w2.querySelectorAll('table, figure.ltx_table').length;
      w2 = w2.nextElementSibling;
      s2++;
    }

    sections.push({
      level,
      title: stripVersionSuffix(titleRaw),
      firstSentence: firstSentence(firstParaText),
      formulaCount,
      tableCount,
    });
  }

  // abstract:ar5iv 一般把摘要放在 <blockquote class="ltx_abstract"> 或 .abstract
  const absEl = doc.querySelector('.ltx_abstract, blockquote.abstract, [class*="abstract"]');
  let abstract: string | undefined;
  if (absEl) {
    const t = (absEl.textContent || '').replace(/^abstract[:\s]*/i, '').trim();
    if (t.length > 50) abstract = t.slice(0, 1200);
  }

  return {
    sections,
    abstract,
    canonicalId: '', // 由 caller 填
    version: '',     // 由 caller 填
    source: 'ar5iv',
  };
}

// ============================================================================
// 主入口 — loadFulltextSkeleton
// ============================================================================

export interface LoadOptions {
  // 强制不走缓存(用户切 toggle 调试时可用)
  bypassCache?: boolean;
  // 跳过 ar5iv,直接走 PDF 兜底(几乎用不到,留给 A/B)
  skipAr5iv?: boolean;
}

export async function loadFulltextSkeleton(
  arxivId: string,
  opts: LoadOptions = {},
): Promise<FulltextResult> {
  const canonicalId = canonicalArxivId(arxivId);
  const version = arxivIdVersion(arxivId);

  // 1) 查缓存
  if (!opts.bypassCache) {
    try {
      const rec = await cacheGet(canonicalId);
      if (rec && isCacheValid(rec, version)) {
        return {
          state: 'hit',
          skeleton: rec.skeleton,
          hasFulltext: true,
        };
      }
    } catch { /* 缓存层异常,继续走抓取 */ }
  }

  // 2) 优先读本地 /papers/{id}.txt — daily pipeline 已抓的 PDF 正文,
  //    SSR 阶段 copy-docs-assets 拷到 public/。秒开、无网络成本、不依赖 8123 代理。
  //    没有 .txt 的论文(如新抓还没生成 / pipeline 漏抓)再走 ar5iv 兜底。
  try {
    const localTxt = await loadLocalTxt(arxivId);
    if (localTxt && localTxt.length > 1000) {
      const sk: FulltextSkeleton = {
        sections: [],  // 本地 .txt 不分章节,直接走 plainText
        plainText: localTxt,
        canonicalId,
        version,
        source: 'txt',
      };
      // 写缓存
      cacheSet({ canonicalId, version, skeleton: sk, fetchedAt: Date.now() }).catch(() => {});
      return { state: 'fresh', skeleton: sk, hasFulltext: true };
    }
  } catch { /* 本地 txt 读取失败,继续走 ar5iv */ }

  // 2) 抓 ar5iv
  if (!opts.skipAr5iv) {
    try {
      const html = await fetchAr5ivHtml(arxivId);
      const sk = extractSkeleton(html);
      sk.canonicalId = canonicalId;
      sk.version = version;
      sk.source = 'ar5iv';
      const trimmed = trimSkeletonToBytes(sk, MAX_SKELETON_BYTES);
      // 写缓存(失败也返回 fresh,只不再命中)
      cacheSet({
        canonicalId,
        version,
        skeleton: trimmed,
        fetchedAt: Date.now(),
      }).catch(() => {});
      return { state: 'fresh', skeleton: trimmed, hasFulltext: true };
    } catch (e) {
      // ar5iv 失败 → 静默降级到 PDF 兜底,这里不抛错,等 PDF 也失败再返回 error
      const errMsg = (e as Error)?.message || String(e);
      try {
        const sk = await fetchPdfFallback(arxivId);
        if (sk) {
          sk.canonicalId = canonicalId;
          sk.version = version;
          const trimmed = trimSkeletonToBytes(sk, MAX_SKELETON_BYTES);
          cacheSet({
            canonicalId,
            version,
            skeleton: trimmed,
            fetchedAt: Date.now(),
          }).catch(() => {});
          return { state: 'fresh', skeleton: trimmed, hasFulltext: true };
        }
      } catch { /* PDF 也失败 */ }
      return {
        state: 'error',
        skeleton: null,
        error: `全文获取失败:${errMsg.slice(0, 200)}`,
        hasFulltext: false,
      };
    }
  }

  return { state: 'error', skeleton: null, error: '未抓取', hasFulltext: false };
}

// ============================================================================
// PDF 兜底 — 复用 paper-analyzer 的能力
// 动态 import 是为了避免循环依赖 + 让没启用全文模式的页面也不付出 pdf.js 加载成本
// ============================================================================

async function fetchPdfFallback(arxivId: string): Promise<FulltextSkeleton | null> {
  try {
    const mod = await import('./paper-analyzer');
    const canonicalId = canonicalArxivId(arxivId);
    const version = arxivIdVersion(arxivId);
    const url = `https://arxiv.org/pdf/${canonicalId}${version}`;
    const res = await mod.fetchWithDiagnosis(url, `arxiv PDF(${arxivId})`);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 1000) return null;
    // 简单 magic bytes 校验
    const head = new Uint8Array(buf, 0, 5);
    const magic = String.fromCharCode(...head);
    if (!magic.startsWith('%PDF')) return null;
    const text = await mod.extractPdfTextFromBuffer(buf, () => {});
    return pdfTextToSkeleton(text, canonicalId, version);
  } catch {
    return null;
  }
}

function pdfTextToSkeleton(text: string, canonicalId: string, version: string): FulltextSkeleton {
  // PDF 抽出的纯文本没有结构,我们按"双换行"分段,启发式识别"全部大写或数字开头短行"作为标题
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const sections: SkeletonSection[] = [];
  let cur: SkeletonSection | null = null;
  let curFirstPara: string[] = [];

  const isHeading = (l: string): boolean => {
    if (l.length < 3 || l.length > 120) return false;
    // 全大写(且至少 2 个字母)/数字编号开头(1. / 1.1 / I.)
    if (/^([0-9]+\.)+[0-9]*\s+\S/.test(l)) return true;
    if (/^[IVX]+\.\s+\S/.test(l)) return true;
    if (l === l.toUpperCase() && /[A-Z]/.test(l) && l.split(/\s+/).length <= 10) return true;
    return false;
  };

  for (const line of lines) {
    if (isHeading(line)) {
      if (cur) {
        cur.firstSentence = firstSentence(curFirstPara.join(' '));
        sections.push(cur);
      }
      cur = { level: 2, title: line, firstSentence: '', formulaCount: 0, tableCount: 0 };
      curFirstPara = [];
    } else if (cur) {
      if (curFirstPara.length < 3) curFirstPara.push(line);
    }
  }
  if (cur) {
    cur.firstSentence = firstSentence(curFirstPara.join(' '));
    sections.push(cur);
  }

  return { sections, canonicalId, version, source: 'pdf' };
}

// ============================================================================
// 骨架格式化 — 把 FulltextSkeleton 转成给 LLM 看的纯文本
// ============================================================================

export function skeletonToPromptText(sk: FulltextSkeleton, maxBytes = 8 * 1024): string {
  // 本地 .txt 来源:plainText 优先级最高,直接喂纯文本。
  // 论文完整正文比章节骨架信息量大,LLM 回答细节更准;
  // maxBytes 8KB 截断(~3000 字,3-5 个核心章节)避免 token 浪费。
  if (sk.plainText) {
    const lines: string[] = [];
    lines.push('论文全文(由 daily pipeline 从 arXiv PDF 抽取):');
    lines.push('');
    let bytes = lines.join('\n').length;
    const text = sk.plainText;
    if (text.length <= maxBytes - bytes) {
      lines.push(text);
      return lines.join('\n');
    }
    // 截断到最后一个完整段落(双换行)边界,避免半截句子
    const targetEnd = maxBytes - bytes;
    const slice = text.slice(0, targetEnd);
    const lastParaBreak = slice.lastIndexOf('\n\n');
    const end = lastParaBreak > targetEnd * 0.8 ? lastParaBreak + 2 : targetEnd;
    lines.push(text.slice(0, end));
    lines.push('(后续内容已截断,完整正文请查看原文链接)');
    return lines.join('\n');
  }

  // ar5iv / pdf fallback 来源:按章节骨架输出
  // 按"重要性"排序:Method > Experiments > Conclusion > Introduction > Related Work > Appendix
  // 但 ar5iv 顺序一般就是 Introduction→Method→Experiments→Conclusion,所以基本按顺序即可
  // 只在尾部追加章节 anchor map,方便 LLM 引用
  const lines: string[] = [];
  lines.push('论文全文骨架(章节标题 + 每段首句 + 公式/表格计数):');
  lines.push('');
  let bytes = lines.join('\n').length;
  for (const sec of sk.sections) {
    const heading = '##'.repeat(Math.max(1, sec.level - 1)) + ' ' + sec.title;
    const meta = sec.formulaCount > 0 || sec.tableCount > 0
      ? `  [公式×${sec.formulaCount} 表格×${sec.tableCount}]`
      : '';
    const body = sec.firstSentence ? `\n  ${sec.firstSentence}` : '';
    const block = `${heading}${meta}${body}\n`;
    if (bytes + block.length > maxBytes) {
      lines.push('(后续章节已截断,完整骨架请查看 ar5iv 原文)');
      break;
    }
    lines.push(block.trim());
    bytes += block.length;
  }
  if (sk.abstract) {
    const abs = `\n摘要补充:${sk.abstract.slice(0, 400)}\n`;
    if (bytes + abs.length < maxBytes) {
      lines.push(abs.trim());
    }
  }
  return lines.join('\n');
}

// ============================================================================
// 容量截断 — 超 MAX_SKELETON_BYTES 就从尾部砍
// ============================================================================

function trimSkeletonToBytes(sk: FulltextSkeleton, maxBytes: number): FulltextSkeleton {
  const text = skeletonToPromptText(sk, Infinity);
  if (text.length <= maxBytes) return sk;
  // 二分找最大可保留的 sections 数
  let lo = 0, hi = sk.sections.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const trial = { ...sk, sections: sk.sections.slice(0, mid) };
    if (skeletonToPromptText(trial, Infinity).length <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return { ...sk, sections: sk.sections.slice(0, lo) };
}

// ============================================================================
// 元数据预热 — 仅抓 /abs HTML(2KB)补充 abstract,不等全文
// ============================================================================

export interface AbsMetadata {
  abstract?: string;
  title?: string;
  authors?: string;
}

export async function fetchAbsMetadata(arxivId: string): Promise<AbsMetadata | null> {
  const canonicalId = canonicalArxivId(arxivId);
  // abs 页是个简单 HTML 页,~2KB,任何代理都能拿到
  const url = `https://arxiv.org/abs/${canonicalId}`;
  try {
    const res = await fetchWithDiagnosis(url, `arxiv abs(${arxivId})`);
    if (!res.ok) return null;
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const abstract = doc.querySelector('blockquote.abstract')?.textContent?.replace(/^Abstract:\s*/i, '').trim();
    const title = doc.querySelector('h1.title')?.textContent?.replace(/^Title:\s*/i, '').trim();
    const authors = doc.querySelector('.authors')?.textContent?.replace(/^Authors:\s*/i, '').trim();
    return { abstract, title, authors };
  } catch {
    return null;
  }
}

// ============================================================================
// 测试钩子 — 阶段 1 验证用,挂在 window 让 devtools 直接调
// ============================================================================

declare global {
  interface Window {
    __test_fulltext?: (arxivId: string) => Promise<FulltextResult>;
    __test_skeleton_prompt?: (sk: FulltextSkeleton) => string;
  }
}

if (typeof window !== 'undefined') {
  window.__test_fulltext = (id: string) => loadFulltextSkeleton(id, { bypassCache: true });
  window.__test_skeleton_prompt = skeletonToPromptText;
}