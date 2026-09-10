# 🤖 Agents 工作流文档

> DPR 的 **3 智能体闭环**（Designer → Feedback → Modifier，Gate 在中间做硬过滤）的设计哲学、与主流科研自动化工具的对比、以及上手路径。

最后更新：2026-09-10（iter #70/71/72/73 加 full research pipeline + Reviewer/Reviser agents + /agents/pipelines/ 浏览器概览 + /agents/<sid>/pipeline/ 单 session 详情页）

---

## 1. 为什么是 3 个智能体，不是 1 个？

单 LLM 一次性"研究 → 提议 → 评估 → 落地"的失败模式很常见：

1. **自我一致 bias** — 同一个 LLM 既出 idea 又评估 idea，倾向于"看起来不错"；
2. **没有 persona 视角** — 一个 prompt 无法同时兼顾方法论的严谨、工程人的成本意识、怀疑论者的 novelty 警惕；
3. **没有可重入迭代** — 一次性 prompt 没法让本轮的 critique 真正影响下一轮的 proposal；
4. **没有可审计边界** — 一个长 prompt 的中间状态不可观察、不可中断、不可恢复。

DPR 的解法：把流水线拆成 **3 个有清晰输入输出的智能体 + 1 个可调阈值 Gate**，每一步单独可观测、可 stub、可重跑。

```
┌──────────────────────────────────────────────────────────────┐
│  Designer  ──►  Feedback  ──►  Gate  ──►  Modifier            │
│   提议 N 条     3 persona 评分     桶化     真写 .md           │
│   Proposal[]   + Elo 配对        4 桶    deliverables        │
└──────────────────────────────────────────────────────────────┘
                       ↑                      │
                       └──── 摘要回流 ─────────┘
                       （让下一轮 Designer 不重复）
```

---

## 2. 3 个智能体的职责

| 智能体 | 职责 | 输入 | 输出 | Stub 行为 |
|---|---|---|---|---|
| **Designer** (`designer.ts`) | 读 project + candidates + 上一轮摘要 → 提出 3-8 条 Proposal | `RoundInput` (project / candidates / previous_rounds / user_goal) | `Proposal[]`（type ∈ add_paper / create_draft / experiment_plan / literature_review / rebuttal） | 返回 1 条 `literature_review` 占位 |
| **Feedback** (`feedback.ts`) | 3 persona 平行评分 + Swiss-pair Elo 配对 | `Proposal[]` | `Critique[]`（每个 proposal 1 条，含 3 persona 分 + Elo） | 均匀 `total=5`，persona_attribution='(stub)' |
| **Gate** (`gate.ts`) | 应用阈值把 proposal 分到 4 桶 | `Proposal[]` + `Critique[]` + preset | `GateVerdict[]`（promoted / candidate / sketch / rejected） + safety override | 纯函数，无 LLM 调用 |
| **Modifier** (`modifier.ts`) | promoted/candidate 的 proposal 真写 deliverables | `GateVerdict[]` + `Proposal[]` | `ModifierAction[]`（write_draft_md / write_review_md / write_experiment_md / write_paper_addition_md / write_rebuttal_md） | dry-run 写 ⚠️ 占位符 |

`Gate` 不是智能体（不调 LLM），是 **policy**。三档预设保守度：

| Preset | promoted (minScore + minElo) | candidate | sketch |
|---|---|---|---|
| `conservative` | 8.5 + 1280 | 7.0 + 1250 | ≥ 5.0 |
| **`balanced`** (默认) | 8.0 + 1280 | 6.0 + 1232 | ≥ 4.0 |
| `aggressive` | 7.0 + 1232 | 5.0 + 1200 | ≥ 3.0 |

外加 `applySafetyOverride()`：含"不可逆 / 数据丢失 / catastrophic"等关键词的 proposal 即便 promoted 也降级到 candidate，留给人类 review。

---

## 3. 与主流科研自动化工具的对比

