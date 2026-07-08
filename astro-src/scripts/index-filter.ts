// 首页 + topic 页客户端 DOM 过滤。
//
// SSR 已经渲染了所有论文卡片;启动时读 localStorage,
// 把匹配的项隐藏掉。
//
// 设计选择:不走 listPapers 改 SSR,因为 listPapers 是构建期纯服务端 IO
// (lib/paper.ts),读不到 localStorage。客户端 DOM 隐藏会有短暂闪烁
// (SSR 出来的论文卡片先显示,JS 跑完后隐藏),trade-off 已经跟用户确认过。
//
// topic 页的候选 / 速览列表是 topic-search.ts 客户端渲染,那里在渲染时
// 直接过滤(见 topic-search.ts:renderCandStage / renderSummaryStage),
// 本脚本对它们是兜底(summary-card 上的 data-arxiv 也会被遍历到)。
//
// 匹配两个属性名:
// - 首页 / 论文详情页:`data-arxiv-id="<id>"` (新约定)
// - topic 页客户端渲染:`data-arxiv="<id>"` (topic-search.ts 历史命名)
//
// 不嵌套:约定每个节点就是最外层卡片容器,内部不再带 data-arxiv-*。

import { loadHiddenPapers } from './settings';

function hideFiltered(): void {
  const hidden = loadHiddenPapers();
  if (hidden.length === 0) return;
  const hiddenSet = new Set(hidden);
  // 两个选择器一起找;querySelectorAll 接受多个以逗号分隔。
  for (const el of Array.from(
    document.querySelectorAll<HTMLElement>('[data-arxiv-id], [data-arxiv]'),
  )) {
    const id = (
      el.dataset.arxivId ||
      el.dataset.arxiv ||
      ''
    ).trim();
    if (!id || !hiddenSet.has(id)) continue;
    el.style.display = 'none';
  }
}

function init(): void {
  hideFiltered();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
