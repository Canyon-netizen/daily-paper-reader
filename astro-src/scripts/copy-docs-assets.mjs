// Build public/ — 镜像 docs/ 里的 figures/tables 到 public/assets/,以及
// docs/papers/*.txt 到 public/papers/(给 paper-chat 全文模式用)。
//
// 背景:Astro 只把 public/ 目录复制到 dist/(网站根)。
// docs/assets/ 里的 fig-XXX.webp 是论文配图,但 Astro 不感知,所以 dist/assets/ 是空的。
// 我们的渲染 HTML 写 <img src="/assets/figures/arxiv/<id>/fig-NNN.webp">,
// 必须把 docs/assets/ 复制到 public/assets/,build 才会带进去。
//
// 设计要点:
//   - 用 Node fs.copyFileSync / mkdirSync(平台无关,Windows / Linux 都行)
//   - 只复制 docs/assets/figures/** + docs/assets/tables/**(其它 docs 子目录不复制,避免误吞)
//   - 已存在的同名文件直接覆盖(允许 web analyzer 重新生成同 ID 图后增量同步)
//   - 删除 public/assets/figures + public/assets/tables 的旧目录,避免遗留被删论文的图
//   - 失败兜底:docs/assets 不存在时 no-op(不阻塞 dev)
//
// 版本去重:
//   - 同一篇 arXiv 论文可能会以 v1 / v2 / ... 多个版本被采集进 docs/assets/
//     (如 2606.26694v1、2606.26694v2),但 markdown 笔记、HTML 模板、index 都只引用最新版,
//     老版本的 figures 是纯部署冗余,会无谓地撑大产物。
//   - 这里按 canonical id(= 去掉末尾 v<n>)分组,只搬运版本号最大的那一份。
//
// 体积兜底:
//   - Cloudflare Pages 单文件 ≤ 25 MiB。个别论文(物理仿真/数据集类)的超大配图会触发上限,
//     部署校验直接失败。复制阶段遇到 >24 MiB 的图片,自动降采样到长边 4096 重新编码,
//     既能过阈值,又保留论文配图的辨识度。
//
// 同步 docs/papers/*.txt → public/papers/:
//   - daily pipeline 抓 arXiv PDF 抽正文,生成 docs/papers/{arxivId}v#-slug.txt。
//   - paper-chat 的全文模式(paper-fulltext.ts::loadFulltextSkeleton)优先读
//     /papers/{id}.txt 作为 LLM 上下文 — 比 ar5iv 快、不依赖 8123 CORS 代理。
//   - 同一 id 可能 v1 / v2 共存,跟 figures 一样按 canonical id 去重,
//     只拷最高版本那一份,避免 LLM 看到旧版 + 减少 dist 体积。
//   - 体积兜底:个别论文 .txt 太大(>1 MiB)→ 截断到 1 MiB,够 LLM 看完整结构,
//     也避免 Cloudflare 25 MiB 单文件限制被撞穿。
//
// 跑法: node astro-src/scripts/copy-docs-assets.mjs
//     或: bun astro-src/scripts/copy-docs-assets.mjs
// 由 package.json 的 predev / prebuild 钩子触发,不必手动跑。

import { existsSync, mkdirSync, rmSync, readdirSync, copyFileSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = process.cwd();
const SRC_BASE = join(ROOT, 'docs', 'assets');
const DST_BASE = join(ROOT, 'public', 'assets');

// 同步的子目录(只搬 figures + tables,其它 docs 子目录不复制)
const SUBDIRS = ['figures', 'tables'];

// Cloudflare Pages 单文件上限 25 MiB,留一点 buffer 卡 24 MiB 触发压缩
const MAX_FILE_BYTES = 24 * 1024 * 1024;
// 降采样目标长边。4096 对绝大多数论文配图够用,论文里出现再小的子图也只是更糊一些
const MAX_LONG_EDGE = 4096;

function listVersionedDirs(parent) {
  // 返回 [{ id: '2606.26694', version: 2, dir: '2606.26694v2' }, ...]
  // 按 (id asc, version desc) 排序
  if (!existsSync(parent)) return [];
  const entries = [];
  for (const name of readdirSync(parent)) {
    const m = name.match(/^(.+?)v(\d+)$/);
    if (!m) continue;
    if (!statSync(join(parent, name)).isDirectory()) continue;
    entries.push({ id: m[1], version: Number(m[2]), dir: name });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : b.version - a.version));
  return entries;
}

function latestDirsPerId(entries) {
  // 同 canonical id 只保留版本号最大的那一份
  const byId = new Map();
  for (const e of entries) {
    const prev = byId.get(e.id);
    if (!prev || e.version > prev.version) byId.set(e.id, e);
  }
  return [...byId.values()];
}

