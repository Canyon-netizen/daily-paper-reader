#!/usr/bin/env node
/**
 * build-archive-manifest.mjs — 扫描 archive/<sid>/rounds/round_*.json,
 * 汇总成 agents-archive-manifest.json 给 /agents/compare/ 用。
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
 *         topAppliedTitles: ["…", "…", "…"]
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
    for (const c of cs) {
      totalScore += c.total;
      totalElo += c.elo;
    }
    applied += (rec.modifier?.applied ?? []).length;
    skipped += (rec.modifier?.skipped ?? []).length;
    if (rec.started_at) firstAt = Math.min(firstAt, rec.started_at);
    if (rec.finished_at) lastAt = Math.max(lastAt, rec.finished_at);

    // 抓 top applied proposal titles(本 round 的)
    const byId = new Map((rec.designer?.proposals ?? []).map((p) => [p.id, p.title]));
    for (const a of rec.modifier?.applied ?? []) {
      if (topTitles.length >= 5) break;
      const title = byId.get(a.proposal_id) ?? a.payload?.title ?? a.proposal_id;
      if (title && !topTitles.includes(title)) topTitles.push(title);
    }
  }

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
  });
}

sessions.sort((a, b) => b.lastAt - a.lastAt);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generated_at: Date.now(),
  sessions,
}, null, 2));

console.log(`[archive-manifest] wrote ${sessions.length} sessions in ${Date.now() - t0}ms`);
