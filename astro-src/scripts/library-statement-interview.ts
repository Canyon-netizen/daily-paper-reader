// astro-src/scripts/library-statement-interview.ts
//
// 照 Polaris NewLibraryModal 的 AI 访谈流:DPR 客户端版。
//
// 用户点「🎤 AI 帮我写」→ 2-3 个针对性问题(每个 LLM 根据前一问动态生成,
// 因为 DPR 没服务端无法做持久化对话)→ 总结成一段 100-200 字 statement。
//
// 设计:
//   - 3 步:研究方向 → 关注子问题 → 期望读者 / 应用场景
//   - 每步:用户可输入,或点「🎲 列几个候选」让 LLM 生成 4-5 个候选 chip
//     直接点击 chip 填入 textarea;再点「💡 给我建议」对填入内容做精炼
//   - 最终综合 statement,可选字段:inclusion_keywords / categories 自动推断
//   - 用户满意 → 写进 modal 的 statement textarea + 自动填 keywords
//
// 复用:
//   - loadSettings() 拿 LLM key
//   - 与 EditLibraryModal / NewLibraryModal 的 data-modal-* 控件对齐

import { showToast } from './toast';
import { loadSettings } from './settings';

/** 读取 localStorage `dpr_llm_proxy_v1`(scripts/local-llm-proxy.mjs 的 URL)。
 *  与 lib/llm/chat.ts 的 readLLMProxyOverride 逻辑一致;
 *  客户端设了就走本地 8124 代理,避免 CORS / API key 暴露。 */
