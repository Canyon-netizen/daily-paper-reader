# 🤖 Agents 工作流文档

> DPR 的 **3 智能体闭环**（Designer → Feedback → Modifier，Gate 在中间做硬过滤）的设计哲学、与主流科研自动化工具的对比、以及上手路径。

最后更新：2026-09-10（iter #66 加 synthesis diff + 本文档）

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

# iter #64: --compile-paper 选 LaTeX 模板(article / acmart / IEEEtran / iclr2026 / neurips / acl)
node astro-src/scripts/agents-run.mjs --list-templates
node astro-src/scripts/agents-run.mjs --session <sid> --compile-paper --latex-template acmart
node astro-src/scripts/agents-run.mjs --session <sid> --compile-paper --latex-template ieeeconf

# iter #66: 对比同 session 两份 synthesis(主题 / refs / 字数增量 + Jaccard similarity)
node astro-src/scripts/agents-run.mjs --session <sid> --diff-syntheses 1 2
node astro-src/scripts/agents-run.mjs --session <sid> --diff-syntheses 1 2 --json
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
- ❌ **archive/ 不入版本控制**：每次 git status 容易"看上去大"，但 archive 在 .gitignore 顶层通常没问题；可手动 cp 出 demo
- ⚠️ **3 个智能体都共用 1 个 LLM endpoint**：persona 视角差异主要靠 prompt 实现，不是真不同模型；要"真多视角"可在 feedback.ts 加 model 数组
- ⚠️ **`--search-arxiv` 只搜 arXiv**：不像 STORM / Deep Research 那样能搜维基 / 联网；要"真 web research"需要加 web fetch 工具

下个 milestone 候选：
- 加 web search 工具（GeneralistAI / Tavily / Bing API）
- 加 evaluator 智能体：4 agent 版本（设计 → 反馈 → 修改 → **评估**）
- 跨平台 npm 包发布：让 DPR Agents 不只跑在仓库内
- `--latex-template` 扩到支持 Springer LnCS / AAAI / IJCAI 等会议模板
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