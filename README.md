<p align="center">
  <img src="others/LOGO.png" alt="Daily Paper Reader Logo" width="720" />
</p>

<h2 align="center">Your Daily Companion for Discovering and Reading AI Papers</h2>

<p align="center">
  <a href="https://github.com/Canyon-netizen/daily-paper-reader/stargazers">
    <img src="https://img.shields.io/github/stars/Canyon-netizen/daily-paper-reader?style=flat-square" alt="Stars" />
  </a>
  <a href="https://github.com/Canyon-netizen/daily-paper-reader/network/members">
    <img src="https://img.shields.io/github/forks/Canyon-netizen/daily-paper-reader?style=flat-square" alt="Forks" />
  </a>
  <a href="https://github.com/Canyon-netizen/daily-paper-reader/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/Canyon-netizen/daily-paper-reader?style=flat-square" alt="License" />
  </a>
  <a href="https://daily-paper-reader.pages.dev">
    <img src="https://img.shields.io/badge/Demo-Cloudflare%20Pages-2ea44f?style=flat-square" alt="Demo" />
  </a>
  <a href="#-5-分钟快速启动">
    <img src="https://img.shields.io/badge/Docs-Quick%20Start-blue?style=flat-square" alt="Docs" />
  </a>
</p>



## 🖼️ 界面预览
<p align="center">
  <img src="others/demo1.png" alt="Daily Paper Reader 界面预览 1" width="80%" />
</p>
<p align="center">
  <img src="others/demo2.png" alt="Daily Paper Reader 界面预览 2" width="40%" />
  <img src="others/demo3.png" alt="Daily Paper Reader 界面预览 3" width="40%" />
</p>

## 🆕 最近更新

- **2026-07-06** 🧹 仓库结构治理（17 个 commit，群聊式）：删 Docsify 前端 `app/` + 根 `index.html` + 6 个 orphan `tests/test_*.js`；`docs/_plans/` 迁移到仓库根 `plans/` 并抽 `astro-src/lib/paper.ts` 的 `EXCLUDED_DIRS` 常量；`src/*.py` 的 `try/except` 双 import 兜底清理（统一为 package-mode `from src.X import …`）；新增 [`scripts/run-pipeline.sh`](scripts/run-pipeline.sh)（自动激活 venv 的 Python 入口）、[`config.user.yaml.example`](config.user.yaml.example)（fork 用户覆写模板，gitignored）、[`docs/path-spec.md`](docs/path-spec.md)（三套日期目录命名权威规范）、[`tests/README.md`](tests/README.md)（pytest 文件名→`src/*.py` 模块映射）；`.gitignore` 去重 + `.scratch/` 目录级 ignore + `.DS_Store` 治理；`.gitattributes` 给 `docs/**/*.txt` 接 Git LFS；workflow owner allowlist 一致化到 `daily-paper-reader.yml` + `conference-paper-retrieval.yml`；`edge-functions/proxy.ts` + `others/structure.png` 删除。详细规划与每个 commit 的动机 / 风险 / 回滚见仓内 `.claude/plans/compressed-napping-hoare.md`。
- **2026-07-04** 🛠️ 全面改造 `paper-analyzer` 页面：配置项默认自动持久化（input + debounce），新增 **🔌 测试连接** 按钮调用 `GET {base}/v1/models` 验证当前模型与服务端一致，新增 **🔄 刷新模型列表** 从服务端拉取真实模型填入 `<select>` 下拉；切 provider / 模型变更均有提示。
- **2026-07-04** ☁️ 新增 Cloudflare Pages Function 反代：把 `functions/api/proxy.ts` 部署为 Pages Function，浏览器走 `daily-paper-reader.pages.dev/api/proxy?url=...` 拉 arXiv，无需依赖公共代理，0 配置即可用。EdgeOne Pages 用户请自行部署等价反代。
- **2026-07-04** 🔁 GitHub Actions 全面改造：6 个 workflow 改为从 **单一 secret Gist** 拉所有 key（LLM_API_KEY / SUPABASE_SERVICE_KEY / RERANK_* 等），仓库 Settings 只需 2 个 secret：`DPR_GIST_ID` + `DPR_GIST_TOKEN`；daily pipeline 不再因 `LLM_MODEL` secret 缺失直接红。
- **2026-07-04** 🔀 站点迁移 Astro 5：`docsify` → `astro` 静态站，paper-analyzer 客户端组件用 `pdf.js` 抽正文 + 调 LLM，配置 / Gist Token / CORS 代理全存浏览器 `localStorage`，换 token 同步零打扰。
- **2026-05-25** 🎛️ 重构后台管理体验：日常与会议面板统一词条卡片、批量选择、底部操作区与危险操作分区；新增仅会议临时词条，优化候选生成、关键词编辑、最近提问与模型选择弹窗样式。
- **2026-05-25** 🖼️ 优化论文阅读页媒体展示：为 Attention 示例补充图片轮播，并固定轮播展示高度，避免切图时按钮位置跳动。
- **2026-05-24** ⚡ 优化 GitHub Pages 首屏加载：本地化/延迟加载非首屏脚本，移除 Google Fonts 阻塞，并支持 CDN 静态资源加速与失败回退。
- **2026-05-23** 🧠 强化远端模型链路：默认使用 `zwwen` 远端 embedding 与 rerank，补齐 DeepSeek V4 长输出、JSON 截断恢复和前端探活兼容处理。

