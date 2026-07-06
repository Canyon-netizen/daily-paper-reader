// Build public/assets/ — 镜像 docs/assets/ 里的 figures/tables 到 public/assets/。
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
// 跑法: node astro-src/scripts/copy-docs-assets.mjs
//     或: bun astro-src/scripts/copy-docs-assets.mjs
// 由 package.json 的 predev / prebuild 钩子触发,不必手动跑。

import { existsSync, mkdirSync, rmSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC_BASE = join(ROOT, 'docs', 'assets');
const DST_BASE = join(ROOT, 'public', 'assets');

// 同步的子目录(只搬 figures + tables,其它 docs 子目录不复制)
const SUBDIRS = ['figures', 'tables'];

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  let count = 0;
  let bytes = 0;
  for (const name of readdirSync(src)) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      const sub = copyDir(srcPath, dstPath);
      count += sub.count;
      bytes += sub.bytes;
    } else if (st.isFile()) {
      copyFileSync(srcPath, dstPath);
      count++;
      bytes += st.size;
    }
  }
  return { count, bytes };
}

function main() {
  if (!existsSync(SRC_BASE)) {
    console.warn(`[copy-docs-assets] ${SRC_BASE} 不存在,跳过`);
    return;
  }
  const start = Date.now();
  let totalCount = 0;
  let totalBytes = 0;
  for (const sub of SUBDIRS) {
    const srcSub = join(SRC_BASE, sub);
    if (!existsSync(srcSub)) continue;
    const dstSub = join(DST_BASE, sub);
    // 先清空目标目录,避免遗留被删除论文的图
    if (existsSync(dstSub)) rmSync(dstSub, { recursive: true, force: true });
    const { count, bytes } = copyDir(srcSub, dstSub);
    console.log(`[copy-docs-assets] ${sub}: ${count} 个文件, ${(bytes / 1024).toFixed(0)} KB`);
    totalCount += count;
    totalBytes += bytes;
  }
  const elapsed = Date.now() - start;
  console.log(`[copy-docs-assets] 完成:共 ${totalCount} 个文件, ${(totalBytes / 1024 / 1024).toFixed(1)} MB, ${elapsed} ms`);
}

main();