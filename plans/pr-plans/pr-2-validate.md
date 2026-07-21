# PR-2 — Sextant Validate（6 维确定性核查）

> **状态**：待开工
> **来源**：`plans/polaris-absorption.md` 能力 2（Sextant 核查 → DPR Validate Step）
> **依赖**：PR-1（`verdict` 字段写进 checkpoint）
> **优先级**：中（默认 disabled，开了才有收益）
> **预估 LOC**：~700 行（`src/validate/` 4 个文件 + 15 个 schema + 6 处主脚本插入 + 单测）

---

## 1. 目标

把当前「subprocess returncode == 0 即通过」的弱验收升级为「产物可用」级别的 6 维确定性核查。

**核心痛点**：
- [src/4.llm_refine_papers.py](src/4.llm_refine_papers.py) 即使 LLM 全返回空 JSON，只要 exit 0，pipeline 就继续——下游 Step 5/6 拿到空输入就沉默地产出空文档
- Step 1 fetch 失败已有 `fetch_status.json` 哨兵（[src/main.py:798-825](src/main.py#L798)）但其他 step 没有
- Step 6 写盘后只有 `verify_paper_md_was_written(md_path, min_size=200)`（[src/generate_docs_md_io.py:50-78](src/generate_docs_md_io.py#L50)）雏形

**解决方案**：仿照 Polaris [E:/study/Polaris/src/backend/app/agents/voyage/sextant.py](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py) `DETERMINISTIC_CHECK_KINDS` 6 维（`no_error / exit_code / artifact_exists / schema_valid / metric / min_count`）+ 可选 `llm_rubric`，挂到每个 step 出口。

---

## 2. 设计原则

1. **零破坏**：默认 `pipeline.validate.enabled: false`——老 cron 行为不变
2. **6 维确定性检查全部本地算**，无 LLM 调用
3. **`llm_rubric` 默认关**——避免引入新的 LLM call 成本
4. **失败处理三分级**：`abort`（abort pipeline） / `mark_needs_review`（标记后继续） / `clamp`（截断修正）
5. **JSON Schema 静态文件**：每个 step 一份 `<step_id>.schema.json` 存在 `src/validate/contracts/`

---

## 3. 改动清单

### 新增文件

| 文件 | 行数 | 用途 |
|------|------|------|
| [src/validate/__init__.py](src/validate/__init__.py) | ~100 | `verify(step_id, output_path, acceptance, observation) -> verdict` 主入口 |
| [src/validate/checks.py](src/validate/checks.py) | ~150 | 6 维 predicate 实现（**对齐 Polaris [checks.py](E:/study/Polaris/src/backend/app/agents/voyage/checks.py)**） |
| [src/validate/contracts/](src/validate/contracts/) | ~15 × 30 | 每 step 一份 schema JSON |
| [src/validate/rubrics/](src/validate/rubrics/) | ~5 × 30 | 可选 LLM rubric 模板（默认关） |
| [tests/test_validate_checks.py](tests/test_validate_checks.py) | ~150 | 单测覆盖 6 维 + 4 步评估顺序 |

### 改动文件

| 文件 | 改动 |
|------|------|
| [src/main.py](src/main.py) | 每个 sub-step 出口插入 `verify(...)` → 写 verdict 到 checkpoint |
| [src/generate_docs_md_io.py:50-78](src/generate_docs_md_io.py#L50) | 重写 `verify_paper_md_was_written` 走新 `verify()` 入口 |
| [src/4.llm_refine_papers.py](src/4.llm_refine_papers.py) | 出口加 `verify("4.llm_refine", llm_path, ...)` |
| [src/5.select_papers.py](src/5.select_papers.py) | 出口加 `verify("5.select.deep_dive", ...)` / `verify("5.select.quick_skim", ...)` |
| [src/6.generate_docs.py](src/6.generate_docs.py) | `process_paper` ([src/6.generate_docs.py:1599](src/6.generate_docs.py#L1599)) 内每篇 md 写盘后加 verify |
| [config/config.yaml](config/config.yaml) | 新增 `pipeline.validate: { enabled: false }` 块 |

---

## 4. 6 维 Check 详细定义（**对齐 Polaris [checks.py:8-17](E:/study/Polaris/src/backend/app/agents/voyage/checks.py#L8)**）

### Check spec 形状

```json
{
  "kind": "no_error"
}
{
  "kind": "exit_code",
  "value": 0
}
{
  "kind": "artifact_exists",
  "key": "archive/20260721/rank/arxiv_papers_20260721.llm.json"
}
{
  "kind": "schema_valid",
  "field": "records",
  "required_keys": ["paper_id", "llm_score", "reasoning"]
}
{
  "kind": "min_count",
  "field": "records",
  "value": 20
}
{
  "kind": "metric",
  "name": "llm_score",
  "op": ">=",
  "value": 0.0
}
{
  "kind": "llm_rubric",
  "rubric": "rubrics/llm_refine_quality.md"
}
```

### 6 维 Predicate 实现（`src/validate/checks.py`）

```python
DETERMINISTIC_CHECK_KINDS = frozenset({
    "no_error", "exit_code", "artifact_exists",
    "schema_valid", "metric", "min_count",
})
CHECK_KINDS = DETERMINISTIC_CHECK_KINDS | {"llm_rubric"}

METRIC_OPS = {">=", "<=", ">", "<", "=="}

def run_deterministic_checks(
    checks: list[dict],
    *,
    output_path: Path | None,
    output_payload: dict | None,
    exit_code: int | None,
) -> tuple[bool, list[str]]:
    """返 (all_passed, [reason_per_check])。"""
    reasons = []
    for c in checks:
        kind = c["kind"]
        if kind not in DETERMINISTIC_CHECK_KINDS:
            continue
        if kind == "no_error":
            ok = output_path is not None and output_path.exists()
        elif kind == "exit_code":
            ok = exit_code == c.get("value", 0)
        elif kind == "artifact_exists":
            ok = (output_path.parent / c["key"]).exists()
        elif kind == "schema_valid":
            ok = _check_schema_valid(output_payload, c["field"], c["required_keys"])
        elif kind == "min_count":
            ok = _check_min_count(output_payload, c["field"], c["value"])
        elif kind == "metric":
            ok = _check_metric(output_payload, c["name"], c["op"], c["value"])
        reasons.append(f"[{kind}] {'PASS' if ok else 'FAIL'}")
        if not ok:
            return False, reasons
    return True, reasons
```

### 4 步评估顺序（**对齐 Polaris [sextant.py:47-101](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L47)**）

```python
# src/validate/__init__.py
def verify(
    step_id: str,
    *,
    output_path: Path | None,
    exit_code: int | None,
    acceptance: dict,
    observation: dict,
) -> dict:
    """返 verdict: {"passed": bool, "reason": str, "rubric_passed": bool | None}"""

    # Step 1 — observation.error 短路
    if observation.get("error"):
        return {"passed": False, "reason": f"[observation.error] {observation['error']}", "rubric_passed": None}

    checks = acceptance.get("checks", [])
    deterministic_checks = [c for c in checks if c["kind"] != "llm_rubric"]
    rubric_checks = [c for c in checks if c["kind"] == "llm_rubric"]

    # Step 2 — 解析 output_payload（若 artifact 是 JSON）
    output_payload = _load_output_payload(output_path) if output_path and output_path.suffix == ".json" else None

    # Step 3 — 跑确定性 check
    det_passed, det_reasons = run_deterministic_checks(
        deterministic_checks,
        output_path=output_path,
        output_payload=output_payload,
        exit_code=exit_code,
    )
    if not det_passed:
        return {"passed": False, "reason": "; ".join(det_reasons), "rubric_passed": None}

    # Step 4 — 跑 llm_rubric（默认 enabled=false，跳过）
    if not rubric_checks or not acceptance.get("rubric_enabled", False):
        return {"passed": True, "reason": "全部确定性检查通过", "rubric_passed": None}

    rubric_passed, rubric_reason = _judge_rubric(rubric_checks, output_payload)
    return {
        "passed": rubric_passed,
        "reason": rubric_reason,
        "rubric_passed": rubric_passed,
    }
```

---

## 5. 每 step 的 Acceptance（`src/validate/contracts/`）

### `4.llm_refine.schema.json`

```json
{
  "step_id": "4.llm_refine",
  "checks": [
    { "kind": "no_error" },
    { "kind": "exit_code", "value": 0 },
    { "kind": "artifact_exists", "key": "archive/${RUN_DATE}/rank/arxiv_papers_${RUN_DATE}.llm.json" },
    { "kind": "schema_valid", "field": "records", "required_keys": ["paper_id", "llm_score", "reasoning"] },
    { "kind": "min_count", "field": "records", "value": 20 },
    { "kind": "metric", "name": "llm_score", "op": ">=", "value": 0.0 },
    { "kind": "metric", "name": "llm_score", "op": "<=", "value": 1.0 }
  ],
  "rubric_enabled": false,
  "on_fail": "mark_needs_review"
}
```

### 15 份 schema 清单

| 文件 | 对应 step |
|------|----------|
| `0.enrich_config_queries.schema.json` | Step 0 |
| `1.1.fetch.raw.schema.json` | Step 1.1 |
| `2.1.retrieval.bm25.schema.json` | Step 2.1 |
| `2.2.retrieval.embedding.schema.json` | Step 2.2 |
| `2.3.retrieval.rrf.schema.json` | Step 2.3 |
| `3.rank.blt.schema.json` | Step 3 |
| `4.llm_refine.schema.json` | Step 4 |
| `5.select.deep_dive.schema.json` | Step 5.1 |
| `5.select.quick_skim.schema.json` | Step 5.2 |
| `6.docs.generate_readme.schema.json` | Step 6.1 |
| `6.docs.generate_paper_md.schema.json` | Step 6.2 |
| `6.docs.ensure_figures.schema.json` | Step 6.3 |
| `6.docs.ensure_formulas.schema.json` | Step 6.4 |
| `6.docs.update_sidebar.schema.json` | Step 6.5 |

---

## 6. 失败处理策略表

| predicate 失败 | action | reason 格式 | 对应 Polaris 行为 |
|----------------|--------|------------|------------------|
| `no_error` | **abort** | `[no_error] 文件不存在` | [sextant.py:51-52](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L51) 短路 |
| `exit_code != 0` | **abort** | `[exit_code] rc=1 != 0` | `fetch_status.json` 现有行为 |
| `artifact_exists` | **abort** | `[artifact_exists] <path> 不存在` | 同上 |
| `schema_valid` | `mark_needs_review` | `[schema_valid] records 缺 paper_id` | Polaris `mark_needs_review` |
| `min_count` | `mark_needs_review` | `[min_count] 12 records, < 20` | 同上 |
| `metric` out of range | `clamp` | 截断到 [0, 1] | Polaris `clamp` |
| `llm_rubric` 失败 | `mark_needs_review` | `[llm_rubric] LLM 评分 5/10` | [sextant.py:103-141 `_judge`](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L103) |

**`abort` vs `mark_needs_review` 区别**：
- `abort` —— 整个 pipeline 停下来（极少用：仅 `no_error` / `exit_code` / `artifact_exists` 失败时）
- `mark_needs_review` —— 记录 verdict 到 checkpoint，继续跑下游，docs 顶部插 `> ⚠️ Step X 验收未通过`

---

## 7. `verify_paper_md_was_written` 重写

**当前实现**（[src/generate_docs_md_io.py:50-78](src/generate_docs_md_io.py#L50)）：

```python
def verify_paper_md_was_written(md_path, min_size=200) -> bool:
    if not os.path.exists(md_path):
        return False
    return os.path.getsize(md_path) >= min_size
```

**新实现**（走 `src/validate/__init__.py::verify()` 入口）：

```python
def verify_paper_md_was_written(md_path, min_size=200) -> bool:
    """保 compat:返 True/False,但内部走 validate.verify()。"""
    verdict = verify(
        "6.docs.generate_paper_md",
        output_path=Path(md_path),
        exit_code=0,
        acceptance=load_contract("6.docs.generate_paper_md.schema.json"),
        observation={"error": None},
    )
    if verdict["passed"]:
        return True
    # 旧契约:返 False
    return False
```

---

## 8. 配置开关

`config/config.yaml` 新增：

```yaml
pipeline:
  validate:
    enabled: false
    rubric_enabled: false       # 默认关，避免引入新 LLM call
    contracts_dir: "src/validate/contracts"
    rubrics_dir: "src/validate/rubrics"
    on_fail_strategy:
      default: "mark_needs_review"
      overrides:
        no_error: "abort"
        exit_code: "abort"
        artifact_exists: "abort"
```

---

## 9. 与 Polaris 的差异

| 维度 | Polaris | DPR PR-2 |
|------|---------|----------|
| LLM rubric | 重新叫 LLM 评估产物质量（expensive） | **默认 disabled**，失败仅 mark |
| output_contract | Skill 携带的动态 schema | **静态 `contracts/*.schema.json`** |
| self_check 短路 | action 返回的 `observation["self_check"]` | **不引入**（v1 简化） |
| `_MAX_ATTEMPTS = 3` | Sextant 重试 | **不引入**（PR-1 记录 attempts 但不自动重试） |
| `observation.error` 短路 | 第 1 步 | **保留**（PR-2 实现） |

---

## 10. 测试方案

### 单测（`tests/test_validate_checks.py`）

| # | 用例 | 期望 |
|---|------|------|
| 1 | 6 维 check 全 pass | verdict.passed=true |
| 2 | `no_error` 失败（文件不存在） | verdict.passed=false, action=abort |
| 3 | `schema_valid` 缺 paper_id | verdict.passed=false, action=mark |
| 4 | `min_count` 12 < 20 | verdict.passed=false, action=mark |
| 5 | `metric` llm_score = 1.5 超出 [0,1] | verdict.passed=false（PR-2 不 clamp，仅记录） |
| 6 | `observation.error` 短路 | verdict 直接返 error reason，跳过其他 check |
| 7 | `llm_rubric` enabled=true, 模拟 LLM 返 5/10 | verdict.passed=false, rubric_passed=false |
| 8 | 4 步评估顺序（deterministic-first / llm-last） | 单测断言调 LLM 是最后一步 |
| 9 | 失败 action 分级（abort vs mark） | 单测断言正确的 action 类型 |

### 手工测试

| # | 场景 | 期望 |
|---|------|------|
| 1 | 启用 validate，正常 cron | 每个 checkpoint 的 verdict.passed=true |
| 2 | Step 4 LLM 模拟返空 records（min_count fail） | 4.1 verdict.passed=false, action=mark，下游仍跑 |
| 3 | Step 6 md 文件被删 | 6.2 verdict.passed=false, action=abort，pipeline 停 |
| 4 | 关 validate | verdict 字段全 null（PR-1 已留位） |
| 5 | 老 archive 验证 | schema 加 `version` 字段，老文件不阻断 |

---

## 11. 风险与回滚

| 风险 | 严重度 | 缓解 | 回滚 |
|------|--------|------|------|
| Schema 收紧太严让历史 archive 不通过 | 中 | schema 加 `version` 字段；旧文件不阻断 | `enabled: false` |
| `mark_needs_review` 太多导致 docs 顶部全是警告 | 低 | docs 顶部折叠/默认隐藏 | N/A（信息性） |
| LLM rubric 引入新 LLM call 增成本 | 高（潜在） | `rubric_enabled: false` 默认 | 同上 |
| 6 维 check 漏掉关键校验（如 paper_id 格式） | 中 | 每 step 写 contract 时单测覆盖 | 加 check |

**通用回滚**：`pipeline.validate.enabled: false`，`verify_paper_md_was_written` 保留作为兜底。

---

## 12. 验收清单

- [ ] `src/validate/` 4 个文件全部存在
- [ ] 15 个 schema JSON 全部存在且通过 JSON Schema 验证
- [ ] 单测 9 个 case 全过
- [ ] 默认 `enabled: false` 时 `main()` 行为与 PR-1 完成后完全一致
- [ ] `enabled: true` 时 checkpoint.verdict 字段被填充
- [ ] abort 行为仅在 `no_error` / `exit_code` / `artifact_exists` 失败时触发
- [ ] mark 行为在 `schema_valid` / `min_count` / `llm_rubric` 失败时触发
- [ ] `verify_paper_md_was_written` 走新入口，老调用点无破坏

---

## 13. Effort 估算

| 工作项 | 预估工时 |
|--------|---------|
| `src/validate/__init__.py` + `checks.py` | 1.5 天 |
| 15 个 schema JSON | 0.5 天 |
| 5 个 rubric markdown（默认 disabled） | 0.3 天 |
| 6 处主脚本插入 verify 调用 | 1 天 |
| 重写 `verify_paper_md_was_written` | 0.2 天 |
| 单测 | 1 天 |
| 手工测试 + 修复 | 0.5 天 |
| **合计** | **5 天（≈ 1.5 周）** |