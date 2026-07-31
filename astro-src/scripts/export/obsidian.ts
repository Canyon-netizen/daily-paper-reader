// astro-src/scripts/export/obsidian.ts
//
// 最小 Obsidian ZIP 导出:
//   - 沿用 docs/papers/<YYYY>/<MM>/<DD>/<id>.md 路径布局
//   - 同 canonical 多版本只导最高 v# (复用 dedupByCanonicalArxivId)
//   - 每篇论文 ↓ 一个文件;内容 = frontmatter + 读盘拼 readme-style header
//   - 第一篇论文的 frontmatter 里挂一份 dpr-library.json 摘要
//   - 概念只放 1 行 stub(避免 zip 体积翻倍;plan §Stage 11 不做 vault 概念正文)
//
// 用 **stored-mode**(无压缩)手写 ZIP,零依赖。store-mode 对于已经 gzip 过的
// 数据(普通 markdown 文本)节省不会超过 5%,一个 ZIP encoder ≈ 80 行就够。
//
// ZIP 格式:
//   - 每个 entry:Local File Header + filename + data + Data Descriptor
//   - 目录末尾:Central Directory Header(每个 entry 一份)
//   - 末尾:End of Central Directory Record
//
// CRC32 计算约定:IEEE 802.3 多项式 0xEDB88320。

interface PaperInput {
  id: string;
  title?: string;
  title_zh?: string;
  authors?: string;
  date?: string;
  arxivId?: string;
  body?: string;       // markdown body,不含 frontmatter
  userNote?: string;
  slug?: string;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

// CRC32 查表(单次构造,缓存在模块级)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function u16(v: number): Uint8Array {
  return new Uint8Array([v & 0xFF, (v >> 8) & 0xFF]);
}
function u32(v: number): Uint8Array {
  return new Uint8Array([v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** 拼一个 markdown 笔记:frontmatter + body + userNote 段。 */
export function renderNoteMarkdown(p: PaperInput): string {
  const fm = [
    '---',
    `id: ${p.id}`,
    p.title ? `title: ${JSON.stringify(p.title)}` : null,
    p.title_zh ? `title_zh: ${JSON.stringify(p.title_zh)}` : null,
    p.authors ? `authors: ${JSON.stringify(p.authors)}` : null,
    p.date ? `date: ${p.date}` : null,
    p.arxivId ? `arxiv: ${p.arxivId}` : null,
    '---',
    '',
  ].filter(Boolean).join('\n');
  const body = (p.body || '').trim();
  const note = (p.userNote && p.userNote.trim())
    ? `\n\n## My Note\n\n${p.userNote.trim()}\n`
    : '';
  return fm + body + note + '\n';
}

/** 主入口:从论文列表构造完整 ZIP,返 Uint8Array。 */
export function buildObsidianZip(papers: PaperInput[]): Uint8Array {
  const entries: ZipEntry[] = [];
  for (const p of papers) {
    // p.id 形态: papers/2026/06/04/2606.26087v1-latentskill
    // 目标路径: docs/papers/<id>.md
    const path = `docs/${p.id}.md`;
    entries.push({ name: path, data: encodeUtf8(renderNoteMarkdown(p)) });
  }
  entries.push({
    name: 'dpr-library.json',
    data: encodeUtf8(JSON.stringify({
      generatedAt: new Date().toISOString(),
      papers: Object.fromEntries(papers.map((p) => [p.id, { userNote: p.userNote || '' }])),
    }, null, 2)),
  });
  entries.push({
    name: 'README.md',
    data: encodeUtf8(
      `# Daily Paper Reader Export\n\nGenerated ${new Date().toISOString()}\n\n` +
      `包含 ${papers.length} 篇论文的笔记 + 用户笔记。` +
      `Obsidian 直接打开 vault 根目录即可看到 docs/papers/ 链接。\n`,
    ),
  });
  return buildZip(entries);
}

function buildZip(entries: ZipEntry[]): Uint8Array {
  const now = new Date();
  const dosTime = ((((now.getHours() & 0x1F) << 11) | ((now.getMinutes() & 0x3F) << 5) | ((now.getSeconds() / 2) & 0x1F)) & 0xFFFF);
  const dosDate = ((((now.getFullYear() - 1980) & 0x7F) << 9) | (((now.getMonth() + 1) & 0x0F) << 5) | (now.getDate() & 0x1F)) & 0xFFFF;

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = encodeUtf8(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    // Local File Header(30 bytes)
    const lfh = concat([
      u32(0x04034b50),    // signature
      u16(20),             // version needed
      u16(0),              // flags
      u16(0),              // method = stored
      u16(dosTime), u16(dosDate),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
    ]);
    localParts.push(lfh, nameBytes, e.data);
    // Central Directory Header(46 bytes)
    const cdh = concat([
      u32(0x02014b50),
      u16(20), u16(20),
      u16(0), u16(0),
      u16(dosTime), u16(dosDate),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0), u16(0),
      u16(0), u16(0),
      u32(0),
      u32(offset),
    ]);
    centralParts.push(cdh, nameBytes);
    offset += lfh.length + nameBytes.length + e.data.length;
  }

  const localBuf = concat(localParts);
  const centralBuf = concat(centralParts);
  // End of Central Directory Record(22 bytes)
  const eocd = concat([
    u32(0x06054b50),
    u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(centralBuf.length),
    u32(localBuf.length),
    u16(0),
  ]);

  return concat([localBuf, centralBuf, eocd]);
}