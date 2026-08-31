/**
 * PR-4 Prompt Pack 1.0 — TypeScript 侧注入层。
 *
 * 设计原则（对齐 Python src/prompt_pack.py）：
 *   - 零破坏：默认所有 target 不 pin，走硬编码 const。
 *   - 载体 = 目录：public/prompts/<pack_id>/<version>/{manifest.json,body.md}
 *   - 24000 char 上限：对齐 Polaris _TARGET_BUDGET_CHARS
 *   - 任何异常走 graceful fallback，绝不抛
 *
 * 调用方：
 *   - astro-src/scripts/paper-analyzer.ts: getActiveSystemPrompt / getActiveDeepdivePrompt
 *   - astro-src/scripts/topic-search.ts: getActiveFacetPrompt / getActiveExplorePrompt / getActiveCandPrompt
 */

export const TARGET_BUDGET_CHARS = 24000;

export type PromptTarget =
  | 'enrich'
  | 'refine'
  | 'select'
  | 'doc.generate'
  | 'analyzer.system'
  | 'analyzer.deepdive'
  | 'topic.facet'
  | 'topic.cand'
  | 'topic.explore'
  | 'topic.summary'
  | 'topic.report'
  | 'topic.debate'        // Elo debate: persona arguments + judge
  // Polaris library workbench — 8 Tab 配套 stage (PR 阶段 1 起)
  | 'library.compile'       // Polaris wiki_compile.LIBRARIAN_SYSTEM_PROMPT
  | 'library.relevance'    // Polaris relevance.RELEVANCE_SYSTEM_PROMPT
  | 'library.concept_def'  // Polaris concepts.CONCEPT_DEF_SYSTEM_PROMPT
  | 'library.figure'       // Polaris figure_annotate.FIGURE_ANNOTATE_SYSTEM_PROMPT (多模态)
  | 'library.digest'       // Polaris research_digest.PAPER_INSIGHTS_SYSTEM_PROMPT
  | 'library.digest_synth' // Polaris research_digest.DIGEST_SYNTHESIS_SYSTEM_PROMPT
  | 'library.trend'        // Polaris research_digest.TREND_SYSTEM_PROMPT
  | 'library.chat'        // Polaris papers.CHAT_SYSTEM_PROMPT_TEMPLATE (库级适配)
  | 'paper.method_debate'; // 方法对比:每个方法 pros/cons + cross-method summary

