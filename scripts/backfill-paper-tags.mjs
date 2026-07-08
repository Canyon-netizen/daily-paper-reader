#!/usr/bin/env bun
// scripts/backfill-paper-tags.mjs
//
// 给 docs/papers/*.md 的 frontmatter `tags:` 行打 LLM 抽取的真实主题标签,
// 替换掉之前 `query:2607` 这种 arxivId 段占位的 fallback。
//
// 用法:
//   # 推荐: 先 dry-run 看 diff(不写盘)
//   bun scripts/backfill-paper-tags.mjs --dry-run
//
//   # 真跑
//   LLM_API_KEY=... LLM_BASE_URL=https://... LLM_MODEL=foo \
//     bun scripts/backfill-paper-tags.mjs
//
//   # 单篇调试
//   LLM_API_KEY=... LLM_BASE_URL=https://... LLM_MODEL=foo \
//     bun scripts/backfill-paper-tags.mjs --only 2606.31769v1-policy-optimization-...
//
// 注意:
// - 仅修改 frontmatter `tags:` 这一行,不动正文。
// - LLM 抽到 1-4 个 tag 才覆盖;LLM 没抽到 / 失败时保留原 tags 行(不强行写 fallback)。
// - 不并发,顺序跑(尊重 LLM rate limit);每篇 sleep --delay-ms ms。
//
// 与 astro-src/scripts/paper-analyzer.ts 的 TOPIC_ALLOWLIST 完全同步:
//   改那个常量时也要改这里。两份用同一份字面值(注释里)。
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import matter from 'gray-matter';

// 读 .env,把 api= → LLM_API_KEY, url= → LLM_BASE_URL, model= → LLM_MODEL。
// shell 里 export 出来的同名 env var 优先(已经 set 过就不覆盖)。
async function loadEnvIfPresent(envPath) {
  if (!existsSync(envPath)) return;
  let raw;
  try { raw = await readFile(envPath, 'utf8'); } catch { return; }
  const map = { api: 'LLM_API_KEY', url: 'LLM_BASE_URL', model: 'LLM_MODEL' };
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!m) continue;
    const [, k, v] = m;
    const targetKey = map[k.toLowerCase()];
    if (targetKey && !process.env[targetKey]) process.env[targetKey] = v;
  }
}

// 与 paper-analyzer.ts:73 同步。改这一份时记得同步那里。
const TOPIC_ALLOWLIST = [
  'RL',
  'MAS',
  'game ai',
  'self distillation',
  'intervention',
  'llm-agent',
  'reasoning',
  'gui',
  'vision',
  'speech',
  'safety',
  'retrieval',
  'code',
  'robotics',
  'knowledge',
];
const TOPIC_ALLOWLIST_LOWER = new Set(TOPIC_ALLOWLIST.map((t) => t.toLowerCase()));

