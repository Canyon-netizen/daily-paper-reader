---
name: r7-master-plan
description: R7 主 plan — 整合背景审计 + 140 commit 详细施工图,删除重复
metadata:
  type: project
  date: 2026-09-14
  estimated_total_commits: 140
  status: integration
---

# R7 主 Plan — 整合背景审计 + 140 commit 详细施工图

> 本文件是 R7 阶段所有规划产出的**单一权威**。配套以下文件已删除,内容整合进本文:
> - ~~plans/full-pipeline-skill-audit-2026-09-14.md~~
> - ~~plans/full-pipeline-paper-audit-2026-09-14.md~~
> - ~~plans/full-pipeline-folder-audit-2026-09-14.md~~
> - ~~plans/round-7-comprehensive-100-commits.md~~
> - ~~plans/round-7-followup-2026-09-14.md~~
>
> 设计原则:
> 1. 每个 commit 独立可测试可回滚(< 100 行)
> 2. 预留 debug 空间(J.1-J.15)
> 3. 依赖顺序明确(A → B/C → D/E)
> 4. 预算明确(耗时 + 改动规模)

---

## 目录

- [§1 背景:3 大 audit 调研结论](#1-背景3-大-audit-调研结论)
  - [§1.1 Skill 整合 audit](#11-skill-整合-audit)
  - [§1.2 论文 audit](#12-论文-audit)
  - [§1.3 文件夹整合 audit](#13-文件夹整合-audit)
  - [§1.4 调研结论 + 设计路线](#14-调研结论--设计路线)
- [§2 路线图:140 commit × 9 大类](#2-路线图140-commit--9-大类)
- [§3 R7.1 — research-skills → agents 代码层(B.1)](#3-r71--research-skills--agents-代码层)
- [§4 R7.2 — 老论文 cross-link 回填 + 验证(C.1-C.3)](#4-r72--老论文-cross-link-回填--验证)
- [§5 R7.3 — 论文 pipeline 修复(A.1-A.3)](#5-r73--论文-pipeline-修复)
- [§6 R7.4 — 文献库 UX + 数据(D.1-D.2)](#6-r74--文献库-ux--数据)
- [§7 R7.5 — ideas / experiments / writing(E.1-E.4)](#7-r75--ideas--experiments--writing)
- [§8 R7.6 — agents 闭环深化(F.1-F.4)](#8-r76--agents-闭环深化)
- [§9 R7.7+ — concepts / 站点 / 基础设施(G/H/I)](#9-r77--concepts--站点--基础设施)
- [§10 Debug commits 模式 (J.1-J.15)](#10-debug-commits-模式-j1-j15)
- [§11 验证模式 + 用户反馈循环设计](#11-验证模式--用户反馈循环设计)
- [§12 风险与备选](#12-风险与备选)

---

## §1 背景:3 大 audit 调研结论

> 用户原话:「请你根据科研从头到尾全流程能够彻底接管科研的目标调研现有的 skill 还有给出如何彻底整合这个文件夹中内容,还有如何调整之前拉取的文章适应未来的科研需求,然后现在这个里面的论文好像还是有点问题,然后论文好像很久没有更新过了」
>
> 3 个 subagent 并行调研,核心结论如下(详细见各 audit)。

### §1.1 Skill 整合 audit

**7 份本地 skill + Nature 系统 skill + agents 闭环**,三层 skill 已初步建成。

**核心缺口**:
- (1) skill 文档未指向 DPR 工具 / agents CLI
- (2) agents Designer / Modifier 未消费 skill 文档作为 prompt 上下文

**12 阶段 × skill 矩阵** 缺口定位:

| 阶段 | 本地 skill | Nature skill | agents 闭环 | 缺口 |
|------|-----------|--------------|------------|------|
| 1. 方向定位 | ✗(无) | ✗ | `designer.ts` → proposal | 无 skill 教「怎么定义研究问题」 |
| 2. 文献检索 | ✗ | ✓ | `--search-arxiv` | skill 未提工具 |
| 3. 文献筛选 | ✗ | ✗ | `gate.ts` | 无筛选标准 skill |
| 4-5. 论文阅读 | `how-to-read-paper.md` ✓ | ✓ | ✗ | skill 未指明工具 |
| 6. 笔记沉淀 | `4 产出位` | ✗ | ✗ | **P0**:agents 不写 note |
| 7. 概念抽取 | `concepts-system.md` ✓ | ✗ | LLM 离线 | 缺「概念→idea」 |
| 8. Idea 衍生 | ✗ | ✗ | `designer.ts` | 无「笔记→idea」 skill |
| 9. 实验设计 | `experiment-design.md` ✓ | ✗ | `modifier.ts` | skill 未与 agents 对接 |
| 10. 论文写作 | `writing-paper.md` ✓ | ✓ | `--compile-paper` | skill 未指明 |
| 11. 审稿应对 | ✓ | ✓ | `reviewer.ts` | skill 未指明假审稿入口 |
| 12. 投稿 | ✗ | ✓ | `pipeline.p_export` | 无投稿检查清单 |

**已落地**(R6 c4cfe4850): `research-skills/README.md` + `defining-research-question.md` + workflow cross-link。
**R7 落地**: B.1 (agents 注入 skill context)+ E.3 (writing skill)+ I.1.3 (lint enforcement)。

---

### §1.2 论文 audit

**时效性现状**:
- 最后更新: 2026-08-23(22 天前)
- 论文总数: 1153 篇
- 06 月 8 篇 / 07 月 28 篇 / 08 月 22 篇

**3 个最可能根因**:
1. **GH Actions 60 天空闲自动暂停 cron**(概率最高)
2. arXiv API 429 / secrets 未配 / 网络超时
3. translate_parallel 去重 bug(同一论文跨日期目录重复翻译,只翻旧版)

**质量核心问题**:
- categories 字段 1153 篇全空(venue/task/method/type)
- 部分 score 异常(0.95 与 6.0-9.0 混存)
- tags 单一(query:xxx),缺有意义的标签

**已落地**(R6 9296e6c1e): 启发式批量回填 1150 篇 categories。
**R7 落地**: A.1 (workflow cron 修缮)+ A.2 (质量把关工具)+ C (老论文 cross-link 回填)+ E.1 (ideas ↔ paper)+ E.2 (experiments ↔ paper)+ E.3 (writing ↔ paper)。

---

### §1.3 文件夹整合 audit

**整合度 1.8/5**(2026-09-14 评估)

**10 × 10 cross-link 矩阵**:
| 源 \ 目标 | papers | ideas | experiments | writing | library | research-skills | agents |
|----------|--------|-------|-------------|---------|---------|-----------------|--------|
| papers | -      | ✗     | ✗           | ✗       | ✗       | ✗              | ✗     |
| ideas | △(ID) | - | ✗ | ✗ | ✗ | ✗ | ✗ |
| experiments | △(ID) | ✗ | - | ✗ | ✗ | ✗ | ✗ |
| writing | △(ID) | ✗ | ✗ | - | ✗ | ✗ | ✗ |
| library | ✗ | ✗ | ✗ | ✗ | - | ✗ | ✗ |
| research-skills | ✗ | ✓ | ✓ | ✓ | ✗ | 内部 | ✓(已加) |
| agents | ✗ | ✗ | ✗ | ✗ | ✗ | ✓(已加) | - |

**核心结论**:
- 1150+ 篇论文与 4 模块(ideas / experiments / writing / library)完全无 cross-link
- 跨模块搜索/聚合不可用
- 整合后可达 **4.0/5**

**已落地**(R6 b210c6da9): `path-spec.md` §4.5 加 5 个跨模块字段(related_ideas / related_experiments / related_writings / is_milestone / is_orphan)。
**R7 落地**: C.1-C.3 (cross-link 回填 + audit 验证)+ E.1.4 / E.2.5 / E.3.5 (跨模块 UI)+ F.2.1 (citation validation)。

---

### §1.4 调研结论 + 设计路线

**3 audit 共性结论**:
- 科研全流程 12 阶段都有 skill / 代码 / 内容,**但层与层之间没接通**
- **核心抓手**:把 R6 已落地的 schema / 索引文档,推到代码层实际执行

**R7 路线图 9 大类别**:
1. A. 论文 pipeline(15 commits,P0)
2. B. skills ↔ agents 代码层(12,P0)
3. C. frontmatter 回填 + 验证(15,P0)
4. D. Library UX(15,P1)
5. E. ideas/experiments/writing(18,P1)
6. F. agents 深化(18,P1)
7. G. concepts(8,P2)
8. H. 站点(12,P2)
9. I. CI/CD + 测试(12,P2)

---

## §2 路线图:140 commit × 9 大类

| 类别 | commits | 耗时 | 优先级 |
|------|---------|------|--------|
| A. 论文 pipeline | 15 | 6 h | P0 |
| B. skills ↔ agents | 12 | 4 h | P0 |
| C. frontmatter 回填 | 15 | 5 h | P0 |
| D. Library UX | 15 | 5 h | P1 |
| E. ideas/exp/writing | 18 | 6 h | P1 |
| F. agents 深化 | 18 | 6 h | P1 |
| G. concepts | 8 | 3 h | P2 |
| H. 站点 | 12 | 4 h | P2 |
| I. CI/CD + 测试 | 12 | 4 h | P2 |
| **J. debug 预留** | 15 | — | — |
| **合计** | **~140** | **~45 h** | |

**5 波执行序列**:
- **R7.1** = B.1 + J(1-2) — 7 commits,1-2 天
- **R7.2** = C.1-C.3 + J(3-5) — 11 commits,2-3 天
- **R7.3** = A + D 部分 + J(6-8) — 15 commits,2-3 天
- **R7.4** = D 余 + E + J(9-11) — 18 commits,1-2 周
- **R7.5+** = F + G/H/I + J(12-15) — 32 commits,2-4 周

---

## §3 R7.1 — research-skills → agents 代码层

> 目标:Designer / Modifier / Reviewer / Reviser 真正消费 `docs/research-skills/*.md` 作为 prompt 上下文

### B.1.1 `feat(agents): lib/agents/skill-context-loader.ts 新增`

**Files**:
- 新建 `astro-src/scripts/agents/skill-context-loader.ts`(~80 行)

**Implementation**:
```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type AgentStage = 
  | 'ideation' | 'literature' | 'experiment' | 'draft' | 'review' | 'revise';

const DOCS_ROOT = 'docs/research-skills';

const STAGE_TO_SKILL: Record<AgentStage, string[]> = {
  ideation:   ['defining-research-question.md'],
  literature: ['how-to-lit-review.md', 'how-to-read-paper.md'],
  experiment: ['experiment-design.md'],
  draft:      ['writing-paper.md'],
  review:     ['reviewer-mindset.md', 'writing-review.md'],
  revise:     ['writing-rebuttal.md'],
};

export function loadSkillContext(stage: AgentStage): string {
  const files = STAGE_TO_SKILL[stage] ?? [];
  const parts: string[] = [`[方法论上下文 · stage=${stage}]`];
  for (const f of files) {
    const path = join(DOCS_ROOT, f);
    try {
      const content = readFileSync(path, 'utf8');
      parts.push(`### ${f}\n${content.slice(0, 3000)}`);
    } catch (e) {
      parts.push(`### ${f}\n(WARN: ${(e as Error).message})`);
    }
  }
  return parts.join('\n\n');
}
```

**Verification**:
```bash
node -e "
const { loadSkillContext } = require('./astro-src/scripts/agents/skill-context-loader.ts');
console.log(loadSkillContext('draft').slice(0, 500));
"
# 预期:[方法论上下文 · stage=draft] + writing-paper.md 内容
```

**Risks**: skill 文档总大小 ~30KB,截断 3000 字后 ~24KB,可控。失败 graceful。

---

### B.1.2 `feat(agents): designer.ts 注入 experiment-design.md`

**Files**: 改 `astro-src/scripts/agents/designer.ts`(+15 行)

**Implementation**:
```typescript
import { loadSkillContext } from './skill-context-loader';

// 在 buildDesignerPrompt() 函数里,system prompt 顶部注入
const skillContext = loadSkillContext('ideation');
const systemPrompt = `${skillContext}\n\n${baseSystemPrompt}`;
```

**Verification**:
```bash
node astro-src/scripts/agents-run.mjs --quickstart "test research direction"
cat archive/<sid>/rounds/round_001.json | python -c "
import json, sys
d = json.load(sys.stdin)
system = d.get('system', '') or d.get('system_prompt', '')
print(system[:500])
"
# 预期:首段含 "[方法论上下文 · stage=ideation]" + defining-research-question.md
```

**Risks**: prompt +6KB,LLM cost +10%。

---

### B.1.3 `feat(agents): modifier.ts 注入 writing-paper.md`

**Files**: 改 `astro-src/scripts/agents/modifier.ts`(+15 行)

**Implementation**:
```typescript
const MOD_TYPE_TO_STAGE: Record<string, AgentStage> = {
  paper_draft: 'draft',
  experiment_plan: 'experiment',
  literature_review: 'literature',
  rebuttal: 'revise',
};

const stage = MOD_TYPE_TO_STAGE[deliverableType] ?? 'draft';
const skillContext = loadSkillContext(stage);
```

**Verification**:
```bash
grep -l "writing-paper.md" archive/<sid>/rounds/*.json
```

---

### B.1.4 `feat(agents): reviewer.ts 注入 reviewer-mindset.md`

**Files**: 改 `astro-src/scripts/agents/reviewer.ts`(+15 行)
**stage='review'**。reviewer 输出 5 维评分不变,只 perspective 变。

### B.1.5 `feat(agents): reviser.ts 注入 writing-rebuttal.md`

**Files**: 改 `astro-src/scripts/agents/reviser.ts`(+15 行)
**stage='revise'**。

### B.1.6 `test(agents): skill-context-loader 单单`

**Files**: 新建 `astro-src/scripts/agents/skill-context-loader.test.ts`(~80 行)

```typescript
import { loadSkillContext } from './skill-context-loader';
import { describe, it, expect } from 'vitest';

describe('skill-context-loader', () =&gt; {
  it('ideation 含 defining-research-question', () =&gt; {
    expect(loadSkillContext('ideation')).)).toContain('defining-research-question.md');
  });
  // ... 6 个 stage 全测
});
```

**Verification**: `bun test astro-src/scripts/agents/skill-context-loader.test.ts`

### B.1.7 `feat(agents): CLI 启动时提示 research-skills 存在`

**Files**: 改 `astro-src/scripts/agents-run.mjs`(+10 行)

```javascript
console.log('💡 提示:见 docs/research-skills/ 7 份方法论文档');
console.log('   Designer / Modifier 等 agents 已自动消费对应 skill');
```

---

## §4 R7.2 — 老论文 cross-link 回填 + 验证

> 目标:1152 篇论文自动加 `related_ideas / related_experiments / related_writings` 字段

### C.1.1 `feat(tools): paper-backfill-crosslinks.mjs — LLM 推断 related_*`

**Files**: 新建 `astro-src/scripts/paper-backfill-crosslinks.mjs`(~200 行)

```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

function loadCandidates(dir) {
  const out = [];
  for (const f of readdirSync(join('docs', dir))) {
    if (!f.endsWith('.md')) continue;
    const content = readFileSync(join('docs', dir, f), 'utf8');
    const title = content.match(/^# (.+)$/m)?.[1] ?? ??;
    const body = content.split('\n---\n')[1]?.slice(0, 200) ?? '';
    out.push({ path: `docs/${dir}/${f}`, title, body });
  }
  return out;
}

async function inferRelated(paper, candidates) {
  const candidatesStr = candidates.slice(0, 50).map((c, i) =&gt; 
    `${i}. [${c.path}] ${c.title} — ${c.body.slice(0, 100)}`
  ).join('\n');
  // 调 LLM(用 8124 代理 per memory llm-proxy-8124)
  // 解析 JSON 返回 paths
}

function heuristicRelated(paper, candidates) {
  const out = { related_ideas: [], related_experiments: [], related_writings: [] };
  for (const tag of paper.tags ?? []) {
    if (tag.startsWith('query:')) continue;
    const matches = candidates.ideas.filter(c =&gt; c.title.toLowerCase().includes(tag.toLowerCase()));
    out.related_ideas.push(...matches.slice(0, 2).map(c =&gt; c.path));
  }
  return out;
}

function writeRelated(raw, related) {
  // regex 替换 related_* 块,merge 已有的 + 新推断
}
```

**Verification**:
```bash
node astro-src/scripts/paper-backfill-crosslinks.mjs --dry-run --limit 5
```

**Risks**: LLM 幻觉 → invalid path;mitigation:audit-crosslinks 自动检测。

### C.1.2 `feat(tools): paper-backfill-crosslinks 启发式 fallback`

合并到 C.1.1。

### C.1.3 `feat(tools): paper-backfill-crosslinks --limit dry-run`

合并到 C.1.1。

### C.1.4 `feat(tools): paper-mark-milestones.mjs`

**Files**: 新建 `astro-src/scripts/paper-mark-milestones.mjs`(~120 行)

```javascript
#!///  heuristics:
// 1. venue == NeurIPS/ICML/ICLR + year <= 2024 + title 含 "first"/"novel"/"breakthrough" → milestone
// 2. arxiv citations > 100 → milestone(fallback 到白名单)
// 3. docs/library/milestone-whitelist.md → milestone(用户手填白名单)
// CLI:
//   --check: 显示每篇论文的 milestone 推断,不要写
//   --apply: 写入 is_milestone 字段
//   --limit N: 仅前 N 篇
```

**Verification**:
```bash
node astro-src/scripts/paper-mark-milestones.mjs --check --limit 10
```

### C.1.5 `feat(tools): paper-compute-resource-tier.mjs`

**Files**: 新建 `astro-src/scripts/paper-compute-resource-tier.mjs`(~100 行)

```javascript
#!///  从 title/abstract 推断 resource_tier (small/medium/large/xlarge)
// 启发式:
// - 单 GPU / < 1B params / toy dataset → small
// - 1-8 GPU / < 8B params / 1K-100K samples → medium
// - 8-64 GPU / 8B-70B params / 100K-1M samples → large
// - 100+ GPU / 70B+ params / 1M+ samples → xlarge
```

### C.2.1 `data(papers): apply backfill-crosslinks --all`

**Files**: 1152 篇 paper.md(+~9K 行)

```bash
node astro-src/scripts/paper-backfill-crosslinks.mjs --apply --all
# 预期:~10-30 分钟
```

**Verification**:
```bash
node -e "
const fs = require('fs');
let bad = 0;
for (const f of fs.readdirSync('docs/papers', {recursive: true})) {
  if (!f.endsWith('.md')) continue;
  const content = fs.readFileSync('docs/papers/' + f, 'utf8');
  // ... 检查 related_* 路径是否存在
}
"
```

### C.2.2 `data(papers): apply mark-milestones --apply`

### C.2.3 `data(papers): apply compute-resource-tier --all`

### C.3.1 `feat(tools): audit-crosslinks.mjs — 验证每篇论文`

**Files**: 新建 `astro-src/scripts/audit-crosslinks.mjs`(~120 行)

```javascript
#!///  扫 docs/papers/**/*.md,每篇检查:
//   - related_ideas / related_experiments / related_writings 至少有 1 个非空
//   - 或 is_orphan: true
//   - 引用的 path 必须存在
//
// CLI:
//   --check: 列出失败论文
//   --fix: 自动加 is_orphan: true
//   --ci: 失败 exit 1
```

**Verification**:
```bash
node astro-src/scripts/audit-crosslinks.mjs --check
node astro-src/scripts/audit-crosslinks.mjs --ci
```

### C.3.2 `feat(tools): audit-crosslinks --ci exit code`

合并到 C.3.1。

### C.3.3 `feat(ci): ci.yml 跑 audit-crosslinks`

**Files**: 改 `.github/workflows/ci.yml`(+10 行)

```yaml
- name: Audit cross-links
  run: node astro-src/scripts/audit-crosslinks.mjs --ci
```

### C.3.4 `feat(tools): audit-crosslinks --fix 自动加 is_orphan`

合并到 C.3.1。

### C.3.5 `test(tools): audit-crosslinks 单测`

**Files**: 新建 `astro-src/scripts/audit-crosslinks.test.ts`(~80 行)

---

## §5 R7.3 — 论文 pipeline 修复

### A.1.1 `fix(workflow): daily-paper-reader cron 防 60 天空闲暂停`

**Files**: 改 `.github/workflows/daily-paper-reader.yml`(+25 行)

```yaml
on:
  schedule:
    - cron: "30 18 * * *" # 每天 UTC 18:30
    # ⚠️ GH Actions 60 天无活跃 commit 会暂停 cron,加每周一唤醒
    - cron: "0 0 * * 1"  # 每周一 00:00 UTC
  workflow_dispatch:
    inputs:
      fetch_days:
        default: "5"
```

**Verification**:
```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/daily-paper-reader.yml'))"
```

**Risks**: 周一空跑 commit 污染 git log → 加 `[skip ci]` 标记。

### A.1.2 `feat(workflow): 加 status badge + Slack webhook 失败通知`

**Files**: 改 `.github/workflows/daily-paper-reader.yml`(+35 行),改 `docs/README.md`(+3 行)

```yaml
- name: Notify failure
  if: failure()
  run: |
    if [ -n "${{ secrets.SLACK_WEBHOOK }}" ]; then
      curl -X POST "${{ secrets.SLACK_WEBHOOK }}" \
        -H "Content-Type: application/json" \
        -d '{"text": "❌ daily-paper-reader failed","attachments":[{"color":"danger","fields":[{"title":"Run ID","value":"${{ github.run_id}}"}]}]}'
    fi
```

README.md badge:
```markdown
[![daily-paper-reader](https://github.com/.../actions/workflows/daily-paper-reader.yml/badge.svg)](...)
```

### A.1.3 `feat(workflow): 降 fetch_days 默认到 5 天`

**Files**: 改 `.github/workflows/daily-paper-reader.yml`(1 行)

```yaml
fetch_days:
  default: "5"
```

### A.1.4 `fix(pipeline): arXiv API 429 加 retry-after 解析`

**Files**: 改 `src/maintain/fetchers/fetch_arxiv.py`(+40 行)

```python
import time
import urllib.request
import urllib.error

def fetch_with_retry(url: str, max_retries: int = 5) -> dict:
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url)
            req.add_header("User-Agent", "daily-paper-reader/1.0")
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry_after = int(e.headers.get("Retry-After", 2 ** attempt))
                print(f"[WARN] arXiv 429, waiting {retry_after}s")
                time.sleep(retry_after)
                continue
            raise
    raise Exception(f"arXiv 429 after {max_retries} retries")
```

**Verification**:
```bash
python -c "from src.maintain.fetchers.fetch_arxiv import fetch_with_retry; print('OK')"
```

### A.1.5 `feat(pipeline): main.py 加 fail-fast + 错误日志`

**Files**: 改 `src/main.py`(+25 行)

```python
import sys, traceback

def setup_global_exception_handler():
    def handle_exception(exc_type, exc_value, exc_traceback):
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_traceback)
            return
        error_msg = "".join(traceback.format_exception(exc_type, exc_value, exc_traceback))
        print(f"[FATAL]", flush=True)
        print(error_msg, flush=True)
        log_path = os.path.join(ROOT_DIR, "archive", "pipeline_error.log")
        with open(log_path, "a") as f:
            f.write(f"[{datetime.now(timezone.utc).isoformat()}] FATAL\n{error_msg}")
        sys.exit(1)
    sys.excepthook = handle_exception

def main():
    setup_global_exception_handler()
    # ...
```

### A.2.1 `feat(tools): paper-validate.mjs frontmatter schema 校验`

**Files**: 新建 `astro-src/scripts/paper-validate.mjs`(~120 行)

```javascript
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { globby } from 'glob';

const REQUIRED_FIELDS = [
  'title', 'title_zh', 'authors', 'date', 'pdf',
  'score', 'tldr', 'source', 'arxiv_id', 'canonicalArxivId'
];

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 4);
  if (end < 0) return {};
  const fields = {};
  for (const line of content.slice(3, end).split('\n')) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) fields[match[1]] = match[2].trim();
  }
  return fields;
}

function validatePaper(filePath, content) {
  const errors = [];
  const fields = parseFrontmatter(content);
  for (const field of REQUIRED_FIELDS) {
    if (!fields[field] || fields[field] === '') {
      errors.push(`missing required field: ${field}`);
    }
  }
  const score = parseFloat(fields.score);
  if (!isNaN(score) && (score < 0 || score > 1)) {
    errors.push(`invalid score: ${fields.score}`);
  }
  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const ciMode = args.includes('--ci');
  const limitMatch = args.find(a =&gt; a.startsWith('--limit='));
  const limit = limitMatch ? parseInt(limitMatch.split('=')[1]) : Infinity;
  
  const papers = await globby('docs/papers/**/*.md');
  const failed = [];
  
  for (const paper of papers) {
    if (failed.length >= limit) break;
    const content = readFileSync(paper, 'utf8');
    const errors = validatePaper(paper, content);
    if (errors.length > 0) {
      failed.push({ path: paper, errors });
    }
  }
  
  console.log(`📊 Checked ${papers.length}, ${failed.length} failed`);
  if (ciMode && failed.length > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
```

**Verification**: `node astro-src/scripts/paper-validate.mjs --check --limit=10`

### A.2.2 `fix(tools): paper-validate 校验 abstract vs tldr 长度`

**Files**: 改 `astro-src/scripts/paper-validate.mjs`(+20 行)

```javascript
function validatePaperLength(content) {
  const errors = [];
  const fields = parseFrontmatter(content);
  const tldrLen = (fields.tldr || '').replace(/\s+/g, '').length;
  const abstractLen = (fields.abstract || '').replace(/\s+/g, '').length;
  if (tldrLen > 0 && tldrLen < 50) errors.push(`tldr too short: ${tldrLen} chars (min 50)`);
  if (abstractLen > 0 && abstractLen < 100) errors.push(`abstract too short: ${abstractLen} chars (min 100)`);
  return errors;
}
```

### A.2.3 `feat(tools): paper-dedupe.mjs 查重`

**Files**: 新建 `astro-src/scripts/paper-dedupe.mjs`(~80 行)

```javascript
#!/usr/bin/env node
import { readFileSync, unlinkSync } from 'node:fs';
import { globby } from 'glob';

function extractCanonicalId(content) {
  return content.match(/canonicalArxivId:\s*([0-9.]+)/)?.[1] ?? null;
}

function extractVersion(id) {
  return parseInt(id.match(/v(\d+)$/)?.[1] ?? '0');
}

async function main() {
  const papers = await globby('docs/papers/**/*.md');
  const idMap = new Map();
  for (const paper of papers) {
    const content = readFileSync(paper, 'utf8');
    const canonical = extractCanonicalId(content);
    if (!canonical) continue;
    const version = extractVersion(canonical);
    const arr = idMap.get(canonical) ?? [];
    arr.push({ path: paper, version });
    idMap.set(canonical, arr);
  }
  
  const toDelete = [];
  for (const [id, versions] of idMap) {
    if (versions.length <= 1) continue;
    versions.sort((a, b) => b.version - a.version);
    toDelete.push(...versions.slice(1).map(v => v.path));
  }
  
  if (process.argv.includes('--delete') && toDelete.length > 0) {
    for (const path of toDelete) unlinkSync(path);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

### A.2.4 `feat(tools): paper-translate-check.mjs 检查 5 节齐全`

**Files**: 新建 `astro-src/scripts/paper-translate-check.mjs`(~60 行)

```javascript
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { globby } from 'glob';

const REQUIRED_SECTIONS = ['## TL;DR', '## 动机', '## 方法', '## 结果', '## 结论'];
const SECTION_ALIASES = {
  '## TL;DR': ['## 摘要', '## TLDR', '## Summary'],
  '## 结论': ['## 讨论与可借鉴点', '## 讨论', '## 结论与展望']
};

function hasSection(body, section) {
  return [section, ...(SECTION_ALIASES[section] || [])].some(a => body.includes(a));
}

async function main() {
  const papers = await globby('docs/papers/**/*.md');
  const failed = [];
  for (const paper of papers) {
    const content = readFileSync(paper, 'utf8');
    const body = content.split('---')[2] || '';
    const missing = REQUIRED_SECTIONS.filter(s => !hasSection(body, s));
    if (missing.length > 0) failed.push({ path: paper, missing });
  }
  if (process.argv.includes('--ci') && failed.length > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
```

### A.2.5 `fix(pipeline): translate_parallel 去重 bug`

**Files**: 改 `src/translate_parallel.py`(+30 行)

```python
import re

def deduplicate_by_canonical_id(papers: list[dict]) -> list[dict]:
    """按 canonical arxiv id 去重,只保留每个 id 的最新版本。
    修复 TODO-future-work.md #1 提到的跨日期目录重复翻译 bug。"""
    seen = {}
    for paper in papers:
        arxiv_id = paper.get('arxiv_id') or paper.get('id') or ''
        canonical = re.sub(r'v\d+$', '', arxiv_id)
        date = paper.get('date', '')
        if canonical not in seen or date > seen[canonical][0]:
            seen[canonical] = (date, paper)
    return [paper for _, paper in seen.values()]

def main():
    # ... 原有逻辑 ...
    all_papers = deduplicate_by_canonical_id(all_papers)
    print(f"[INFO] Deduplicated to {len(all_papers)} unique papers")
```

### A.3.1 `feat(pipeline): papers-freshness-report.mjs`

**Files**: 新建 `astro-src/scripts/papers-freshness-report.mjs`(~80 行)

```javascript
#!/usr/bin/env node
import { statSync } from 'node:fs';
import { globby } from 'glob';
import { basename } from 'node:path';

function daysBetween(date1, date2) {
  return Math.floor(Math.abs(date2 - date1) / (1000 * 60 * 60 * 24));
}

async function main() {
  const warnDays = parseInt(process.argv.find(a => a.startsWith('--warn-days='))?.split('=')[1] || '7');
  const papers = await globby('docs/papers/**/*.md');
  const now = new Date();
  const stale = [];
  for (const paper of papers) {
    if (basename(paper) === 'README.md') continue;
    const days = daysBetween(statSync(paper).mtime, now);
    if (days > warnDays) stale.push({ path: paper, days });
  }
  stale.sort((a, b) => b.days - a.days);
  console.log(`📊 Freshness check (threshold: ${warnDays} days)`);
  console.log(`Total: ${papers.length - 1}, Stale: ${stale.length}`);
  if (process.argv.includes('--ci') && stale.length > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
```

### A.3.2 `feat(ci): 论文新鲜度检查加到 ci.yml`

**Files**: 改 `.github/workflows/ci.yml`(+20 行)

```yaml
paper-freshness:
  name: Paper freshness check
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v5
    - uses: actions/setup-node@v4
      with: { node-version: "20" }
    - run: npm ci
    - run: node astro-src/scripts/papers-freshness-report.mjs --warn-days=14 --ci
```

### A.3.3 `feat(tools): paper-classify-quality.mjs`

**Files**: 新建 `astro-src/scripts/paper-classify-quality.mjs`(~70 行)

```javascript
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { globby } from 'glob';

const QUALITY_RULES = [
  { name: 'tldr_too_short', check: (f) => f.tldr && f.tldr.length < 30 },
  { name: 'no_abstract', check: (f) => !f.abstract || f.abstract.length < 50 },
  { name: 'score_suspicious', check: (f) => {
    const s = parseFloat(f.score);
    return !isNaN(s) && (s < 0.05 || s > 0.95);
  }},
  { name: 'no_method_section', check: (_, body) => !body.includes('## 方法') && !body.includes('## Method') }
];

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 4);
  if (end < 0) return {};
  const fields = {};
  for (const line of content.slice(3, end).split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

async function main() {
  const papers = await globby('docs/papers/**/*.md');
  const lowQuality = [];
  for (const paper of papers) {
    if (paper.endsWith('README.md')) continue;
    const content = readFileSync(paper, 'utf8');
    const front = parseFrontmatter(content);
    const body = content.split('---')[2] || '';
    const issues = QUALITY_RULES.filter(r => r.check(front, body)).map(r => r.name);
    if (issues.length > 0) lowQuality.push({ path: paper, issues });
  }
  if (process.argv.includes('--ci') && lowQuality.length > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
```

---

## §6 R7.4 — 文献库 UX + 数据

### D.1.1 `feat(library): 「从论文创建库」一键按钮`

**Files**: 改 `astro-src/pages/papers/[arxiv].astro`(+40 行),改 `astro-src/scripts/user-libraries-ui.ts`(+60 行)

```astro
<button data-create-library-from-paper={paper.canonicalArxivId}>
  📚 创建文献库
</button>
```

```typescript
document.querySelectorAll('[data-create-library-from-paper]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const arxivId = btn.dataset.createLibraryFromPaper;
    const paperData = window.__PAPER_DATA__?.[arxivId];
    if (!paperData) return;
    
    const modal = document.querySelector('[data-new-library-modal]');
    const openBtn = document.querySelector('[data-open-new-library]');
    if (!modal) { openBtn?.click(); await new Promise(r => setTimeout(r, 300)); }
    
    document.querySelector('[data-modal-name]').value = paperData.title_zh?.slice(0, 30) || paperData.title?.slice(0, 30) || '';
    document.querySelector('[data-modal-statement]').value = paperData.tldr || '';
    document.querySelector('[data-modal-anchor]').value = arxivId;
  });
});
```

**Verification**: dev server 打开论文页 → 点按钮 → modal 自动填好。

### D.1.2 `feat(library): 7 个库 seed template`

**Files**: 改 `astro-src/components/NewLibraryModal.astro`(+50 行),改 `astro-src/scripts/user-libraries-ui.ts`(+40 行)

```typescript
const LIBRARY_TEMPLATES: Record<string, { name: string; statement: string; keywords?: string[] }> = {
  'rl': { name: '强化学习', statement: 'RL 理论、策略优化、探索与利用。', keywords: ['reinforcement learning', 'PPO', 'DQN'] },
  'llm-agent': { name: 'LLM Agent', statement: '工具调用、规划、代码代理。', keywords: ['LLM', 'agent', 'tool use'] },
  'game-ai': { name: '博弈 AI', statement: '博弈代理、在线决策。', keywords: ['game', 'MCTS'] },
  'multi-agent': { name: '多智能体', statement: '合作/竞争多智能体。', keywords: ['multi-agent', 'MARL'] },
  'reasoning': { name: '推理与对齐', statement: '思维链、RLHF、机制可解释。', keywords: ['CoT', 'RLHF'] },
  'robotics': { name: '机器人', statement: '虚实迁移、运动控制。', keywords: ['robotics', 'sim-to-real'] },
  'alignment': { name: '对齐与可解释', statement: '引导向量、潜空间干预。', keywords: ['steering', 'interpretability'] },
};

document.querySelectorAll('[data-template]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tpl = LIBRARY_TEMPLATES[btn.dataset.template!];
    document.querySelector('[data-modal-name]').value = tpl.name;
    document.querySelector('[data-modal-statement]').value = tpl.statement;
    document.querySelector('[data-modal-keywords]').value = tpl.keywords?.join(', ') || '';
  });
});
```

### D.1.3 `feat(library): library merge 检测`

**Files**: 改 `astro-src/scripts/user-libraries-ui.ts`(+50 行)

```typescript
async function checkSimilarLibraries(name: string, statement: string): Promise<string[]> {
  const libs = listUserLibraries();
  const words = new Set((name + ' ' + statement).toLowerCase().split(/\s+/));
  const similar = [];
  for (const lib of Object.values(libs)) {
    const libWords = new Set((lib.name + ' ' + lib.statement).toLowerCase().split(/\s+/));
    const intersection = new Set([...words].filter(x => libWords.has(x)));
    const jaccard = intersection.size / new Set([...words, ...libWords]).size;
    if (jaccard > 0.5) similar.push(lib.name);
  }
  return similar;
}
```

### D.1.4 `feat(library): 库导出 .bib / .md / Obsidian ZIP`

**Files**: 改 `astro-src/scripts/user-libraries-ui.ts`(+80 行)

```typescript
async function exportLibrary(libId: string, format: 'bib' | 'md' | 'zip'): Promise<void> {
  const lib = getUserLibrary(libId);
  const papers = lib.paperIds.map(cx => window.__ALL_PAPERS__?.[cx]).filter(Boolean);
  
  if (format === 'bib') {
    const bib = papers.map(p => `@article{${p.id},\n  title={${p.title}},\n  author={${p.authors?.slice(0,3).join(' and')}},\n  year={${p.date?.slice(0,4)}}\n}`).join('\n\n');
    downloadFile(`${lib.name}.bib`, bib);
  } else if (format === 'md') {
    downloadFile(`${lib.name}.md`, `# ${lib.name}\n\n${lib.statement}\n\n${papers.map(p => `- [[${p.title}]]`).join('\n')}`);
  } else if (format === 'zip') {
    const files = [
      { name: `${lib.name}.md`, content: `# ${lib.name}\n\n${lib.statement}\n\n${papers.map(p => `[[${p.title}]]`).join('\n')}` },
      ...papers.map(p => ({ name: `${p.title.slice(0,50)}.md`, content: `# ${p.title}\n\n${p.tldr}` }))
    ];
    downloadBlob(`${lib.name}.zip`, await createZip(files));
  }
}
```

### D.1.5 `feat(library): 库分享(Gist 自动 sync)`

**Files**: 改 `astro-src/lib/user-libraries/gist.ts`(+30 行),改 `astro-src/scripts/user-libraries-ui.ts`(+40 行)

```typescript
export async function toggleLibraryGistSync(libId: string, enabled: boolean): Promise<void> {
  if (enabled) {
    const gistContent = JSON.stringify({ libraries: { [libId]: getUserLibrary(libId) } }, null, 2);
    const gistId = localStorage.getItem(`dpr_library_gist_${libId}`);
    if (gistId) {
      await updateGist(gistId, { description: `DPR Library: ${libId}`, files: { 'library.json': gistContent } });
    } else {
      const newGist = await createGist({ description: `DPR Library: ${libId}`, files: { 'library.json': gistContent } });
      localStorage.setItem(`dpr_library_gist_${libId}`, newGist.id);
    }
  } else {
    localStorage.removeItem(`dpr_library_gist_${libId}`);
  }
}
```

### D.2.1 `feat(library): library-validate.mjs — schema 校验`

**Files**: 新建 `astro-src/scripts/library-validate.mjs`(~150 行)

```javascript
#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';

const USER_LIBS_PATH = 'docs/library/user-libraries.json';
const REQUIRED_FIELDS = ['id', 'name', 'statement', 'paperIds', 'createdAt', 'updatedAt'];

function loadLibraries() {
  if (!existsSync(USER_LIBS_PATH)) return [];
  return JSON.parse(readFileSync(USER_LIBS_PATH, 'utf8'));
}

function validateLibrary(lib, libId) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (!(field in lib)) errors.push(`Missing required field: ${field}`);
  }
  if (lib.name && (lib.name.length < 1 || lib.name.length > 32)) {
    errors.push(`name length must be 1-32, got ${lib.name.length}`);
  }
  if (Array.isArray(lib.paperIds)) {
    for (const id of lib.paperIds) {
      if (!/^\d{4}\.\d{4,5}$/.test(id)) errors.push(`Invalid paperId: ${id}`);
    }
  }
  return errors;
}

function main() {
  const libs = loadLibraries();
  const allErrors = [];
  for (const [libId, lib] of Object.entries(libs.libraries || {})) {
    const errors = validateLibrary(lib, libId);
    if (errors.length > 0) allErrors.push({ libId, errors });
  }
  if (allErrors.length > 0) {
    console.error('Validation failed:');
    for (const { libId, errors } of allErrors) {
      console.error(`  ${libId}:`);
      for (const e of errors) console.error(`    - ${e}`);
    }
    process.exit(1);
  }
  console.log(`✓ All ${Object.keys(libs.libraries || {}).length} libraries validated`);
}

main();
```

### D.2.2 `feat(library): anchor paper 质量打分`

**Files**: 改 `astro-src/scripts/library-validate.mjs`(+40 行)

```javascript
function validateAnchors(lib) {
  if (!lib.definition?.anchors?.length) return { hasAnchors: false };
  const results = lib.definition.anchors.map(anchor => {
    const paper = findPaperByArxivId(anchor.value);
    return {
      anchor,
      hasPaper: !!paper,
      isHighCitation: paper?.citations > 100,
      isRecent: paper?.date && new Date(paper.date) > new Date('2023-01-01'),
    };
  });
  const highQualityCount = results.filter(r => r.hasPaper && (r.isHighCitation || r.isRecent)).length;
  return { hasAnchors: true, highQualityCount };
}
```

### D.2.3 `feat(library): library 统计页面`

**Files**: 改 `astro-src/pages/libraries/[id].astro`(+60 行)

```typescript
interface LibraryStats {
  paperCount: number;
  avgRelevanceScore: number;
  recentCount: number;
  categoryDistribution: Record<string, number>;
  topAuthors: string[];
}

function computeLibraryStats(lib: UserLibrary, allPapers: PaperListItem[]): LibraryStats {
  const papers = allPapers.filter(p => lib.paperIds.includes(p.id));
  const scores = Object.values(lib.papers || {}).map(p => p.relevanceScore).filter(Boolean);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  
  const catDist: Record<string, number> = {};
  for (const p of papers) {
    for (const c of p.categories || []) catDist[c] = (catDist[c] || 0) + 1;
  }
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentCount = papers.filter(p => p.date && new Date(p.date) >= thirtyDaysAgo).length;
  
  const authorCounts: Record<string, number> = {};
  for (const p of papers) {
    for (const a of p.authors?.slice(0, 3) || []) authorCounts[a] = (authorCounts[a] || 0) + 1;
  }
  const topAuthors = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a]) => a);
  
  return { paperCount: papers.length, avgRelevanceScore: avgScore, recentCount, categoryDistribution: catDist, topAuthors };
}
```

### D.2.4 `feat(library): library freshness 指示器`

**Files**: 改 `astro-src/scripts/user-libraries-ui.ts`(+30 行)

```typescript
function getLibraryFreshness(lib: UserLibrary): { daysAgo: number; label: string; color: string } {
  if (!lib.paperIds.length) return { daysAgo: -1, label: '空库', color: 'gray' };
  const daysAgo = Math.floor((Date.now() - lib.updatedAt) / (1000 * 60 * 60 * 24));
  let label, color;
  if (daysAgo <= 1) { label = '今天更新'; color = 'green'; }
  else if (daysAgo <= 7) { label = `${daysAgo} 天前`; color = 'green'; }
  else if (daysAgo <= 30) { label = `${daysAgo} 天前`; color = 'yellow'; }
  else if (daysAgo <= 90) { label = `${Math.floor(daysAgo / 30)} 个月前`; color = 'orange'; }
  else { label = `${Math.floor(daysAgo / 30)} 个月前`; color = 'red'; }
  return { daysAgo, label, color };
}
```

### D.2.5 `feat(library): library 自动派生 (从 task: 聚合)`

**Files**: 新建 `astro-src/scripts/library-auto-derive.mjs`(~120 行)

```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function collectTaskTags() {
  const taskToPapers = {};
  for (const dir of readdirSync('docs/papers', { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const p of readdirSync(join('docs/papers', dir.name))) {
      if (!p.endsWith('.md')) continue;
      const content = readFileSync(join('docs/papers', dir.name, p), 'utf8');
      const tags = content.match(/tags:\s*\[([^\]]+)\]/)?.[1] || '';
      const id = p.replace('.md', '');
      for (const t of tags.split(',')) {
        const tag = t.trim();
        if (tag.startsWith('task:')) {
          (taskToPapers[tag] = taskToPapers[tag] || []).push(id);
        }
      }
    }
  }
  return taskToPapers;
}

const TASK_TO_LIB = {
  'task:rl': { name: '强化学习', statement: '从 task:rl 标签自动派生' },
  'task:llm-agent': { name: 'LLM Agent', statement: '从 task:llm-agent 标签自动派生' },
  'task:game-ai': { name: '博弈 AI', statement: '从 task:game-ai 标签自动派生' },
};

function autoDeriveFromTasks() {
  const taskToPapers = collectTaskTags();
  const libs = existsSync('docs/library/user-libraries.json') 
    ? JSON.parse(readFileSync('docs/library/user-libraries.json', 'utf8'))
    : { schemaVersion: 1, libraries: {} };
  
  for (const [task, libConfig] of Object.entries(TASK_TO_LIB)) {
    const papers = taskToPapers[task] || [];
    if (papers.length < 5) continue;
    const libId = `auto_${task.replace('task:', '')}`;
    libs.libraries[libId] = {
      id: libId, name: libConfig.name, statement: libConfig.statement,
      paperIds: papers, categories: [task], createdAt: Date.now(), updatedAt: Date.now(),
      hue: 'emerald',
    };
  }
  writeFileSync('docs/library/user-libraries.json', JSON.stringify(libs, null, 2));
}
```

---

## §7 R7.5 — ideas / experiments / writing

### E.1.1 `feat(ideas): 「从论文创建 idea」一键按钮`

**Files**: 改 `astro-src/pages/papers/[arxiv].astro`(+15 行),改 `astro-src/pages/ideas/index.astro`(+10 行)

```astro
<button id="save-as-idea-btn"
  data-arxiv-id={paper.canonicalArxivId || paper.arxivId}
  data-title={plainZh || plainEn}
  data-tldr={paper.tldr}>💡 保存为想法</button>
```

```typescript
document.querySelectorAll('#save-as-idea-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    openIdeaModal({
      prefill: {
        title: `关于 "${btn.dataset.title}" 的想法`,
        description: `源自论文 ${btn.dataset.arxivId}\n\n${btn.dataset.tldr?.slice(0, 500) || ''}`,
        relatedPapers: [btn.dataset.arxivId],
      }
    });
  });
});
```

### E.1.2 `feat(ideas): idea versioning`

**Files**: 改 `astro-src/scripts/ideas-storage.ts`(+40 行)

```typescript
interface IdeaVersion {
  version: number;
  timestamp: number;
  title: string;
  description: string;
  status: IdeaStatus;
}

export function saveIdeaVersion(ideaId: string, updates: Partial<Idea>): void {
  const idea = getIdea(ideaId);
  const newVersion: IdeaVersion = {
    version: idea.currentVersion + 1,
    timestamp: Date.now(),
    title: updates.title ?? ?? idea.title,
    description: updates.description ?? ?? idea.description,
    status: updates.status ?? ?? idea.status,
  };
  idea.versions = [...(idea.versions || []), newVersion];
  idea.currentVersion = newVersion.version;
  updateIdea(ideaId, idea);
}
```

### E.1.3 `feat(ideas): idea status 转换`

**Files**: 改 `astro-src/lib/ideas/types.ts`(+15 行),改 `astro-src/pages/ideas/[id].astro`(+30 行)

```typescript
export type IdeaStatus = 'idea' | 'active' | 'validated' | 'written' | 'archived';

export const IDEA_STATUS_TRANSITIONS: Record<IdeaStatus, IdeaStatus[]> = {
  idea: ['active', 'archived'],
  active: ['validated', 'archived'],
  validated: ['written', 'active', 'archived'],
  written: ['archived'],
  archived: ['idea', 'active'],
};
```

### E.1.4 `feat(ideas): idea ↔ paper cross-link UI`

**Files**: 改 `astro-src/pages/ideas/[id].astro`(+25 行),改 `astro-src/scripts/ideas-ui.ts`(+20 行)

```typescript
function renderRelatedPapersSection(paperIds: string[]): string {
  return `
    <div class="idea-related-papers-section">
      <h4>📄 关联论文</h4>
      <div class="idea-papers-grid">
        ${paperIds.map(pid => `<a href="/papers/${pid}/" class="idea-paper-card">
          <span class="paper-id">${pid}</span>
          <span class="paper-arrow">→</span>
        </a>`).join('')}
      </div>
      <button data-add-paper>➕ 添加论文</button>
    </div>`;
}
```

### E.1.5 `feat(ideas): idea templates`

**Files**: 改 `astro-src/pages/ideas/index.astro`(+30 行),改 `astro-src/scripts/ideas-ui.ts`(+40 行)

```typescript
const IDEA_TEMPLATES: Record<string, { title: string; description: string; tags: string[] }> = {
  survey: {
    title: '关于 XXX 的综述',
    description: `## 研究背景\n[概述]\n## 综述目标\n- 梳理\n- 分析\n- 总结\n## 预期贡献\n[列出]`,
    tags: ['survey', 'review'],
  },
  experiment: {
    title: '验证 XXX 假设的实验',
    description: `## 实验假设\n[清晰描述]\n## 实验设计\n### 自变量\n### 因变量\n### 控制变量\n## 预期结果`,
    tags: ['experiment', 'hypothesis'],
  },
  discussion: {
    title: '关于 XXX 的讨论',
    description: `## 讨论主题\n## 已有观点\n## 我的观点\n## 开放问题`,
    tags: ['discussion'],
  },
};
```

### E.2.1 `feat(experiments): hypothesis template(自动套 SMART)`

**Files**: 改 `astro-src/pages/experiments/index.astro`(+25 行),改 `astro-src/scripts/experiments-ui.ts`(+35 行)

```typescript
const SMART_TEMPLATE = `## SMART Hypothesis
### Specific(具体)
[明确描述]
### Measurable(可测量)
- 自变量 / 因变量 / 评估指标
### Achievable(可实现)
- 数据来源 / 现有条件
### Relevant(相关)
- 研究意义
### Time-bound(有时限)
- 预期完成时间 / 里程碑
## Hypothesis Statement`;

document.querySelectorAll('[data-smart-template]').forEach(btn => {
  btn.addEventListener('click', () => {
    const textarea = document.getElementById('exp-hypothesis');
    textarea.value = SMART_TEMPLATE;
    textarea.focus();
  });
});
```

### E.2.2 `feat(experiments): variable design wizard`

**Files**: 改 `astro-src/pages/experiments/index.astro`(+40 行),改 `astro-src/scripts/experiments-ui.ts`(+50 行)

```typescript
function openVariableWizard(): void {
  const modal = document.createElement('dialog');
  modal.innerHTML = `
    <div class="modal-content">
      <h2>🧩 实验变量设计向导</h2>
      <div class="wizard-step" data-step="1">
        <h3>Step 1: 定义自变量</h3>
        <div id="independent-variables"></div>
        <button data-add-independent>➕ 添加自变量</button>
      </div>
      <div class="wizard-step" data-step="2">
        <h3>Step 2: 定义因变量</h3>
        <div id="dependent-variables"></div>
      </div>
      <div class="wizard-step" data-step="3">
        <h3>Step 3: 定义控制变量</h3>
        <div id="controlled-variables"></div>
      </div>
      <div class="form-actions">
        <button data-wizard-prev>上一步</button>
        <button data-wizard-next>下一步</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.showModal();
}
```

### E.2.3 `feat(experiments): result tracking(expected vs actual)`

**Files**: 改 `astro-src/pages/experiments/[id].astro`(+35 行)

```typescript
interface ExperimentResult {
  id: string;
  timestamp: number;
  metricName: string;
  expectedValue?: number;
  actualValue?: number;
  notes?: string;
}
```

### E.2.4 `feat(experiments): experiment status transitions`

**Files**: 改 `astro-src/lib/experiments/types.ts`(+20 行)

```typescript
export type ExperimentStatus = 'planning' | 'running' | 'completed' | 'failed' | 'paused' | 'archived';

export const EXPERIMENT_STATUS_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  planning: ['running', 'paused', 'archived'],
  running: ['completed', 'failed', 'paused', 'archived'],
  completed: ['archived'],
  failed: ['running', 'archived'],
  paused: ['running', 'archived'],
  archived: ['planning', 'running'],
};
```

### E.2.5 `feat(experiments): experiment ↔ paper method_papers`

**Files**: 改 `astro-src/lib/experiments/types.ts`(+10 行),改 `astro-src/pages/experiments/[id].astro`(+30 行)

```typescript
interface Experiment {
  // ...existing
  methodPapers?: string[];  // arXiv IDs
}
```

### E.3.1 `feat(writing): outline generator`

**Files**: 改 `astro-src/scripts/writing-ui.ts`(+50 行)

```typescript
async function generateOutline(writingId: string): Promise<OutlineSection[]> {
  const writing = getWriting(writingId);
  const prompt = `Based on the writing title and abstract, generate a 5-section academic paper outline.
Title: ${writing.title}
Abstract: ${writing.sections?.find(s => s.id === 'abstract')?.content || ''}
Output JSON: {"sections":[{"title":"Introduction","titleZh":"引言","description":"..."}]}`;
  
  const response = await callLLM(prompt, { model: 'fast', temperature: 0.7 });
  try {
    return JSON.parse(response).sections || DEFAULT_OUTLINE;
  } catch {
    return DEFAULT_OUTLINE;
  }
}
```

### E.3.2 `feat(writing): draft ↔ synthesis 整合`

**Files**: 改 `astro-src/scripts/writing-ui.ts`(+40 行)

```typescript
function insertSynthesisToDraft(writingId: string, synthesisId: string, targetSectionId: string): void {
  const writing = getWriting(writingId);
  const synthesis = writing.syntheses?.find(s => s.id === synthesisId);
  const section = writing.sections?.find(s => s.id === targetSectionId);
  
  const insertMarker = `\n\n---\n**来源: ${synthesis.sourcePaperId}**\n`;
  section.content = (section.content || '') + insertMarker + synthesis.content;
  synthesis.insertedAt = Date.now();
  saveWriting(writingId, writing);
}
```

### E.3.3 `feat(writing): citation management`

**Files**: 新增 `astro-src/lib/writing/citations.ts`(+60 行)

```typescript
export function generateBibtex(citation: Citation): string {
  return `@article{${citation.key},
  title = {${citation.title}},
  author = {${citation.authors.join(' and ')}},
  year = {${citation.year}},
  eprint = {${citation.arxivId}},
  archivePrefix = {arXiv},
  primaryClass = {cs.LG}
}`;
}

export async function fetchCitationFromArxiv(arxivId: string): Promise<Citation | null> {
  const response = await fetch(`https://export.arxiv.org/api/query?id_list=${arxivId}`);
  const xml = await response.text();
  // 解析 XML 提取 title, authors, year
  return {
    key: `${firstAuthor}${year}`,
    arxivId, title, authors, year,
    bibtex: generateBibtex({ key, arxivId, title, authors, year }),
  };
}
```

### E.3.4 `feat(writing): draft versioning(Git commit 自动绑定)`

**Files**: 改 `astro-src/lib/writing/types.ts`(+15 行),改 `astro-src/pages/writing/[id].astro`(+25 行)

```typescript
interface WritingVersion {
  version: number;
  timestamp: number;
  gitCommitHash?: string;
  title: string;
  sections: WritingSection[];
  status: WritingStatus;
}
```

### E.3.5 `feat(writing): writing ↔ paper cited_papers`

**Files**: 改 `astro-src/lib/writing/types.ts`(+5 行),改 `astro-src/pages/writing/[id].astro`(+30 行)

```typescript
interface Writing {
  // ...existing
  citedPapers: string[];  // arXiv IDs
}
```

### E.4.1 `feat(research): dashboard activity feed`

**Files**: 改 `astro-src/pages/research/index.astro`(+40 行),改 `astro-src/lib/research/index.ts`(+30 行)

```typescript
export function getRecentActivity(limit = 20): ActivityItem[] {
  const activities: ActivityItem[] = [];
  
  for (const idea of Object.values(loadIdeas().ideas) as Idea[]) {
    activities.push({ id: `idea-${idea.id}`, module: 'idea', action: 'updated', title: idea.title, timestamp: idea.updatedAt });
  }
  for (const exp of Object.values(loadExperiments().experiments) as Experiment[]) {
    activities.push({ id: `exp-${exp.id}`, module: 'experiment', action: 'updated', title: exp.title, timestamp: exp.updatedAt });
  }
  for (const w of listWritings()) {
    activities.push({ id: `writing-${w.id}`, module: 'writing', action: 'updated', title: w.title, timestamp: w.updatedAt });
  }
  
  return activities.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}
```

### E.4.2 `feat(research): dashboard 阶段统计`

**Files**: 改 `astro-src/lib/research/index.ts`(+20 行),改 `astro-src/pages/research/index.astro`(+30 行)

```typescript
export interface ResearchStats {
  ideas: { total: number; byStatus: Record<string, number> };
  experiments: { total: number; byStatus: Record<string, number> };
  writings: { total: number; drafts: number; published: number };
  conversionRates: {
    ideaToExp: number;
    expToWriting: number;
    writingToPublish: number;
  };
}
```

### E.4.3 `feat(research): dashboard time-to-paper metrics`

**Files**: 改 `astro-src/lib/research/index.ts`(+40 行),改 `astro-src/pages/research/index.astro`(+25 行)

```typescript
export function computeTimeToPaperMetrics(): TimeToPaperMetrics {
  const published = listWritings().filter(w => w.status === 'final' || w.status === 'published');
  if (published.length === 0) return { averageWritingTime: 0, distribution: { ... }, caseStudies: [] };
  
  const writingTimes = published.map(w => (w.updatedAt - w.createdAt) / (1000 * 60 * 60 * 24));
  const avgWritingTime = writingTimes.reduce((a, b) => a + b, 0) / writingTimes.length;
  
  return {
    averageWritingTime: avgWritingTime,
    distribution: {
      lessThan1Week: writingTimes.filter(t => t < 7).length,
      oneToTwoWeeks: writingTimes.filter(t => t >= 7 && t < 14).length,
      twoToFourWeeks: writingTimes.filter(t => t >= 14 && t < 28).length,
      moreThan4Weeks: writingTimes.filter(t => t >= 28).length,
    },
    caseStudies: published.slice(0, 5).map(w => ({ title: w.title, totalDays: (w.updatedAt - w.createdAt) / (1000 * 60 * 60 * 24) })),
  };
}
```

---

## §8 R7.6 — agents 闭环深化

### F.1.1 `feat(agents): designer proposal types 扩展到 8 种`

**Files**: 改 `astro-src/lib/agents/types.ts`(+10 行),改 `astro-src/lib/agents/designer.ts`(+25 行)

```typescript
export type ProposalType =
  | 'add_paper' | 'create_draft' | 'experiment_plan' | 'literature_review'
  | 'rebuttal' | 'citation_review' | 'dataset_curation' | 'related_work';

const PROPOSAL_TYPES = [
  'add_paper', 'create_draft', 'experiment_plan', 'literature_review',
  'rebuttal', 'citation_review', 'dataset_curation', 'related_work'
];

const TYPE_DESCRIPTIONS = {
  citation_review: '对一组论文做引文网络分析,找出关键衍生工作',
  dataset_curation: '整理/清洗/标注一个新数据集',
  related_work: '围绕某主题组织 related work 章节',
};
```

### F.1.2 `feat(agents): designer few-shot from history`

**Files**: 改 `astro-src/lib/agents/designer.ts`(+40 行)

```typescript
export interface DesignerOptions {
  fewShotExamples?: Proposal[];
}

export async function designerGenerate(input, caller, opts: DesignerOptions = {}) {
  const fewShotSection = opts.fewShotExamples?.length
 ? ? `\n\n## Few-shot Examples\n${formatFewShot(opts.fewShotExamples)}`
 : '';
  const user = buildUserPrompt(input) + fewShotSection;
}
```

### F.1.3 `feat(agents): designer confidence scoring`

**Files**: 改 `astro-src/lib/agents/types.ts`(+8 行),改 `astro-src/lib/agents/designer.ts`(+20 行)

```typescript
export interface Proposal {
  // ...existing
  confidence?: number;  // 0-1
}

// System prompt 加 confidence 指引
const DESIGNER_SYSTEM_PROMPT = `...输出 JSON,每条必须含 confidence: 0-1 实数`;
```

### F.1.4 `feat(agents): designer user feedback loop`

**Files**: 改 `astro-src/scripts/agents-run.mjs`(+50 行),改 `astro-src/lib/agents/designer.ts`(+15 行)

```typescript
// CLI: --refine-proposal <round> <proposal_id> <feedback>
async function refineProposalCLI(input: RefineInput) {
  const rec = await loadRoundRecord(input.sessionId, input.round);
  const original = rec.designer.proposals.find(p => p.id === input.proposalId);
  
  const refinePrompt = `原始 proposal:\n${JSON.stringify(original, null, 2)}\n用户反馈: ${input.feedback}\n请基于反馈重新生成。`;
  const newProposals = await designerGenerate({...input}, caller, {});
}
```

### F.1.5 `test(agents): designer 5 类型各 2 fixture`

**Files**: 新建 `astro-src/lib/agents/designer.fixtures.ts`(~80 行)

### F.2.1 `feat(agents): feedback citation validation`

**Files**: 改 `astro-src/lib/agents/feedback.ts`(+40 行)

```typescript
const CITATION_VALIDATION_PROMPT = `给定 proposal 的 evidence.paperIds,验证每个 arxivId 是否在本地论文库中存在。
输出 JSON:{"valid":["..."],"invalid":["..."],"missing":["..."]}`;

async function validateCitations(proposal: Proposal) {
  const valid = [], invalid = [];
  for (const pid of proposal.evidence.paperIds) {
    if (checkPaperExists(pid)) valid.push(pid); else invalid.push(pid);
  }
  return { valid, invalid, missing: [] };
}
```

### F.2.2 `feat(agents): feedback methodology check`

**Files**: 改 `astro-src/lib/agents/feedback.ts`(+45 行)

```typescript
const METHODOLOGY_CHECK_PROMPT = `你是方法论专家,审查这个 proposal 的实验设计。
检查点:1.假设可证伪 2.指标 standard 3.baseline/消融/对照 4.样本量/划分
输出 JSON:{"score":0-10,"issues":[],"suggestions":[]}`;
```

### F.2.3 `feat(agents): feedback reproducibility audit`

**Files**: 改 `astro-src/lib/agents/feedback.ts`(+40 行)

```typescript
const REPRODUCIBILITY_PROMPT = `审查可复现性:1.代码公开 2.数据集公开 3.资源清晰 4.随机种子
输出 JSON:{"code_available":bool,"data_available":bool,...}`;
```

### F.2.4 `feat(agents): feedback novelty check`

**Files**: 改 `astro-src/lib/agents/feedback.ts`(+35 行)

```typescript
const NOVELTY_CHECK_PROMPT = `评估 proposal 相对已有工作的 novelty。
输出 JSON:{"novelty_score":0-10,"differentiation":"...","risks":[]}`;
```

### F.2.5 `test(agents): feedback 5 维度各 1 fixture`

**Files**: 新建 `astro-src/lib/agents/feedback.fixtures.ts`(~70 行)

### F.3.1 `feat(agents): modifier format-specific`

**Files**: 改 `astro-src/lib/agents/types.ts`(+8 行),改 `astro-src/lib/agents/modifier.ts`(+50 行)

```typescript
export type DeliverableFormat = 'arxiv' | 'acl' | 'journal';

const FORMAT_TEMPLATES = {
  arxiv: { sectionOrder: ['abstract', 'intro', 'method', 'experiment', 'related', 'conclusion'], citationStyle: 'plain' },
  acl: { sectionOrder: ['abstract', 'intro', 'related', 'method', 'experiment', 'conclusion'], citationStyle: 'acl' },
  journal: { sectionOrder: ['abstract', 'intro', 'method', 'results', 'discussion', 'conclusion'], citationStyle: 'ieee' },
};
```

### F.3.2 `feat(agents): modifier cross-reference enforcement`

**Files**: 改 `astro-src/lib/agents/modifier.ts`(+35 行)

```typescript
const MIN_CITATIONS = 3;
// 每个 deliverable 至少引用 3 个 supporting papers
```

### F.3.3 `feat(agents): modifier bibliography formatting`

**Files**: 改 `astro-src/lib/agents/modifier.ts`(+30 行)

```typescript
export type BibliographyStyle = 'bibtex' | 'natbib' | 'biblatex';
```

### F.3.4 `feat(agents): modifier citation graph generation`

**Files**: 新建 `astro-src/lib/agents/citation-graph.ts`(~80 行)

```typescript
export function buildCitationGraph(paperIds: string[]): Map<string, CitationNode> {
  const graph = new Map<string, CitationNode>();
  for (const pid of paperIds) {
    const paper = loadPaperMetadata(pid);
    graph.set(pid, {
      arxivId: pid, title: paper.title,
      citations: extractReferences(paper.raw),
      cited_by: [],
    });
  }
  for (const [pid, node] of graph) {
    for (const cited of node.citations) {
      const target = graph.get(cited);
      if (target) target.cited_by.push(pid);
    }
  }
  return graph;
}
```

### F.3.5 `test(agents): modifier 4 deliverable 类型 fixture`

**Files**: 新建 `astro-src/lib/agents/modifier.fixtures.ts`(~60 行)

### F.4.1 `feat(agents): pipeline recovery from failed stages`

**Files**: 改 `astro-src/lib/agents/pipeline.ts`(+45 行)

```typescript
export async function runPipeline(input, caller, opts: PipelineOptions = {}) {
  const maxRetries = opts.maxRetries ?? 1;
  for (let stageIdx = input.startStageIdx ?? 0; stageIdx < PIPELINE_STAGES.length; stageIdx++) {
    let attempts = 0;
    let stageResult: StageResult;
    do {
      stageResult = await runPipelineStage(stageIdx, input, caller);
      attempts++;
    } while (opts.retryFailedStage && !stageResult.passed && attempts < maxRetries);
  }
}
```

### F.4.2 `feat(agents): pipeline parallel stages`

**Files**: 改 `astro-src/lib/agents/pipeline.ts`(+50 行)

```typescript
const PIPELINE_PARALLELISM: Record<string, { parallel_with?: string[] }> = {
  p_review_literature: { parallel_with: ['p_design_experiment_plan'] },
};
```

### F.4.3 `feat(agents): pipeline user override`

**Files**: 改 `astro-src/lib/agents/pipeline.ts`(+30 行)

```typescript
export interface PipelineOverride {
  skip_stage?: string[];
  force_stage?: string[];
}
// CLI: --skip-gate / --force-stage
```

---

## §9 R7.7+ — concepts / 站点 / 基础设施

### G.1.1 `feat(concepts): 抽取 prompt 升级到 3 阶段`

**Files**: 改 `astro-src/lib/concepts-index.ts`(+40 行)

```typescript
export async function extractConcepts3Stage(paperText: string, title: string, abstract: string): Promise<ConceptRef[]> {
  // Stage 1: title → keywords
  const titleKeywords = await callLLMExtract(`从标题 "${title}" 抽取 3-5 个核心概念`);
  // Stage 2: abstract → body concepts (8-12 个)
  const bodyConcepts = await callLLMExtract(`从摘要抽取概念`);
  // Stage 3: cross-link
  return linkConceptsByCooccurrence(titleKeywords, bodyConcepts);
}
```

### G.1.2 `feat(concepts): 概念去重(slug collision + fuzzy match)`

**Files**: 改 `astro-src/lib/concepts-index.ts`(+50 行),新增 `astro-src/lib/concepts-dedup.ts`(~60 行)

```typescript
import { similarity } from 'string-similarity';

export function deduplicateConcepts(concepts: ConceptRef[]): DedupeResult {
  const slugMap = new Map<string, ConceptRef[]>();
  for (const c of concepts) {
    const normalizedSlug = c.slug.toLowerCase().replace(/_/g, '-');
    (slugMap.get(normalizedSlug) ?? slugMap.set(normalizedSlug, []).get(normalizedSlug)!).push(c);
  }
  
  const kept: ConceptRef[] = [];
  const merged = new Map<string, string>();
  
  for (const [slug, group] of slugMap) {
    if (group.length === 1) { kept.push(group[0]); continue; }
    const representative = group.sort((a, b) => b.display_name.length - a.display_name.length)[0];
    kept.push(representative);
    for (const c of group) if (c !== representative) merged.set(c.slug, representative.slug);
  }
  
  // fuzzy cross-group
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      if (similarity(kept[i].display_name, kept[j].display_name) > 0.85) {
        merged.set(kept[j].slug, kept[i].slug);
      }
    }
  }
  
  return { kept, merged };
}
```

### G.1.3 `feat(concepts): 概念 versioning`

**Files**: 改 `astro-src/lib/concepts-index.ts`(+30 行),新增 `astro-src/scripts/concept-version.mjs`(~80 行)

```javascript
#!/usr/bin/env node
// concept-version.mjs - 记录概念状态快照,支持变更检测

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DOCS_CONCEPTS_DIR = 'docs/concepts';

