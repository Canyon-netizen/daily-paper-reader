// tests/test_export_bibtex.test.ts — Stage 11 导出测试。
//
// 跑法: bun test tests/test_export_bibtex.test.ts
//
// 覆盖:
//   - escapeLatex 转义 Müller & % $ # _ { } ~ ^
//   - citeKeyOf produce reasonable keys;缩写作者退化到 arxivId
//   - bibEntryType 判定 (arxiv / openreview / 未知)
//   - renderBibtex 完整;collision 产生 -a / -b
//   - renderCsl 输出合法 JSON,id/author/type 字段
//   - buildObsidianZip 是合法 ZIP 字节流(末 22 字节 EOCD)

import { describe, it, expect } from 'bun:test';
import { escapeLatex, asciiFold, citeKeyOf, bibEntryType, renderBibtexEntry, renderBibtex } from '../astro-src/scripts/export/bibtex';
import { renderCsl } from '../astro-src/scripts/export/csl';
import { buildObsidianZip, renderNoteMarkdown } from '../astro-src/scripts/export/obsidian';

const SAMPLE = {
  id: 'papers/2026/06/04/2606.06087v1-latentskill',
  title: 'LatentSkill: From In-Context Textual Skills to In-Weight Latent Skills',
  title_zh: 'LatentSkill',
  authors: 'Aofan Yu, Chenyu Zhou, Tianyi Xu',
  date: '2026-06-04',
  pdf: 'https://arxiv.org/pdf/2606.06087v1',
  arxivId: '2606.06087v1',
  source: 'arxiv',
  categories: { venue: [], task: ['agent'], method: [], type: [] },
};

const ABBR = {
  ...SAMPLE,
  authors: 'J. Smith, B. Lee',
  arxivId: '2510.06644v1',
  id: 'papers/2026/01/01/2510.06644v1-x',
};

const ACCENT = {
  ...SAMPLE,
  title: 'Testing M{üller} & 50% gains',
  authors: 'Müller, Pêche',
};

describe('export/bibtex', () => {
  it('escapeLatex covers the standard set', () => {
    const out = escapeLatex('50% & $1 #2 {x} ~^');
    expect(out).toContain('50\\%');
    expect(out).toContain('\\&');
    expect(out).toContain('\\$1');
    expect(out).toContain('\\#2');
    expect(out).toContain('\\{x\\}');
    expect(out).toContain('\\textasciitilde{}');
    expect(out).toContain('\\textasciicircum{}');
  });

  it('asciiFold: Müller → Muller, ñoño → nono', () => {
    expect(asciiFold('Müller')).toBe('Muller');
    expect(asciiFold('ñoño')).toBe('nono');
  });

  it('citeKeyOf: full-name author → surname + 2-digit year + first title word', () => {
    const k = citeKeyOf(SAMPLE);
    expect(k).toMatch(/^yu26.*/); // Yu + 26 + latentskill
  });

  it('citeKeyOf: abbreviated author falls back to arxivId', () => {
    // 纯缩写形态:"J. K." 单 token,且 tokens 全部 ≤2 char / 含 [A-Z]. pattern
    const ABR_FULL = { ...SAMPLE, authors: 'J. K.', arxivId: '2510.06644v1', id: 'papers/2026/01/01/2510.06644v1-x' };
    const k = citeKeyOf(ABR_FULL);
    expect(k).toMatch(/251006644/);
  });

  it('bibEntryType: arxiv / openreview / unknown', () => {
    expect(bibEntryType({ source: 'arxiv' })).toBe('article');
    expect(bibEntryType({ source: 'icml-openreview-2025' })).toBe('inproceedings');
    expect(bibEntryType({ source: 'manual' })).toBe('misc');
    expect(bibEntryType({ source: 'biorxiv-10-1101-...' })).toBe('article');
  });

  it('renderBibtexEntry: works on SAMPLE', () => {
    const e = renderBibtexEntry(SAMPLE, 'yu26latentskill');
    expect(e).toContain('@article{yu26latentskill,');
    expect(e).toContain('title        = {LatentSkill');
    expect(e).toContain('eprint       = {2606.06087v1}');
  });

  it('renderBibtex: collision produces -a / -b', () => {
    const p1 = { ...SAMPLE, id: 'papers/2026/06/04/2606.00001v1-a', arxivId: '2606.00001v1' };
    const p2 = { ...SAMPLE, id: 'papers/2026/06/04/2606.00002v1-b', arxivId: '2606.00002v1' };
    const p3 = { ...SAMPLE, id: 'papers/2026/06/04/2606.00003v1-c', arxivId: '2606.00003v1' };
    const out = renderBibtex([p1, p2, p3]);
    expect(out).toMatch(/@article\{yu26latentskill,/); // 第 1 篇干净
    expect(out).toContain('@article{yu26latentskill-a,');
    expect(out).toContain('@article{yu26latentskill-b,');
  });

  it('renderBibtex: 损坏 cite key 仍有合法 BibTeX', () => {
    const out = renderBibtex([ACCENT]);
    expect(out).toContain('@article{');
    expect(out).toContain('M\\{üller\\}'); // 大括号转义
    expect(out).toContain('50\\%');        // 百分号转义
    expect(out).toContain('\\&');           // & 转义
  });
});

describe('export/csl', () => {
  it('renderCsl outputs valid JSON', () => {
    const out = renderCsl([SAMPLE]);
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe('2606.06087v1');
    expect(parsed[0].title).toContain('LatentSkill');
    expect(parsed[0].author.length).toBe(3);
    expect(parsed[0].author[0].family).toBe('Yu');
    expect(parsed[0].issued['date-parts'][0][0]).toBe(2026);
  });

  it('renderCsl: openreview maps to paper-conference type', () => {
    const out = renderCsl([{ ...SAMPLE, source: 'icml-openreview-2025' }]);
    const parsed = JSON.parse(out);
    expect(parsed[0].type).toBe('paper-conference');
  });
});

describe('export/obsidian', () => {
  it('renderNoteMarkdown: frontmatter + body + my note', () => {
    const md = renderNoteMarkdown({ ...SAMPLE, body: '## TLDR\n...', userNote: 'want to revisit' });
    expect(md).toContain('---');
    expect(md).toContain('title: "LatentSkill:');
    expect(md).toContain('## TLDR');
    expect(md).toContain('## My Note');
    expect(md).toContain('want to revisit');
  });

  it('buildObsidianZip: ends with EOCD record', () => {
    const zip = buildObsidianZip([SAMPLE]);
    expect(zip.length).toBeGreaterThan(0);
    // EOCD signature: 50 4B 05 06,position is the last 22 bytes
    expect(zip[zip.length - 22]).toBe(0x50);
    expect(zip[zip.length - 21]).toBe(0x4B);
    expect(zip[zip.length - 20]).toBe(0x05);
    expect(zip[zip.length - 19]).toBe(0x06);
  });

  it('buildObsidianZip: contains known paper md path', () => {
    const zip = buildObsidianZip([SAMPLE]);
    const text = new TextDecoder().decode(zip);
    expect(text).toContain('docs/papers/2026/06/04/2606.06087v1-latentskill.md');
    expect(text).toContain('dpr-library.json');
    expect(text).toContain('README.md');
  });
});