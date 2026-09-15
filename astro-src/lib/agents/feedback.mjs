// astro-src/lib/agents/types.ts
function makeEmptyCritique(proposal_id) {
  return {
    proposal_id,
    scores: { methodologist: 0, engineer: 0, skeptic: 0 },
    total: 0,
    critique: "",
    elo: 1200,
    matches: 0,
    wins: 0,
    persona_attribution: { methodologist: "", engineer: "", skeptic: "" }
  };
}

// astro-src/lib/elo-debate.ts
var ELO_K = 32;
var ELO_INITIAL = 1200;
function expectedScore(a, b) {
  return 1 / (1 + 10 ** ((b - a) / 400));
}
function updateElo(a, b, winner) {
  const ea = expectedScore(a, b);
  const eb = 1 - ea;
  if (winner === "a") return [a + ELO_K * (1 - ea), b - ELO_K * eb];
  if (winner === "b") return [a - ELO_K * ea, b + ELO_K * (1 - eb)];
  return [a, b];
}
function swissPairs(ideas) {
  const ranked = [...ideas].sort(
    (x, y) => (y.elo_rating ?? ELO_INITIAL) - (x.elo_rating ?? ELO_INITIAL)
  );
  const pairs = [];
  for (let k = 0; k + 1 < ranked.length; k += 2) {
    pairs.push([ranked[k], ranked[k + 1]]);
  }
  return pairs;
}

