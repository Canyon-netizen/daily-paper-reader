# TODO: 之后继续应该完成的工作

> 2026-08-08 维护
> 当下状态:`main` @ `5428a6bf`,522/624 论文带 5 节中文解读,build 绿。
> 这份文档列出本会话发现/遗留的下一步工作,按优先级和分类组织。

---

## 🔴 高优先级(影响日常使用)

### 1. `translate_parallel` 去重 bug

**状态**: ❌ 仍待解决

**问题**:Pipeline 在不同日期目录复制同一篇论文多次(07/29、07/30、07/31、08/02、08/03),脚本只处理第一个匹配,导致**最新版未翻译,而旧版已翻译**。

**修法**:按 canonical arxiv id(去版本号)去重,只翻译每个 id 的最新一份(日期最新者)。

### 2. `extractWikiArticle` 旧标题兼容性

**状态**: 🔄 部分完成

**问题**:检查逻辑已覆盖 `## 讨论与可借鉴点` 和 `## 结论`,但旧版用的 `## TLDR` / `## 动机` 未加入 check(只有注释提到)。

**修法**:补上:
```python
if not args.force and ("## 讨论与可借鉴点" in (body or "")
                      or "## 结论" in (body or "")
                      or "## TLDR" in (body or "")
                      or "## 动机" in (body or "")):
```

### 3. Paper.wikiContent 流水线尾部预热

**状态**: ❌ 仍待解决

**问题**:新论文 build 前,右侧详情面板 wikiContent 为空。需 build 预热或客户端 fallback。

---

## 🟡 中优先级(影响工作流完整性)

### 4. Ingest 论文 metadata 完善

**状态**: ❌ 仍待解决

**问题**:library-ingest.ts 拉新论文只填 score,缺 `tldr`/`evidence`/`tags`。

**修法**:在 LLM 打分 step 后,追加一个 step 生成 tldr/evidence/tags 并写入 frontmatter。

### 5. bun run check 清理

**状态**: 🔄 部分完成

**问题**:57 个 pre-existing type 错误。建议短期加 `// @ts-expect-error`,长期重构。

---

## 🟢 低优先级(渐进增强)

### 6. Polaris 能力对照表(还未 ship 的)

| 能力 | DPR 状态 | 实现难度 |
|---|---|---|
| 公共库 chat tab | 中 | - |
| Digest 自动 cron | LLM 已在,缺调度 | 中 |
| 库 budget(token 配额) | 静态站不需要 | - |
| Per-paper relevance 详细 reason | 已 ship | - |
| Library visibility admin approval | 单人站无 admin | - |
| `getStaticPaths` vN 版本去重 | **已 ship**(`canonicalArxivId`) | - |
| Polariscitation figures/formulas 共享 | 各自存,浪费空间 | 高 |
| LLM `prompt-pack.ts` 的 `library.compile` 包 | | - |

### 7. ConceptRelink 跨库合并 UI

**状态**: ❌ 仍待解决

**问题**:已有 `LibraryConceptOverride.canonicalSlug` 字段,没接 UI。「🔗 合并到」按钮。

### 8. Pre-built search index 兼容老 SCORE 格式

**状态**: ✅ 已完成(细节见下方「Polaris 吸收批次」)

---

## 📋 立即可做的清理(无功能影响)

### 9. 删除 dead code

**状态**: 🔄 部分完成

- ✅ `call_one` 死代码已删(细节见下方「Polaris 吸收批次」)
- ⚠️ `translate_polaris.py` 旧 skip 块需检查

### 10. 测试覆盖

**状态**: 📋 待添加

- `src/translate_polaris.py` 完全没单元测试
- `src/translate_parallel.py` 也没
- `src/paper.ts:extractWikiArticle` 刚加的,没测

---

## 🔗 已完成的里程碑(2026-08)

### Daily Pipeline 自动化
- ✅ translate_parallel 自动 hook (commit 4d711ca3)

### Polaris 吸收批次 (2026-08-06)
- ✅ score 量纲归一 0-1 (commit 1ceab8bc)
- ✅ 存量 121/221 个 YAML ScannerError 修复 (commit 160f11ae)
- ✅ relink UI / 重复检测 / LLM 用量预算 (commit 2998501d)
- ✅ call_one 死代码删除 (commit a44b3118)

### 5 节翻译覆盖率
- ✅ 522/624 论文带 5 节中文解读(尚有 102 篇待补)

### 其他
- ✅ extractWikiArticleStrict 5 节齐全校验 (commit 963a8fea)
- ✅ per-library relevanceThreshold (commit e7842dfc)

---

## 🎯 验收标准

1. `bun run build` 绿 (~20s)
2. 右侧详情面板就地显示 5 节中文解读
3. `/papers/` 默认按相关度排序
4. 公共库/个人库路径都 work

---

## 📞 关键文件索引

| 文件 | 作用 |
|---|---|
| `src/translate_polaris.py` | LLM 翻译(单文件, ThreadPoolExecutor) |
| `src/translate_parallel.py` | LLM 翻译(asyncio + run_in_executor, 8 并发) |
| `src/paper-frontmatter/parse.ts` | `extractWikiArticle` 抽 5 节段 |
| `astro-src/lib/paper.ts` | `Paper.wikiContent` / `PaperListItem.wikiContent` 字段 |
| `astro-src/lib/user-libraries/types.ts` | `LibraryDefinition` / `LibraryPaperMeta` |
| `astro-src/scripts/library-ingest.ts` | Ingest:arXiv listing + LLM 评分 |
| `astro-src/scripts/user-libraries-ui.ts` | 渲染个人库详情面板 |
| `.env` | `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` |
