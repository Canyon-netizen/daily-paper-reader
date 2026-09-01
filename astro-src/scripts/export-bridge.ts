// astro-src/scripts/export-bridge.ts
//
// 浏览器侧的导出桥(Stage 11 + 文献库扩展)。
// 通用入口 exportBySet({canonicalIds, label, filenamePrefix, hint}):拉 arxiv-index.json
// 拿到所有论文 id,再 fetch /papers/<id>.md 取 frontmatter,喂到 bibtex / csl /
// obsidian 模块,触发文件下载。
//
// 两个场景共用:
//   - 设置页「我的图书馆」→ starredPapers() → listStarred() → 走 listStarred
//   - 单库工作台 /libraries/<id>/ → libraryPapers() → 走 lib/libraries.ts 派生
//
// 文件名 / hint 文案按场景定制,但 fetch + parse + render 流水线复用一份。

import { renderBibtex } from './export/bibtex';
import { renderCsl } from './export/csl';
import { renderRis } from './export/ris';
import { buildObsidianZip } from './export/obsidian';
import { getUserNote, listStarred } from '../lib/user-library';
import { downloadAsFile } from './export/trigger-download';

interface PaperInput {
  id: string;
  title?: string;
  title_zh?: string;
  authors?: string;
  date?: string;
  pdf?: string;
  arxivId?: string;
  source?: string;
  venue?: string;
  categories?: { venue?: string[]; task?: string[]; method?: string[]; type?: string[] };
  body?: string;
  userNote?: string;
}

interface IndexRow {
  i: string;
  title?: string;
  arxivId?: string;
}

interface ExportOptions {
  /** canonical arxiv id 列表(用户态星标,或单库派生的成员) */
  canonicalIds: string[];
  /** 文件名前缀,如 'rl-library' / 'my-library' */
  filenamePrefix: string;
  /** hint 字段 id(可省略,不提示) */
  hintElementId?: string;
  /** 没有成员时的友好提示 */
  emptyMessage: string;
}

/** 设置 hint 字段(若存在)。 */
function setHint(id: string | undefined, msg: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.dataset.kind = kind;
}

async function fetchIndexJson(): Promise<Record<string, { rel?: string; title?: string }>> {
  const res = await fetch('/arxiv-index.json');
  if (!res.ok) throw new Error(`arxiv-index.json fetch failed: ${res.status}`);
  return (await res.json()) as Record<string, { rel?: string; title?: string }>;
}

async function fetchMd(rel: string): Promise<string> {
  const res = await fetch(rel);
  if (!res.ok) throw new Error(`fetch ${rel} → HTTP ${res.status}`);
  return res.text();
}

/** 极简 frontmatter 解析 — 抽 starred 列表需要的字段。 */
function parseFrontmatter(md: string): { data: Record<string, any>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { data: {}, body: md };
  const data: Record<string, any> = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let val: any = line.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map((s: string) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    }
    data[key] = val;
  }
  return { data, body: m[2] };
}