async function snapshotConcept(slug, conceptRef) {
  const historyDir = join(DOCS_CONCEPTS_DIR, slug, 'history');
  const today = new Date().toISOString().split('T')[0];
  const snapshot = {
    date: today,
    display_name: conceptRef.display_name,
    category: conceptRef.category,
    source_papers: conceptRef.paper_ids,
  };
  // mkdir + write snapshot
}

function detectChanges(slug) {
  // 对比最近两次 snapshot,返回变更报告
}
```

### G.2.1 `feat(concepts): concept relations UI`

**Files**: 改 `astro-src/pages/wiki/concepts/[slug].astro`(+40 行)

```astro
const related = getRelatedConcepts(index, slug);
{related.length > 0 && (
  <section class="concept-related">
    <h3>相关概念</h3>
    <ul class="concept-graph">
      {related.slice(0, 10).map(r => (
        <li><a href={`/wiki/concepts/${r.slug}/`}>{r.display_name}<span class="co-count">{r.co_count} 次共现</span></a></li>
      ))}
    </ul>
  </section>
)}
```

### G.2.2 `feat(concepts): concept evolution tracking`

**Files**: 改 `astro-src/scripts/concept-version.mjs`(+30 行),改 `astro-src/pages/wiki/concepts/[slug].astro`(+25 行)

```astro
{recentHistory.length >= 2 && (
  <section class="concept-evolution">
    <h3>概念热度趋势(近 90 天)</h3>
    <svg viewBox="0 0 300 60">
      <polyline points={recentHistory.map((h, i) => `${i*3},${60 - h.paper_count * 5}`).join(' ')} />
    </svg>
  </section>
)}
```

### G.3.1 `feat(concepts): concept 创建 UI`

**Files**: 新增 `astro-src/pages/wiki/concepts/new.astro`(~60 行)

### G.3.2 `feat(concepts): concept editing`

**Files**: 改 `astro-src/pages/wiki/concepts/[slug].astro`(+30 行),新增 `astro-src/components/ConceptEditModal.astro`(~50 行)

### G.3.3 `feat(concepts): concept relationships 可视化(cytoscape)`

**Files**: 改 `astro-src/pages/wiki/concepts/[slug].astro`(+60 行)

```astro
<div id="cy-container" data-graph={JSON.stringify(graphData)}></div>
<script>
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
cytoscape.use(fcose);