// 简化版 SYSTEM_PROMPT:只让 LLM 抽 topic_tags,不复用四段摘要 (避免把已有摘要破坏)。
// 与 paper-analyzer.ts 的清单完全相同(改动只能改一份)。
const SYSTEM_PROMPT = `你是论文主题分类助手,根据下面给到的 title + abstract,从"预置清单"里挑 1-4 个最贴切的 tag,严格按 JSON 字符串数组输出。

【输出硬性要求】
- 只输出一个 JSON 字符串数组,不要输出任何其它文字。
- 不要写 思考块,不要写解释,不要写 markdown 围栏(不要 \`\`\`json)。
- 第一行必须是 [,最后一行必须是 ]。
- 每个元素必须**完全等于下方清单某一项**(大小写、连字符、空格按原样)。

【预置清单 — 严格从这里挑】
- RL — 强化学习(reinforcement learning、policy optimization、MDP、Q-learning 等)
- MAS — 多智能体系统(multi-agent、cooperation、swarm、agent communication 等)
- game ai — 游戏 AI(博弈论、self-play、StarCraft、游戏对战 等)
- self distillation — 自蒸馏(self-imitation、policy self-distillation、on-policy distillation 等)
- intervention — 大模型干预(steering vector、activation patching、representation engineering 等)
- llm-agent — LLM 驱动的智能体(tool use、ReAct、function calling、agentic workflow 等)
- reasoning — 推理增强(chain-of-thought、CoT、math reasoning、search-augmented reasoning 等)
- gui — GUI 智能体(GUI agent、WebShop、mobile UI、computer use 等)
- vision — 计算机视觉 / 多模态(VLM、image classification、video、segmentation 等)
- speech — 语音 / 音频(speech recognition、text-to-speech、audio generation 等)
- safety — AI 安全 / 对齐(jailbreak、adversarial、alignment、harmful generation 等)
- retrieval — 信息检索 / RAG(dense retrieval、reranker、retrieval-augmented generation 等)
- code — 代码生成 / 程序合成(code LLM、completion、program synthesis 等)
- robotics — 机器人 / 具身智能(manipulation、locomotion、sim-to-real、embodied AI 等)
- knowledge — 知识表示 / 知识图谱(KG、entity linking、relation extraction 等)

完全不命中就输出 []。`;

function buildUserPrompt(payload) {
  return `下面是一篇论文的 title 与 abstract:

${JSON.stringify({ title: payload.title || '', abstract_zh: payload.abstract_zh || '', abstract_en: payload.abstract_en || '' }, null, 0)}

请输出严格的 JSON 字符串数组,只含上方预置清单里的 tag (0-4 个)。`;
}

function normalizeTopicTags(input) {
  if (!Array.isArray(input)) return null;  // null 表示"放弃覆盖"
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    if (!t) continue;
    const lower = t.toLowerCase();
    if (!TOPIC_ALLOWLIST_LOWER.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(t);
    if (out.length >= 4) break;
  }
  // 边界:抽到 0 个 → null(不覆盖,保留原 tags)
  // 抽到 ≥1 个 → ['RL'] 这种,后续 buildTagsForm 写回去时套 query:<tag> 前缀
  return out.length > 0 ? out : null;
}