async function maybeShrink(srcPath, dstPath) {
  const st = statSync(srcPath);
  if (st.size <= MAX_FILE_BYTES) {
    copyFileSync(srcPath, dstPath);
    return { copied: 1, shrunk: 0, bytesIn: st.size, bytesOut: st.size };
  }
  // 超大文件 → 走 sharp 降采样;sharp 不在依赖里时回退到原样复制并打 warn,
  // 让部署在引入 sharp 之前仍能跑(只是会保留超限文件,部署会失败,但行为可见)。
  const ext = basename(srcPath).toLowerCase();
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.warn(`[copy-docs-assets] ${basename(srcPath)} ${(st.size / 1024 / 1024).toFixed(1)} MiB 超限,但未安装 sharp,原样复制(部署会失败)`);
    copyFileSync(srcPath, dstPath);
    return { copied: 1, shrunk: 0, bytesIn: st.size, bytesOut: st.size };
  }
  const img = sharp(srcPath, { failOn: 'none', limitInputPixels: false });
  const meta = await img.metadata();
  const longEdge = Math.max(meta.width || 0, meta.height || 0);
  const resized = longEdge > MAX_LONG_EDGE
    ? img.resize({
        width: meta.width >= meta.height ? MAX_LONG_EDGE : null,
        height: meta.height > meta.width ? MAX_LONG_EDGE : null,
        withoutEnlargement: true,
        fit: 'inside',
      })
    : img;
  // 强制 sRGB 8-bit,palette 模式才能稳定工作
  const normalized = resized.toColourspace('srgb');
  // PNG 走有损调色板(无 alpha)或高质量 8-bit(有 alpha),WebP 走 80 质量,JPEG 走 mozjpeg 82
  if (ext.endsWith('.png')) {
    const pngOpts = meta.hasAlpha
      ? { compressionLevel: 9, effort: 10 }
      : { compressionLevel: 9, palette: true, quality: 70, effort: 10, colours: 256 };
    await normalized.png(pngOpts).toFile(dstPath);
  } else if (ext.endsWith('.webp')) {
    await normalized.webp({ quality: 80 }).toFile(dstPath);
  } else if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) {
    await normalized.jpeg({ quality: 82, mozjpeg: true }).toFile(dstPath);
  } else {
    copyFileSync(srcPath, dstPath);
    return { copied: 1, shrunk: 0, bytesIn: st.size, bytesOut: st.size };
  }
  const outSize = statSync(dstPath).size;
  const ok = outSize <= MAX_FILE_BYTES;
  if (!ok) {
    console.warn(`[copy-docs-assets] ${basename(srcPath)} 压缩后仍 ${(outSize / 1024 / 1024).toFixed(1)} MiB,部署仍会失败`);
  } else {
    console.log(`[copy-docs-assets] ${basename(srcPath)} ${(st.size / 1024 / 1024).toFixed(1)} → ${(outSize / 1024 / 1024).toFixed(1)} MiB`);
  }
  return { copied: 1, shrunk: 1, bytesIn: st.size, bytesOut: outSize };
}

async function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  let count = 0;
  let shrunkCount = 0;
  let bytesIn = 0;
  let bytesOut = 0;
  for (const name of readdirSync(src)) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      const sub = await copyDir(srcPath, dstPath);
      count += sub.count;
      shrunkCount += sub.shrunk;
      bytesIn += sub.bytesIn;
      bytesOut += sub.bytesOut;
    } else if (st.isFile()) {
      const r = await maybeShrink(srcPath, dstPath);
      count += r.copied;
      shrunkCount += r.shrunk;
      bytesIn += r.bytesIn;
      bytesOut += r.bytesOut;
    }
  }
  return { count, shrunk: shrunkCount, bytesIn, bytesOut };
}

