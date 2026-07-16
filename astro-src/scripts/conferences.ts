// /conferences/ 页面客户端逻辑 — GitHub Actions workflow 触发 + 状态轮询。
//
// 从 astro-src/pages/conferences/index.astro 抽出来,作为可单元测试的模块。
// 修复 P0-3 (pollRun 401/403 处理缺失导致 10 分钟 stall)。
//
// 调用方式:
//   import { triggerConf, WORKFLOW_FILE, REF } from '../../scripts/conferences';
//
// 错误信息策略:
//   - dispatch 401: 'GitHub Token 无效或过期(需 repo + workflow scope)'
//   - dispatch 403 + Retry-After: 'GitHub API 限流,需等 <N>s 后重试 (Retry-After: <N>)'
//   - dispatch 403 + 无 Retry-After: 'GitHub 拒绝触发(检查 token 是否有 workflow 权限,或 Actions 是否已启用)'
//   - dispatch 其它: 'GitHub API <status>: <body前200字符>'
//
// 轮询策略:
//   - 第一次找 run:最多 25 次 × 2s ≈ 50s
//   - 状态轮询:最多 300 次 × 2s ≈ 10min
//   - 任何一次状态轮询 401/403:立即更新卡片 + return,避免 UI 持续 10 分钟 "运行中"
//
// 数据契约 (与 test_p03_conferences_poll.py 对齐):
//   pollRun 函数体必须包含 "401" / "403" / "} else {"

export interface GhRun {
  id: number;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | ...
  html_url: string;
  created_at: string;
  display_title?: string;
}

export type CardState = 'idle' | 'running' | 'success' | 'failure';

export const WORKFLOW_FILE = 'conference-init.yml';
export const REF = 'main';

export function authHeaders(token: string) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Update the conference card status. Side-effect: writes to DOM via
 * document.querySelector — preserved from the original .astro <script>.
 */
export function setCardStatus(conf: string, state: CardState, html: string): void {
  const el = document.querySelector(`[data-conf-status="${conf}"]`);
  if (!el) return;
  el.className = `conf-card-status is-${state}`;
  el.innerHTML = `<span class="conf-status-label">${html}</span>`;
}

/**
 * Parse Retry-After header — GitHub returns either an integer (seconds)
 * or an HTTP-date. We only support the integer form; non-integer falls
 * back to 60s conservative default.
 */
function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

// -------- 触发 workflow_dispatch --------
export async function dispatchWorkflow(
  owner: string,
  repo: string,
  token: string,
  inputs: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: REF, inputs }),
  });
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  if (res.status === 404) {
    throw new Error(
      `Workflow 未找到: 确认 ${owner}/${repo} 存在,且 ${WORKFLOW_FILE} 已合并到 ${REF} 分支的 .github/workflows/ 下`,
    );
  }
  if (res.status === 401) {
    throw new Error('GitHub Token 无效或过期(需 repo + workflow scope)');
  }
  if (res.status === 403) {
    // 区分 rate limit vs scope missing: rate limit 响应带 Retry-After / X-RateLimit-Remaining: 0
    const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
    if (retryAfter !== null) {
      throw new Error(`GitHub API 限流,需等 ${retryAfter}s 后重试 (Retry-After: ${retryAfter})`);
    }
    throw new Error('GitHub 拒绝触发(检查 token 是否有 workflow 权限,或 Actions 是否已启用)');
  }
  if (res.status === 422) {
    throw new Error(`inputs 校验失败: ${body.slice(0, 200)}`);
  }
  throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
}