// astro-src/lib/agents/feedback.ts
var PERSONA_PROMPTS = {
  methodologist: `\u4F60\u662F**\u65B9\u6CD5\u8BBA\u8005**,\u5173\u6CE8:
1. \u8FD9\u4E2A\u7814\u7A76 idea \u7684\u5B9E\u9A8C\u8BBE\u8BA1\u80FD\u5426\u8BC1\u4F2A\u5047\u8BBE?
2. \u8BC4\u4F30\u6307\u6807\u662F\u5426\u6807\u51C6\u3001\u53EF\u590D\u73B0?
3. \u662F\u5426\u6709 baseline / \u6D88\u878D / \u5BF9\u7167\u7EC4?
4. \u7406\u8BBA\u8D21\u732E vs \u5DE5\u7A0B\u8D21\u732E \u7684\u8FB9\u754C\u5728\u54EA?

\u8F93\u51FA 1-2 \u6BB5\u9510\u5229\u8BC4\u4EF7 + 0-10 \u5206\u6570(10=\u5FC5\u505A,0=\u7EAF\u566A\u97F3)\u3002
\u4E25\u683C,\u4E0D\u8BA8\u597D\u3002\u5373\u4F7F\u65B9\u6848\u770B\u8D77\u6765 OK,\u4E5F\u8981\u627E\u81F3\u5C11 1 \u4E2A\u65B9\u6CD5\u8BBA\u5F31\u70B9\u3002`,
  engineer: `\u4F60\u662F**\u5DE5\u7A0B\u5E08**,\u5173\u6CE8:
1. \u5B9E\u73B0\u6210\u672C:\u7B97\u529B / \u6570\u636E / \u4EBA\u6708?
2. \u73B0\u6709\u4EE3\u7801 / \u6846\u67B6\u80FD\u5426\u590D\u7528,\u8FD8\u662F\u8981\u4ECE\u96F6\u5199?
3. \u662F\u5426\u6709\u516C\u5F00\u6570\u636E\u96C6 / API \u53EF\u7528?
4. \u5931\u8D25\u7684 fallback \u662F\u4EC0\u4E48?

\u8F93\u51FA 1-2 \u6BB5\u9510\u5229\u8BC4\u4EF7 + 0-10 \u5206\u6570(10=\u7ACB\u523B\u53EF\u505A,0=\u6210\u672C\u7206\u70B8)\u3002
\u805A\u7126"\u505A\u4E0D\u505A\u5F97\u5B8C",\u4E0D\u5728\u4E4E novelty\u3002`,
  skeptic: `\u4F60\u662F**\u6000\u7591\u8BBA\u8005**,\u5173\u6CE8:
1. \u5DF2\u6709\u6587\u732E\u662F\u4E0D\u662F\u5DF2\u7ECF\u505A\u8FC7?novelty \u5728\u54EA?
2. \u5173\u952E\u5047\u8BBE\u662F\u5426\u7AD9\u5F97\u4F4F\u811A?
3. \u7528\u6237\u7ED9\u7684\u8BC1\u636E\u662F\u5426\u771F\u652F\u6301\u7ED3\u8BBA?
4. \u8FD9\u4E2A proposal \u662F\u4E0D\u662F"\u770B\u8D77\u6765\u5F88\u7F8E\u4F46\u5B9E\u9645\u6CA1\u6CD5 publish"?

\u8F93\u51FA 1-2 \u6BB5\u9510\u5229\u8BC4\u4EF7 + 0-10 \u5206\u6570(10=\u660E\u663E novel,0=\u7EAF redundant)\u3002
\u6700\u4E25\u82DB\u7684 persona,\u9ED8\u8BA4\u5E94\u8BE5\u504F\u4F4E\u5206\u3002`
};
var FEEDBACK_USER_PROMPT = (p, idx) => `## Proposal #${idx + 1}
- type: ${p.type}
- title: ${p.title}
- rationale: ${p.rationale}
- evidence.paperIds: ${p.evidence.paperIds.join(", ") || "(none)"}
- evidence.quotes: ${(p.evidence.quotes ?? []).join(" | ") || "(none)"}
- target: ${JSON.stringify(p.target)}
- estimated_effort: ${p.estimated_effort}
- risk: ${p.risk}

## \u4F60\u7684\u4EFB\u52A1
\u4EE5\u4F60\u7684 persona \u89C6\u89D2\u9510\u5229\u8BC4\u4EF7\u8FD9\u4E2A proposal\u3002
\u8F93\u51FA\u683C\u5F0F(JSON,\u65E0 fence):
{
  "score": <0-10 \u6574\u6570>,
  "critique": "<1-2 \u6BB5,\u4E2D\u6587,\u4F60\u7684\u89C6\u89D2,50-200 \u5B57>"
}`;
async function feedbackEvaluate(proposals, _input, caller, opts = {}) {
  if (proposals.length === 0) return [];
  const judgeRounds = opts.judgeRounds ?? 2;
  const rawScores = await scoreAllPersonas(proposals, caller, opts.model);
  const eloMap = await runEloRounds(proposals, rawScores, judgeRounds, caller, opts.model);
  const critiques = [];
  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];
    const scores = rawScores[i];
    const total = (scores.methodologist + scores.engineer + scores.skeptic) / 3;
    const critique = synthesizeCritique(scores);
    const eloState = eloMap.get(p.id) ?? { elo: ELO_INITIAL, matches: 0, wins: 0 };
    critiques.push({
      ...makeEmptyCritique(p.id),
      scores,
      total,
      critique,
      elo: eloState.elo,
      matches: eloState.matches,
      wins: eloState.wins,
      persona_attribution: {
        methodologist: scores._rawCritiques.methodologist,
        engineer: scores._rawCritiques.engineer,
        skeptic: scores._rawCritiques.skeptic
      }
    });
  }
  return critiques;
}
async function scoreAllPersonas(proposals, caller, model) {
  const promises = [];
  for (const p of proposals) {
    promises.push(scoreOneProposal(p, caller, model));
  }
  return Promise.all(promises);
}
async function scoreOneProposal(proposal, caller, model) {
  const personaNames = ["methodologist", "engineer", "skeptic"];
  const results = await Promise.all(
    personaNames.map(async (persona) => {
      try {
        const raw = await caller.callLLM({
          system: PERSONA_PROMPTS[persona],
          user: FEEDBACK_USER_PROMPT(proposal, 0),
          model,
          temperature: 0.4,
          max_tokens: 400
        });
        const parsed = parsePersonaResponse(raw);
        return {
          persona,
          score: clampScore(parsed.score ?? 5),
          critique: parsed.critique ?? "(no critique)"
        };
      } catch (err) {
        console.warn(`[feedback] ${persona} call failed:`, err);
        return { persona, score: 5, critique: "(LLM call failed; default score 5)" };
      }
    })
  );
  return {
    methodologist: results[0].score,
    engineer: results[1].score,
    skeptic: results[2].score,
    _rawCritiques: {
      methodologist: results[0].critique,
      engineer: results[1].critique,
      skeptic: results[2].critique
    }
  };
}
function parsePersonaResponse(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
  }
  if (!parsed) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
      }
    }
  }
  if (!parsed || typeof parsed !== "object") return {};
  const obj = parsed;
  return {
    score: typeof obj.score === "number" ? obj.score : Number(obj.score),
    critique: typeof obj.critique === "string" ? obj.critique : void 0
  };
}
function clampScore(s) {
  if (!Number.isFinite(s)) return 5;
  return Math.max(0, Math.min(10, Math.round(s)));
}
var JUDGE_SYSTEM_PROMPT = `\u4F60\u662F\u79D1\u7814\u9879\u76EE\u7684\u8D44\u6DF1\u8BC4\u5BA1,\u8D1F\u8D23\u5BF9\u6BD4\u4E24\u4E2A research action proposal,\u9009\u51FA"\u66F4\u503C\u5F97\u4E0B\u4E00\u6B65\u6295\u5165"\u7684\u90A3\u4E00\u4E2A\u3002

\u8BC4\u5224\u7EF4\u5EA6(\u540C\u7B49\u6743\u91CD):
1. **Novelty**:\u662F\u5426\u907F\u5F00\u4E86\u5DF2\u6709\u5DE5\u4F5C?\u80FD\u5426\u4EA7\u51FA\u65B0\u6D1E\u5BDF?
2. **Feasibility**:\u5B9E\u73B0\u6210\u672C / \u6570\u636E / \u7B97\u529B / \u65F6\u95F4\u662F\u5426\u5408\u7406?
3. **Evidence**:\u652F\u6301\u8BBA\u6587\u662F\u5426\u624E\u5B9E?\u5F15\u7528\u662F\u5426\u76F8\u5173?
4. **Risk-adjusted value**:\u5373\u4F7F\u6709\u98CE\u9669,\u4EA7\u51FA\u662F\u5426\u503C\u5F97?

\u8F93\u51FA JSON,\u65E0 fence:
{
  "winner": "a" | "b" | "tie",
  "reason": "<\u226480 \u5B57\u4E2D\u6587,\u8BF4\u660E\u4E3A\u4EC0\u4E48 a/b/tie>"
}

\u7EA6\u675F:
- \u4E0D\u8981\u7ED9 5-5 \u5E73\u5206\u503E\u5411;\u5982\u679C\u771F\u7684\u5E73\u624B\u624D\u8F93\u51FA tie
- \u4E25\u7981"\u4E24\u4E2A\u90FD\u597D"\u8FD9\u7C7B\u5E9F\u8BDD;\u5FC5\u987B a / b / tie \u4E09\u9009\u4E00
- reason \u5FC5\u987B\u5177\u4F53(\u6307\u5230 evidence / effort / risk),\u4E0D\u8981\u7A7A\u6CDB\u5F62\u5BB9\u8BCD`;
function buildJudgeUserPrompt(a, b, aScores, bScores) {
  const fmt = (p, s) => `
## Proposal ${p.id === a.id ? "A" : "B"}
- id: ${p.id}
- type: ${p.type}
- title: ${p.title}
- rationale: ${p.rationale}
- evidence.paperIds: ${p.evidence.paperIds.join(", ") || "(none)"}
- estimated_effort: ${p.estimated_effort}
- risk: ${p.risk}
- 3-persona scores: m=${s.methodologist} e=${s.engineer} s=${s.skeptic}`.trim();
  return `${fmt(a, aScores)}

${fmt(b, bScores)}

\u8BF7\u9009 winner (a/b/tie) + 1 \u53E5 reason\u3002`;
}
async function runEloRounds(proposals, rawScores, rounds, caller, model) {
  const state = /* @__PURE__ */ new Map();
  for (const p of proposals) state.set(p.id, { elo: ELO_INITIAL, matches: 0, wins: 0 });
  if (proposals.length < 2) return state;
  const ranked = proposals.map((p, i) => ({ p, score: rawScores[i].methodologist + rawScores[i].engineer + rawScores[i].skeptic })).sort((a, b) => b.score - a.score);
  const proposalById = /* @__PURE__ */ new Map();
  const scoresById = /* @__PURE__ */ new Map();
  for (let i = 0; i < proposals.length; i++) {
    proposalById.set(proposals[i].id, proposals[i]);
    scoresById.set(proposals[i].id, {
      methodologist: rawScores[i].methodologist,
      engineer: rawScores[i].engineer,
      skeptic: rawScores[i].skeptic
    });
  }
  const pairs = swissPairs(ranked.map((r) => ({ id: r.p.id, elo_rating: state.get(r.p.id).elo })));
  for (let round = 0; round < rounds && pairs.length > 0; round++) {
    for (const [a, b] of pairs) {
      const pa = proposalById.get(a.id);
      const pb = proposalById.get(b.id);
      const sa = scoresById.get(a.id);
      const sb = scoresById.get(b.id);
      const verdict = await judgePair(pa, pb, sa, sb, caller, model);
      const stA = state.get(a.id);
      const stB = state.get(b.id);
      const [newA, newB] = updateElo(stA.elo, stB.elo, verdict.winner);
      stA.elo = newA;
      stA.matches++;
      stB.elo = newB;
      stB.matches++;
      if (verdict.winner === "a") stA.wins++;
      else if (verdict.winner === "b") stB.wins++;
    }
  }
  return state;
}
async function judgePair(a, b, aScores, bScores, caller, model) {
  try {
    const raw = await caller.callLLM({
      system: JUDGE_SYSTEM_PROMPT,
      user: buildJudgeUserPrompt(a, b, aScores, bScores),
      model,
      temperature: 0.3,
      max_tokens: 200
    });
    const parsed = parseJudgeResponse(raw);
    if (parsed.winner === "a" || parsed.winner === "b" || parsed.winner === "tie") {
      return { winner: parsed.winner, reason: parsed.reason ?? "", source: "llm" };
    }
    console.warn("[feedback] judgePair parse failed, falling back to Elo:", raw.slice(0, 100));
    return { winner: "tie", reason: "parse-failed \u2192 tie", source: "elo_fallback" };
  } catch (err) {
    console.warn("[feedback] judgePair LLM failed, falling back to Elo:", err instanceof Error ? err.message : err);
    return { winner: "tie", reason: "llm-failed \u2192 tie", source: "elo_fallback" };
  }
}
function parseJudgeResponse(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
  }
  if (!parsed) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
      }
    }
  }
  if (!parsed || typeof parsed !== "object") return {};
  const obj = parsed;
  const w = String(obj.winner ?? "").toLowerCase();
  return {
    winner: w === "a" || w === "b" || w === "tie" ? w : void 0,
    reason: typeof obj.reason === "string" ? obj.reason : void 0
  };
}
function synthesizeCritique(s) {
  const max = Math.max(s.methodologist, s.engineer, s.skeptic);
  const min = Math.min(s.methodologist, s.engineer, s.skeptic);
  if (max - min >= 4) {
    return `persona \u95F4\u5206\u6B67\u663E\u8457(${min}-${max});\u7EFC\u5408\u5747\u503C ${((s.methodologist + s.engineer + s.skeptic) / 3).toFixed(1)}\u3002${max >= 7 ? "\u9AD8\u5206 persona \u89C6\u89D2\u53EF\u6267\u884C;" : ""}${min <= 3 ? "\u4F4E\u5206 persona \u89C6\u89D2\u5F3A\u70C8\u53CD\u5BF9\u3002" : ""}`;
  }
  return `3 persona \u8BC4\u5206\u96C6\u4E2D(${s.methodologist}/${s.engineer}/${s.skeptic}),\u7EFC\u5408 ${((s.methodologist + s.engineer + s.skeptic) / 3).toFixed(1)}\u3002`;
}
function stubFeedback(proposals) {
  return proposals.map((p, i) => ({
    ...makeEmptyCritique(p.id),
    scores: { methodologist: 5, engineer: 5, skeptic: 5 },
    total: 5,
    critique: "(dry-run stub feedback)",
    elo: ELO_INITIAL + i % 3 * 16,
    matches: 0,
    wins: 0,
    persona_attribution: {
      methodologist: "(stub)",
      engineer: "(stub)",
      skeptic: "(stub)"
    }
  }));
}
export {
  feedbackEvaluate,
  stubFeedback
};
