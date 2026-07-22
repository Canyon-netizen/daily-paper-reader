// /topic 页面客户端逻辑 — 模块化重构后的 orchestrator（step 14/14）。
//
// 本文件只负责：state 持有 + init 触发 + 模块装载。实际业务全部迁入 ./topic-search/ 子模块：
//   - prompts.ts      全部 system prompt + getActive* 注入层
//   - json-heal.ts    JSON 截断自愈（extractTopLevelJsonWithHeal + finalizeLLMJson）
//   - concurrency.ts  uid + runConcurrent
//   - store.ts        localStorage session CRUD + persistSession + 字节裁剪常量
//   - state.ts        S 持有者契约（getSession/setSession/getInFlight/setInFlight）
//   - llm-call.ts     callLLMRaw
//   - pipeline.ts     域逻辑（拆解 / 搜索 / 总结 / 追问 / pdf 缓存）
//   - status.ts       状态条 / 横幅 / stop 按钮
//   - report-markdown.ts  主题报告生成 + Markdown 序列化
//   - render.ts       DOM 渲染层（renderFacetStage / renderCandStage / renderAll 等）
//   - actions.ts      阶段动作（doDecompose / doSearch / doSummarize / doGenerateReport 等）
//   - seeds-modal.ts  已选论文弹层 + ?from=selection 入口
//   - init.ts         DOM 事件绑定 + 启动
//
// 5 阶段状态机:输入 → 拆解 → 搜索 → 总结 → 报告（+ 阶段内追问 / 修改建议）。
//
// 历史公开 API（被外部 import）由本文件 re-export，保持原 import 路径不变。

import { type TopicSession } from '../lib/schemas';
import { init } from './topic-search/init';
import { S } from './topic-search/state';

// orchestrator 持有 current + inFlightController 两个模块局部 let。
// 在 init() 启动时把这两个 let 装填进 S，使叶子模块能通过 S.getSession()/getInFlight()
// 间接访问（不直接 import 本文件，避免循环）。
let current: TopicSession | null = null;
let inFlightController: AbortController | null = null;
S.getSession = () => current;
S.setSession = (s) => { current = s; };
S.getInFlight = () => inFlightController;
S.setInFlight = (c) => { inFlightController = c; };

// 历史公开 API 再导出 — 保持 import 路径向后兼容。
export {
  getActiveFacetPrompt,
  getActiveCandPrompt,
  getActiveExplorePrompt,
  getActiveReportPrompt,
} from './topic-search/prompts';
export {
  exploreFromSeeds,
  validateAndRewriteSubqs,
} from './topic-search/pipeline';

// 启动入口
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}