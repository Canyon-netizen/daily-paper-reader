# Experiment: LLM Benchmark Prompt Sensitivity

## Experiment ID

`benchmark-prompt-sensitivity`

## Hypothesis

Standard LLM benchmarks (MMLU, BBH, HumanEval) show >10% variance in scores when prompt templates, few-shot examples, or answer formats change.

## Method

Systematically vary prompt components across 8 benchmarks and 6 models. Measure score variance.

## Variables

- **Prompt Template** (independent): default, verbose, minimal, instruction-following
- **Few-shot Examples** (independent): 0-shot, 3-shot, 5-shot, random selection
- **Answer Format** (independent): A, (A), The answer is A, etc.
- **Model** (independent): GPT-4, Claude-3.5-Sonnet, Gemini-1.5-Pro, Llama-3-70B
- **Score Variance** (dependent): Standard deviation across prompt variations

## Expected Results

All benchmarks show >10% variance; MMLU most stable, HumanEval most sensitive.

## Status

running

## Related Papers

- 2307.15500
- 2310.14168

## Related Ideas

- evaluation-benchmark-robustness

## Tags

- evaluation
- benchmark
- robustness
- prompting

## Owner

DPR

## Created

2026-08-20

## Updated

2026-09-08
