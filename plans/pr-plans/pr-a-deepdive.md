# PR-A — Deep Dive v1（浏览器侧长文精读）

> **状态**：✅ **已实现**（2026-07-21 核对：仓库已有完整实现，无需新增代码）
> **来源**：`plans/deepdive-feature.md`（已选 A：不写盘，仅浏览器内展示）
> **依赖**：无（与 Polaris 迁移的 7 个 PR 完全独立）
> **优先级**：高（用户已在 deepdive-feature.md 明确选定 A）
> **预估 LOC**：~350 行新增（绝大部分在 `paper-analyzer.ts`）—— **实际已完成**

---

## ⚠️ 状态变更说明

2026-07-21 开工时核对仓库现状，发现 Deep Dive v1 **已经在之前的 commit 中实施完毕**：

- `8a7382d` chore: speed-read + deep dive 2607.04425v1 via web analyzer
- `d002dd3` chore: speed-read + deep dive 2606.06087v1 via web analyzer
- `419e4e1` [feat] 长文精读 (Deep Dive) — body 大小防护 + 错误升级 + compact 模式 + 设置面板
- `64b0ec7` [feat] paper-analyzer 加两阶段 RAG 长文精读 — 骨架规划→本地 .txt 检索→主精读+末尾补丁

**现有实现位置**（与 PR-A plan 完全对应）：

