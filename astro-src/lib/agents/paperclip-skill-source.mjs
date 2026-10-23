/**
 * lib/agents/paperclip-skill-source.mjs — Paperclip 已批准 skill 版本作为方法论源(iter #74)
 *
 * 背景:
 *   Paperclip 那边的 agent 公司有一条完整的治理链:learning agent 从交付收据里提教训,
 *   只**提案**(写 skill 新版本,不自动生效);judge agent 跑外部判据脚本**只判定**;
 *   人审通过之后 CEO 才把 agent 的 pin 移到新版本。
 *
 *   DPR 这边的 6 个 stage 各自消费 docs/research-skills/*.md 作为"方法论上下文"。
 *   iter #74 让这条治理链的产物能真的进到 prompt 里:流水线去 Paperclip 读
 *   **已被 pin 住(已批准)的版本**,而不是库里最新写入的版本。
 *
 * 治理要点 —— 为什么读 pin 而不是 currentVersionId:
 *   - company_skill.currentVersionId 只表示"最新写入"。
 *     learning agent 提一个提案,currentVersionId 立刻就动了 —— 哪怕没人审、judge 还没判。
 *   - 只有 agent 的 pin(desiredSkillEntries 里的 versionId)表示"已批准且已上线"。
 *   - 所以这里只读 pin。没有 pin = 还没人审通过 = 当作"没有已批准版本",
 *     绝不退回 currentVersionId(那等于把提案当批准)。
 *
 * 设计原则(同 web-search / paper-compiler / synthesis-diff):
 *   - 纯函数 + IO 注入:fetch 由调用方给,单测不用起网络
 *   - 预取 + 同步读缓存:loadSkillContext 是**同步** API(5 个调用点,改 async 会破坏它们),
 *     所以远端拉取走"预取 → 落缓存文件 → 同步读缓存"
 *   - 远端优先、本地兜底:某份方法论文档远端有已批准版本就用远端,没有就用本地那份
 *   - graceful:Paperclip 挂了/没配/没 pin → 只用本地文档,流水线照跑
 *
 * 单一真相源 for:
 *   - parsePaperclipSkillKey()  "company/<cid>/<slug>" → {companyId, slug}
 *   - pickPinnedVersionId()    agent skill 快照 → 被 pin 的 versionId
 *   - pickSkillIdByKey()       company skill 列表 → skillId
 *   - selectVersionFiles()     版本 fileInventory → [{path, content}]
 *   - computeSkillFilesSha256() 文件集 sha256(进 prompt 做溯源)
 *   - buildSkillCache() / parseSkillCache() / readSkillCache() / writeSkillCache()
 *   - prefetchPaperclipSkill()  预取:pin → 版本正文 → 落缓存
 *   - renderSkillCacheBlock()  把已批准版本渲染成可注入的上下文块
 *
 * 跑法:node --test astro-src/scripts/agents-paperclip-skill-source.test.mjs
 *
 * 环境变量:
 *   PAPERCLIP_API_URL         Paperclip 实例地址(默认 http://127.0.0.1:3100)
 *   PAPERCLIP_API_KEY         可选;bearer token(自建实例 board 访问可不带)
 *   PAPERCLIP_SKILL_AGENT_ID  谁的 pin 代表"已批准"(默认取 CEO;CEO 的 pin 是权威的那条)
 *   PAPERCLIP_SKILL_KEY       要消费的 company skill key,如 company/<cid>/delivery-methodology
 *   PAPERCLIP_SKILL_CACHE     缓存文件路径(默认 .local-runs/paperclip-skill-cache.json)
 *   PAPERCLIP_SKILL_STAGES    生效 stage,逗号分隔(默认全部 stage)
 *   PAPERCLIP_SKILL_TTL_MS    缓存有效期(默认 300000 = 5min)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** Paperclip 实例默认地址(自建实例默认监听本机 3100) */
export const DEFAULT_PAPERCLIP_API_URL = 'http://127.0.0.1:3100';