const cy = cytoscape({
  container: document.getElementById('cy-container'),
  elements: graph,
  layout: { name: 'fcose', quality: 'default' }
});
</script>
```

### H.1.1 `perf(build): bundle 拆分 vendor + 按路由 lazy load`

**Files**: 改 `astro.config.mjs`(+20 行)

```javascript
export default defineConfig({
  vite: {
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-cytoscape': ['cytoscape', 'cytoscape-fcose'],
            'vendor-pdf': ['pdfjs-dist'],
          },
        },
      },
    },
  },
});
```

### H.1.2 `feat(images): 论文图 lazy load`

**Files**: 改 `astro-src/components/PaperFigure.astro`(+15 行)

```astro
<img src={src} alt={alt} loading="lazy" decoding="async" srcset={srcset} />
```

### H.1.3 `perf(search): search-index 分页 + 客户端 cache`

**Files**: 改 `astro-src/lib/search-index.ts`(+40 行)

```typescript
const PAGE_SIZE = 50;

const searchCache = new Map<string, { results, ts }>();
const CACHE_TTL = 5 * 60 * 1000;

export function getCachedResults(query: string): SearchResult[] | null {
  const cached = searchCache.get(query);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.results;
  return null;
}
```

### H.1.4 `perf(cache): 静态资源 HTTP cache headers`

**Files**: 改 `astro.config.mjs`(+10 行)

```javascript
vite: {
  server: {
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
  },
},
```

### H.1.5 `perf(build): lighthouse CI > 90`

**Files**: 新增 `.github/workflows/lighthouse.yml`(~30 行)

```yaml
name: Lighthouse
on: [push]
jobs:
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - run: npm ci && npm run build
      - run: npx lighthouse http://localhost:4321 --output-path lighthouse.json --quiet
