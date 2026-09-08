# Idea: 大模型上下文窗口扩展技术

## 概述
研究如何高效扩展大型语言模型的上下文窗口，从 4K 扩展到 100K+ token 的技术方法。

## 详细描述
随着 LLM 应用场景的扩展,长上下文需求日益增长。本研究探索：
- 位置编码的改进（RoPE、ALiBi）
- 稀疏注意力与滑动窗口
- 上下文压缩与检索增强
- 显存与推理效率的权衡

## 关联论文
- 2304.08485 (LongNet: Scaling Transformers for 10K+ Sequence Length)
- 2307.02486 (YaRN: Efficient Context Window Extension)

## 标签
llm, architecture, context-length, efficient-inference

## 状态
draft
