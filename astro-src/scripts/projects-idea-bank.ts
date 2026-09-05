// astro-src/scripts/projects-idea-bank.ts
//
// Idea Bank orchestrator for project workspace.
// Handles LLM-based idea generation and UI attachment.
//
// SSR-safe: all async functions check for browser environment.

import type { LLMConfig } from './settings';
import { callChatCompletion } from '../lib/llm/chat';
import { callLLMRaw } from './topic-search/llm-call';
import {
  type ProjectIdea,
  type IdeaStatus,
  saveIdea,
  listIdeasByProject,
  updateIdeaStatus,
  deleteIdea as deleteIdeaFromStore,
  purgeProjectIdeas,
} from '../lib/projects/ideas';
import { emitDprIdeaBankChange } from '../lib/events/bus';

export interface IdeaForgePaper {
  arxivId: string;
  title: string;
  method_pros_cons?: Record<string, { pros: string[]; cons: string[] }>;
  method_comparison?: string;
  categories?: { task?: string; method?: string[] };
}

export interface IdeaForgeTopicContext {
  idea: string;
  subQuestions: string[];
}

export interface IdeaForgeInput {
  projectId: string;
  papers: IdeaForgePaper[];
  anchorArxivId?: string;
  topicSessionContext?: IdeaForgeTopicContext;
  llmModel?: string;
}

export interface IdeaForgeOutputIdea {
  title: string;
  hypothesis: string;
  method: string;
  expected_outcome: string;
  eval_design: string;
  novelty: number;
  feasibility: number;
  rationale: string;
  citedArxivIds: string[];
}

export interface IdeaForgeOutput {
  ideas: IdeaForgeOutputIdea[];
  model: string;
  generatedAt: string;
}

interface PromptPackBody {
  systemPrompt: string;
  userPromptTemplate: string;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof fetch !== 'undefined';
}

function getDefaultLlmConfig(): LLMConfig {
  const globalCfg = (window as unknown as { __DPR_LLM_CONFIG__?: LLMConfig }).__DPR_LLM_CONFIG__;
  if (globalCfg) return globalCfg;

  const stored = localStorage.getItem('dpr_llm_config');
  if (stored) {
    try {
      return JSON.parse(stored) as LLMConfig;
    } catch {
      /* ignore */
    }
  }

  throw new Error('LLM config not available. Please configure in settings.');
}

function loadPromptPack(): Promise<PromptPackBody> {
  return fetch('/config/prompts/idea-forge/2026-09-03/body.md')
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load prompt pack: ${res.status}`);
      return res.text();
    })
    .then((text) => {
      const lines = text.split('\n');
      let systemPrompt = '';
      let userPromptTemplate = '';
      let inSystem = false;
      let inUser = false;

      for (const line of lines) {
        if (line.startsWith('## System')) {
          inSystem = true;
          inUser = false;
          continue;
        }
        if (line.startsWith('## User')) {
          inSystem = false;
          inUser = true;
          continue;
        }
        if (line.startsWith('## ')) {
          inSystem = false;
          inUser = false;
          continue;
        }
        if (inSystem) {
          systemPrompt += line + '\n';
        }
        if (inUser) {
          userPromptTemplate += line + '\n';
        }
      }

      return {
        systemPrompt: systemPrompt.trim(),
        userPromptTemplate: userPromptTemplate.trim(),
      };
    });
}

function buildUserPrompt(
  template: string,
  input: IdeaForgeInput,
): string {
  const papersJson = JSON.stringify(input.papers, null, 2);
  const anchorInfo = input.anchorArxivId
    ? `\n\n## 锚点论文\n用户提供了一篇锚点论文作为讨论中心:\n- ${input.anchorArxivId}`
    : '';
  const topicInfo = input.topicSessionContext
    ? `\n\n## 主题会话上下文\n- 主题: ${input.topicSessionContext.idea}\n- 子问题: ${input.topicSessionContext.subQuestions.join(', ')}`
    : '';

  return template
    .replace('{{PAPERS}}', papersJson)
    .replace('{{ANCHOR_INFO}}', anchorInfo)
    .replace('{{TOPIC_INFO}}', topicInfo);
}

