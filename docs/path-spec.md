# `docs/` 路径规范（唯一权威）

本文档是论文笔记在 `docs/` 下的目录与文件名约定的**唯一权威**。**任何**新增 / 移动 / 重命名文件前都必须先读它。

## 1. 三种目录命名

Astro 静态站用两套动态路由吃这三种目录命名：

| 写法 | 例子 | 何时生成 | 对应 Astro 路由 |
|---|---|---|---|
| `docs/YYYYMM/DD/<arxiv-id>-<slug>.md` | `docs/202607/04/2606.27814v1-atod-….md` | `config.yaml.arxiv_paper_setting.days_window = 9`（默认）且 daily pipeline 跑出 | `astro-src/pages/[ym]/[day]/[arxiv].astro` |
| `docs/YYYYMMDD-YYYYMMDD/<arxiv-id>-<slug>.md` | `docs/20260625-20260704/2606.26155v1-detecting-….md` | `days_window >= 10`（区间拉取）或外部显式 `DPR_RUN_DATE` 给定 1 段区间 | `astro-src/pages/[period]/[arxiv].astro` |
| `docs/YYYYMMDD-YYYYMMDD/<arxiv-id>-<slug>.md`（**单日**） | `docs/20260705-20260705/2510.18483v1-starbench-rpg.md` | paper-analyzer 网页 "📤 保存到 GitHub" 按钮走 `save-paper.yml`，开始日期 == 结束日期 | **两套路由都命中**（id 段数为 2，走 `[period]`） |

历史原因：Astro 路由按 id 段数判定走 `[ym]/[day]/[arxiv]`（3 段）还是 `[period]/[arxiv]`（2 段）。任何 `docs/<…>` 子目录都能共存，**互不影响**。

## 2. 文件名约定

论文 markdown 文件名 = `<arxiv-id>-<slug>.md`：

- `<arxiv-id>` 必须是 arXiv 短 ID（`YYMM.NNNNN`，可带版本尾巴，如 `v1`、`v2`）。
- `<slug>` 是 ASCII kebab-case 标题摘要，由 `src/6.generate_docs.py:slugify` 生成。
- 同 ID 多版本只保留最高版本（v 越大越新）。**重复检查**由 `astro-src/scripts/build-arxiv-index.mjs` 自动做（保留最短 path）。

伴随文件：

- `<arxiv-id>-<slug>.txt`：PDF 抽取的正文（ArXiv 摘要 + intro + 部分正文），由 pipeline 留作 cache；站点不消费。
- `figures/arxiv/<id>/fig-*.webp`、`assets/figures/arxiv/<id>/fig-*.webp`：论文图，markdown 中以相对路径 `assets/figures/arxiv/<id>/fig-NNN.webp` 引用。

`docs/<period>/README.md` 与 `docs/<ym>/<day>/README.md` 是该日期区段的总览，由 `src/6.generate_docs.py` 生成（口径：日报 / 总览）。

## 3. 不要放在 `docs/` 下

以下文件类型**应当**放在别处：

| 类型 | 正确位置 | 原因 |
|---|---|---|
| 内部方案 / 计划文档 | `plans/`（PR #9 已迁） | 不应混入站点数据路径 |
| `.py` / `.js` / `.mjs` / `.sh` 等实验脚本 | `.scratch/`（gitignored）或 `scripts/` | 站点只消费 MD / 图片 / sidebar |
| 截图 / 教程配图 | `docs/tutorial/` 或 `others/`（详见方案 PR #10） | 与 README 引用相对稳定 |
| `_home_*.md`、`_404.md`、`_sidebar.md`、`config.yaml`、`tutorial/`、`assets/`、`README.md` | 仍在 `docs/` 顶层 | 站点外壳 |

注意：`_` 前缀的目录会被 [astro-src/lib/paper.ts:137](astro-src/lib/paper.ts#L137) 的 walk **跳过**，不会进入论文扫描路径——所以如果某个内部目录必须暂存在 `docs/` 下，用 `_` 前缀是最安全的临时挂法。

## 4. Astro 是怎么扫 `docs/` 的（避免误改）

- [`astro-src/lib/paper.ts`](astro-src/lib/paper.ts)：列出所有论文 ID，把 id 拆段（`/`），喂给对应路由。
- [`astro-src/scripts/build-arxiv-index.mjs`](astro-src/scripts/build-arxiv-index.mjs)：用正则 `^(\d{4}\.\d{4,5}(?:v\d+)?)` 从文件名提 ID，写到 `public/arxiv-index.json`。**不会**进新文件。
- `functions/api/proxy.ts`：站点运行时的 arXiv CORS 反代，与路径规范无关。（仓库内 `edge-functions/proxy.ts` 已在 2026-07-06 删除。）

任何新增 / 删除前要跑一次 `node astro-src/scripts/build-arxiv-index.mjs` 看新索引与预期一致，再 `npm run build`。

## 5. 修改 / 新增 checklist

1. 我用的是哪种命名？（看 `config.yaml` 或 paper-analyzer 触发的入口）
2. 文件名是否符合 `<arxiv-id>-<slug>.md`？
3. 是否同步更新 `docs/_sidebar.md`？（pipeline 自动维护，但手工新增的论文要去 sidebar 注册）
4. `node astro-src/scripts/build-arxiv-index.mjs` 跑过且索引文件无意外增量？
5. `npm run build` 是否成功？

## 6. 相关阈值常量

定义在 [`src/main.py:26-34`](src/main.py#L26-L34)：

```python
LONG_RANGE_DAYS_THRESHOLD = 10   # ≥此天数时 daily pipeline 走区间标签(YYYYMMDD-YYYYMMDD)
MAIN_DEFAULT_DAYS = 9            # config.yaml 默认值,<阈值,走单日标签(YYYYMMDD)
SKIMS_FETCH_DAYS_THRESHOLD = 11   # 切换到 arXiv skims API 的阈值
```

修改这些值之前先与 README "方式 A 第 2 步" 说明对齐——它会显示在用户首次跑出的目录结构里。
