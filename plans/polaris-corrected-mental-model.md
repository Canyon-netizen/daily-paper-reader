# Polaris 完整认知校正与 DPR 后续落地计划

**状态**: 认知补课完成，待按优先级实施  
**创建日期**: 2026-07-24  
**范围**: `E:/study/Polaris` 的完整系统语义 → `E:/study/daily-paper-reader` 的 zero-server 适配  
**前置材料**:

- [Polaris 完整认知地图](../memory/polaris-corrected-mental-model.md)
- [原始 Polaris 能力吸收计划](polaris-absorption.md)
- [Polaris 落地迁移状态](../docs/migration-polaris-absorption.md)

---

## 0. 计划目标

本计划不以“把 Polaris 搬进 DPR”为目标，而以两件事为目标：

1. **把 DPR 当前已经声称吸收的能力校正到真实状态**：区分已接线、只存在代码骨架、测试覆盖、默认关闭和实际未实现。
2. **在不破坏 DPR zero-server 产品边界的前提下，补齐最有价值的 Polaris 语义**：确定性优先、证据溯源、可恢复、幂等、能力边界、显式降级和可审计。

核心原则：

> 先保住科研产物和状态不变量，再增加 LLM 能力；先让失败可解释、可恢复，再让流程更自动。

---

## 1. 产品边界：明确吸收与不吸收

### 1.1 DPR 明确保留

- GitHub Actions + Supabase + Cloudflare Pages + 浏览器 LLM。
- Markdown / JSON / Git 作为主要持久化载体。
- 单用户仓库模型，不引入用户、项目成员和 RBAC。
- 论文阅读、每日推荐、主题探索、概念沉淀、浏览器精读。
- 低运维、可 fork、可回滚、可由配置关闭新能力。

### 1.2 DPR 明确不做

以下是产品边界，不再作为“遗漏能力”反复追踪：

- Polaris FastAPI 后端、Postgres 作为系统真源、Redis/ARQ worker。
- Yjs/CRDT 多人协作编辑与 Manuscript Writer。
- SSH/GPU Experiment Lab 和远程副作用执行。
- 多用户/RBAC/邀请/项目成员。
- MCP Tool Registry 及面向外部 Agent 的 MCP Server。
- Voyage 实时仪表盘、SSE/WS 长连接和人工 Gate UI。
- Polaris 的动态 plan editor 作为 DPR 主流程。

### 1.3 仍应吸收的跨系统原则

即使不搬运行时，也应保留这些语义：

- deterministic-first / LLM-last；
- 结构化 observation / verdict / provenance；
- 输入与输出 artifact 的明确边界；
- 幂等重跑和失败隔离；
- 版本/配置/模型快照，保证结果可解释；
- 能力型模型不可静默降级成不相干模型；
- LLM 只产生数据，代码控制副作用；
- 引用存在性与论断支持分轴记录；
- “not checked / network unavailable” 不得伪装成 fabricated 或 pass。

---

## 2. 现状校正：先修正文档认知

### 2.1 建立能力状态表

新增或更新一份短文档，逐项标记：

| 能力 | 当前状态 | 真实问题 |
|---|---|---|
| Stage Routing | 基本接入 | Python dot stage 与浏览器 underscore stage 命名不一致；需统一映射和测试 |
| Prompt Packs | 文件加载骨架 | 缺 target 白名单、快照、自身 output contract、persona/workflow 语义 |
| Concept Backlinks | 主要可用 | 需继续验证日常 Step 6 与 backfill 的接线、失败可见性和索引一致性 |
| Topic v2 | scaffold | 默认 `stub_judge` 全 tie；pro/con 仍是 TODO；没有 dedup/grounding/novelty/gate |
| Citation Guard | CLI/核心算法存在 | support 轴和文档退出码描述需校正；需验证 workflow 接线 |
| Pipeline Checkpoint | IO/薄壳存在 | 当前主流程调用和 config 开关未完整接入，功能实际 inert |
| Validate | deterministic 核心存在 | runtime wiring 未完成；`_judge_rubric` 是 placeholder |
| LLM Usage | JSONL 记录存在 | 与 Polaris 的 stage/model/provenance 语义仍需统一和验证 |

**验收**:

- 文档不再把“代码存在”写成“能力默认可用”；
- 每项均有 `wired / tested / default / rollback` 四个字段；
- 所有 file:line 引用重新核对。

### 2.2 文档与代码同步

修订：

- `docs/migration-polaris-absorption.md`
- `plans/polaris-absorption.md` 中不再准确的实现状态段
- 相关 PR plan 的“已完成”表述

