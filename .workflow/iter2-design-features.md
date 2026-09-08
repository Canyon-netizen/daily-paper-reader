# DPR Iteration 2 — Feature Design Document

> Version: 1.0 | Date: 2026-09-08
> Parent: design-final.md (Iteration 1)

---

## Overview

Iteration 1 built the core CRUD infrastructure for 4 modules (Ideas, Experiments, Writing, Roadmap) with localStorage persistence. Iteration 2 adds 5 feature categories:

1. **Export** — Multi-format data export (Markdown, PDF, JSON)
2. **Templates** — Pre-built experiment and writing templates stored in localStorage
3. **Suggestions** — Context-aware recommendations from library data
4. **Progress Tracking** — Computed progress from linked entities
5. **Tags & Search** — Enhanced filtering with text search within each module

All features build on existing module architecture and use localStorage for persistence. No backend required.

---

## 1. Export Feature

### 1.1 Architecture Overview

| Module | Export Formats | Export Trigger |
|--------|---------------|----------------|
| Writing | Markdown (download), PDF (print CSS) | Card action + detail page |
| Idea | Markdown (download) | Card action + detail page |
| Experiment | JSON (download) | Card action + detail page |
| Roadmap | Markdown (download) | Detail page header |

**Storage Schema Extension:**

```typescript
// In each module's types.ts, add exportHistory
interface ExportHistoryEntry {
  format: 'markdown' | 'pdf' | 'json';
  exportedAt: number;
  fileName: string;
}

// Extend existing types
interface Idea {
  // ... existing fields
  exportHistory?: ExportHistoryEntry[];
}

interface Experiment {
  // ... existing fields
  exportHistory?: ExportHistoryEntry[];
}

interface Writing {
  // ... existing fields
  exportHistory?: ExportHistoryEntry[];
}
```

### 1.2 UI Components

#### ExportButton Component

**Location:** `astro-src/components/ExportButton.astro`

```astro
---
interface Props {
  entityType: 'idea' | 'experiment' | 'writing' | 'roadmap';
  entityId: string;
  formats: Array<'markdown' | 'pdf' | 'json'>;
}

const { entityType, entityId, formats } = Astro.props;
---
<div class="export-dropdown">
  <button type="button" class="btn btn-ghost btn-sm" data-export-trigger>
    📥 导出
  </button>
  <div class="export-menu" hidden>
    {formats.includes('markdown') && (
      <button type="button" data-export="markdown">Markdown</button>
    )}
    {formats.includes('pdf') && (
      <button type="button" data-export="pdf">PDF (打印)</button>
    )}
    {formats.includes('json') && (
      <button type="button" data-export="json">JSON</button>
    )}
  </div>
</div>

<style>
  .export-dropdown { position: relative; }
  .export-menu {
    position: absolute;
    right: 0;
    top: 100%;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    z-index: 100;
  }
  .export-menu button {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--space-2) var(--space-3);
  }
</style>

<script>
  // Client-side handler in export-ui.ts
</script>
```

#### Export Menu Placement

- **List Page (Card):** Add to card action buttons (next to status toggle, delete)
- **Detail Page:** Add to header action bar (top-right of title area)

### 1.3 Data Flow

```
User clicks Export → UI handler reads entity from localStorage
  → Generate format-specific content
  → For Markdown/JSON: Create Blob URL, trigger download
  → For PDF: Apply print CSS, window.print()
  → Record exportHistory entry
```

### 1.4 Export Handlers

**Location:** `astro-src/scripts/export-ui.ts`

```typescript
// ─────────────────────────────────────────────────────────────
// MARKDOWN EXPORTS
// ─────────────────────────────────────────────────────────────

export function exportIdeaAsMarkdown(idea: Idea): string {
  const lines = [
    `# ${idea.title}`,
    `**Status:** ${idea.status}`,
    `**Tags:** ${idea.tags.join(', ')}`,
    `**Created:** ${new Date(idea.createdAt).toLocaleDateString('zh-CN')}`,
    ``,
    `## Description`,
    idea.description,
    ``,
    `## Related Papers`,
    ...idea.relatedPapers.map(id => `- [${id}](/papers/${id}/)`),
    ``,
    `## Related Concepts`,
    ...idea.relatedConcepts.map(c => `- ${c}`),
  ];
  return lines.filter(Boolean).join('\n');
}

export function exportWritingAsMarkdown(writing: Writing): string {
  const lines = [
    `# ${writing.title}`,
    `**Type:** ${writing.type} | **Status:** ${writing.status}`,
    `**Target:** ${writing.targetVenue || 'N/A'}`,
    `**Word Count:** ${writing.wordCount}`,
    `**Created:** ${new Date(writing.createdAt).toLocaleDateString('zh-CN')}`,
    ``,
  ];

  for (const section of writing.sections.sort((a, b) => a.order - b.order)) {
    lines.push(`## ${section.title}`, section.content, '');
  }

  if (writing.citedPapers.length > 0) {
    lines.push('## References', ...writing.citedPapers.map(p => `- ${p.arxivId}`));
  }

  return lines.filter(Boolean).join('\n');
}