| 维度 | **DPR Agents** | **Sakana AI Scientist v2** | **STORM** (Stanford) | **AutoGen** (Microsoft) | **OpenAI Deep Research** |
|---|---|---|---|---|---|
| **目标** | 持续推进用户的研究项目（加论文 / 写草稿 / 设计实验） | 端到端自动生成一篇可投稿的论文 | 从多个源综合出一份带引用的研究报告 | 通用多 agent 对话框架（不限定科研） | agentic research with tool use |
| **输入** | Project + 候选论文 + 用户目标 | 1 个 research idea | 1 个研究问题 | 用户定义的 agent 角色 | 自然语言 query |
| **Agent 架构** | 固定 3（Designer / Feedback / Modifier）+ Gate | 多阶段（Idea → Exp → Writeup → Review），每阶段独立 LLM | Writer + 多 Perspective Agents（百科 / 论文 / 评论 / 访谈） | 任意 N 个 agent，用户自定义 role | 单 agent with tool loop |
| **反馈机制** | **3 persona + Swiss-pair Elo**（同 proposal 复用同一 Elo） | 自评 + LLM-as-reviewer | 引用密度自检 | 用户定义 | tool 反馈（web fetch / 搜索结果） |
| **输出** | `archive/<sid>/{drafts,reviews,experiments,paper_additions,rebuttals}/` + `synthesis/` markdown | 完整 LaTeX 论文 + 实验日志 | 带 Wikipedia-style 引用的 markdown 报告 | 多 agent 聊天的 transcript | 带 web 引用的长报告 |
| **多 session 学习** | ✅ `--few-shot-from N`（iter #39）+ `--leaderboard`（iter #34） | ❌ 单次跑通 | ❌ 单 session | ❌ 无内置跨 session | ❌ 单次 |
| **自动停** | ✅ plateau 检测（stdDev < 0.3 持续 N 轮）+ empty streak（iter #16/iter #45） | ❌ | ❌ | ❌ | ❌ |
| **工具使用** | ❌（仅调 arXiv 候选 + LLM） | ✅ Python sandbox 跑实验 | ✅ Web 搜索 / Wiki API | ✅ 任意 tool | ✅ web + file |
| **前端 / UI** | ✅ `/agents/` 9 页面 + 实时可视化 | ❌ CLI only | ❌ 单页 web | ❌ CLI / Python lib | ❌ chat only |
| **部署门槛** | 0 后端，纯前端 + Node CLI | 需要 LLM + Python env + GPU 实验 | 需要 LLM + 维基 API | 需要 LLM | 闭源，仅 API |
| **开源** | ✅ MIT | ✅ Apache 2.0 | ✅ MIT | ✅ CC-BY-4.0 | ❌ |

### DPR 的优势（相对 Sakana / STORM / AutoGen）

1. **可审计** — 每轮 RoundRecord JSON 落盘，每一步可重放；Sakana / AutoGen 是黑盒聊天
2. **多 persona + Elo 反馈** — 不是单一 LLM 自评；persona 分歧直接反映在 Gate 桶化
3. **多 session 学习** — `--leaderboard` + `--few-shot-from` 让新 session 自动从过去胜出 proposal 学；Sakana / STORM 每次重置
4. **自动收敛** — plateau / empty streak 检测，用户不用盯着；其它工具都没内置
5. **UI 全栈** — 9 个 Astro 页面 + session dashboard + 跨 session 对比 + coverage map
6. **0 后端** — 纯前端 + Node CLI，无需 GPU / 数据库 / 服务器
7. **完整 archive** — 每个 session 自带 `meta.json` + `rounds/*.json` + `digest_*.md` + `synthesis/*.md`，git-trackable

### DPR 的差距（相对 Sakana / STORM / OpenAI Deep Research）

1. **无 tool use** — Designer 不能调 arXiv 搜索、不能写代码；Sakana 能跑实验、OpenAI Deep Research 能搜 web
2. **不写 LaTeX 论文** — Sakana AI Scientist v2 的目标就是"产出可投稿的 paper"，DPR 只产出 markdown 草稿
3. **不是真正的 web research** — STORM / Deep Research 能拉维基 / 联网，DPR 局限在用户的论文库 + arXiv 候选
4. **实验执行能力为零** — Sakana 能跑 Python / 调 GPU，DPR 只规划实验（`experiment_plan` Proposal）

---

## 4. 何时用 DPR 而不是其它工具？

| 场景 | 推荐 | 理由 |
|---|---|---|
| 持续推进**自己的**研究项目（加论文 / 写综述 / 设计实验） | **DPR** | 状态机 + 多 session 学习 + UI dashboard，其它工具都是单次黑盒 |
| 已有 idea 想**自动生成可投稿的论文** | Sakana AI Scientist v2 | 端到端 pipeline + 实验执行 |
| 从零开始**调研一个新主题**（无自己的论文库） | STORM / OpenAI Deep Research | web research + 自动综合 |
| 想要**任意多 agent 框架**做科研以外的事 | AutoGen | 通用，可自己设计 role |
| 想**完全本地、可控、可审计** | **DPR** | 0 后端 + git-trackable archive |

---

## 5. 上手路径

### 5.1 CLI 零摩擦入口（iter #54 引入）