async function copyFiguresVersionDedup(srcSub, dstSub) {
  // figures/ 下通常有 arxiv/、biorxiv/ 等一级子目录,版本目录(如 2606.26694v2)在
  // 它们之下。每个一级子目录单独做版本去重,只搬同 canonical id 的最大版本。
  mkdirSync(dstSub, { recursive: true });
  let total = { count: 0, shrunk: 0, bytesIn: 0, bytesOut: 0, dropped: 0 };
  const allDropped = [];
  if (!existsSync(srcSub)) return total;
  for (const group of readdirSync(srcSub)) {
    const groupSrc = join(srcSub, group);
    if (!statSync(groupSrc).isDirectory()) continue;
    const entries = listVersionedDirs(groupSrc);
    if (entries.length === 0) {
      // 不是版本化目录(比如顶层只有 plain 名字),原样递归搬
      const groupDst = join(dstSub, group);
      if (existsSync(groupDst)) rmSync(groupDst, { recursive: true, force: true });
      const r = await copyDir(groupSrc, groupDst);
      total.count += r.count; total.shrunk += r.shrunk;
      total.bytesIn += r.bytesIn; total.bytesOut += r.bytesOut;
      continue;
    }
    const latest = latestDirsPerId(entries);
    const latestSet = new Set(latest.map(e => e.dir));
    const dropped = entries.filter(e => !latestSet.has(e.dir));
    for (const d of dropped) allDropped.push(`${group}/${d.dir}(v${d.version})`);
    for (const e of latest) {
      const src = join(groupSrc, e.dir);
      const dst = join(dstSub, group, e.dir);
      if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
      const r = await copyDir(src, dst);
      total.count += r.count; total.shrunk += r.shrunk;
      total.bytesIn += r.bytesIn; total.bytesOut += r.bytesOut;
    }
  }
  if (allDropped.length) {
    console.log(`[copy-docs-assets] 跳过老版本 figures: ${allDropped.join(', ')}`);
  }
  return { ...total, dropped: allDropped.length };
}

async function main() {
  if (!existsSync(SRC_BASE)) {
    console.warn(`[copy-docs-assets] ${SRC_BASE} 不存在,跳过`);
    return;
  }
  const start = Date.now();
  let totalCount = 0;
  let totalShrunk = 0;
  let totalBytesIn = 0;
  let totalBytesOut = 0;
  let totalDropped = 0;
  for (const sub of SUBDIRS) {
    const srcSub = join(SRC_BASE, sub);
    if (!existsSync(srcSub)) continue;
    const dstSub = join(DST_BASE, sub);
    // 先清空目标目录,避免遗留被删除论文的图
    if (existsSync(dstSub)) rmSync(dstSub, { recursive: true, force: true });
    let r;
    if (sub === 'figures') {
      r = await copyFiguresVersionDedup(srcSub, dstSub);
    } else {
      r = await copyDir(srcSub, dstSub);
    }
    const inMB = (r.bytesIn / 1024 / 1024).toFixed(1);
    const outMB = (r.bytesOut / 1024 / 1024).toFixed(1);
    let line = `[copy-docs-assets] ${sub}: ${r.count} 个文件, ${inMB} MiB`;
    if (r.shrunk) line += `,压缩 ${r.shrunk} 张`;
    console.log(line);
    totalCount += r.count;
    totalShrunk += r.shrunk;
    totalBytesIn += r.bytesIn;
    totalBytesOut += r.bytesOut;
    totalDropped += r.dropped || 0;
  }

  // 同步 docs/papers/*.txt → public/papers/ — paper-chat 全文模式用
  const papersR = await copyPapersTxt();
  totalCount += papersR.count;
  totalBytesIn += papersR.bytesIn;
  totalBytesOut += papersR.bytesOut;
  totalDropped += papersR.dropped;
  if (papersR.count > 0) {
    const inMB = (papersR.bytesIn / 1024 / 1024).toFixed(1);
    const outMB = (papersR.bytesOut / 1024 / 1024).toFixed(1);
    let line = `[copy-docs-assets] papers/*.txt: ${papersR.count} 个文件, ${inMB} → ${outMB} MiB`;
    if (papersR.truncated) line += `,截断 ${papersR.truncated} 个大文件`;
    console.log(line);
  }

  // 拷贝 KaTeX 字体到 public/fonts/katex/ — 让 GH-Pages 子路径下也能加载
  // KaTeX 自带 CSS 用 url(fonts/KaTeX_*.woff2) 相对路径引用,Astro 把 public/ 原样
  // 拷到 dist 根,base=/daily-paper-reader 时会自动解析到子路径。空仓库时跳过。
  const katexR = copyKatexFonts();
  if (katexR.copied > 0) {
    const inKB = (katexR.bytesIn / 1024).toFixed(0);
    console.log(`[copy-docs-assets] fonts/katex: ${katexR.copied} 个文件, ${inKB} KiB`);
    totalCount += katexR.copied;
    totalBytesIn += katexR.bytesIn;
    totalBytesOut += katexR.bytesOut;
  }

  const elapsed = Date.now() - start;
  const inMB = (totalBytesIn / 1024 / 1024).toFixed(1);
  const outMB = (totalBytesOut / 1024 / 1024).toFixed(1);
  let tail = `共 ${totalCount} 个文件, ${inMB} → ${outMB} MiB, ${elapsed} ms`;
  if (totalDropped) tail += `,跳过 ${totalDropped} 个老版本`;
  console.log(`[copy-docs-assets] 完成:${tail}`);
}

// ============================================================================
// docs/papers/*.txt → public/papers/
// 版本去重 + 超大文件截断。
// ============================================================================

