# docs/ 文件夹导航

> **面向:** 任何打开这个文件夹的人
> **目标:** 30 秒内找到你想要的文档
>
> **2026-09-14 重组说明:** 在原有架构文档旁边,新增 `onboarding/`(PhD 成长地图)+ `research-skills/`(技能 primer)+ `library/`(多维入库标准)+ `feedback/`(用户反馈日志)。**没动**原有结构,所有现有链接仍然有效。

---

## 1. 按"你是谁"找文档

### 🆕 我是入门博士生

→ [`onboarding/jump-in.md`](onboarding/jump-in.md) — 10 分钟跳进
→ [`onboarding/phd-journey.md`](onboarding/phd-journey.md) — 4 阶段成长地图
→ `onboarding/phase-{1,2,3,4}-*.md` — 各阶段详细指南

### 🛠 我要修代码

→ [`library-architecture.md`](library-architecture.md) — 文献库架构权威
→ [`concepts-system.md`](concepts-system.md) — 概念子系统
→ [`path-spec.md`](path-spec.md) — `docs/` 路径规范
→ [`agents-workflow.md`](agents-workflow.md) — Agents 工作流
→ [`research-workflow.md`](research-workflow.md) — 研究流程模块

### 📚 我在设计 / 跑一个文献库

→ [`library/inclusion-standard.md`](library/inclusion-standard.md) — 多维入库标准(4 画像)
→ [`library-architecture.md`](library-architecture.md) — 存储 + 生命周期
→ [`../astro-src/lib/library/audience-profiles.ts`](../astro-src/lib/library/audience-profiles.ts) — 代码镜像

### 📝 我想学怎么写 paper / 做实验

→ [`research-skills/how-to-read-paper.md`](research-skills/how-to-read-paper.md)
→ [`research-skills/how-to-lit-review.md`](research-skills/how-to-lit-review.md)
→ [`research-skills/experiment-design.md`](research-skills/experiment-design.md)
→ [`research-skills/writing-paper.md`](research-skills/writing-paper.md)
→ [`research-skills/writing-review.md`](research-skills/writing-review.md)

### 👀 我想审稿 / 找评审模板

→ [`research-skills/writing-review.md`](research-skills/writing-review.md)
→ [`research-skills/reviewer-mindset.md`](research-skills/reviewer-mindset.md)

### 📣 我要给站点提反馈 / 想知道怎么收集反馈

→ [`feedback/README.md`](feedback/README.md) — 用户反馈系统说明

---

## 2. 按"主题"找文档

### 文献库 / Library 系统
- 权威架构:[`library-architecture.md`](library-architecture.md)
- 多维入库标准:[`library/inclusion-standard.md`](library/inclusion-standard.md)
- 路径规范:[`path-spec.md`](path-spec.md)
- Polaris 吸收史:[`migration-polaris-absorption.md`](migration-polaris-absorption.md)

### 概念 / Concepts
- 概念系统:[`concepts-system.md`](concepts-system.md)

### 研究流程 / Ideas / Experiments / Writing / Roadmap
- 流程总览:[`research-workflow.md`](research-workflow.md)
- 报告质量 rubric:[`report-quality-rubric.md`](report-quality-rubric.md)
- 示例输出:[`sample-output-deep-extract.md`](sample-output-deep-extract.md)

### Agents / 多智能体
- 工作流:[`agents-workflow.md`](agents-workflow.md)

### 入门 / Onboarding (新)
- 10 分钟上手:[`onboarding/jump-in.md`](onboarding/jump-in.md)
- PhD 旅程地图:[`onboarding/phd-journey.md`](onboarding/phd-journey.md)
- Phase 1 — 入门:[`onboarding/phase-1-orientation.md`](onboarding/phase-1-orientation.md)
- Phase 2 — 打基础:[`onboarding/phase-2-foundation.md`](onboarding/phase-2-foundation.md)
- Phase 3 — 深入:[`onboarding/phase-3-depth.md`](onboarding/phase-3-depth.md)
- Phase 4 — 贡献:[`onboarding/phase-4-contribution.md`](onboarding/phase-4-contribution.md)

### 研究技能 / Research Skills (新)
- 读 paper:[`research-skills/how-to-read-paper.md`](research-skills/how-to-read-paper.md)
- 做综述:[`research-skills/how-to-lit-review.md`](research-skills/how-to-lit-review.md)
- 设计实验:[`research-skills/experiment-design.md`](research-skills/experiment-design.md)
- 写 paper:[`research-skills/writing-paper.md`](research-skills/writing-paper.md)
- 写 review:[`research-skills/writing-review.md`](research-skills/writing-review.md)
- 写 rebuttal: [`research-skills/writing-rebuttal.md`](research-skills/writing-rebuttal.md)
- 审稿心态:[`research-skills/reviewer-mindset.md`](research-skills/reviewer-mindset.md)

### 用户反馈 / Feedback (新)
- 系统说明:[`feedback/README.md`](feedback/README.md)
- 入库标准日志:[`feedback/library-inclusion-log.md`](feedback/library-inclusion-log.md)

### 待办 / 历史
- 未来工作:[`TODO-future-work.md`](TODO-future-work.md)
- 设计审计:[`audit/`](audit/)

---

## 3. 文档权威性排序

碰到冲突时,按这个优先级判断:

1. **代码事实**(`astro-src/`) > 所有文档
2. `library-architecture.md` > `concepts-system.md` > `path-spec.md` > `research-workflow.md` > 其它
3. 新增文档(`onboarding/` `research-skills/` `library/` `feedback/`) 是**指南**,**不是规范**——它指向规范文档
4. `.workflow/` 是开发日志,**不是规范**

如果你看到文档和代码不一致:
1. 改代码 → 文档跟着改
2. 改文档 → 注明"⚠️ 与代码冲突,代码侧 bug"

---

## 4. 未来重构候选

- 把 `onboarding/` 拆成 `<advisor>-phd-journey.md`(per advisor fork)— Phase 4 才做
- 把 `research-skills/` 链接进站内 `/help/` 页面,作为 in-app 教程
- 把 `feedback/library-inclusion-log.md` 自动从 localStorage 导出 + 在 GitHub issue 模板里 prefill