/** 拉一批 canonicalIds 的 paper 输入。 */
async function loadPapersByIds(canonicalIds: string[]): Promise<PaperInput[]> {
  const index = await fetchIndexJson();
  const papers: PaperInput[] = [];
  for (const cx of canonicalIds) {
    const row = index[cx];
    if (!row?.rel) continue;
    try {
      const md = await fetchMd('/' + row.rel.replace(/^docs\//, '').replace(/\.md$/, '.md'));
      const { data, body } = parseFrontmatter(md);
      papers.push({
        id: row.rel.replace(/^docs\/papers\//, '').replace(/\.md$/, ''),
        title: data.title,
        title_zh: data.title_zh,
        authors: data.authors,
        date: data.date,
        pdf: data.pdf,
        arxivId: cx,
        source: data.source,
        venue: data.venue,
        categories: data.categories,
        body,
        userNote: getUserNote(cx) || '',
      });
    } catch (e) {
      console.warn('[export] skip', cx, e);
    }
  }
  return papers;
}

/** 通用导出入口。 */
async function exportBySet(opts: ExportOptions, kind: 'bibtex' | 'csl' | 'ris' | 'zip'): Promise<void> {
  if (opts.canonicalIds.length === 0) {
    setHint(opts.hintElementId, opts.emptyMessage, 'error');
    return;
  }
  setHint(opts.hintElementId, '打包中…');
  try {
    const papers = await loadPapersByIds(opts.canonicalIds);
    if (papers.length === 0) {
      setHint(opts.hintElementId, '× fetch 失败(可能 docs 还未拷贝到 /papers/)', 'error');
      return;
    }
    const ext = kind === 'bibtex' ? 'bib' : kind === 'csl' ? 'csl.json' : kind === 'ris' ? 'ris' : 'zip';
    const mime = kind === 'bibtex' ? 'application/x-bibtex'
      : kind === 'csl' ? 'application/vnd.citationstyles.csl+json'
      : kind === 'ris' ? 'application/x-research-info-systems'
      : 'application/zip';
    const baseName = kind === 'bibtex' ? 'references'
      : kind === 'csl' ? 'library'
      : kind === 'ris' ? 'references'
      : 'my-library';
    const filename = `${opts.filenamePrefix}-${baseName}.${ext}`;
    let content: string | Uint8Array;
    if (kind === 'bibtex') content = renderBibtex(papers);
    else if (kind === 'csl') content = renderCsl(papers);
    else if (kind === 'ris') content = renderRis(papers);
    else content = buildObsidianZip(papers);
    downloadAsFile(content, filename, mime);
    setHint(opts.hintElementId, `✓ ${opts.filenamePrefix} ${papers.length} 篇导出完成`, 'ok');
  } catch (e) {
    setHint(opts.hintElementId, `✗ ${(e as Error).message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// 设置页:我的图书馆(星标)
// ---------------------------------------------------------------------------

async function starredOpts(): Promise<ExportOptions> {
  return {
    canonicalIds: listStarred(),
    filenamePrefix: 'my-library',
    hintElementId: 'export-hint',
    emptyMessage: '还没有星标任何论文 —— 先在 /papers/ 列表里点 ⭐',
  };
}

export async function exportBibtex(): Promise<void> {
  await exportBySet(await starredOpts(), 'bibtex');
}

export async function exportCsl(): Promise<void> {
  await exportBySet(await starredOpts(), 'csl');
}

export async function exportRis(): Promise<void> {
  await exportBySet(await starredOpts(), 'ris');
}

export async function exportZip(): Promise<void> {
  setHint('export-hint', '打包中…(手写 ZIP 较慢,几十篇约 1-2s)');
  await exportBySet(await starredOpts(), 'zip');
}

export function initExportButtons(): void {
  document.getElementById('export-bibtex-btn')?.addEventListener('click', () => void exportBibtex());
  document.getElementById('export-csl-btn')?.addEventListener('click', () => void exportCsl());
  document.getElementById('export-ris-btn')?.addEventListener('click', () => void exportRis());
  document.getElementById('export-zip-btn')?.addEventListener('click', () => void exportZip());
}

// ---------------------------------------------------------------------------
// 单库工作台 /libraries/<id>/:按"库成员"导出
// 数据源 = 当前页 #library-wb-papers 区域的 canonical id 列表(SSR 注入)
// ---------------------------------------------------------------------------

/** 找当前页注入的论文 canonical id 列表。
 *  /libraries/<id>.astro 把成员 canonical 序列化为 #library-wb-data[data-cx=...] 的 JSON,
 *  这样 export-bridge 不用重复 fetch /libraries/<id>/ 的 SSR 数据。
 */
function readLibraryIds(): string[] {
  const el = document.querySelector<HTMLElement>('#library-wb-data');
  if (!el) return [];
  const raw = el.getAttribute('data-cx');
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function readLibraryMeta(): { filenamePrefix: string; hintId: string } {
  const el = document.querySelector<HTMLElement>('#library-wb-data');
  return {
    filenamePrefix: el?.dataset.prefix || 'library',
    hintId: el?.dataset.hintId || 'lib-export-hint',
  };
}

export async function exportLibraryBibtex(): Promise<void> {
  const meta = readLibraryMeta();
  await exportBySet({ canonicalIds: readLibraryIds(), ...meta, emptyMessage: '该文献库暂无论文' }, 'bibtex');
}

export async function exportLibraryCsl(): Promise<void> {
  const meta = readLibraryMeta();
  await exportBySet({ canonicalIds: readLibraryIds(), ...meta, emptyMessage: '该文献库暂无论文' }, 'csl');
}

export async function exportLibraryRis(): Promise<void> {
  const meta = readLibraryMeta();
  await exportBySet({ canonicalIds: readLibraryIds(), ...meta, emptyMessage: '该文献库暂无论文' }, 'ris');
}

export async function exportLibraryZip(): Promise<void> {
  const meta = readLibraryMeta();
  setHint(meta.hintId, '打包中…(手写 ZIP 较慢,几十篇约 1-2s)');
  await exportBySet({ canonicalIds: readLibraryIds(), ...meta, emptyMessage: '该文献库暂无论文' }, 'zip');
}

export function initLibraryExportButtons(): void {
  document.querySelectorAll<HTMLAnchorElement>('[data-library-export-target]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = a.dataset.libraryExportTarget;
      if (target === 'bibtex') void exportLibraryBibtex();
      else if (target === 'csl') void exportLibraryCsl();
      else if (target === 'ris') void exportLibraryRis();
      else if (target === 'obsidian') void exportLibraryZip();
    });
  });
}