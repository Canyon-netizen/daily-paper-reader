/**
 * tests/test_agents_round_detail.mjs — Round detail page 纯逻辑守护。
 *
 * /agents/[sessionId]/[roundId].astro 里有三个纯 helper:
 *   - escapeHtml(s): 防 XSS,所有用户可见字符串都要先转义
 *   - actionTargetHref(a, base): Modifier action → 可点击 URL
 *   - badgeClass(decision): gate verdict → CSS class
 *
 * 这里把它们从 .astro 里拷出来(行为完全镜像),用来守护类型与边界条件。
 *
 * 跑法:node tests/test_agents_round_detail.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 镜像 astro-src/pages/agents/[sessionId]/[roundId].astro 里的 helper
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}

function actionTargetHref(action, base) {
  const p = action.payload || {};
  if (action.kind === 'create_draft_outline' && p.writing_id) {
    return `${base}/writing/${p.writing_id}/`;
  }
  if (action.kind === 'archive_round_summary' && p.experiment_id) {
    return `${base}/experiments/${p.experiment_id}/`;
  }
  if (action.kind === 'add_paper_to_stage' && p.arxivId) {
    return `${base}/papers/${p.arxivId}/`;
  }
  return '';
}

function badgeClass(decision) {
  if (decision === 'promoted') return 'badge badge-high';
  if (decision === 'candidate') return 'badge badge-mid';
  if (decision === 'sketch') return 'badge badge-low';
  return 'badge badge-none';
}

describe('escapeHtml', () => {
  it('escapes & < > " \'', () => {
    assert.equal(escapeHtml('<script>alert("xss")</script>'),
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    assert.equal(escapeHtml("a & b 'c' \"d\""), 'a &amp; b &#39;c&#39; &quot;d&quot;');
  });

  it('handles null/undefined gracefully', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });

  it('passes through plain strings unchanged', () => {
    assert.equal(escapeHtml('hello world'), 'hello world');
    assert.equal(escapeHtml('中文字符'), '中文字符');  // CJK 不会触发转义
  });
});

describe('actionTargetHref', () => {
  const base = '';

  it('create_draft_outline → writing 详情页', () => {
    assert.equal(
      actionTargetHref({ kind: 'create_draft_outline', payload: { writing_id: 'w123' } }, base),
      '/writing/w123/',
    );
  });

  it('archive_round_summary → experiments 详情页', () => {
    assert.equal(
      actionTargetHref({ kind: 'archive_round_summary', payload: { experiment_id: 'e99' } }, base),
      '/experiments/e99/',
    );
  });

  it('add_paper_to_stage → papers 详情页 (camelCase arxivId key)', () => {
    assert.equal(
      actionTargetHref({ kind: 'add_paper_to_stage', payload: { arxivId: '2401.00001' } }, base),
      '/papers/2401.00001/',
    );
  });

  it('returns empty string for unknown kind', () => {
    assert.equal(actionTargetHref({ kind: 'no_op', payload: {} }, base), '');
  });

  it('returns empty string when required payload field is missing', () => {
    assert.equal(
      actionTargetHref({ kind: 'create_draft_outline', payload: {} }, base),
      '',
    );
    assert.equal(
      actionTargetHref({ kind: 'add_paper_to_stage', payload: { arxiv_id: 'bad' } }, base),
      '',  // 注意:key 是 arxivId 不是 arxiv_id
    );
  });

  it('honors custom base', () => {
    assert.equal(
      actionTargetHref({ kind: 'create_draft_outline', payload: { writing_id: 'w1' } }, '/site'),
      '/site/writing/w1/',
    );
  });

  it('does not double-escape payload id (assumes caller already escaped)', () => {
    // HTML escape 由 .astro template 层负责;helper 只做 URL 拼接
    const out = actionTargetHref(
      { kind: 'create_draft_outline', payload: { writing_id: 'a&b' } },
      base,
    );
    assert.equal(out, '/writing/a&b/');
  });
});

describe('badgeClass', () => {
  it('promoted/candidate/sketch/rejected 各自映射到对应 class', () => {
    assert.equal(badgeClass('promoted'), 'badge badge-high');
    assert.equal(badgeClass('candidate'), 'badge badge-mid');
    assert.equal(badgeClass('sketch'), 'badge badge-low');
    assert.equal(badgeClass('rejected'), 'badge badge-none');
  });

  it('unknown decision falls back to badge-none (不崩)', () => {
    assert.equal(badgeClass('???'), 'badge badge-none');
    assert.equal(badgeClass(''), 'badge badge-none');
    assert.equal(badgeClass(null), 'badge badge-none');
    assert.equal(badgeClass(undefined), 'badge badge-none');
  });
});
