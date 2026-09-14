# Library Inclusion Standard — Calibration Log

> **Purpose:** Manual log of how the multi-dimensional inclusion standard
> (`docs/library/inclusion-standard.md`) is performing in practice.
> Updated as users share their `dpr_library_feedback_v1` exports and as
> the maintainer observes patterns.
>
> **No automated telemetry.** All entries here are user-shared or maintainer-observed.

---

## Template for a new entry

```markdown
## YYYY-MM-DD — <source>

**Context:** <who, what library type, what dataset>
**Observation:** <what the data showed>
**Decision:** <what to change in the standard>
**Status:** proposed | applied | reverted
```

---

## Open questions

(待用户反馈积累后填)

1. **novice 画像**:5 维权重(0.30 / 0.25 / 0.20 / 0.15 / 0.10)是否合理?
   - 假设:教学清晰度权重应该是最高的(0.30 对吗? 0.35?)
2. **expert 画像**:novelty 0.30 + empirical_rigor 0.20 = 0.50,理论深度才 0.15
   - 假设:对 ML 子方向(非纯理论),这个比例 OK
   - 对纯理论子方向(泛函 / 优化),可能要把 theoretical_depth 调到 0.25-0.30
3. **practitioner 画像**:cost_efficiency 0.20 vs latency_throughput 0.15
   - 假设:cost 优先于 latency,因为 latency 可以用工程优化,成本是硬约束
   - 待证:用户 override 率
4. **reviewer 画像**:ethical_review 0.10 vs clarity 0.10
   - 假设:对 ML/AI 论文,ethical_review 该高;对纯系统/算法论文,该低

---

## Decisions log

(暂无 — 等第一批用户反馈)

---

## Calibration methodology (target for future iteration)

```
For each user-shared feedback dump:
  1. Group entries by audienceProfile
  2. For each (profile, kind) pair, compute:
     - include rate = paper_included / (paper_included + paper_excluded)
     - avg score of included papers
     - avg score of excluded papers
     - override rate = candidate_score_too_low + candidate_score_too_high / total
  3. If include rate < 0.4 for a profile → rubric 偏严,降默认阈值或权重
  4. If override rate > 0.3 for a profile → threshold 不匹配用户意图,调整
  5. If avg included score is much lower than avg excluded score
     → rubric 在错误维度上给高分,需要重排权重
```

实施该方法需要至少 30 个用户反馈 dump 才能有统计意义。
当前数据:0。等用户积累。