// 找到本次 dispatch 触发的 run:取 created_at 晚于触发时刻的最新一条。
// 注意:绝不能用 runs[0] 做兜底 — 老 run 也命中 latest,会让前端一直误报
// 「刚才触发的就是它」,而无视新 dispatch 实际有没有排上队。
export async function findRun(
  owner: string,
  repo: string,
  token: string,
  since: number,
  fetchImpl: typeof fetch = fetch,
): Promise<GhRun | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=5`;
  const res = await fetchImpl(url, { headers: authHeaders(token) });
  if (!res.ok) return null;
  const data = await res.json();
  const runs: GhRun[] = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
  const margin = since - 10_000; // GitHub 时钟/延迟容差
  return runs.find((r) => new Date(r.created_at).getTime() >= margin) ?? null;
}

// 轮询直到 completed,更新每张卡片状态。
// 401/403 立即 bail — 不要再 spin 10 分钟。
export async function pollRun(
  owner: string,
  repo: string,
  token: string,
  since: number,
  confList: string[],
  options: {
    fetchImpl?: typeof fetch;
    sleepImpl?: (ms: number) => Promise<void>;
    setCardStatusImpl?: (conf: string, state: CardState, html: string) => void;
  } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl =
    options.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const setCard = options.setCardStatusImpl ?? setCardStatus;

  let run: GhRun | null = null;
  // 先等 run 排上队(最多 ~50s)
  for (let i = 0; i < 25; i++) {
    run = await findRun(owner, repo, token, since, fetchImpl);
    if (run) break;
    await sleepImpl(2000);
  }
  if (!run) {
    for (const c of confList) {
      setCard(c, 'failure', '✗ 50s 内未排上队,稍后到 GitHub Actions 查看');
    }
    return;
  }
  const runUrl = run.html_url;
  const link = (text: string) => `<a href="${runUrl}" target="_blank" rel="noopener">${text}</a>`;

  // 轮询状态(最多 ~10min)
  for (let i = 0; i < 300; i++) {
    const res = await fetchImpl(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}`,
      { headers: authHeaders(token) },
    );
    if (res.ok) {
      const info: GhRun = await res.json();
      if (info.status === 'completed') {
        const ok = info.conclusion === 'success';
        for (const c of confList) {
          setCard(c, ok ? 'success' : 'failure', ok ? link('✓ 成功') : link(`✗ ${info.conclusion || '失败'}`));
        }
        return;
      }
      for (const c of confList) {
        setCard(c, 'running', link(`运行中 (${info.status})…`));
      }
    } else if (res.status === 401) {
      for (const c of confList) {
        setCard(c, 'failure', link('✗ Token 已过期或失效,请到 /settings/ 重新填'));
      }
      return;
    } else if (res.status === 403) {
      const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
      const msg = retryAfter !== null
        ? link(`✗ GitHub API 限流,需等 ${retryAfter}s (Retry-After: ${retryAfter})`)
        : link('✗ GitHub API 拒绝 (403),见 run 详情');
      for (const c of confList) {
        setCard(c, 'failure', msg);
      }
      return;
    } else {
      // 其它 4xx/5xx:也尽快 bail,避免用户看到 10 分钟的"运行中"
      for (const c of confList) {
        setCard(c, 'failure', link(`✗ GitHub API ${res.status},见 run 详情`));
      }
      return;
    }
    await sleepImpl(2000);
  }
  for (const c of confList) {
    setCard(c, 'running', link('运行超时未结束,点此查看'));
  }
}

// -------- 事件入口 --------
export async function triggerConf(
  confList: string[],
  deps: {
    loadGitHubToken: () => string;
    loadGitHubRepo: () => { owner: string; repo: string };
    yearEnd: number;
    yearCount: number;
    skipFetch: boolean;
    fetchImpl?: typeof fetch;
    sleepImpl?: (ms: number) => Promise<void>;
    setCardStatusImpl?: (conf: string, state: CardState, html: string) => void;
  },
): Promise<void> {
  const token = deps.loadGitHubToken();
  if (!token) {
    for (const c of confList) {
      (deps.setCardStatusImpl ?? setCardStatus)(
        c,
        'failure',
        '✗ 未配置 GitHub PAT,请到设置页填(需 repo + workflow 权限)',
      );
    }
    return;
  }
  const { owner, repo } = deps.loadGitHubRepo();
  const inputs: Record<string, string> = {
    conferences: confList.join(','),
    year_end: String(deps.yearEnd),
    year_count: String(deps.yearCount),
    skip_fetch: deps.skipFetch ? 'true' : 'false',
  };

  for (const c of confList) {
    (deps.setCardStatusImpl ?? setCardStatus)(c, 'running', '调度中…');
  }
  const since = Date.now();
  try {
    await dispatchWorkflow(owner, repo, token, inputs, deps.fetchImpl);
  } catch (e) {
    for (const c of confList) {
      (deps.setCardStatusImpl ?? setCardStatus)(
        c,
        'failure',
        `✗ 调度失败: ${(e as Error).message}`,
      );
    }
    return;
  }
  for (const c of confList) {
    (deps.setCardStatusImpl ?? setCardStatus)(c, 'running', '已触发,等待排队…');
  }
  await pollRun(owner, repo, token, since, confList, {
    fetchImpl: deps.fetchImpl,
    sleepImpl: deps.sleepImpl,
    setCardStatusImpl: deps.setCardStatusImpl,
  });
}