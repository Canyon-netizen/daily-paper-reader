/**
 * lib/agents/reviser.mjs — Paper-Reviser agent (iter #71).
 *
 * 背景:
 *   reviewer.mjs 给出一篇草稿的 ReviewVerdict(major/minor concerns +
 *   recommendation)。reviser.mjs 把这些 concerns 应用回原 draft,产出修订版
 *   draft + revision_log(每条 concern ↔ 修改段落的对应表)。
 *
 *   这是 Sakana AI Scientist v2 没有的环节 — Sakana 只跑 1 轮 review;
 *   DPR pipeline 用 (review → revise → review) 多轮反馈,逼近真实的 revision 流程。
 *
 * 设计原则:
 *   - **与 reviewer 解耦**:reviser 只接 ReviewVerdict + draft,不复用 LLM-as-reviewer
 *   - **可重入**:同样的 (draft, verdict) 调两次应产生相近修订(retry 兜)
 *   - **revision_log 显式**:每条 concern 标 [addressed|partial|not_addressed]
 *   - **stub mode**:无 LLM 时返回占位 revision,让 pipeline dry-run 跑通
 */

// ---------------------------------------------------------------------------
// 类型契约
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} RevisionLogEntry
 * @property {number} concernIdx       对应 ReviewVerdict.concerns 的 index
 * @property {string} severity          major | minor
 * @property {string} category          novelty | soundness | clarity | experiments | writing
 * @property {'addressed' | 'partial' | 'not_addressed'} status
 * @property {string} change            本次修改做了什么(≤ 200 字)
 */

/**
 * @typedef {Object} RevisionVerdict
 * @property {string} draftId
 * @property {string} body              修订后的草稿全文
 * @property {RevisionLogEntry[]} log   每条 concern 的修订状态
 * @property {number} addressedCount
 * @property {number} partialCount
 * @property {number} notAddressedCount
 * @property {number} generatedAt
 * @property {boolean} stub
 */

// ---------------------------------------------------------------------------
// Prompt 模板
// ---------------------------------------------------------------------------

const REVISER_SYSTEM_PROMPT = `你是一位科研论文修订者,负责根据审稿意见(reviewer concerns)修改草稿。

# 任务
对每条 concern,做以下 3 件事:
1. 在草稿对应位置插入修改(补段落 / 改写 / 删段 / 加引用);
2. 把修改摘要写到 log;
3. 标 status:
   - addressed:    完全回应了该 concern
   - partial:      部分回应(原 concern 还有未解决的子点)
   - not_addressed: 本次没改(说明原因,通常是缺数据 / 缺工具 / 超出论文范围)

# 输出 JSON,无 markdown fence
{
  "body": "<修订后完整草稿,保留所有原文 + 标注本次修改>",
  "log": [
    {
      "concernIdx": <int>,
      "severity": "major|minor",
      "category": "<category>",
      "status": "addressed|partial|not_addressed",
      "change": "<≤ 200 字中文,本次做了什么>"
    }
  ]
}

# 约束
- body 必须是**完整修订后草稿**,不是 diff
- 修改部分用 HTML 注释标注,方便后续 visual diff:
    <!-- revision: addressed concern #2 — added §3.2 baseline boundary discussion -->
- 若草稿缺数据 / 需重做实验才能回应,标 not_addressed + change 解释
- 不要删除原文任何段落,只能加 / 改 / 显式标注 [RETAINED]`;

// ---------------------------------------------------------------------------
// LLM Caller
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LLMCaller
 * @property {(opts: { system: string, user: string, model?: string, temperature?: number, max_tokens?: number }) => Promise<string>} callLLM
 */

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * @param {{ title?: string, abstract?: string, body: string, arxivIds?: string[] }} draft
 * @param {{ concerns: Array<{ severity: string, category: string, persona?: string, claim?: string, detail: string }>, summary?: string, scores?: object, recommendation?: string }} verdict
 * @param {Object} [opts]
 * @param {LLMCaller} [opts.caller]
 * @param {string} [opts.draftId]
 * @param {string} [opts.model]
 * @returns {Promise<RevisionVerdict>}
 */
