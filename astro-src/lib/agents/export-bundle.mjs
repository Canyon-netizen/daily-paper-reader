/**
 * lib/agents/export-bundle.mjs — shared export bundle builders (iter #59)
 *
 * 单一真相源 for:
 *   - buildExportBundle(input)        纯函数:meta + rounds + syntheses + digest → bundle 对象
 *   - formatExportMarkdown(bundle)    纯函数:bundle → 1 份自包含 markdown 字符串
 *
 * 双 surface 复用:
 *   - astro-src/scripts/agents-run.mjs --export-md  CLI 入口(从 archive/ 读)
 *   - astro-src/pages/agents/[sessionId]/export.astro 浏览器入口(从 localStorage 读)
 *
 * 设计原则:
 *   - 纯函数,无 IO,无 DOM,无 Node/Browser API 依赖
 *   - ESM .mjs 镜像(lib/agents/*.mjs 是 .ts 的 runtime 镜像,见项目 Phase A shim 策略)
 *   - 输出字节级稳定:同一输入 → 字节级同一输出(便于 cross-check 两个 surface)
 *
 * 跑法:node --test tests/test_agents_export_bundle_lib.mjs
 */

export function buildExportBundle(input) {
  const { meta, rounds = [], syntheses = [], digest = null } = input ?? {};
  let proposals = 0, applied = 0;
  for (const r of rounds) {
    proposals += r.designer?.proposals?.length ?? 0;
    applied += r.modifier?.applied?.length ?? 0;
  }
  return {
    sessionId: meta?.session_id ?? '(unknown)',
    generatedAt: new Date().toISOString(),
    meta,
    rounds: rounds.map((r) => ({
      round: r.round,
      started_at: r.started_at,
      finished_at: r.finished_at,
      designer: r.designer,
      feedback: r.feedback,
      gate: r.gate,
      modifier: r.modifier,
    })),
    syntheses,
    digest,
    stats: {
      rounds: rounds.length,
      proposals,
      applied,
      syntheses: syntheses.length,
      hasDigest: typeof digest === 'string' && digest.length > 0,
    },
  };
}

export function formatExportMarkdown(bundle) {
  if (!bundle) return '# Export bundle\n\n(bundle is empty)\n';
  const lines = [];
  const sid = bundle.sessionId ?? '(unknown)';
  const meta = bundle.meta;
  const stats = bundle.stats ?? {};
  const generatedAt = bundle.generatedAt ?? new Date().toISOString();

  lines.push(`# Agents Session Export — ${sid}`);
  lines.push('');
  lines.push(`> Generated ${generatedAt}`);
  lines.push('');
  lines.push(`## 📊 Stats`);
  lines.push(`- rounds: **${stats.rounds ?? 0}**`);
  lines.push(`- proposals: **${stats.proposals ?? 0}**`);
  lines.push(`- modifier applied: **${stats.applied ?? 0}**`);
  lines.push(`- syntheses: **${stats.syntheses ?? 0}**`);
  lines.push(`- has digest: **${stats.hasDigest ? 'yes' : 'no'}**`);
  lines.push('');

  if (meta) {
    lines.push(`## 🎯 Meta`);
    lines.push(`- session_id: \`${meta.session_id ?? sid}\``);
    lines.push(`- goal: ${meta.goal ?? '(none)'}`);
    if (meta.created_at) lines.push(`- created_at: ${new Date(meta.created_at).toISOString()}`);
    if (meta.rounds_requested != null) lines.push(`- rounds_requested: ${meta.rounds_requested}`);
    if (meta.preset) lines.push(`- preset: ${meta.preset}`);
    if (meta.dry_run != null) lines.push(`- dry_run: ${meta.dry_run}`);
    lines.push('');
  }

  const rounds = bundle.rounds ?? [];
  if (rounds.length) {
    lines.push(`## 🔄 Rounds (${rounds.length})`);
    for (const r of rounds) {
      lines.push('');
      lines.push(`### Round ${r.round}`);
      if (r.started_at) lines.push(`- started: ${new Date(r.started_at).toISOString()}`);
      if (r.finished_at) lines.push(`- finished: ${new Date(r.finished_at).toISOString()}`);
      const d = r.designer ?? {};
      lines.push(`- designer: ${(d.proposals ?? []).length} proposals (model: ${d.model ?? '?'})`);
      const f = r.feedback ?? {};
      lines.push(`- feedback: ${(f.critiques ?? []).length} critiques, judge_calls=${f.judge_calls ?? '?'}, tokens=${f.total_tokens ?? '?'}`);
      const g = r.gate ?? {};
      lines.push(`- gate: promoted=${(g.promoted ?? []).length} candidate=${(g.candidate ?? []).length} sketch=${(g.sketch ?? []).length} rejected=${(g.rejected ?? []).length}`);

      const proposals = d.proposals ?? [];
      if (proposals.length) {
        lines.push('');
        lines.push('#### Proposals');
        for (const p of proposals) {
          lines.push(`- **${p.title ?? '(untitled)'}** [${p.type ?? '?'}]`);
          if (p.rationale) lines.push(`  - rationale: ${p.rationale}`);
          if (p.estimated_effort) lines.push(`  - effort: ${p.estimated_effort}`);
          if (p.risk) lines.push(`  - risk: ${p.risk}`);
        }
      }

      const critiques = f.critiques ?? [];
      if (critiques.length) {
        lines.push('');
        lines.push('#### Critiques');
        for (const c of critiques) {
          const total = c.total != null ? c.total.toFixed(1) : '?';
          const elo = c.elo != null ? Math.round(c.elo) : '?';
          lines.push(`- \`${c.proposal_id}\`: total=${total}, elo=${elo}, matches=${c.matches ?? 0}, wins=${c.wins ?? 0}`);
        }
      }

      const promoted = g.promoted ?? [];
      const candidate = g.candidate ?? [];
      if (promoted.length || candidate.length) {
        lines.push('');
        lines.push('#### Gate');
        if (promoted.length) lines.push(`- promoted: ${promoted.join(', ')}`);
        if (candidate.length) lines.push(`- candidate: ${candidate.join(', ')}`);
      }

      const applied = r.modifier?.applied ?? [];
      if (applied.length) {
        lines.push('');
        lines.push('#### Modifier applied');
        for (const a of applied) {
          lines.push(`- ${a.kind ?? '?'} ← \`${a.proposal_id}\``);
        }
      }
    }
    lines.push('');
  }

  const syntheses = bundle.syntheses ?? [];
  if (syntheses.length) {
    lines.push(`## 📝 Syntheses (${syntheses.length})`);
    for (const s of syntheses) {
      lines.push('');
      lines.push(`### Synthesis #${s.idx ?? '?'}`);
      lines.push('');
      lines.push(s.raw ?? '');
    }
    lines.push('');
  }

  if (bundle.digest) {
    lines.push(`## 📋 Digest`);
    lines.push('');
    lines.push(bundle.digest);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Exported by DPR agents export-bundle lib (iter #59)*`);
  return lines.join('\n');
}
