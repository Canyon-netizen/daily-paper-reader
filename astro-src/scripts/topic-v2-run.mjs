#!/usr/bin/env node
// /scripts/topic-v2-run.mjs — Topic v2 Elo 辩论 **Node CLI** runner。
//
// 这是 "自动化实验思路发掘" 主循环的离线入口:
//   1. 读 archive/<session_id>/debate/idea_*.json(由 topic-search 浏览器侧或
//      Python src/topic_v2.py 生成的 idea sketches)
//   2. Swiss 配对,跑 N 轮辩论(pro/con persona + judge LLM)
//   3. 更新 elo_rating / matches / wins / debate_log
//   4. 把结果写回 idea_*.json(原子写:写 .tmp 后 rename,避免半成品)
//
// 触发方式:
//   - 周日 cron:.github/workflows/topic-v2.yml 每周日 04:00 UTC 跑一次
//   - 手动:workflow_dispatch 输入 session_id 或留空 = 处理所有 sessions
//   - 本地:node astro-src/scripts/topic-v2-run.mjs --session dedup_test --limit 8
//
// 关键设计:
//   - dry-run 模式:无 LLM 调用,judge 永远 tie,persona 写固定占位文本;
//     让 cron 在缺 key 时也能安全跑通并产生 audit log,不浪费 GitHub Actions 分钟。
//   - 共用 lib/elo-debate.mjs(TS 镜像),保证浏览器与 Node 算法一致。
//   - 写回是 *追加式* —— debate_log 只 push,不重置。多次跑会累加 Elo,模拟真实锦标赛。

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ELO_INITIAL,
  runDebateStage,
} from '../lib/elo-debate.mjs';
import {
  evaluatePromotion,
  applyPromotion,
} from '../lib/idea-lifecycle.mjs';

const __DIRNAME = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__DIRNAME, '..', '..');
const ARCHIVE_ROOT = join(REPO_ROOT, 'archive');

// ---------------------------------------------------------------------------
// CLI 参数解析
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    session: null,        // 单 session 模式
    all: false,           // 跑所有 sessions
    limit: 8,             // 最多参与辩论的 idea 数
    rounds: 3,            // 每场辩论轮数
    dryRun: false,        // 无 LLM,judge 全 tie
    maxSessions: Infinity,// all 模式下最多处理几个 session(防止 archive 巨大)
    verbose: false,
    digest: true,         // 是否生成 digest
    digestOnly: false,    // 仅生成 digest,不跑 debate
    thresholdSet: 'default', // 阈值集合(预留)
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--session': args.session = next(); break;
      case '--all': args.all = true; break;
      case '--limit': args.limit = parseInt(next(), 10); break;
      case '--rounds': args.rounds = parseInt(next(), 10); break;
      case '--dry-run': args.dryRun = true; break;
      case '--max-sessions': args.maxSessions = parseInt(next(), 10); break;
      case '--verbose':
      case '-v': args.verbose = true; break;
      case '--no-digest': args.digest = false; break;
      case '--digest-only': args.digestOnly = true; break;
      case '--threshold-set': args.thresholdSet = next(); break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        console.error(`未知参数: ${a}`);
        printHelp();
        process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.log(`用法: node astro-src/scripts/topic-v2-run.mjs [选项]

选项:
  --session <id>      只跑 archive/<id>/debate/ 下的 ideas
  --all               跑 archive/*/debate/ 下所有 sessions(默认 8 个)
  --limit <N>         最多取 elo 最高的 N 个 idea 参与辩论(默认 8)
  --rounds <N>        每场辩论的轮数(默认 3)
  --dry-run           无 LLM 调用,judge 全 tie,适合 CI smoke
  --max-sessions <N>  --all 模式下最多扫几个 session(默认无限)
  --no-digest         跳过 digest 生成
  --digest-only       仅生成 digest,不跑 debate
  --threshold-set <name>  选择阈值集合(default/conservative/aggressive)
  -v, --verbose       打印每场 match 详情
  -h, --help          打印此帮助

环境变量(可选):
  LLM_BASE_URL        OpenAI 兼容 endpoint,缺省走 dry-run
  LLM_API_KEY         bearer token
  LLM_MODEL           模型名
`);
}