```bash
# 1 行命令,无需任何 API key:
node astro-src/scripts/agents-run.mjs --quickstart "探索 LLM 智能体如何自动化研究"
```

这条命令做 4 件事：
1. 创建 `archive/<8-char-sid>/{meta.json, rounds/}`
2. 跑 1 round（dry-run + preset=aggressive，**Modifier 会真写 deliverable**）
3. 写 `digest_<YYYYMMDD>.md` + `synthesis/synthesis_001.md`
4. 打印友好 summary 列出 4 条 follow-up 命令

跑完后看输出：

```bash
ls archive/<sid>/                 # meta + rounds + digest + synthesis
cat archive/<sid>/rounds/round_001.json   # Designer/Feedback/Gate/Modifier 完整轮
ls archive/<sid>/reviews/         # Modifier 真写的 deliverable

# iter #61: 把碎片装配成论文(markdown + LaTeX + .bib)
node astro-src/scripts/agents-run.mjs --session <sid> --compile-paper
ls archive/<sid>/paper/           # paper.md / paper.tex / refs.bib

# iter #63: synthesis 整成 1 份打印就绪 HTML(浏览器 Cmd/Ctrl+P → Save as PDF)
node astro-src/scripts/agents-run.mjs --session <sid> --export-pdf
open archive/<sid>/synthesis.html  # macOS 用 Preview 打开,Cmd+P

# iter #64: --compile-paper 选 LaTeX 模板(article / acmart / IEEEtran / iclr2026 / neurips / acl / llncs / aaai / ijcai)
node astro-src/scripts/agents-run.mjs --list-templates
node astro-src/scripts/agents-run.mjs --session <sid> --compile-paper --latex-template acmart
node astro-src/scripts/agents-run.mjs --session <sid> --compile-paper --latex-template ieeeconf
node astro-src/scripts/agents-run.mjs --session <sid> --compile-paper --latex-template llncs

# iter #66: 对比同 session 两份 synthesis(主题 / refs / 字数增量 + Jaccard similarity)
node astro-src/scripts/agents-run.mjs --session <sid> --diff-syntheses 1 2
node astro-src/scripts/agents-run.mjs --session <sid> --diff-syntheses 1 2 --json

# iter #68: general web search(Tavily backend + stub fallback;需要 WEB_SEARCH_API_KEY)
node astro-src/scripts/agents-run.mjs --web-search "LLM agent benchmark 2026" --web-max 5
WEB_SEARCH_API_KEY=tvly-... \
  node astro-src/scripts/agents-run.mjs --web-search "RLHF survey 2026" \
    --include-domain arxiv.org --include-domain openreview.net \
    --exclude-domain twitter.com --min-score 0.7 --json

# iter #69: 跑 Evaluator 4th agent(对已有 session 产出整体分 + 4 子分 + 明细)
node astro-src/scripts/agents-run.mjs --session <sid> --evaluate
cat archive/<sid>/evaluation_001.json | jq '.scores'      # 机器读
node astro-src/scripts/agents-run.mjs --session <sid> --evaluate --json
```

### 5.2 接真 LLM 跑 3 轮

```bash
LLM_BASE_URL=https://api.deepseek.com/v1 \
LLM_API_KEY=sk-... \
LLM_MODEL=deepseek-chat \
  node astro-src/scripts/agents-run.mjs \
    --new-session "多智能体协作研究 RLHF" \
    --rounds 3 --preset balanced
```

3 轮跑完会自动检测 plateau（最后 N 轮 avg score 标准差 < 0.3）或 empty streak（连续 N 轮 0 applied）提前停。

### 5.3 接真 LLM 跑自治模式（autonomous loop）

```bash
LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=... \
  node astro-src/scripts/agents-run.mjs \
    --auto "为 RLHF 设计可解释的 reward model 评估协议" \
    --max-cycles 5 --auto-stop-threshold 2 --auto-directive-mode both
```

每 cycle 跑 1 round + 1 synthesis，synthesis 的 `gaps_contradictions` + `next_steps` 回流为下一 round 的 Designer context。直接给目标，让它自己收敛。

### 5.4 浏览器入口

打开 `/agents/`：
- **Session ID 输入** + preset + dry-run → 点 ▶️ 跑 1 轮
- 结果渲染为卡片（proposals / critiques / gate 桶 / modifier 动作）
- **🔁 自动迭代到收敛** 勾选 → plateau 检测自动跑
- 历史存 `localStorage:dpr_agents_rounds_<sid>`，刷新可续
- `/agents/auto/` 是 auto loop 的可视化 dashboard
- `/agents/new-session/` 是模板式引导（literature_review / experiment_plan / rebuttal / free_form）
- `/agents/<sid>/compile/` 是 iter #62 —— iter #61 `--compile-paper` 的浏览器版（实时切换 LaTeX/markdown/.bib 预览 + 3 文件下载）
- `/agents/<sid>/pdf/` 是 iter #63 —— iter #63 `--export-pdf` 的浏览器版(实时切 academic / compact / presentation 3 种 CSS 变体预览,Download 单文件 .html,Save as PDF 即可)