```

### H.2.1 `fix(mobile): 论文详情页移动端适配`

**Files**: 改 `astro-src/styles/paper-detail.css`(+30 行)

```css
@media (max-width: 640px) {
  .paper-detail { max-width: 100%; padding: 1rem; }
  .paper-detail .meta-tags { flex-wrap: wrap; gap: 0.5rem; }
  .paper-figure img { max-width: 100%; height: auto; }
}
```

### H.2.2 `fix(a11y): 全站 keyboard navigation 审计`

**Files**: 改 `astro-src/components/` 多个文件(+40 行),新增 `astro-src/styles/a11y.css`(~20 行)

```css
:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

### H.2.3 `feat(loading): skeleton 加载态`

**Files**: 新增 `astro-src/components/Skeleton.astro`(~30 行)

```astro
<div class="skeleton" aria-hidden="true">
  <div class="skeleton-line" style="width: 80%"></div>
</div>
<style>
  .skeleton {
    background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
</style>
```

### H.2.4 `feat(empty): 空状态统一设计`

**Files**: 新增 `astro-src/components/EmptyState.astro`(~25 行)

### H.3.1 `feat(home): 首页 redesign`

**Files**: 改 `astro-src/pages/index.astro`(+80 行)

```astro
<section class="daily-recs">
  <h2>今日推荐</h2>
  <div class="rec-grid">{daily.map(p => => <PaperCard paper={p} />)}</div>
</section>
<section class="activity-feed">
  <h2>最近动态</h2>
  <ul>{activity.map(a => <li>...</li>)}</ul>
</section>
```

