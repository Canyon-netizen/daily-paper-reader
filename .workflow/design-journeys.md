# User Journeys Design

> 本文档描述 DPR 用户的典型操作路径，映射到具体页面、状态转换和系统行为。
> 面向三类 persona：PhD student、Industry researcher、New user。

---

## 1. Idea Pipeline

**目标**：论文 → 高亮 → 想法 → 链接论文 → 成熟 → 实验

### 1.1 路径

1. **发现论文** → `/` 首页 → DailyCalendar 浏览今日新增
2. **阅读论文** → `/papers/[arxiv]` → 全文阅读
3. **添加高亮** → `/papers/[arxiv]` 页面内选中文本 → 点击「🖍 添加高亮」
4. **生成想法** → `/projects/` → 进入项目 → 「💡 Ideas」tab → 点击「🚀 生成思路」
5. **链接论文** → idea 详情页 → 手动添加或 LLM 自动关联项目内论文
6. **成熟想法** → idea 状态从 `draft` → `mature`（手动标记）
7. **创建实验** → mature idea → 进入实验阶段（见 §2）

### 1.2 状态转换

```
paper (docs/papers/)
  → UserPaperState.note (user-library)
    → ProjectIdea (projects)
      → ProjectStage paperIds (experiment)
```

### 1.3 系统自动链接

- `/projects-idea-bank.ts` 的 `generateIdeas` 基于项目内论文 + method_pros_cons 自动产出 idea
- idea 的 `citedArxivIds` 关联论文，LLM 自动抽取

### 1.4 空状态

- 无 idea：显示「还没有 idea — 点上方按钮生成」
- 无高亮：论文页无「🖍 添加高亮」入口

### 1.5 帮助文档

- `/projects/` 页面内嵌提示：「从项目下的论文 + method_debate + (可选) 标定 paper 派生可执行 idea」

---

## 2. Experiment Track

**目标**：想法 → 假设 → 变量 → 运行 → 结果 → 写作

### 2.1 路径

1. **从成熟 idea 启动** → `/projects/[id]` → Papers tab → 创建阶段（如「实验设计」「数据收集」「模型训练」「结果分析」）
2. **添加论文到阶段** → stage 内点击「+ 论文」→ 输入 arXiv ID
3. **记录实验变量** → idea detail 内填写 hypothesis / variables（前端表单，存 IDB）
4. **运行实验** → 外部工具（不在 DPR 内）
5. **记录结果** → idea detail 内填写 expected_outcome / eval_design
6. **关联写作** → 结果产出后进入 Writing tab → 新建草稿

### 2.2 状态转换

```
ProjectStage (papers)
  → paperIds: string[]  # 每个阶段内的论文引用
  → Draft (draft-store IDB)  # 草稿独立存储
```

### 2.3 系统自动链接

- ProjectStage 支持拖拽排序（future work）
- 草稿编辑器自动加载项目内论文元数据作为引用库

### 2.4 空状态

- 无阶段：显示「暂无阶段」，可点击「+ 新建阶段」
- 无论文：阶段内显示「无」，可添加

### 2.5 帮助文档

- Projects 页面 header 说明：「分组管理 + 阶段推进 + 写作草稿 — 三件套」

---

## 3. Paper Writing

**目标**：大纲 → 引用论文 → 起草章节 → 引用实验 → 审查

### 3.1 路径

1. **创建草稿** → `/projects/[id]` → Writing tab → 点击「+ 新建草稿」
2. **填写标题** → 草稿编辑器 title input
3. **引用论文** → 草稿编辑器内输入 `[@arxiv-id]` 自动完成项目内论文
4. **起草章节** → markdown 正文，支持 headings / lists / tables
5. **引用实验结果** → 直接写入 markdown 或引用 idea 输出
6. **导出审查** → 点击「导出 .md + .bib」→ 生成文献综述格式

### 3.2 页面触摸

- `/projects/index.astro` → detail panel → writing tab
- `/projects-draft-editor.ts` → 草稿编辑器（ProseMirror 或 textarea）

### 3.3 状态转换

```
Draft (draft-store IDB)
  → title: string
  → markdown: string
  → wordCount: number  # 自动计算
  → savedAt: number
```

### 3.4 系统自动链接

- `projects-draft-editor.ts` 的 `loadPaperCorpus()` 预加载项目论文元数据
- `downloadLiteratureReview()` 导出时自动生成 .bib 引用

### 3.5 空状态

- 无草稿：显示「暂无草稿。点击上方按钮创建新草稿。」

### 3.6 帮助文档

- 草稿编辑器内嵌提示：输入 `[@arxiv-id]` 引用论文

---

## 4. Roadmap Planning

**目标**：设定季度目标 → 规划想法 → 分配实验 → 跟踪进度

### 4.1 路径

1. **创建项目** → `/projects/` → 点击「+ 新建项目」→ 填写 name / statement / hue
2. **设定阶段** → 项目 detail → Papers tab → 点击「+ 新建阶段」→ 输入阶段名（如「Q4 目标」）
3. **添加论文到阶段** → 阶段内点击「+ 论文」→ 输入 arXiv ID
4. **查看进度** → 项目卡片显示「活跃 / 完成」计数

### 4.2 页面触摸

- `/projects/index.astro` → list panel → new form → detail panel
- 进度计算：`projects.ts:getStageProgress()`

