// 首页「最近更新」数据源(从 pages/index.astro frontmatter 抽出)。
// 优先用 GitHub Actions 最近一次 conclusion=success 的 run.updated_at
// (成功完成后才会 commit + push,Vercel/Cloudflare 才会重建;失败/进行中不算),
// 失败 / 无 token 时回退到"最新论文 date"。回退值和真实"今天"差几天是
// 正常的(论文 date 早于实际 Pipeline 收尾 + 平台 rebuild 时间),因此
// 每类失败都 build-time console.warn 并把 hint 一并返回,免得线上
// "看似精确却滞后"而无从排查。
import { defaultPaperRepository } from './paper-repository';

export interface LastUpdated {
  /** 展示用日期文案(zh-CN 长日期,或 '等待首次抓取') */
  label: string;
  /** true = 回退到"最新论文 date"口径(UI 需标注 · 数据截止) */
  isFallback: boolean;
  /** 回退原因说明(NO_TOKEN / 401·403 / HTTP 非 2xx / 网络异常);成功时无 */
  hint?: string;
}

// GH_TOKEN 由 astro.config.mjs 顶层从 .env 的 token= 行载入并写到
// process.env.GH_TOKEN。注意读 process.env.GH_TOKEN 而不是
// import.meta.env.GH_TOKEN —— import.meta.env 是 Astro 在启动时冻结的快照,
// 此时 astro.config.mjs 顶层还没跑完;读 process.env 才是当下 Node 进程的
// 真实值(Astro SSR frontmatter 和 Node 进程共享 process.env)。
// 环境变量大小写不敏感查找:某些部署平台 (Cloudflare Pages UI) 会把环境
// 变量名转成小写,这里同时认 'GH_TOKEN' / 'gh_token' / 'Gh_Token'。
// 标准名仍是 GH_TOKEN (README/官方文档统一口径),只在大写找不到时回退
// 扫一遍 process.env。返回值永远是 process.env.GH_TOKEN (标准名) 或 ''。
export function readGhToken(): string {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  for (const [k, v] of Object.entries(process.env)) {
    if (k && k.toUpperCase() === 'GH_TOKEN' && v) {
      process.env.GH_TOKEN = v; // 补回标准名,后续其它读 path 直接拿到
      return v;
    }
  }
  return '';
}

interface FetchResult {
  /** run.updated_at (ISO);null = 失败,走 fallback */
  date: string | null;
  /** 失败原因(供 UI/日志);成功时无 */
  hint?: string;
}

// 拉 GitHub Actions API 找 daily-paper-reader workflow 最近一次
// conclusion=success 的 run,用 run.updated_at 作为口径。
//
// 没 GH token 时:dev 本地 build 也会无 token,跳过 API → 退回"最新论文 date"
// (与原来行为一致,避免 build 报错)。生产环境需要在 Vercel/Cloudflare 配
// GH_TOKEN (PAT, scope: public_repo 或 repo) 作为构建环境变量。
//
// Phase J3:per-build 进程级 Promise 缓存 — 同一个 build 进程内多次调用只 fetch 一次。
let _fetchCache: Promise<FetchResult> | null = null;

async function fetchLastSuccessRunDate(): Promise<FetchResult> {
  if (_fetchCache) return _fetchCache;
  _fetchCache = (async () => {
    return await _doFetchLastSuccessRunDate();
  })();
  return _fetchCache;
}

async function _doFetchLastSuccessRunDate(): Promise<FetchResult> {
  const ghToken = readGhToken();
  const ghRepoOwner = process.env.GH_REPO_OWNER || 'Canyon-netizen';
  const ghRepoName = process.env.GH_REPO_NAME || 'daily-paper-reader';
  const ghWorkflowFile = process.env.GH_WORKFLOW_FILE || 'daily-paper-reader.yml';
  const url = `https://api.github.com/repos/${ghRepoOwner}/${ghRepoName}/actions/workflows/${ghWorkflowFile}/runs?per_page=20&status=success`;
  if (!ghToken) {
    const hint =
      'GH_TOKEN 未配置 — "最近更新"将回退到"最新论文 date",' +
      '与实际 Pipeline 收尾时间可能差几天。在 Pages → Environment variables ' +
      '(Production) 加 GH_TOKEN (PAT, scope Actions: Read-only) 即可修正。';
    console.warn(`[home] ${hint}`);
    return { date: null, hint };
  }
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${ghToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      const reason = res.status === 401 || res.status === 403
        ? 'token 可能过期或 scope 不足 (需要 Actions: Read-only)'
        : `HTTP ${res.status}`;
      const hint = `GitHub Actions API 失败 (${reason}),回退"最新论文 date"。`;
      console.warn(`[home] ${hint}`);
      return { date: null, hint };
    }
    const data = await res.json();
    const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
    // 过滤 conclusion=success,取 updated_at 最新的一条(run 已 completed 时等于完成时间)
    for (const r of runs) {
      if (r && r.conclusion === 'success' && r.updated_at) return { date: r.updated_at };
    }
    const hint = '未找到 conclusion=success 的 Actions run,回退"最新论文 date"。';
    console.warn(`[home] ${hint}`);
    return { date: null, hint };
  } catch (e) {
    const hint = `fetch Actions API 异常 (${(e as Error).message}),回退"最新论文 date"。`;
    console.warn(`[home] ${hint}`);
    return { date: null, hint };
  }
}

// 首页唯一入口:index.astro 只 await 此函数拿 { label, isFallback, hint? }。
export async function getLastUpdatedDate(): Promise<LastUpdated> {
  const { date: runUpdatedAt, hint } = await fetchLastSuccessRunDate();
  const fallbackDate = runUpdatedAt
    ? null
    : (await defaultPaperRepository.list({ sortBy: 'date', limit: 1 }))[0]?.date ?? null;
  const isFallback = !runUpdatedAt && !!fallbackDate;
  const raw = runUpdatedAt ?? fallbackDate;
  const label = raw
    ? new Date(raw).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    : '等待首次抓取';
  return runUpdatedAt ? { label, isFallback } : { label, isFallback, hint };
}
