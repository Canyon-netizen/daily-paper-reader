// Real-data sanity: pull 50 papers, compute Jaccard edges
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TMP = resolve(ROOT, '.smoke-out');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

execSync(
  `npx --no-install tsc ` +
  `--target ES2022 --module ES2022 --moduleResolution Bundler ` +
  `--skipLibCheck --esModuleInterop ` +
  `--rootDir ${ROOT}/astro-src ` +
  `--outDir ${TMP} ` +
  `${ROOT}/astro-src/lib/paper-relations.ts ${ROOT}/astro-src/lib/user-tags.ts ${ROOT}/astro-src/scripts/settings.ts`,
  { stdio: 'inherit', cwd: ROOT }
);

function patch(file) {
  const p = resolve(TMP, file);
  let s = readFileSync(p, 'utf8');
  s = s.replace(/from '(\.\.?\/[^']+)';/g, (m, p1) =>
    /\.(js|mjs|ts|json)$/.test(p1) ? m : `from '${p1}.js';`);
  s = s.replace(/import\('(\.\.?\/[^']+)'\)/g, (m, p1) =>
    /\.(js|mjs|ts|json)$/.test(p1) ? m : `import('${p1}.js')`);
  writeFileSync(p, s);
}
patch('lib/paper-relations.js');
patch('lib/user-tags.js');

const relations = await import(`file://${TMP}/lib/paper-relations.js`);

// 简单解析 docs/papers/<YYYY>/<MM>/*.md 的 frontmatter(用 gray-matter 库)。
// docs/papers/ 现在按年月子目录分桶,要递归收。
const matter = (await import('gray-matter')).default;
const { readdirSync, statSync } = await import('node:fs');
const dir = resolve(ROOT, 'docs/papers');

/** 递归收 docs/papers/ 下所有 .md,相对 dir 的路径用 forward slash 当 id。 */
function walkMd(d) {
  const out = [];
  for (const name of readdirSync(d)) {
    const full = resolve(d, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkMd(full));
    else if (st.isFile() && name.endsWith('.md')) out.push(full);
  }
  return out;
}
const allFiles = walkMd(dir);
const files = allFiles.slice(0, 80);
const papers = [];
for (const f of files) {
  const content = readFileSync(f, 'utf8');
  try {
    const m = matter(content);
    // id = `papers/<YYYY>/<MM>/<basename>`,跟 Astro listAllPaperIds() 同步
    const rel = f.slice(dir.length + 1).replace(/\\/g, '/').replace(/\.md$/, '');
    const id = `papers/${rel}`;
    papers.push({
      id,
      arxivId: m.data.arxivId || id,
      title: m.data.title || '',
      title_zh: m.data.title_zh || '',
      authors: m.data.authors || [],
      date: m.data.date ? new Date(m.data.date).toISOString().slice(0, 10) : '',
      tags: m.data.tags || [],
      // 4-dim categories:paper.ts 默认空 4-dim,后续 Jaccard 走 flattenCategories。
      // B7 迁移让 docs/papers 实际大多数都有 categories: 行;空时 fallback 用 []。
      categories: m.data.categories && typeof m.data.categories === 'object'
        ? {
            venue: Array.isArray(m.data.categories.venue) ? m.data.categories.venue : [],
            task: Array.isArray(m.data.categories.task) ? m.data.categories.task : [],
            method: Array.isArray(m.data.categories.method) ? m.data.categories.method : [],
            type: Array.isArray(m.data.categories.type) ? m.data.categories.type : [],
          }
        : { venue: [], task: [], method: [], type: [] },
      tldr: m.data.tldr || '',
      score: m.data.score || 0,
      source: m.data.source || '',
    });
  } catch (e) {
    // skip broken
  }
}
console.log(`loaded ${papers.length} real papers`);

const t0 = Date.now();
const edges = relations.computeJaccardEdges(papers, 0.05);
const elapsed = Date.now() - t0;
console.log(`jaccard edges (≥0.05): ${edges.length} in ${elapsed}ms`);

const histo = {};
for (const e of edges) histo[e.type] = (histo[e.type] || 0) + 1;
console.log('  by type:', histo);

const top = edges.sort((a, b) => b.weight - a.weight).slice(0, 5);
console.log('  top 5:');
for (const e of top) {
  const a = papers.find(p => p.id === e.source);
  const b = papers.find(p => p.id === e.target);
  console.log(`    ${a?.title_zh || a?.title?.slice(0,30)} <-> ${b?.title_zh || b?.title?.slice(0,30)}: w=${e.weight.toFixed(3)} tags=${e.sharedTags?.join(',')}`);
}

console.log('\n✅ REAL-DATA SANITY OK');