### 5.5 看全局战况

```bash
# 跨 session 聚合:哪种 proposal type 产出最多
node astro-src/scripts/agents-run.mjs --leaderboard
node astro-src/scripts/agents-run.mjs --leaderboard --type create_draft --top 5

# 跨 session 让新 session 学到 Elo 最高的 few-shot examples
node astro-src/scripts/agents-run.mjs --new-session "新目标" --rounds 3 --few-shot-from 5
```

---

## 6. 已知限制与未来工作

- ❌ ~~**Designer 不能调外部工具**~~ — **iter #56 已修复 `--search-arxiv`**:可调 arXiv API 实时拉论文作为 candidates,关闭了最大短板
- ❌ ~~**Modifier 不写 LaTeX**~~ — **iter #61 已修复 `--compile-paper`**:session 碎片装配成可编译 LaTeX + markdown + .bib,论文章节由 deliverable kind 路由(Intro / Related Work / Method / Results / Limitations)
- ❌ ~~**synthesis 没法直接出 PDF**~~ — **iter #63 已修复 `--export-pdf`**:session 所有 `synthesis/*.md` 装配成 1 份自包含打印就绪 HTML(内嵌 CSS + `@page` + 页码),用户在浏览器 `Cmd/Ctrl+P` → "Save as PDF" 即可;**不依赖** pandoc / wkhtmltopdf 等系统 PDF 工具
- ❌ ~~**`--compile-paper` 只支持 article class**~~ — **iter #64/65 已修复 `--latex-template`**:6 个 LaTeX 模板 (`article` / `acmart` / `ieeeconf` / `iclr2026` / `neurips` / `acl`) 各自的 preamble + title block + compile hint,`PAPER_LATEX_TEMPLATES` 注册表集中管理;acmart 走 sigconf 单栏会议模板,IEEEtran 走 conference proceedings,iclr2026 / neurips / acl 都是占位模板提示用户先下载会议官方 .sty
- ❌ ~~**synthesis 之间没法对比**~~ — **iter #66 已修复 `--diff-syntheses`**:对比同一个 session 的 2 份 `synthesis_*.md`,输出 meta delta (rounds / unique_papers / model / title / 时间)+ body delta (topics set diff / refs arXiv id set diff / 字数变化)+ Jaccard similarity (topics 0.7 + refs 0.3 加权);新 `lib/agents/synthesis-diff.{mjs,ts}` 纯函数(跟 export-bundle / paper-compiler / synthesis-pdf 同双 surface 共享模式);`--diff-syntheses <idxA> <idxB>` 一条命令出 diff,加 `--json` 出机器可读
- ❌ ~~**`--compile-paper` 只支持 6 个会议模板**~~ — **iter #67 已扩展 `PAPER_LATEX_TEMPLATES` 到 9 个**:再加 `llncs` (Springer Lecture Notes in Computer Science / llncs.cls) + `aaai` (AAAI / aaai24.sty 占位,年份可改) + `ijcai` (IJCAI / ijcai24.sty 占位,年份可改);每个模板都有官方下载链接(Springer 作者指南 / AAAI Author Kit / IJCAI Authors)+ 注释化的 `\documentclass` 切换 + 编译提示 warn ⚠️ + 回退到 article 的说明;`--list-templates` 现在列 9 个;不动 article / acmart / ieeeconf / iclr2026 / neurips / acl 行为
- ❌ **archive/ 不入版本控制**：每次 git status 容易"看上去大"，但 archive 在 .gitignore 顶层通常没问题；可手动 cp 出 demo
- ⚠️ **3 个智能体都共用 1 个 LLM endpoint**：persona 视角差异主要靠 prompt 实现，不是真不同模型；要"真多视角"可在 feedback.ts 加 model 数组
- ⚠️ **`--search-arxiv` 只搜 arXiv**：不像 STORM / Deep Research 那样能搜维基 / 联网；要"真 web research"需要加 web fetch 工具
- ❌ ~~**没有 general web search**~~ — **iter #68 已修复 `--web-search`**:Tavily backend(需要 `WEB_SEARCH_API_KEY`,没设自动 fallback 到 stub 模式返回 0 结果,不报错);支持 `--include-domain` / `--exclude-domain` / `--web-max N` / `--min-score N` / `--web-backend stub|tavily` 过滤;新 `lib/agents/web-search.{mjs,ts}` 纯函数(跟 export-bundle / paper-compiler / synthesis-pdf / synthesis-diff 同双 surface 共享模式):`normalizeWebSearchUrl`(去 utm_*/fbclid/gclid 等 tracking params,强制 https,去 fragment,去尾 slash)+ `buildTavilyRequest` + `parseTavilyResponse`(strip html 标签 + 截 500 字符 snippet)+ `dedupeWebSearchResults`(按 normalized url 去重,score max 合并)+ `filterWebSearchResults`(includeDomains/excludeDomains 含 subdomain 匹配 + minScore)+ `formatWebSearchText` CLI 渲染
- ❌ ~~**没有 Evaluator agent 评估产物好坏**~~ — **iter #69 已修复 `--evaluate`**:4 agent 闭环的"评估"agent,standalone 模式不参与 round loop,读已有 archive/<sid>/{meta,rounds,deliverables,synthesis} 产出 EvaluationReport:overall (0-1) + 4 子分 (coverage 0.25 + alignment 0.30 + consistency 0.15 + synthesisCoverage 0.30 加权) + coverage by ProposalType(proposed vs applied + applyRate + firstRound/lastRound)+ goal alignment per-deliverable(token overlap)+ references(deliverable ∩ synthesis arXiv id)+ contradictions 计数(however/但是/反之/although 等轻启发句数)+ gate histogram;新 `lib/agents/evaluator.{mjs,ts}` 纯函数(同双 surface 共享模式):`tokenizeForKeywords`(CJK 连续 2+ 字符 1 token + 英文 hyphen token + 删 markdown 控制字符 + 删常见中英停用词)+ `keywordOverlap`(sharedTokens / goalTokens)+ `basicContradictionMarkers`(句数统计)+ `extractArxivIds`(复用 iter #66 regex)+ `buildEvaluationReport`(核心纯函数)+ `formatEvaluationReportText`(CLI 渲染 + grade emoji 🟢≥0.7 / 🟡≥0.4 / 🔴<0.4)+ `toJSON`(双 surface 序列化);`--evaluate --session SID` 一条命令出 report(写 archive/<sid>/evaluation_NNN.json + .md + stdout summary),加 `--json` 出机器可读 JSON

