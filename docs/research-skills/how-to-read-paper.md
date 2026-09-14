# Research Skills Primer — 怎么读一篇论文

> **面向:** 入门博士生(Phase 1)
> **目标:** 1 小时内从一篇 paper 拿到 80% 的 value,而不是从头到尾读 1 周

---

## 1. 三遍阅读法（KR style）

### 第一遍（5 分钟）：鸟瞰

按顺序读：
1. **Title + Abstract** — 这篇 paper 要解决什么问题
2. **Introduction 末段 / Contributions 列表** — 作者自己说"贡献 3 条"是什么
3. **Section 标题** — 全文 5-7 个 section,扫一眼结构
4. **Conclusion** — 1 段,作者怎么总结

**目标:** 看完能向别人用 1 句话讲清楚"这篇 paper 是干嘛的"。

读不懂就停。**不要往下读**。

---

### 第二遍（30 分钟）：理解

按顺序读：
1. **Introduction 全文** — 现在可以看作者怎么 hook 你
2. **Figures + Tables** — 不读 caption,只看图和表,试着自己想"它在说什么"
3. **Related Work** — 这是综述章节,看作者怎么定位自己 vs 前人
4. **Methods 的关键算法/公式** — 只读"最核心"的 1-2 个,**跳过**附录

**目标:** 看完能向别人讲清楚"它怎么做的、为什么这么做、和前人比新在哪"。

读 Methods 时:**用笔在 paper 上画箭头**,标"这里是因为 X"。不要 rephrase 给你自己——rephrase 是 Phase 2 才做的事。

---

### 第三遍（1+ 小时）：复现者视角

按顺序读：
1. **Experiments 的 setup** — 数据集、baseline、metric、算力
2. **每个表格的 footnote** — 看作者怎么"打补丁"解释数字
3. **Ablation study** — 哪些组件重要、哪些 redundant
4. **Limitations / Future work** — 作者自己承认什么、藏什么

**目标:** 看完能向别人讲清楚"它的 limitation 在哪、什么场景会失败"。

---

## 2. 常见陷阱

- ❌ **逐字逐句读 Methods** — 你记不住,白费时间
- ❌ **跳过 Related Work** — 这是综述章节,价值最高
- ❌ **不读 Limitations** — 审稿人必看,你 Phase 2 后也要写
- ❌ **相信 Abstract 的所有 claim** — Abstract 是 marketing,看 Results 才知道真假
- ❌ **读完不写笔记** — 1 周后忘 80%

---

## 3. 读 paper 的 4 个产出位

每读 1 篇 paper,在 DPR 里做 4 件事：

1. **加到库** — `/libraries/<你的库>/` → 选 `included` 或 `candidate`
2. **写 note** — 单论文页右侧"📝 写笔记",3-5 行
3. **加 idea** — `/ideas/` → 标题用"读 `<paper 简称>` 笔记"
4. **加 concept** — 进 `/wiki/concepts/<相关概念>/` → 反向链接会更新

这 4 件事都不该花超过 5 分钟。

---

## 4. 不同论文类型怎么读

| 类型 | 重点读 | 跳过 |
|------|--------|------|
| **Survey / Review** | §2-3 分类法、§4 趋势、§5 open problems | 各个被引论文的细节 |
| **方法论文 (Method)** | §3 算法核心、§4.1 主要结果、§4.3 ablation | §5 Related Work(已知)、§6 Conclusion |
| **Benchmark / 数据集** | §3 数据收集、§4 baseline、§5 limitation | §6 各种 metric 细节 |
| **复现 / Empirical study** | §3 实验 setup、§4 各种条件下的结果、§6 takeaway | §2 Related Work |
| **理论 (Theory)** | §3 假设、§4 证明思路、§5 定理陈述 | §6 详细证明(初读跳) |

---

## 5. 怎么判断一篇 paper 值不值得深读

读完第一遍（5 分钟）后,问自己 3 个问题：

1. **它解决了什么具体问题?** 答不出 = 不值得深读
2. **它比 SOTA 高几个点?** < 1 个点 = 警惕 overclaim
3. **它的方法有什么新颖度?** 答不出"和 X 不同的具体一点" = 不值得深读

3 个问题至少 2 个 YES → 深读。1 个 YES → 笔记后归档。0 个 YES → 跳过。

---

## 6. 推荐阅读节奏

| Phase | 1 周读多少 | 重点 |
|-------|----------|------|
| Phase 1 | 1-3 篇(全是综述/经典) | 把方向 map 画出来 |
| Phase 2 | 5-8 篇(3 篇 SoTA + 2 篇 baseline + 1-2 篇 survey) | 建立 anchor + 找 gap |
| Phase 3 | 8-12 篇(混搭,带审稿视角) | 形成自己的判断 |
| Phase 4 | 5-8 篇 + 2-3 篇审稿 | 维持 map + 训练审稿 |

**反模式:** 1 周硬啃 20 篇然后全忘。

---

## 7. 工具配合

- **首页日历**: `/` 看最近 2 个月新论文,挑感兴趣的
- **搜概念**: `/concepts/` 反向链接看出"哪个概念最近热"
- **引用图**: `/graph/<arxivId>/` 看 1 篇 paper 的"邻居"
- **对比**: `/papers/compare/?ids=...` 把 2-3 篇并排(Phase 2+)

---

## 8. 进阶资料

- How to Read a Paper (S. Keshav, 2007): https://www.cs.cornell.edu/~srma/keshav.pdf
- Reading Research Papers (Andrew Ng): https://www.youtube.com/watch?v=733m6qBHjI0
- PhD 学生第一年必读: [`docs/onboarding/phase-1-orientation.md`](../onboarding/phase-1-orientation.md)
