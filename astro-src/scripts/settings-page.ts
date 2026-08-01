// /settings/ 页面客户端逻辑
//
// 所有配置项的读写都通过 ./settings.ts,这里只做 DOM 绑定 + 用户交互。
// 类目勾选、LLM 字段、Gist 凭据、主题列表、CORS 代理都在这里编辑,改完 debounce
// 写 localStorage + 弹"已自动保存"提示。

import {
  loadSettings,
  saveSettings,
  loadProvider,
  saveProvider,
  getCustomProxy,
  setCustomProxy,
  getGistToken,
  setGistToken,
  getGistId,
  setGistId,
  getTopicsText,
  setTopicsText,
  parseTopicsText,
  loadCategories,
  saveCategories,
  DEFAULT_TOPICS_TEXT,
  DEFAULT_CATEGORY_CODES,
  ARXIV_CATEGORIES,
  PROVIDER_PRESETS,
  LLM_DEFAULTS,
  GIST_FILENAME,
  loadGitHubToken,
  setGitHubToken,
  loadGitHubRepo,
  setGitHubRepo,
  loadAutoSaveAnalyzerToGitHub,
  setAutoSaveAnalyzerToGitHub,
  loadDeepDiveSettings,
  saveDeepDiveSettings,
  loadHiddenPapers,
  saveHiddenPapersRaw,
  removeHiddenPaper,
  clearHiddenPapers,
  pullHiddenPapersFromGist,
  pushHiddenPapersToGist,
} from './settings';
import {
  loadUserTags,
  clearAllUserTags,
  pullUserTagsFromGist,
  pushUserTagsToGist,
  type UserTag,
} from '../lib/user-tags';
import { debounce, escapeHtml } from '../lib/dom-utils';

// ============================================================================
// DOM helpers
// ============================================================================
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

// ============================================================================
// "已自动保存" 提示
// ============================================================================
let savedHintTimer: ReturnType<typeof setTimeout> | null = null;
function flashSavedHint(): void {
  const el = document.getElementById('settings-saved-hint');
  if (!el) return;
  el.classList.add('visible');
  if (savedHintTimer) clearTimeout(savedHintTimer);
  savedHintTimer = setTimeout(() => el.classList.remove('visible'), 1200);
}

// ============================================================================
// Model: select / input 双向切换
// ============================================================================
function isModelManual(): boolean {
  const inputEl = document.getElementById('cfg-model-input') as HTMLInputElement | null;
  return !!(inputEl && !inputEl.hidden);
}

function readModelValue(): string {
  if (isModelManual()) return $<HTMLInputElement>('cfg-model-input').value.trim();
  return $<HTMLSelectElement>('cfg-model').value.trim();
}

function setModelMode(manual: boolean): void {
  const select = $<HTMLSelectElement>('cfg-model');
  const input = $<HTMLInputElement>('cfg-model-input');
  const editBtn = $<HTMLButtonElement>('cfg-model-edit-btn');
  if (manual) {
    select.hidden = true;
    input.hidden = false;
    if (!input.value) input.value = select.value;
    editBtn.textContent = '📋';
    editBtn.title = '切回下拉选择';
  } else {
    input.hidden = true;
    select.hidden = false;
    editBtn.textContent = '✏️';
    editBtn.title = '切到手动输入';
  }
}

function setModelOptions(models: string[], placeholder: string, defaultModel = ''): void {
  const sel = $<HTMLSelectElement>('cfg-model');
  const opts = [`<option value="" disabled hidden>${escapeHtml(placeholder)}</option>`].concat(
    models.map((m, i) => {
      const isFirst = i === 0;
      const selected = (defaultModel && m === defaultModel) || (!defaultModel && isFirst);
      return `<option value="${escapeHtml(m)}"${selected ? ' selected' : ''}>${escapeHtml(m)}</option>`;
    }),
  );
  sel.innerHTML = opts.join('');
}

function applyProviderPreset(provider: string): void {
  const preset = PROVIDER_PRESETS[provider];
  if (!preset) return;
  setModelOptions(preset.models, `选择 ${preset.label} model`, preset.defaultModel);
  $<HTMLInputElement>('cfg-model-input').value = preset.defaultModel;
  setModelMode(false);
  const isCustom = provider === 'custom';
  $<HTMLInputElement>('cfg-base').placeholder = isCustom ? 'https://your-api.example.com/v1' : preset.baseUrl;
}

