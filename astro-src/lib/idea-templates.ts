// astro-src/lib/idea-templates.ts
//
// R7 E.1.5: Idea templates.
//
// 3 个常用 idea 类型(survey / experiment / discussion)的结构化模板,
// 渲染成 markdown 形式的 description,带可填占位符。
//
// 设计要点:
//   - 模板的 title 留空 —— 用户按论文主题自己填,避免和现有 idea 撞名
//   - description 用 markdown 段落 + 列表,用户填进去后 LLM 可以进一步润色
//   - tags 是基础标签;后续用户可继续添加
//
// 用法:
//   const tpl = IDEA_TEMPLATES.experiment;
//   form.title.value = tpl.title; // 用户填
//   form.description.value = tpl.description;
//   form.tags.value = tpl.tags.join(', ');

export interface IdeaTemplate {
  title: string;
  description: string;
  tags: string[];
}

export const IDEA_TEMPLATES: Record<string, IdeaTemplate> = {
  survey: {
    title: '关于 XXX 的综述',
    description: `## 研究背景

[简述研究方向的现状与开放问题]

## 综述目标

- 梳理 [子领域 A] 的代表性方法
- 分析 [子领域 B] 的最新进展
- 总结 [方法 C] 与 [方法 D] 的优劣

## 预期贡献

- 给读者一个统一的视角 / 比较框架
- 指出尚未解决的关键挑战`,
    tags: ['survey', 'review'],
  },
  experiment: {
    title: '验证 XXX 假设的实验',
    description: `## 实验假设

[清晰、可证伪的假设表述]

## 实验设计

### 自变量
- [变量 1]
- [变量 2]

### 因变量
- [度量 1]
- [度量 2]

### 控制变量
- [保持不变的设置]

## 预期结果

[基于假设推演的预期数据模式]`,
    tags: ['experiment', 'hypothesis'],
  },
  discussion: {
    title: '关于 XXX 的讨论',
    description: `## 讨论主题

[一句话点明要讨论的核心问题]

## 已有观点

- [观点 A 出处 + 主要论点]
- [观点 B 出处 + 主要论点]

## 我的观点

[与已有观点的对照、可能的改进或反例]

## 开放问题

- [尚未被回答的相关问题]
- [验证我的观点需要的进一步工作]`,
    tags: ['discussion'],
  },
};

/** 列出所有可用的模板 key(survey / experiment / discussion)。 */
export function listIdeaTemplateKeys(): string[] {
  return Object.keys(IDEA_TEMPLATES);
}

/** 拿到单个模板;key 不存在返回 null。 */
export function getIdeaTemplate(key: string): IdeaTemplate | null {
  return IDEA_TEMPLATES[key] ?? null;
}

/** 把模板应用到 form:把 description / tags 写进 form 对应字段。
 *  title 留空(plan 里有「用户按 XXX 填」的占位语义,实际生成时由 UI 单独
 *  处理或让用户改)。
 *
 *  兼容两种调用形式:
 *    - 传 HTMLFormElement(form.querySelector 直接抽字段)
 *    - 传 fieldMap = { title, description, tags } (e.g. 用 ref 拿到 input 元素)
 */
export function applyIdeaTemplate(
  target: HTMLFormElement | { title?: HTMLInputElement | null; description?: HTMLTextAreaElement | null; tags?: HTMLInputElement | null },
  templateKey: string,
): { applied: boolean; reason?: string } {
  const tpl = IDEA_TEMPLATES[templateKey];
  if (!tpl) return { applied: false, reason: `unknown template: ${templateKey}` };

  let titleEl: HTMLInputElement | null = null;
  let descEl: HTMLTextAreaElement | null = null;
  let tagsEl: HTMLInputElement | null = null;
  // 兼容两种调用形式:
  //    - 传 HTMLFormElement(form.querySelector 直接抽字段)
  //    - 传 fieldMap = { title, description, tags } (e.g. 用 ref 拿到 input 元素)
  //
  // 注意:用 duck-typing 而不是 `instanceof HTMLFormElement`,因为后者在
  // 没有 DOM 全局(SSR / Node 测试环境)下会抛 ReferenceError。
  if (typeof (target as HTMLFormElement).querySelector === 'function') {
    const form = target as HTMLFormElement;
    titleEl = form.querySelector<HTMLInputElement>('#idea-title, [name="title"]');
    descEl = form.querySelector<HTMLTextAreaElement>('#idea-description, [name="description"]');
    tagsEl = form.querySelector<HTMLInputElement>('#idea-tags, [name="tags"]');
  } else {
    const fields = target as { title?: HTMLInputElement | null; description?: HTMLTextAreaElement | null; tags?: HTMLInputElement | null };
    titleEl = fields.title ?? null;
    descEl = fields.description ?? null;
    tagsEl = fields.tags ?? null;
  }

  // title 留空(占位语义,plan 决定);只在已有值且模板 title 非空时才覆盖,
  // 否则保留用户已输入的内容。
  if (titleEl && tpl.title && !titleEl.value) {
    titleEl.value = tpl.title;
  }
  if (descEl) descEl.value = tpl.description;
  if (tagsEl) tagsEl.value = tpl.tags.join(', ');
  return { applied: true };
}