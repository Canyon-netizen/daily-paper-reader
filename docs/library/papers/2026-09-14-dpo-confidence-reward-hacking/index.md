---
title: "用偏好对的隐式 confidence 信号降低 DPO reward hacking"
date: 2026-09-14
session: s_r3e1rfu0
tags: [rlhf, dpo, reward-hacking, confidence-signal, alignment]
authors:
  - DPR agents (Designer / Feedback / Gate / Modifier / Reviewer / Reviser)
venue: "DPR self-generated (ACL-style 3-persona review)"
status: "draft"
---

# 用偏好对的隐式 confidence 信号降低 DPO reward hacking

> **来源**: 由 `astro-src/scripts/agents-run.mjs --full-pipeline` 端到端产出
> **Session**: `s_r3e1rfu0` (2026-09-14, 7/7 stages completed)
> **评审**: 3-persona ACL 风格模拟审稿(methodologist / engineer / skeptic)
> **分数**: novelty 6 / soundness 5 / clarity 7 / experiments 4 / writing 6 / overall **5.6**

## 阅读入口

- 📄 **Markdown**: [paper.md](./paper.md) — 418 行,含 5 大节 + 13 篇 arxiv refs
- 📐 **LaTeX (ACL 模板)**: [paper.tex](./paper.tex) — 470 行,可用 `pdflatex` 编译
- 📚 **BibTeX**: [refs.bib](./refs.bib) — 13 条 @misc 条目,eprint + archivePrefix 标准格式

## 摘要

本文探讨在 DPO 训练中,如何利用偏好对(preference pairs)中**隐式的 confidence 信号**
(标注者一致度 / 偏好 margin / 答案长度差 等)来识别并缓解 reward hacking 风险。

我们从 7-stage multi-agent pipeline 端到端生成:
- **Stage 0 (Ideate)**: 5 条研究问题候选
- **Stage 1 (Lit Review)**: 5 段相关工作(覆盖 13 篇 arxiv)
- **Stage 2 (Experiment Plan)**: 5 份实验方案
- **Stage 3 (Draft)**: 5 段草稿(每个 stage 含 rationale / risk / quotes / 论文引用)
- **Stage 4 (Peer Review)**: 3-persona ACL 风格审稿(1 major + 3 minor concerns)
- **Stage 5 (Revise)**: 4/4 concerns 全部 addressed,生成完整修订稿
- **Stage 6 (Export)**: 装配 paper.md / paper.tex / refs.bib

## 评审意见摘录

| Persona | Severity | Category | Concern |
|---|---|---|---|
| methodologist | **major** | soundness | 缺乏对隐式 confidence 信号局限性的系统分析 |
| engineer | minor | clarity | 段落组织松散,缺明确结构 |
| skeptic | minor | experiments | 实验部分缺细节和可复现性 |
| methodologist | minor | writing | 部分句子语法瑕疵 |

**修订响应**: 4/4 concerns 全部 addressed — 见 [archive/s_r3e1rfu0/rounds/round_005.json](
`runPipeline` 落盘的 round record,pipeline 中间产物已 gitignore)

## 局限

- paper 由 LLM 多 agent 端到端生成,缺少真实实验数据 / 评测
- refs.bib 含 arxiv IDs 但无标题作者元数据(网络不可达 arxiv.org);
  后续可通过 docs/build-arxiv-index.mjs 补全
- ACL 模板需下载 `acl.sty` + `acl_natbib.sty` 才能 pdflatex 编译

## 复现

```bash
export LLM_BASE_URL=http://127.0.0.1:8124/v1 \
       LLM_API_KEY=dummy \
       LLM_MODEL=MiniMax-Text-01

node astro-src/scripts/agents-run.mjs \
  --full-pipeline "用偏好对的隐式 confidence 信号降低 DPO reward hacking" \
  --max-rounds 7 \
  --preset balanced

node astro-src/scripts/agents-run.mjs \
  --compile-paper --session <sid> \
  --latex-template acl
```
