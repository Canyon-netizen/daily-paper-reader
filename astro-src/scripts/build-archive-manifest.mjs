#!/usr/bin/env node
/**
 * build-archive-manifest.mjs — 扫描 archive/<sid>/rounds/round_*.json,
 * 汇总成 agents-archive-manifest.json 给 /agents/compare/ 和 /agents/compare-sessions/ 用。
 *
 * 输出 schema:
 *   {
 *     generated_at: 1736428800000,
 *     sessions: [
 *       {
 *         sid: "20260821",
 *         rounds: 4,
 *         proposals: 24,
 *         critiques: 24,
 *         applied: 12,
 *         skipped: 8,
 *         avgScore: 7.5,
 *         avgElo: 1234,
 *         firstAt: 1736428800000,
 *         lastAt: 1736428805000,
 *         topAppliedTitles: ["…", "…", "…"],
 *         totalDirectives: 12,       // iter #45: 从 syntheses 算出
 *         directiveTrend: [4, 3, 2, 1, 0],   // iter #45: per-cycle directive count
 *         avgScoreTrend: [7.0, 7.5, 8.0, 8.2], // iter #45: per-round avg score
 *         verdict: "收敛中"           // iter #45: 已收敛/收敛中/部分收敛/停滞/起步/无数据
 *       }
 *     ]
 *   }
 *
 * 输出路径:astro-src/data/agents-archive-manifest.json
 * 在 prebuild.mjs 末尾追加调用即可。
 */

import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');         // project root
const ARCHIVE = join(ROOT, 'archive');
const OUT_DIR = join(HERE, '..', 'data');
const OUT = join(OUT_DIR, 'agents-archive-manifest.json');

if (!existsSync(ARCHIVE)) {
  console.warn('[archive-manifest] no archive/ dir; skipping');
  process.exit(0);
}

// iter #45: 复用页面里的 directive 计数逻辑
function countDirectivesInBody(body) {
  let count = 0;
  const sections = body.split(/^##\s+/m);
  for (const sec of sections) {
    if (sec.startsWith('下一步建议') || sec.startsWith('Gap &') || sec.startsWith('Gaps &')) {
      const m = sec.match(/^[-*\s]\s+(?:\[[ x]\]\s+)?.+$/gm);
      if (m) count += m.filter((l) =>
        !/^\s*[-*]\s+\(/.test(l) &&
        !/^\s*[-*]\s+\(无\)/.test(l) &&
        !/^\s*[-*]\s+\(stub/.test(l)
      ).length;
    }
  }
  return count;
}

function judgeVerdict(dirCounts) {
  if (dirCounts.length === 0) return '无数据';
  if (dirCounts.length === 1) return '起步';
  const last = dirCounts[dirCounts.length - 1];
  const first = dirCounts[0];
  if (last === 0) return '已收敛';
  let decreasing = true;
  for (let i = 1; i < dirCounts.length; i++) if (dirCounts[i] > dirCounts[i - 1]) { decreasing = false; break; }
  if (decreasing) return '收敛中';
  if (last < first) return '部分收敛';
  return '停滞';
}

const t0 = Date.now();
const sessions = [];

for (const sid of readdirSync(ARCHIVE)) {
  const sdir = join(ARCHIVE, sid);
  // carryover.json / digest 等文件不算 session
  if (!statSync(sdir).isDirectory()) continue;
  const roundsDir = join(sdir, 'rounds');
  if (!existsSync(roundsDir)) continue;

  const files = readdirSync(roundsDir).filter((f) => /^round_\d+\.json$/.test(f)).sort();
  if (files.length === 0) continue;

  let rounds = 0, proposals = 0, critiques = 0, applied = 0, skipped = 0;
  let totalScore = 0, totalElo = 0;
  let firstAt = Infinity, lastAt = -Infinity;
  const topTitles = [];
  const avgScoreTrend = [];
  const directiveTrend = [];

  for (const f of files) {
    const path = join(roundsDir, f);
    let rec;
    try {
      rec = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    rounds += 1;
    proposals += (rec.designer?.proposals ?? []).length;
    const cs = rec.feedback?.critiques ?? [];
    critiques += cs.length;
    let rs = 0, re = 0;
    for (const c of cs) {
      totalScore += c.total;
      totalElo += c.elo;
      rs += c.total;
      re += c.elo;
    }
    applied += (rec.modifier?.applied ?? []).length;
    skipped += (rec.modifier?.skipped ?? []).length;
    if (rec.started_at) firstAt = Math.min(firstAt, rec.started_at);
    if (rec.finished_at) lastAt = Math.max(lastAt, rec.finished_at);
    avgScoreTrend.push(cs.length ? +(rs / cs.length).toFixed(2) : 0);

    // 抓 top applied proposal titles(本 round 的)
    const byId = new Map((rec.designer?.proposals ?? []).map((p) => [p.id, p.title]));
    for (const a of rec.modifier?.applied ?? []) {
      if (topTitles.length >= 5) break;
      const title = byId.get(a.proposal_id) ?? a.payload?.title ?? a.proposal_id;
      if (title && !topTitles.includes(title)) topTitles.push(title);
    }
  }

  // iter #45: 读 syntheses/, 计算 directiveTrend + totalDirectives + verdict
  let totalDirectives = 0;
  const synthDir = join(sdir, 'synthesis');
  if (existsSync(synthDir)) {
    const sfiles = readdirSync(synthDir).filter((f) => /^synthesis_\d+\.md$/.test(f)).sort();
    for (let i = 0; i < sfiles.length; i++) {
      const f = sfiles[i];
      try {
        const raw = readFileSync(join(synthDir, f), 'utf8');
        const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
        const c = countDirectivesInBody(body);
        directiveTrend[i] = c;
        totalDirectives += c;
      } catch { directiveTrend[i] = 0; }
    }
  }
  const verdict = judgeVerdict(directiveTrend);

  sessions.push({
    sid,
    rounds,
    proposals,
    critiques,
    applied,
    skipped,
    avgScore: critiques ? +(totalScore / critiques).toFixed(2) : 0,
    avgElo: critiques ? Math.round(totalElo / critiques) : 0,
    firstAt: firstAt === Infinity ? 0 : firstAt,
    lastAt: lastAt === -Infinity ? 0 : lastAt,
    topAppliedTitles: topTitles.slice(0, 3),
    totalDirectives,
    directiveTrend,
    avgScoreTrend,
    verdict,
  });
}

sessions.sort((a, b) => b.lastAt - a.lastAt);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generated_at: Date.now(),
  sessions,
}, null, 2));

console.log(`[archive-manifest] wrote ${sessions.length} sessions in ${Date.now() - t0}ms`);