const PAPERS_SRC = join(ROOT, 'docs', 'papers');
const PAPERS_DST = join(ROOT, 'public', 'papers');
const TXT_MAX_BYTES = 1024 * 1024;  // 1 MiB 上限,够 LLM 看完整结构

async function copyPapersTxt() {
  if (!existsSync(PAPERS_SRC)) return { count: 0, bytesIn: 0, bytesOut: 0, dropped: 0, truncated: 0 };
  const entries = readdirSync(PAPERS_SRC).filter((n) => n.endsWith('.txt'));
  // 按 canonical id 分组,取最高版本
  const latestPerId = new Map();  // arxiv id → { filename, version }
  const dropped = [];
  for (const name of entries) {
    const m = name.match(/^(\d{4}\.\d{4,5})v(\d+)-.+\.txt$/);
    if (!m) continue;  // 非标准命名(如 biorxiv-)先跳过,后续单独处理
    const arxivId = m[1];
    const ver = parseInt(m[2], 10);
    const cur = latestPerId.get(arxivId);
    if (!cur || ver > cur.version) {
      if (cur) dropped.push(cur.filename);
      latestPerId.set(arxivId, { filename: name, version: ver });
    } else {
      dropped.push(name);
    }
  }
  // 先清空目标目录
  if (existsSync(PAPERS_DST)) rmSync(PAPERS_DST, { recursive: true, force: true });
  mkdirSync(PAPERS_DST, { recursive: true });
  let count = 0;
  let bytesIn = 0;
  let bytesOut = 0;
  let truncated = 0;
  for (const { filename } of latestPerId.values()) {
    const src = join(PAPERS_SRC, filename);
    const dst = join(PAPERS_DST, filename);
    const st = statSync(src);
    bytesIn += st.size;
    try {
      if (st.size > TXT_MAX_BYTES) {
        // 截断到 1 MiB,保留前 N 行(按双换行分段)
        const buf = await readFileChunk(src, TXT_MAX_BYTES);
        writeFileSync(dst, buf);
        bytesOut += buf.length;
        truncated++;
      } else {
        copyFileSync(src, dst);
        bytesOut += st.size;
      }
      count++;
    } catch (e) {
      console.warn(`[copy-docs-assets] ${filename} 复制失败:${e?.message || e}`);
    }
  }
  return { count, bytesIn, bytesOut, dropped: dropped.length, truncated };
}

// 用 fs.openSync 分块读,避免 readFileSync 把几 MB 整块塞进内存(冷启动便宜些)
async function readFileChunk(path, maxBytes) {
  const { open } = await import('node:fs/promises');
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    // 截断到最后一个完整段落边界(双换行),避免 LLM 看到半截句
    let end = bytesRead;
    const slice = buf.subarray(0, bytesRead).toString('utf-8');
    const lastParaBreak = slice.lastIndexOf('\n\n');
    if (lastParaBreak > maxBytes * 0.8) end = lastParaBreak + 2;  // 至少保留 80%
    return buf.subarray(0, end);
  } finally {
    await fh.close();
  }
}

// ============================================================================
// node_modules/katex/dist/fonts → public/fonts/katex/
// 只在首次或字体版本变化时全量复制,后续 dev 启动秒过。
// ============================================================================

const KATEX_FONTS_SRC = join(ROOT, 'node_modules', 'katex', 'dist', 'fonts');
const KATEX_FONTS_DST = join(ROOT, 'public', 'fonts', 'katex');
const KATEX_VERSION_STAMP = '.katex-fonts-version';

function copyKatexFonts() {
  if (!existsSync(KATEX_FONTS_SRC)) {
    // 没装 katex 时跳过,UI 上公式降级为 <code> 占位
    return { copied: 0, bytesIn: 0, bytesOut: 0 };
  }
  // 用 stamp 文件避免每次都遍历 fonts/:只在缺失或 stamp 不匹配时重拷
  const stampPath = join(KATEX_FONTS_DST, KATEX_VERSION_STAMP);
  if (existsSync(stampPath)) {
    return { copied: 0, bytesIn: 0, bytesOut: 0 };
  }
  mkdirSync(KATEX_FONTS_DST, { recursive: true });
  let copied = 0;
  let bytesIn = 0;
  for (const name of readdirSync(KATEX_FONTS_SRC)) {
    if (!name.endsWith('.woff2') && !name.endsWith('.woff') && !name.endsWith('.ttf')) continue;
    const src = join(KATEX_FONTS_SRC, name);
    const dst = join(KATEX_FONTS_DST, name);
    copyFileSync(src, dst);
    copied++;
    bytesIn += statSync(src).size;
  }
  // 写 stamp 标记完成,下次启动秒过
  writeFileSync(stampPath, new Date().toISOString());
  return { copied, bytesIn, bytesOut: bytesIn };
}

main();