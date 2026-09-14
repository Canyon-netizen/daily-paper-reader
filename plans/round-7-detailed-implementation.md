---
name: r7-detailed-implementation
description: R7 全 140 commit 的具体步骤(文件 + 改动 + 验证 + 风险)
metadata:
  type: project
  date: 2026-09-14
  estimated_total_commits: 140
  status: planning
---

# Plan: R7 Detailed Implementation — 每个 commit 的具体步骤

> 配套主 plan:`plans/round-7-comprehensive-100-commits.md`(宏观路线图)
> 本 plan 是 **每个 commit 的「施工图」**:文件 + 改动 + 验证 + 风险
>
> 设计:每个 commit 改动 < 100 行,可独立 review / revert

---

## 目录

- [R7.1 — research-skills → agents 代码层(B.1)](#r71--research-skills--agents-代码层)
- [R7.2 — 老论文 cross-link 回填 + 验证(C.1-C.3)](#r72--老论文-cross-link-回填--验证)
- [R7.3 — 论文 pipeline 修复(A.1-A.3)](#r73--论文-pipeline-修复)
- [R7.4 — 文献库 UX + 数据(D.1-D.2)](#r74--文献库-ux--数据)
- [R7.5 — ideas / experiments / writing(E.1-E.4)](#r75--ideas--experiments--writing)
- [R7.6 — agents 闭环深化(F.1-F.4)](#r76--agents-闭环深化)
- [R7.7+ — concepts / 站点 / 基础设施(G/H/I)](#r77----concepts--站点--基础设施)
- [J.1-J.15 — Debug commits 模式](#j1-j15--debug-commits-模式)

---

## R7.1 — research-skills → agents 代码层

> 目标:Designer / Modifier / Reviewer / Reviser 真正消费 `docs/research-skills/*.md` 作为 prompt 上下文
> 改动规模:5 个 commit,~100 行净增

### B.1.1 `feat(agents): lib/agents/skill-context-loader.ts 新增`

**文件**:
- 新建 `astro-src/scripts/agents/skill-context-loader.ts`(~80 行)
- 新建 `astro-src/scripts/agents/skill-context-loader.test.ts`(可选,~60 行,本批可省)

**实现要点**:
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
      // 截前 3000 字(防止 prompt 过长)
      parts.push(`### ${f}\n${content.slice(0, 3000)}`);
    } catch (e) {
      parts.push(`### ${f}\n(WARN: ${(e as Error).message})`);
    }
  }
  return parts.join('\n\n');
}
```

**验证**:
```bash
# 单元测试(手工验证)
node -e "
const { loadSkillContext } = require('./astro-src/scripts/agents/skill-context-loader.ts');
console.log(loadSkillContext('draft').slice(0, 500));
"
# 预期:首行 "[方法论上下文 · stage=draft]" + "### writing-paper.md" + 内容
```

**风险**:
- skill 文档总大小 ~30KB,3000 字截断每文档约 6KB,4 个 stage = ~24KB,可控
- 失败 graceful:catch e 后只输出 WARN,不阻断 agent

---

### B.1.2 `feat(agents): designer.ts 注入 experiment-design.md`

**文件**:
- 改 `astro-src/scripts/agents/designer.ts`(+15 行)

**实现要点**:
```typescript
// 在 designer.ts 顶部 import
import { loadSkillContext } from './skill-context-loader';

// 在 buildDesignerPrompt() 函数里,system prompt 顶部注入
const skillContext = loadSkillContext('ideation');  // 或 'experiment',看具体 stage
const systemPrompt = `${skillContext}\n\n${baseSystemPrompt}`;
```

**验证**:
```bash
# 跑 quickstart,看 archive/<sid>/rounds/round_001.json 的 system 字段
node astro-src/scripts/agents-run.mjs --quickstart "test research direction"
cat archive/<sid>/rounds/round_001.json | python -c "
import json, sys
d = json.load(sys.stdin)
system = d.get('system', '') or d.get('system_prompt', '')
print(system[:500])
"
# 预期:首段含 "[方法论上下文 · stage=ideation]" + "defining-research-question.md"
```

**风险**:
- prompt 增长 ~6KB,LLM cost + 10%
- 若 designer prompt 已有 stage 参数,需读 stage 后再 load

---

### B.1.3 `feat(agents): modifier.ts 注入 writing-paper.md`

**文件**:
- 改 `astro-src/scripts/agents/modifier.ts`(+15 行)

**实现要点**:
- 同 B.1.2,但 stage='draft'
- modifier 多 stage(写 paper_draft / experiment_plan / literature_review),根据 deliverableType 决定 stage

```typescript
const MOD_TYPE_TO_STAGE: Record<string, AgentStage> = {
  paper_draft: 'draft',
  experiment_plan: 'experiment',
  literature_review: 'literature',
  rebuttal: 'revise',
};

// 在 modifier build prompt 里
const stage = MOD_TYPE_TO_STAGE[deliverableType] ?? 'draft';
const skillContext = loadSkillContext(stage);
```

**验证**:
```bash
# 跑 paper_draft 类型 deliverable,看 archive/<sid>/reviews/ 里 deliverable 文件头
node astro-src/scripts/agents-run.mjs --session <sid> --compile-paper
grep -l "writing-paper.md" archive/<sid>/rounds/*.json
```

**风险**:
- 若 deliverableType 不在映射,fallback 到 draft

---

### B.1.4 `feat(agents): reviewer.ts 注入 reviewer-mindset.md`

**文件**:
- 改 `astro-src/scripts/agents/reviewer.ts`(+15 行)

**实现要点**:
- stage='review'
- reviewer prompt 头部注入 reviewer-mindset.md + writing-review.md

**验证**:
- 看 reviewer 输出 archive/<sid>/reviews/review_*.json 的 system 字段含 reviewer-mindset 引用

**风险**:
- reviewer 输出 5 维评分,skill context 不会影响评分逻辑,只影响 perspective

---

### B.1.5 `feat(agents): reviser.ts 注入 writing-rebuttal.md`

**文件**:
- 改 `astro-src/scripts/agents/reviser.ts`(+15 行)

**实现要点**:
- stage='revise'

**验证**:
- 看 reviser 输出 archive/<sid>/reviews/revise_*.json 的 system 字段含 writing-rebuttal 引用

---

### B.1.6 `test(agents): skill-context-loader 单测`

**文件**:
- 新建 `astro-src/scripts/agents/skill-context-loader.test.ts`(~80 行)

**实现要点**:
```typescript
import { loadSkillContext } from './skill-context-loader';
import { describe, it, expect } from 'vitest';  // 或 bun:test

describe('skill-context-loader', () => {
  it('loadSkillContext(ideation) 含 defining-research-question', () => {
    const ctx = loadSkillContext('ideation');
    expect(ctx).toContain('[方法论上下文 · stage=ideation]');
    expect(ctx).toContain('defining-research-question.md');
  });
  
  it('loadSkillContext(draft) 含 writing-paper', () => {
    const ctx = loadSkillContext('draft');
    expect(ctx).toContain('writing-paper.md');
  });
  
  it('loadSkillContext(unknown) 返回空 + WARN', () => {
    // @ts-expect-error testing invalid stage
    const ctx = loadSkillContext('unknown');
    expect(ctx).toContain('WARN');
  });
  
  it('每个 stage 返回非空字符串', () => {
    for (const stage of ['ideation', 'literature', 'experiment', 'draft', 'review', 'revise']) {
      expect(loadSkillContext(stage as any).length).toBeGreaterThan(100);
    }
  });
  
  it('文档 > 3000 字时截断', () => {
    const ctx = loadSkillContext('draft');
    expect(ctx.length).toBeLessThan(20000);  // 单 stage 上限 ~6KB × 2 files = 12KB
  });
});
```

**验证**:
```bash
bun test astro-src/scripts/agents/skill-context-loader.test.ts
# 预期:5 个 it 全部通过
```

---

### B.1.7 `feat(agents): CLI 启动时提示 research-skills 存在`

**文件**:
- 改 `astro-src/scripts/agents-run.mjs`(+10 行)

**实现要点**:
```javascript
// 在 quickstart / help 输出里加
console.log('💡 提示:见 docs/research-skills/ 7 份方法论文档');
console.log('   Designer / Modifier 等 agents 已自动消费对应 skill');
```

**验证**:
```bash
node astro-src/scripts/agents-run.mjs --help
# 预期输出含 "docs/research-skills/"
```

---

### J.1 — debug 预留(等用户 review 后填)

格式:`fix(agents): user feedback #N 修 <描述>`

---

## R7.2 — 老论文 cross-link 回填 + 验证

> 目标:1152 篇论文自动加 `related_ideas / related_experiments / related_writings` 字段
> 改动规模:7 个 commit,~400 行净增 + 1150 篇 paper.md 改动

### C.1.1 `feat(tools): paper-backfill-crosslinks.mjs — LLM 推断 related_*`

**文件**:
- 新建 `astro-src/scripts/paper-backfill-crosslinks.mjs`(~200 行)

**实现要点**:
```javascript
#!/usr/bin/env node
// 类似 paper-backfill-categories.mjs,但用 LLM 推断

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// 1. 加载 docs/ideas / docs/experiments / docs/writing 的所有候选
function loadCandidates(dir) {
  const out = [];
  for (const f of readdirSync(join('docs', dir))) {
    if (!f.endsWith('.md')) continue;
    const content = readFileSync(join('docs', dir, f), 'utf8');
    // 提取 title + first 200 chars of body
    const title = content.match(/^# (.+)$/m)?.[1] ?? f;
    const body = content.split('\n---\n')[1]?.slice(0, 200) ?? '';
    out.push({ path: `docs/${dir}/${f}`, title, body });
  }
  return out;
}

// 2. 对每篇论文,batch 调 LLM 推断 1-3 条 related_*
async function inferRelated(paper, candidates) {
  const candidatesStr = candidates.slice(0, 50).map((c, i) => 
    `${i}. [${c.path}] ${c.title} — ${c.body.slice(0, 100)}`
  ).join('\n');
  const prompt = `论文标题: ${paper.title}\n论文摘要: ${paper.tldr}\n候选(只挑相关的):\n${candidatesStr}\n\n输出 JSON:{"related_ideas":["..."],"related_experiments":["..."],"related_writings":["..."]}`;
  // 调 LLM(用 8124 代理 per memory llm-proxy-8124)
  // 解析 JSON 返回 paths
}

// 3. 对每篇论文,启发式 fallback(优先 tags 匹配同名 tag)
function heuristicRelated(paper, candidates) {
  const out = { related_ideas: [], related_experiments: [], related_writings: [] };
  for (const tag of paper.tags ?? []) {
    if (tag.startsWith('query:')) continue;
    const matches = candidates.ideas.filter(c => c.title.toLowerCase().includes(tag.toLowerCase()));
    out.related_ideas.push(...matches.slice(0, 2).map(c => c.path));
  }
  return out;
}

// 4. regex 最小化写 frontmatter(同 backfill-categories 思路)
function writeRelated(raw, related) {
  // 如果已有 related_* 字段,merge;否则插入
  // 用 regex 替换,不动其他 YAML
}
```

**验证**:
```bash
node astro-src/scripts/paper-backfill-crosslinks.mjs --dry-run --limit 5
# 预期:5 个 sample,显示 LLM 推断 + 启发式 fallback 合并结果
```

**风险**:
- LLM 推断可能误命中(返回 docs/ideas 不存在的路径)— 用 path-existence check 过滤
- 长 list(50+ 候选)prompt 可能超 token — batch 每批 20 候选,topK=3

---

### C.1.2 `feat(tools): paper-backfill-crosslinks 启发式 fallback`

**文件**:
- 合并到 C.1.1(同一个脚本)

**实现要点**:
- 启发式逻辑已在 C.1.1 草稿
- 单独 commit 让 git history 清晰

**验证**:
- 同 C.1.1 dry-run

---

### C.1.3 `feat(tools): paper-backfill-crosslinks --limit dry-run`

**文件**:
- 已含 C.1.1

**验证**:
- 同 C.1.1

---

### C.1.4 `feat(tools): paper-mark-milestones.mjs`

**文件**:
- 新建 `astro-src/scripts/paper-mark-milestones.mjs`(~120 行)

**实现要点**:
```javascript
// 启发式:
// 1. venue == NeurIPS/ICML/ICLR + year <= 2024 + title 含 "first"/"novel"/"breakthrough" → milestone
// 2. arxiv citations > 100(从 supabase / semantic scholar API)— 但 supabase 可能 no,fallback 到启发
// 3. 用户手填白名单 docs/library/milestone-whitelist.md → milestone
// 4. 其他 default false
//
// CLI:
//   --check: 显示每篇论文的 milestone 推断,不要写
//   --apply: 写入 is_milestone 字段
//   --limit N: 仅前 N 篇
```

**验证**:
```bash
node astro-src/scripts/paper-mark-milestones.mjs --check --limit 10
# 预期:10 个 sample,显示每篇的 milestone 推断
```

---

### C.1.5 `feat(tools): paper-compute-resource-tier.mjs`

**文件**:
- 新建 `astro-src/scripts/paper-compute-resource-tier.mjs`(~100 行)

**实现要点**:
```javascript
// 从 title/abstract 推断 resource_tier (small/medium/large/xlarge)
// 启发式:
// - 单 GPU 可跑 / < 1B params / toy dataset → small
// - 1-8 GPU / < 8B params / 1K-100K samples → medium
// - 8-64 GPU / 8B-70B params / 100K-1M samples → large
// - 100+ GPU / 70B+ params / 1M+ samples → xlarge
```

---

### C.2.1 `data(papers): apply backfill-crosslinks --all`

**文件**:
- 1152 篇 paper.md(+ ~9K 行)

**实施**:
```bash
node astro-src/scripts/paper-backfill-crosslinks.mjs --apply --all
# 预期:~10-30 分钟(LLM 调用)
```

**验证**:
```bash
# 检查 invalid path(LLM 可能返回 docs/ideas 不存在的 path)
node -e "
const fs = require('fs');
let bad = 0;
for (const f of fs.readdirSync('docs/papers', {recursive: true})) {
  if (!f.endsWith('.md')) continue;
  const content = fs.readFileSync('docs/papers/' + f, 'utf8');
  const m = content.match(/related_ideas:\n((?:  - .+\n)+)/);
  if (!m) continue;
  for (const p of m[1].split('\n')) {
    const path = p.replace(/^  - /, '').trim();
    if (!fs.existsSync(path)) {
      console.log('BAD:', f, '→', path);
      bad++;
    }
  }
}
console.log('Total bad:', bad);
"
# 预期:bad ≤ 5%(LLM 推断错误率)
```

**风险**:
- LLM 幻觉 → 路径不存在 → audit 失败
- mitigation:C.3.1 audit-crosslinks 自动检测

---

### C.2.2 `data(papers): apply mark-milestones --apply`

**文件**:
- ~50-100 篇 paper.md(+ ~300 行)

**实施**:
```bash
node astro-src/scripts/paper-mark-milestones.mjs --apply
```

---

### C.2.3 `data(papers): apply compute-resource-tier --all`

**文件**:
- 1152 篇 paper.md(+ ~9K 行)

**实施**:
```bash
node astro-src/scripts/paper-compute-resource-tier.mjs --apply --all
```

---

### C.3.1 `feat(tools): audit-crosslinks.mjs — 验证每篇论文`

**文件**:
- 新建 `astro-src/scripts/audit-crosslinks.mjs`(~120 行)

**实现要点**:
```javascript
// 扫 docs/papers/**/*.md,每篇检查:
//   - related_ideas / related_experiments / related_writings 至少有 1 个非空
//   - 或 is_orphan: true
//   - 引用的 path 必须存在
//
// CLI:
//   --check: 列出失败论文
//   --fix: 自动加 is_orphan: true
//   --ci: 失败 exit 1
```

**验证**:
```bash
node astro-src/scripts/audit-crosslinks.mjs --check
# 预期:失败论文列表(应很少)

node astro-src/scripts/audit-crosslinks.mjs --ci
echo "exit: $?"
# 预期:exit 1(若有失败)
```

---

### C.3.2 `feat(tools): audit-crosslinks --ci exit code`

**文件**:
- 同 C.3.1

---

### C.3.3 `feat(ci): ci.yml 跑 audit-crosslinks`

**文件**:
- 改 `.github/workflows/ci.yml`(+10 行)

**实现要点**:
```yaml
- name: Audit cross-links
  run: |
    node astro-src/scripts/audit-crosslinks.mjs --ci
```

**验证**:
- PR 时 GH Actions 跑 audit-crosslinks,失败 exit 1

---

### C.3.4 `feat(tools): audit-crosslinks --fix 自动加 is_orphan`

**文件**:
- 同 C.3.1

---

### C.3.5 `test(tools): audit-crosslinks 单测`

**文件**:
- 新建 `astro-src/scripts/audit-crosslinks.test.ts`(~80 行)

---

### J.2 — debug 预留(等用户 review 后填)

---

## R7.3 — 论文 pipeline 修复(A.1-A.3)

> 目标:GH Actions cron 修好 + 论文质量把关 + freshness 监控
> 改动规模:15 commit,改 workflow yml 5 个 + Python 文件 5 个 + 工具脚本 5 个

### A.1.1 `fix(workflow): daily-paper-reader cron 防 60 天空闲暂停`

**文件**:
- 改 `.github/workflows/daily-paper-reader.yml`(+20 行)

**实施要点**:
- 加一个 weekly scheduled 触发器(每周一 0:00 UTC)只做 push 操作(无意义 commit 也行)
- 或加 workflow_dispatch 触发器 + 注释「cron 60 天空闲会被 GH 暂停,需定期 push」
- 加注释说明 user 可手动 trigger

**风险**:
- weekly push 不必要 commit 污染 git log
- mitigation:加 `[skip ci]` 标记

---

### A.1.2 `feat(workflow): 加 status badge + Slack webhook 失败通知`

**文件**:
- 改 `.github/workflows/daily-paper-reader.yml`(+30 行)
- 改 `docs/README.md`(+3 行,加 badge)

**实施**:
```yaml
- name: Notify failure
  if: failure()
  run: |
    curl -X POST "${{ secrets.SLACK_WEBHOOK }}" \
      -H "Content-Type: application/json" \
      -d '{"text":"❌ daily-paper-reader failed: ${{ github.run_id }}"}'
```

---

### A.1.3 `feat(workflow): 降 fetch_days 默认到 5 天`

**文件**:
- 改 `.github/workflows/daily-paper-reader.yml`(1 行)

---

### A.1.4 `fix(pipeline): arXiv API 429 加 retry-after 解析`

**文件**:
- 改 `src/main.py`(+30 行)

**实施**:
```python
import requests
import time

def fetch_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        resp = requests.get(url)
        if resp.status_code == 429:
            retry_after = int(resp.headers.get('Retry-After', 60))
            time.sleep(retry_after)
            continue
        return resp
    raise Exception(f'429 after {max_retries} retries')
```

---

### A.1.5 `feat(pipeline): main.py 加 fail-fast + 错误日志`

**文件**:
- 改 `src/main.py`(+20 行)

---

### A.2.1 `feat(tools): paper-validate.mjs frontmatter schema 校验`

**文件**:
- 新建 `astro-src/scripts/paper-validate.mjs`(~120 行)

**实施**:
```javascript
const REQUIRED_FIELDS = ['title', 'authors', 'date', 'pdf', 'score', 'tldr', 'source'];
// 扫 docs/papers/**/*.md,断言每篇都有
// 失败论文 list
```

---

### A.2.2 - A.2.5: paper-validate 长度校验 / 查重 / 翻译检查 / 去重 bug

(类似结构,每个 ~50-80 行)

### A.3.1 - A.3.3: freshness / CI 集成 / 质量检测

(类似结构)

---

## R7.4 — 文献库 UX + 数据(D.1-D.2)

> 目标:15 commit,改 paper-detail 页 + library 工作台 + 7 个库模板 + 统计

### D.1.1 `feat(library): 「从论文创建库」一键按钮`

**文件**:
- 改 `astro-src/pages/papers/[arxiv].astro`(加 button,+30 行)
- 改 `astro-src/scripts/user-libraries-ui.ts`(加 handler,+30 行)

**实施**:
```javascript
// 在 paper-detail 页加
<button data-action="create-library-from-paper" data-paper-id={arxiv_id}>
  ➕ 创建文献库(以这篇为锚点)
</button>

// handler
document.querySelectorAll('[data-action="create-library-from-paper"]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const paper = allPapers.find(p => p.canonicalArxivId === btn.dataset.paperId);
    // 打开 new library modal,name = paper.title_zh,statement = paper.tldr,anchor = paper
  });
});
```

### D.1.2 - D.1.5: 7 库 template / merge 检测 / 导出 / Gist sync

### D.2.1 - D.2.5: validate / anchor 评分 / 统计 / freshness / 自动派生

---

## R7.5 — ideas / experiments / writing(E.1-E.4)

> 目标:18 commit,改 3 个模块的 UI + 数据层 + cross-link

### E.1.1 `feat(ideas): 「从论文创建 idea」一键按钮`

**文件**:
- 改 `astro-src/pages/papers/[arxiv].astro`(+20 行)
- 改 `astro-src/pages/ideas/index.astro`(列表展示 related_paper,+10 行)

### E.1.2 - E.1.5: versioning / status / cross-link UI / templates

### E.2.1 - E.2.5: hypothesis / variables / result / status / cross-link

### E.3.1 - E.3.5: outline / synthesis 整合 / citation / versioning / cross-link

### E.4.1 - E.4.3: dashboard activity / 统计 / time-to-paper

---

## R7.6 — agents 闭环深化(F.1-F.4)

> 目标:18 commit,深化各 agent 能力

### F.1.1 `feat(agents): designer proposal types 扩展到 8 种`

**文件**:
- 改 `astro-src/scripts/agents/designer.ts`(+30 行)

**实施**:
```typescript
const PROPOSAL_TYPES = [
  'add_paper', 'create_draft', 'experiment_plan', 'literature_review',
  'rebuttal', 'citation_review', 'dataset_curation', 'related_work'
];
// 在 prompt 里列 8 种类型
```

### F.1.2 - F.1.5: few-shot / confidence / feedback / test

### F.2.1 - F.2.5: 4 个 feedback 维度 + test

### F.3.1 - F.3.5: format / cross-ref / bib / citation graph / test

### F.4.1 - F.4.3: pipeline recovery / parallel / override

---

## R7.7+ — concepts / 站点 / 基础设施(G/H/I)

> 目标:32 commit,改基础 + 性能 + UX

### G.1 - G.3: concepts(8 commit,~280 行)

### H.1 - H.3: 站点性能 + UX + 页面(12 commit,~560 行)

### I.1 - I.3: CI/CD + 测试 + DevOps(12 commit,~410 行)

---

## J.1-J.15 — Debug commits 模式

每个 J 类 commit 用 **统一格式**:

```
<commit hash>  fix(<area>): user feedback #N 修 <具体描述>

用户反馈:
  - "<用户原话>"

修复:
  - <改动 1>
  - <改动 2>

测试:
  - <验证步骤>
```

**预留空位**(15 个):
- J.1, J.2, J.3 - R7.1 B 类预留
- J.4, J.5, J.6 - R7.2 C 类预留
- J.7, J.8 - R7.3 A 类预留
- J.9, J.10, J.11 - R7.5 E 类预留
- J.12, J.13 - R7.6 F 类预留
- J.14 - G/H/I 任一
- J.15 - 任意

用户说 "改 X" 时:
1. 我开 J.x debug commit
2. 改 + commit
3. 用户 review → 可能再开 J.(x+1) commit

---

## 总览:每个 commit 的验证模式

| commit 类型 | 验证模式 |
|---|---|
| 新增 prompt 注入 | 跑 quickstart,grep archive/<sid>/rounds/*.json 看 system 字段 |
| 新增 backfill 脚本 | `--dry-run --limit N` 抽样验证,再 `--apply --all` |
| 新增 audit 脚本 | `--check` 列出失败,`--ci` exit code |
| 新增 UI 按钮 | dev server 跑,手动点击验证 |
| 改 workflow yml | push,看 GH Actions 跑成功 |
| 改 Python pipeline | 本地 `python -m src.main --dry-run` 验证 |

---

## 用户反馈循环设计

每 1-3 个 commit 我会停,说「已 commit x/y,等你 review」。

你说"改 X" → 我开 J 类 commit。
你说"继续" → 我继续下一个 commit。
你说"暂停" → 我停。
你说"改 R7.x 优先级" → 我调整后续顺序。

---

## 风险与备选

| 风险 | 缓解 |
|---|---|
| 跨模块改动冲突 | 每个 commit 独立可回滚 |
| LLM 成本失控 | 用本地 8124 代理 + cheap model + dry-run 先验 |
| Workflow 跑不动 | workflow_dispatch 手动 trigger + 本地 python -m src.main |
| UI 改动破坏 mobile | dev server 多 viewport 测 |
| 跨文件改动漏改 | commit 前 grep + type check |

---

**变更日志**
- 2026-09-14:首次建立(R7 全 commit 施工图)