<details>
<summary>Earlier news</summary>

- **2026-05-22** 🌐 接入公益向量与重排服务：新增 `zwwen.online` embedding / rerank 链路，并让前端 reranker 测试在公益模式下免 API Key。
- **2026-05-21** 🧩 重整本地初始化与模型配置：支持本地 dotenv 调试配置，更新 DeepSeek 默认模型到 V4，并移除旧的柏拉图 / BLT 配置链路。
- **2026-04-08** 🏷️ 推荐状态改为按 tag 独立维护：`carryover` 时间与历史 `seen_ids` 不再跨词条互相污染。
- **2026-03-28** 🧬 补齐多源论文维护链路：新增并打通 `bioRxiv`、`medRxiv`、`ChemRxiv` 以及多类会议论文的抓取、向量编码、Supabase 同步与检索 SQL。
- **2026-03-11** 🛡️ 完善 Supabase 召回与推荐链路：BM25 / exact 增加时间分片与递归细分兜底，Supabase-only 召回改为动态 Top K。
- **2026-02-08** 🔗 支持 Supabase 向量同步，并优先复用用户侧预置 embedding，补齐公开数据同步链路。
- **2026-01-10** 🧱 推荐系统大改版，alias 统一为 tag，召回、排序与 LLM refine 链路拆分成独立步骤。
- **2025-12-31** 🧭 新增统一引导面板，把主要设置集中到同一个入口。
- **2025-12-29** 🌐 项目切换到纯前端架构，订阅、配置与 GitHub Token 管理前置到浏览器端。
- **2025-12-22** 🍴 调整为 Fork 即用版本，进一步降低自部署门槛。
- **2025-12-17** 🌱 最小可运行版本落地，并完成早期 Zotero Connector 集成。

</details>

## ✨ Why Daily Paper Reader?

- **🔎 Daily Paper Radar**：每日自动抓取 arXiv / OpenReview / bioRxiv / medRxiv / ChemRxiv 新论文，持续追踪研究前沿。
- **🎯 Personalized Feed**：基于关键词、研究方向与兴趣生成个性化推荐流。
- **📖 Read in Context**：支持摘要、原文、速览、长总结在同一页面串联阅读。`paper-analyzer` 还能直接上传 PDF 或传 arXiv ID，自动抽取正文并生成中文摘要 / TLDR / 动机 / 方法 / 结果 / 结论。
- **💬 Ask While Reading**：支持 AI 论文问答，边读边问，沉淀私人讨论记录。
- **🔁 LLM 配置 0 部署**：LLM Provider / API Key / Base URL / Model 全在浏览器 `localStorage`，Gist Token 一键同步到 secret Gist，GitHub Actions 自动拉取。
- **☁️ 0 服务器 + 0 公共代理**：站点可部署到 Cloudflare Pages / Vercel / GitHub Pages / EdgeOne Pages；arXiv CORS 反代直接走 Pages Function，浏览器不依赖任何第三方代理。
- **🛠️ Fork-and-Run**：Fork 后完成少量配置，即可上线自己的论文主页。