export interface PackManifest {
  pack_id: string;
  version: string;
  display_name: string;
  kind: 'guidance' | 'persona' | 'tool' | 'workflow';
  targets: PromptTarget[];
  body_file?: string;
  /**
   * 多 body 映射 — 同 pack 内不同 target 取不同 body 文件。
   * 例如 library-digest 三个 stage 分别对应 insights.md / synthesis.md / trend.md。
   * 缺省时所有 target 共用 body_file。
   */
  bodies?: Partial<Record<PromptTarget, string>>;
  requires_taxonomies_version?: string | null;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Pack {
  manifest: PackManifest;
  body: string;
}

interface ActiveConfig {
  prompt_packs?: {
    active?: Partial<Record<PromptTarget, string>>;
    taxonomies_version?: string;
  };
}

const PROMPTS_ROOT = '/prompts'; // public/prompts 在浏览器访问根

// 已载入 pack 缓存（key = `${target}:${pin}`），避免同一会话反复 fetch
const packCache = new Map<string, Pack>();

function getPin(target: PromptTarget, config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;
  const pp = (config as ActiveConfig).prompt_packs;
  if (!pp || typeof pp !== 'object') return null;
  const active = pp.active;
  if (!active || typeof active !== 'object') return null;
  const pin = active[target];
  if (typeof pin !== 'string' || !pin.includes(':')) return null;
  return pin.trim() || null;
}

function parsePin(pin: string): { pack_id: string; version: string } | null {
  const [pack_id, version] = pin.split(':').map((s) => s.trim());
  if (!pack_id || !version) return null;
  return { pack_id, version };
}

async function fetchPack(
  pack_id: string,
  version: string,
  target?: PromptTarget,
): Promise<Pack | null> {
  const baseUrl = `${PROMPTS_ROOT}/${encodeURIComponent(pack_id)}/${encodeURIComponent(version)}`;
  try {
    const manifestRes = await fetch(`${baseUrl}/manifest.json`, { credentials: 'omit' });
    if (!manifestRes.ok) return null;
    const manifest = (await manifestRes.json()) as PackManifest;
    // 多 body 解析:target 命中 bodies[target] 优先,缺省走 body_file
    const bodiesMap = manifest.bodies as Partial<Record<PromptTarget, string>> | undefined;
    let bodyFileName: string;
    if (target && bodiesMap && typeof bodiesMap[target] === 'string') {
      bodyFileName = bodiesMap[target] as string;
    } else {
      bodyFileName = manifest.body_file || 'body.md';
    }
    const bodyRes = await fetch(`${baseUrl}/${bodyFileName}`, { credentials: 'omit' });
    if (!bodyRes.ok) return null;
    const body = await bodyRes.text();
    return { manifest, body };
  } catch {
    return null;
  }
}

/**
 * 加载当前 active pack（pin 未配 / 失败一律返回 null，调用方走硬编码默认）。
 *
 * 多 body pack 必传 target,否则取 manifest.body_file 兜底(对 library-digest 这种
 * 同包内多 stage 的场景意义不大,但兼容单 body pack 行为)。
 */
export async function loadActivePack(
  target: PromptTarget,
  config: unknown,
): Promise<Pack | null> {
  const pin = getPin(target, config);
  if (!pin) return null;
  const parsed = parsePin(pin);
  if (!parsed) return null;
  const cacheKey = `${target}:${pin}`;
  if (packCache.has(cacheKey)) return packCache.get(cacheKey)!;
  const pack = await fetchPack(parsed.pack_id, parsed.version, target);
  if (pack) packCache.set(cacheKey, pack);
  return pack;
}

/**
 * 把 pack.body 拼到 prompt 前面。
 * 同步版本：若已通过 preloadPacks 预热，可走缓存；否则返回原 prompt。
 */
export function injectIntoPromptSync(
  prompt: string,
  target: PromptTarget,
  config: unknown,
): string {
  const pin = getPin(target, config);
  if (!pin) return prompt;
  const cacheKey = `${target}:${pin}`;
  const pack = packCache.get(cacheKey);
  if (!pack) return prompt;
  const body = (pack.body || '').trim();
  if (!body) return prompt;
  const injected = `${body}\n\n---\n\n${prompt}`;
  if (injected.length > TARGET_BUDGET_CHARS) {
    return (
      injected.slice(0, TARGET_BUDGET_CHARS - 50) +
      '\n\n... [truncated to 24000 chars]'
    );
  }
  return injected;
}

/**
 * 异步版本：若未预热会临时 fetch。
 * 任何异常走 graceful fallback —— 返回原 prompt，绝不抛。
 */
export async function injectIntoPrompt(
  prompt: string,
  target: PromptTarget,
  config: unknown,
): Promise<string> {
  try {
    const pack = await loadActivePack(target, config);
    if (!pack) return prompt;
    const body = (pack.body || '').trim();
    if (!body) return prompt;
    const injected = `${body}\n\n---\n\n${prompt}`;
    if (injected.length > TARGET_BUDGET_CHARS) {
      return (
        injected.slice(0, TARGET_BUDGET_CHARS - 50) +
        '\n\n... [truncated to 24000 chars]'
      );
    }
    return injected;
  } catch {
    return prompt;
  }
}

/**
 * 启动时预热：把当前 config 的所有 active pin 全部 fetch 到缓存。
 * 推荐在调用方模块顶层 await 一次。
 */
export async function preloadPacks(config: unknown): Promise<void> {
  if (!config || typeof config !== 'object') return;
  const pp = (config as ActiveConfig).prompt_packs;
  if (!pp?.active) return;
  const pins = Object.entries(pp.active) as [PromptTarget, string][];
  await Promise.all(
    pins.map(([target, pin]) => {
      if (typeof pin !== 'string' || !pin.includes(':')) return Promise.resolve(null);
      const cacheKey = `${target}:${pin}`;
      if (packCache.has(cacheKey)) return Promise.resolve(null);
      const parsed = parsePin(pin);
      if (!parsed) return Promise.resolve(null);
      return fetchPack(parsed.pack_id, parsed.version, target).then((p) => {
        if (p) packCache.set(cacheKey, p);
      });
    }),
  );
}

/**
 * 测试 / 调试用：清空缓存。
 */
export function _resetPackCache(): void {
  packCache.clear();
}