重点修正：

- Checkpoint 当前未完整接线；
- Validate 当前未接入所有 subprocess 出口；
- LLM rubric 是 placeholder；
- Topic v2 默认没有真实 judge；
- Python/TS stage 命名不同；
- Citation Guard CLI exit code 与文档不一致；
- TS parity exports 不等于已经执行了 parity 测试。

---

## 3. P0：先恢复质量护栏的真实可用性

### 3.1 修复 CI 当前红灯

优先处理 `tests/test_concept_extractor.py::test_extract_concepts_with_mock_router` 的失败。

检查重点：

- mock router 返回形态是否与 `concept_extractor.py` 当前读取协议一致；
- `choices[0].message.content` 与内部 dict 包装是否统一；
- 不允许再次出现 dict/attribute 混用导致静默返回空 concepts；
- 增加 object-shaped 和 dict-shaped response 的兼容测试，或明确只支持一种协议并在边界处转换。

**验收**:

- Python 测试全绿；
- LLM 返回 malformed/empty/429 时有明确 failure 或可观察降级；
- 不再出现“概念提取失败但进程 exit 0 且结果为空”的静默路径。

### 3.2 接通 Pipeline Checkpoint，或明确延期

推荐方案：接通，不扩张为完整 Voyage。

步骤：

1. 在 `config.yaml` 增加显式的：

   ```yaml
   pipeline:
     checkpoints:
       enabled: false
   ```

2. 将 `src/main.py` 中真实的 Step 0–6 调用逐个包到 `run_step_with_checkpoint()`。
3. 保持默认关闭时与旧 `run_step()` 完全等价。
4. 以现有 18 个 sub-step 定义作为稳定 step registry。
5. 记录 input hash、output artifact、exit code、elapsed、attempt、code/config/model provenance。
6. 失败必须写 checkpoint 后再抛出，不能只依赖 stdout。
7. 验证 crash/re-run/损坏 JSON/并发 lock/旧 archive 兼容。

**不做**:

- 不在这一阶段引入 Navigator 动态 plan edit；
- 不把 checkpoint 当作真实 Voyage 数据库；
- 不实现跨日自动重规划。

**验收**:

- 同一 archive 第二次运行会跳过 succeeded sub-step；
- 删除或损坏某一个 checkpoint 只重跑该 sub-step；
- 默认关闭时 archive 输出和旧行为不变；
- GitHub Actions kill 后不会留下“看起来 succeeded 但 artifact 不存在”的状态。

### 3.3 接通 Validate，并消除 placeholder

步骤：

1. 让每个 checkpoint-wrapped sub-step 在成功/失败出口调用 `src.validate.verify()`。
2. 对每个 artifact 明确 `output_path / output_payload / exit_code / observation`。
3. 修正 `no_error` 语义：它应检查 observation error，而不是简单把文件存在当 error 检查。
4. `schema_valid` 检查所有记录或至少明确记录级错误数量，不能只检查第一条。
5. 统一 actionable reason，保留 `[kind]` 前缀和实际值。
6. `_judge_rubric` 若暂不实现，必须在配置/文档中明确是 disabled-only；不能返回“rubric evaluation passed”伪装成功。
7. 默认仍关闭 rubric；后续单独实现 browser/local provider call 或明确不支持。

**验收**:

- `verdict` 在实际 checkpoint 中非空；
- exit 0 但空 JSON/少记录/缺字段会被识别；
- deterministic fail 不会发起额外 LLM 调用；
- rubric 未实现时不会制造 false pass。

---

## 4. P1：补齐 Polaris 最值得迁移的语义

### 4.1 Prompt Pack 增加“可复现”和“安全注入”

在不引入数据库的情况下，向现有 `prompt_pack.py` 增加：

1. **target allowlist**：未知 target 不得注入；
2. **manifest schema runtime 校验**：不只 CI lint；
3. **pack content hash**：写入 checkpoint/provenance；
4. **run-start snapshot**：checkpoint 创建时固化 active pack 的 id/version/hash/body；
5. **output_contract**：至少支持 JSON `type/required/properties/items/enum` 子集；
6. **persona kind**：让 Topic debate / reviewer 使用 persona 数据，而不是只把它当 prompt body；
7. **workflow kind**：先定义 schema 和禁用状态，避免继续把 workflow 当普通 body；
8. `active.<target>` 与实际 target 命名统一，dot/underscore 只在边界做一次映射。

**验收**:

