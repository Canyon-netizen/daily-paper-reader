# Experiment: Visual Chain of Thought Effectiveness

## Experiment ID

`multimodal-cot-prompting`

## Hypothesis

Chain of Thought prompting improves VLM reasoning accuracy by 15-25% on complex visual QA tasks compared to direct answering.

## Method

Compare CoT vs direct prompting on 5 VLM models (GPT-4V, Claude-3-Vision, Gemini-Pro) across 3 visual reasoning datasets.

## Variables

- **Prompting Method** (independent): direct, CoT, self-consistency-CoT
- **Model** (independent): GPT-4V, Claude-3-Vision, Gemini-Pro, LLaVA-1.5, BLIP-2
- **Dataset** (independent): VQAv2, GQA, VizWiz
- **Accuracy** (dependent): Exact match and VQA accuracy

## Expected Results

CoT improves accuracy by 18% average, with largest gains on multi-step reasoning tasks.

## Status

running

## Related Papers

- 2201.11903
- 2304.11485

## Related Ideas

- multimodal-chain-of-thought

## Tags

- multimodal
- chain-of-thought
- vision-language
- prompting

## Owner

DPR

## Created

2026-08-15

## Updated

2026-09-05