function readLLMProxyOverride(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    const v = (localStorage.getItem('dpr_llm_proxy_v1') || '').trim();
    if (!v) return '';
    return /^https?:\/\//i.test(v) ? v.replace(/\/+$/, '') : `http://${v.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

export interface InterviewStep {
  id: 'topic' | 'subtopic' | 'audience';
  question: string;
  /** 用户填的回答 */
  answer: string;
  /** LLM 给的建议回答(可被覆盖) */
  suggestion: string;
  /** LLM 的解释 / 候选关键词 */
  rationale: string;
}

const STEP_TEMPLATE = [
  {
    id: 'topic' as const,
    question: '你打算跟踪哪个研究方向?(1-2 句话,不需要完美,大致方向即可)',
    systemHint:
      '用户给出大致方向(可能为空)。你要:\n' +
      '1) 充分参考 user 消息里的「文献库名称」行 —— 用户已经想好给这个库起什么名字了,你生成的 candidates 应该紧贴这个名字的语义域(例:名字叫「长程智能体」,候选就该是「多步任务规划」「长视野决策」「技能链组合」之类),而不是泛泛的 AI 方向。\n' +
      '2) 若用户当前回答为空:基于文献库名称 + 历史,生成 4-5 个候选方向(每个 5-15 字短语),放到 candidates 数组。\n' +
      '3) 若用户已有回答:把方向精炼成「核心动词 + 对象 + 场景」,放到 refined 字段。\n' +
      '4) 给出 3-5 个相关 arxiv 分类(如 cs.LG / cs.CL / cs.MA / cs.AI / cs.RO)。\n' +
      '输出 JSON:{"candidates":["…",…] | "refined":"…","categories":["cs.LG",…],"rationale":"…"}',
  },
  {
    id: 'subtopic' as const,
    question: '这个方向上,你**最关心**的 2-3 个子问题是什么?(每个一行)',
    systemHint:
      '基于文献库名称 + 方向 + 已有子问题(可能为空)。你要:\n' +
      '1) 充分参考 user 消息里的「文献库名称」行 —— 子问题应该跟这个名字的研究主题强相关(例:「长程智能体」就该问「长视野信用分配」「层级 RL」「工具使用链」),不要泛泛抛出「效率 vs 性能」这种通用 AI 议题。\n' +
      '2) 若用户当前回答为空:基于文献库名称 + 研究方向,生成 4-5 个常见子问题模板(每个 ≤ 15 字),放到 candidates 数组。\n' +
      '3) 若用户已有子问题:把这些子问题归类成 1-3 个主题,每主题一句 title,放到 themes。\n' +
      '4) 推荐 5-8 个必须命中的关键词(英文为主,中文为辅)。\n' +
      '输出 JSON:{"candidates":["…",…] | "themes":[{"title":"…","papers":"…"},…],"keywords":["…","…"]}',
  },
  {
    id: 'audience' as const,
    question: '这个库里的论文,你打算用来做什么?(如:写综述 / 跟踪进展 / 给新项目找 idea)',
    systemHint:
      '基于文献库名称 + 方向 + 已有目的(可能为空)。你要:\n' +
      '1) 充分参考 user 消息里的「文献库名称」行 —— 用途候选应该贴这个库的主题(例:「长程智能体」就该给「评估长视野 benchmark」「补全技能链案例」这种),而不是「写综述章节」「找新项目 idea」这种通用答案。\n' +
      '2) 若用户当前回答为空:基于文献库名称 + 研究方向,生成 4-5 个常见用途模板(每个 ≤ 15 字),放到 candidates 数组。\n' +
      '3) 若用户已有目的:综合成一个 80-150 字 statement,放到 statement 字段;并推荐 3-5 个排除关键词。\n' +
      '输出 JSON:{"candidates":["…",…] | "statement":"…","exclude":["…","…"]}',
  },
];

export interface InterviewResult {
  statement: string;
  inclusionKeywords: string[];
  exclusionKeywords: string[];
  categories: string[];
}

/** 一步 LLM 调用:基于用户当前 + 历史回答,返回该步的精炼 / 建议。 */
export async function runInterviewStep(
  stepId: 'topic' | 'subtopic' | 'audience',
  history: InterviewStep[],
  currentAnswer: string = '',
  libraryName: string = '',
): Promise<{ refined?: string; categories?: string[]; themes?: { title: string; papers: string }[]; keywords?: string[]; statement?: string; exclude?: string[]; candidates?: string[]; rationale: string }> {
  const cfg = loadSettings();
  if (!cfg?.apiKey) {
    showToast('请先在设置页配置 LLM key', 'error');
    throw new Error('no LLM key');
  }
  // 走本地 LLM 代理(若 localStorage 设了 dpr_llm_proxy_v1),否则直连上游。
  // 与 lib/llm/chat.ts 的 callChatCompletion 逻辑保持一致 —— 之前直接用 cfg.baseUrl
  // 直连 api.minimaxi.com/anthropic 会被 CORS 挡 → fetch 抛错 → candWrap 永远不显示。
  const proxyUrl = readLLMProxyOverride();
  const effectiveBase = proxyUrl || (cfg.baseUrl || 'https://api.minimaxi.com/v1');
  const url = `${effectiveBase.replace(/\/+$/, '')}/v1/chat/completions`.replace(/\/v1\/v1\//, '/v1/');
  const model = cfg.model || 'MiniMax-M2.7-highspeed';
  const step = STEP_TEMPLATE.find((s) => s.id === stepId)!;

  const historyLines = history
    .map((h, i) => `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.answer || '(空)'}\nAssistant: ${h.suggestion || '(暂无)'}`)
    .join('\n\n');

  const userMsg =
    `当前问题(${stepId}): ${step.question}\n\n` +
    `文献库名称: ${libraryName.trim() || '(用户还没填,根据历史回答 / 上下文保持开放)'}\n\n` +
    `历史对话:\n${historyLines || '(无,这是第一个问题)'}\n\n` +
    `用户当前回答: ${currentAnswer.trim() || '(空 — 请输出 candidates 候选数组)'}\n\n` +
    `输出 JSON:`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(proxyUrl ? {} : { Authorization: `Bearer ${cfg.apiKey}` }),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: step.systemHint },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.5,
      response_format: { type: 'json_object' },
      max_tokens: 800,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`LLM HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  let content = (data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  const obj = JSON.parse(content.slice(start, end + 1));
  return {
    refined: typeof obj.refined === 'string' ? obj.refined : undefined,
    categories: Array.isArray(obj.categories) ? obj.categories.map(String) : undefined,
    themes: Array.isArray(obj.themes) ? obj.themes.map((t: { title?: string; papers?: string }) => ({ title: String(t.title || ''), papers: String(t.papers || '') })) : undefined,
    keywords: Array.isArray(obj.keywords) ? obj.keywords.map(String) : undefined,
    statement: typeof obj.statement === 'string' ? obj.statement : undefined,
    exclude: Array.isArray(obj.exclude) ? obj.exclude.map(String) : undefined,
    candidates: Array.isArray(obj.candidates)
      ? obj.candidates.map(String).map((s) => s.trim()).filter((s) => s.length > 0 && s.length < 40).slice(0, 6)
      : undefined,
    rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
  };
}

/** 把访谈最终结果展开成 modal 需要的字段。 */
export function summarizeInterview(steps: InterviewStep[]): InterviewResult {
  const final = steps.find((s) => s.id === 'audience');
  const topic = steps.find((s) => s.id === 'topic');
  const subtopic = steps.find((s) => s.id === 'subtopic');
  return {
    statement: final?.suggestion || final?.answer || topic?.suggestion || '',
    inclusionKeywords: subtopic?.suggestion ? extractKeywords(subtopic.suggestion) : [],
    exclusionKeywords: extractKeywords(final?.suggestion || '').filter((k) => isExcludeKeyword(k)),
    categories: extractCategories(topic?.suggestion || ''),
  };
}

function extractKeywords(json: string): string[] {
  // 从 JSON 字符串里提 keywords 数组
  try {
    const start = json.indexOf('[');
    const end = json.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    const arr = JSON.parse(json.slice(start, end + 1));
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function extractCategories(json: string): string[] {
  try {
    const start = json.indexOf('[');
    const end = json.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    const arr = JSON.parse(json.slice(start, end + 1));
    return Array.isArray(arr) ? arr.map(String).filter((s) => /^[\w.]+$/.test(s)) : [];
  } catch {
    return [];
  }
}

function isExcludeKeyword(k: string): boolean {
  // 简易判断:出现在 exclude 数组里(用 bracket context)
  return k.length > 0 && k.length < 30;
}