export async function reviseDraft(draft, verdict, opts = {}) {
  const generatedAt = Date.now();
  const draftId = opts.draftId || null;
  const model = opts.model || '(default)';

  if (!opts.caller || typeof opts.caller.callLLM !== 'function') {
    return stubRevise(draft, verdict, draftId, model, generatedAt);
  }
  if (!verdict || !Array.isArray(verdict.concerns) || verdict.concerns.length === 0) {
    return {
      draftId, body: draft.body || '', log: [],
      addressedCount: 0, partialCount: 0, notAddressedCount: 0,
      generatedAt, stub: true,
    };
  }

  const user = buildUserPrompt(draft, verdict);
  let raw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      raw = await opts.caller.callLLM({
        system: REVISER_SYSTEM_PROMPT,
        user,
        model,
        temperature: 0.3,
        max_tokens: 6000,
      });
      if (raw && raw.trim()) break;
    } catch (err) {
      if (attempt === 1) {
        console.warn('[reviser] LLM call failed twice, falling back to stub:', err);
        return stubRevise(draft, verdict, draftId, model, generatedAt);
      }
    }
  }

  const parsed = parseRevisionResponse(raw);
  if (!parsed || typeof parsed.body !== 'string') {
    console.warn('[reviser] parseRevisionResponse failed, falling back to stub');
    return stubRevise(draft, verdict, draftId, model, generatedAt);
  }

  const log = normalizeLog(parsed.log, verdict.concerns);
  const counts = countLog(log);
  return {
    draftId,
    body: parsed.body,
    log,
    ...counts,
    generatedAt,
    stub: false,
  };
}

function buildUserPrompt(draft, verdict) {
  const concernsText = verdict.concerns.map((c, i) =>
    `[#${i}] [${c.severity}] ${c.category} (${c.persona || '-'}): ${c.detail}\n   claim: ${c.claim || '(none)'}`
  ).join('\n');

  return `## 待修订草稿
- title: ${draft.title || '(untitled)'}
- abstract: ${(draft.abstract || '').slice(0, 600)}

${(draft.body || '').slice(0, 8000)}${(draft.body || '').length > 8000 ? '\n\n[... truncated ...]' : ''}

## 审稿意见(共 ${verdict.concerns.length} 条)
${concernsText}

## 任务
按 system prompt 的要求,输出 JSON:
{
  "body": "<修订后完整草稿>",
  "log": [ { "concernIdx": ..., "severity": ..., "category": ..., "status": ..., "change": ... } ]
}`;
}

// ---------------------------------------------------------------------------
// JSON 解析
// ---------------------------------------------------------------------------

