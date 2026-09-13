# Cycle 1 Synthesis — demo-multi-agent-memory

> **Goal**: 如何在多智能体协作中实现长时记忆而不让 context 爆炸?
> **Mode**: dry-run (stub LLM)
> **Cycle**: 1 / 1
> **Rounds in this cycle**: 1

---

## 📋 本轮要点

- **Designer**: 产出 4 个 proposals (2 add_paper + 1 create_draft + 1 experiment_plan)
- **Feedback**: 3 persona × 4 proposals = 12 次评分,平均分 7.08,无 veto
- **Gate**: 3 promoted / 1 candidate / 0 rejected
- **Modifier**: 3 promoted 全部 applied,1 candidate skipped

---

## ⭐ 实际写入 (Modifier applied)

| Proposal | Kind | Target | Outcome |
|---|---|---|---|
| 加入 hierarchical communication 论文 | add_paper_to_stage | stage-background · 2606.29126 | ✅ applied |
| 起草:多智能体长期记忆综述 | create_draft_outline | writing w_demo_001 | ✅ applied |
| 实验:shared KV-cache vs per-agent memory | archive_round_summary | experiment e_demo_001 | ✅ would_call createExperiment |

---

## 🟡 跳过 (Modifier skipped)

| Proposal | Reason |
|---|---|
| 把 KV-cache 完整性论文加入研究背景 | gate 判 candidate,未达 promoted 阈值;合并到 p_demo_002 后处理 |

---

## 💡 Gap & 矛盾

- **依赖 vs 重复**: p_demo_001 与 p_demo_002 都是 add_paper,evidence 重叠 (KV-cache),下一轮需要合并 stage / 改 proposal type 让 gate 能区分。
- **综述 vs 原创**: p_demo_003 评分最高但 risk 提到"无新意",下一轮需要明确 contribution 而不是停在 survey。
- **实验可行性**: p_demo_004 engineer 给 9 分但 skeptic 担忧 API 成本,下一轮要先做 cost estimate 再 promote。

---

## 下一步建议

- [ ] Round 2 合并 p_demo_001 + p_demo_002 为 single add_paper proposal,引用合并后的 stage
- [ ] Round 2 在 p_demo_003 之上加 1 个 create_idea proposal,把"层级记忆"显式化为 hypothesis
- [ ] Round 2 之前先估算 p_demo_004 的 LLM API 成本(用 dry-run + 1 轮真实 token 数据校准),如果 < 200 美元就 promote
- [ ] 跑 max-rounds=3 看 avg score 是否从 7.08 收敛到 ≥ 7.5(若有 previous_rounds summary 可注入)
