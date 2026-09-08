# Prompt Engineering: Chain-of-Thought Variations

## Experiment ID

`prompt-engineering-chain-of-thought`

## Hypothesis

Explicit step-by-step CoT prompting improves accuracy by 10%+ on math reasoning compared to simple "think step by step".

## Method

Test 5 CoT variants on GSM8K and MATH datasets: simple, explicit steps, intermediate results, self-consistency, tree search.

## Variables

- **CoT Variant** (independent): Type of chain-of-thought prompt — simple, explicit-steps, intermediate, self-consistency, tree-search
- **Accuracy** (dependent): Correct answer percentage

## Expected Results

Explicit steps and self-consistency outperform simple CoT by 10-15%.

## Actual Results

Confirmed: Explicit steps achieve 72% on MATH vs 58% for simple CoT. Self-consistency adds another 5%.

## Status

completed

## Related Papers

- 2201.11903
- 2210.03493

## Tags

- prompt-engineering
- cot
- reasoning
- math

## Owner

DPR

## Created

2026-03-20

## Updated

2026-08-10