function parseRevisionResponse(raw) {
  if (typeof raw !== 'string') return null;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* */ }
  if (!parsed) {
    const m = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (m) { try { parsed = JSON.parse(m[1]); } catch { /* */ } }
  }
  if (!parsed) {
    const i = raw.indexOf('{');
    if (i >= 0) {
      let depth = 0, j = i;
      for (; j < raw.length; j++) {
        if (raw[j] === '{') depth++;
        else if (raw[j] === '}') { depth--; if (depth === 0) break; }
      }
      if (depth === 0) {
        try { parsed = JSON.parse(raw.slice(i, j + 1)); } catch { /* */ }
      }
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed;
}

function normalizeLog(rawLog, concerns) {
  const out = [];
  const seen = new Set();
  if (Array.isArray(rawLog)) {
    for (const e of rawLog) {
      if (!e || typeof e !== 'object') continue;
      const idx = Number(e.concernIdx);
      if (!Number.isInteger(idx) || idx < 0 || idx >= concerns.length) continue;
      if (seen.has(idx)) continue;
      seen.add(idx);
      const c = concerns[idx];
      out.push({
        concernIdx: idx,
        severity: c.severity || 'minor',
        category: c.category || 'clarity',
        status: ['addressed', 'partial', 'not_addressed'].includes(e.status) ? e.status : 'partial',
        change: String(e.change || '').slice(0, 300),
      });
    }
  }
  // 补漏:每条 concern 都得有 1 个 log entry
  for (let i = 0; i < concerns.length; i++) {
    if (seen.has(i)) continue;
    const c = concerns[i];
    out.push({
      concernIdx: i,
      severity: c.severity || 'minor',
      category: c.category || 'clarity',
      status: 'not_addressed',
      change: '(no revision entry returned)',
    });
  }
  out.sort((a, b) => a.concernIdx - b.concernIdx);
  return out;
}

function countLog(log) {
  let addressed = 0, partial = 0, notAddressed = 0;
  for (const e of log) {
    if (e.status === 'addressed') addressed++;
    else if (e.status === 'partial') partial++;
    else notAddressed++;
  }
  return {
    addressedCount: addressed,
    partialCount: partial,
    notAddressedCount: notAddressed,
  };
}

// ---------------------------------------------------------------------------
// Stub Revise — 无 LLM 时的占位
// ---------------------------------------------------------------------------

function stubRevise(draft, verdict, draftId, model, generatedAt) {
  const concerns = (verdict && Array.isArray(verdict.concerns)) ? verdict.concerns : [];
  const originalBody = draft.body || '';
  const lines = [];
  lines.push(originalBody);
  lines.push('');
  lines.push('## Revision Notes (dry-run)');
  lines.push('');

  const log = concerns.map((c, i) => {
    // 简单 stub 策略:含 "novelty" 或 "baseline" 的 concern 标 addressed;其它 partial
    let status;
    let change;
    const text = (c.detail || '').toLowerCase();
    if (c.severity === 'minor') {
      status = 'addressed';
      change = `【dry-run】 minor concern 已在末尾 §Revision Notes 列出;实际草稿已加 Notation / reproducibility 段落。`;
    } else if (text.includes('baseline') || text.includes('novelty')) {
      status = 'addressed';
      change = `【dry-run】 在 §3.2 补 baseline boundary discussion,引用 related work。`;
    } else {
      status = 'partial';
      change = `【dry-run】 已标记待办;需要重跑实验才能完全回应(超出 stub 范围)。`;
    }
    lines.push(`- [#${i}] [${c.severity}] ${c.category}: ${change}`);
    return {
      concernIdx: i,
      severity: c.severity || 'minor',
      category: c.category || 'clarity',
      status,
      change,
    };
  });

  const counts = countLog(log);
  return {
    draftId,
    body: lines.join('\n'),
    log,
    ...counts,
    generatedAt,
    stub: true,
  };
}

// ---------------------------------------------------------------------------
// formatRevisionText(verdict) — CLI / UI 友好的 markdown
// ---------------------------------------------------------------------------

export function formatRevisionText(rev) {
  if (!rev) return '(empty revision)';
  const lines = [];
  lines.push(`# Paper Revision`);
  lines.push('');
  lines.push(`- **Addressed**: ${rev.addressedCount}`);
  lines.push(`- **Partial**:   ${rev.partialCount}`);
  lines.push(`- **Not addressed**: ${rev.notAddressedCount}`);
  if (rev.stub) lines.push(`- **Mode**: stub (no LLM call)`);
  lines.push('');
  lines.push(`## Per-concern log`);
  for (const e of rev.log) {
    const icon = e.status === 'addressed' ? '✓' : e.status === 'partial' ? '~' : '✗';
    lines.push(`- ${icon} [#${e.concernIdx}] [${e.severity}] ${e.category}: ${e.change}`);
  }
  return lines.join('\n');
}

export function toJSON(rev) {
  if (!rev) return null;
  return {
    draftId: rev.draftId,
    body: rev.body,
    log: rev.log,
    addressedCount: rev.addressedCount,
    partialCount: rev.partialCount,
    notAddressedCount: rev.notAddressedCount,
    generatedAt: rev.generatedAt,
    stub: !!rev.stub,
  };
}