## 🧭 适用场景

- **🎓 个人论文雷达**：持续追踪自己研究方向的新论文。
- **🧪 实验室论文主页**：沉淀团队关注的论文脉络与阅读结果。
- **📚 日常阅读工作台**：把发现、阅读、问答、总结集中到一个入口。
- **🔬 单论文精读**：把 PDF / arXiv ID 丢进 paper-analyzer，得到中文摘要 + 动机 / 方法 / 结果 / 结论四段笔记 + TLDR，不用打开额外窗口。



## 🛠️ 开发约定

> 给 fork / 自部署用户的本地开发提示——这里集中说明仓库约定的"哪些目录不该 commit"、"如何运行 pipeline"。

- **临时调试目录** `.scratch/`：本地一次性脚本（`.py` / `.mjs` / `.sh` 都可），已被 `.gitignore` 整目录忽略——不入版本控制。
- **本地运行日志** `.local-runs/`：本地调试后端 [src/local_debug_server.py](src/local_debug_server.py) 写入的运行记录，已 gitignored。
- **锁文件** `bun.lock`（文本格式，bun 1.2+）：当前仓库唯一锁文件。`.lockb` 是早期二进制版本，未启用。
- **`docs/` 三种日期子目录命名**：见 [docs/path-spec.md](docs/path-spec.md)。任何新论文必须按那里的命名约定落盘，否则 Astro 路由会找不到。
- **私有配置覆写**：fork 用户可以把 `subscriptions.intent_profiles`、`github.owner/repo` 等放到 `config.user.yaml`（gitignored 已被 [.gitignore](.gitignore) 排除），与仓库内 [`config.yaml`](config.yaml) **自动 deep-merge**（fork 用户字段优先）。`src/source_config.py:load_config_with_source_migration()` 在迁移 source_backends 之前就 apply overlay。模板见 [`config.user.yaml.example`](config.user.yaml.example)；覆写语义见"🍴 fork 配置工作流"小节。
- **Python 双 import 兜底**：仓库内 `src/*.py` 早期使用 `try: from X ... except: from src.X ...` 双 import 来兼容 script-mode 与 package-mode 两种执行路径。该约定会被 PR #B 清理掉，届时 Python 入口请走 **`scripts/run-pipeline.sh src/main.py ...`**（它会自动激活 venv，并保留当前目录为仓库根），前提是先 `scripts/bootstrap_local.sh` 装好 venv。

> 想更系统地理解"仓库的目录该怎么整理"与"未来治理路线图"，看 [docs/path-spec.md](docs/path-spec.md) 与仓内治理方案 `.claude/plans/compressed-napping-hoare.md`。

---

## 🍴 fork 配置工作流

> 本节描述的工作机制已在代码层落地。`src/source_config.py:load_config_with_source_migration()` 在源迁移之前会自动 deep-merge `config.user.yaml`（如存在），fork 用户的私有字段会覆盖仓库内 `config.yaml` 同名字段。env override 用 `DPR_USER_CONFIG=/abs/path.yml`。`config.user.yaml.example` 仍提供模板。

### 为什么需要 `config.user.yaml`

fork 这个仓库后你大概率会想做这两件事：

1. 改 `subscriptions.intent_profiles`（追踪你感兴趣的研究方向），**每天**；
2. 改 `github.owner` 到你自己的 GitHub handle，让 [`save-paper.yml`](.github/workflows/save-paper.yml) 把论文笔记推到 fork 而不是 upstream。