function parseIdeaForgeResponse(content: string): IdeaForgeOutputIdea[] {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  const parsed = JSON.parse(cleaned);
  if (!parsed.ideas || !Array.isArray(parsed.ideas)) {
    throw new Error('Response missing "ideas" array');
  }

  const ideas: IdeaForgeOutputIdea[] = [];
  for (const idea of parsed.ideas) {
    if (
      typeof idea.title !== 'string' ||
      typeof idea.hypothesis !== 'string' ||
      typeof idea.method !== 'string' ||
      typeof idea.expected_outcome !== 'string' ||
      typeof idea.eval_design !== 'string' ||
      typeof idea.novelty !== 'number' ||
      typeof idea.feasibility !== 'number' ||
      typeof idea.rationale !== 'string' ||
      !Array.isArray(idea.citedArxivIds)
    ) {
      throw new Error('Idea missing required fields');
    }

    const novelty = Math.round(idea.novelty);
    const feasibility = Math.round(idea.feasibility);
    if (novelty < 1 || novelty > 5 || feasibility < 1 || feasibility > 5) {
      throw new Error('novelty/feasibility must be 1-5');
    }

    ideas.push({
      title: idea.title,
      hypothesis: idea.hypothesis,
      method: idea.method,
      expected_outcome: idea.expected_outcome,
      eval_design: idea.eval_design,
      novelty,
      feasibility,
      rationale: idea.rationale,
      citedArxivIds: idea.citedArxivIds.filter((id: unknown) => typeof id === 'string'),
    });
  }

  return ideas;
}

/**
 * Generate research ideas using LLM based on project papers.
 * Saves each idea to IDB and emits change event.
 *
 * @throws Error on LLM failure (no silent fallback)
 */
