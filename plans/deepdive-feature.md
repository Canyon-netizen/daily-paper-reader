# 长文精读（Deep Dive）功能实现方案

## 背景

用户已经用 paper-analyzer 的"速读"流程生成了大量 `docs/<period>/<arxiv>-<slug>.md`，但每篇只有 TLDR + Abstract + 动机/方法/结果/结论 六段，约 500-800 字中文。用户要求：

1. **深度精读**：基于论文全文（PDF），生成 8 章节的中文长文解读（含公式/图表解读、limitations、related work 定位）。
2. **追加到现有文件**：不动现有速读内容，精读以新章节形式追加到 markdown body 末尾。
3. **PDF 全文**：浏览器侧拉 arXiv PDF（走 CORS proxy 链），用 pdfjs-dist 解析。
4. **手动触发**：每篇一个独立按钮，按下后阶段式提示"下载 PDF → 提取文本 → 调用 LLM → 生成精读"。
5. **超限截断 + 提示**：PDF token 超 LLM 上下文 80% 时截断，并在页面提示"仅精读了前 X%"。

## 核心约束（必须遵守）

- **PDF 不开放 CORS**：浏览器 fetch `arxiv.org/pdf/...` 必然挂，必须走 proxy 链（已有 `CORS_PROXIES` 在 [paper-analyzer.ts:81-90](astro-src/scripts/paper-analyzer.ts#L81)）。
- **LLM 上下文**：用户选"全文精读"；按主流模型 128K context，PDF 限 100K token（约 50 万字符），超此阈值才截断。设 `MAX_PDF_CHARS = 200_000`（约 60K-80K token，留余量给 prompt + output）。
- **save-to-GitHub 流程不变**：速读笔记走 `buildMarkdownNote` + `saveToGitHub` 落盘；精读不参与 GitHub 同步（用户场景是在浏览器里看完就走，不存盘）。
- **不污染速读体验**：精读是可选操作，UI 上独立按钮，不自动跑。

## 长文本处理的现状（速读流程不需要担心）

速读流程在 [paper-analyzer.ts:856-864](astro-src/scripts/paper-analyzer.ts#L856) 喂给 LLM 的内容：

```ts
{ title, abstract: abstract || '(无 abstract...)', body_excerpt: body.slice(0, 8000) }
```

- title：几十字符
- abstract：~1500 字符（arxiv XML summary）
- body_excerpt：**硬编码前 8000 字符**（line 859 `.slice(0, 8000)`）
- 合计 ≤ 10K token，**任何主流模型都装得下**，从来不需要截断

速读输出也限制得很死：tldr 150-220 字 / motivation 30-70 字 / 其他字段 30-70 字，整个 JSON 输出 ≤ 2K token。

**精读是第一次遇到"长文本"问题**：
- 输入：PDF 全文 30K-80K token（首次超过单次 context 上限）
- 输出：8 章节中文长文 ≈ 8-10K token
- 合计 40K-100K token
- 128K context 模型勉强装下，64K 直接爆
- → 必须有截断策略

这条信息决定了 plan 里 `MAX_PDF_CHARS = 200_000` 的取值：留出余量给 prompt（~2K）+ 输出（~10K），PDF 输入 ≤ ~80K token，给 128K context 模型足够喘息空间。

## 默认 provider 的现实约束（必须正视）

`astro-src/scripts/settings.ts:103-106`：

```ts
export const LLM_DEFAULTS = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',  // 64K context
};
```

其他 provider 预设的 context 差异巨大：

| Provider | 默认 model | Context |
|---|---|---|
| deepseek | deepseek-chat | **64K** |
| siliconflow | Qwen2.5-7B-Instruct | 32K |
| moonshot | moonshot-v1-8k | **8K**（精读基本跑不起来） |
| zhipu | glm-4-flash | 128K |
| minimax | MiniMax-Text-01 | **1M** |
| openai | gpt-4o-mini | 128K |

**精读对 context 的要求比速读高一个数量级**。如果用户配的是 moonshot 8K 或 siliconflow 32K，精读要么截断得很惨，要么完全跑不起来。

### 应对策略（v1 必做）

1. **精读按钮按下前**：根据用户当前 model 推断 context window，估算 PDF 占用比例
2. **三种处理**：
   - context ≥ 128K（minimax/openai/zhipu）：走完整 `MAX_PDF_CHARS = 200_000`
   - context 64K（deepseek 默认）：调小到 `MAX_PDF_CHARS = 100_000`，**按钮旁标注"将截断到约 30K token"**
   - context ≤ 32K（siliconflow/moonshot）：**禁用按钮**，提示"当前模型 context 太小，请切换到 64K+ 模型"
3. **不要静默截断**：用户必须知道发生了截断，截断比例也要明示

### model → context 推断表

不调用 `/v1/models` 拿元数据（那个 API 不一定返回 context），改用预设表 + 用户自定义时给个保守值：

```ts
const MODEL_CONTEXT: Record<string, number> = {
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,
  'Qwen/Qwen2.5-7B-Instruct': 32_000,
  'Qwen/Qwen2.5-72B-Instruct': 32_000,
  'moonshot-v1-8k': 8_000,
  'moonshot-v1-32k': 32_000,
  'moonshot-v1-128k': 128_000,
  'glm-4-flash': 128_000,
  'MiniMax-Text-01': 1_000_000,
  'gpt-4o-mini': 128_000,
  'gpt-4o': 128_000,
};

function estimateContext(model: string): number {
  // 精确匹配 → 模糊包含 → 兜底 32K
  if (MODEL_CONTEXT[model]) return MODEL_CONTEXT[model];
  const lower = model.toLowerCase();
  for (const [k, v] of Object.entries(MODEL_CONTEXT)) {
    if (lower.includes(k.toLowerCase())) return v;
  }
  return 32_000; // 保守兜底
}
```

### PDF 字符数 → token 估算

粗略按 **3 字符 = 1 token**（中英文混排典型值）：

```ts
function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3);
}
```

PDF 字符数 200K ≈ 67K token → 装不进 64K DeepSeek context → 截断到 100K 字符（≈33K token），prompt+output 各 10K → 总 53K → DeepSeek 64K 装得下。

### 用户实际配置澄清（2026-07-05，用户已确认截图）

用户 settings 截图显示（`localhost:4321/settings/`）：

| 字段 | 值 |
|---|---|
| API 提供商 | MiniMax（预设） |
| API KEY | 已填（localStorage） |
| Base URL | `https://api.minimaxi.com`（末尾不带 `/v1`，由代码自动补全） |
| Model | **`MiniMax-M3`**（手动模式输入，覆盖了预设的 `MiniMax-Text-01`） |

**关键事实**：

- `MiniMax-M3` 是 MiniMax 公司发布的实际 model 名（与 Claude Code 自身的 model 名一致 — 这次会话 system prompt 里也写明是 `MiniMax-M3`）
- 用户上下文确认 context **1M token**
- base URL 处理：代码在 [paper-analyzer.ts:320](astro-src/scripts/paper-analyzer.ts#L320) 和 [line 874](astro-src/scripts/paper-analyzer.ts#L874) 都做了 `${baseUrl.replace(/\/+$/, '')}/v1/...`，所以用户末尾不写 `/v1` 完全兼容
- `MiniMax-M3` **不在仓库预设列表里**（预设只有 `MiniMax-Text-01`），但用户已手动覆盖，不影响功能

### MODEL_CONTEXT 查表更新

精读按钮按下前需要查 context，规则：

```ts
const MODEL_CONTEXT: Record<string, number> = {
  // 用户当前实际使用（截图确认）
  'MiniMax-M3': 1_000_000,

  // 仓库 PROdDER_PRESETS 里的其他 model
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

### 用户场景下的精读可用性

用户 MiniMax-M3 = 1M context：

- PDF 全文上限：`MAX_PDF_CHARS = 800_000`（≈ 270K token，留 700K 余量给 prompt + output + thinking）
- 30-50 页 PDF 字符数 100K-200K → **完全不截断**
- 100 页+ PDF 字符数 300K-500K → **仍不截断**
- **几乎所有 arxiv 论文都不会触发截断提示**

用户体验：精读按钮按下后，不会看到"已截断到 X%"的警告，PDF 全文都会进 LLM context。

## 改动范围

### 文件：`astro-src/scripts/paper-analyzer.ts`

新增/改动如下，全部 in-browser：

#### 1. PDF 拉取与解析（新增 ~80 行）

```ts
// 位置:const CORS_PROXIES 下方

async function fetchPdfBytes(pdfUrl: string): Promise<Uint8Array> {
  // 复用 CORS_PROXIES,逐个尝试,二进制透传
  // 注意:codetabs / allorigins / corsproxy.io 对二进制 PDF 透传能力各异
  // 优先顺序:codetabs → corsproxy.io → allorigins(raw) → thingproxy
  // 检测是否真 PDF:前 4 字节 = %PDF (0x25 0x50 0x44 0x46)
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // 用 pdfjs-dist (已在 deps: pdfjs-dist@^4.10.38)
  // 懒加载 import('pdfjs-dist/build/pdf.mjs') - 注意 worker 配置
  // 输出按页拼接,段落间用 \n\n 分隔
  // 设 workerSrc 为 cdn(避免本地打包):cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs
  // 或在 settings.local.json 已有 script 引入 worker
}
```

#### 2. Token 截断（新增 ~25 行）

```ts
function truncatePdfForContext(text: string, maxChars = 200_000): {
  text: string;
  truncated: boolean;
  pct: number;
} {
  if (text.length <= maxChars) return { text, truncated: false, pct: 100 };
  return {
    text: text.slice(0, maxChars),
    truncated: true,
    pct: Math.round((maxChars / text.length) * 100),
  };
}
```

#### 3. 精读 prompt（新增 ~60 行常量）

```ts
const DEEPDIVE_SYSTEM_PROMPT = `你是一位严谨的论文精读助手。基于论文全文生成中文长文解读。要求:
- 公式用 $LaTeX$ 或 $$...$$ 表达,关键公式后用一句中文解释变量含义
- 图表用 markdown 表格或要点还原,不要假装看到图
- 专业术语首次出现给中英对照
- 引用论文保持英文原名
- 不确定的内容明确写"原文未明确说明"`;

function buildDeepDivePrompt(r: AnalysisResult, pdfText: string, truncated: boolean): string {
  // 8 个章节标题固定:
  // ## 一、全文翻译(节选)
  // ## 二、研究背景与动机
  // ## 三、方法详解
  //   ### 3.1 整体框架
  //   ### 3.2 关键模块
  //   ### 3.3 关键公式解读
  //   ### 3.4 图表解读
  // ## 四、实验设置与结果
  //   ### 4.1 数据集与基线
  //   ### 4.2 主要结果
  //   ### 4.3 消融实验
  // ## 五、Related Work 与本文定位
  // ## 六、优点与局限性
  // ## 七、复现要点
  // ## 八、适用场景与延伸思考
  // 同时把速读字段(motivation/method/result/conclusion)作为参考一并塞入,
  // 防止 LLM 完全偏离主题。
  // truncated 时在 prompt 末尾追加 "注意:PDF 已截断到前 X%,请基于已有内容推断剩余部分并标注"。
}
```

#### 4. LLM 调用 + Markdown 拼接（新增 ~50 行）

```ts
async function runDeepDive(r: AnalysisResult, entry: ArxivEntry, statusCb: (stage: string) => void): Promise<string> {
  statusCb('下载 PDF...');
  const pdfUrl = entry.pdfUrl || `https://arxiv.org/pdf/${entry.arxivId}`;
  const bytes = await fetchPdfBytes(pdfUrl);
  statusCb('提取文本...');
  const raw = await extractPdfText(bytes);
  statusCb('准备 prompt...');
  const { text: pdfText, truncated, pct } = truncatePdfForContext(raw);
  const prompt = buildDeepDivePrompt(r, pdfText, truncated);
  statusCb('调用 LLM...');
  const md = await callLLM(DEEPDIVE_SYSTEM_PROMPT, prompt); // callLLM 已存在
  statusCb('生成精读...');
  const truncateNotice = truncated
    ? `\n\n> ⚠️ 本次精读仅基于 PDF 前 **${pct}%** 文本(超出上下文窗口已截断)\n`
    : '';
  return `## 深度精读\n${truncateNotice}${md.trim()}\n`;
}
```

#### 5. UI: 按钮 + 阶段文案 + 结果展示（新增 ~60 行）

在 `renderResult` 函数 ([paper-analyzer.ts:1067-1118](astro-src/scripts/paper-analyzer.ts#L1067) 附近) 给结果卡片追加：

```html
<button id="deepdive-btn" class="analyzer-deepdive-btn">📖 生成长文精读</button>
<div id="deepdive-status" class="analyzer-deepdive-status" hidden></div>
<div id="deepdive-output" class="analyzer-deepdive-output" hidden></div>
```

按钮 click handler：

```ts
const btn = $<HTMLButtonElement>('deepdive-btn');
const status = $('deepdive-status');
const output = $('deepdive-output');
btn.addEventListener('click', async () => {
  btn.disabled = true;
  status.hidden = false;
  output.hidden = true;
  try {
    const md = await runDeepDive(r, entry, (stage) => {
      status.textContent = stage;
    });
    output.hidden = false;
    output.innerHTML = renderMarkdown(md); // 复用现有 markdown 渲染
    status.textContent = '精读生成完成 ✓';
  } catch (e) {
    status.textContent = '精读失败: ' + (e as Error).message;
  } finally {
    btn.disabled = false;
  }
});
```

#### 6. 不落盘（明确）

精读结果只在浏览器里渲染展示，**不写入 GitHub**。理由：
- 速读 6 段已经代表"卡片级摘要"，适合归档。
- 精读是阅读辅助，看完即弃，存盘会污染 docs/ 仓库体积。
- 用户若要保存，前端加一个"复制精读到剪贴板"按钮即可（`copyAsMarkdown` 风格）。

#### 7. 错误处理

- **所有 proxy 失败**：明确提示"无法下载 PDF，请检查网络或配置自定义代理"。
- **PDF 不是合法格式**（前 4 字节不是 `%PDF`）：提示"PDF 下载失败，proxy 可能返回了 HTML 错误页"。
- **LLM 调用失败**：显示后端错误，附"重试"按钮。
- **PDF 文本过短**（< 500 字符）：提示"PDF 可能是扫描版或加密，无法提取文本"。

### 文件：`astro-src/pages/paper-analyzer.astro`

新增按钮挂载点 + 简单样式：

```astro
<style>
.analyzer-deepdive-btn { /* 复用 .analyzer-btn 风格 */ }
.analyzer-deepdive-status {
  font-size: 0.9em;
  color: var(--fg-subtle);
  padding: 0.5rem 0;
}
.analyzer-deepdive-output {
  margin-top: 1rem;
  padding: 1rem;
  background: var(--bg-soft);
  border-radius: 8px;
  /* 复用 markdown 渲染样式 */
}
</style>
```

## 关键文件:行号参考

| 现有逻辑 | 位置 | 复用方式 |
|---|---|---|
| `CORS_PROXIES` | [paper-analyzer.ts:81-90](astro-src/scripts/paper-analyzer.ts#L81) | 直接复用 |
| `fetchWithDiagnosis` | [paper-analyzer.ts:327](astro-src/scripts/paper-analyzer.ts#L327) | 参考其 fallback 模式，但二进制 PDF 需要单独写（不能直接复用，原因是返回类型不同） |
| `callLLM` | paper-analyzer.ts 中段 | 直接复用 |
| `renderResult` | [paper-analyzer.ts:1067](astro-src/scripts/paper-analyzer.ts#L1067) | 在此函数内追加按钮 + handler |
| `copyAsMarkdown` | [paper-analyzer.ts:1129](astro-src/scripts/paper-analyzer.ts#L1129) | 不复用（精读不落盘） |
| `buildMarkdownNote` | [paper-analyzer.ts:959](astro-src/scripts/paper-analyzer.ts#L959) | 不改 |
| `saveToGitHub` | [paper-analyzer.ts:993](astro-src/scripts/paper-analyzer.ts#L993) | 不改 |

## 风险点 & 缓解

| 风险 | 缓解 |
|---|---|
| 二进制 PDF 经 proxy 透传后字节被破坏（HTML error page 替换 PDF） | 前 4 字节检查 `%PDF`，否则视为失败并换 proxy |
| pdfjs-dist worker 配置复杂，CDN 路径经常变 | 用 jsdelivr 固定版本 `pdfjs-dist@4.10.38`（与 package.json 一致） |
| 精读调用耗时 30s-2min，期间用户刷新页面 | 在内存里维护 `currentDeepDive` Promise + AbortController（可选，不在 v1 必做） |
| 用户 LLM API key context 太小（如 GPT-4 8K） | 截断阈值做成可配置（默认 200K char），UI 上提示"建议用 32K+ context 模型" |
| proxy 带宽限速导致 10MB PDF 下载慢 | 加 fetch timeout 30s，超时换 proxy；最后给用户提示"可换自定义代理提速" |

## 测试方案

### 单元/手工测试

1. **proxy 链**：本地预览下，在 DevTools 看精读流程是否走 codetabs → 成功。手动把 codetabs 模拟失败，看是否切到 corsproxy.io。
2. **PDF 截断**：找一个 50 页+ 的 PDF（arXiv 2607.x），看是否触发截断提示。
3. **按钮 UX**：分析 StarBench → 看到「📖 生成长文精读」按钮 → 点击 → 阶段文案依次切换 → 完成后渲染。
4. **错误路径**：把 LLM API key 删掉，看精读按钮按下后错误提示是否友好。

### 验证用论文

- **正常 PDF**：StarBench (2510.18483v1)，已存在速读笔记，可对照验证精读质量。
- **长 PDF**：挑一个 30 页+ 的 LLM 论文（arxiv 2606.x 系列），验证截断行为。

## 实施步骤（按顺序）

1. **写 `fetchPdfBytes` + `extractPdfText`** —— 测试能否成功提取 StarBench PDF 文本。
2. **写 `truncatePdfForContext` + `buildDeepDivePrompt`** —— prompt 模板定稿。
3. **写 `runDeepDive` 串联** —— 单次手动 console 调用验证完整流程。
4. **改 `renderResult` 加按钮 + handler** —— 阶段文案切换。
5. **样式 + 折叠/展开交互** —— 默认折叠，点击展开节省视口。
6. **错误路径处理** —— 所有失败 case 都有友好提示。
7. **手工测试** —— 用 StarBench 走一遍完整流程。
8. **build + preview 验证** —— 本地无报错。

预计代码量：约 250-350 行新增（绝大部分在 paper-analyzer.ts），小量 CSS 在 paper-analyzer.astro。

## 不在 v1 范围（明确排除）

- ❌ 精读结果落盘到 docs/
- ❌ GitHub Action 后台跑精读
- ❌ 多模型对比（同一篇论文用 2 个模型各生成一份精读对比）
- ❌ 精读笔记的全文搜索
- ❌ 精读可分享链接
- ❌ PDF 章节自动检测（按章节而非按字符数截断）
- ❌ 流式输出（LLM 输出时边生成边渲染）

## 后续可扩展（v2+）

- 把精读缓存到 IndexedDB（同篇不重复跑）
- "生成问答"按钮：基于精读内容生成问答对（适合教学场景）
- 精读笔记导出为 PDF / Markdown 文件下载
- 在速读卡片加"是否生成过精读"标记

---

## 用户确认点

1. ✅ 深度精读 + 8 个固定章节（用户已选）
2. ✅ 追加到现有文件（精读结果展示在浏览器里，**不写盘** —— 与用户原始诉求"追加到现有文件"略有出入，需要在实施前再次确认是否要写盘）
3. ✅ PDF 全文 + proxy 链（用户已选）
4. ✅ 手动触发 + 独立按钮 + 阶段文案（用户已选）
5. ✅ 超限截断 + 提示（用户已选）

**唯一待确认**：精读结果是否要写盘？
- 选项 A：不写盘，仅浏览器内展示（推荐 — 速读已够归档，精读是阅读辅助）
- 选项 B：写盘到 `docs/<period>/<arxiv>-deepdive.md`（与速读并存）
- 选项 C：追加到同一 markdown 文件（与用户原话一致）

**已落地（2026-07-05）**：选 A，精读仅浏览器内展示，不写盘。

---

## 部署辅助：Cloudflare Worker CORS 反代

精读 + 速读共用 [paper-analyzer.ts:81-90](astro-src/scripts/paper-analyzer.ts#L81) 的公共 CORS proxy 链。**公共 proxy 经常挂**（2026-07-05 实测：codetabs 522 / allorigins 500 / corsproxy 403 / thingproxy 不可达），精读会失败。

**永久解法**：在 [edge-functions/cf-worker-proxy.ts](edge-functions/cf-worker-proxy.ts) 提供了一份 103 行的 Cloudflare Worker，部署步骤：

1. 登录 https://dash.cloudflare.com → Workers & Pages → Create Worker
2. 把 [edge-functions/cf-worker-proxy.ts](edge-functions/cf-worker-proxy.ts) 内容粘进编辑器 → Deploy
3. 拿到形如 `https://your-proxy.<subdomain>.workers.dev` 的 URL
4. 回到 daily-paper-reader `/settings/` 页面 → "API 提供商 / 高级" → CORS 代理输入框 → 填上一步的 URL → 保存

之后所有 proxy 失败自动 fallback 到你的 worker，**长期稳定**。Worker 每天 100K 免费请求额度，个人用绰绰有余。