- 修改 active pack 后，已写入 checkpoint 的 run 仍使用旧 hash；
- 不合法 target/manifest 在运行前失败；
- malformed JSON output 在 Sextant-like validation 阶段被拦截；
- pack 不改变硬编码的 output schema 和安全约束。

### 4.2 完善 Topic v2，而不是假装等同 Forge

分两个阶段：

#### P1-A：让现有 Elo 真的工作

1. 浏览器 Topic 流程明确传入 `judge_llm_call`；
2. 去掉默认生产路径的 `stub_judge`，没有配置时显示“未配置 judge”，不要伪装 tie；
3. 将 pro/con persona calls 接入真实 LLM 或明确移除 transcript 中的 TODO；
4. 记录每场 `failed / reason / winner / transcript / tokens`；
5. 为 tie、LLM error、quota error、malformed result 显示不同状态；
6. 补 TS/Python parity 真正执行的测试。

#### P1-B：只补最有价值的 Forge 语义

1. 对候选做 deterministic dedup：先规范化文本/slug，再可选 embedding similarity；
2. evidence 改为结构化来源：`library / signal / external`，保留 paper id 或具体文件；
3. 增加最小 novelty check：与已有论文/主题候选比对；
4. 保存 score 与 score rationale，不能只有 Elo；
5. 将 limitations 变成带 paper reference 的证据；
6. 提供“候选 → 已评审 → 可继续精读”的显式状态，而不是只写 session JSON。

**明确不做**:

- 不引入 Polaris 的完整 Idea/Project DB；
- 不引入人工 Gate UI；
- 不把 Topic v2 改造成 SSH 实验流程。

**验收**:

- 默认没有 judge 时不会产生虚假的 Elo 排名；
- 相同 idea 不会因不同 signal 重复出现；
- 每个候选都能追溯到至少一个本地论文/概念/limitations artifact；
- 失败对局不会阻塞其它候选，也不会静默吞掉失败。

### 4.3 Citation Guard 采用双轴证据模型

在现有 `*.citations.json` 中明确分离：

```json
{
  "existence": "exact|minor|fabricated|not_checked",
  "support": "supported|partial|unsupported|not_checked",
  "source": "library|semantic_scholar|openalex|none",
  "reason": "..."
}
```

步骤：

1. 校正 CLI exit code 和文档；
2. 网络不可用时保留 `not_checked` 或保守 `minor`，不得 fabricated；
3. support check 未开启时明确 `not_checked`；
4. 把 fabricated 与 unsupported 分别计数；
5. pass 逻辑明确为“无 fabricated + checked support 达标”，不把 minor 直接当 support；
6. workflow 集成测试覆盖 library exact、remote minor、remote fabricated、双端网络失败；
7. `save-paper.yml` 失败时保留原始精读产物，并将 guard 结果作为附属 artifact。

---

## 5. P2：把“可恢复、可审计、可降级”做成统一工程规范

### 5.1 统一 provenance

所有 LLM 产物和重要 checkpoint 至少包含：

```json
{
  "code_version": "git:<sha>",
  "config_hash": "sha256:...",
  "model_route": "stage:<name>",
  "provider_model": "...",
  "prompt_pack": {"id": "...", "version": "...", "hash": "..."},
  "input_artifacts": [{"path": "...", "sha256": "..."}]
}
```

目标不是复制 Polaris 的 DB schema，而是解决 DPR 当前“同一天模型/配置变化后无法解释差异”的问题。

### 5.2 统一 failure taxonomy

至少区分：

- `execution_error`：子进程/网络/LLM 调用失败；
- `validation_error`：程序成功但产物不满足契约；
- `configuration_error`：provider/model/credentials/config 缺失；
- `artifact_error`：文件缺失/损坏/路径错误；
- `budget_exhausted`：成本上限触发；
- `degraded`：产物可用但缺少某项能力；
- `not_checked`：由于网络或配置未执行某检查。

每种状态都要写入 artifact/checkpoint，并在 UI/Action log 中提供恢复动作。

### 5.3 统一 capability fallback

参考 Polaris 的 capability-only route：

- embedding 未配置不能静默调用普通 chat 模型；
- citation support 未开启不能显示为 supported；
- judge 未配置不能把全 tie 伪装成排序；
- concepts 提取失败不能写 `wiki_compiled: true`；
- checkpoint 未接线不能在文档里标成“已启用”。

---

## 6. 测试计划

### 6.1 Python 单测

- `test_pipeline_checkpoint.py`
  - atomic write
  - corrupted JSON
  - attempts
  - lock
  - skip succeeded
  - retry failed