下个 milestone 候选：
- 跨平台 npm 包发布：让 DPR Agents 不只跑在仓库内
- synthesis PDF 加可选项:加 cover image、加 author byline、加 table of figures
- 用真 LLM 编译 acmart / IEEEtran 验证模板不会真出错

最近重要迭代：

| iter | 主题 | 关键改动 |
|---|---|---|
| #39 | --few-shot-from | 跨 session Designer 学习 leaderboard topElo |
| #50 | --bulk | 多 session 批量操作 |
| #51 | round annotations | localStorage 给 round 加批注 |
| #52 | round comparison matrix | session dashboard 对比 2 轮 |
| #53 | paper × persona matrix | session dashboard 对比论文 × 视角 |
| #54 | --quickstart | 零摩擦 first-run + agents-workflow.md 参考 |
| #55 | --quickstart e2e | 真实子进程端到端 smoke 6 项断言 |
| **#56** | **--search-arxiv** | **Designer 真 tool use;关闭最大短板** |
| **#57** | **--export-md** | **整 session 一键打包成 1 个 markdown,便于分享 / 归档 / 二次处理** |
| **#58** | **/agents/<sid>/export/** | **浏览器版本 export 页面 — Download .md / Copy to clipboard / Preview** |
| **#59** | **lib/agents/export-bundle.mjs** | **CLI + 浏览器双 surface 共享同一份 buildExportBundle / formatExportMarkdown,字节级一致** |
| **#60** | **lib/agents/export-bundle.ts** | **typed mirror,TS caller 也能用同一份实现** |
| **#61** | **--compile-paper** | **3 智能体循环碎片 → 一篇可编译 LaTeX + markdown + .bib,关闭 §6 #1 差距 "Modifier 不写 LaTeX";新 lib/agents/paper-compiler.{mjs,ts} 纯函数,跟 export-bundle 同双 surface 共享模式** |
| **#62** | **/agents/<sid>/compile/** | **iter #61 的浏览器版 —— 实时切换 LaTeX/markdown/.bib 预览 + 3 文件下载套件,document class 切换 (article / acmart / ieeeconf / iclr2026);同 paper-compiler.mjs 双 surface 字节级一致;localStorage 合成 pseudo-deliverable 应对浏览器无 filesystem 限制** |
| **#63** | **--export-pdf + /agents/<sid>/pdf/** | **synthesis/*.md → 1 份自包含打印就绪 HTML(内嵌 CSS + @page + 页码,3 种 CSS 变体 academic / compact / presentation);用户浏览器 Cmd/Ctrl+P → "Save as PDF";不依赖 pandoc / wkhtmltopdf 等系统 PDF 工具;新 lib/agents/synthesis-pdf.{mjs,ts} 纯函数,跟 export-bundle / paper-compiler 同双 surface 共享模式;CLI + 浏览器页面同步上线** |
| **#64** | **--latex-template + PAPER_LATEX_TEMPLATES** | **`--compile-paper` 扩展到 4 个 LaTeX 模板:`article` (默认) / `acmart` (ACM sigconf 单栏会议) / `ieeeconf` (IEEEtran conference) / `iclr2026` (占位,需先下载 iclr_conference.sty);每个模板独立的 preamble + title block + compile hint,集中注册表管理;CLI `--latex-template T` + `--list-templates`;新 `getLatexCompileHint` + `listLatexTemplates` 辅助函数;不动 article 行为, 73/73 paper-compiler 测试 + 242/242 跨 iter 测试通过** |
| **#65** | **NeurIPS / ACL templates** | **`PAPER_LATEX_TEMPLATES` 再加 2 个会议模板:`neurips` (NeurIPS 2024 + preprint option,占位需下载 neurips_2024.sty) / `acl` (ACL + acl_natbib,占位需下载 acl.sty + acl_natbib.sty);每个都有官方下载链接 + sty 缺失回退到 article 的说明;`--list-templates` 现在列 6 个;不动 article / acmart / ieeeconf / iclr2026 行为;81/81 paper-compiler 测试 + 跨 iter 全套绿** |
| **#66** | **--diff-syntheses** | **同一 session 的 2 份 synthesis_*.md 对比:meta delta (rounds / unique_papers / model / title / 时间)+ body delta (H1/H2/H3 主题 set diff + arXiv id refs set diff + 字数变化)+ Jaccard similarity (topics 0.7 + refs 0.3 加权);新 `lib/agents/synthesis-diff.{mjs,ts}` 纯函数,跟 export-bundle / paper-compiler / synthesis-pdf 同双 surface 共享模式;`--diff-syntheses <idxA> <idxB>` 一条 CLI 命令出 diff(加 `--json` 机器可读);44 个新单测覆盖 stripFrontmatter / extractTopics / extractRefs / countWords / diffSyntheses / formatText / 字节稳定 / 不变更输入** |
| **#67** | **LnCS / AAAI / IJCAI templates** | **`PAPER_LATEX_TEMPLATES` 从 6 个扩到 9 个 — 加 `llncs` (Springer Lecture Notes in Computer Science,占位需下载 llncs.cls) + `aaai` (AAAI,占位需下载 aaai24.sty 或当前年) + `ijcai` (IJCAI,占位需下载 ijcai24.sty 或当前年);每个模板都有官方下载链接(Springer 作者指南 / AAAI Author Kit / IJCAI Authors)+ 注释化的 `\documentclass` 切换 + 编译提示 warn ⚠️ + 回退到 article 的说明;`--list-templates` 现在列 9 个模板;94/94 paper-compiler 测试通过(原 81 + 新 13:preamble/titleBlock/compileHint 字段断言 + formatPaperLatex dispatch + 9 模板独立 preamble + 9 模板 LaTeX 环境平衡 + 9 模板 bibitem 数 + 9 模板字节稳定 + 9 模板 null draft);纯增量,不动 article / acmart / ieeeconf / iclr2026 / neurips / acl 行为** |
| **#68** | **--web-search (Tavily backend + stub fallback)** | **General web search 工具,关闭与 Sakana/STORM/OpenAI Deep Research "tool use" 的第二大短板(第一是 iter #56 --search-arxiv);默认 stub mode(零依赖零网络,返回 0 结果),有 `WEB_SEARCH_API_KEY` 时走 Tavily(`https://api.tavily.com/search`);支持 `--include-domain D` / `--exclude-domain D` / `--web-max N` / `--min-score N` / `--web-backend stub\|tavily` 过滤 + `--json` 出机器可读;新 `lib/agents/web-search.{mjs,ts}` 纯函数(跟 export-bundle / paper-compiler / synthesis-pdf / synthesis-diff 同双 surface 共享模式):8 个 export 函数 `normalizeWebSearchUrl`(去 utm_*/fbclid/gclid/ref_*/hsa_*/__hs*/mc_*/_ga/_gl/_gid/oly_*/vero_*/trk/ncid/icid/src 等 tracking params + 强制 https + 去 fragment + 去非 root 尾 slash)+ `stubSearch` + `buildTavilyRequest`(拼 POST body)+ `parseTavilyResponse`(strip html 标签 + 截 500 字符 snippet + 抽 source domain + 抽 score + 抽 published_date)+ `dedupeWebSearchResults`(按 normalized url 去重,score max 合并)+ `filterWebSearchResults`(includeDomains/excludeDomains 含 subdomain 匹配 + minScore 过滤;没 score 字段的结果总是保留)+ `searchWeb`(主入口 stub/tavily 路由)+ `formatWebSearchText`(CLI stdout 渲染含 score + publishedAt + snippet 截 200 字符);42 个新单测覆盖 normalize 9 + stub/searchWeb 5 + buildTavilyRequest 5 + parseTavilyResponse 6 + dedupe 4 + filter 6 + format 7 + 字节稳定;不影响已有 `archive/` 文件结构(纯只读 fetch + stdout)** |
| **#69** | **--evaluate (Evaluator 4th agent)** | **4 agent 闭环的"评估"agent — 关闭 docs/agents-workflow.md §6 "evaluator 智能体"候选。standalone 模式不参与 round loop,纯本地计算读 archive/<sid>/{meta,rounds,deliverables,synthesis} 产出 EvaluationReport:overall (0-1) + 4 子分加权 (coverage 0.25 + alignment 0.30 + consistency 0.15 + synthesisCoverage 0.30) + grade emoji 🟢≥0.7/🟡≥0.4/🔴<0.4 + coverage by ProposalType(proposed/applied/applyRate/firstRound-lastRound)+ goal alignment per-deliverable(token overlap)+ references(deliverable ∩ synthesis arXiv id,unique-to-deliverable/synthesis)+ contradictions 计数(however/但是/反之/although 等轻启发句数)+ gate histogram。CLI `--evaluate --session SID` 一条命令出 report(写 archive/<sid>/evaluation_NNN.{json,md} + stdout summary),加 `--json` 出机器可读 JSON;不动 3 agent 闭环,可重复跑(每次 increment NNN 序号)。新 `lib/agents/evaluator.{mjs,ts}` 纯函数(同双 surface 共享模式):8 个 export `tokenizeForKeywords`(CJK 连续 2+ 字符 1 token + 单字冗余排除 + 英文 hyphen token + 删 markdown 控制字符 + 删常见中英停用词)+ `keywordOverlap`(sharedTokens/goalTokens/deliverableTokens,overlap = shared/goal)+ `basicContradictionMarkers`(按中英句号/换行 split,regex 匹 however/but/yet/although/whereas/on the other hand/contrary to/然而/但是/不过/虽然/反之/与此相反)+ `extractArxivIds`(复用 iter #66 regex)+ `buildEvaluationReport`(核心纯函数,空输入 null-safe 默认)+ `formatEvaluationReportText`(CLI 渲染含 8 个区块:summary/coverage/alignment/references/contradictions/synthesis/gate)+ `toJSON`(双 surface 序列化)。39 个新单测覆盖 extractArxivIds 4 + tokenizeForKeywords 3(含 stop words 含 CJK runs)+ keywordOverlap 4 + basicContradictionMarkers 4 + coverage 4 + gate histogram 1 + goalAlignment 2 + references 2 + contradictions 3 + synthesis + overall 2 + invariants 2(null-safe/字节稳定/不变更输入) + format 4 + toJSON 2** |
| **#70** | **lib/agents/pipeline.mjs (Full research-pipeline coordinator)** | **把"研究全流程"封装成 7 stage state machine:`p_ideate_research_question → p_review_literature → p_design_experiment_plan → p_write_paper_draft → p_simulate_peer_review → p_revise_paper → p_export_final_paper`,对齐 Sakana AI Scientist v2 的 Idea→Exp→Writeup→Review 多阶段设计,但每阶段独立可 stub、可中断、可单独 resume。每 stage 显式 `PIPELINE_GATES`(minDeliverables + minTotalScore + minArxivRefs + requireForAdvance + notes),gate_failed 自动停 + stoppedReason='gate_failed',`--start-stage-idx N` 可从断点续跑。新 `lib/agents/pipeline.{mjs,ts}` 纯函数(同双 surface 共享模式):`PIPELINE_STAGES`(frozen 7 stage 枚举)+ `PIPELINE_STAGE_LABELS`(中英对照)+ `PIPELINE_GATES`(每 stage 阈值)+ `STAGE_TO_PROPOSAL_TYPE`(复用 3 agent loop)+ `STAGE_DELIVERABLE_DIRS`(复用 modifier deliverable dirs)+ `buildPipelinePlan`(goal + startStageIdx + skipStages → 7 stage skeleton)+ `evaluateStageGate`(stage + deliverables → {passed, reasons, gate})+ `advancePipeline`(plan + currentIdx + gateResult → {nextStageIdx, stoppedReason})+ `runPipelineStage`(单 stage 入口,内部按 stage 类型 dispatch:export→paper-compiler / review→reviewer / revise→reviser / 其它→3 agent loop)+ `runPipeline`(主入口,按 startStageIdx→maxStages 顺序串 7 stage,任一 gate_failed 停)+ `formatPipelinePlanText`(CLI stdout)+ `summarizePipeline`(stats)+ `toJSON`(序列化)。49 个新单测覆盖 PIPELINE_STAGES 2 + PIPELINE_GATES 2 + STAGE_* 2 + buildPipelinePlan 4 + evaluateStageGate 6 + advancePipeline 4 + runPipelineStage 4(stub mode 含 ideation/review/revise/export)+ runPipeline 2(全跑 7 stage + missing goal)+ formatPipelinePlanText 1 + summarizePipeline 1 + toJSON 1** |
| **#71** | **Reviewer + Reviser agents (paper-level feedback loop)** | **关闭 Sakana AI Scientist v2 没有的环节 —— Sakana 只跑 1 轮 review,DPR pipeline 用 (review → revise) 多轮反馈逼近真实 revision 流程。新 `lib/agents/reviewer.{mjs,ts}` 与 `lib/agents/reviser.{mjs,ts}` 两个 paper-level agent。Reviewer:对 draft 做 simulated peer review,5 维评分(novelty/soundness/clarity/experiments/writing,每项 0-10,overall = avg)+ major/minor concerns(severity + persona + category + claim + detail)+ recommendation ∈ {accept, weak_accept, revise, weak_reject, reject};prompt 鼓励"严苛,不要讨好";stub mode 给 borderline 'revise' verdict。Reviser:接 ReviewVerdict + draft,产 RevisionVerdict(body 完整修订后草稿 + log 每条 concern 的 status ∈ {addressed, partial, not_addressed} + 3 个 counts);stub mode 按 concern 关键词简单分流(baseline/novelty→addressed;其它→partial);失败 fallback 保留原 body。19 个新单测覆盖 reviewer 11(recommendation 校验 + 5 维评分 + overall 数学 + ≥ 1 major + ≥ 1 minor + stub 一致性)+ reviser 8(log 长度 + sort + counts 数学 + empty concerns 处理 + null verdict)** |
| **#72** | **--full-pipeline (CLI 串 7 stage)** | **CLI 一条命令跑完整个研究全流程。`--full-pipeline [GOAL]` 自动 bootstrap meta.json(无 --session 时自动 generateSessionId)+ 加载 candidates + 串 7 stage;`--pipeline-status --session SID` 只读 print 最新 pipeline_*.json 进度;`--review-draft PATH` + `--revise-draft PATH --review-json PATH` 单独跑 reviewer / reviser;`--skip-stages LIST` + `--start-stage-idx N` 支持跳过与续跑;`--json` 全程机器可读。每跑一次写 archive/<sid>/pipeline_NNN.{json,md}(N = time-suffix stamp,递增),markdown 含 stoppedReason + summary + 7 stage 详细状态 + gate reasons。dry-run 无 API key 也能完整跑通 7 stage(全部走 stubDeliverablesForStage / stubReviewStage / stubReviseStage)** |
| **#73** | **/agents/pipelines/ + /agents/<sid>/pipeline/ (浏览器 pipeline 视图)** | **把 iter #70/72 的 pipeline 概念搬到浏览器。`/agents/pipelines/` 跨 session 概览:列所有有 archive/<sid>/pipeline_*.json 的 session,展示 progress bar + status pill(stoppedReason 颜色编码:🟢 completed / 🔴 gate_failed / 🟡 error / ⚪ not run)+ 总 deliverables,点 View 进入单 session。`/agents/<sid>/pipeline/` 单 session 详情:SSR 内联最新 pipeline_*.json + 7 stage 进度行(中文 label + English label + status + deliv count + 失败时显示 gate reasons 红框)+ summary stats(已完成 stage 数 / 总 deliverables / stopped reason / current stage)。不调 LLM,纯 SSR + client-side 渲染(也读 localStorage 作为补充数据源)。从 /agents/index 加 🔬 Pipelines 入口,从 session index 加 🔬 7-stage pipeline 进度入口** |