// ---------------------------------------------------------------------------
// LLM 客户端(stub + 真 LLM 两态)
// ---------------------------------------------------------------------------

function buildLLM(env) {
  const baseUrl = env.LLM_BASE_URL?.replace(/\/$/, '');
  const apiKey = env.LLM_API_KEY;
  const model = env.LLM_MODEL;

  if (!baseUrl || !apiKey || !model) {
    return {
      mode: 'dry-run',
      reason: 'LLM_BASE_URL/LLM_API_KEY/LLM_MODEL 至少一个缺失 → 强制 dry-run',
    };
  }

  return {
    mode: 'llm',
    async chat(messages, opts = {}) {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: opts.max_tokens ?? 300,
          temperature: opts.temperature ?? 0.7,
        }),
      });
      if (!res.ok) {
        throw new Error(`LLM ${res.status}: ${await res.text()}`);
      }
      const data = await res.json();
      return data?.choices?.[0]?.message?.content || '';
    },
  };
}

// Judge 与 Persona 回调
function buildCallbacks(llm, { dryRun, verbose }) {
  // ---- Judge ----
  const judgeFn = async (a, b) => {
    if (llm.mode === 'dry-run') {
      return { winner: 'tie', reason: 'dry-run judge' };
    }
    const sys = `你是中立裁判。基于两个研究想法的标题、信号来源、证据,只返回 JSON 格式 {\"winner\": \"a\"|\"b\"|\"tie\", \"reason\": \"<50字内>\"}。`;
    const user = `A: ${a.title}\nB: ${b.title}`;
    try {
      const raw = await llm.chat(
        [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        { max_tokens: 200, temperature: 0.3 },
      );
      const txt = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(txt);
      const w = parsed.winner;
      const winner = w === 'a' || w === 'b' ? w : 'tie';
      return { winner, reason: String(parsed.reason || '').slice(0, 100) };
    } catch (err) {
      if (verbose) console.warn(`[judge-fail] ${a.id} vs ${b.id}: ${err.message}`);
      return { winner: 'tie', reason: 'judge failed' };
    }
  };

  // ---- Persona ----
  const personaFn = async (persona, stance, a, b, roundN) => {
    if (llm.mode === 'dry-run') {
      return `${persona}: (dry-run 第 ${roundN} 轮,立场: ${stance.slice(0, 12)}…)`;
    }
    const sys = `你是 ${persona}。${stance} 你善于从特定角度分析研究想法的优劣。`;
    const user = `想法 A: ${a.title}\n想法 B: ${b.title}\n\n请用 3-5 句话,从你的视角比较两者并给出论据(本轮第 ${roundN} 轮)。直接输出,不要前缀。`;
    try {
      const raw = await llm.chat(
        [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        { max_tokens: 300, temperature: 0.7 },
      );
      return String(raw || `${persona}: (LLM 空响应)`);
    } catch (err) {
      return `${persona}: (调用失败: ${String(err.message).slice(0, 50)})`;
    }
  };

  return { judgeFn, personaFn };
}

// ---------------------------------------------------------------------------
// 读 / 写 idea JSON(原子写)
// ---------------------------------------------------------------------------

async function loadIdeas(sessionDir) {
  const dir = join(sessionDir, 'debate');
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    return { ideas: [], error: `无法读取 ${dir}: ${err.message}` };
  }
  const ideas = [];
  for (const name of entries) {
    if (!name.startsWith('idea_') || !name.endsWith('.json')) continue;
    const fp = join(dir, name);
    try {
      const raw = await readFile(fp, 'utf8');
      const obj = JSON.parse(raw);
      if (!obj.id) obj.id = basename(name, '.json').replace(/^idea_/, '');
      if (!obj.title) continue;
      ideas.push(obj);
    } catch (err) {
      console.warn(`[skip] 解析 ${name} 失败: ${err.message}`);
    }
  }
  return { ideas, error: null };
}

async function writeIdeas(sessionDir, ranked) {
  const dir = join(sessionDir, 'debate');
  for (const idea of ranked) {
    const fp = join(dir, `idea_${idea.id}.json`);
    const tmp = `${fp}.tmp`;
    await writeFile(tmp, JSON.stringify(idea, null, 2) + '\n', 'utf8');
    // rename 是原子操作(Node fs.promises.rename 默认覆盖)
    const { rename } = await import('node:fs/promises');
    await rename(tmp, fp);
  }
}

// ---------------------------------------------------------------------------
// Promotion + Digest
// ---------------------------------------------------------------------------

/**
 * 评估并应用 promotion,返回晋升后的 idea 列表。
 */
function processPromotions(ranked) {
  const promoted = [];
  for (const idea of ranked) {
    const decision = evaluatePromotion(idea);
    if (decision) {
      const promotedIdea = applyPromotion(idea, decision);
      promoted.push({ idea: promotedIdea, decision });
      ranked[ranked.indexOf(idea)] = promotedIdea;
    }
  }
  return promoted;
}

/**
 * 生成 digest markdown 文件。
 */
async function writeDigest(sessionDir, sessionId, ranked, matches, mode) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toISOString().slice(0, 19).replace('T', ' ');
  const digestPath = join(sessionDir, 'debate', `digest_${dateStr}.md`);

  // 晋升记录
  const promotedRecords = [];
  for (const idea of ranked) {
    if (idea.depth && idea.depth !== 'sketch' && idea.promoted_at) {
      // 找上次晋升记录(从 debate_log 推断或直接用 promoted_at)
      const prevDepth = idea.depth === 'candidate'
        ? 'sketch'
        : idea.depth === 'under_review'
          ? 'candidate'
          : idea.depth === 'promoted'
            ? 'under_review'
            : 'sketch';
      promotedRecords.push({
        id: idea.id,
        title: idea.title?.slice(0, 60) || idea.id,
        elo: idea.elo_rating ?? 1200,
        wins: idea.wins ?? 0,
        from: prevDepth,
        to: idea.depth,
      });
    }
  }

  // Leaderboard
  const leaderboard = ranked
    .slice(0, 20)
    .map((idea, idx) => ({
      rank: idx + 1,
      id: idea.id,
      title: idea.title?.slice(0, 50) || idea.id,
      elo: Math.round(idea.elo_rating ?? 1200),
      wins: idea.wins ?? 0,
      matches: idea.matches ?? 0,
    }));

  // Top 3 match summaries
  const topMatches = matches
    .filter((m) => !m.failed)
    .slice(0, 3)
    .map((m) => {
      const winnerId = m.winner === 'a' ? m.idea_a : m.winner === 'b' ? m.idea_b : null;
      const winnerIdea = ranked.find((i) => i.id === winnerId);
      const loserId = m.winner === 'a' ? m.idea_b : m.winner === 'b' ? m.idea_a : null;
      const loserIdea = ranked.find((i) => i.id === loserId);
      return {
        winner: winnerIdea?.title?.slice(0, 40) || winnerId || 'tie',
        loser: loserIdea?.title?.slice(0, 40) || loserId || 'tie',
        reason: m.reason?.slice(0, 80) || '',
        excerpt: m.transcript?.[m.transcript.length - 1]?.content?.slice(0, 100) || '',
      };
    });

  // 构建 markdown
  let md = `# Promotion Digest — ${sessionId}\n\n`;
  md += `- **Run**: ${timeStr}\n`;
  md += `- **Mode**: ${mode}\n`;
  md += `- **Total Ideas Matched**: ${ranked.length}\n\n`;

  if (promotedRecords.length > 0) {
    md += `## Promoted Ideas\n\n`;
    md += `| ID | Title | Elo | Wins | Transition |\n`;
    md += `|---|---|---|---|---|\n`;
    for (const p of promotedRecords) {
      md += `| ${p.id.slice(0, 8)} | ${p.title.slice(0, 40)} | ${p.elo} | ${p.wins} | ${p.from} → ${p.to} |\n`;
    }
    md += `\n`;
  } else {
    md += `## Promoted Ideas\n\n_No ideas promoted this run._\n\n`;
  }

  md += `## Leaderboard\n\n`;
  md += `| Rank | ID | Title | Elo | Wins | Matches |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const l of leaderboard) {
    md += `| ${l.rank} | ${l.id.slice(0, 8)} | ${l.title.slice(0, 35)} | ${l.elo} | ${l.wins} | ${l.matches} |\n`;
  }
  md += `\n`;

  if (topMatches.length > 0) {
    md += `## Top Match Summaries\n\n`;
    for (let i = 0; i < topMatches.length; i++) {
      const m = topMatches[i];
      md += `### ${i + 1}. ${m.winner} beat ${m.loser}\n`;
      md += `> ${m.reason}\n\n`;
      if (m.excerpt) {
        md += `\`\`\`\n${m.excerpt}\n\`\`\`\n\n`;
      }
    }
  }

  // 原子写
  const tmp = `${digestPath}.tmp`;
  await writeFile(tmp, md, 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, digestPath);
  console.log(`[digest] wrote ${digestPath}`);
  return digestPath;
}