### H.3.2 `feat(library): library detail 页加 cross-link 网络图`

**Files**: 改 `astro-src/pages/libraries/[id].astro`(+60 行)

```astro
{library.papers.length > 2 && (
  <section class="library-graph">
    <h3>文献关联图</h3>
    <div id="lib-cy" data-graph={JSON.stringify(graphData)}></div>
  </section>
)}
```

### H.3.3 `feat(settings): settings page UX 改进`

**Files**: 改 `astro-src/pages/settings.astro`(+80 行)

```astro
<nav class="settings-tabs">
  {tabs.map(t => <a href={`?tab=${t}`} class:list={['tab', { active: t === activeTab }]}>{t}</a>)}
</nav>
<div class="settings-content">
  <input type="search" placeholder="搜索设置..." class="settings-search" />
</div>
```

### I.1.1 `feat(ci): pytest 全套启动`

**Files**: 改 `.github/workflows/ci.yml`(+30 行)

```yaml
pytest-full:
  name: pytest (full)
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v5
    - uses: actions/setup-python@v6
      with: { python-version: "3.11" }
    - run: python pip - install -r requirements.txt pytest pytest-cov
    - run: python -m pytest tests/ -q --cov=src --cov-report=xml
```

### I.1.2 `feat(ci): type check 强制`

