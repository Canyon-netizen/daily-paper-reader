#!/usr/bin/env node
// astro-src/scripts/idea-similarity.test.mjs
//
// Tests for R7 LP.2 idea-paper similarity.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/ideas/similarity.ts');
const { ideaPaperSimilarity } = mod;

// Mock idea for testing
const mockIdea = {
  id: 'test-idea',
  title: 'Transformer Attention Optimization',
  description: 'Exploring efficient attention mechanisms for large language models',
  status: 'draft',
  relatedPapers: ['2301.00001', '2301.00002'],
  relatedConcepts: ['attention', 'transformer', 'efficiency'],
  tags: ['optimization', 'llm'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// Mock paper with matching keywords
const matchingPaper = {
  arxivId: '2301.00001',
  title: 'Efficient Attention Mechanisms for Transformers',
  abstract: 'We propose a novel efficient attention mechanism that reduces computational cost while maintaining quality.',
  keywords: ['transformer', 'attention', 'efficiency', 'optimization'],
  citedPapers: ['2301.00002', '2301.00003'],
};

// Mock paper without matching keywords
const nonMatchingPaper = {
  arxivId: '2401.99999',
  title: 'Quantum Computing Fundamentals',
  abstract: 'Introduction to quantum computing principles and algorithms.',
  keywords: ['quantum', 'computing', 'entanglement'],
  citedPapers: [],
};

test('ideaPaperSimilarity: high similarity for matching keywords', () => {
  const result = ideaPaperSimilarity(mockIdea, matchingPaper);
  assert.ok(result.score > 0.3, `Expected moderate-high score, got ${result.score}`);
  assert.ok(result.sharedKeywords.length > 0, 'Should have shared keywords');
});

test('ideaPaperSimilarity: low similarity for non-matching paper', () => {
  const result = ideaPaperSimilarity(mockIdea, nonMatchingPaper);
  assert.ok(result.score < 0.3, `Expected low score, got ${result.score}`);
});

test('ideaPaperSimilarity: citation overlap contributes to score', () => {
  const result = ideaPaperSimilarity(mockIdea, matchingPaper);
  assert.ok(result.citationOverlap > 0, 'Should have citation overlap');
  assert.ok(result.sharedCitations.includes('2301.00002'), 'Should share cited paper');
});

test('ideaPaperSimilarity: returns valid score range 0-1', () => {
  const result1 = ideaPaperSimilarity(mockIdea, matchingPaper);
  const result2 = ideaPaperSimilarity(mockIdea, nonMatchingPaper);

  assert.ok(result1.score >= 0 && result1.score <= 1, 'Score should be 0-1');
  assert.ok(result2.score >= 0 && result2.score <= 1, 'Score should be 0-1');
});

test('ideaPaperSimilarity: keyword overlap calculated correctly', () => {
  const result = ideaPaperSimilarity(mockIdea, matchingPaper);
  assert.ok(result.sharedKeywords.includes('transformer'), 'Should have transformer');
  assert.ok(result.sharedKeywords.includes('attention'), 'Should have attention');
});

test('ideaPaperSimilarity: handles missing paper fields', () => {
  const minimalPaper = { arxivId: '0000.00000', title: 'Test' };
  const result = ideaPaperSimilarity(mockIdea, minimalPaper);
  assert.ok(result.score >= 0 && result.score <= 1, 'Should handle missing fields');
});