// 从已解析的 MD body 里挑出"摘要"段(中英文 abstract)给 LLM,不再去读 PDF。
function pickAbstracts(body) {
  // 文档结构: ## 摘要 (zh) + ## Abstract (en) + 余下展开后的 markdown。
  // 这里做最宽松匹配:从 ## 标题后到下一个 ## 或分隔线前。
  const out = { zh: '', en: '' };
  const lines = body.split(/\r?\n/);
  let mode = '';
  let buf = [];
  const flush = () => {
    const t = buf.join('\n').trim();
    if (mode === 'zh' && !out.zh) out.zh = t;
    else if (mode === 'en' && !out.en) out.en = t;
    buf = [];
  };
  for (const line of lines) {
    if (/^##\s*摘要\s*$/.test(line)) { flush(); mode = 'zh'; continue; }
    if (/^##\s*Abstract\s*$/i.test(line)) { flush(); mode = 'en'; continue; }
    if (mode && /^##\s/.test(line)) { flush(); mode = ''; }
    if (mode) buf.push(line);
  }
  flush();
  return out;
}

function resolveChatUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, '');
  // 一些 provider 的默认 baseUrl 已经含 /v1,避免拼出 /v1/v1/chat/completions 触发 404。
  return /\/v1$/.test(trimmed) ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`;
}

async function callLLM({ baseUrl, apiKey, model, payload }) {
  const url = resolveChatUrl(baseUrl);
  const isDeepSeek = /^https?:\/\/api\.deepseek\.com/i.test(baseUrl);
  const isReasoning = /reasoner|reasoning|r1/i.test(model);
  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(payload) },
    ],
    temperature: 0.2,
  };
  if (isDeepSeek && isReasoning) body.thinking = { type: 'disabled' };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // 只回显状态码,不要带 upstream body 避免其中潜藏 key / 内部信息
    throw new Error(`LLM HTTP ${res.status}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  // 去掉 thinking 和 markdown 围栏
  const stripped = content
    .replace(/<think>[\s\S]*?(<\/think>|---)/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  // 找 [..] 范围
  const m = stripped.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('LLM 未返回数组');
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    throw new Error('LLM 数组解析失败: ' + (e.message || e));
  }
}

function buildTagsYaml(tagsLower) {
  // 输出形如 ["query:rl","query:safe RL"]  — 与 docs/papers/*.md 现有 style 一致
  const items = tagsLower.map((t) => `query:${t.toLowerCase()}`);
  return `tags: [${items.map((s) => `"${s}"`).join(', ')}]`;
}

// 在已序列化的 frontmatter (灰色 — 即 `---` 内的 raw YAML) 里替换 tags: 行;
// 不走 js-yaml 重写,以保留 figures_json 这种"故意写错的"原始字面值。
// 在原始文件 raw 里就地替换 frontmatter 内的 `tags:` 行。
// 比 gray-matter 来回 round-trip 安全:figures_json / raw YAML 里被故意写错的引号、
// 多行 key 等都不会被"fix",真正做到"只改一行"。
//
// 切片策略:
//   head = 起分隔符 `---<nl>` 之前的部分 (一定为空,因为 frontmatter 通常在文件最开头)
//   divStart = "\n---" 之后第一个字符的位置   (frontmatter 内文起点,跳过开头 `---<nl>`)
//   divEnd = 下一个独立 `---` 行起点之前       (frontmatter 内文终点)
//   这样 head + '\n---' + inner + '\n---<...>...</body>' 严格按行拼接,不掉任何字符。
function replaceTagsInRaw(raw, newTagsYamlLine) {
  // 文件可能是 CRLF 或 LF;先归一化到 LF 不影响内容,但便于行级 split 时不丢字符。
  // 保存原始行尾以便最后还原(避免 git diff 因 LF/CRLF 变化触发白噪音)。
  const detected = raw.includes('\r\n') ? '\r\n' : '\n';
  const text = raw.replace(/\r\n/g, '\n');
  const m = text.match(/^---\n/);
  if (!m) return raw;
  const afterOpen = m[0].length;
  // 找 frontmatter 结束分隔:整行 `---`(可能带尾部空格)
  let cursor = afterOpen;
  let divEnd = -1;
  while (cursor < text.length) {
    const nl = text.indexOf('\n', cursor);
    if (nl < 0) break;
    const line = text.slice(cursor, nl);
    if (/^---\s*$/.test(line)) { divEnd = cursor; break; }
    cursor = nl + 1;
  }
  if (divEnd < 0) return raw;

  const inner = text.slice(afterOpen, divEnd);
  const tail = text.slice(divEnd);  // 从 `\n---` 起往后(含 \n)
  // split 行,处理 frontmatter 内文
  const lines = inner.split('\n');
  // 顺手删除末尾空行(避免 join 后多余空白)
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const tagsIdx = lines.findIndex((l) => /^\s*tags\s*:\s*\[/.test(l));
  let newInner;
  if (tagsIdx >= 0) {
    lines[tagsIdx] = newTagsYamlLine;
  } else {
    // 没有 tags 行 → 插在 generated_at 之后(顺位对齐 buildFrontmatter)
    const insIdx = lines.findIndex((l) => /^\s*generated_at\s*:/.test(l));
    if (insIdx >= 0) lines.splice(insIdx + 1, 0, newTagsYamlLine);
    else lines.push(newTagsYamlLine);
  }
  newInner = lines.join('\n') + '\n';
  // 头 + 内文 + 尾部;再用原始行尾拼回去
  const assembled = '---\n' + newInner + tail;
  return detected === '\r\n' ? assembled.replace(/\n/g, '\r\n') : assembled;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const onlyIdx = process.argv.indexOf('--only');
  const onlyFile = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
  const delayIdx = process.argv.indexOf('--delay-ms');
  const delayMs = delayIdx >= 0 ? Number(process.argv[delayIdx + 1] || '300') : 300;

  // 默认从仓库根 .env 读 api/url/model 三项(只解析这三行,
  // 跳过注释、空白和非 LLM 字段如 token / id / 其他,避免 .env 里混了别的用途的 key 被误读)。
  // shell 里 export 出来的 LLM_API_KEY 等仍然优先(覆盖 .env)。
  await loadEnvIfPresent(path.join(process.cwd(), '.env'));

  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.LLM_MODEL || 'deepseek-chat';
  if (!apiKey) {
    console.error('需要 LLM_API_KEY 环境变量(脚本会先尝试读 .env 里的 api/url/model 行)');
    process.exit(2);
  }

  // 用 CWD 而不是 import.meta.url 拼路径,bun/Windows 环境下前者更稳。
  // 约定从仓库根目录运行 (bun scripts/backfill-paper-tags.mjs ...)。
  const root = process.cwd();
  const dir = path.join(root, 'docs', 'papers');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const targets = onlyFile ? files.filter((f) => f.startsWith(onlyFile)) : files;

  console.error(`[info] 待处理 ${targets.length} 篇 (dry-run=${dryRun}, delay=${delayMs}ms, model=${model})`);
  let ok = 0, skip = 0, fail = 0, noOp = 0;

  for (const file of targets) {
    const fullPath = path.join(dir, file);
    const raw = await readFile(fullPath, 'utf8');
    const parsed = matter(raw);

    // 跳过已经拥有合理 tags 的(避免无谓重跑)
    const existingTags = Array.isArray(parsed.data?.tags)
      ? parsed.data.tags.map(String)
      : typeof parsed.data?.tags === 'string'
        ? [parsed.data.tags]
        : [];
    const looksReasonable = existingTags.length > 0
      && existingTags.every((t) => !/^query:\d{4}$/.test(t));
    if (looksReasonable) {
      skip++;
      if (process.env.VERBOSE) console.error(`[skip] ${file} 已有合理 tags: ${existingTags.join(',')}`);
      continue;
    }

    const abs = pickAbstracts(parsed.content || '');
    const title = parsed.data?.title || parsed.data?.title_zh || file;
    const payload = {
      title,
      abstract_zh: abs.zh,
      abstract_en: abs.en,
    };

    let normalized;
    try {
      const arr = await callLLM({ baseUrl, apiKey, model, payload });
      normalized = normalizeTopicTags(arr);
    } catch (e) {
      fail++;
      console.error(`[fail] ${file}: ${e.message}`);
      continue;
    }
    if (!normalized) {
      noOp++;
      console.error(`[noop] ${file} LLM 未抽到任何 tag,保留原 tags 行`);
      continue;
    }

    const newLine = buildTagsYaml(normalized);

    // 就地替换文件 frontmatter 内的 tags 行 — 不用 gray-matter round-trip,
    // figures_json / raw YAML 这类被故意保留的"坏"字面值不会被 fix,
    // 也避免上次版本拼 double frontmatter 的 bug。
    const newRaw = replaceTagsInRaw(raw, newLine);
    if (newRaw === raw) {
      noOp++;
      console.error(`[noop] ${file} tags 行未改变`);
      continue;
    }

    if (dryRun) {
      ok++;
      console.log(`[dry-run] ${file}`);
      console.log(`          old: tags: ${JSON.stringify(existingTags)}`);
      console.log(`          new: ${newLine}`);
    } else {
      await writeFile(fullPath, newRaw, 'utf8');
      ok++;
      console.log(`[ok] ${file} → ${normalized.map((t) => `query:${t.toLowerCase()}`).join(', ')}`);
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  console.error(`[done] ok=${ok} skip=${skip} noop=${noOp} fail=${fail} (dry-run=${dryRun})`);
}

main().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exit(1);
});
