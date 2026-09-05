// Deep Extract UI Orchestrator — 深度抽取结果的前端渲染与 LLM 调用。

import type { DeepExtract } from '../lib/paper-frontmatter/deep-extract';

/** Storage key prefix for deep extract data. */
const STORAGE_KEY_PREFIX = 'dpr_deep_extract_';

/** Stage name for LLM router. */
const STAGE_NAME = 'paper.deep_extract';

/** Interface for stored deep extract data. */
interface StoredDeepExtract {
  reportedMetrics: Array<{ name: string; value: string; context?: string }>;
  datasets: Array<{ name: string; role: string; size?: string }>;
  computeRequirements: {
    params?: string;
    gpuHours?: string;
    modelSize?: string;
    flops?: string;
  };
  limitations: string[];
  replicabilityScore: number;
  replicabilityReason: string;
}

/**
 * Get stored deep extract from localStorage.
 */
function getStoredDeepExtract(arxivId: string): StoredDeepExtract | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + arxivId);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.replicabilityScore ? data : null;
  } catch {
    return null;
  }
}

/**
 * Save deep extract to localStorage.
 */
function saveDeepExtract(arxivId: string, data: StoredDeepExtract): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + arxivId, JSON.stringify(data));
  } catch {
    // Ignore storage failures
  }
}

/**
 * Load LLM config from settings.
 */
function loadLLMConfig(): { apiKey: string; baseUrl: string; model: string } | null {
  try {
    const stored = localStorage.getItem('dpr_settings');
    if (!stored) return null;
    const s = JSON.parse(stored);
    if (!s.apiKey || !s.baseUrl || !s.model) return null;
    return { apiKey: s.apiKey, baseUrl: s.baseUrl, model: s.model };
  } catch {
    return null;
  }
}

/**
 * Call LLM to generate deep extract.
 */
async function generateDeepExtract(
  arxivId: string,
  paperTitle: string,
  paperAbstract: string,
  paperText?: string
): Promise<StoredDeepExtract> {
  const cfg = loadLLMConfig();
  if (!cfg) throw new Error('请先在设置页填写 API Key');

  const systemPrompt = `你是论文深度分析助手。请从论文中提取以下 5 个维度的结构化信息：

1. reported_metrics: 论文报告的具体数值指标（如 BLEU-4: 32.4）
2. datasets: 使用的数据集/基准（如 ImageNet-1k）
3. compute_requirements: 训练算力需求（参数量、GPU 小时、模型大小等）
4. limitations: 论文局限性（作者承认的 + LLM 推断的）
5. replicability_score: 1-5 分可复现性评分 + 理由

论文标题: ${paperTitle}
论文摘要: ${paperAbstract}
${paperText ? `\n论文正文(前 8000 字符):\n${paperText.slice(0, 8000)}` : ''}

请返回严格 JSON 格式：
{
  "reported_metrics": [{"name": "指标", "value": "数值", "context": "环境"}],
  "datasets": [{"name": "数据集", "role": "训练/评估/两者", "size": "规模"}],
  "compute_requirements": {"params": "7B", "gpu_hours": "1000", "model_size": "14GB", "flops": "1e22"},
  "limitations": ["局限1", "局限2"],
  "replicability_score": 3,
  "replicability_reason": "理由"
}

如果某信息未在论文中提及，不要编造，直接省略该字段。`;

  const response = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请分析这篇论文并返回 JSON' },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`LLM 调用失败 (${response.status}): ${err.slice(0, 100)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || '';

  // Try to extract JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM 返回格式错误,无法解析 JSON');

  const parsed = JSON.parse(jsonMatch[0]);

  // Transform to stored format
  const result: StoredDeepExtract = {
    reportedMetrics: parsed.reported_metrics || [],
    datasets: parsed.datasets || [],
    computeRequirements: parsed.compute_requirements || {},
    limitations: parsed.limitations || [],
    replicabilityScore: parsed.replicability_score || 3,
    replicabilityReason: parsed.replicability_reason || '',
  };

  // Save to localStorage
  saveDeepExtract(arxivId, result);

  return result;
}

/**
 * Render deep extract cards.
 */
