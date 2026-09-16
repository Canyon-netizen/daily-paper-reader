#!/usr/bin/env node
// astro-src/scripts/events-names.test.mjs
//
// Tests for R7 polish: astro-src/lib/events/names.ts (event name constants).

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
    platform: 'neutral',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/events/names.ts');
const names = mod;

test('DPR_THEME_CHANGE: dpr: 前缀 + 连字符', () => {
  assert.equal(names.DPR_THEME_CHANGE, 'dpr:theme-change');
});

test('DPR_THEME_CHANGE_LEGACY: 旧名连字符兼容', () => {
  assert.equal(names.DPR_THEME_CHANGE_LEGACY, 'dpr-theme-change');
});

test('DPR_TOPIC_FILTER_CHANGE: dpr: 前缀', () => {
  assert.equal(names.DPR_TOPIC_FILTER_CHANGE, 'dpr:topic-filter-change');
});

test('DPR_TOPIC_FILTER_CHANGE_LEGACY', () => {
  assert.equal(names.DPR_TOPIC_FILTER_CHANGE_LEGACY, 'dpr-topic-filter-change');
});

test('DPR_DAILY_DAY_OPENED: dpr: 前缀', () => {
  assert.equal(names.DPR_DAILY_DAY_OPENED, 'dpr:daily-day-opened');
});

test('DPR_DAILY_DAY_OPENED_LEGACY', () => {
  assert.equal(names.DPR_DAILY_DAY_OPENED_LEGACY, 'daily-day-opened');
});

test('PAPER_SELECTION_CHANGE: 沿用旧连字符风格', () => {
  assert.equal(names.PAPER_SELECTION_CHANGE, 'paper-selection-change');
});

test('DPR_USER_LIBRARY_CHANGE: dpr: 前缀', () => {
  assert.equal(names.DPR_USER_LIBRARY_CHANGE, 'dpr:user-library-change');
});

test('DPR_USER_LIBRARY_CHANGE_LEGACY', () => {
  assert.equal(names.DPR_USER_LIBRARY_CHANGE_LEGACY, 'dpr-user-library-change');
});

test('DPR_BULK_SELECTION_CHANGE: dpr: 前缀', () => {
  assert.equal(names.DPR_BULK_SELECTION_CHANGE, 'dpr:bulk-selection-change');
});

test('DPR_BULK_SELECTION_CHANGE_LEGACY', () => {
  assert.equal(names.DPR_BULK_SELECTION_CHANGE_LEGACY, 'dpr-bulk-selection-change');
});

test('DPR_USER_LIBRARIES_CHANGE: dpr: 前缀 (复数 libraries)', () => {
  assert.equal(names.DPR_USER_LIBRARIES_CHANGE, 'dpr:user-libraries-change');
});

test('DPR_PROJECT_STAGE_CHANGE: dpr: 前缀', () => {
  assert.equal(names.DPR_PROJECT_STAGE_CHANGE, 'dpr:project-stage-change');
});

test('DPR_DRAFT_AUTOSAVE: dpr: 前缀', () => {
  assert.equal(names.DPR_DRAFT_AUTOSAVE, 'dpr:draft-autosave');
});

test('DPR_COMPARE_SET_CHANGE: dpr: 前缀', () => {
  assert.equal(names.DPR_COMPARE_SET_CHANGE, 'dpr:compare-set-change');
});

test('DPR_READING_DASHBOARD_DIRTY: dpr: 前缀', () => {
  assert.equal(names.DPR_READING_DASHBOARD_DIRTY, 'dpr:reading-dashboard-dirty');
});

test('DPR_IDEA_BANK_CHANGE: dpr: 前缀', () => {
  assert.equal(names.DPR_IDEA_BANK_CHANGE, 'dpr:idea-bank-change');
});

test('DPR_LIBRARY_FEEDBACK: dpr: 前缀', () => {
  assert.equal(names.DPR_LIBRARY_FEEDBACK, 'dpr:library-feedback');
});

test('所有 dpr: 新名唯一', () => {
  const newNames = [
    names.DPR_THEME_CHANGE,
    names.DPR_TOPIC_FILTER_CHANGE,
    names.DPR_DAILY_DAY_OPENED,
    names.DPR_USER_LIBRARY_CHANGE,
    names.DPR_BULK_SELECTION_CHANGE,
    names.DPR_USER_LIBRARIES_CHANGE,
    names.DPR_PROJECT_STAGE_CHANGE,
    names.DPR_DRAFT_AUTOSAVE,
    names.DPR_COMPARE_SET_CHANGE,
    names.DPR_READING_DASHBOARD_DIRTY,
    names.DPR_IDEA_BANK_CHANGE,
    names.DPR_LIBRARY_FEEDBACK,
  ];
  const set = new Set(newNames);
  assert.equal(set.size, newNames.length);
});

test('所有 dpr: 名字以 "dpr:" 开头', () => {
  const newNames = [
    names.DPR_THEME_CHANGE,
    names.DPR_TOPIC_FILTER_CHANGE,
    names.DPR_DAILY_DAY_OPENED,
    names.DPR_USER_LIBRARY_CHANGE,
    names.DPR_BULK_SELECTION_CHANGE,
    names.DPR_USER_LIBRARIES_CHANGE,
    names.DPR_PROJECT_STAGE_CHANGE,
    names.DPR_DRAFT_AUTOSAVE,
    names.DPR_COMPARE_SET_CHANGE,
    names.DPR_READING_DASHBOARD_DIRTY,
    names.DPR_IDEA_BANK_CHANGE,
    names.DPR_LIBRARY_FEEDBACK,
  ];
  for (const n of newNames) {
    assert.ok(n.startsWith('dpr:'), `${n} should start with dpr:`);
  }
});

test('legacy 别名都不以 dpr: 开头 (兼容旧 listener)', () => {
  const legacyNames = [
    names.DPR_THEME_CHANGE_LEGACY,
    names.DPR_TOPIC_FILTER_CHANGE_LEGACY,
    names.DPR_USER_LIBRARY_CHANGE_LEGACY,
    names.DPR_BULK_SELECTION_CHANGE_LEGACY,
  ];
  for (const n of legacyNames) {
    assert.ok(!n.startsWith('dpr:'), `${n} should NOT start with dpr:`);
  }
});
