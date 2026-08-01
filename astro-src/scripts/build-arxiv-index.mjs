// Build public/arxiv-index.json — maps arxivId → { rel, title }.
// 跑法:  node astro-src/scripts/build-arxiv-index.mjs
//     或: bun astro-src/scripts/build-arxiv-index.mjs
//
// 设计要点:
//   - 扫描 docs/**.md,以文件名 "<arxivId>-<slug>.md" 提 ID
//   - 同一 canonical id(去掉 vN)多个版本只保留【最高版本】的 path;
//     并为 canonical id 及每个见过的版本 id 都建立别名,统一指向最高版本笔记,
//     这样前端无论用 v1/v2 还是无版本 id 查询都能命中当前笔记
//     (旧版本被 maintain-version-refresh 刷新后,别名仍解析到新笔记)。
//   - 每条额外输出 title 字段(从 frontmatter 读 title_zh 优先,
//     fallback title,缺失则 null)给 settings 页"已隐藏论文"面板做映射。
//   - 失败兜底:docs 不存在时仍写 {} (不阻塞 dev)
//   - 输出扁平 hash map,前端 O(1) 命中,
//     每条 ~80B × 上千条 ≈ 上百 KB,可接受
//
// 这文件:被 package.json 的 predev/prebuild 钩子触发,
// 不被 Astro 自身 require,所以用 .mjs 够用,不进 TS 编译路径。

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import matter from 'gray-matter';

const ROOT = process.cwd();
const DOCS_DIR = join(ROOT, 'docs');
const OUT = join(ROOT, 'public', 'arxiv-index.json');

// ⚠ 必须兼容 arXiv 之外的来源文件:bioRxiv / medRxiv / chemRxiv / conferences
// / topic-seeds —— 这些文件名都不带 arXiv id,不能被单轨正则匹配。
// 由于这是论文库主索引(唯一真值),它必须收录**所有**论文,不能漏。
//
// 双轨抽取:
//   1) 文件名匹配 arXiv id 形如 YYMM.NNNNNvN → 抽 canonical + arxivId
//   2) 文件名以 biorxiv/medrxiv/chemrxiv/topic/conference 开头 → 整个文件名
//      作为合成 id(arxivId 留空),这样下游 papers/<id>.html 路径唯一。
const ARXIV_ID_RE = /^(\d{4}\.\d{4,5})(?:v\d+)?/;
const NON_ARXIV_PREFIX_RE = /^(biorxiv|medrxiv|chemrxiv|topic|conference)/;

// 从带版本 id 拆出 canonical id 与版本号(无版本按 v0 处理,让任意带版本 id 胜出)。
function splitVersion(id) {
  const m = id.match(/^(\d{4}\.\d{4,5})(?:v(\d+))?$/);
  if (!m) return { canonical: id, version: 0 };
  return { canonical: m[1], version: m[2] ? Number(m[2]) : 0 };
}

// 读 frontmatter 提 title_zh / title;frontmatter 损坏或缺失则 null。
// 用 gray-matter 是因为它已经是项目依赖,且 lib/paper.ts 里用过,
// 解析规则一致(包括 title_zh 缺失时 fallback title 的约定)。
// 标题可能含 inline TeX(如 `$\max$@$k$`),settings "已隐藏论文" 面板是纯文本 UI,
// 优先取 pipeline 预算好的 title_*_plain,缺失时轻量剥一遍 TeX 标记再兜底。
function stripTitleMarkupLite(value) {
  let text = String(value || '');
  // 成对 $...$ / $$...$$ 内的命令名保留、符号剥掉;未成对 $ 最后统一删。
  text = text.replace(/\$+/g, ' ');
  text = text.replace(/\\([A-Za-z]+)/g, '$1'); // \max -> max
  text = text.replace(/[{}^_~]/g, '');
  return text.replace(/\s+/g, ' ').trim();
}

function readTitle(absPath) {
  try {
    const raw = readFileSync(absPath, 'utf-8');
    const fm = matter(raw);
    const d = fm.data || {};
    const zh = d.title_zh_plain || (d.title_zh ? stripTitleMarkupLite(d.title_zh) : '');
    const en = d.title_plain || (d.title ? stripTitleMarkupLite(d.title) : '');
    return zh || en || null;
  } catch {
    return null;
  }
}

/** 双轨文件名校准:从 base 文件名抽 { canonical, arxivId }。
 *  返回 null = 既不是 arXiv 文件也不是已知前缀,跳过(例如 README.md / path-spec.md)。 */
function extractIdFromFilename(base) {
  const m = base.match(ARXIV_ID_RE);
  if (m) {
    const arxivId = m[1];
    return {
      canonical: arxivId.replace(/v\d+$/i, ''),
      arxivId,
    };
  }
  if (NON_ARXIV_PREFIX_RE.test(base)) {
    return {
      canonical: base.replace(/\.md$/, ''),
      arxivId: '',
    };
  }
  return null;
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(p));
    else if (name.isFile() && p.endsWith('.md')) out.push(p);
  }
  return out;
}

function main() {
  const files = walk(DOCS_DIR);
  // canonical id -> { version, rel, seenIds:Set, title } —— 每个 canonical 只保留最高版本笔记
  const best = Object.create(null);
  let matched = 0;
  for (const f of files) {
    const base = f.split(/[\\/]/).pop();
    const id = extractIdFromFilename(base);
    if (!id) continue;
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    // 非 arXiv 文件没有版本号概念(version 恒为 0),靠 rel.length 兜底。
    const { version } = splitVersion(id.arxivId || base);
    matched++;
    const prev = best[id.canonical];
    if (!prev) {
      best[id.canonical] = {
        version, rel, seenIds: new Set([id.canonical]), arxivId: id.arxivId, title: readTitle(f),
      };
      continue;
    }
    prev.seenIds.add(id.canonical);
    // 版本更高胜出;版本相同则取更短 path(稳定兜底)
    // —— title 只在 prev.title 为 null 时才补读,避免最高版本的 title 被旧版本覆盖。
    if (version > prev.version || (version === prev.version && rel.length < prev.rel.length)) {
      prev.version = version;
      prev.rel = rel;
      if (id.arxivId) prev.arxivId = id.arxivId;
      if (!prev.title) prev.title = readTitle(f);
    }
  }

  // 展开为扁平别名表:canonical id + 见过的每个版本 id 都指向最高版本 path。
  // 形态变化:从 { id: rel } 改为 { id: { rel, title } },settings 页"已隐藏论文"面板
  // 通过 id 查 title 做映射。空 title 用 null 表示,前端展示时 fallback "标题未解析"。
  const idx = Object.create(null);
  for (const [canonical, info] of Object.entries(best)) {
    idx[canonical] = { rel: info.rel, title: info.title };
    for (const seen of info.seenIds) idx[seen] = { rel: info.rel, title: info.title };
  }

  // 排序让 git diff 稳定
  const sorted = Object.fromEntries(Object.entries(idx).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OUT, JSON.stringify(sorted) + '\n', 'utf-8');

  const ids = Object.keys(sorted);
  // eslint-disable-next-line no-console
  console.log(`[arxiv-index] scanned ${files.length} md files, matched ${matched}, indexed ${ids.length} entries -> public/arxiv-index.json`);
  if (ids.length && ids.length < 5) {
    // eslint-disable-next-line no-console
    console.log(`  sample: ${ids.slice(0, 5).join(', ')}`);
  }
}

main();