/** 缓存文件默认路径(.local-runs/ 在 .gitignore 里,运行期产物不入库) */
export const DEFAULT_PAPERCLIP_SKILL_CACHE = '.local-runs/paperclip-skill-cache.json';

/** 缓存有效期默认 5 分钟 */
export const DEFAULT_PAPERCLIP_SKILL_TTL_MS = 300_000;

/** Paperclip skill key 的形状:company/<companyId>/<slug> */
const SKILL_KEY_RE = /^company\/([0-9a-fA-F-]{36})\/([a-z0-9][a-z0-9-]*)$/;

/** 一份方法论文档最多注入多少字符(跟 skill-context-loader 的 3000 上限一致) */
export const PAPERCLIP_SKILL_MAX_CHARS = 3000;

// ---------------------------------------------------------------------------
// 纯函数:key 解析 / pin 读取 / 文件选择
// ---------------------------------------------------------------------------

/**
 * parsePaperclipSkillKey(key) — "company/<cid>/<slug>" → {companyId, slug}。
 * @param {string} key
 * @returns {{companyId: string, slug: string}|null}
 */
export function parsePaperclipSkillKey(key) {
  const m = SKILL_KEY_RE.exec(String(key ?? '').trim());
  if (!m) return null;
  return { companyId: m[1], slug: m[2] };
}

/**
 * pickPinnedVersionId(snapshot, key) — 从 agent 的 skill 快照里取被 pin 的 versionId。
 *
 * 快照形状:{ desiredSkillEntries: [{key, versionId}], ... }
 * 只有 pin 才算"已批准";没有这条记录就是没有已批准版本。
 *
 * @param {object} snapshot GET /api/agents/:id/skills 的返回
 * @param {string} key      company skill key
 * @returns {string|null}
 */
export function pickPinnedVersionId(snapshot, key) {
  const wanted = String(key ?? '').trim();
  if (!wanted) return null;
  const entries = Array.isArray(snapshot?.desiredSkillEntries) ? snapshot.desiredSkillEntries : [];
  for (const entry of entries) {
    if (String(entry?.key ?? '') === wanted && entry?.versionId) return String(entry.versionId);
  }
  return null;
}

/**
 * pickSkillIdByKey(skillList, key) — 从 company skill 列表里取 skillId。
 *
 * 列表形状:数组或 {items: [...]},元素 {id, key, currentVersionId, ...}
 *
 * @param {any} skillList
 * @param {string} key
 * @returns {string|null}
 */
export function pickSkillIdByKey(skillList, key) {
  const wanted = String(key ?? '').trim();
  if (!wanted) return null;
  const rows = Array.isArray(skillList)
    ? skillList
    : (skillList?.items || skillList?.skills || skillList?.entries || []);
  for (const row of rows) {
    if (String(row?.key ?? '') === wanted && row?.id) return String(row.id);
  }
  return null;
}

/**
 * selectVersionFiles(fileInventory) — 从版本的 fileInventory 里挑出可注入的文件。
 *
 * 只取 SKILL.md 与 references/ 下的文档(其它文件类型对 prompt 没用),
 * 按 path 排序(保证输出字节级稳定)。
 *
 * @param {any} fileInventory
 * @returns {{path: string, content: string}[]}
 */