export async function generateIdeas(input: IdeaForgeInput): Promise<IdeaForgeOutput> {
  if (!isBrowser()) {
    throw new Error('generateIdeas requires browser environment');
  }

  if (!input.papers || input.papers.length === 0) {
    throw new Error('At least one paper is required');
  }

  const cfg = getDefaultLlmConfig();
  const model = input.llmModel ?? cfg.model;

  const promptPack = await loadPromptPack();
  const userPrompt = buildUserPrompt(promptPack.userPromptTemplate, input);

  let rawResponse: string;
  try {
    rawResponse = await callLLMRaw(
      promptPack.systemPrompt,
      userPrompt,
      cfg,
      true,
      4000,
      '{',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    throw new Error(`LLM call failed: ${msg}`);
  }

  let ideas: IdeaForgeOutputIdea[];
  try {
    ideas = parseIdeaForgeResponse(rawResponse);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    throw new Error(`Failed to parse LLM response: ${msg}`);
  }

  const now = Date.now();
  let savedCount = 0;

  for (const idea of ideas) {
    const ideaRecord: Omit<ProjectIdea, 'id' | 'createdAt' | 'updatedAt'> = {
      projectId: input.projectId,
      status: 'proposed',
      title: idea.title,
      hypothesis: idea.hypothesis,
      method: idea.method,
      expected_outcome: idea.expected_outcome,
      eval_design: idea.eval_design,
      novelty: idea.novelty,
      feasibility: idea.feasibility,
      rationale: idea.rationale,
      anchorArxivId: input.anchorArxivId,
      topicSessionId: input.topicSessionContext ? `topic_${now}` : undefined,
      citedArxivIds: idea.citedArxivIds,
    };

    const result = await saveIdea(ideaRecord);
    if (!result.ok) {
      throw new Error(`Failed to save idea: ${result.reason}`);
    }
    savedCount++;
  }

  if (savedCount > 0) {
    emitDprIdeaBankChange(document, { projectId: input.projectId, reason: 'generate' });
  }

  return {
    ideas,
    model,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Attach idea bank UI to a root element.
 * Returns unsubscribe function.
 */
export function attachIdeaBankUI(root: HTMLElement, projectId: string): () => void {
  if (!isBrowser()) {
    return () => {};
  }

  const container = document.createElement('div');
  container.className = 'idea-bank';
  root.appendChild(container);

  let ideas: ProjectIdea[] = [];
  let anchorArxivId: string | undefined;
  let selectedTopicContext: IdeaForgeTopicContext | undefined;

  async function render(): Promise<void> {
    ideas = await listIdeasByProject(projectId);
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'idea-bank-header';
    header.innerHTML = `
      <h3>Idea Bank</h3>
      <span class="idea-count">${ideas.length} ideas</span>
    `;
    container.appendChild(header);

    const anchorSection = document.createElement('div');
    anchorSection.className = 'idea-anchor-picker';
    anchorSection.innerHTML = `
      <label>Anchor Paper (optional):</label>
      <select class="anchor-select">
        <option value="">None</option>
        ${ideas.map((i) => i.anchorArxivId ? `<option value="${i.anchorArxivId}">${i.anchorArxivId}</option>` : '').join('')}
      </select>
    `;
    const anchorSelect = anchorSection.querySelector('.anchor-select') as HTMLSelectElement;
    if (anchorArxivId) {
      anchorSelect.value = anchorArxivId;
    }
    anchorSelect.addEventListener('change', () => {
      anchorArxivId = anchorSelect.value || undefined;
    });
    container.appendChild(anchorSection);

    const promptSection = document.createElement('div');
    promptSection.className = 'idea-bank-prompt';
    promptSection.innerHTML = `
      <button class="generate-btn" ${ideas.length >= 200 ? 'disabled' : ''}>
        Generate Ideas
      </button>
    `;
    const generateBtn = promptSection.querySelector('.generate-btn') as HTMLButtonElement;
    generateBtn.addEventListener('click', async () => {
      if (generateBtn.disabled) return;
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating...';

      try {
        await generateIdeas({
          projectId,
          papers: [],
          anchorArxivId,
          topicSessionContext: selectedTopicContext,
        });
        await render();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Generation failed';
        alert(`Failed to generate ideas: ${msg}`);
      } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate Ideas';
      }
    });
    container.appendChild(promptSection);

    const listSection = document.createElement('div');
    listSection.className = 'idea-list';
    for (const idea of ideas) {
      const card = document.createElement('div');
      card.className = `idea-card idea-card--${idea.status}`;
      card.dataset.id = idea.id;

      const statusIcon = idea.status === 'starred' ? '★' : idea.status === 'rejected' ? '✗' : idea.status === 'promoted' ? '📝' : '○';

      card.innerHTML = `
        <div class="idea-card-header">
          <span class="idea-status-icon">${statusIcon}</span>
          <span class="idea-title">${idea.title}</span>
        </div>
        <div class="idea-card-body">
          <p><strong>Hypothesis:</strong> ${idea.hypothesis}</p>
          <p><strong>Method:</strong> ${idea.method}</p>
          <p><strong>Expected Outcome:</strong> ${idea.expected_outcome}</p>
          <p><strong>Evaluation:</strong> ${idea.eval_design}</p>
          <p><strong>Rationale:</strong> ${idea.rationale}</p>
          <div class="idea-meta">
            <span>Novelty: ${'★'.repeat(idea.novelty)}${'☆'.repeat(5 - idea.novelty)}</span>
            <span>Feasibility: ${'★'.repeat(idea.feasibility)}${'☆'.repeat(5 - idea.feasibility)}</span>
            <span>Cited: ${idea.citedArxivIds.join(', ') || 'none'}</span>
          </div>
        </div>
        <div class="idea-card-actions">
          <button class="btn-star" title="Star">★</button>
          <button class="btn-reject" title="Reject">✗</button>
          <button class="btn-promote" title="Promote to Draft">📝</button>
          <button class="btn-delete" title="Delete">🗑</button>
        </div>
      `;

      const starBtn = card.querySelector('.btn-star') as HTMLButtonElement;
      starBtn.addEventListener('click', async () => {
        await updateIdeaStatus(idea.id, idea.status === 'starred' ? 'proposed' : 'starred');
        emitDprIdeaBankChange(document, { projectId, reason: 'status' });
        await render();
      });

      const rejectBtn = card.querySelector('.btn-reject') as HTMLButtonElement;
      rejectBtn.addEventListener('click', async () => {
        await updateIdeaStatus(idea.id, idea.status === 'rejected' ? 'proposed' : 'rejected');
        emitDprIdeaBankChange(document, { projectId, reason: 'status' });
        await render();
      });

      const promoteBtn = card.querySelector('.btn-promote') as HTMLButtonElement;
      promoteBtn.addEventListener('click', async () => {
        await updateIdeaStatus(idea.id, 'promoted');
        emitDprIdeaBankChange(document, { projectId, reason: 'promote' });
        await render();
      });

      const deleteBtn = card.querySelector('.btn-delete') as HTMLButtonElement;
      deleteBtn.addEventListener('click', async () => {
        if (confirm('Delete this idea?')) {
          await deleteIdeaFromStore(idea.id);
          emitDprIdeaBankChange(document, { projectId, reason: 'delete' });
          await render();
        }
      });

      listSection.appendChild(card);
    }
    container.appendChild(listSection);
  }

  render();

  const unsubLibrary = () => {};

  return () => {
    unsubLibrary();
    container.remove();
  };
}

/**
 * Refresh idea list for a project.
 */
export async function refreshIdeas(projectId: string): Promise<ProjectIdea[]> {
  return listIdeasByProject(projectId);
}
