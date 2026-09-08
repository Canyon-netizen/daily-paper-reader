# Experiment: Reward Model Cross-Domain Generalization

## Experiment ID

`preference-model-generalization`

## Hypothesis

Reward models trained on specific domains (e.g., code) exhibit poor generalization to unrelated domains (e.g., creative writing), with performance degradation >30%.

## Method

Train reward models on single-domain preference datasets (Anthropic HH-RLHF, OpenAI Summarization). Evaluate zero-shot on 5 out-of-domain datasets.

## Variables

- **Training Domain** (independent): code, dialogue, summarization, mathematics
- **Evaluation Domain** (independent): code, dialogue, summarization, math, creative writing
- **Reward Model Size** (independent): 1B, 7B, 70B
- **Generalization Score** (dependent): Correlation between train and test domain performance

## Expected Results

Reward models show significant performance drop (>30%) on out-of-domain data, with larger models showing slightly better generalization.

## Status

running

## Related Papers

- 2203.02155
- 2209.01158

## Related Ideas

- rlhf-preference-model-analysis

## Tags

- reward-model
- generalization
- rlhf
- cross-domain

## Owner

DPR

## Created

2026-09-01

## Updated

2026-09-08
