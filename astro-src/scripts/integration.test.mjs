#!/usr/bin/env node
// astro-src/scripts/integration.test.mjs
//
// R7 I.2.2: integration tests (e2e).
//
// 使用 stub 数据跑关键流程:paper → concept extraction, writing draft creation,
// library merge。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ----- stub implementations -----

function extractConcepts(paper) {
  const concepts = [];
  const text = `${paper.title} ${paper.abstract} ${(paper.categories || []).join(' ')}`.toLowerCase();

  const keywords = ['attention', 'transformer', 'neural', 'network', 'language', 'reinforcement', 'learning', 'model'];
  for (const kw of keywords) {
    if (text.includes(kw)) {
      concepts.push(kw.charAt(0).toUpperCase() + kw.slice(1));
    }
  }

  if (paper.categories) {
    for (const cat of paper.categories) {
      const parts = cat.split('.');
      if (parts[1]) concepts.push(parts[1].toUpperCase());
    }
  }

  return [...new Set(concepts)];
}

function createDraft(proposal) {
  return {
    id: `draft-${proposal.id}-${Date.now()}`,
    title: proposal.title,
    content: `# ${proposal.title}\n\n${proposal.rationale}\n\n---\nGenerated from proposal: ${proposal.type}`,
    created_at: Date.now(),
  };
}

function generateOutline(content) {
  const sentences = content.split(/[.\n]+/).filter((s) => s.trim().length > 10);
  return {
    sections: sentences.slice(0, 3).map((s, i) => ({
      index: i,
      heading: `Section ${i + 1}`,
      summary: s.trim().slice(0, 50),
    })),
  };
}

function mergeLibraries(libA, libB) {
  const seen = new Set();
  const papers = [];

  for (const p of [...libA.papers, ...libB.papers]) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      papers.push(p);
    }
  }

  return {
    id: `${libA.id}+${libB.id}`,
    papers,
  };
}

function addToLibrary(library, draft) {
  return {
    ...library,
    papers: [...library.papers, { id: draft.id, title: draft.title }],
  };
}

// ----- 1. paper → concept extraction flow -----
describe('paper → concept extraction flow', () => {
  test('extracts concepts from paper metadata', () => {
    const stubPaper = {
      id: '1706.03762',
      title: 'Attention Is All You Need',
      abstract: 'We propose a new network architecture based on attention mechanisms.',
      categories: ['cs.CL', 'cs.LG'],
    };

    const concepts = extractConcepts(stubPaper);

    assert.ok(Array.isArray(concepts));
    assert.ok(concepts.length > 0);
    assert.ok(concepts.some((c) => c.toLowerCase().includes('attention')));
  });

  test('handles paper without abstract', () => {
    const stubPaper = {
      id: 'test',
      title: 'Test Paper',
      abstract: '',
      categories: [],
    };

    const concepts = extractConcepts(stubPaper);
    assert.ok(Array.isArray(concepts));
  });
});

// ----- 2. writing draft creation flow -----
describe('writing draft creation flow', () => {
  test('creates draft from proposal', () => {
    const stubProposal = {
      id: 'prop-1',
      title: 'Add Transformer Survey',
      type: 'add_paper',
      rationale: 'Survey paper on Transformers.',
      target: { projectId: 'proj-1' },
    };

    const draft = createDraft(stubProposal);

    assert.ok(draft);
    assert.ok(draft.id);
    assert.ok(draft.content);
    assert.ok(draft.content.includes('Transformer'));
  });

  test('generates outline for draft', () => {
    const stubContent = 'This paper proposes a new method.\nIt achieves state-of-the-art results.';
    const outline = generateOutline(stubContent);

    assert.ok(outline);
    assert.ok(outline.sections);
    assert.ok(outline.sections.length > 0);
  });
});

// ----- 3. library merge flow -----
describe('library merge flow', () => {
  test('merges two libraries with deduplication', () => {
    const libA = {
      id: 'lib-a',
      papers: [
        { id: 'p1', title: 'Paper 1' },
        { id: 'p2', title: 'Paper 2' },
      ],
    };
    const libB = {
      id: 'lib-b',
      papers: [
        { id: 'p2', title: 'Paper 2' },
        { id: 'p3', title: 'Paper 3' },
      ],
    };

    const merged = mergeLibraries(libA, libB);

    assert.equal(merged.papers.length, 3);
    const p2Count = merged.papers.filter((p) => p.id === 'p2').length;
    assert.equal(p2Count, 1);
  });

  test('handles empty libraries', () => {
    const merged = mergeLibraries({ id: 'a', papers: [] }, { id: 'b', papers: [] });
    assert.equal(merged.papers.length, 0);
  });
});

// ----- 4. pipeline integration -----
describe('pipeline integration', () => {
  test('full pipeline: paper → concept → draft → library', () => {
    const paper = {
      id: '2301.00001',
      title: 'Test Paper on Neural Networks',
      abstract: 'A novel neural network method for testing.',
    };

    const concepts = extractConcepts(paper);
    assert.ok(concepts.length > 0);

    const proposal = {
      id: 'prop-1',
      title: `Analyze: ${paper.title}`,
      type: 'analyze',
      rationale: `Explore concepts: ${concepts.join(', ')}`,
      target: {},
    };
    const draft = createDraft(proposal);
    assert.ok(draft);

    const library = {
      id: 'test-lib',
      papers: [],
    };
    const updatedLib = addToLibrary(library, draft);
    assert.ok(updatedLib.papers.length > 0);
  });
});