function renderDeepExtract(data: StoredDeepExtract): string {
  let html = '';

  // Metrics
  if (data.reportedMetrics && data.reportedMetrics.length > 0) {
    html += '<div class="deep-extract-section"><h4 class="deep-extract-section-title">📊 报告指标</h4>';
    html += '<div class="deep-extract-metrics-grid">';
    for (const m of data.reportedMetrics) {
      html += `<div class="deep-extract-metric">
        <div class="deep-extract-metric-name">${m.name}</div>
        <div class="deep-extract-metric-value">${m.value}</div>
        ${m.context ? `<div class="deep-extract-metric-context">${m.context}</div>` : ''}
      </div>`;
    }
    html += '</div></div>';
  }

  // Datasets
  if (data.datasets && data.datasets.length > 0) {
    html += '<div class="deep-extract-section"><h4 class="deep-extract-section-title">📁 数据集</h4>';
    html += '<div class="deep-extract-datasets-list">';
    for (const d of data.datasets) {
      html += `<div class="deep-extract-dataset">
        <div class="deep-extract-dataset-name">${d.name}</div>
        <div class="deep-extract-dataset-role">${d.role}</div>
        ${d.size ? `<div class="deep-extract-dataset-size">${d.size}</div>` : ''}
      </div>`;
    }
    html += '</div></div>';
  }

  // Compute requirements
  if (data.computeRequirements && Object.keys(data.computeRequirements).length > 0) {
    html += '<div class="deep-extract-section"><h4 class="deep-extract-section-title">🖥️ 算力需求</h4>';
    html += '<div class="deep-extract-compute-grid">';
    const cr = data.computeRequirements;
    if (cr.params) {
      html += `<div class="deep-extract-compute-item"><span class="deep-extract-compute-label">参数量</span><span class="deep-extract-compute-value">${cr.params}</span></div>`;
    }
    if (cr.gpuHours) {
      html += `<div class="deep-extract-compute-item"><span class="deep-extract-compute-label">GPU小时</span><span class="deep-extract-compute-value">${cr.gpuHours}</span></div>`;
    }
    if (cr.modelSize) {
      html += `<div class="deep-extract-compute-item"><span class="deep-extract-compute-label">模型大小</span><span class="deep-extract-compute-value">${cr.modelSize}</span></div>`;
    }
    if (cr.flops) {
      html += `<div class="deep-extract-compute-item"><span class="deep-extract-compute-label">FLOPs</span><span class="deep-extract-compute-value">${cr.flops}</span></div>`;
    }
    html += '</div></div>';
  }

  // Limitations
  if (data.limitations && data.limitations.length > 0) {
    html += '<div class="deep-extract-section"><h4 class="deep-extract-section-title">⚠️ 局限性</h4>';
    html += '<ul class="deep-extract-limitations-list">';
    for (const l of data.limitations) {
      html += `<li class="deep-extract-limitation">${l}</li>`;
    }
    html += '</ul></div>';
  }

  // Replicability score
  html += '<div class="deep-extract-section"><h4 class="deep-extract-section-title">🔄 可复现性评分</h4>';
  html += `<div class="deep-extract-replicability">
    <div class="deep-extract-replicability-score">${'★'.repeat(data.replicabilityScore)}${'☆'.repeat(5 - data.replicabilityScore)} <span class="deep-extract-replicability-value">${data.replicabilityScore}/5</span></div>
    <div class="deep-extract-replicability-reason">${data.replicabilityReason}</div>
  </div></div>`;

  return html;
}

/**
 * Show toast notification.
 */
function showToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
  const existing = document.querySelector('.dpr-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `dpr-toast dpr-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

/**
 * Mount deep extract section to container.
 */
export function mountDeepExtractSection(
  arxivId: string,
  container: HTMLElement,
  paperTitle: string,
  paperAbstract: string,
  existingDeepExtract?: DeepExtract
): void {
  // Check localStorage first
  let storedData = getStoredDeepExtract(arxivId);

  // Or use existing data from frontmatter
  if (!storedData && existingDeepExtract) {
    storedData = {
      reportedMetrics: existingDeepExtract.reported_metrics || [],
      datasets: existingDeepExtract.datasets || [],
      computeRequirements: existingDeepExtract.compute_requirements || {},
      limitations: existingDeepExtract.limitations || [],
      replicabilityScore: existingDeepExtract.replicability_score || 3,
      replicabilityReason: existingDeepExtract.replicability_reason || '',
    };
  }

  const containerId = `deep-extract-${arxivId.replace(/\./g, '-')}`;
  const detailsId = `details-${containerId}`;

  let contentHtml = '';
  if (storedData) {
    contentHtml = renderDeepExtract(storedData);
    contentHtml += `<button class="deep-extract-regen-btn" data-arxiv="${arxivId}">🔄 重新生成</button>`;
  } else {
    contentHtml = `
      <div class="deep-extract-empty">
        <p>深度抽取提供：指标、数据集、算力需求、局限性、可复现性评分</p>
        <button class="deep-extract-generate-btn" data-arxiv="${arxivId}">🔬 深度抽取 (5 项)</button>
      </div>
    `;
  }

  container.innerHTML = `
    <section class="deep-extract-section-wrapper">
      <details id="${detailsId}">
        <summary>🔬 深度抽取</summary>
        <div class="deep-extract-content" id="${containerId}">
          ${contentHtml}
        </div>
      </details>
    </section>
  `;

  // Attach event listeners
  const generateBtn = container.querySelector('.deep-extract-generate-btn') as HTMLButtonElement;
  const regenBtn = container.querySelector('.deep-extract-regen-btn') as HTMLButtonElement;

  const handleGenerate = async () => {
    const btn = generateBtn || regenBtn;
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = '生成中...';

    try {
      // Try to load paper text from localStorage
      let paperText = '';
      const textKey = `dpr_paper_text_${arxivId}`;
      const storedText = localStorage.getItem(textKey);
      if (storedText) {
        paperText = storedText;
      }

      const result = await generateDeepExtract(arxivId, paperTitle, paperAbstract, paperText || undefined);

      const contentDiv = container.querySelector(`#${containerId}`);
      if (contentDiv) {
        contentDiv.innerHTML = renderDeepExtract(result) + `<button class="deep-extract-regen-btn" data-arxiv="${arxivId}">🔄 重新生成</button>`;
        // Re-attach regen button listener
        const newRegenBtn = contentDiv.querySelector('.deep-extract-regen-btn') as HTMLButtonElement;
        if (newRegenBtn) {
          newRegenBtn.addEventListener('click', handleGenerate);
        }
      }

      showToast('深度抽取完成', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      showToast(`生成失败: ${msg}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = generateBtn ? '🔬 深度抽取 (5 项)' : '🔄 重新生成';
    }
  };

  if (generateBtn) {
    generateBtn.addEventListener('click', handleGenerate);
  }
  if (regenBtn) {
    regenBtn.addEventListener('click', handleGenerate);
  }
}

export default mountDeepExtractSection;
