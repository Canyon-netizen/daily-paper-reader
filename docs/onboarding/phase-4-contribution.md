# Phase 4 — Contribution（3+ 年）

> **你现在的画像:** 审稿人 + 主导者
> **本阶段目标:** 反哺社区、带人、把方向传承下去。

---

## 1. 你的角色变了

到 Phase 4,你不只是"读 paper 的人"——你是**社区的一员**：
- 审稿(给 top venue 写 review)
- 主导方向(自己有 1 个 sustained program)
- 带人(实习生 / 学弟妹 / 合作者)

DPR 在这个阶段变成**你和你的合作者的共享工作空间**——不只是个人工具。

---

## 2. 你的画像库怎么配置

到 Phase 4,你会有多个库,每个绑定不同画像：

| 库 | 画像 | 阈值 | 给谁用 |
|----|------|------|-------|
| `My program: <方向名>` | `expert` | 0.75 | 你自己 + 合作者 |
| `Reading group: <topic>` | `reviewer` | 0.65 | reading group 共享 |
| `Onboarding for new students` | `novice` | 0.55 | 你带的新生 |
| `Production RAG` | `practitioner` | 0.60 | 工业合作 |

`audienceProfile` 的妙处就在这里:**同一篇论文,在 4 个库里打 4 个不同的分**。

示例:同一篇 RLHF paper
- `expert` 库里 0.85(新颖度满分)
- `reviewer` 库里 0.72(审稿视角:缺 ablation)
- `novice` 库里 0.45(术语密度高,不适合入门)
- `practitioner` 库里 0.30(没报告算力,工业用不上)

---

## 3. 给社区贡献公共库

进 [`astro-src/lib/libraries.ts`](../../astro-src/lib/libraries.ts) 提 PR：

新增 1 个 `Library` 条目。规则(摘自主文件):
1. 论文数量 ≥ 6(让卡片有内容)
2. task / method 维度有具体方向,不和别的库重叠
3. 覆盖核心 AI / ML 方向

```ts
{
  id: 'your-topic',
  title: 'Your Topic',
  titleZh: '你的方向',
  description: '...',
  descriptionZh: '...',
  tags: ['task:your-topic'],
  dimension: 'task',
  curator: 'Your Name',
  hue: 'orange',
},
```

提 PR 前先在 Discord / GitHub issue 聊聊,确认方向不重复。

---

## 4. 用 `reviewer` 画像做"假审稿"练习

进 `/agents/new-session/`,选模板 `free_form`,goal:
```
对 archive/<sid>/ 里的 synthesis 做 simulated peer review,
按 reviewer 画像打分(5 维:methodological_soundness / novelty_vs_prior_art / ...
),对每个 claim 指出"证据不足"或"baseline 缺失"
```

这会训练你的审稿能力——下次真的收到 review invitation 时,你能 1 天写完 review。

---

## 5. 主笔 1 个核心概念页

到 Phase 4,你应该为方向里**最核心的概念**写 wiki：
- 这概念页 1 年内被访问次数 = 你对方向的贡献度代理
- 写法:`/wiki/concepts/<slug>/` 直接 commit markdown,带反向链接

详细规范: [`docs/concepts-system.md` §7](../concepts-system.md)。

---

## 6. 带新人:用 onboarding 文档

你带 1 年级 PhD 时,直接 fork [`docs/onboarding/phd-journey.md`](../onboarding/phd-journey.md)：
- 改"我推荐的方向"部分
- 在每个 phase 加 1-2 个你方向的 anchor paper
- commit 到 `docs/onboarding/<advisor>-phd-journey.md`

这是**传递 implicit knowledge 的最便宜方式**——比写 10 页"怎么读 paper"效率高。

---

## 7. 不要做的事

- ❌ **不要停止自己读 paper** — 审稿人最容易犯的错是"用 5 年前的视角审现在的 paper"
- ❌ **不要把 LLM 当审稿人** — 假审稿是练手,真审稿必须自己读
- ❌ **不要假设新人"自己会学会"** — onboarding 文档是你的责任
- ❌ **不要把所有时间给合作者** — 你自己的 program 优先级最高
- ❌ **不要忽略反向链接** — wiki 概念页之间互链 = 给后人铺路

---

## 8. 长期该有的产出(5 年视角)

- [ ] 1 个 sustained research program(你主导 ≥3 年的方向)
- [ ] ≥2 篇 top venue accepted / ≥1 篇 oral / spotlight
- [ ] ≥1 个 PhD / 多个实习生被你带出来
- [ ] ≥3 个贡献到公共库的 `Library`
- [ ] ≥5 个主笔的 `/wiki/concepts/<slug>/`
- [ ] ≥1 个 open-source release(代码 + 数据 + 文档)
- [ ] ≥3 次 workshop / 暑校 talk

---

## 9. 给下一代 PhD 的最后一句

**PhD 不只是 paper——是建立你思考的方式。**

DPR 这种工具的目的不是让你读更多 paper,而是让你**对方向的 map 更清晰**。当你的 map 清晰到能用 1 张图给 1 年级 PhD 讲明白,这就算成了。

---

## 10. 资料推荐

- Concept 系统: [`docs/concepts-system.md`](../concepts-system.md)
- Agents 全流程: [`docs/agents-workflow.md`](../agents-workflow.md)
- 怎么写 review: [`docs/research-skills/writing-review.md`](../research-skills/writing-review.md)
- 怎么审稿: [`docs/research-skills/reviewer-mindset.md`](../research-skills/reviewer-mindset.md)
