#!/usr/bin/env node
// astro-src/scripts/idea-version.test.mjs
//
// Tests for R7 E.1.2 idea versioning.

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

const mod = await loadTs('lib/ideas/version.ts');
const { snapshotIdea, diffVersions } = mod;

// Mock idea for testing
const mockIdea = {
  id: 'test-idea',
  title: 'Test Idea',
  description: 'This is a test idea.\nIt has multiple lines.\nAnd more content.',
  status: 'draft',
  relatedPapers: [],
  relatedConcepts: [],
  tags: [],
  currentVersion: 1,
};

test('snapshotIdea: creates version with incremented version number', () => {
  const snap = snapshotIdea(mockIdea);
  assert.equal(snap.ideaId, 'test-idea');
  assert.equal(snap.version, 2); // currentVersion + 1
  assert.equal(snap.content.title, 'Test Idea');
});

test('snapshotIdea: includes content', () => {
  const snap = snapshotIdea(mockIdea);
  assert.ok(snap.content.description.includes('test idea'));
  assert.equal(snap.content.status, 'draft');
});

test('snapshotIdea: generates sha', () => {
  const snap = snapshotIdea(mockIdea);
  assert.ok(snap.sha);
  assert.equal(snap.sha?.length, 40);
});

test('diffVersions: calculates lines added and removed', () => {
  const v1 = {
    ideaId: 'test',
    version: 1,
    content: { title: 'T', description: 'Line 1\nLine 2\nLine 3', status: 'draft' },
    savedAt: 1000,
  };
  const v2 = {
    ideaId: 'test',
    version: 2,
    content: { title: 'T', description: 'Line 1\nNew Line\nLine 3', status: 'draft' },
    savedAt: 2000,
  };

  const diff = diffVersions(v1, v2);
  assert.equal(diff.linesAdded, 1);
  assert.equal(diff.linesRemoved, 1);
});

test('diffVersions: identical content has similarity 1', () => {
  const v1 = {
    ideaId: 'test',
    version: 1,
    content: { title: 'T', description: 'Same content', status: 'draft' },
    savedAt: 1000,
  };
  const v2 = {
    ideaId: 'test',
    version: 2,
    content: { title: 'T', description: 'Same content', status: 'active' },
    savedAt: 2000,
  };

  const diff = diffVersions(v1, v2);
  assert.equal(diff.similarity, 1);
});

test('diffVersions: completely different content has low similarity', () => {
  const v1 = {
    ideaId: 'test',
    version: 1,
    content: { title: 'T', description: 'One two three', status: 'draft' },
    savedAt: 1000,
  };
  const v2 = {
    ideaId: 'test',
    version: 2,
    content: { title: 'T', description: 'Four five six', status: 'draft' },
    savedAt: 2000,
  };

  const diff = diffVersions(v1, v2);
  assert.ok(diff.similarity < 0.5);
});

test('diffVersions: empty descriptions', () => {
  const v1 = {
    ideaId: 'test',
    version: 1,
    content: { title: 'T', description: '', status: 'draft' },
    savedAt: 1000,
  };
  const v2 = {
    ideaId: 'test',
    version: 2,
    content: { title: 'T', description: 'New content', status: 'draft' },
    savedAt: 2000,
  };

  const diff = diffVersions(v1, v2);
  // Empty string splits to empty array, so linesAdded = 1 (from "New content")
  assert.equal(diff.linesAdded, 1);
  assert.equal(diff.linesRemoved, 0); // empty has no lines to remove after filter
});