**Files**: 改 `.github/workflows/ci.yml`(+15 行),改 `tsconfig.json`(+5 行)

```yaml
type-check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v5
    - run: npm ci
    - run: npx tsc --noEmit
```

### I.1.3 `feat(ci): ESLint + Prettier 强制`

**Files**: 新增 `.eslintrc.cjs`(~30 行),新增 `.prettierrc`(~10 行),改 `.github/workflows/ci.yml`(+15 行)

```javascript
// .eslintrc.cjs
module.exports = {
  extends: ['plugin:astro/recommended'],
  rules: { 'no-console': 'warn' },
};
```

### I.1.4 `feat(ci): perf budget check`

**Files**: 新增 `scripts/perf-budget.mjs`(~40 行)

```javascript
#!/usr/bin/env node
import { glob } from 'glob';
import { statSync } from 'node:fs';

const BUDGET_KB = { 'index.css': 50, 'vendor.js': 200 };

async function checkBudget() {
  const assets = await glob('dist/assets/*.{css,js}');
  let failed = false;
  for (const asset of assets) {
    const name = asset.split('/').pop();
    const sizeKB = statSync(asset).size / 1024;
    const budget = BUDGET_KB[name] ?? 100;
    if (sizeKB > budget) {
      console.error(`FAIL: ${name} is ${sizeKB.toFixed(1)}KB > ${budget}KB budget`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}
```

