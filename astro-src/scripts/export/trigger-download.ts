// astro-src/scripts/export/trigger-download.ts
//
// 浏览器下载触发:把字符串 / Uint8Array 序列化成 Blob,挂到 <a>,click,撤。
// 任何导出按钮共用的工具 —— 走完一次 download 后 revoke URL 防止内存泄漏。

export function downloadAsFile(content: string | Uint8Array, filename: string, mime: string): void {
  const blob = content instanceof Uint8Array
    ? new Blob([content as BlobPart], { type: mime })
    : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 异步释放 — 浏览器需要点时间真开始下载
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}