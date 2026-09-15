// astro-src/lib/experiments/variable-wizard.ts
//
// R7 E.2.2: 实验变量设计向导(variable design wizard)。
//
// 设计目标:帮用户填出三类变量 + 每个变量带类型 / 单位 / 取值范围 / 说明。
//
// 数据结构:
//   VariableDraft {
//     name: string      变量名(必填)
//     type: 'continuous' | 'categorical' | 'ordinal' | 'binary'
//     unit?: string
//     range?: string    例如 "0..1" / "low / mid / high"
//     description?: string
//   }
//
// 提交流程:
//   1. 用户在向导 modal 里添加 / 编辑三类变量(independent / dependent / controlled)
//   2. 完成后 collectVariablesFromWizard() 抽出 VariableSet,UI 把它写到
//      textarea 里,后端实验 record 落地。

export type VariableType = 'continuous' | 'categorical' | 'ordinal' | 'binary';

export interface VariableDraft {
  name: string;
  type: VariableType;
  unit?: string;
  range?: string;
  description?: string;
}

export interface VariableSet {
  independent: VariableDraft[];
  dependent: VariableDraft[];
  controlled: VariableDraft[];
}

/** 一个空集合(初始化向导时用)。 */
export function emptyVariableSet(): VariableSet {
  return { independent: [], dependent: [], controlled: [] };
}

/** 判断一个变量草稿是否合法(name 非空、type 在 4 个枚举里)。 */
export function isValidVariable(v: VariableDraft | null | undefined): v is VariableDraft {
  if (!v || typeof v !== 'object') return false;
  if (typeof v.name !== 'string' || !v.name.trim()) return false;
  const validTypes: VariableType[] = ['continuous', 'categorical', 'ordinal', 'binary'];
  if (!validTypes.includes(v.type)) return false;
  return true;
}

/**
 * 把 VariableSet 渲染成 markdown —— 套用进 experiment 的 methodology 字段,
 * 让 LLM / reviewer 一眼能看全三类变量。
 */
export function renderVariableSetMarkdown(set: VariableSet): string {
  const sections: string[] = [];
  for (const group of [
    ['independent', '自变量 (Independent)'],
    ['dependent', '因变量 (Dependent)'],
    ['controlled', '控制变量 (Controlled)'],
  ] as const) {
    const vars = set[group[0]];
    if (vars.length === 0) continue;
    const lines = [`## ${group[1]}`, ''];
    for (const v of vars) {
      if (!isValidVariable(v)) continue;
      const bits: string[] = [`- **${v.name}** (\`${v.type}\``];
      if (v.unit) bits.push(`, ${v.unit}`);
      bits.push(')');
      if (v.range) bits.push(` — 取值范围: \`${v.range}\``);
      if (v.description) bits.push(` — ${v.description}`);
      lines.push(bits.join(''));
    }
    sections.push(lines.join('\n'));
  }
  return sections.length > 0 ? sections.join('\n\n') + '\n' : '';
}

/**
 * 从 modal DOM 里抽出 VariableSet。`root` 是包含三类容器
 * (`[data-variable-group="independent"]` 等)的根元素。每个变量项的字段是:
 *   [data-variable-name]    <input>  name
 *   [data-variable-type]    <select> type
 *   [data-variable-unit]    <input>  unit
 *   [data-variable-range]   <input>  range
 *   [data-variable-desc]    <input>  description
 *
 * 缺字段 → 当 null 跳过;但 type 默认 'continuous' 兜底,允许最少只填 name。
 */
export function collectVariablesFromWizard(root: HTMLElement | null): VariableSet {
  const out = emptyVariableSet();
  if (!root) return out;

  const groups: Array<['independent' | 'dependent' | 'controlled', string]> = [
    ['independent', 'independent'],
    ['dependent', 'dependent'],
    ['controlled', 'controlled'],
  ];
  for (const [key, slug] of groups) {
    const groupEl = root.querySelector(`[data-variable-group="${slug}"]`);
    if (!groupEl) continue;
    const items = groupEl.querySelectorAll('[data-variable-item]');
    for (const itemEl of Array.from(items)) {
      const nameEl = itemEl.querySelector<HTMLInputElement>('[data-variable-name]');
      const typeEl = itemEl.querySelector<HTMLSelectElement>('[data-variable-type]');
      const unitEl = itemEl.querySelector<HTMLInputElement>('[data-variable-unit]');
      const rangeEl = itemEl.querySelector<HTMLInputElement>('[data-variable-range]');
      const descEl = itemEl.querySelector<HTMLInputElement>('[data-variable-desc]');
      const draft: VariableDraft = {
        name: (nameEl?.value || '').trim(),
        type: ((typeEl?.value as VariableType) || 'continuous'),
        unit: (unitEl?.value || '').trim() || undefined,
        range: (rangeEl?.value || '').trim() || undefined,
        description: (descEl?.value || '').trim() || undefined,
      };
      if (isValidVariable(draft)) {
        out[key].push(draft);
      }
    }
  }
  return out;
}

/** 一行变量在 UI 上的 HTML —— 5 个字段(name / type / unit / range / desc)+ 删除按钮。 */
export function renderVariableItemHtml(indexInGroup: number): string {
  return `
    <div class="variable-item" data-variable-item>
      <div class="variable-item-row">
        <input type="text" data-variable-name placeholder="变量名 (必填)" />
        <select data-variable-type>
          <option value="continuous">continuous</option>
          <option value="categorical">categorical</option>
          <option value="ordinal">ordinal</option>
          <option value="binary">binary</option>
        </select>
        <button type="button" data-variable-remove aria-label="删除变量 ${indexInGroup + 1}">✕</button>
      </div>
      <div class="variable-item-row">
        <input type="text" data-variable-unit placeholder="单位 (可选)" />
        <input type="text" data-variable-range placeholder="取值范围 (可选, 如 0..1 / low|mid|high)" />
      </div>
      <div class="variable-item-row">
        <input type="text" data-variable-desc placeholder="说明 (可选)" />
      </div>
    </div>`;
}

/** 把一组变量渲染成完整的 wizard 内部容器(不含 modal 外壳)。 */
export function renderVariableGroupHtml(group: 'independent' | 'dependent' | 'controlled', label: string): string {
  return `
    <div class="variable-group" data-variable-group="${group}">
      <div class="variable-group-header">
        <h3>${label}</h3>
        <button type="button" data-add-variable="${group}">➕ 添加${label}</button>
      </div>
      <div class="variable-group-items"></div>
    </div>`;
}