### I.1.5 `feat(ci): auto-format on commit(husky + lint-staged)`

**Files**: 新增 `.husky/pre-commit`(~5 行),新增 `lint-staged.config.cjs`(~15 行),改 `package.json`(+10 行)

```json
{
  "lint-staged": {
    "*.{ts,astro}": ["eslint --fix", "prettier --write"]
  }
}
```

### I.2.1 `feat(tests): unit test 框架(vitest)`

**Files**: 改 `package.json`(+5 行),新增 `tests/unit/concepts.test.ts`(~40 行),新增 `vitest.config.ts`(~15 行)

```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
});
```

### I.2.2 `feat(tests): integration tests(关键流程 e2e)`

**Files**: 新增 `tests/integration/paper-detail.test.ts`(~60 行)

### I.2.3 `feat(tests): snapshot tests(LLM 输出稳定性)`

**Files**: 新增 `tests/snapshots/llm-output.test.ts`(~50 行)

### I.2.4 `feat(tests): coverage report + badge`

**Files**: 改 `.github/workflows/ci.yml`(+15 行)

### I.3.1 `feat(deps): dependabot 配置(automerge patch)`

**Files**: 新增 `.github/dependabot.yml`(~20 行)

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule: { interval: "weekly" }
    automerged:
      - dependency-type: "production"
        update-type: "version-update:semver-patch"