// ---------------------------------------------------------------------------
// 选择 sessions
// ---------------------------------------------------------------------------

async function pickSessions({ session, all, maxSessions }) {
  if (session) {
    // sessionDir = archive/<id> 父目录,loadIdeas 内部再加 /debate
    return [{ id: session, dir: join(ARCHIVE_ROOT, session) }];
  }
  let entries;
  try {
    entries = await readdir(ARCHIVE_ROOT, { withFileTypes: true });
  } catch (err) {
    console.error(`无法读取 archive 根: ${err.message}`);
    process.exit(1);
  }
  const sessions = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const debateDir = join(ARCHIVE_ROOT, e.name, 'debate');
    try {
      const inner = await readdir(debateDir);
      if (inner.some((n) => n.startsWith('idea_') && n.endsWith('.json'))) {
        sessions.push({ id: e.name, dir: join(ARCHIVE_ROOT, e.name) });
      }
    } catch {
      // 无 debate/ 子目录,跳过
    }
    if (sessions.length >= maxSessions) break;
  }
  return sessions;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function runSession({ sessionId, sessionDir, llm, callbacks, args }) {
  const t0 = Date.now();
  const { ideas, error } = await loadIdeas(sessionDir);
  if (error) {
    console.warn(`[skip] session=${sessionId}: ${error}`);
    return { sessionId, ok: false, reason: error };
  }
  if (ideas.length < 2) {
    console.log(`[skip] session=${sessionId}: ideas < 2 (${ideas.length})`);
    return { sessionId, ok: true, skipped: true, ideas: ideas.length };
  }

  console.log(
    `[run] session=${sessionId} ideas=${ideas.length}` +
      ` mode=${llm.mode} limit=${args.limit} rounds=${args.rounds}`,
  );

  const result = await runDebateStage(ideas, {
    judgeFn: callbacks.judgeFn,
    personaFn: callbacks.personaFn,
    rounds: args.rounds,
    maxIdeas: args.limit,
    onProgress: args.verbose
      ? (m, i, total) => {
          console.log(
            `  [match ${i}/${total}] ${m.idea_a} vs ${m.idea_b}` +
              ` → winner=${m.winner}${m.failed ? ' (failed)' : ''}`,
          );
        }
      : undefined,
  });

  // 把更新后的 idea 写回 archive(debate_log / elo / matches / wins 已就地更新)
  await writeIdeas(sessionDir, result.ranked);

  // 评估并应用 promotion
  const promoted = processPromotions(result.ranked);
  if (promoted.length > 0) {
    // 晋升后的 idea 写回
    await writeIdeas(sessionDir, result.ranked);
    console.log(`[promotion] ${promoted.length} ideas promoted`);
  }

  // 统计
  const promotedWinners = result.ranked.filter((i) => (i.wins ?? 0) >= 1).length;
  const failedMatches = result.matches.filter((m) => m.failed).length;

  // 生成 digest (如果启用)
  let digestPath = null;
  if (args.digest && args.digestOnly === false) {
    try {
      digestPath = await writeDigest(
        sessionDir,
        sessionId,
        result.ranked,
        result.matches,
        llm.mode,
      );
    } catch (err) {
      console.warn(`[digest] 生成失败: ${err.message}`);
    }
  }

  console.log(
    `[done] session=${sessionId} matches=${result.matches.length}` +
      ` failed=${failedMatches}` +
      ` topElo=${Math.round(result.ranked[0]?.elo_rating ?? ELO_INITIAL)}` +
      ` winners=${promotedWinners}` +
      ` promoted=${promoted.length}` +
      ` elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  return {
    sessionId,
    ok: true,
    matched: result.matches.length,
    failed: failedMatches,
    ranked: result.ranked,
    matches: result.matches,
    promoted,
    digestPath,
  };
}

/**
 * Digest-only mode: 仅从现有 JSON 生成 digest,不跑 debate。
 */
async function runDigestOnly({ sessionId, sessionDir, args }) {
  const { ideas, error } = await loadIdeas(sessionDir);
  if (error) {
    console.warn(`[skip] session=${sessionId}: ${error}`);
    return { sessionId, ok: false, reason: error };
  }
  if (ideas.length < 2) {
    console.log(`[skip] session=${sessionId}: ideas < 2 (${ideas.length})`);
    return { sessionId, ok: true, skipped: true };
  }

  // 排序并取 top N
  const ranked = [...ideas]
    .sort((a, b) => (b.elo_rating ?? 1200) - (a.elo_rating ?? 1200))
    .slice(0, args.limit);

  // 生成 digest (空 matches)
  const digestPath = await writeDigest(
    sessionDir,
    sessionId,
    ranked,
    [],
    'digest-only',
  );

  return { sessionId, ok: true, digestPath };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.session && !args.all) {
    console.error('错误:必须指定 --session <id> 或 --all');
    printHelp();
    process.exit(2);
  }

  // Digest-only mode
  if (args.digestOnly) {
    console.log(`[mode] digest-only (从现有 JSON 生成 digest)`);
    const sessions = await pickSessions({
      session: args.session,
      all: args.all,
      maxSessions: args.maxSessions,
    });
    console.log(`[sessions] ${sessions.length} 个待处理`);

    const summaries = [];
    for (const s of sessions) {
      const summary = await runDigestOnly({
        sessionId: s.id,
        sessionDir: s.dir,
        args,
      });
      summaries.push(summary);
    }

    const totalDigests = summaries.filter((s) => s.ok && s.digestPath).length;
    console.log(`\n=== 总览 ===`);
    console.log(`sessions=${summaries.length} digests=${totalDigests}`);
    process.exit(summaries.length === 0 ? 1 : 0);
    return;
  }

  const env = {
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  const llm = args.dryRun ? { mode: 'dry-run' } : buildLLM(env);
  if (llm.mode === 'dry-run') {
    console.log(`[mode] dry-run (${llm.reason || '显式 --dry-run'})`);
  } else {
    console.log(`[mode] llm model=${env.LLM_MODEL}`);
  }
  const callbacks = buildCallbacks(llm, { dryRun: llm.mode === 'dry-run', verbose: args.verbose });

  const sessions = await pickSessions({
    session: args.session,
    all: args.all,
    maxSessions: args.maxSessions,
  });
  console.log(`[sessions] ${sessions.length} 个待跑`);

  const summaries = [];
  for (const s of sessions) {
    const summary = await runSession({
      sessionId: s.id,
      sessionDir: s.dir,
      llm,
      callbacks,
      args,
    });
    summaries.push(summary);
  }

  // 总览
  const totalMatched = summaries.reduce((n, s) => n + (s.matched ?? 0), 0);
  const totalFailed = summaries.reduce((n, s) => n + (s.failed ?? 0), 0);
  const totalPromoted = summaries.reduce(
    (n, s) => n + (s.promoted?.length ?? 0),
    0,
  );
  console.log(`\n=== 总览 ===`);
  console.log(`sessions=${summaries.length} matches=${totalMatched} failed=${totalFailed} promoted=${totalPromoted}`);

  // 退出码:有失败 match 但整体跑完 → 0;完全没跑成 → 1
  process.exit(summaries.length === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});