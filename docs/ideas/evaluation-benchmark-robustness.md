# Idea: LLM 评估基准的鲁棒性分析

## 概述
系统性分析现有 LLM 评估基准对提示语变化的敏感性。

## 详细描述
LLM 评估结果往往对 prompt 格式、示例选择、顺序等高度敏感。本项目旨在:
- 测量 MMLU, BBH, HumanEval 等基准的 prompt 敏感性
- 提出更稳定的评估协议
- 构建抗提示语干扰的新基准

## 关联论文
- 2307.15500 (Prompting Language Models for Quoting)
- 2310.14168 (Many-Shot Prompting)

## 标签
evaluation, benchmark, robustness, llm

## 关联实验
- benchmark-prompt-sensitivity

## 状态
active