export function exportRoadmapAsMarkdown(roadmap: Roadmap): string {
  const lines = [
    `# ${roadmap.titleZh || roadmap.title}`,
    `**Type:** ${roadmap.type} | **Owner:** ${roadmap.owner}`,
    `**Period:** ${roadmap.startDate} ~ ${roadmap.endDate}`,
    ``,
  ];

  for (const quarter of roadmap.quarters) {
    lines.push(`## ${quarter.titleZh || quarter.id}`);
    for (const goal of quarter.goals) {
      const check = goal.status === 'completed' ? '[x]' : '[ ]';
      lines.push(`- ${check} ${goal.titleZh || goal.title}`);
    }
    lines.push('');
  }

  return lines.filter(Boolean).join('\n');
}

// ─────────────────────────────────────────────────────────────
// JSON EXPORT
// ─────────────────────────────────────────────────────────────

export function exportExperimentAsJSON(exp: Experiment): string {
  return JSON.stringify(exp, null, 2);
}

// ─────────────────────────────────────────────────────────────
// PDF EXPORT (Print CSS)
// ─────────────────────────────────────────────────────────────

/**
 * PDF export uses browser print functionality with dedicated print CSS.
 * Key: @media print rules in writing.css
 */
export function prepareWritingForPrint(writing: Writing): void {
  // Add print class to body
  document.body.classList.add('print-mode');

  // Scroll to top
  window.scrollTo(0, 0);

  // Trigger print dialog
  window.print();
}
```

### 1.5 Print CSS Requirements

**Location:** Extend `astro-src/styles/writing.css`

```css
@media print {
  body {
    background: white;
    color: black;
    font-size: 12pt;
    line-height: 1.5;
  }

  /* Hide UI chrome */
  nav, footer, .actionbar, .export-dropdown, .btn {
    display: none !important;
  }

  /* Show print header */
  .print-header {
    display: block !important;
    text-align: center;
    margin-bottom: 2em;
  }

  /* Section styling */
  .writing-section {
    page-break-after: auto;
    margin-bottom: 1.5em;
  }

  .writing-section h2 {
    font-size: 14pt;
    border-bottom: 1pt solid #ccc;
    padding-bottom: 0.25em;
  }

  /* Code blocks */
  pre, code {
    background: #f5f5f5 !important;
    border: 1pt solid #ddd;
  }

  /* Links */
  a[href]::after {
    content: " (" attr(href) ")";
    font-size: 10pt;
    color: #666;
  }
}

/* Print header (hidden by default) */
.print-header {
  display: none;
}
```

### 1.6 Download Helper

```typescript
// astro-src/scripts/export-ui.ts (continued)