```

### I.3.2 `feat(release): conventional commits + auto changelog`

**Files**: 新增 `commitlint.config.cjs`(~20 行),改 `package.json`(+10 行)

### I.3.3 `feat(security): GitHub Actions secrets 审计`

**Files**: 新增 `scripts/audit-secrets.mjs`(~30 行)

```javascript
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { glob } from 'glob';

async function audit() {
  const ymls = await glob('.github/workflows/*.yml');
  const secrets = [];
  for (const yml of ymls) {
    const content = readFileSync(yml, 'utf8');
    const patterns = [/api[_-]?key/i, /password/i, /token/i];
    for (const p of patterns) {
      if (p.test(content) && !content.includes('secrets.')) {
        secrets.push({ file: yml, pattern: p.source });
      }
    }
  }
  if (secrets.length > 0) { console.error('SECRET LEAK'); process.exit(1); }
}
```

---

## §10 Debug commits 模式 (J.1-J.15)

按用户反馈「很多时候会改错一些东西,我会告诉你要做修改」,每类工作预留 1-2 个空 commit:

**统一 commit 格式**:
```
fix(<area>): user feedback #N 修 <具体描述>

用户反馈:
  - "<用户原话>"

修复:
  - <改动 1>
  - <改动 2>

测试:
  - <验证步骤>
```

**预留空位**:
- J.1, J.2, J.3 — R7.1 B 类预留
- J.4, J.5, J.6 — R7.2 C 类预留
- J.7, J.8 — R7.3 A 类预留
- J.9, J.10, J.11 — R7.5 E 类预留
- J.12, J.13 — R7.6 F 类预留
- J.14 — G/H/I 任一
- J.15 — 任意

---

## §11 验证模式 + 用户反馈循环设计

每个 commit 完成后我停,你 review,你说"改 X" → 我开 J 类 commit。

| commit 类型 | 验证模式 |
|---|---|
| 新增 prompt 注入 | quickstart + grep archive/<sid>/rounds/*.json 看 system 字段 |
| 新增 backfill 脚本 | `--dry-run --limit N` 抽样 → `--apply --all` |
| 新增 audit 脚本 | `--check` 列出失败 + `--ci` exit code |
| 新增 UI 按钮 | dev server 跑 + 手动点击验证 |
| 改 workflow yml | push + GH Actions 跑成功 |
| 改 Python pipeline | 本地 `python -m src.main --dry-run` |

每 1-3 commit 我说「已 commit x/y,等你 review」。你说"改 X" → J.x commit;说"继续" → 下一个;说"暂停" → 停;说"改 R7.x 优先级" → 调整顺序。

---

## §12 风险与备选

| 风险 | 缓解 |
|---|---|
| 跨模块改动冲突 | 每个 commit 独立可回滚 |
| LLM 成本失控 | 本地 8124 代理 + cheap model + dry-run 先验 |
| Workflow 跑不动 | workflow_dispatch 手动 trigger + 本地 python |
| UI 改动破坏 mobile | dev server 多 viewport 测 |
| 跨文件改动漏改 | commit 前 grep + type check |
| Agent 输出不稳定 | deterministic prompt + low temp + snapshot tests |
| GitHub Actions 60 天空闲 | weekly 唤醒 cron + workflow_dispatch |

---

**变更日志**
- 2026-09-14 18:00 整合 5 个 detail agent 内容
- 2026-09-14 17:30 整合 3 个 audit 报告 + 高层路线图
- 2026-09-14 17:00 首次建立 R7 详细施工图(R7.1 + R7.2)
- 2026-09-14 16:30 R7 高层路线图建立