| PR-A plan 要求 | 现有实现位置 |
|----------------|-------------|
| `MODEL_CONTEXT` 表 + `estimateContext` | [paper-analyzer.ts:1452](astro-src/scripts/paper-analyzer.ts#L1452), [:1478](astro-src/scripts/paper-analyzer.ts#L1478) |
| `estimatePdfTokens(chars)` | [paper-analyzer.ts:1492](astro-src/scripts/paper-analyzer.ts#L1492) |
| `fetchArxivPdf` + `%PDF` 字节校验 | [paper-analyzer.ts:1719-1725](astro-src/scripts/paper-analyzer.ts#L1719) |
| `extractPdfTextFromBuffer` | [paper-analyzer.ts:863](astro-src/scripts/paper-analyzer.ts#L863) |
| 截断 + compact 模式 | [paper-analyzer.ts:1740-1755](astro-src/scripts/paper-analyzer.ts#L1740) |
| `DEEPDIVE_SYSTEM_PROMPT` 8 章节 | [paper-analyzer.ts:1496-1545](astro-src/scripts/paper-analyzer.ts#L1496) |
| `runDeepDive` 串联 | [paper-analyzer.ts:1706](astro-src/scripts/paper-analyzer.ts#L1706) |
| 按钮 + handler | [paper-analyzer.ts:2584-2598](astro-src/scripts/paper-analyzer.ts#L2584) |
| 三档 context 处理 | [paper-analyzer.ts:2592-2597](astro-src/scripts/paper-analyzer.ts#L2592) |
| chunk + body 大小防护 | [paper-analyzer.ts:1566-1589](astro-src/scripts/paper-analyzer.ts#L1566) |
| 错误处理（含 WAF 检测） | [paper-analyzer.ts:1552-1641](astro-src/scripts/paper-analyzer.ts#L1552) |

**结论**：本 PR 不需要新增任何代码，仅需要把 `plans/deepdive-feature.md` 标记为「已实现」即可。后续 PR-3（Stage Router）+ PR-4（Prompt Pack）的对接点（`analyzer.system` / `analyzer.deepdive`）已在现有 `runDeepDive` 内预留。

---

## 1. 目标

让 paper-analyzer 速读流程跑完后，用户可以在浏览器内点一个按钮，对当前论文生成 8 章节中文长文精读。

**用户视角变化**：
- 速读卡片下方多一个 `📖 生成长文精读` 按钮
- 点击后阶段文案依次切换：`下载 PDF…` → `提取文本…` → `调用 LLM…` → `生成精读…`
- 结果以 `## 深度精读` 段追加到速读卡片下方，浏览器内展示，**不写入 GitHub**

**与现有流程的关系**：
- 速读流程（`SYSTEM_PROMPT` + `buildUserPrompt` + `callLLM`）完全不动
- 精读是**可选的、可重入的、不污染现有产物的**附加功能

---

## 2. 改动清单

### 新增 / 改动文件

| 文件 | 改动类型 | 备注 |
|------|---------|------|
| [astro-src/scripts/paper-analyzer.ts](astro-src/scripts/paper-analyzer.ts) | 大幅新增 | +~320 行（PDF 拉取 / 解析 / 截断 / 精读 prompt / runDeepDive / 按钮 handler） |
| [astro-src/pages/paper-analyzer.astro](astro-src/pages/paper-analyzer.astro) | 样式 | +~30 行 CSS（按钮 / status / output 容器） |
| [astro-src/lib/llm.ts](astro-src/lib/llm.ts) | **不改** | 复用 `callChatCompletion` / `callChatCompletionStream` |
| [src/4.llm_refine_papers.py](src/4.llm_refine_papers.py) | **不改** | 精读不走 Python 流水线 |
| [package.json](package.json) | 检查 | 确认 `pdfjs-dist@^4.10.38` 已存在（如缺则 +1 dep） |
| [edge-functions/cf-worker-proxy.ts](edge-functions/cf-worker-proxy.ts) | **不改** | 已有 103 行 CF Worker 模板，用户可选部署 |

### 精确代码插入点

| 新增内容 | 插入位置 | 行数 |
|---------|---------|------|
| `MODEL_CONTEXT` 表 + `estimateContext(model)` | `paper-analyzer.ts` `// 常量 / DOM 引用` 段（125-127 行附近） | +35 |
| `MAX_PDF_CHARS` 常量 + `truncatePdfForContext(text, maxChars)` | 同上段 | +20 |
| `fetchPdfBytes(pdfUrl): Promise<Uint8Array>` | CORS_PROXIES 段（193 行）之后 | +50 |
| `extractPdfText(bytes): Promise<string>` | 同上 | +60 |
| `DEEPDIVE_SYSTEM_PROMPT` (module-level const) | `SYSTEM_PROMPT` 段（1232 行）之后 | +60 |
| `buildDeepDivePrompt(r, pdfText, truncated, pct)` | `SYSTEM_PROMPT` 之后 | +25 |
| `runDeepDive(r, entry, statusCb)` | `renderResult` 函数（1067 行附近）之前 | +50 |
| 按钮 + handler（DOM 插入 + click listener） | `renderResult` 末尾 | +60 |
| `.analyzer-deepdive-btn` / `-status` / `-output` 样式 | `paper-analyzer.astro` `<style>` 块 | +30 |

---

## 3. JSON 数据形态（无）

**PR-A 不引入任何新的持久化数据形态**：
- 精读结果仅存活在浏览器 DOM 中（`deepdive-output` div）
- 不写 `archive/<date>/.checkpoints/`（PR-1 引入）
- 不写 frontmatter（精读不落盘）
- 不写 LLM usage JSONL（PR-3 引入）

**唯一状态**：浏览器内存里的 `lastDeepDiveResult: string | null`（在 `paper-analyzer.ts` module-level），用户刷新页面即丢弃。

---

## 4. 配置开关

**PR-A 不引入新的 `config.yaml` 字段**——精读按钮始终可用，仅靠 model context 自动判断按钮状态（见第 6 节）。

---

## 5. 测试方案

### 手工测试

| # | 场景 | 期望 |
|---|------|------|
| 1 | StarBench (2510.18483v1) 走精读按钮 | 8 章节中文长文渲染成功 |
| 2 | 切到 moonshot-v1-8k 模型（8K context） | 按钮禁用，提示「当前模型 context 太小，请切换到 64K+ 模型」 |
| 3 | 切到 deepseek-chat（64K context） | 按钮可用，hover 显示「将截断到约 30K token」 |
| 4 | 切到 MiniMax-M3（1M context） | 按钮可用，无截断提示（30 页 PDF 不触发） |
| 5 | codetabs proxy 挂掉，强制走 corsproxy.io | 自动切换，最终成功 |
| 6 | LLM API key 删掉后点按钮 | 显示「精读失败: ...」+ 重试按钮 |
| 7 | PDF 字符数 < 500 | 提示「PDF 可能是扫描版或加密，无法提取文本」 |

### 单测（暂不强求）

- `truncatePdfForContext` 纯函数 — 单元测试 5 个 case（短 / 刚好 / 截断 50% / 截断 10% / 空字符串）

### 验证用论文

- **正常 PDF**：[StarBench (2510.18483v1)](https://arxiv.org/abs/2510.18483) — 已有速读笔记，可对照
- **长 PDF**：30 页+ LLM 论文（arxiv 2606.x / 2607.x 任选）— 验证截断
- **边缘 case**：扫描版 PDF（GitHub 任一会议 poster）— 验证错误提示

---

## 6. 关键算法

### Model context 推断（**对齐 deepdive-feature.md §"MODEL_CONTEXT 查表更新"**）

```ts
const MODEL_CONTEXT: Record<string, number> = {
  // 用户当前实际使用（截图确认 2026-07-05）
  'MiniMax-M3': 1_000_000,

  // 仓库 PROVIDER_PRESETS 里的其他 model
  'MiniMax-Text-01': 1_000_000,
  'abab6.5s-chat': 32_000,
  'abab5.5-chat': 16_000,

  // 速读流程可能配的
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,
  'Qwen/Qwen2.5-7B-Instruct': 32_000,
  'Qwen/Qwen2.5-14B-Instruct': 32_000,
  'Qwen/Qwen2.5-32B-Instruct': 32_000,
  'Qwen/Qwen2.5-72B-Instruct': 32_000,
  'moonshot-v1-8k': 8_000,
  'moonshot-v1-32k': 32_000,
  'moonshot-v1-128k': 128_000,
  'glm-4-flash': 128_000,
  'glm-4-air': 128_000,
  'glm-4-plus': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4o': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-3.5-turbo': 16_000,
};

function estimateContext(model: string): number {
  if (MODEL_CONTEXT[model]) return MODEL_CONTEXT[model];
  const lower = model.toLowerCase();
  for (const k of Object.keys(MODEL_CONTEXT)) {
    if (lower.includes(k.toLowerCase())) return MODEL_CONTEXT[k];
  }
  return 32_000; // 保守兜底
}
```

### 三档 context 处理

| context | 按钮状态 | `MAX_PDF_CHARS` | 截断提示 |
|---------|---------|-----------------|---------|
| ≥ 128K | 可用 | `800_000`（≈ 270K token，MiniMax-M3 专用上限） | 无 |
| 64K-128K | 可用 + 标注「将截断到约 30K token」 | `100_000`（≈ 33K token，留 30K 给 prompt + output） | 显示 |
| ≤ 32K | **禁用** + 提示「请切换到 64K+ 模型」 | N/A | N/A |

### PDF 字节合法性检查

```ts
function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  // %PDF
}
```

### pdfjs-dist worker 配置

```ts
// 使用 CDN 固定版本(避免打包体积 + worker path 复杂度)
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
```

**备选**：本地 `pdfjs-dist/build/pdf.worker.min.mjs` 由 vite 自动打包（需要在 `vite.config.ts` 加 `optimizeDeps.exclude: ['pdfjs-dist']` 或类似配置）。**v1 选 CDN**，简单稳定。

---

## 7. 错误处理矩阵

| 失败点 | 检测方式 | 用户提示 |
|--------|---------|---------|
| 所有 CORS proxy 失败 | 5 个 proxy 遍历完无成功 | 「无法下载 PDF，请检查网络或配置自定义代理（推荐部署 Cloudflare Worker，见 README）」 |
| Proxy 返回 HTML 错误页 | 前 4 字节 ≠ `%PDF` | 「PDF 下载失败，proxy 可能返回了 HTML 错误页」 |
| PDF 文本 < 500 字符 | `extractPdfText` 返回长度检查 | 「PDF 可能是扫描版或加密，无法提取文本」 |
| LLM 调用 4xx/5xx | `callLLM` 抛异常 | 「精读失败: <error.message>」+ 重试按钮 |
| 用户 context 太小 | `estimateContext(model) ≤ 32K` | 按钮禁用，title 属性 + 旁边红字提示 |
| PDF 超 MAX_PDF_CHARS | `truncatePdfForContext` 返 `truncated: true` | 顶部加 `> ⚠️ 本次精读仅基于 PDF 前 X% 文本（超出上下文窗口已截断）` |
| 网络中断（fetch 30s 超时） | `AbortController` + `setTimeout` | 「下载超时，请重试」 |

---

## 8. 复用已有能力（避免重复造轮子）

| 已有组件 | 位置 | 复用方式 |
|---------|------|---------|
| `CORS_PROXIES` | [paper-analyzer.ts:169-193](astro-src/scripts/paper-analyzer.ts#L169) | 直接复用遍历逻辑，**但返回 `ArrayBuffer` 而非 `text`** |
| `callLLM` | `paper-analyzer.ts` 中段 | 直接复用 |
| `renderMarkdown(md)` | `paper-analyzer.ts` 中段 | 直接复用（精读输出也走 markdown 渲染） |
| `escapeHtml` | `paper-analyzer.ts` 工具函数段 | 错误提示文本需要 |
| `MODEL_CONTEXT` / `estimateContext` 思路 | deepdive-feature.md 已规划 | **完整复刻**（无新增设计空间） |

---

## 9. 与后续 PR 的接口

### PR-3（LLM Stage Routing）的接管点

PR-A 在 `paper-analyzer.ts:1496` 硬编码 `DEEPDIVE_SYSTEM_PROMPT` 是 module-level `const`。

PR-3 完成后，**PR-A 的精读调用应改为**：

```ts
// 未来形态(PR-3 完成后)
import { resolveRoute } from '../lib/llm';
const route = resolveRoute('analyzer.deepdive');
const md = await callChatCompletion({ ...route, system: DEEPDIVE_SYSTEM_PROMPT, user: prompt });
```

**PR-A 不预先埋这个接口**——保持代码最简，等 PR-3 时统一改造。

### PR-4（Prompt Pack）的接管点

PR-A 的 `DEEPDIVE_SYSTEM_PROMPT` 是 `const` 字面量。

PR-4 完成后，应改为：

```ts
// 未来形态(PR-4 完成后)
import { loadActivePack, injectIntoPrompt } from './prompt-pack';
const injected = injectIntoPrompt('analyzer.deepdive', DEEPDIVE_SYSTEM_PROMPT_DEFAULT);
```

**同样 PR-A 不预先埋**。

---

## 10. 风险与回滚

| 风险 | 严重度 | 缓解 | 回滚 |
|------|--------|------|------|
| 公共 CORS proxy 经常挂 | 高 | 推荐部署 CF Worker；按已知稳定顺序排（`same-origin → codetabs → corsproxy → allorigins → thingproxy`） | 用户在 `/settings/` 配置自定义 proxy |
| pdfjs-dist worker CDN 失效 | 低 | 固定版本号 `pdfjs-dist@4.10.38`（与 package.json 一致） | 切到本地打包（vite 配置） |
| 精读耗时 30s-2min，用户刷新页面 | 中 | 按钮 disabled 期间显示阶段文案；不实现 AbortController（v1 简化） | 浏览器原生「停止加载」 |
| LLM call 失败不重试 | 中 | 显示重试按钮（复用按钮的 disabled 切换） | 用户手动重试 |
| 精读 token 太贵 | 低 | 默认 MiniMax-M3 1M context 几乎不截断；其他模型按钮禁用 | 用户切回速读 |
| Proxy 透传二进制 PDF 字节破坏 | 中 | 前 4 字节 `%PDF` 校验；不通过则换 proxy | 错误提示 |

**通用回滚**：把 `runDeepDive` + 按钮 + 样式段注释掉（不影响速读流程）。

---

## 11. 配置示例（用户文档）

无新增 config 字段。但 README 需要更新一段：

```markdown
## Deep Dive 长文精读

每篇速读笔记下方有「📖 生成长文精读」按钮，点击后：

1. 下载 PDF（走 CORS proxy 链）
2. 提取全文（pdfjs-dist）
3. 调用 LLM 生成 8 章节中文长文
4. 浏览器内展示，**不写入 GitHub**

### Context 要求

精读对 model context 要求较高：

- ≥ 128K：完整 PDF（MiniMax-M3、gpt-4o-mini、glm-4-flash）
- 64K-128K：截断到前 ~30K token（deepseek-chat）
- ≤ 32K：按钮禁用（moonshot-v1-8k、Qwen-7B）

### 自定义 CORS proxy

公共 proxy 经常挂，推荐部署 [edge-functions/cf-worker-proxy.ts](edge-functions/cf-worker-proxy.ts)
（103 行 Cloudflare Worker，每天 100K 免费请求）。
```

---

## 12. 验收清单

- [ ] `fetchPdfBytes` 走完 5 个 proxy 后能拿到合法 PDF
- [ ] `extractPdfText` 产出 UTF-8 文本（非乱码）
- [ ] `truncatePdfForContext` 在超限时正确截断并计算 pct
- [ ] `MODEL_CONTEXT` 查表覆盖仓库 `PROVIDER_PRESETS` 的所有 model
- [ ] 三档 context 行为正确（按钮禁用 / 截断提示 / 完整）
- [ ] `DEEPDIVE_SYSTEM_PROMPT` 8 章节顺序稳定输出
- [ ] `runDeepDive` 阶段文案依次切换
- [ ] 错误路径 6 类全覆盖
- [ ] 不影响现有速读流程（点速读按钮仍然只产速读，不自动跑精读）
- [ ] `npm run build` 无报错
- [ ] 本地预览（`npm run dev`）无控制台报错
- [ ] StarBench 手工走通完整流程

---

## 13. Effort 估算

| 工作项 | 预估工时 |
|--------|---------|
| `fetchPdfBytes` + `extractPdfText` + proxy 链复用 | 0.5 天 |
| `truncatePdfForContext` + `MODEL_CONTEXT` 表 + `estimateContext` | 0.3 天 |
| `DEEPDIVE_SYSTEM_PROMPT` + `buildDeepDivePrompt` | 0.5 天 |
| `runDeepDive` 串联 + 阶段文案 | 0.3 天 |
| 按钮 + handler + DOM 插入 | 0.5 天 |
| 错误处理 6 类 | 0.5 天 |
| 样式 + 折叠交互 | 0.2 天 |
| 手工测试 + 修复 | 0.5 天 |
| **合计** | **3.3 天（≈ 1 周）** |