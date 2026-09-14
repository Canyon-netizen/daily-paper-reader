---
name: paper-retrieval-recovery
description: 22 天无新论文的根因诊断 + 手动恢复步骤(2026-09-14)
metadata:
  type: project
  date: 2026-09-14
---

# 论文抓取 Pipeline 恢复手册

## 问题

`docs/papers/` 最后一批论文日期:**2026-08-23**
今天:**2026-09-14**
距离今天:**22 天** — 中间 22 天没有新论文入库。

## 根因诊断(3 个最可能)

### 1. GitHub Actions scheduled workflow 被禁用(概率最高)

GitHub 在仓库 **连续 60 天没有任何 push / issue / PR 活动** 时,**自动暂停** scheduled workflows(包括 daily cron)。

诊断:`Actions` tab → 选 `daily-paper-reader` workflow → 查看最近 run 时间。如果过去 22 天完全没有记录,且 repo 之前有空闲期,这是根因。

**修复**:
- 任意 push / issue / PR 即可唤醒(cron 会在下次唤醒后立即触发)
- 或:GitHub repo Settings → Actions → 启用 "Allow GitHub Actions to create and approve pull requests" + 改 cron 频率

### 2. Workflow 跑了但 `python -m src.main` 静默失败(概率中)

`daily-paper-reader.yml` 的最后一步是 `python -m src.translate_polaris || echo "失败"`,故意不 fail-fast。如果 retrieve 阶段就失败,后续也不会报错。

诊断:看 Actions log 的 `Run Retrieval and Embedding` step。如果这一段失败但被吞了,根因在此。

**修复**:
- 临时:`fetch_days=30` 手动 trigger `workflow_dispatch`,从 GH Actions UI 跑一遍
- 长期:加 fail-fast + Slack/Discord webhook 通知(参考 PR 2026-08 TODO 列表)

### 3. arXiv API 限流或网络超时(概率低)

`fetch_arxiv` 失败重试机制可能卡在 429 rate limit。

诊断:看 retrieve step log,会有大量 "429 Too Many Requests"。

**修复**:重试 + 加 retry-after header 解析。

## 手动恢复步骤(任选一种)

### 方案 A:GitHub Actions UI(推荐)

1. 打开 GitHub repo → Actions → `daily-paper-reader` → Run workflow
2. inputs 填:
   - `fetch_days`: `30`(回溯 30 天)
   - `fetch_mode`: `auto`
   - 其他留空
3. 点 Run → 等 30-60 分钟
4. workflow_dispatch 没有 0-3599s 随机延迟,比 cron 快

### 方案 B:本地跑 Python pipeline

```bash
cd /path/to/daily-paper-reader
# 配置 DPR_GIST_ID / DPR_GIST_TOKEN 等 env vars
export DPR_GIST_ID=<your-gist-id>
export DPR_GIST_TOKEN=<your-gist-token>
export LLM_API_KEY=<key>
export LLM_BASE_URL=https://api.minimaxi.com/v1
export LLM_MODEL=MiniMax-M2.7-highspeed

# 跑主 pipeline(7-30 天 fetch_days)
python -m src.main --fetch-days 30 --embedding-device cpu --embedding-batch-size 8

# 跑翻译(可选,给新论文补 5 节中文解读)
python -m src.translate_polaris --concurrency 4

# commit & push
git add docs/papers archive/*/recommend
git commit -m "manual: 手动跑 pipeline 恢复 22 天停滞"
git push origin main
```

注意:本地跑需要:
- Python 3.11+
- pdffigures2.jar(从 GH workflow 看,首次跑会 git clone + sbt assembly,需 ~10 分钟)
- Java 17(同上)
- SUPABASE / VOYAGE 等 secrets(env vars)
- ~2GB disk(embedding 模型 + cache)

### 方案 C:跳过 main pipeline,只跑补翻译

如果 paper 已经存在但 5 节中文解读不全(例如 22 天前抓的新论文没翻译):

```bash
python -m src.translate_polaris --concurrency 4
```

这个 idempotent(已 5 节齐全会 skip),可以安全重复跑。

## 预防措施

| 措施 | 描述 |
|------|------|
| **加 status badge** | 在 README 顶部加 `![](https://github.com/<user>/<repo>/actions/workflows/daily-paper-reader.yml/badge.svg)`,一眼看 cron 健康度 |
| **加 Slack/Discord 通知** | 在 workflow 最后 step 加 notify,失败立即知道(已有 PR 雏形) |
| **降 fetch_days 到 5-7 天** | 当前 daily cron 默认 fetch_days=7,但 GH workflow 注释说"30 天全量 ~110 分钟"—— 单次跑长会让 GH 触发 6h timeout 边角。建议加 `--fetch-days 5` 默认 |
| **maintain-version-refresh 每周一** | 已配置,会自动把老论文更新到最新 arxiv version。无需额外操作 |

## 已知 pipeline bug(参考 `docs/TODO-future-work.md`)

- `translate_parallel` 去重 bug:同一篇论文被复制到多个日期目录(07/29、07/30、07/31、08/02、08/03),脚本只处理第一个匹配。**最新版未翻译,而旧版已翻译。** 修法:按 canonical arxiv id 去重,只翻译最新一份。
- `extractWikiArticle` 旧标题兼容:旧版用 `## TLDR` / `## 动机`,新版用 `## 讨论与可借鉴点` / `## 结论`,翻译时漏识别老论文是否已译。

---

**变更日志**
- 2026-09-14:首次建立(22 天无新论文 P0 修复指南)