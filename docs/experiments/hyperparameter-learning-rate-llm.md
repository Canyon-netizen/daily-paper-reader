# Hyperparameter Study: Optimal Learning Rate for LLM Fine-tuning

## Experiment ID

`hyperparameter-learning-rate-llm`

## Hypothesis

The optimal learning rate for LLM fine-tuning is 1e-5, with significant performance drop below 1e-6 and above 1e-4.

## Method

Grid search learning rates: 1e-7 to 1e-3 on 7B model. Evaluate on downstream tasks after 3 epochs.

## Variables

- **Learning Rate** (independent): Learning rate values — 1e-7, 1e-6, 1e-5, 1e-4, 1e-3
- **Validation Loss** (dependent): Loss on held-out set
- **Task Accuracy** (dependent): Downstream task performance

## Expected Results

Peak at 1e-5, U-shaped curve with sharp degradation at extremes.

## Actual Results

Confirmed optimal at 1e-5. Loss plateau at 1e-6, divergence at 1e-3.

## Status

completed

## Related Papers

- 2303.08466

## Tags

- hyperparameter
- fine-tuning
- learning-rate

## Owner

DPR

## Created

2026-04-05

## Updated

2026-07-30