- `test_validate.py`
  - every deterministic check
  - observation error
  - all-record schema validation
  - no false rubric pass
- `test_prompt_pack.py`
  - invalid target
  - hash/provenance
  - snapshot
  - output contract
- `test_concept_extractor.py`
  - dict/object response protocol
  - malformed output
  - blacklist/alias/category clamp
- `test_topic_v2.py`
  - real judge winner a/b/tie
  - judge failure isolation
  - no-judge explicit degraded state
  - dedup/evidence provenance
- `test_citation_guard.py`
  - existence/support independence
  - network outage
  - exit codes

### 6.2 TypeScript 测试

- 真正执行 `topic-search-v2.ts` 的 `__testing__` parity exports；
- Python/TS 的 Elo、Swiss pairing、tie、failed match 结果一致；
- route stage dot/underscore 映射一致；
- Topic UI 能显示 `not configured / degraded / failed / completed` 四种状态。

### 6.3 Workflow/集成测试

至少覆盖：

1. checkpoint 关闭的旧 cron；
2. checkpoint 开启的完整 cron；
3. Step 4 产出空 JSON；
4. Step 6 产物存在但 concept extraction 失败；
5. Citation Guard remote API 双端不可用；
6. Topic judge 未配置；
7. save-paper guard 失败但主精读文件仍保留。

---

## 7. 实施顺序与每阶段提交边界

### Commit 1：文档状态校正

- 更新迁移状态表；
- 修正过时路径、exit code、enabled/wired 描述；
- 不改运行时行为。

### Commit 2：CI 与 Concept extractor 修复

- 修复当前失败测试；
- 固化 LLM response boundary；
- 添加 silent-failure regression tests。

### Commit 3：Checkpoint 真接线

- 加 config key；
- 接入主流程；
- 运行时写 observation/verdict/provenance；
- 保证默认关闭兼容。

### Commit 4：Validate 真实接线

- subprocess 出口调用；
- 修正 schema/min_count/no_error 语义；
- 去除 placeholder false pass。

### Commit 5：Prompt Pack 快照与 contract

- target allowlist；
- snapshot/hash；
- output contract；
- 明确 persona/workflow 的边界。

### Commit 6：Topic v2 真实 judge 与 failure UX

- 接入 browser judge；
- 移除默认伪 tie；
- 修复 pro/con TODO；
- parity tests。

### Commit 7：Citation Guard 双轴证据

- existence/support 分离；
- exit code 与 workflow 校正；
- integration tests。

### Commit 8：统一 provenance/failure taxonomy

- 跨 pipeline/router/concepts/topic/citation 的一致字段；
- 文档与 UI 状态同步。

每个 commit 单独测试、单独提交；遵守仓库约定：**只提交，不自动 push；commit 不添加 Co-Authored-By trailer**。

---

## 8. 最终验收清单

### 代码真实度

- [ ] 文档中的每个“已完成”都能在真实入口找到调用链；
- [ ] 默认关闭能力不会污染旧 cron；
- [ ] 未实现能力不会用 stub/placeholder 伪装成成功；
- [ ] CI 全绿，新增 parity 测试确实执行。

### Polaris 语义保真度

- [ ] deterministic-first / LLM-last；
- [ ] self_check 优先；
- [ ] output contract 在 LLM judge 前执行；
- [ ] plan signal 与失败分类有清晰替代方案；
- [ ] prompt/config 在 run 级别可追溯；
- [ ] citation existence 与 support 分离；
- [ ] side effect 由代码控制；
- [ ] network outage 不产生 fabricated 假阳性；
- [ ] capability missing 不静默 fallback。

### DPR 边界

- [ ] 无 Postgres/Redis/ARQ/Yjs/SSH/MCP 引入；
- [ ] 无多用户/RBAC 语义泄漏；
- [ ] 不为“看起来像 Polaris”而引入服务器运行时；
- [ ] 所有新 artifact 都能通过 Git diff 解释、回滚和恢复。

---

## 9. 当前推荐起点

下一次真正开始改代码时，优先执行：

1. 修复 `test_concept_extractor` 当前红灯；
2. 更新迁移文档的真实状态；
3. 接通 Checkpoint + Validate 的最小真实路径；
4. 再决定 Topic v2 是接入真实 judge，还是明确标成离线 scaffold。

不要先扩展新功能，也不要继续添加“对齐 Polaris”的常量；当前最大收益来自**把已经写入仓库的能力从“存在代码”变成“真实接线、真实测试、真实失败语义”**。
