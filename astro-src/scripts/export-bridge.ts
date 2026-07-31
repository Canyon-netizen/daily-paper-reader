// astro-src/scripts/export-bridge.ts
//
// 浏览器侧的导出桥(Stage 11 UI 层)。
// 拉 arxiv-index.json 拿到所有论文 id,再 fetch /papers/<id>/ 取 frontmatter,
// 喂到 bibtex / csl / obsidian 模块,触发文件下载。

import { renderBibtex } from './export/bibtex';
import { renderCsl } from './export/csl';
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

function setHint(msg: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  const el = document.getElementById('export-hint');
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

function parseFrontmatter(md: string): { data: Record<string, any>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { data: {}, body: md };
  const data: Record<string, any> = {};
  // 极简 YAML:不依赖 yaml lib,只抽 starred 列表需要的字段
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let val: any = line.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith('[') && val.endsWith(']')) {
      // 列表:简单 split by `, ` (没有嵌套 quote 解析)
      val = val.slice(1, -1).split(',').map((s: string) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    } else if (val.startsWith('{') && val.endsWith('}')) {
      val = val; // 简化:整段塞回去,工具用 paper-analyzer 风格 workaround
    }
    data[key] = val;
  }
  return { data, body: m[2] };
}

async function loadStarredPapers(): Promise<PaperInput[]> {
  const starred = listStarred();
  if (starred.length === 0) {
    throw new Error('还没有星标任何论文 —— 先在 /papers/ 列表里点 ⭐');
  }
  const index = await fetchIndexJson();
  const papers: PaperInput[] = [];
  for (const cx of starred) {
    const row = index[cx];
    if (!row?.rel) continue;
    // rel 是 docs/papers/... 相对路径;fetch 需要 /papers/...
    const pagesRel = '/' + row.rel.replace(/^docs\//, '').replace(/\.md$/, '.html');
    try {
      const html = await fetchMd(pagesRel);
      // 详情页是 .html;但我们想读 .md 拿 frontmatter。改用 .md 路径(prdev 已 copy 到 /papers/)。
      // 实际上 prebuild 把 docs/papers/** 拷到 public/papers/... 路径,这里直接拿
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

export async function exportBibtex(): Promise<void> {
  try {
    setHint('打包中…');
    const papers = await loadStarredPapers();
    const bib = renderBibtex(papers);
    downloadAsFile(bib, 'references.bib', 'application/x-bibtex');
    setHint(`✓ 已导出 ${papers.length} 篇 BibTeX`, 'ok');
  } catch (e) {
    setHint(`✗ ${(e as Error).message}`, 'error');
  }
}

export async function exportCsl(): Promise<void> {
  try {
    setHint('打包中…');
    const papers = await loadStarredPapers();
    const csl = renderCsl(papers);
    downloadAsFile(csl, 'library.csl.json', 'application/vnd.citationstyles.csl+json');
    setHint(`✓ 已导出 ${papers.length} 篇 CSL-JSON`, 'ok');
  } catch (e) {
    setHint(`✗ ${(e as Error).message}`, 'error');
  }
}

export async function exportZip(): Promise<void> {
  try {
    setHint('打包中…(手写 ZIP 较慢,几十篇约 1-2s)');
    const papers = await loadStarredPapers();
    const zip = buildObsidianZip(papers);
    downloadAsFile(zip, 'my-library.zip', 'application/zip');
    setHint(`✓ 已导出 ${papers.length} 篇 Obsidian ZIP`, 'ok');
  } catch (e) {
    setHint(`✗ ${(e as Error).message}`, 'error');
  }
}

export function initExportButtons(): void {
  document.getElementById('export-bibtex-btn')?.addEventListener('click', () => void exportBibtex());
  document.getElementById('export-csl-btn')?.addEventListener('click', () => void exportCsl());
  document.getElementById('export-zip-btn')?.addEventListener('click', () => void exportZip());
}