export function triggerDownload(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

---

## 2. Templates Feature

### 2.1 Architecture Overview

Templates are pre-defined structures stored in localStorage under a separate key. Users can:
- Select from built-in templates when creating new entities
- Save custom templates from existing entities
- Edit/delete custom templates

**Storage Schema:**

```typescript
// astro-src/lib/templates/types.ts

export type TemplateCategory = 'experiment' | 'writing';

export interface ExperimentTemplate {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  fields: {
    title: string;
    titleZh: string;
    hypothesis: string;
    hypothesisZh: string;
    method: string;
    methodZh: string;
    variables: ExperimentVariable[];
    expectedResults: string;
    expectedResultsZh: string;
    tags: string[];
  };
  isBuiltin: boolean;
  createdAt: number;
}

export interface WritingTemplate {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  type: WritingType;
  sections: WritingSection[];  // Default sections
  isBuiltin: boolean;
  createdAt: number;
}

interface TemplatesDoc {
  schemaVersion: 1;
  experimentTemplates: Record<string, ExperimentTemplate>;
  writingTemplates: Record<string, WritingTemplate>;
}

const TEMPLATES_KEY = 'dpr_templates_v1';
```

### 2.2 Built-in Templates

#### Experiment Templates

```typescript
// astro-src/lib/templates/builtins.ts

export const BUILTIN_EXPERIMENT_TEMPLATES: ExperimentTemplate[] = [
  {
    id: 'ablation-study',
    name: 'Ablation Study',
    nameZh: '消融实验',
    description: 'Systematically remove or disable components to understand their contribution',
    fields: {
      title: '',
      titleZh: '',
      hypothesis: 'Removing [component] will [expected effect] with [quantified impact]',
      hypothesisZh: '移除[组件]将导致[预期效果]，影响为[量化指标]',
      method: '## Setup\n- Baseline: [full model]\n- Ablation: [remove component]\n\n## Metrics\n- [metric 1]\n- [metric 2]\n\n## Datasets\n- [dataset 1]\n- [dataset 2]',
      methodZh: '## 设置\n- 基线: [完整模型]\n- 消融: [移除组件]\n\n## 指标\n- [指标1]\n- [指标2]\n\n## 数据集\n- [数据集1]\n- [数据集2]',
      variables: [
        { name: 'component', type: 'independent', description: 'Component being ablated', values: ['baseline', 'ablated'] },
        { name: 'metric', type: 'dependent', description: 'Performance metric', unit: '%' },
      ],
      expectedResults: 'Ablation will show [X]% degradation on [metric]',
      expectedResultsZh: '消融将导致[指标]下降[X]%',
      tags: ['ablation', 'analysis'],
    },
    isBuiltin: true,
    createdAt: 0,
  },
  {
    id: 'hyperparameter-sweep',
    name: 'Hyperparameter Sweep',
    nameZh: '超参数搜索',
    description: 'Systematically explore hyperparameter space',
    fields: {
      title: '',
      titleZh: '',
      hypothesis: 'Optimal [hyperparameter] value is [range] achieving [metric] improvement',
      hypothesisZh: '最优[超参数]值为[范围]，可提升[指标]',
      method: '## Search Space\n- [param1]: [range]\n- [param2]: [range]\n\n## Method\n- [grid/random/bayesian]\n\n## Metrics\n- [primary metric]\n- [secondary metric]',
      methodZh: '## 搜索空间\n- [参数1]: [范围]\n- [参数2]: [范围]\n\n## 方法\n- [网格/随机/贝叶斯]\n\n## 指标\n- [主要指标]\n- [次要指标]',
      variables: [
        { name: 'param1', type: 'independent', description: 'First hyperparameter', values: [] },
        { name: 'metric', type: 'dependent', description: 'Performance metric', unit: '%' },
      ],
      expectedResults: 'Best configuration achieves [X] on [metric]',
      expectedZh: '最佳配置在[指标]上达到[X]',
      tags: ['hyperparameter', 'optimization'],
    },
    isBuiltin: true,
    createdAt: 0,
  },
  {
    id: 'user-study',
    name: 'User Study',
    nameZh: '用户研究',
    description: 'Evaluate with human participants',
    fields: {
      title: '',
      titleZh: '',
      hypothesis: '[System] will achieve [X]% improvement in [metric] over [baseline]',
      hypothesisZh: '[系统]相比[基线]在[指标]上提升[X]%',
      method: '## Participants\n- N=[number]\n- Demographics: [description]\n\n## Tasks\n- [task 1]\n- [task 2]\n\n## Metrics\n- [metric 1]: subjective/objective\n- [metric 2]',
      methodZh: '## 参与者\n- N=[数量]\n- 人口统计: [描述]\n\n## 任务\n- [任务1]\n- [任务2]\n\n## 指标\n- [指标1]: 主观/客观\n- [指标2]',
      variables: [
        { name: 'condition', type: 'independent', description: 'Experimental condition', values: ['control', 'treatment'] },
        { name: 'score', type: 'dependent', description: 'User performance score', unit: 'points' },
      ],
      expectedResults: 'Treatment shows statistically significant improvement (p<0.05)',
      expectedResultsZh: '实验组显示统计显著提升(p<0.05)',
      tags: ['user-study', 'human-evaluation'],
    },
    isBuiltin: true,
    createdAt: 0,
  },
  {
    id: 'ab-test',
    name: 'A/B Test',
    nameZh: 'A/B 测试',
    description: 'Compare two variants in production or controlled setting',
    fields: {
      title: '',
      titleZh: '',
      hypothesis: 'Variant B will outperform Variant A by [X]% on [metric]',
      hypothesisZh: '变体B相比变体A在[指标]上提升[X]%',
      method: '## Variants\n- A (control): [description]\n- B (treatment): [description]\n\n## Traffic Split\n- [percentage]% each\n\n## Duration\n- [number] days\n\n## Metrics\n- Primary: [metric]\n- Guard: [metric]',
      methodZh: '## 变体\n- A (对照): [描述]\n- B (实验): [描述]\n\n## 流量分配\n- 各[百分比]%\n\n## 持续时间\n- [数量]天\n\n## 指标\n- 主要: [指标]\n- 保护: [指标]',
      variables: [
        { name: 'variant', type: 'independent', description: 'Test variant', values: ['A', 'B'] },
        { name: 'conversion', type: 'dependent', description: 'Conversion rate', unit: '%' },
      ],
      expectedResults: 'Variant B achieves [X]% lift with statistical significance',
      expectedResultsZh: '变体B达到[X]%提升，具有统计显著性',
      tags: ['ab-test', 'production'],
    },
    isBuiltin: true,
    createdAt: 0,
  },
];
```

#### Writing Templates

```typescript
// astro-src/lib/templates/builtins.ts (continued)

export const BUILTIN_WRITING_TEMPLATES: WritingTemplate[] = [
  {
    id: 'workshop-paper-4page',
    name: 'Workshop Paper (4-page)',
    nameZh: '工作坊论文 (4页)',
    description: 'Compact workshop submission format',
    type: 'paper',
    sections: [
      { id: 'abstract', title: 'Abstract', content: '', order: 0 },
      { id: 'intro', title: 'Introduction', content: '', order: 1 },
      { id: 'method', title: 'Method', content: '', order: 2 },
      { id: 'experiments', title: 'Experiments', content: '', order: 3 },
      { id: 'results', title: 'Results', content: '', order: 4 },
      { id: 'related', title: 'Related Work', content: '', order: 5 },
      { id: 'conclusion', title: 'Conclusion', content: '', order: 6 },
      { id: 'references', title: 'References', content: '', order: 7 },
    ],
    isBuiltin: true,
    createdAt: 0,
  },
  {
    id: 'blog-post',
    name: 'Blog Post',
    nameZh: '博客文章',
    description: 'Casual technical blog format',
    type: 'note',
    sections: [
      { id: 'intro', title: 'Intro', content: '', order: 0 },
      { id: 'main', title: 'Main Content', content: '', order: 1 },
      { id: 'conclusion', title: 'Takeaways', content: '', order: 2 },
    ],
    isBuiltin: true,
    createdAt: 0,
  },
  {
    id: 'research-proposal',
    name: 'Research Proposal',
    nameZh: '研究提案',
    description: 'Standard research proposal structure',
    type: 'paper',
    sections: [
      { id: 'abstract', title: 'Abstract', content: '', order: 0 },
      { id: 'background', title: 'Background & Motivation', content: '', order: 1 },
      { id: 'problem', title: 'Problem Statement', content: '', order: 2 },
      { id: 'approach', title: 'Proposed Approach', content: '', order: 3 },
      { id: 'methodology', title: 'Methodology', content: '', order: 4 },
      { id: 'timeline', title: 'Timeline', content: '', order: 5 },
      { id: 'impact', title: 'Expected Impact', content: '', order: 6 },
      { id: 'references', title: 'References', content: '', order: 7 },
    ],
    isBuiltin: true,
    createdAt: 0,
  },
];
```

### 2.3 UI Components

#### Template Picker Modal

**Location:** `astro-src/components/TemplatePicker.astro`

```astro
---
interface Props {
  mode: 'create' | 'save-as';
  entityType: 'experiment' | 'writing';
}

const { mode, entityType } = Astro.props;
---
<dialog id="template-picker-modal" class="template-modal">
  <div class="modal-content">
    <div class="modal-header">
      <h2>{mode === 'create' ? '选择模板' : '保存为模板'}</h2>
      <button type="button" class="modal-close" aria-label="关闭">×</button>
    </div>

    {mode === 'create' && (
      <div class="template-grid">
        <!-- Built-in templates -->
        <div class="template-section">
          <h3>内置模板</h3>
          <div class="template-list" data-templates="builtin"></div>
        </div>

        <!-- Custom templates -->
        <div class="template-section">
          <h3>自定义模板</h3>
          <div class="template-list" data-templates="custom"></div>
          {entityType === 'experiment' && (
            <button type="button" class="btn btn-ghost btn-sm" data-save-current-as-template>
              ➕ 保存当前为模板
            </button>
          )}
        </div>
      </div>
    )}

    {mode === 'save-as' && (
      <form id="save-template-form">
        <div class="form-group">
          <label for="template-name">模板名称</label>
          <input type="text" id="template-name" name="name" required />
        </div>
        <div class="form-group">
          <label for="template-name-zh">中文名称</label>
          <input type="text" id="template-name-zh" name="nameZh" />
        </div>
        <div class="form-group">
          <label for="template-desc">描述</label>
          <textarea id="template-desc" name="description" rows="2"></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost modal-cancel">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    )}
  </div>
</dialog>
```

#### Template Selection UI in Create Modal

**Modification to existing create modals:**

```astro
<!-- In experiments/index.astro and writing/index.astro -->
<div class="template-selector">
  <label>从模板创建 (可选)</label>
  <select id="template-select" data-template-select>
    <option value="">-- 不使用模板 --</option>
    <optgroup label="内置模板">
      <!-- Populated by JS -->
    </optgroup>
    <optgroup label="自定义模板">
      <!-- Populated by JS -->
    </optgroup>
  </select>
</div>
```

### 2.4 Data Flow

```
User clicks "New Experiment/Writing"
  → Open create modal
  → Optional: Select template from dropdown
  → If selected: Pre-fill form fields with template data
  → User edits/confirms
  → Submit creates entity with pre-filled data
```

### 2.5 Template Storage Functions

**Location:** `astro-src/lib/templates/index.ts`

```typescript
import type { TemplatesDoc, ExperimentTemplate, WritingTemplate } from './types';
import { BUILTIN_EXPERIMENT_TEMPLATES, BUILTIN_WRITING_TEMPLATES } from './builtins';

const TEMPLATES_KEY = 'dpr_templates_v1';

export function loadTemplates(): TemplatesDoc {
  if (typeof window === 'undefined') {
    return { schemaVersion: 1, experimentTemplates: {}, writingTemplates: {} };
  }
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { schemaVersion: 1, experimentTemplates: {}, writingTemplates: {} };
}

export function saveTemplates(doc: TemplatesDoc): void {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(doc));
}

export function listExperimentTemplates(): ExperimentTemplate[] {
  const doc = loadTemplates();
  return [
    ...BUILTIN_EXPERIMENT_TEMPLATES,
    ...Object.values(doc.experimentTemplates),
  ];
}

export function listWritingTemplates(): WritingTemplate[] {
  const doc = loadTemplates();
  return [
    ...BUILTIN_WRITING_TEMPLATES,
    ...Object.values(doc.writingTemplates),
  ];
}

export function saveCustomExperimentTemplate(template: ExperimentTemplate): void {
  const doc = loadTemplates();
  doc.experimentsTemplates[template.id] = template;
  saveTemplates(doc);
}

export function saveCustomWritingTemplate(template: WritingTemplate): void {
  const doc = loadTemplates();
  doc.writingTemplates[template.id] = template;
  saveTemplates(doc);
}

export function deleteCustomTemplate(id: string, category: 'experiment' | 'writing'): void {
  const doc = loadTemplates();
  if (category === 'experiment') {
    delete doc.experimentTemplates[id];
  } else {
    delete doc.writingTemplates[id];
  }
  saveTemplates(doc);
}
```

---

## 3. Suggestions Feature

### 3.1 Architecture Overview

Suggestions provide contextual recommendations based on:
- **Idea creation:** Related papers from user's library
- **Experiment from idea:** Pre-fill hypothesis from idea description
- **Writing:** Suggest citing experiments related to linked ideas

**Implementation:** Client-side matching against paper repository data injected at SSR time.

### 3.2 Paper Suggestion for Ideas

**Data Flow:**

```
Idea creation modal opens
  → Read papers from #papers-data script tag (SSR-injected)
  → Extract keywords from idea title input (on input)
  → Match against paper titles/abstracts
  → Display top 5 matches as clickable chips
  → User clicks chip → add to relatedPapers field
```

**UI Component:**

```astro
<!-- In idea-modal.astro -->
<div class="form-group">
  <label for="idea-related-papers">关联论文</label>
  <div class="paper-suggestions">
    <input type="text" id="idea-related-papers" name="relatedPapers" />
    <div class="suggestion-chips" hidden></div>
  </div>
  <div class="paper-suggestion-results" hidden></div>
</div>
```

**Handler (in ideas-ui.ts):**

```typescript
// astro-src/scripts/ideas-ui.ts (additions)

let papersData: Array<{ id: string; title: string; tldr: string }> = [];

function initPaperSuggestions(): void {
  // Load from SSR-injected data
  const dataEl = document.getElementById('papers-data');
  if (dataEl) {
    try {
      papersData = JSON.parse(dataEl.textContent || '[]');
    } catch {}
  }

  const titleInput = document.getElementById('idea-title') as HTMLInputElement;
  titleInput?.addEventListener('input', debounce(handleTitleInput, 300));
}

function handleTitleInput(e: Event): void {
  const query = (e.target as HTMLInputElement).value.toLowerCase();
  if (query.length < 3) {
    hideSuggestions();
    return;
  }

  // Score papers by title match
  const matches = papersData
    .map(p => ({
      ...p,
      score: fuzzyMatch(query, p.title.toLowerCase()) + fuzzyMatch(query, (p.tldr || '').toLowerCase()),
    }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (matches.length > 0) {
    showSuggestions(matches);
  } else {
    hideSuggestions();
  }
}

function fuzzyMatch(query: string, text: string): number {
  let score = 0;
  const words = query.split(/\s+/);
  for (const word of words) {
    if (text.includes(word)) score += 1;
    if (text.startsWith(word)) score += 2;
  }
  return score;
}

function showSuggestions(matches: Array<{ id: string; title: string }>): void {
  const container = document.querySelector('.paper-suggestion-results') as HTMLElement;
  if (!container) return;

  container.hidden = false;
  container.innerHTML = matches.map(p => `
    <button type="button" class="suggestion-chip" data-arxiv-id="${p.id}">
      ${p.id}: ${truncate(p.title, 50)}
    </button>
  `).join('');

  container.querySelectorAll<HTMLButtonElement>('.suggestion-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('idea-related-papers') as HTMLInputElement;
      const current = input.value ? input.value.split(',').map(s => s.trim()) : [];
      if (!current.includes(btn.dataset.arxivId!)) {
        current.push(btn.dataset.arxivId!);
        input.value = current.join(', ');
      }
      hideSuggestions();
    });
  });
}

function hideSuggestions(): void {
  const container = document.querySelector('.paper-suggestion-results') as HTMLElement;
  if (container) container.hidden = true;
}
```

### 3.3 Pre-fill Hypothesis from Idea

**Data Flow:**

```
User clicks "Create Experiment from Idea" (on idea card)
  → Navigate to /experiments/?prefill_from_idea={ideaId}
  → Experiments page reads idea from localStorage
  → Pre-fills hypothesis field with idea.description
  → User edits/confirms
```

**Implementation in experiments-ui.ts:**

```typescript
// In setupNewExperimentButton handler

const urlParams = new URLSearchParams(window.location.search);
const prefillIdeaId = urlParams.get('prefill_from_idea');

if (prefillIdeaId) {
  const idea = getIdea(prefillIdeaId);
  if (idea) {
    // Pre-fill hypothesis from idea description
    const hypothesisInput = document.getElementById('exp-hypothesis') as HTMLTextAreaElement;
    if (hypothesisInput) {
      hypothesisInput.value = idea.description;
    }

    // Pre-fill related ideas
    const ideasInput = document.getElementById('exp-related-ideas') as HTMLInputElement;
    if (ideasInput) {
      ideasInput.value = prefillIdeaId;
    }

    // Pre-fill related papers
    const papersInput = document.getElementById('exp-related-papers') as HTMLInputElement;
    if (papersInput && idea.relatedPapers.length > 0) {
      papersInput.value = idea.relatedPapers.join(', ');
    }
  }

  // Clean URL
  window.history.replaceState({}, '', window.location.pathname);
}
```

### 3.4 Experiment Suggestions for Writing

**Data Flow:**

```
User editing writing section
  → User types [[experiment:]] reference pattern
  → Auto-complete shows matching experiments from localStorage
  → User selects → insert link
```

**Implementation:** Use existing citation picker pattern from writing-ui.ts, extended to include experiments.

```typescript
// In writing-ui.ts, extend citation picker

interface SuggestionItem {
  type: 'paper' | 'experiment';
  id: string;
  title: string;
}

// Add experiments to suggestions
function getSuggestions(query: string): SuggestionItem[] {
  const experiments = listExperiments();
  const papers = listPapers(); // from #papers-data

  const results: SuggestionItem[] = [];

  // Match experiments
  results.push(...experiments
    .filter(e => e.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 3)
    .map(e => ({ type: 'experiment' as const, id: e.id, title: e.title })));

  // Match papers (existing logic)
  results.push(...papers
    .filter(p => p.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 5)
    .map(p => ({ type: 'paper' as const, id: p.id, title: p.title })));

  return results;
}
```

---

## 4. Progress Tracking Feature

### 4.1 Roadmap Progress from Experiments

**Current state:** Roadmap shows manual goal completion.

**Enhancement:** Compute progress from linked experiment statuses.

**Data Flow:**

```
Roadmap detail page loads
  → Load roadmap from localStorage
  → For each linked_experiment_id:
      → Load experiment from localStorage
      → Map status to progress weight:
        - completed: 100%
        - running: 50%
        - planning: 10%
        - paused: 0%
        - failed: 0%
  → Calculate aggregate: sum(weights) / count
  → Update progress bar UI
```

**Implementation:**

```typescript
// astro-src/scripts/roadmap-ui.ts (additions)

const EXPERIMENT_PROGRESS_WEIGHTS: Record<ExperimentStatus, number> = {
  completed: 1.0,
  running: 0.5,
  planning: 0.1,
  paused: 0,
  failed: 0,
};

function calculateRoadmapProgress(roadmap: Roadmap): number {
  if (roadmap.linked_experiments.length === 0) {
    // Fall back to goal-based progress
    return calculateGoalProgress(roadmap);
  }

  let totalWeight = 0;
  for (const expId of roadmap.linked_experiments) {
    const exp = getExperiment(expId);
    if (exp) {
      totalWeight += EXPERIMENT_PROGRESS_WEIGHTS[exp.status] || 0;
    }
  }

  return totalWeight / roadmap.linked_experiments.length;
}

function calculateGoalProgress(roadmap: Roadmap): number {
  const allGoals = roadmap.quarters.flatMap(q => q.goals);
  const completed = allGoals.filter(g => g.status === 'completed').length;
  return allGoals.length > 0 ? completed / allGoals.length : 0;
}

function renderProgressDashboard(roadmap: Roadmap): void {
  const progress = calculateRoadmapProgress(roadmap);
  const percent = Math.round(progress * 100);

  const fill = document.querySelector('.dashboard-progress-fill') as HTMLElement;
  const text = document.querySelector('.dashboard-progress-text');

  if (fill) fill.style.width = `${percent}%`;
  if (text) text.textContent = `${percent}%`;
}
```

### 4.2 Experiment Progress (% Hypothesis Proven)

**New Field:**

```typescript
// In experiments/types.ts

interface Experiment {
  // ... existing fields
  /** Progress percentage: 0-100, self-reported or computed */
  progressPercent: number;
  /** Evidence entries supporting or refuting hypothesis */
  evidence: ExperimentEvidence[];
}

interface ExperimentEvidence {
  id: string;
  date: number;
  description: string;
  supportsHypothesis: boolean;  // true = supports, false = refutes
  metric?: string;
  value?: number;
}
```

**UI Component:**

```astro
<!-- In experiments/[id].astro detail page -->
<div class="experiment-progress">
  <label>假设验证进度</label>
  <div class="progress-bar-container">
    <div class="progress-bar" style="width: {experiment.progressPercent}%"></div>
  </div>
  <span class="progress-label">{experiment.progressPercent}%</span>
</div>

<div class="evidence-list">
  {experiment.evidence.map(ev => (
    <div class="evidence-item" data-supports={ev.supportsHypothesis}>
      <span class="evidence-icon">{ev.supportsHypothesis ? '✓' : '✗'}</span>
      <span class="evidence-desc">{ev.description}</span>
      {ev.metric && <span class="evidence-metric">{ev.metric}: {ev.value}</span>}
    </div>
  ))}
</div>

<button type="button" class="btn btn-sm" data-add-evidence>
  ➕ 添加证据
</button>
```

**Handler:**

```typescript
// In experiments-ui.ts

interface EvidenceFormData {
  description: string;
  supportsHypothesis: boolean;
  metric?: string;
  value?: number;
}

function addEvidence(expId: string, data: EvidenceFormData): void {
  const exp = getExperiment(expId);
  if (!exp) return;

  const evidence = {
    id: `ev-${Date.now()}`,
    date: Date.now(),
    ...data,
  };

  exp.evidence = exp.evidence || [];
  exp.evidence.push(evidence);

  // Auto-update progress based on evidence ratio
  if (exp.evidence.length > 0) {
    const supporting = exp.evidence.filter(e => e.supportsHypothesis).length;
    exp.progressPercent = Math.round((supporting / exp.evidence.length) * 100);
  }

  updateExperiment(expId, { evidence: exp.evidence, progressPercent: exp.progressPercent });
}
```

---

## 5. Tags & Search Feature

### 5.1 Architecture Overview

Enhance list pages with:
1. **Tag filtering** — Click tags to filter (existing: select dropdown; new: clickable tag chips)
2. **Text search** — Full-text search across title, description, content
3. **Combined filters** — Search + status/type filters work together

### 5.2 Search Input Component

**Location:** Extend existing action bars in each module's index.astro

```astro
<!-- Add to ideas/experiments/writing index.astro actionbar -->
<div class="search-box">
  <input
    type="search"
    id="module-search"
    placeholder="搜索标题、描述..."
    data-module-search
  />
  <button type="button" class="search-clear" hidden>×</button>
</div>

<style>
  .search-box {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .search-box input {
    padding-right: 2rem;
    width: 200px;
  }
  .search-clear {
    position: absolute;
    right: 0.5rem;
    background: none;
    border: none;
    cursor: pointer;
  }
</style>
```

### 5.3 Search Handler

**Location:** `astro-src/scripts/module-search.ts` (shared)

```typescript
// astro-src/scripts/module-search.ts

interface SearchableEntity {
  id: string;
  title: string;
  description?: string;
  tags: string[];
  status: string;
}

export function createSearchHandler<T extends SearchableEntity>(
  getAll: () => T[],
  renderItem: (item: T) => string,
  containerSelector: string
): (query: string) => void {
  return function handleSearch(query: string): void {
    const allItems = getAll();
    const normalizedQuery = query.toLowerCase().trim();

    if (!normalizedQuery) {
      // Show all
      renderAllItems();
      return;
    }

    const matches = allItems.filter(item => {
      const searchableText = [
        item.title,
        item.description,
        ...item.tags,
      ].join(' ').toLowerCase();

      return searchableText.includes(normalizedQuery);
    });

    renderItems(matches);
  };

  function renderItems(items: T[]): void {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = '<div class="no-results">没有找到匹配的结果</div>';
      return;
    }

    container.innerHTML = items.map(renderItem).join('');
  }

  function renderAllItems(): void {
    renderItems(getAll());
  }
}
```

### 5.4 Integration with Existing Filters

**Combined Filter Logic:**

```typescript
// In each module's UI script (ideas-ui.ts, experiments-ui.ts, etc.)

interface FilterState {
  status?: string;
  type?: string;  // for writing
  searchQuery: string;
  tags: string[];
}

let filterState: FilterState = { searchQuery: '', tags: [] };

function applyFilters(): void {
  let items = currentModuleItems; // All items

  // 1. Filter by status
  if (filterState.status && filterState.status !== 'all') {
    items = items.filter(i => i.status === filterState.status);
  }

  // 2. Filter by type (writing only)
  if (filterState.type && filterState.type !== 'all') {
    items = items.filter(i => i.type === filterState.type);
  }

  // 3. Filter by search query
  if (filterState.searchQuery) {
    const q = filterState.searchQuery.toLowerCase();
    items = items.filter(i =>
      i.title.toLowerCase().includes(q) ||
      (i.description || '').toLowerCase().includes(q) ||
      i.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  // 4. Filter by tags
  if (filterState.tags.length > 0) {
    items = items.filter(i =>
      filterState.tags.every(tag => i.tags.includes(tag))
    );
  }

  renderItems(items);
}

// Wire up event listeners
function setupSearchAndFilter(): void {
  // Search input
  const searchInput = document.querySelector('[data-module-search]') as HTMLInputElement;
  searchInput?.addEventListener('input', debounce((e) => {
    filterState.searchQuery = (e.target as HTMLInputElement).value;
    applyFilters();
  }, 200));

  // Clear button
  const clearBtn = document.querySelector('.search-clear');
  clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    filterState.searchQuery = '';
    applyFilters();
  });

  // Existing filter buttons already update filterState.status
}
```

### 5.5 Tag Chip Display

```astro
<!-- In card template -->
<div class="item-tags">
  {item.tags.map(tag => (
    <button
      type="button"
      class="tag-chip"
      data-tag-filter={tag}
    >{tag}</button>
  ))}
</div>

<style>
  .tag-chip {
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .tag-chip:hover {
    background: var(--bg-elevated);
  }
  .tag-chip.active {
    background: var(--hue-primary);
    color: white;
    border-color: var(--hue-primary);
  }
</style>
```

---

## 6. Summary: New Files to Create

| File | Purpose |
|------|---------|
| `astro-src/scripts/export-ui.ts` | Export handlers (Markdown, JSON, print) |
| `astro-src/styles/print.css` | Print-specific styles |
| `astro-src/components/ExportButton.astro` | Reusable export dropdown |
| `astro-src/lib/templates/types.ts` | Template type definitions |
| `astro-src/lib/templates/builtins.ts` | Built-in templates |
| `astro-src/lib/templates/index.ts` | Template CRUD operations |
| `astro-src/components/TemplatePicker.astro` | Template selection modal |
| `astro-src/scripts/module-search.ts` | Shared search logic |

---

## 7. Summary: Files to Modify

| File | Changes |
|------|---------|
| `astro-src/lib/ideas/types.ts` | Add `exportHistory` field |
| `astro-src/lib/experiments/types.ts` | Add `exportHistory`, `progressPercent`, `evidence` fields |
| `astro-src/lib/writing/types.ts` | Add `exportHistory` field |
| `astro-src/pages/ideas/index.astro` | Add search input, export buttons |
| `astro-src/pages/ideas/[id].astro` | Add export button |
| `astro-src/pages/experiments/index.astro` | Add search input, export buttons, template selector |
| `astro-src/pages/experiments/[id].astro` | Add export button, evidence UI |
| `astro-src/pages/writing/index.astro` | Add search input, export buttons |
| `astro-src/pages/writing/[id].astro` | Add export button, PDF print styles |
| `astro-src/pages/roadmap/index.astro` | Add export button, computed progress |
| `astro-src/scripts/ideas-ui.ts` | Add search, suggestions, export triggers |
| `astro-src/scripts/experiments-ui.ts` | Add search, suggestions, prefill, export, evidence |
| `astro-src/scripts/writing-ui.ts` | Add search, suggestions, export |
| `astro-src/scripts/roadmap-ui.ts` | Add computed progress from experiments |

---

## 8. Acceptance Criteria

### Export
- [ ] Writing exports as Markdown download with correct filename
- [ ] Writing prints as clean PDF (no UI chrome)
- [ ] Experiment exports as JSON download
- [ ] Idea exports as Markdown download
- [ ] Roadmap exports as Markdown download

### Templates
- [ ] 4 experiment templates available in create dropdown
- [ ] 3 writing templates available in create dropdown
- [ ] User can save current entity as custom template
- [ ] Custom templates appear in template picker

### Suggestions
- [ ] Paper suggestions appear when creating idea (title match)
- [ ] Clicking suggestion adds paper to relatedPapers
- [ ] Creating experiment from idea pre-fills hypothesis
- [ ] Writing citation picker includes experiments

### Progress Tracking
- [ ] Roadmap progress bar reflects linked experiment statuses
- [ ] Experiment shows progress % from evidence ratio
- [ ] User can add evidence supporting/refuting hypothesis

### Tags & Search
- [ ] Search input filters items by title/description/tags
- [ ] Combined with existing status/type filters
- [ ] Clicking tag chip filters by that tag
- [ ] Clear button resets search