### 4.3 状态转换

```
UserLibrary (user-libraries)
  → stages: ProjectStage[]
    → status: 'active' | 'done'
```

### 4.4 系统自动链接

- 项目卡片实时显示阶段进度：「X 篇论文 / Y 个阶段」
- 完成阶段点击「完成」切换状态

### 4.5 空状态

- 无项目：显示「暂无项目」，点击「+ 新建项目」

### 4.6 帮助文档

- 项目列表页面 header：「分组管理 + 阶段推进 + 写作草稿 — 三件套」

---

## 5. New User Onboarding

**目标**：发现模块 → 创建第一个想法 → 理解数据模型

### 5.1 路径

1. **访问首页** → `/` → 看到「文献库」「主题探索」「项目工作区」「阅读仪表板」快捷入口
2. **浏览公共库** → 点击公共主题库卡片（如「RL」「LLM Agent」）→ 查看论文列表
3. **阅读论文** → 点击任意论文 → 进入 `/papers/[arxiv]`
4. **添加收藏** → 论文页点击「⭐ 收藏」→ 写入 `user-library`
5. **创建个人库** → 首页点击「➕ 新建文献库」→ 填写 name / statement → 将论文加入库
6. **创建项目** → 首页快捷入口或直接访问 `/projects/` → 点击「+ 新建项目」

### 5.2 页面触摸

- `/` 首页（SSR + 客户端水合）
- `/libraries/` 公共库列表
- `/libraries/[id]` 公共库详情
- `/papers/[arxiv]` 论文详情
- `/projects/` 项目工作区

### 5.3 状态转换

```
(无状态)
  → UserLibrary (personal)
    → UserPaperState (starred: true)
```

### 5.4 系统自动链接

- 首页快捷入口一行：今日新增 / 最近更新 / 全部论文 / 主题探索 / 项目工作区 / 阅读仪表板
- 新建库后自动同步到 Gist（如果已配置）

### 5.5 空状态

- 无个人库：首页「⭐ 我的」section 显示为空，提示创建
- 无项目：projects 页面显示「暂无项目」

### 5.6 帮助文档

- 首页 hero 说明：「按领域 / 主题 / 任务组织的论文集合... 在下面可以新建自己的个人文献库」
- 新建项目表单：placeholder 提示「项目名 (1-32 字)」「一句话声明 (1-200 字)」

---

## 6. 跨流程数据模型映射

| 工作流 | 核心实体 | 存储位置 | 状态字段 |
|--------|----------|----------|----------|
| Idea Pipeline | ProjectIdea | IDB (`lib/projects/ideas.ts`) | status: `draft` \| `mature` |
| Idea Pipeline | UserPaperState.note | localStorage (`dpr_user_library_v1`) | highlighted text |
| Experiment Track | ProjectStage | localStorage (`dpr_user_libraries_v1`) | `status: 'active' \| 'done'` |
| Experiment Track | Draft | IDB (`lib/projects/draft-store.ts`) | `wordCount`, `savedAt` |
| Paper Writing | Draft | IDB | markdown content |
| Roadmap Planning | UserLibrary | localStorage | `stages: ProjectStage[]` |
| Onboarding | UserLibrary | localStorage | newly created |
| Onboarding | UserPaperState | localStorage | newly starred |

---

## 7. 页面导航矩阵

| 页面 | 功能 | 入口来源 | 导出目标 |
|------|------|----------|----------|
| `/` | 首页 + 文献库入口 + 今日新增 | — | `/libraries/`, `/projects/`, `/topic/`, `/dashboard/` |
| `/libraries/` | 公共主题库卡片流 | 首页快捷入口 | `/libraries/[id]/` |
| `/libraries/[id]` | 单库详情：论文 + 概念 + Chat | 库卡片 | `/papers/[arxiv]` |
| `/papers/[arxiv]` | 论文详情 + 高亮 + 笔记 | 库详情 / 搜索 | `/projects/` (加入项目) |
| `/projects/` | 项目列表 + 详情 + 阶段 + 草稿 | 首页快捷入口 | Writing tab → 导出 .md |
| `/topic/` | 主题探索 + 报告生成 | 首页快捷入口 | — |
| `/dashboard/` | 阅读仪表板 KPI | 首页快捷入口 | — |
| `/settings` | LLM 配置 + Gist 同步 | 导航栏 | — |

---

## 8. 事件总线（自动链接）

| 事件名 | 触发者 | 订阅者 | 行为 |
|--------|--------|--------|------|
| `dpr:user-library-change` | `user-library/store.ts:commit()` | `/papers/[arxiv]`, `/dashboard/` | 刷新收藏/阅读状态计数 |
| `dpr:user-libraries-change` | `user-libraries/store.ts:commit()` | `/projects/`, `/libraries/` | 刷新项目/库列表 |
| `dpr:idea-bank-change` | `projects-idea-bank.ts` | Projects ideas tab | 刷新 idea 列表 |
| `dpr:project-change` | `projects.ts` | Projects list panel | 刷新项目卡片 |

---

## 9. 未来工作（未实现）

- [ ] ProjectStage 拖拽排序
- [ ] 实验变量结构化存储（当前存在 idea detail 的 free-form 文本）
- [ ] 实验结果模板（当前只有 free-form markdown）
- [ ] 跨项目 idea 迁移
- [ ] 实验时间线可视化
