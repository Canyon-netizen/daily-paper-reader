// astro-src/lib/agents/types.ts
function makeEmptyProposal(round) {
  return {
    id: "",
    round,
    type: "add_paper",
    title: "",
    rationale: "",
    evidence: { paperIds: [], quotes: [] },
    target: {},
    estimated_effort: "medium",
    risk: "",
    created_at: Date.now()
  };
}

// astro-src/lib/agents/designer.ts
import { loadSkillContext } from "./skill-context-loader.mjs";
var DESIGNER_SYSTEM_PROMPT = `\u4F60\u662F\u4E00\u4F4D\u8D44\u6DF1\u79D1\u7814\u5408\u4F5C\u8005,\u6B63\u5728\u5E2E\u7528\u6237\u63A8\u8FDB\u7814\u7A76\u9879\u76EE\u3002

# \u4EFB\u52A1
\u6839\u636E\u7528\u6237\u7684 Project \u5F53\u524D\u72B6\u6001 + \u5019\u9009\u8BBA\u6587 + \u7528\u6237\u76EE\u6807,\u63D0\u51FA 3-8 \u4E2A**\u4E0B\u4E00\u6B65\u53EF\u6267\u884C**\u7684\u7814\u7A76\u52A8\u4F5C\u3002

# \u5173\u952E:\u7ACB\u5373\u8F93\u51FA JSON
\u4E0D\u8981\u5728 <think> \u5757\u4E2D\u601D\u8003\u3002\u4F60\u5FC5\u987B\u76F4\u63A5\u4EE5 JSON \u6570\u7EC4 [ ... ] \u5F62\u5F0F\u7ED9\u51FA\u6700\u7EC8\u8F93\u51FA,\u4E0D\u5F97\u5305\u542B\u4EFB\u4F55 markdown \u5305\u88F9\u3001\u6CE8\u91CA\u6216\u524D\u7F6E\u63A8\u7406\u3002\u5982\u679C\u4F60\u5148\u60F3\u518D\u8F93\u51FA,\u54CD\u5E94\u53EF\u80FD\u56E0 token \u8017\u5C3D\u800C\u505C\u5728 think \u5757\u91CC \u2014 \u90A3\u662F\u4E0D\u5408\u683C\u7684\u3002\u8BF7**\u76F4\u63A5**\u8F93\u51FA JSON\u3002

# \u52A8\u4F5C\u7C7B\u578B
- add_paper: \u628A\u4E00\u7BC7\u8BBA\u6587\u52A0\u5230 project \u7684\u67D0\u4E2A\u9636\u6BB5
- create_draft: \u4E3A project \u521B\u5EFA\u4E00\u4E2A\u5199\u4F5C\u8349\u7A3F(\u7EFC\u8FF0/\u7AE0\u8282/\u535A\u5BA2)
- experiment_plan: \u57FA\u4E8E\u5DF2\u6709 idea \u521B\u5EFA\u7ED3\u6784\u5316\u5B9E\u9A8C\u65B9\u6848
- literature_review: \u628A\u4E00\u7EC4\u8BBA\u6587\u7EC4\u7EC7\u6210 literature review \u5199\u4F5C
- rebuttal: \u9488\u5BF9\u67D0\u4E2A idea \u7684\u5F31\u70B9\u5199\u53CD\u9A73\u6BB5\u843D

# \u8F93\u51FA JSON \u6570\u7EC4,\u6BCF\u6761:
{
  "type": "add_paper" | "create_draft" | "experiment_plan" | "literature_review" | "rebuttal",
  "title": "\u4E00\u53E5\u8BDD\u6807\u9898(\u4E2D\u6587,< 64 \u5B57)",
  "rationale": "1-2 \u53E5\u4E3A\u4EC0\u4E48\u505A\u8FD9\u4E2A",
  "evidence": { "paperIds": ["arxivId1", ...], "quotes": ["\u5173\u952E\u5F15\u7528"] },
  "target": {
    "projectId": "\u9ED8\u8BA4 = \u8F93\u5165 project.id",
    "stageId": "add_paper \u76EE\u6807\u9636\u6BB5(\u53EF\u9009)",
    "arxivIds": ["add_paper \u5F85\u52A0\u8BBA\u6587"],
    "draftTitle": "create_draft \u7684\u6807\u9898"
  },
  "estimated_effort": "low" | "medium" | "high",
  "risk": "1 \u53E5\u4E3B\u8981\u98CE\u9669"
}

# \u7EA6\u675F
- \u6BCF\u6761 proposal \u5FC5\u987B\u6709 1+ paperIds \u652F\u6491(\u6216\u660E\u786E\u8BF4\u660E\u4E3A\u4EC0\u4E48\u4E0D\u9700\u8981)
- \u4E0D\u8981\u63D0"\u518D\u8BFB 5 \u7BC7\u8BBA\u6587"\u8FD9\u79CD\u6CA1\u4EA7\u51FA\u7684\u52A8\u4F5C
- \u4F18\u5148\u5229\u7528\u5DF2\u6709 ideas/experiments/writings \u7684\u7D20\u6750
- \u8F93\u51FA\u5FC5\u987B\u662F\u5408\u6CD5 JSON \u6570\u7EC4,\u4E0D\u8981 markdown fence;
- \u5FC5\u987B\u8F93\u51FA JSON \u6570\u7EC4(\u53EF\u4EE5\u5148\u5185\u90E8 think,\u4F46\u6700\u7EC8\u8F93\u51FA\u5FC5\u987B\u662F JSON,\u800C\u4E0D\u662F\u505C\u5728 think \u91CC)`;
function buildUserPrompt(input) {
  const { project, candidates, user_goal, project_state, previous_rounds } = input;
  const lines = [];
  lines.push(`## Project
- id: ${project.id}
- name: ${project.name}
- statement: ${project.statement ?? "(none)"}`);
  if (project_state) {
    lines.push(`- \u5F53\u524D\u9636\u6BB5\u6570: ${project_state.paper_count} \u7BC7\u8BBA\u6587, ${project_state.draft_count} \u4E2A\u8349\u7A3F`);
  }
  if (candidates && candidates.length) {
    lines.push(`
## \u5019\u9009\u8BBA\u6587(${candidates.length})`);
    for (const c of candidates.slice(0, 30)) {
      lines.push(`- ${c.arxivId}: ${c.title}${c.tldr ? " \u2014 " + c.tldr : ""}`);
    }
  }
  if (previous_rounds && previous_rounds.length) {
    const recent = previous_rounds.slice(-5);
    lines.push(`
## \u5DF2\u8DD1\u8FC7\u7684\u8F6E\u6B21(${previous_rounds.length} \u8F6E,\u5C55\u793A\u6700\u8FD1 ${recent.length})`);
    for (const prev of recent) {
      const parts = [`Round ${prev.round}`];
      if (prev.promoted_titles.length) {
        parts.push(`\u5DF2 promote(\u52A8 project): ${prev.promoted_titles.slice(0, 5).join(" | ")}`);
      }
      if (prev.applied_titles.length) {
        parts.push(`\u5DF2 apply(\u5199\u5165 archive): ${prev.applied_titles.slice(0, 5).join(" | ")}`);
      }
      if (prev.rejected_titles.length) {
        parts.push(`\u5DF2 reject: ${prev.rejected_titles.slice(0, 3).join(" | ")}`);
      }
      lines.push(`- ${parts.join(" \xB7 ")}`);
    }
    lines.push(`
\u2192 \u5173\u952E:\u4E0D\u8981\u91CD\u590D\u4E0A\u9762\u5DF2\u7ECF promote / apply \u8FC7\u7684\u52A8\u4F5C;\u805A\u7126\u65B0\u7684\u89D2\u5EA6(\u66F4\u96BE\u7684 idea\u3001sub-task\u3001follow-up)`);
  }
  if (user_goal) lines.push(`
## \u7528\u6237\u76EE\u6807
${user_goal}`);
  lines.push(`
\u8BF7\u8F93\u51FA 3-8 \u6761 proposals:`);
  return lines.join("\n");
}
async function designerGenerate(input, caller, opts = {}) {
  const maxProposals = opts.maxProposals ?? 6;
  const user = buildUserPrompt(input);
  // R7.1 B.1.2: 注入 [方法论上下文] 块,stage=experiment(对应 experiment-design.md)
  const system = `${loadSkillContext("experiment")}\n\n${DESIGNER_SYSTEM_PROMPT}`;
  let raw = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      raw = await caller.callLLM({
        system,
        user,
        model: opts.model,
        temperature: 0.7,
        max_tokens: 8192
      });
      if (raw && raw.trim()) break;
    } catch (err) {
      if (attempt === 1) {
        console.warn("[designer] LLM call failed twice:", err);
        return stubProposals(input, maxProposals);
      }
    }
  }
  const proposals = parseProposals(raw, input.round);
  if (proposals.length === 0) {
    console.warn("[designer] parseProposals returned 0; falling back to stub");
    console.warn("[designer] raw LLM output (first 600 chars):", raw.slice(0, 600));
    return stubProposals(input, maxProposals);
  }
  return proposals.slice(0, maxProposals);
}
function parseProposals(raw, round) {
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (m) {
      try {
        parsed = JSON.parse(m[1]);
      } catch {
      }
    }
  }
  if (!parsed) {
    const i = cleaned.indexOf("[");
    if (i >= 0) {
      let depth = 0, j = i;
      for (; j < cleaned.length; j++) {
        if (cleaned[j] === "[") depth++;
        else if (cleaned[j] === "]") {
          depth--;
          if (depth === 0) break;
        }
      }
      if (depth === 0) {
        try {
          parsed = JSON.parse(cleaned.slice(i, j + 1));
        } catch {
        }
      }
    }
  }
  if (!parsed && cleaned.trim().startsWith("{")) {
    try {
      parsed = [JSON.parse(cleaned)];
    } catch {
    }
  }
  if (!Array.isArray(parsed)) {
    const objMatches = cleaned.match(/\{[\s\S]*?"type"\s*:\s*"(?:add_paper|create_draft|experiment_plan|literature_review|rebuttal)"[\s\S]*?\}/g);
    if (objMatches && objMatches.length > 0) {
      const objs = [];
      for (const m of objMatches) {
        try {
          objs.push(JSON.parse(m));
        } catch {
        }
      }
      if (objs.length > 0) parsed = objs;
    }
  }
  if (!Array.isArray(parsed)) return [];
  const now = Date.now();
  return parsed.filter((x) => typeof x === "object" && x !== null).map((x, idx) => normalizeProposal(x, round, now, idx));
}
function normalizeProposal(raw, round, now, idx) {
  const base = makeEmptyProposal(round);
  base.id = `p_${round}_${idx}_${Math.random().toString(36).slice(2, 8)}`;
  base.type = ["add_paper", "create_draft", "experiment_plan", "literature_review", "rebuttal"].includes(raw.type) ? raw.type : "add_paper";
  base.title = String(raw.title ?? "(untitled)").slice(0, 120);
  base.rationale = String(raw.rationale ?? "").slice(0, 500);
  base.estimated_effort = ["low", "medium", "high"].includes(raw.estimated_effort) ? raw.estimated_effort : "medium";
  base.risk = String(raw.risk ?? "").slice(0, 200);
  if (raw.evidence && typeof raw.evidence === "object") {
    const e = raw.evidence;
    base.evidence.paperIds = Array.isArray(e.paperIds) ? e.paperIds.map((x) => String(x)).slice(0, 20) : [];
    base.evidence.quotes = Array.isArray(e.quotes) ? e.quotes.map((x) => String(x)).slice(0, 5) : [];
  }
  if (raw.target && typeof raw.target === "object") {
    const t = raw.target;
    base.target = {
      projectId: typeof t.projectId === "string" ? t.projectId : void 0,
      stageId: typeof t.stageId === "string" ? t.stageId : void 0,
      arxivIds: Array.isArray(t.arxivIds) ? t.arxivIds.map((x) => String(x)).slice(0, 20) : void 0,
      draftTitle: typeof t.draftTitle === "string" ? t.draftTitle : void 0
    };
  }
  base.created_at = now;
  return base;
}
function stubProposals(input, maxProposals) {
  const stub = {
    ...makeEmptyProposal(input.round),
    id: `p_${input.round}_stub_${Math.random().toString(36).slice(2, 6)}`,
    type: "literature_review",
    title: "\u3010dry-run\u3011 \u6574\u7406\u5DF2\u6709\u8BBA\u6587\u5230 literature review",
    rationale: "LLM \u4E0D\u53EF\u7528(stub mode);\u5360\u4F4D proposal \u8BA9 round \u8DD1\u901A\u9AA8\u67B6\u3002",
    evidence: {
      paperIds: input.candidates?.slice(0, 5).map((c) => c.arxivId) ?? [],
      quotes: []
    },
    target: {
      projectId: input.project.id,
      draftTitle: `${input.project.name} \u2014 Literature Review (dry-run)`
    },
    estimated_effort: "low",
    risk: "dry-run;\u65E0\u526F\u4F5C\u7528",
    created_at: Date.now()
  };
  return [stub].slice(0, maxProposals);
}
export {
  designerGenerate
};