但 [`config.yaml`](config.yaml) 是被 daily workflow **运行时改写**的（[src/main.py:99-138](src/main.py#L99-L138) 的 `apply_topics_from_gist_env()` 直接 `save_config(config.yaml)`）。这意味着你 fork 后提交的每天改动，**会和你的本地手动修改冲突**，`git pull` 时极容易 reject。

`config.user.yaml` 是解药：你把要覆写的字段写到它，daily workflow 优先读这份私有文件，**仓库内 `config.yaml` 在你 fork 后从头到尾都不需要改**。

### 用法（已生效）

```bash
# 1. 从模板复制
cp config.user.yaml.example config.user.yaml

# 2. 编辑你要覆写的字段
#    （默认所有字段都是注释；逐段取消注释 + 改值即可）

# 3. 确认 git status 干净
git status --short
# 应该看到 ? 表示未追踪（被 .gitignore 排除），不是 M / A
```

可覆写字段（详见 [`config.user.yaml.example`](config.user.yaml.example)）：

| 字段 | 典型用途 |
|---|---|
| `github.owner` / `repo` | fork 用户的 GitHub handle |
| `subscriptions.intent_profiles` | 你的研究方向 tag 列表 |
| `arxiv_paper_setting.days_window` | 9（默认）vs 10+（区间目录） |
| `supabase.url` / `anon_key` | 自部署 Supabase 实例 |

### 不要往里放的字段

- **密钥类**（LLM API key、Gist token、Supabase service_role key）→ 走浏览器 [`localStorage`](astro-src/scripts/settings.ts) 或本地 `.env`（已被 [.gitignore](.gitignore) 排除）。
- **`config.yaml` 已有但你没想覆写**的字段 → 留空，让它继承默认。

### 推荐的 commit 习惯

```bash
git pull --rebase upstream main
# 如果 daily workflow 把 config.yaml 改了（你 fork 早期会撞到），可放心丢弃：
git checkout -- config.yaml
# 你 fork 自己的私人改动（subscriptions.* 等）已落到 config.user.yaml，没丢
```

---

## ⚙️ 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│ 浏览器                                                        │
│   paper-analyzer (Astro static)                                │
│       ├── 用户填 LLM 配置 ─────► localStorage                  │
│       ├── 搜 arXiv ───► /api/proxy?url=... ─┐                │
│       └── 同步 Gist ─► api.github.com/gists ─┤                │
│                                                │                │
│ Cloudflare Pages Function (/api/proxy)         │                │
│   转发 arXiv 请求 + 加 CORS 头 ───────────────┘                │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ GitHub Actions (daily pipeline)                                │
│   "Load secrets from Gist" step                                │
│       读 ${{ secrets.DPR_GIST_ID }}                            │
│       curl api.github.com/gists/$ID                            │
│       写 LLM_API_KEY / SUPABASE_SERVICE_KEY / RERANK_API_KEY ...│
│         到 $GITHUB_ENV                                         │
│   src/4.llm_refine_papers.py 读 LLM_MODEL                      │
│   src/main.py 也读 $GITHUB_ENV 文件补全 env                     │
└─────────────────────────────────────────────────────────────────┘
```

完整工作流（每日 pipeline / 会议检索 / multi-source 维护）见上方 ASCII 架构图与 `.github/workflows/` 目录。每个 workflow 的具体步骤看对应的 `.yml` 文件。

---

## 🗄️ Supabase schema (`sql/`)

仓库 `sql/` 下的 23 个 `.sql` 是 Supabase 实例的 **DDL 源**——建表 (`create_*_papers_schema.sql`)、检索 RPC (`match_*_papers.sql`)、RLS 策略 (`enable_conference_anon_read_policies.sql`)。

- 这套 DDL **不是** `src/*.py` 自动跑的（pipeline 走 `supabase_source.py`/`sync.py`，假设表已存在）。
- 部署到新 Supabase 实例时需要**手工**在 SQL Editor 里跑一次。`create_papers_schema.sql` + 各自源 schema 是基础；RPC 文件定义 `match_*` 函数，被 `src/2.*.retrieval_papers_*.py` 通过 `SUPABASE_BM25_RPC` / `SUPABASE_VECTOR_RPC` 环境变量调用。
- schema 变更后请同步更新 `sql/`，保持仓库是 source of truth。

---

## 🚀 5 分钟快速启动

> [!TIP]
> 只需准备 **一个大模型 API Key**，配合 paper-analyzer 浏览器或 Gist 同步即可。GitHub PAT 仅当你想把浏览器配置传递到 Actions 时才需要。

### 方式 A：纯 Cloudflare Pages 部署（推荐）

适合个人使用，**全部走 Cloudflare**，无需 EdgeOne / Vercel 配置。

#### 1) 🍴 Fork 本仓库
- Fork 到自己的 GitHub 账号下，建议仓库名保持 `daily-paper-reader` 不变。

#### 2) ▶️ 在 Cloudflare 绑定仓库
- 进入 [Cloudflare Dashboard → Workers & Pages](https://dash.cloudflare.com) → **Create application** → **Pages** 标签 → **Connect to Git** → 选 fork 后的 `daily-paper-reader` 仓库。
- **Build settings**：
  - **Framework preset**：**Astro**
  - **Build command**：`bun run build`（或 `npm run build`）
  - **Build output directory**：`dist`
  - （可选）**Root directory**：留空
- 点 **Save and Deploy**，等待 2-3 分钟，部署成功后 Cloudflare 会分配 `https://<your-project>.pages.dev`。

#### 3) 🌐 访问站点 + arXiv 搜索
- 打开 `https://<your-project>.pages.dev/paper-analyzer/`。
- **arXiv CORS 默认已配置**：站点本身部署了 `functions/api/proxy.ts`（Cloudflare Pages Function），所以**不需要自己部署反代**，搜 arXiv 词即可。
- 如希望换自部署反代，在 LLM 设置最下方 **CORS 代理** 输入框填入 `<your-cors-proxy>/proxy`（留空走内置）。

#### 4) 🔑 在 paper-analyzer 填 LLM 配置
- 点页面顶部 "LLM 设置" 折叠面板。
- 选 Provider（如 DeepSeek / MiniMax / 硅基流动 / 自定义），填 API Key、Base URL、Model。
- 输入即时保存到 `localStorage`（绿色 ✓ "已自动保存到本地浏览器" 提示）。
- 可点 **🔌 测试连接** 验证 API key 是否有效、当前 model 是否存在；点 **🔄 刷新模型列表** 从服务端拉取真实模型填入下拉。

---

### 方式 B：把 LLM 配置传给 GitHub Actions（可选）

> 如果你只用浏览器直接用 paper-analyzer，**可以跳过整个方式 B**——浏览器使用 LLM API 时直接走前端 fetch，不需要 Actions 帮忙。

如果你希望 **GitHub Actions 跑每日 pipeline 时也用你浏览器里的 LLM 配置**（例如每日抓 arXiv + 自动 rerank + LLM refine），按下面 3 步走：

#### B1) 创建一个 Gist Token
- 打开 [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**。
- Note: 填 `dpr-gist`(任意名)。
- **Expiration**: 选 `No expiration` 或 90 天。
- **Scopes**:**只勾 `gist`**。
- 点 **Generate token** → 立刻复制。

> ⚠️ **请勿把 token 字符串贴到对话 / 截图 / 公开场合**。最多只贴前 6 位（`ghp_aBcD...`）作为识别码。

#### B2) 在 paper-analyzer 把配置同步到 Gist
- 仍在 `paper-analyzer` 页面。
- 展开 "**同步配置到 GitHub Gist**" 折叠面板。
- **Gist Token**：粘刚才复制的 token。
- **Gist ID**：**留空**（首次同步会自动创建一个 secret Gist）。
- （可选）展开 "**搜集主题配置**" 折叠面板,逐行编辑要追踪的主题（`tag: 中文说明`），留空则 fallback 到仓库内置 `config.yaml` 的 `intent_profiles`。
- 点 "**同步配置到 Gist**" 按钮。
- 同步成功后 Gist ID 自动写回输入框（形如 `5a8ff17d...32 位 hex`）；同步时当前主题列表会一并写入 Gist 文件的 `topics` 字段（JSON array，每项 `{tag, description, enabled}`）。

#### B3) 在 GitHub repo 加 2 个 secret
仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**：

| Name | Value |
|---|---|
| `DPR_GIST_ID` | 刚才同步时浏览器自动回填的 Gist ID |
| `DPR_GIST_TOKEN` | 同一个 Gist Token 字符串（粘贴完整值） |

加完后 `daily-paper-reader.yml` workflow 第一次跑，**Load secrets from Gist** step 会用 `DPR_GIST_TOKEN` 拉 Gist 文件，把里面的 `LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / SUPABASE_SERVICE_KEY / RERANK_*` 等注入到后续 step 的 `process env`，`src/4.llm_refine_papers.py` 就有正确的 `LLM_MODEL`，pipeline 跑通。

> 💡 如果你改了 LLM API key，只需在 paper-analyzer 里改完点"同步配置到 Gist"即可，GitHub Actions 下一次跑就用新值。**Token 本身要更新时，只需要在 Settings 里改一次 `DPR_GIST_TOKEN`**。

---

### 方式 C：经典三件套（Vercel + EdgeOne + GitHub Pages）

如果你的部署仍然走 Vercel / EdgeOne Pages / GitHub Pages 三套老路径，参考以下新增：

#### 1) 🍴 Fork 本仓库
#### 2) ▶️ 开启 GitHub Actions
进入你 Fork 的仓库 → [`Actions`](../../actions) → 启用 `daily-paper-reader` workflow。
#### 3) 🌍 开启 GitHub Pages
`Settings → Pages` → Source 选 `Deploy from a branch` → Branch 选 `main` → Folder 选 `/(root)`。等约 1 分钟，站点显示在 `https://<你的用户名>.github.io/daily-paper-reader`。
#### 4) 🔑 准备 PAT + 走方式 B 的 B1-B3
准备 DeepSeek API Key + GitHub PAT（classic，勾 `repo / workflow / gist`）。

> ⚠️ EdgeOne Pages / Cloudflare Pages / Vercel 部署后，**arXiv 反代请用 `functions/api/proxy.ts`**（Cloudflare Pages Function），不要走公共代理（多数已限流）。EdgeOne Pages 用户请自行实现等价反代（仓库内 `edge-functions/proxy.ts` 已在 2026-07-06 删除）。

---

## 🧪 paper-analyzer（论文精读工具）

打开部署后的 `/paper-analyzer/` 即可使用。

### 功能
- **📄 上传 PDF**：拖入本地 PDF，自动抽取正文并生成中文摘要 + TLDR + 动机 / 方法 / 结果 / 结论四段笔记。
- **🔍 arXiv 搜索**：支持按标题 / 作者 / arXiv ID 搜索。
- **🔌 测试连接**：调 `GET {base}/v1/models` 验证 API key 是否能访问当前 model。
- **🔄 刷新模型列表**：从服务端拉真实模型填到下拉，无需手抄。
- **☁️ 同步配置到 Gist**：一键把当前 LLM 配置写入私有 secret Gist，GitHub Actions 自动读取（见方式 B）。

### 配置项（全部自动持久化到 localStorage）
| 字段 | 说明 |
|---|---|
| Provider | DeepSeek / 硅基流动 / Kimi / 智谱 / MiniMax / OpenAI / 自定义 |
| API Key | OpenAI 兼容 secret |
| Base URL | OpenAI 兼容 endpoint，如 `https://api.deepseek.com/v1` |
| Model | 兼容 OpenAI Chat Completions 的模型名 |
| CORS 代理 | 自部署 arXiv 反代；留空走内置链 + 项目自带的 `/api/proxy` |

### 自部署反代（推荐 5 行 Cloudflare Worker）

如果站点部署在 Vercel / GitHub Pages 这种无法部署 Pages Function 的环境，arXiv 搜索需要自己的反代。**Cloudflare Worker 5 行代码永久稳定**：

```js
// Cloudflare Worker: arxiv cors proxy
export default {
  async fetch(req) {
    const u = new URL(req.url);
    let target = u.pathname.replace(/^\/proxy\/?/, '');
    if (!target) target = u.searchParams.get('url');
    if (!/^https?:\/\//i.test(target))
      return new Response('missing url', { status: 400 });
    const r = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (cf-worker-proxy/1.0)' },
      redirect: 'follow',
    });
    const h = new Headers(r.headers);
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    h.set('Access-Control-Allow-Headers', '*');
    return new Response(r.body, { status: r.status, headers: h });
  },
};
```

部署完把 `<your-worker>.workers.dev/proxy` 填到 paper-analyzer 的 **CORS 代理** 输入框即可。

---

## 📦 Git LFS（大论文文本缓存）

PR #E 已经把 `docs/**/*.txt`（daily pipeline 写的 PDF 文本缓存）走 Git LFS：仓库里加了一条 `.gitattributes` 规则，从 PR #E 落地之后**新提交**的 `.txt` 自动是 LFS pointer。clone 时 `git lfs pull` 才会拉真实文本。

### 维护者：历史 .txt 文件的回填

`docs/**/*.txt` 现存 ~80 个文件是 PR #E 之前的**普通 git blob**，clone 时仍然按全量大小下载。回填到 LFS 是个**改写 git history**的动作（每个 commit 的 oid 都变）：

```bash
# 在干净的工作区上：
git checkout main
git pull --rebase
git checkout -b lfs-migrate-docs-txt
scripts/migrate-lfs.sh      # 仅迁移 + 写一段安全提示
git push --force-with-lease=refs/heads/lfs-migrate-docs-txt:main
# 然后在 PR 描述里链接到 Discussions 上的 heads-up 帖
```

完整的安全流程在 `scripts/migrate-lfs.sh` 的文件头注释里。

### Fork 用户：clone 后拉 LFS

```bash
git clone <fork-url>
cd daily-paper-reader
git lfs install            # 一次性；之后所有 clone 都自动
git lfs pull               # 把 .txt 的真实文本拉下来
```

如果忘了 `git lfs install`，`.txt` 路径会显示为 LFS 指针文本（"oid: sha256:..."）——它们仍能被 `cat` 读，但 paper-analyzer 抽取正文时会读不到。

### 历史回填完成度自检

```bash
# 已转 LFS 的 .txt 数
git lfs ls-files 'docs/**/*.txt' | wc -l
# 总 tracked .txt 数
git ls-files 'docs/**/*.txt' | wc -l
# 两者相等时表示完成
```

---

## 🧪 本地调试模式

如果你在本机开发，不想点击按钮后触发 GitHub Actions，可以启动本地调试后端：

```bash
scripts/bootstrap_local.sh
```

这个脚本会自动创建 `.venv`、安装远程服务模式依赖、按需从 `.env.example` 生成 `.env`，然后启动本地后端。默认不会下载 `torch` 等重依赖。启动完成后访问：

```text
http://127.0.0.1:8567
```

如果你已经准备好了 Python 环境，也可以只启动后端：

```bash
scripts/local_debug.sh
```

也可以手动指定监听地址和端口：

```bash
python src/local_debug_server.py --host 127.0.0.1 --port 8567
```

> **Tip**：跑 pipeline 入口（`src/main.py` / `src/conference_pipeline.py` 等）走 **`scripts/run-pipeline.sh`** 而不是裸 `python`——它会自动激活 venv，省去手动 `source .venv/bin/activate`。
>
> ```bash
> scripts/run-pipeline.sh src/main.py --fetch-days 9
> ```
>
> 这是 [PR #B](../plans/compressed-napping-hoare.md) 落地前的过渡写法；等 `try/except` 双 import 兜底被清理掉后，裸 `python src/main.py` 会因为找不到 `from src.source_config import ...` 而失败——**`scripts/run-pipeline.sh` 是唯一安全入口**。

如果需要跳过依赖安装，可以使用：

```bash
DPR_SKIP_INSTALL=1 scripts/bootstrap_local.sh
```

如果只想启动并明确跳过依赖安装，也可以使用旧的快速部署模式：

```bash
DPR_INSTALL_MODE=minimal scripts/bootstrap_local.sh
```

如果要一次性安装完整运行依赖，可以使用：

```bash
DPR_INSTALL_MODE=full scripts/bootstrap_local.sh
```

完整依赖模式默认先安装 **CPU 版 PyTorch**，避免普通本机部署时误下载 CUDA 大包。如果你确实需要自定义 PyTorch 源，可以设置：

```bash
DPR_INSTALL_MODE=full DPR_TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu scripts/bootstrap_local.sh
```

在 `localhost / 127.0.0.1` 页面里点击"触发工作流"时，前端会自动调用本地后端 `/api/local/workflows/dispatch`，把 `daily-paper-reader.yml`、`conference-paper-retrieval.yml` 等映射为本地 Python 子进程执行，不会上 GitHub，也不会要求启用 Actions。运行日志会显示在工作流面板里，并保存在 `.local-runs/`。

如果前端和本地后端不是同一个地址，可以在页面加载前设置：

```html
<script>
  window.DPR_LOCAL_API_BASE = 'http://127.0.0.1:8567';
</script>
```

如果要部署到自己的服务器上调试，请同时启动这个后端，并对内网或受信任网络开放端口：

```bash
DPR_LOCAL_HOST=0.0.0.0 DPR_LOCAL_PORT=8567 scripts/local_debug.sh
```

然后访问 `http://<服务器地址>:8567`。这样页面和后端同源，点击触发按钮会在服务器本机执行工作流命令，而不是调用 GitHub Actions。

---

## 🙏 致谢

Daily Paper Reader 的论文发现、重排与阅读增强链路受益于以下开源项目、模型与服务：

- **[PaperCropper](https://github.com/fake-learn/PaperCropper)**：为论文 PDF 中的图表检测与裁剪提供了重要参考和能力基础，让论文详情页可以更自然地展示图表内容。
- **[BAAI/bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5)**：作为默认 embedding 模型之一，支撑语义召回、会议论文检索与查询向量复用。
- **[Qwen/Qwen3-Reranker](https://huggingface.co/Qwen)**：作为重排链路的重要开源模型基础，用于提升候选论文排序质量。
- **zwwen.online 公益服务**：提供默认远端 embedding / rerank 接入，降低普通用户本地部署时的模型下载、显存和算力门槛。
- **硅基流动（SiliconFlow）**：提供可选的 rerank API 接入方式，便于在不同模型尺寸和调用预算之间做实验与切换。
- **DeepSeek / OpenAI 兼容 API**：为候选过滤、论文精读摘要与问答等 LLM 环节提供模型能力支持。

## ❓ FAQ

### 💻 需要服务器吗？

不需要。Site 可部署到 Cloudflare Pages / Vercel / GitHub Pages / EdgeOne Pages。

### 🔑 GitHub Token 必须吗？

不必须。**只有当你想让 GitHub Actions 用你浏览器里的 LLM 配置时**，才需要 Gist Token + repo 2 个 secret。纯前端用 paper-analyzer 完全不需要 token。

### ⚙️ 我换了 LLM API key，要怎么同步给 GitHub Actions？

打开 paper-analyzer → 改 API key → 自动保存 → 展开"同步配置到 Gist" → 点同步。GitHub Actions 下次跑就用新值。

### 🤖 为什么我的 Gist Token 在 GitHub settings/tokens 看不到？

GitHub 的 classic token 列表页有 UI 缓存问题。**用 API 列出来最准**：

```bash
curl -H "Authorization: Bearer ghp_your_token" https://api.github.com/user/token
```

只要 API 200 OK，token 就有效。GitHub Actions 报 401 多半是 token 没粘到 repo Secrets。

### 🚀 arXiv 搜索总是失败，怎么办？

你需要在站点配 CORS 反代：
- 如果站点部署在 Cloudflare Pages：项目自带 `functions/api/proxy.ts`，**0 配置**。
- 否则：用上方给的 Cloudflare Worker 5 行代码部署，把 `*.workers.dev/proxy` 填到 paper-analyzer 的 CORS 代理输入框。

### 👨‍🔬 适合实验室或团队一起用吗？

可以。它很适合做实验室公共论文面板，或者作为团队内部的论文发现与阅读入口。

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Canyon-netizen/daily-paper-reader&type=Date)](https://star-history.com/#Canyon-netizen/daily-paper-reader&Date)
