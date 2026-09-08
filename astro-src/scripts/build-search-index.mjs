#!/usr/bin/env node
// astro-src/scripts/build-search-index.mjs
//
// Builds public/search-index.json containing searchable content from all modules.
// Index fields: module, id, title, description, tags, content (for BM25-like search)
//
// Run: node astro-src/scripts/build-search-index.mjs

import { readdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const DOCS_DIR = join(ROOT, 'docs');
const OUT_FILE = join(ROOT, 'public', 'search-index.json');

// Module configurations: directory -> searchable fields mapping
const MODULES = {
  ideas: {
    titleFields: ['title', '概述', 'overview'],
    descFields: ['description', '详细描述', '详细'],
    tagField: '标签',
    contentSection: null, // Uses whole body
  },
  experiments: {
    titleFields: ['title', 'Experiment ID'],
    descFields: ['hypothesis', 'method'],
    tagField: 'tags',
    contentSection: null,
  },
  writing: {
    titleFields: ['title'],
    descFields: ['abstract', '摘要'],
    tagField: 'tags',
    contentSection: null,
  },
  roadmap: {
    titleFields: ['title'],
    descFields: ['goals', 'description'],
    tagField: 'tags',
    contentSection: null,
  },
  papers: {
    titleFields: ['title', 'title_zh'],
    descFields: ['abstract', 'tldr'],
    tagField: 'tags',
    contentSection: null,
  },
};

function readDoc(absPath) {
  try {
    const raw = readFileSync(absPath, 'utf-8');
    return matter(raw);
  } catch {
    return null;
  }
}

function extractField(doc, possibleNames) {
  if (!doc || !doc.data) return '';
  for (const name of possibleNames) {
    const value = doc.data[name];
    if (value) return String(value);
  }
  return '';
}

function extractTags(doc, tagField) {
  if (!doc || !doc.data) return [];
  const tagsValue = doc.data[tagField];
  if (!tagsValue) return [];
  if (Array.isArray(tagsValue)) return tagsValue.map(String);
  if (typeof tagsValue === 'string') {
    return tagsValue.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
}

function getTitleFromContent(content) {
  // Try to get title from first heading (# Title)
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return '';
}

function cleanContent(content) {
  // Remove markdown syntax for search
  return content
    .replace(/^#+\s+/gm, '') // headings
    .replace(/[*_`~\[\]]/g, '') // formatting
    .replace(/\n+/g, ' ') // newlines
    .replace(/\s+/g, ' ')
    .trim();
}

function scanModule(moduleName, config) {
  const modulePath = join(DOCS_DIR, moduleName);
  if (!existsSync(modulePath)) {
    console.log(`[search-index] ${moduleName}/ not found, skipping`);
    return [];
  }

  const files = readdirSync(modulePath, { withFileTypes: true });
  const results = [];

  for (const f of files) {
    if (f.isFile() && f.name.endsWith('.md')) {
      const filePath = join(modulePath, f.name);
      const parsed = readDoc(filePath);

      if (!parsed) continue;

      const id = f.name.replace(/\.md$/, '');
      const title = extractField(parsed, config.titleFields) || getTitleFromContent(parsed.content);
      const description = extractField(parsed, config.descFields);
      const tags = extractTags(parsed, config.tagField);
      const content = cleanContent(parsed.content);

      results.push({
        module: moduleName,
        id,
        title: title || id,
        description: description.substring(0, 300), // Limit description length
        tags,
        content: content.substring(0, 2000), // Limit content for search
        url: `/${moduleName}/${id}`,
      });
    }
  }

  console.log(`[search-index] ${moduleName}: ${results.length} entries`);
  return results;
}

function main() {
  console.log('[search-index] Starting...');

  const allEntries = [];

  for (const [moduleName, config] of Object.entries(MODULES)) {
    const entries = scanModule(moduleName, config);
    allEntries.push(...entries);
  }

  console.log(`[search-index] Total: ${allEntries.length} entries`);

  const index = {
    v: 1,
    generatedAt: new Date().toISOString(),
    modules: Object.keys(MODULES),
    count: allEntries.length,
    entries: allEntries,
  };

  writeFileSync(OUT_FILE, JSON.stringify(index, null, 2), 'utf-8');
  console.log(`[search-index] Written to: ${OUT_FILE}`);
}

main();
