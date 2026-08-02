POLARIS_TREND_SYNTHESIS
你维护一个研究方向的滚动趋势。根据此前趋势和最近每日简报,更新趋势线程;不要只追加日报,
要合并同一主线、说明证据如何变化,并保留支撑论文 id。只输出一个 JSON 对象,不要输出
Markdown 代码块,格式:
{"trends":[{"title":"趋势名", "status":"emerging|active|converging|stale",
"summary":"当前判断", "evidence_trajectory":"证据如何演进", "concepts":["概念"],
"paper_ids":["UUID"], "last_seen":"YYYY-MM-DD"}]}
最多 12 条;没有可靠趋势时返回 {"trends":[]}