function detectProviderFromSettings(cfg: ReturnType<typeof loadSettings>): string {
  for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
    if (key === 'custom') continue;
    if (preset.baseUrl && cfg.baseUrl.startsWith(preset.baseUrl)) return key;
  }
  return 'custom';
}

// ============================================================================
// Status messages
// ============================================================================
function setModelStatus(msg: string, kind: '' | 'ok' | 'error' | 'warn' = ''): void {
  const el = document.getElementById('model-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'settings-model-status' + (kind ? ' ' + kind : '');
}

// ============================================================================
// Connection test / Refresh model list
// ============================================================================
interface ModelsResponse {
  data?: Array<{ id?: string; model?: string }>;
}

async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/models`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('API key 无效(401),检查 Base URL 和 Key 是否匹配');
    if (res.status === 403) throw new Error('API key 没权限(403),或 Base URL 写错');
    if (res.status === 404) throw new Error('该 Base URL 不支持 /v1/models(404),可能不是 OpenAI 兼容接口');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
  }
  const data: ModelsResponse = await res.json();
  return Array.from(new Set(
    (data.data || []).map((m) => (m.id || m.model || '').trim()).filter(Boolean),
  ));
}

function readSettingsFromUI(): ReturnType<typeof loadSettings> {
  return {
    apiKey: $<HTMLInputElement>('cfg-key').value.trim(),
    baseUrl: $<HTMLInputElement>('cfg-base').value.trim() || LLM_DEFAULTS.baseUrl,
    model: readModelValue() || LLM_DEFAULTS.model,
  };
}

async function testConnection(): Promise<void> {
  const cfg = readSettingsFromUI();
  if (!cfg.apiKey) { setModelStatus('请先填 API key', 'error'); return; }
  if (!cfg.baseUrl) { setModelStatus('请先填 Base URL', 'error'); return; }
  const btn = $<HTMLButtonElement>('test-connection-btn');
  const refreshBtn = $<HTMLButtonElement>('refresh-models-btn');
  btn.disabled = true; refreshBtn.disabled = true;
  setModelStatus('正在测试连接 ...');
  try {
    const models = await fetchOpenAIModels(cfg.baseUrl, cfg.apiKey);
    const currentModel = cfg.model.trim();
    if (currentModel && models.includes(currentModel)) {
      setModelStatus(`✓ 连接成功,共 ${models.length} 个模型,当前 model "${currentModel}" 存在`, 'ok');
    } else if (currentModel) {
      setModelStatus(`⚠ 连接成功,共 ${models.length} 个模型,但当前 model "${currentModel}" 不在列表里`, 'warn');
    } else {
      setModelStatus(`✓ 连接成功,共 ${models.length} 个模型`, 'ok');
    }
  } catch (e) {
    setModelStatus(`✗ ${(e as Error).message || e}`, 'error');
  } finally {
    btn.disabled = false; refreshBtn.disabled = false;
  }
}

async function refreshModelList(): Promise<void> {
  const cfg = readSettingsFromUI();
  if (!cfg.apiKey) { setModelStatus('请先填 API key', 'error'); return; }
  if (!cfg.baseUrl) { setModelStatus('请先填 Base URL', 'error'); return; }
  const btn = $<HTMLButtonElement>('refresh-models-btn');
  const testBtn = $<HTMLButtonElement>('test-connection-btn');
  btn.disabled = true; testBtn.disabled = true;
  setModelStatus('正在拉模型列表 ...');
  try {
    const models = await fetchOpenAIModels(cfg.baseUrl, cfg.apiKey);
    if (models.length === 0) { setModelStatus('⚠ 返回的列表为空,保留当前列表', 'warn'); return; }
    const currentModel = cfg.model.trim();
    const preferred = models.includes(currentModel) ? currentModel : '';
    setModelOptions(models, '请选择 model', preferred);
    setModelMode(false);
    $<HTMLInputElement>('cfg-model-input').value = $<HTMLSelectElement>('cfg-model').value;
    saveSettings(readSettingsFromUI());
    flashSavedHint();
    if (currentModel && !models.includes(currentModel)) {
      setModelStatus(`✓ 已更新下拉列表(共 ${models.length} 个),"${currentModel}" 不在服务端 → 已自动选 "${models[0]}"`, 'warn');
    } else {
      setModelStatus(`✓ 已从服务端拉取 ${models.length} 个模型,已选 "${preferred || models[0]}"`, 'ok');
    }
  } catch (e) {
    setModelStatus(`✗ 拉取失败: ${(e as Error).message || e}`, 'error');
  } finally {
    btn.disabled = false; testBtn.disabled = false;
  }
}

// ============================================================================
// Categories
// ============================================================================
function refreshCatsStatus(): void {
  const checked = $$<HTMLInputElement>('input[name="cfg-categories"]:checked');
  const el = document.getElementById('cats-status');
  if (el) el.textContent = `已选 ${checked.length} 个类目`;
}

function setCatChecked(codes: string[]): void {
  const set = new Set(codes);
  $$<HTMLInputElement>('input[name="cfg-categories"]').forEach((box) => {
    box.checked = set.has(box.value);
  });
  refreshCatsStatus();
}

function readCatsChecked(): string[] {
  return $$<HTMLInputElement>('input[name="cfg-categories"]:checked').map((b) => b.value);
}

// ============================================================================
// Topics
// ============================================================================
function refreshTopicsStatus(): void {
  const entries = parseTopicsText($<HTMLTextAreaElement>('cfg-topics').value);
  const el = document.getElementById('topics-status');
  if (!el) return;
  const isDefault = entries.length === parseTopicsText(DEFAULT_TOPICS_TEXT).length
    && entries.every((e, i) => {
      const d = parseTopicsText(DEFAULT_TOPICS_TEXT)[i];
      return d && d.tag === e.tag && d.description === e.description;
    });
  el.textContent = `已加载 ${entries.length} 个主题${isDefault ? '(默认)' : ''}`;
}

// ============================================================================
// Gist sync — 把 LLM + 主题 + 类目写到一个 secret Gist
// ============================================================================
async function syncToGist(): Promise<void> {
  const hint = document.getElementById('gist-sync-hint');
  const setHint = (msg: string, kind: 'info' | 'ok' | 'error' = 'info') => {
    if (!hint) return;
    hint.textContent = msg;
    hint.className = `settings-gist-hint ${kind}`;
  };

  const token = getGistToken();
  if (!token) { setHint('请先填 Gist Token', 'error'); return; }

  const payload = {
    llm: {
      apiKey: $<HTMLInputElement>('cfg-key').value.trim(),
      baseUrl: $<HTMLInputElement>('cfg-base').value.trim() || LLM_DEFAULTS.baseUrl,
      model: readModelValue() || LLM_DEFAULTS.model,
    },
    provider: $<HTMLSelectElement>('cfg-provider').value,
    topics: parseTopicsText($<HTMLTextAreaElement>('cfg-topics').value),
    categories: readCatsChecked(),
    // 已隐藏论文列表 — paper-hide.ts / hiddenPapers 面板共享同一份。
    // 这里只是把本地状态带上,真正跨设备同步走 paper-hide.ts 的 push/pull。
    hiddenPapers: loadHiddenPapers(),
  };
  const content = JSON.stringify(payload, null, 2);

  let gistId = getGistId();
  setHint('同步中 ...', 'info');
  try {
    if (!gistId) {
      // Create
      const res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
        body: JSON.stringify({
          description: 'Daily Paper Reader browser config',
          public: false,
          files: { [GIST_FILENAME]: { content } },
        }),
      });
      if (!res.ok) throw new Error(`创建 Gist 失败: HTTP ${res.status}`);
      const data = await res.json();
      gistId = data.id;
      setGistId(gistId);
      $<HTMLInputElement>('cfg-gist-id').value = gistId;
    } else {
      // Update
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
        body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } }),
      });
      if (!res.ok) throw new Error(`更新 Gist 失败: HTTP ${res.status}`);
    }
    setHint(`✓ 已同步到 Gist ${gistId}`, 'ok');
  } catch (e) {
    setHint(`✗ ${(e as Error).message || e}`, 'error');
  }
}

// ============================================================================
// Reset all
// ============================================================================
function resetAllSettings(): void {
  if (!confirm('确定要清空所有本地配置?无法撤销。')) return;
  const KEYS = [
    'dpr_analyzer_v1',
    'dpr_analyzer_provider_v1',
    'dpr_analyzer_proxy_v1',
    'dpr_analyzer_gist_token_v1',
    'dpr_analyzer_gist_id_v1',
    'dpr_analyzer_topics_v1',
    'dpr_analyzer_categories_v1',
    'dpr_analyzer_github_token_v1',
    'dpr_analyzer_github_owner_v1',
    'dpr_analyzer_github_repo_v1',
    'dpr_analyzer_github_workflow_v1',
    'dpr_analyzer_deepdive_max_pages_v1',
    'dpr_analyzer_deepdive_compact_v1',
    'dpr_analyzer_deepdive_compact_pages_v1',
    'dpr_hidden_papers_v1',
  ];
  for (const k of KEYS) try { localStorage.removeItem(k); } catch { /* ignore */ }
  // userTags 也清掉 — 走 clearAllUserTags 走的是同样的 STORAGE_KEY
  try { clearAllUserTags(); } catch { /* ignore */ }
  alert('已清空所有配置,刷新页面');
  location.reload();
}

// ============================================================================
// Init
// ============================================================================
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root?: Element): T[] =>
  Array.from((root ?? document).querySelectorAll<T>(sel));

function init(): void {
  // --- 1. LLM ---
  const cfg = loadSettings();
  const provider = loadProvider();
  $<HTMLSelectElement>('cfg-provider').value = provider;
  applyProviderPreset(provider);
  $<HTMLInputElement>('cfg-key').value = cfg.apiKey;
  $<HTMLInputElement>('cfg-base').value = cfg.baseUrl;
  // 把 cfg.model 同步到 select / input,保留 mode
  const sel = $<HTMLSelectElement>('cfg-model');
  if (Array.from(sel.options).some((o) => o.value === cfg.model)) {
    sel.value = cfg.model;
    $<HTMLInputElement>('cfg-model-input').value = cfg.model;
  } else {
    // 当前 model 不在 preset 列表 → 切到手动输入,值保留
    $<HTMLInputElement>('cfg-model-input').value = cfg.model;
    setModelMode(true);
  }

  $<HTMLSelectElement>('cfg-provider').addEventListener('change', () => {
    const p = $<HTMLSelectElement>('cfg-provider').value;
    saveProvider(p);
    applyProviderPreset(p);
    saveSettings(readSettingsFromUI());
    flashSavedHint();
  });
  const debouncedSave = debounce(() => { saveSettings(readSettingsFromUI()); flashSavedHint(); }, 400);
  ['cfg-key', 'cfg-base', 'cfg-model', 'cfg-model-input'].forEach((id) => {
    $<HTMLInputElement>(id).addEventListener('input', debouncedSave);
  });
  $<HTMLSelectElement>('cfg-model').addEventListener('change', debouncedSave);
  $<HTMLButtonElement>('cfg-model-edit-btn').addEventListener('click', () => setModelMode(!isModelManual()));
  $<HTMLButtonElement>('test-connection-btn').addEventListener('click', testConnection);
  $<HTMLButtonElement>('refresh-models-btn').addEventListener('click', refreshModelList);

  // --- 2. 类目 ---
  setCatChecked(loadCategories());
  refreshCatsStatus();
  $$<HTMLInputElement>('input[name="cfg-categories"]').forEach((box) => {
    box.addEventListener('change', () => {
      saveCategories(readCatsChecked());
      refreshCatsStatus();
      flashSavedHint();
    });
  });
  $<HTMLButtonElement>('cats-select-default').addEventListener('click', () => { setCatChecked(DEFAULT_CATEGORY_CODES); saveCategories(readCatsChecked()); flashSavedHint(); });
  $<HTMLButtonElement>('cats-select-all').addEventListener('click', () => { setCatChecked(ARXIV_CATEGORIES.map((c) => c.code)); saveCategories(readCatsChecked()); flashSavedHint(); });
  $<HTMLButtonElement>('cats-select-none').addEventListener('click', () => { setCatChecked([]); saveCategories([]); flashSavedHint(); });

  // --- 3. Gist ---
  $<HTMLInputElement>('cfg-gist-token').value = getGistToken();
  $<HTMLInputElement>('cfg-gist-id').value = getGistId();
  const debouncedGistToken = debounce(() => { setGistToken($<HTMLInputElement>('cfg-gist-token').value.trim()); flashSavedHint(); }, 400);
  $<HTMLInputElement>('cfg-gist-token').addEventListener('input', debouncedGistToken);
  const debouncedGistId = debounce(() => { setGistId($<HTMLInputElement>('cfg-gist-id').value.trim()); flashSavedHint(); }, 400);
  $<HTMLInputElement>('cfg-gist-id').addEventListener('input', debouncedGistId);
  $<HTMLButtonElement>('gist-sync-btn').addEventListener('click', syncToGist);

  // --- 3.5 Library Gist 同步(Stage 2) ---
  import('./user-library-bridge').then((m) => {
    $<HTMLInputElement>('cfg-library-gist-id').value = m.getLibraryGistId();
    $<HTMLButtonElement>('library-gist-push-btn').addEventListener('click', () => {
      void m.syncLibraryPush($<HTMLInputElement>('library-gist-hint'), () => {
        $<HTMLInputElement>('cfg-library-gist-id').value = m.getLibraryGistId();
      });
    });
    $<HTMLButtonElement>('library-gist-pull-btn').addEventListener('click', () => {
      void m.syncLibraryPull($<HTMLInputElement>('library-gist-hint'));
    });
  }).catch((e) => {
    console.warn('[settings] library bridge failed to load', e);
  });

  // --- 3.6 导出(Stage 11) ---
  import('./export-bridge').then((m) => {
    m.initExportButtons();
  }).catch((e) => {
    console.warn('[settings] export bridge failed to load', e);
  });

  // --- 4. 主题 ---
  try { $<HTMLTextAreaElement>('cfg-topics').value = getTopicsText(); } catch { $<HTMLTextAreaElement>('cfg-topics').value = DEFAULT_TOPICS_TEXT; }
  refreshTopicsStatus();
  const debouncedTopicsSave = debounce(() => { setTopicsText($<HTMLTextAreaElement>('cfg-topics').value); refreshTopicsStatus(); flashSavedHint(); }, 400);
  $<HTMLTextAreaElement>('cfg-topics').addEventListener('input', () => { refreshTopicsStatus(); debouncedTopicsSave(); });
  $<HTMLButtonElement>('topics-reset-btn').addEventListener('click', () => {
    setTopicsText(DEFAULT_TOPICS_TEXT);
    $<HTMLTextAreaElement>('cfg-topics').value = DEFAULT_TOPICS_TEXT;
    refreshTopicsStatus();
    flashSavedHint();
  });

  // --- 5. CORS 代理 ---
  $<HTMLInputElement>('cfg-cors').value = getCustomProxy();
  const debouncedCors = debounce(() => { setCustomProxy($<HTMLInputElement>('cfg-cors').value.trim()); flashSavedHint(); }, 400);
  $<HTMLInputElement>('cfg-cors').addEventListener('input', debouncedCors);

  // --- 6. GitHub 仓库配置(owner/repo/workflow) — 上面那个 PAT 同时给 Gist 同步和
  //     论文保存用,所以这里不重复填 token,只确认仓库配置。
  const ghRepo = loadGitHubRepo();
  $<HTMLInputElement>('cfg-github-owner').value = ghRepo.owner;
  $<HTMLInputElement>('cfg-github-repo').value = ghRepo.repo;
  $<HTMLInputElement>('cfg-github-workflow').value = ghRepo.workflow;
  const saveGhRepo = debounce(() => {
    setGitHubRepo({
      owner: $<HTMLInputElement>('cfg-github-owner').value.trim(),
      repo: $<HTMLInputElement>('cfg-github-repo').value.trim(),
      workflow: $<HTMLInputElement>('cfg-github-workflow').value.trim(),
    });
    flashSavedHint();
  }, 400);
  ['cfg-github-owner', 'cfg-github-repo', 'cfg-github-workflow'].forEach((id) => {
    $<HTMLInputElement>(id).addEventListener('input', saveGhRepo);
  });

  // --- 7. 长文精读(Deep Dive)---
  // 默认 maxPages=20 防止 Cloudflare-fronted LLM provider 拒收大 body;
  // 用户可在 settings 里调高,但 >60 通常会触发 WAF。
  const dd = loadDeepDiveSettings();
  const ddMax = $<HTMLInputElement>('cfg-dd-max-pages');
  const ddCompact = $<HTMLInputElement>('cfg-dd-compact');
  const ddCompactPages = $<HTMLInputElement>('cfg-dd-compact-pages');
  ddMax.value = String(dd.maxPages);
  ddCompact.checked = dd.compact;
  ddCompactPages.value = String(dd.compactPages);
  const saveDd = debounce(() => {
    saveDeepDiveSettings({
      maxPages: parseInt(ddMax.value, 10),
      compact: ddCompact.checked,
      compactPages: parseInt(ddCompactPages.value, 10),
    });
    flashSavedHint();
  }, 400);
  [ddMax, ddCompact, ddCompactPages].forEach((el) => {
    el.addEventListener('input', saveDd);
    el.addEventListener('change', saveDd);
  });

  // --- 5b. analyzer 自动同步开关 ---
  // 默认关。开启后,paper-analyzer 的 runAnalysis 跑完会 fire-and-forget 触发
  // save-paper.yml 把笔记落盘到 docs/papers/,Vercel 重新部署后首页就能看到。
  const autoSaveCb = $<HTMLInputElement>('cfg-analyzer-auto-save');
  autoSaveCb.checked = loadAutoSaveAnalyzerToGitHub();
  const saveAutoSave = debounce(() => {
    setAutoSaveAnalyzerToGitHub(autoSaveCb.checked);
    flashSavedHint();
  }, 200);
  autoSaveCb.addEventListener('change', saveAutoSave);

  // --- 6. Reset ---
  $<HTMLButtonElement>('settings-reset-all-btn').addEventListener('click', resetAllSettings);

  // --- 7. 已隐藏论文面板 ---
  initHiddenPanel();

  // --- 8. 用户标签面板 ---
  initUserTagsPanel();
}

// ============================================================================
// 已隐藏论文面板 — 列全 localStorage 里的 arxivId + 标题(从 /arxiv-index.json
// 拿),每条带"恢复"按钮;三个操作按钮:从 Gist 拉取 / 推到 Gist / 清空本地。
// ============================================================================

interface ArxivIndexEntry {
  rel: string;
  title: string | null;
}

function setHiddenStatus(msg: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  const el = document.getElementById('hidden-status');
  if (!el) return;
  el.textContent = msg;
  el.dataset.kind = kind;
}

async function fetchArxivIndex(): Promise<Record<string, ArxivIndexEntry>> {
  try {
    const res = await fetch('/arxiv-index.json', { cache: 'no-cache' });
    if (!res.ok) return {};
    return await res.json() as Record<string, ArxivIndexEntry>;
  } catch {
    return {};
  }
}

function renderHiddenList(): void {
  const ids = loadHiddenPapers();
  const empty = document.getElementById('settings-hidden-empty');
  const list = document.getElementById('settings-hidden-list');
  if (!list) return;

  if (ids.length === 0) {
    if (empty) empty.hidden = false;
    list.hidden = true;
    list.innerHTML = '';
    return;
  }
  if (empty) empty.hidden = true;
  list.hidden = false;
  list.innerHTML = ids.map((id) => {
    return `<li class="settings-hidden-item" data-arxiv-id="${escapeHtml(id)}">
      <a class="settings-hidden-id" href="./papers/${encodeURIComponent(id)}/" target="_blank" rel="noopener">${escapeHtml(id)}</a>
      <span class="settings-hidden-title" data-role="title" data-arxiv-id="${escapeHtml(id)}">${escapeHtml(id)}</span>
      <button type="button" class="settings-action-btn ghost" data-act="restore" data-arxiv-id="${escapeHtml(id)}">↩ 恢复</button>
    </li>`;
  }).join('');
}

async function refreshHiddenTitles(): Promise<void> {
  const ids = loadHiddenPapers();
  if (ids.length === 0) return;
  const idx = await fetchArxivIndex();
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-role="title"]'))) {
    const ax = el.dataset.arxivId || '';
    const entry = idx[ax];
    if (entry?.title) {
      el.textContent = entry.title;
      el.classList.remove('settings-hidden-title--missing');
    } else {
      el.textContent = `${ax} (标题未解析)`;
      el.classList.add('settings-hidden-title--missing');
    }
  }
}

function initHiddenPanel(): void {
  const listEl = document.getElementById('settings-hidden-list');
  if (!listEl) return; // panel not on this page

  renderHiddenList();
  // 异步拉 arxiv-index.json 补全标题(不阻塞面板渲染)
  void refreshHiddenTitles();

  // P1-5: 监听 settings.ts emit 的 'hidden-papers-change' 事件,任意位置
  // 隐藏/恢复论文(paper-hide.ts 等)后本面板自动刷新。emit 端已经在
  // addHiddenPaper / removeHiddenPaper / saveHiddenPapersRaw 里调用
  // emitHiddenPapersChange(),这里只挂监听。
  document.addEventListener('hidden-papers-change', () => {
    renderHiddenList();
  });

  // 单条"恢复"
  listEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act="restore"]');
    if (!btn) return;
    const ax = btn.dataset.arxivId || '';
    if (!ax) return;
    removeHiddenPaper(ax);
    renderHiddenList();
    void refreshHiddenTitles();
    setHiddenStatus(`✓ 已恢复 ${ax}`, 'ok');
    if (getGistToken() && getGistId()) {
      pushHiddenPapersToGist().catch((err) =>
        console.warn('[hidden-panel] Gist push failed:', err),
      );
    }
  });

  // 三个操作按钮
  $<HTMLButtonElement>('hidden-pull-btn').addEventListener('click', async () => {
    if (!getGistToken() || !getGistId()) {
      setHiddenStatus('✗ 未配置 Gist Token / Gist ID,无法拉取', 'error');
      return;
    }
    setHiddenStatus('正在从 Gist 拉取 ...', 'info');
    const r = await pullHiddenPapersFromGist();
    if (!r.ok) {
      setHiddenStatus(`✗ 拉取失败:${r.reason || '未知错误'}`, 'error');
      return;
    }
    renderHiddenList();
    void refreshHiddenTitles();
    if (r.merged && r.merged.length > 0) {
      setHiddenStatus(`✓ 新合并 ${r.merged.length} 条:${r.merged.join(', ')}`, 'ok');
    } else {
      setHiddenStatus('✓ 拉取完成,无新增条目', 'ok');
    }
  });

  $<HTMLButtonElement>('hidden-push-btn').addEventListener('click', async () => {
    if (!getGistToken() || !getGistId()) {
      setHiddenStatus('✗ 未配置 Gist Token / Gist ID,无法推送', 'error');
      return;
    }
    setHiddenStatus('正在推送到 Gist ...', 'info');
    const r = await pushHiddenPapersToGist();
    if (!r.ok) {
      setHiddenStatus(`✗ 推送失败:${r.reason || '未知错误'}`, 'error');
      return;
    }
    setHiddenStatus(`✓ 已推送 ${loadHiddenPapers().length} 条到 Gist`, 'ok');
  });

  $<HTMLButtonElement>('hidden-clear-btn').addEventListener('click', () => {
    const ids = loadHiddenPapers();
    if (ids.length === 0) {
      setHiddenStatus('本地已为空,无需清空', 'info');
      return;
    }
    if (!confirm(`确定清空本地 ${ids.length} 条隐藏记录?(不影响 Gist)`)) return;
    // P1-5: 走 clearHiddenPapers() 而不是直接 saveHiddenPapersRaw([]),
    // 让 'hidden-papers-change' 事件被 emit,面板自动刷新。
    clearHiddenPapers();
    setHiddenStatus('✓ 已清空本地', 'ok');
    if (getGistToken() && getGistId()) {
      pushHiddenPapersToGist().catch((err) =>
        console.warn('[hidden-panel] Gist push failed:', err),
      );
    }
  });
}

// ============================================================================
// 用户标签面板 — 列出 localStorage 里所有论文的用户标签(按 (kind,label) 聚合展示),
// 三个操作按钮:从 Gist 拉取 / 推到 Gist / 清空所有用户标签(二次确认)。
// ============================================================================

function setUserTagsStatus(msg: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  const el = document.getElementById('user-tags-status');
  if (!el) return;
  el.textContent = msg;
  el.dataset.kind = kind;
}

/** 把 (kind, label) 在所有论文上的使用情况聚合为一个显示项。 */
interface AggregatedTag {
  kind: string;
  label: string;
  count: number;            // 用到该 (kind,label) 的论文数
  arxivIds: string[];       // 涉及的 arxivId(前 5 个,超出显示 +N)
  earliest: number;         // addedAt 最小值
}

function aggregateUserTags(map: Record<string, UserTag[]>): AggregatedTag[] {
  const idx = new Map<string, AggregatedTag>();
  for (const [arxivId, tags] of Object.entries(map)) {
    for (const t of tags) {
      const k = `${t.kind} ${t.label}`;
      let agg = idx.get(k);
      if (!agg) {
        agg = { kind: t.kind, label: t.label, count: 0, arxivIds: [], earliest: t.addedAt };
        idx.set(k, agg);
      }
      agg.count += 1;
      if (agg.arxivIds.length < 5) agg.arxivIds.push(arxivId);
      if (t.addedAt > 0 && (agg.earliest === 0 || t.addedAt < agg.earliest)) {
        agg.earliest = t.addedAt;
      }
    }
  }
  return Array.from(idx.values()).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.label.localeCompare(b.label);
  });
}

function renderUserTagsList(): void {
  const map = loadUserTags();
  const empty = document.getElementById('settings-user-tags-empty');
  const list = document.getElementById('settings-user-tags-list');
  if (!list) return;

  const aggregated = aggregateUserTags(map);
  if (aggregated.length === 0) {
    if (empty) empty.hidden = false;
    list.hidden = true;
    list.innerHTML = '';
    return;
  }
  if (empty) empty.hidden = true;
  list.hidden = false;
  list.innerHTML = aggregated.map((a) => {
    const more = a.count > a.arxivIds.length ? ` +${a.count - a.arxivIds.length}` : '';
    return `<li class="settings-user-tags-item">
      <span class="settings-user-tags-kind">${escapeHtml(a.kind)}</span>
      <span class="settings-user-tags-label">${escapeHtml(a.label)}</span>
      <span class="settings-user-tags-count">${a.count} 篇 · ${escapeHtml(a.arxivIds.join(', '))}${more}</span>
    </li>`;
  }).join('');
}

function initUserTagsPanel(): void {
  const listEl = document.getElementById('settings-user-tags-list');
  if (!listEl) return; // panel not on this page

  renderUserTagsList();

  // P1-5: 监听 settings.ts emit 的 'user-tags-change' 事件,任意位置写 userTags
  // (PaperLibrary 抽屉、topic 页、保存论文流程)后,本面板自动重渲染。
  // 之前只有手动点 pull/push/clear 才刷新;抽屉里改 tag 后这个面板是
  // 旧的,需要 F5 才能看到 — 这是 memory feedback_settings_selection_must_emit
  // 提到的 selection 同一类问题的姊妹问题。
  document.addEventListener('user-tags-change', () => {
    renderUserTagsList();
  });

  $<HTMLButtonElement>('user-tags-pull-btn').addEventListener('click', async () => {
    if (!getGistToken() || !getGistId()) {
      setUserTagsStatus('✗ 未配置 Gist Token / Gist ID,无法拉取', 'error');
      return;
    }
    setUserTagsStatus('正在从 Gist 拉取 ...', 'info');
    const r = await pullUserTagsFromGist();
    if (!r.ok) {
      setUserTagsStatus(`✗ 拉取失败:${r.reason || '未知错误'}`, 'error');
      return;
    }
    renderUserTagsList();
    if (r.mergedCount && r.mergedCount > 0) {
      setUserTagsStatus(`✓ 新合并 ${r.mergedCount} 条用户标签`, 'ok');
    } else {
      setUserTagsStatus('✓ 拉取完成,无新增条目', 'ok');
    }
  });

  $<HTMLButtonElement>('user-tags-push-btn').addEventListener('click', async () => {
    if (!getGistToken() || !getGistId()) {
      setUserTagsStatus('✗ 未配置 Gist Token / Gist ID,无法推送', 'error');
      return;
    }
    setUserTagsStatus('正在推送到 Gist ...', 'info');
    const r = await pushUserTagsToGist();
    if (!r.ok) {
      setUserTagsStatus(`✗ 推送失败:${r.reason || '未知错误'}`, 'error');
      return;
    }
    setUserTagsStatus(`✓ 已推送 ${r.writtenCount ?? 0} 条用户标签到 Gist`, 'ok');
  });

  $<HTMLButtonElement>('user-tags-clear-btn').addEventListener('click', () => {
    const map = loadUserTags();
    const n = Object.keys(map).length;
    if (n === 0) {
      setUserTagsStatus('本地已为空,无需清空', 'info');
      return;
    }
    if (!confirm(`确定清除所有用户标签?(共 ${n} 篇论文,不可撤销)清除后 Gist 上的副本也会被覆盖。`)) return;
    const removed = clearAllUserTags();
    renderUserTagsList();
    setUserTagsStatus(`✓ 已清空 ${removed} 篇论文的用户标签`, 'ok');
    if (getGistToken() && getGistId()) {
      pushUserTagsToGist().catch((err) =>
        console.warn('[user-tags-panel] Gist push failed:', err),
      );
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}