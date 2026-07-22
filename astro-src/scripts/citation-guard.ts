// browser-side citation guard:读取 *.citations.json 并渲染红色徽章
//
// 约定:
//   - 页面通过 <paper-citation-badge paper-id="2510.18483v1"></paper-citation-badge> 挂载
//   - 自动 fetch /papers/<paper-id>.citations.json 并渲染结果
//   - 若 pass=false 且 fabricated > 0 → 显示红色 "⚠️"
//   - 若 pass=true → 显示绿色 "✓"
//   - 若无数据 → 显示灰色 "?"

export async function loadCitations(paperId: string): Promise<Record<string, any> | null> {
  try {
    const resp = await fetch(`/papers/${encodeURIComponent(paperId)}.citations.json`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export function renderCitationBadge(container: HTMLElement, data: Record<string, any> | null): void {
  // 清空旧内容
  container.innerHTML = '';

  if (!data) {
    container.appendChild(createBadge('?', 'var(--color-muted)', 'var(--color-muted-foreground)'));
    return;
  }

  const pass = !!data.pass;
  const fabricated = (data.summary?.fabricated ?? 0) > 0;

  let bgColor: string, fgColor: string, label: string;
  if (fabricated) {
    // 有 fabricated 引用 → 红色警示
    bgColor = 'var(--color-destructive)';
    fgColor = 'var(--color-destructive-foreground)';
    label = `⚠️ ${data.summary.fabricated}`;
  } else if (pass) {
    // 通过 → 绿色
    bgColor = 'var(--color-success)';
    fgColor = 'var(--color-success-foreground)';
    label = '✓';
  } else {
    // 未通过但无 fabricated(不太可能发生,保底)
    bgColor = 'var(--color-muted)';
    fgColor = 'var(--color-muted-foreground)';
    label = '✗';
  }

  container.appendChild(createBadge(label, bgColor, fgColor));
}

function createBadge(label: string, bgColor: string, fgColor: string): HTMLElement {
  const badge = document.createElement('span');
  badge.style.display = 'inline-flex';
  badge.style.alignItems = 'center';
  badge.style.justifyContent = 'center';
  badge.style.width = '20px';
  badge.style.height = '20px';
  badge.style.borderRadius = '9999px';
  badge.style.fontSize = '0.75rem';
  badge.style.fontWeight = '500';
  badge.style.backgroundColor = bgColor;
  badge.style.color = fgColor;
  badge.style.lineHeight = '1';
  badge.textContent = label;
  return badge;
}

// 自动挂载所有 <paper-citation-badge paper-id="..."> 元素
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll<HTMLElement>('paper-citation-badge[paper-id]').forEach((el) => {
      const paperId = el.getAttribute('paper-id') ?? '';
      if (!paperId) return;
      loadCitations(paperId).then((data) => renderCitationBadge(el, data));
    });
  });
}