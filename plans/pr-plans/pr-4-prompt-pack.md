# PR-4 — Prompt Pack 1.0（可版本化 Prompt）

> **状态**：待开工
> **来源**：`plans/polaris-absorption.md` 能力 3（Skill 系统 → DPR Prompt Packs）
> **依赖**：PR-3（路由生效后，pack 才能被 route 到）
> **优先级**：中（默认 disabled，开了才有收益）
> **预估 LOC**：~800 行（`src/prompt_pack.py` + 4 个内置 pack + 5 处注入点 + Gist 同步 + 单测）

---

## 1. 目标

把所有 LLM prompt 从硬编码 module-level `const` 升级为可版本化的「Prompt Pack」。

**核心痛点**：
- [astro-src/scripts/paper-analyzer.ts:1176](astro-src/scripts/paper-analyzer.ts#L1176) `SYSTEM_PROMPT` 是 module-level `const`，改会议风格需 fork 代码
- [astro-src/scripts/paper-analyzer.ts:1496](astro-src/scripts/paper-analyzer.ts#L1496) `DEEPDIVE_SYSTEM_PROMPT` 同上
- [astro-src/scripts/topic-search.ts:92, 188, 240](astro-src/scripts/topic-search.ts#L92) 三处 prompt 同上
- [src/4.llm_refine_papers.py:352](src/4.llm_refine_papers.py#L352) Python prompt 同上

**解决方案**：仿照 Polaris [E:/study/Polaris/src/backend/app/services/skills.py](E:/study/Polaris/src/backend/app/services/skills.py) `SkillManifest` + `snapshot_for_project`，把 prompt 抽到 `config/prompts/<pack_id>/<version>/` 目录，每个 target 一个 pin。

---

## 2. 设计原则

1. **零破坏**：默认所有 `prompt_packs.active.<target>: null`——老硬编码 prompt 不动
2. **载体 = 目录**：每个 pack 是 `config/prompts/<pack_id>/<version>/` 目录（含 manifest + body + examples + output_contract）
3. **版本 = 日期字符串**（如 `2026-07-15`）而非 int
4. **24000 char 上限**（**对齐 Polaris `_TARGET_BUDGET_CHARS = 24000`** [skillset.py:40](E:/study/Polaris/src/backend/app/agents/voyage/skillset.py#L40)）
5. **Gist 同步 key**：`dpr_prompt_packs_v1`（**仿照 [astro-src/scripts/settings.ts:574](astro-src/scripts/settings.ts#L574) `GIST_FILENAME = 'dpr-config.json'` 模式**）
6. **Taxonomy 兼容**：`manifest.requires_taxonomies_version` 加载时校验

---

## 3. 改动清单

### 新增文件

| 文件 | 行数 | 用途 |
|------|------|------|
| [src/prompt_pack.py](src/prompt_pack.py) | ~150 | `load_active_pack(target, config)` + `inject_into_prompt(target, default, config)` |
| [config/prompts/_schemas/pack_manifest.schema.json](config/prompts/_schemas/pack_manifest.schema.json) | ~80 | JSON Schema 校验 manifest |
| [config/prompts/default/2026-07-01/manifest.json](config/prompts/default/2026-07-01/manifest.json) | ~30 | 默认 pack |
| [config/prompts/default/2026-07-01/body.md](config/prompts/default/2026-07-01/body.md) | ~50 | 默认 body（空，复用现有 const） |
| [config/prompts/nips-style/2026-07-15/manifest.json](config/prompts/nips-style/2026-07-15/manifest.json) | ~30 | NeurIPS 风格 |
| [config/prompts/nips-style/2026-07-15/body.md](config/prompts/nips-style/2026-07-15/body.md) | ~50 | NeurIPS 风格 body |
| [config/prompts/acl-style/2026-07-15/manifest.json](config/prompts/acl-style/2026-07-15/manifest.json) | ~30 | ACL 风格 |
| [config/prompts/acl-style/2026-07-15/body.md](config/prompts/acl-style/2026-07-15/body.md) | ~50 | ACL 风格 body |
| [config/prompts/deepdive-v2/2026-07-10/manifest.json](config/prompts/deepdive-v2/2026-07-10/manifest.json) | ~30 | 精读 v2 |
| [config/prompts/deepdive-v2/2026-07-10/body.md](config/prompts/deepdive-v2/2026-07-10/body.md) | ~50 | 精读 v2 body |
| [tests/test_prompt_pack.py](tests/test_prompt_pack.py) | ~120 | 单测：加载 / 注入 / 截断 / Taxonomy 校验 |

### 改动文件

| 文件 | 改动 |
|------|------|
| [src/0.enrich_config_queries.py:22-73](src/0.enrich_config_queries.py#L22) | 3 处 prompt 改为 `inject_into_prompt("enrich", DEFAULT_PROMPT, config)` |
| [src/4.llm_refine_papers.py:352](src/4.llm_refine_papers.py#L352) | system_prompt 改为 `inject_into_prompt("refine", DEFAULT_PROMPT, config)` |
| [src/5.select_papers.py](src/5.select_papers.py) | 若有 LLM call，注入 `"select"` target |
| [src/6.generate_docs.py](src/6.generate_docs.py) | 若有 LLM call，注入 `"doc.generate"` target |
| [astro-src/scripts/paper-analyzer.ts:1176](astro-src/scripts/paper-analyzer.ts#L1176) | `SYSTEM_PROMPT` 改为 `injectIntoPrompt("analyzer.system", DEFAULT, config)` |
| [astro-src/scripts/paper-analyzer.ts:1496](astro-src/scripts/paper-analyzer.ts#L1496) | `DEEPDIVE_SYSTEM_PROMPT` 改为 `injectIntoPrompt("analyzer.deepdive", DEFAULT, config)` |
| [astro-src/scripts/topic-search.ts:92, 188, 240](astro-src/scripts/topic-search.ts#L92) | 三处 prompt 改为 `injectIntoPrompt("topic.facet"/"topic.cand"/"topic.explore", DEFAULT, config)` |
| `astro-src/scripts/topic-search.ts` 内的 `TOPIC_REPORT_SYSTEM` / `summarizeOne` | 注入 `"topic.report"` / `"topic.summary"` |
| [astro-src/scripts/settings.ts:574](astro-src/scripts/settings.ts#L574) `GIST_FILENAME` | Gist 同步加 `dpr_prompt_packs_v1` key |
| [config/config.yaml](config/config.yaml) | 新增 `prompt_packs:` 块 |

---

## 4. Pack 目录结构

```
config/prompts/
├── _schemas/
│   └── pack_manifest.schema.json        # JSON Schema
├── default/
│   └── 2026-07-01/
│       ├── manifest.json
│       └── body.md                       # 空（复用默认 const）
├── nips-style/
│   └── 2026-07-15/
│       ├── manifest.json
│       ├── body.md                       # NeurIPS 风格额外指令
│       └── examples.jsonl                # 可选 few-shot 示例
├── acl-style/
│   └── 2026-07-15/
│       ├── manifest.json
│       └── body.md
└── deepdive-v2/
    └── 2026-07-10/
        ├── manifest.json
        └── body.md
```

---

## 5. Manifest JSON 样例（`nips-style/2026-07-15/manifest.json`）

**严格对齐 Polaris `SkillManifest` schema**（[app/schemas/skill.py](E:/study/Polaris/src/backend/app/schemas/skill.py)）：

```json
{
  "pack_id": "nips-style",
  "version": "2026-07-15",
  "display_name": "NeurIPS 风格中文速读",
  "kind": "guidance",
  "targets": ["refine", "select", "doc.generate", "analyzer.system"],
  "body_file": "body.md",
  "examples_file": "examples.jsonl",
  "output_contract": "schemas/nips_skim_record.schema.json",
  "personas": null,
  "steps": null,
  "config": {
    "citation_style": "numbered",
    "max_chars": 2000,
    "taxonomies_version": "2026-07-01"
  },
  "requires_taxonomies_version": "2026-07-01",
  "metadata": {
    "author": "maintainer",
    "created_at": "2026-07-15T00:00:00Z",
    "tags": ["neurips", "english-source", "cv"],
    "rating": 4.7
  }
}
```

---

## 6. body.md 样例（`nips-style/2026-07-15/body.md` 节选）

```markdown
# NeurIPS 风格中文速读 Prompt 增量

## 角色
你是 NeurIPS 评审，熟悉 ML/AI 领域术语，输出面向中文 ML 研究者。

## 强制字段
- tldr: 中文 150-220 字
- motivation: 30-70 字
- method: 30-70 字，含核心方法名（保留英文）
- result: 30-70 字，含 SOTA 数字（与 abstract 数字一致）
- conclusion: 30-70 字
- categories.venue: ["neurips"] 或 ["arxiv"]
- categories.task: 从 taxonomies 选（src/taxonomy.py:20-22 allowlist）

## 反模式
- 不要写"本文提出了一种新方法"（废话）
- 不要复述 abstract 原文
- 不要给出 abstract 没提到的 SOTA 数字
```

---

## 7. 加载 + 注入实现（`src/prompt_pack.py`）

```python
TARGET_BUDGET_CHARS = 24000  # 对齐 Polaris _TARGET_BUDGET_CHARS

def load_active_pack(target: str, config: dict) -> "Pack | None":
    """从 config.prompt_packs.active[target] 找到 pack_id + version，载入。"""
    pin = config.get(f"prompt_packs.active.{target}")
    if not pin:
        return None  # 走默认 hardcoded
    pack_id, version = pin.split(":")
    return Pack.load(f"config/prompts/{pack_id}/{version}/")

def inject_into_prompt(prompt: str, target: str, config: dict) -> str:
    """把 pack.body 拼到 prompt 前面；超 24000 char 截断。"""
    pack = load_active_pack(target, config)
    if pack is None:
        return prompt
    injected = f"{pack.body}\n\n---\n\n{prompt}"
    if len(injected) > TARGET_BUDGET_CHARS:
        injected = injected[:TARGET_BUDGET_CHARS - 50] + "\n\n... [truncated to 24000 chars]"
    return injected

class Pack:
    def __init__(self, manifest: dict, body: str):
        self.manifest = manifest
        self.body = body
        # ... 校验 requires_taxonomies_version

    @classmethod
    def load(cls, dir_path: str) -> "Pack":
        manifest = json.loads(Path(f"{dir_path}/manifest.json").read_text())
        body = Path(f"{dir_path}/{manifest['body_file']}").read_text()
        return cls(manifest, body)
```

---

## 8. 浏览器侧（`astro-src/scripts/prompt-pack.ts` 新增）

```ts
const TARGET_BUDGET_CHARS = 24000;

interface PackManifest {
  pack_id: string;
  version: string;
  targets: string[];
  body_file: string;
  output_contract?: string;
  requires_taxonomies_version?: string;
}

export async function injectIntoPrompt(
  prompt: string,
  target: string,
  config: { prompt_packs?: { active?: Record<string, string> } }
): Promise<string> {
  const pin = config.prompt_packs?.active?.[target];
  if (!pin) return prompt;
  const [packId, version] = pin.split(':');
  // 从 public/prompts/<packId>/<version>/body.md 加载
  const bodyUrl = `${import.meta.env.BASE_URL || '/'}prompts/${packId}/${version}/body.md`;
  const res = await fetch(bodyUrl);
  if (!res.ok) return prompt;
  const body = await res.text();
  const injected = `${body}\n\n---\n\n${prompt}`;
  if (injected.length > TARGET_BUDGET_CHARS) {
    return injected.slice(0, TARGET_BUDGET_CHARS - 50) + '\n\n... [truncated to 24000 chars]';
  }
  return injected;
}
```

**`astro.config.mjs` 调整**：`public/prompts/` 自动复制到 dist（Vite 默认行为）。

---

## 9. 配置示例（`config/config.yaml` 新增）

```yaml
prompt_packs:
  active:
    enrich: "default:2026-07-01"
    refine: "nips-style:2026-07-15"
    select: "default:2026-07-01"
    doc.generate: "nips-style:2026-07-15"
    analyzer.system: "nips-style:2026-07-15"
    analyzer.deepdive: "deepdive-v2:2026-07-10"
    topic.facet: "default:2026-07-01"
    topic.cand: "default:2026-07-01"
    topic.explore: "default:2026-07-01"
    topic.summary: "default:2026-07-01"
    topic.report: "default:2026-07-01"
  builtin_packs:
    - "default"
    - "nips-style"
    - "acl-style"
    - "deepdive-v2"
  kind_compat:
    "nips-style": "guidance"
    "acl-style": "guidance"
    "deepdive-v2": "guidance"
    "default": "guidance"
```

**回滚**：`prompt_packs.active.<target>: null` 即回退 hardcoded 默认。

---

## 10. Gist 同步（**复用 settings.ts:399 pushHiddenPapersToGist + settings.ts:574 GIST_FILENAME 模式**）

新增 Gist key `dpr_prompt_packs_v1`：

```json
{
  "dpr_analyzer_v1": { ... },               // 现有
  "dpr_analyzer_provider_v1": { ... },      // 现有
  "dpr_prompt_packs_v1": {                  // 新增
    "active": {
      "refine": "nips-style:2026-07-15",
      "analyzer.deepdive": "deepdive-v2:2026-07-10"
    }
  }
}
```

**sync 逻辑**（`astro-src/scripts/settings.ts` 增量）：
- 浏览器侧：用户改 prompt pack pin → 写 `dpr_prompt_packs_v1` → push 到 Gist
- Python 后端：cron 启动时读 Gist（如有 GIST_TOKEN）→ 写 `config.prompt_packs.active` 到 `config.user.yaml` overlay

**v1 简化**：仅浏览器侧 Gist 同步，Python 后端走 `config.user.yaml` 静态配置。

---

## 11. 与 Polaris 的差异

| 维度 | Polaris | DPR PR-4 |
|------|---------|----------|
| Skill 存储 | Postgres `skill_versions` 表 | **git 目录**（每 pack 一目录，含 immutable version 子目录） |
| 版本号 | int（`skill.version`） | **日期字符串 `YYYY-MM-DD`** |
| SkillMarketplace | `skill_listings` + `skill_ratings` | **不引入**（metadata.rating 仅信息） |
| Workflow Skill | `Navigator.steps` 注入 | **`config/prompts/<name>/<version>/steps.json`**，PR-6 用 |
| `_TARGET_BUDGET_CHARS = 24000` | 是 | **完整复刻** |
| `skill_output_contract` | 动态注入 | **manifest.output_contract + JSON Schema 文件** |
| Taxonomy 兼容 | 无 | **`manifest.requires_taxonomies_version` 加载时校验** |
| `stack.<target>` 多 pack 拼接 | 不支持 | **v2 才支持**（v1 仅单 pin） |

---

## 12. 测试方案

### 单测（`tests/test_prompt_pack.py`）

| # | 用例 | 期望 |
|---|------|------|
| 1 | `load_active_pack("refine", {})` | None（active null） |
| 2 | `load_active_pack("refine", {prompt_packs.active.refine: "nips-style:2026-07-15"})` | 返 Pack 实例 |
| 3 | `inject_into_prompt("default", config)` | 直接返原 prompt（pin null） |
| 4 | `inject_into_prompt("refine", config)` | 返 `body + "\n\n---\n\n" + prompt` |
| 5 | 超 24000 char 截断 | 加 `... [truncated to 24000 chars]` |
| 6 | Taxonomy version 不匹配 | 抛 `ValueError`（加载时校验） |
| 7 | manifest 缺 `targets` | 抛 `ValueError`（schema 校验） |
| 8 | Gist key `dpr_prompt_packs_v1` 同步 | 与 `dpr-config.json` 同文件不同 ns |

### 手工测试

| # | 场景 | 期望 |
|---|------|------|
| 1 | 所有 `prompt_packs.active` null | 行为完全等同 PR-4 前（hardcoded prompt） |
| 2 | 配 `analyzer.system: nips-style:2026-07-15`，跑速读 | 输出带 NeurIPS 风格额外指令 |
| 3 | 配 `analyzer.deepdive: deepdive-v2:2026-07-10`，跑精读 | 8 章节更详细 |
| 4 | 浏览器侧 `/settings` 改 pack pin | Gist 同步，下次加载读到 |
| 5 | Taxonomy 升级到 `2026-07-15`，老 pack `requires_taxonomies_version: 2026-07-01` | 加载时报错 `requires_taxonomies_version mismatch` |
| 6 | pack body 引用不存在的概念词 | manifest 加载通过（运行时才发现） |

---

## 13. 风险与回滚

| 风险 | 严重度 | 缓解 | 回滚 |
|------|--------|------|------|
| 用户随便写 pack 污染 prompt | 中 | `pack_manifest.schema.json` + CI lint（`python -m prompt_pack.lint_all`） | `active.<target>: null` |
| Pack body 引用不存在 taxonomy 词汇 | 中 | `requires_taxonomies_version` 校验 | 同上 |
| Gist 同步冲突 | 低 | `dpr_prompt_packs_v1` 独立 ns | N/A |
| 多 pack 注入同一 target | 低 | `active.<target>` 单 pin（v2 加 stack） | N/A |
| 5 处硬编码替换漏一处 | 中 | **单测 + 手工测试** + 字段统一表（见第 3 节） | grep 旧 const |

**通用回滚**：所有 `active.<target>: null`，老硬编码 prompt 不动。

---

## 14. 验收清单

- [ ] `src/prompt_pack.py` + 4 个内置 pack 目录全部存在
- [ ] `pack_manifest.schema.json` 校验 4 个 manifest 全过
- [ ] 单测 8 个 case 全过
- [ ] 默认 `prompt_packs.active` 全 null 时行为完全等同 PR-4 前
- [ ] 配 `nips-style:2026-07-15` 后速读输出含 NeurIPS 风格指令
- [ ] 配 `deepdive-v2:2026-07-10` 后精读输出 8 章节更详细
- [ ] Taxonomy 版本不匹配时报错
- [ ] Gist key `dpr_prompt_packs_v1` 同步正常
- [ ] **5 处硬编码替换无遗漏**（详见第 3 节字段统一表）

---

## 15. Effort 估算

| 工作项 | 预估工时 |
|--------|---------|
| `src/prompt_pack.py` | 1 天 |
| 4 个内置 pack × 2 文件 | 1 天 |
| `pack_manifest.schema.json` + `_schemas` | 0.3 天 |
| Python 5 处替换（[src/0.enrich_config_queries.py](src/0.enrich_config_queries.py), [src/4.llm_refine_papers.py](src/4.llm_refine_papers.py), [src/5.select_papers.py](src/5.select_papers.py), [src/6.generate_docs.py](src/6.generate_docs.py)） | 1 天 |
| TS 5 处替换（[paper-analyzer.ts](astro-src/scripts/paper-analyzer.ts) 2 处 + [topic-search.ts](astro-src/scripts/topic-search.ts) 3 处） | 1 天 |
| `astro-src/scripts/prompt-pack.ts` 浏览器侧 | 0.5 天 |
| Gist 同步 `dpr_prompt_packs_v1` | 0.5 天 |
| `config/config.yaml` 新增 `prompt_packs` 块 | 0.1 天 |
| 单测 | 0.5 天 |
| 手工测试 + 修复 | 0.5 天 |
| **合计** | **6.4 天（≈ 1.5-2 周）** |