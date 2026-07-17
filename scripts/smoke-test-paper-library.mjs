// Smoke test: shim .smoke-out, then run user-tags + paper-relations in pure Node
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TMP = resolve(ROOT, '.smoke-out');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

console.log('[1/4] tsc compile target files...');
execSync(
  `npx --no-install tsc ` +
  `--target ES2022 --module ES2022 --moduleResolution Bundler ` +
  `--skipLibCheck --esModuleInterop --allowImportingTsExtensions false ` +
  `--rootDir ${ROOT}/astro-src ` +
  `--outDir ${TMP} ` +
  `${ROOT}/astro-src/lib/paper-relations.ts ${ROOT}/astro-src/lib/user-tags.ts ${ROOT}/astro-src/scripts/settings.ts`,
  { stdio: 'inherit', cwd: ROOT }
);

console.log('[2/4] patching .js extensions on relative imports...');
function patch(file) {
  const p = resolve(TMP, file);
  let s = readFileSync(p, 'utf8');
  // ../xxx -> ../xxx.js  (no extension)
  s = s.replace(/from '(\.\.?\/[^']+)';/g, (m, p1) => {
    if (/\.(js|mjs|ts|json)$/.test(p1)) return m;
    return `from '${p1}.js';`;
  });
  // ../xxx -> ../xxx.js (bare import without from)
  s = s.replace(/import\s+\{\s*([^}]+)\s*\}\s*from\s*'(\.\.?\/[^']+)'/g, (m, names, p1) => {
    if (/\.(js|mjs|ts|json)$/.test(p1)) return m;
    return `import { ${names} } from '${p1}.js'`;
  });
  // also dynamic import('...')
  s = s.replace(/import\('(\.\.?\/[^']+)'\)/g, (m, p1) => {
    if (/\.(js|mjs|ts|json)$/.test(p1)) return m;
    return `import('${p1}.js')`;
  });
  // write back
  writeFileSync(p, s);
}
patch('lib/paper-relations.js');
patch('lib/user-tags.js');

console.log('[3/4] running tests...');
const userTags = await import(`file://${TMP}/lib/user-tags.js`);
const relations = await import(`file://${TMP}/lib/paper-relations.js`);

const fakePapers = [
  // 4-dim categories fixtures — task 用 'rl' 与 'reasoning',method 用 'lora' 与 'rlhf',
  // 让 a/b 共享 'task:rl' (Jaccard 期望命中)。
  {
    id: 'a', arxivId: '0001.00001v1', title: 'A', title_zh: '甲', authors: ['x'],
    date: '2026-01-01',
    categories: { venue: [], task: ['rl', 'agent'], method: ['lora'], type: ['empirical'] },
    tldr: 'rl agent', score: 1, source: 's',
  },
  {
    id: 'b', arxivId: '0001.00002v1', title: 'B', title_zh: '乙', authors: ['x'],
    date: '2026-01-02',
    categories: { venue: [], task: ['rl'], method: ['rlhf'], type: ['empirical'] },
    tldr: 'rl method', score: 1, source: 's',
  },
  {
    id: 'c', arxivId: '0001.00003v1', title: 'C', title_zh: '丙', authors: ['y'],
    date: '2026-01-03',
    categories: { venue: [], task: ['reasoning'], method: ['rag'], type: ['benchmark'] },
    tldr: 'reasoning alignment', score: 1, source: 's',
  },
];

// Jaccard
const jEdges = relations.computeJaccardEdges(fakePapers, 0.01);
console.log(`  jaccard edges: ${jEdges.length}`);
console.log(`  edges: ${JSON.stringify(jEdges)}`);
const aB = jEdges.find(e => (e.source === 'a' && e.target === 'b') || (e.source === 'b' && e.target === 'a'));
if (!aB) throw new Error('FAIL: a-b should share task:rl');
if (aB.weight < 0.1) throw new Error(`FAIL: a-b weight too low: ${aB.weight}`);
if (!aB.sharedTags || !aB.sharedTags.includes('task:rl')) throw new Error(`FAIL: sharedTags missing task:rl: ${aB.sharedTags}`);
console.log(`  ✓ a-b jaccard weight = ${aB.weight.toFixed(3)}, sharedTags = ${aB.sharedTags.join(',')}`);

// TF-IDF
const tfEdges = relations.computeTfIdfEdges(fakePapers, 5, 0.0);
console.log(`  tfidf edges: ${tfEdges.length}`);
if (tfEdges.length === 0) throw new Error('FAIL: expected at least one tfidf edge');
console.log(`  ✓ top tfidf weight = ${Math.max(...tfEdges.map(e => e.weight)).toFixed(3)}`);

// user-tags: only run persistence test in browser; in Node localStorage is undefined.
//   Just verify pure helpers work and persistence functions don't throw.
const hasLocalStorage = typeof globalThis.localStorage !== 'undefined';
console.log(`  localStorage present: ${hasLocalStorage}`);

if (hasLocalStorage) {
  userTags.setUserTags('0001.00001v1', null);
  userTags.addTag('0001.00001v1', 'topic', 'cool', '2026-01-01T00:00:00Z');
  userTags.addTag('0001.00001v1', 'topic', 'cool', '2026-01-02T00:00:00Z');
  userTags.addTag('0001.00001v1', 'method', 'rlhf', '2026-01-03T00:00:00Z');
  const got = userTags.getUserTags('0001.00001v1');
  if (got.length !== 2) throw new Error(`FAIL: dedup expected 2, got ${got.length}`);
  console.log(`  ✓ user-tags dedup ok, got ${got.length} tags`);
  userTags.setUserTags('0001.00001v1', null);
} else {
  console.log('  (skipping localStorage roundtrip in Node)');
}

// Pure helpers: always testable
const synthetic = [
  { kind: 'topic', label: 'cool', addedAt: '2026-01-01T00:00:00Z' },
  { kind: 'method', label: 'rlhf', addedAt: '2026-01-03T00:00:00Z' },
];
const flat = userTags.flattenUserTags(synthetic);
if (flat.length !== 2) throw new Error(`FAIL: flatten expected 2, got ${flat.length}`);
const merged = userTags.mergeWithPaperTags(['query:rl'], synthetic);
if (merged.length !== 3) throw new Error(`FAIL: merge expected 3, got ${merged.length}`);
console.log(`  ✓ pure helpers: flatten=${flat.length}, merge=${merged.length}`);

console.log('\n✅ ALL SMOKE TESTS PASSED');
