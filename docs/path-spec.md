# `docs/` 路径规范（唯一权威）

本文档是论文笔记在 `docs/` 下的目录与文件名约定的**唯一权威**。**任何**新增 / 移动 / 重命名文件前都必须先读它。

## 1. 目录命名

所有论文统一进 `docs/papers/`，按 arXiv id 升序自然排列（因 `YYMM.NNNNN` 前缀本身就是字典序的提交时间）。

| 写法 | 对应 Astro 路由 |
|---|---|
| `docs/papers/<arxiv-id>-<slug>.md` | `astro-src/pages/papers/[arxiv].astro` |

**id 段数 = 1**（去掉 `papers/` 后的文件名）。`astro-src/lib/paper.ts` 的 `walk()` 跳过 `_*` 前缀目录与 `tutorial/` / `assets/` / `plans/`，扫到的 `.md` 一律视为论文。

旧的 `docs/<bucket>/...` 三种目录命名（`YYYYMM/DD/`、`YYYYMMDD-YYYYMMDD/` 单日或区间）已于 2026-07 扁平化移除——git 历史里仍可通过 `git log --follow docs/papers/<id>.md` 找到论文沿革。

## 2. 文件名约定

论文 markdown 文件名 = `<arxiv-id>-<slug>.md`：

- `<arxiv-id>` 必须是 arXiv 短 ID（`YYMM.NNNNN`，可带版本尾巴，如 `v1`、`v2`）。
- `<slug>` 是 ASCII kebab-case 标题摘要，由 `src/6.generate_docs.py:slugify` 生成。
- 同 ID 多版本只保留最高版本（v 越大越新）。**重复检查**由 `astro-src/scripts/build-arxiv-index.mjs` 自动做：按 canonical id（去掉 `vN`）分组，保留最高版本的 path，并为 canonical id 及每个见过的版本 id 建立别名统一指向该 path，因此前端无论用 `v1`/`v2` 还是无版本 id 查询都命中当前笔记。
- **版本落后自动刷新**：`.github/workflows/maintain-version-refresh.yml`（每周一，或手动触发）跑 `src/maintain/refresh_versions.py`，扫描本目录论文、对比 arXiv 最新版本，落后者用 `src/6.generate_docs.py --paper-id` 重生成新版本笔记并删除旧版本 `.md`/`.txt`/图目录，保持“v 越大越新”。

伴随文件：

- `<arxiv-id>-<slug>.txt`：PDF 抽取的正文（ArXiv 摘要 + intro + 部分正文），由 pipeline 留作 cache；站点不消费。
- `figures/arxiv/<id>/fig-*.webp`、`assets/figures/arxiv/<id>/fig-*.webp`：论文图，markdown 中以相对路径 `assets/figures/arxiv/<id>/fig-NNN.webp` 引用。

`docs/README.md` 是站点首页内容（由 `src/6.generate_docs.py:sync_home_readme_from_day_report` 生成）。

## 3. `Paper.yearMonth` / `day` 派生

扁平化后 id 不再含日期段，但 `Paper` 接口保留这两个字段以避免下游消费者大规模改动：

- `yearMonth`：从 `arxivId.split('.')[0]` 取（如 `2606.27814v1` → `"2606"`）。
- `day`：从 `frontmatter.date.slice(8, 10)` 取（ISO `YYYY-MM-DD` 后两位）；缺 date 时为空字符串。

排序仍由 `frontmatter.date` 主导，`yearMonth`/`day` 只是显示用。

## 4. 不要放在 `docs/` 下

以下文件类型**应当**放在别处：

| 类型 | 正确位置 | 原因 |
|---|---|---|
| 内部方案 / 计划文档 | `plans/`（PR #9 已迁） | 不应混入站点数据路径 |
| `.py` / `.js` / `.mjs` / `.sh` 等实验脚本 | `.scratch/`（gitignored）或 `scripts/` | 站点只消费 MD / 图片 / sidebar |
| 截图 / 教程配图 | `docs/tutorial/` 或 `others/`（详见方案 PR #10） | 与 README 引用相对稳定 |
| `_home_*.md`、`_404.md`、`_sidebar.md`、`config.yaml`、`tutorial/`、`assets/`、`README.md` | 仍在 `docs/` 顶层 | 站点外壳 |
| `papers/` | 仍在 `docs/` 下 | 唯一论文目录，不要移到别处 |

注意：`_` 前缀的目录会被 [astro-src/lib/paper.ts](astro-src/lib/paper.ts) 的 walk **跳过**，不会进入论文扫描路径——所以如果某个内部目录必须暂存在 `docs/` 下，用 `_` 前缀是最安全的临时挂法。

## 5. Astro 是怎么扫 `docs/` 的（避免误改）

- [`astro-src/lib/paper.ts`](astro-src/lib/paper.ts)：列出所有论文 ID，把 id 喂给对应路由。
- [`astro-src/scripts/build-arxiv-index.mjs`](astro-src/scripts/build-arxiv-index.mjs)：用正则 `^(\d{4}\.\d{4,5}(?:v\d+)?)` 从文件名提 ID，写到 `public/arxiv-index.json`。**不会**进新文件。
- `functions/api/proxy.ts`：站点运行时的 arXiv CORS 反代，与路径规范无关。（仓库内 `edge-functions/proxy.ts` 已在 2026-07-06 删除。）

任何新增 / 删除前要跑一次 `node astro-src/scripts/build-arxiv-index.mjs` 看新索引与预期一致，再 `npm run build`。

## 6. 修改 / 新增 checklist

1. 文件名是否符合 `<arxiv-id>-<slug>.md`？
2. 是否同步更新 `docs/_sidebar.md`？（pipeline 自动维护，但手工新增的论文要去 sidebar 注册）
3. `node astro-src/scripts/build-arxiv-index.mjs` 跑过且索引文件无意外增量？
4. `npm run build` 是否成功？