export function selectVersionFiles(fileInventory) {
  const rows = Array.isArray(fileInventory) ? fileInventory : [];
  const out = [];
  for (const row of rows) {
    const path = String(row?.path ?? '').trim();
    if (!path) continue;
    const isDoc = path === 'SKILL.md' || path.startsWith('references/');
    if (!isDoc) continue;
    if (row?.encoding === 'base64') continue; // 二进制不做注入
    const content = String(row?.content ?? '');
    if (!content) continue;
    out.push({ path, content });
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

/**
 * computeSkillFilesSha256(files) — 文件集的 sha256。
 *
 * 规范化方式:每个文件 "path\0len\0content" 拼起来再 sha256,
 * 这样改文件名或内容都会换 hash(可做 prompt 溯源锚点)。
 *
 * @param {{path: string, content: string}[]} files
 * @returns {string}
 */
export function computeSkillFilesSha256(files) {
  const hash = createHash('sha256');
  for (const file of [...(files ?? [])].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const path = String(file?.path ?? '');
    const content = String(file?.content ?? '');
    hash.update(path);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * buildSkillCache({key, skillId, versionId, files, fetchedAt}) — 组缓存对象。
 * @returns {object}
 */
export function buildSkillCache({ key, skillId, versionId, files, fetchedAt }) {
  const list = selectVersionFiles(files);
  return {
    schema: 1,
    key: String(key ?? ''),
    skillId: String(skillId ?? ''),
    versionId: String(versionId ?? ''),
    sha256: computeSkillFilesSha256(list),
    fetchedAt: String(fetchedAt ?? ''),
    files: list,
  };
}

/**
 * parseSkillCache(raw) — 解析缓存 JSON;结构不对返回 null(不抛)。
 * @param {string} raw
 * @returns {object|null}
 */
export function parseSkillCache(raw) {
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (!data.versionId || !Array.isArray(data.files)) return null;
  return data;
}

/**
 * readSkillCache(cachePath) — 同步读缓存文件(loader 走的就是这条)。
 * @param {string} cachePath
 * @returns {object|null}
 */
export function readSkillCache(cachePath) {
  const path = String(cachePath ?? '');
  if (!path) return null;
  try {
    if (!existsSync(path)) return null;
    return parseSkillCache(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * writeSkillCache(cachePath, cache) — 同步写缓存文件(预取落盘)。
 * @param {string} cachePath
 * @param {object} cache
 * @returns {boolean} 是否写成功
 */
export function writeSkillCache(cachePath, cache) {
  const path = String(cachePath ?? '');
  if (!path || !cache) return false;
  try {
    const dir = dirname(path);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * isSkillCacheFresh(cache, ttlMs, now) — 缓存是否还在有效期内。
 * @param {object|null} cache
 * @param {number} ttlMs
 * @param {number} now epoch ms
 * @returns {boolean}
 */
export function isSkillCacheFresh(cache, ttlMs, now) {
  if (!cache || !cache.fetchedAt) return false;
  const at = Date.parse(cache.fetchedAt);
  if (!Number.isFinite(at)) return false;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false;
  return now - at < ttlMs;
}

// ---------------------------------------------------------------------------
// 纯函数:stage 映射 + 渲染
// ---------------------------------------------------------------------------

/**
 * parseStageList(raw) — "draft,review" → ['draft','review'](空 → null,表示"全部 stage")。
 * @param {string} raw
 * @returns {string[]|null}
 */
export function parseStageList(raw) {
  const list = String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

/**
 * stageUsesPaperclipSkill(cache, stage, stages) — 该 stage 是否吃这份已批准 skill。
 * @param {object|null} cache
 * @param {string} stage
 * @param {string[]|null} stages null = 全部 stage
 * @returns {boolean}
 */
export function stageUsesPaperclipSkill(cache, stage, stages) {
  if (!cache) return false;
  if (!stages) return true;
  return stages.includes(String(stage ?? ''));
}

/**
 * findApprovedFileForStage(cache, fileName) — 找已批准版本里与本地文档同名的文件。
 *
 * 本地文档名形如 "writing-paper.md";已批准版本里的路径形如
 * "references/writing-paper.md" 或 "SKILL.md"。按 basename 匹配。
 *
 * @param {object|null} cache
 * @param {string} fileName
 * @returns {{path: string, content: string}|null}
 */
export function findApprovedFileForStage(cache, fileName) {
  if (!cache || !Array.isArray(cache.files)) return null;
  const wanted = String(fileName ?? '');
  if (!wanted) return null;
  for (const file of cache.files) {
    const path = String(file?.path ?? '');
    const base = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
    if (base === wanted) return { path, content: String(file?.content ?? '') };
  }
  return null;
}

/**
 * truncateSkillText(text, maxChars) — 截断(超长加省略标记)。
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string}
 */
export function truncateSkillText(text, maxChars = PAPERCLIP_SKILL_MAX_CHARS) {
  const content = String(text ?? '');
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n...[truncated]`;
}

/**
 * renderSkillCacheBlock(cache, stage, opts) — 把已批准版本渲染成注入块。
 *
 * 形状:
 *   [方法论上下文 · paperclip skill=<slug> version=<versionId> sha256=<hash>]
 *   <SKILL.md 正文>
 *
 * 只渲染 SKILL.md —— references/ 里与本地同名的那几份由 loader 按 stage 覆盖本地文档。
 *
 * @param {object|null} cache
 * @param {string} stage
 * @param {{stages?: string[]|null, maxChars?: number}} [opts]
 * @returns {string} 空字符串 = 没有可注入内容
 */
export function renderSkillCacheBlock(cache, stage, opts = {}) {
  const stages = opts.stages ?? null;
  if (!stageUsesPaperclipSkill(cache, stage, stages)) return '';
  const files = Array.isArray(cache?.files) ? cache.files : [];
  const skillFile = files.find((f) => String(f?.path ?? '') === 'SKILL.md');
  if (!skillFile) return '';
  const key = parsePaperclipSkillKey(cache.key);
  const slug = key ? key.slug : (cache.key || 'skill');
  const maxChars = opts.maxChars ?? PAPERCLIP_SKILL_MAX_CHARS;
  const header = `[方法论上下文 · paperclip skill=${slug} version=${cache.versionId} sha256=${cache.sha256}]`;
  return `${header}\n${truncateSkillText(skillFile.content, maxChars)}`;
}

// ---------------------------------------------------------------------------
// 预取(唯一有 IO 的部分;fetch 由调用方注入)
// ---------------------------------------------------------------------------

/**
 * prefetchPaperclipSkill({fetchImpl, env, now}) — 拉取"已批准版本"并落缓存。
 *
 * 顺序有讲究:
 *   1. 先读 agent 的 pin —— 决定"哪个版本被批准了"
 *   2. 再读 company skill 列表 —— 拿 skillId
 *   3. 最后读那个版本的文件正文
 *
 * 没有 pin 就直接返回 no-pin:不退回 currentVersionId。
 *
 * @param {{fetchImpl?: Function, env?: object, now?: Date}} [options]
 * @returns {Promise<{status: string, cache: object|null, error: string|null}>}
 *   status ∈ disabled | no-pin | error | ok
 */
export async function prefetchPaperclipSkill(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? new Date();

  const agentId = String(env.PAPERCLIP_SKILL_AGENT_ID ?? '').trim();
  const skillKey = String(env.PAPERCLIP_SKILL_KEY ?? '').trim();
  if (!agentId || !skillKey) {
    return {
      status: 'disabled',
      cache: null,
      error: 'PAPERCLIP_SKILL_AGENT_ID / PAPERCLIP_SKILL_KEY not set',
    };
  }
  if (typeof fetchImpl !== 'function') {
    return { status: 'error', cache: null, error: 'no fetch implementation available' };
  }
  const keyParts = parsePaperclipSkillKey(skillKey);
  if (!keyParts) {
    return { status: 'error', cache: null, error: `malformed PAPERCLIP_SKILL_KEY: ${skillKey}` };
  }

  const apiUrl = String(env.PAPERCLIP_API_URL ?? DEFAULT_PAPERCLIP_API_URL).replace(/\/+$/, '');
  const headers = {};
  const apiKey = String(env.PAPERCLIP_API_KEY ?? '').trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const getJson = async (url) => {
    const response = await fetchImpl(url, { headers });
    if (!response || !response.ok) {
      const status = response ? response.status : 'no-response';
      throw new Error(`GET ${url} -> ${status}`);
    }
    return response.json();
  };

  let snapshot;
  try {
    snapshot = await getJson(`${apiUrl}/api/agents/${agentId}/skills`);
  } catch (err) {
    return { status: 'error', cache: null, error: String(err?.message ?? err) };
  }

  const versionId = pickPinnedVersionId(snapshot, skillKey);
  if (!versionId) {
    return {
      status: 'no-pin',
      cache: null,
      error: `no pinned version for ${skillKey}; the pin is what marks a version approved`,
    };
  }

  let skillList;
  try {
    skillList = await getJson(`${apiUrl}/api/companies/${keyParts.companyId}/skills`);
  } catch (err) {
    return { status: 'error', cache: null, error: String(err?.message ?? err) };
  }
  const skillId = pickSkillIdByKey(skillList, skillKey);
  if (!skillId) {
    return { status: 'error', cache: null, error: `skill not found in company: ${skillKey}` };
  }

  let version;
  try {
    version = await getJson(
      `${apiUrl}/api/companies/${keyParts.companyId}/skills/${skillId}/versions/${versionId}`,
    );
  } catch (err) {
    return { status: 'error', cache: null, error: String(err?.message ?? err) };
  }

  const files = selectVersionFiles(version?.fileInventory);
  if (!files.length) {
    return { status: 'error', cache: null, error: `approved version ${versionId} carries no documents` };
  }

  const cache = buildSkillCache({
    key: skillKey,
    skillId,
    versionId,
    files,
    fetchedAt: now.toISOString(),
  });
  return { status: 'ok', cache, error: null };
}

/**
 * refreshPaperclipSkillCache({fetchImpl, env, now}) — 预取 + 落缓存。
 * 缓存还在有效期内就不打远端(省掉每 stage 一次远端往返)。
 *
 * @param {{fetchImpl?: Function, env?: object, now?: Date}} [options]
 * @returns {Promise<{status: string, cache: object|null, error: string|null}>}
 */
export async function refreshPaperclipSkillCache(options = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const cachePath = String(env.PAPERCLIP_SKILL_CACHE ?? DEFAULT_PAPERCLIP_SKILL_CACHE);
  const ttlMs = Number(env.PAPERCLIP_SKILL_TTL_MS ?? DEFAULT_PAPERCLIP_SKILL_TTL_MS);

  const existing = readSkillCache(cachePath);
  if (isSkillCacheFresh(existing, ttlMs, now.getTime())) {
    return { status: 'ok', cache: existing, error: null, cached: true };
  }

  const result = await prefetchPaperclipSkill(options);
  if (result.status === 'ok' && result.cache) {
    writeSkillCache(cachePath, result.cache);
    return { ...result, cached: false };
  }
  return { ...result, cached: false };
}

/**
 * loadPaperclipSkillCacheFromEnv(env) — 同步读缓存(loader 用的入口)。
 * @param {object} [env]
 * @returns {object|null}
 */
export function loadPaperclipSkillCacheFromEnv(env = process.env) {
  const cachePath = String(env.PAPERCLIP_SKILL_CACHE ?? DEFAULT_PAPERCLIP_SKILL_CACHE);
  return readSkillCache(cachePath);
}

/**
 * paperclipSkillStagesFromEnv(env) — 生效 stage 列表(null = 全部)。
 * @param {object} [env]
 * @returns {string[]|null}
 */
export function paperclipSkillStagesFromEnv(env = process.env) {
  return parseStageList(env.PAPERCLIP_SKILL_STAGES ?? '');
}

/**
 * paperclipSkillCachePath(env) — 缓存文件路径。
 * @param {object} [env]
 * @returns {string}
 */
export function paperclipSkillCachePath(env = process.env) {
  return String(env.PAPERCLIP_SKILL_CACHE ?? DEFAULT_PAPERCLIP_SKILL_CACHE);
}

/**
 * paperclipSkillKeyFromEnv(env) — 要消费的 skill key。
 * @param {object} [env]
 * @returns {string}
 */
export function paperclipSkillKeyFromEnv(env = process.env) {
  return String(env.PAPERCLIP_SKILL_KEY ?? '').trim();
}
