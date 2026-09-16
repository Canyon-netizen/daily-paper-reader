// astro-src/lib/agents/citation-graph.ts
//
// R7 F.3.4: modifier citation graph generation。
//
// 输入:一组 paper metadata(每条带 raw markdown / references),输出:
//   - 一个 graph Map<arxivId, CitationNode>,每个 node 知道自己引用谁 + 被谁引用
//   - 一些图算法 helper:topologicalSort / findOrphans / findCycles
//
// 注意:本模块**不做** IO / fetch。调用方负责把 paper raw text 准备好。
// 这样可以纯函数单测。
//
// 数据约定:
//   - paper.references = string[]  arxiv IDs(已经被归一化 canonical)
//   - paper.raw 可选,用于更精确的 references 抽取(本次只在 fallback 用)

export interface CitationNode {
  arxivId: string;
  title: string;
  references: string[];   // canonical arxivId 列表(自己引用的)
  citedBy: string[];      // canonical arxivId 列表(引用自己的,需要二次扫描填)
}

export interface CitationGraph {
  nodes: Map<string, CitationNode>;
  /** 所有引用关系的边(cid, citing):cid → list of citing arxivIds */
  edges: Map<string, string[]>;
}

/** 节点创建器。 */
export function makeNode(arxivId: string, title: string, references: readonly string[] = []): CitationNode {
  return {
    arxivId,
    title,
    references: dedupeNorm(references),
    citedBy: [],
  };
}

/** 规范化 + 去重 references。 */
function dedupeNorm(refs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs) {
    const id = canonicalize(r);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 把 arxivId 简单归一化(去 vN + 去空白);合法 → canonical,否则 → ''。 */
function canonicalize(id: string): string {
  if (typeof id !== 'string') return '';
  const trimmed = id.trim().replace(/\s+/g, '');
  if (!/^\d{4}\.\d{4,5}(v\d+)?$/.test(trimmed)) return '';
  return trimmed.replace(/v\d+$/, '');
}

/**
 * 主入口:从一组 papers(已经解析好 references 的)生成 citation graph。
 * 自动填充 citedBy(二次扫描)。
 */
export function buildCitationGraph(
  papers: ReadonlyArray<{ arxivId: string; title: string; references?: readonly string[] }>,
): CitationGraph {
  const nodes = new Map<string, CitationNode>();
  for (const p of papers) {
    const cid = canonicalize(p.arxivId);
    if (!cid) continue;
    if (!nodes.has(cid)) {
      nodes.set(cid, makeNode(cid, p.title, p.references ?? []));
    }
  }
  // 二次扫描:fill citedBy
  const edges = new Map<string, string[]>();
  for (const [cid, node] of nodes) {
    for (const refId of node.references) {
      const target = nodes.get(refId);
      if (target) {
        if (!target.citedBy.includes(cid)) target.citedBy.push(cid);
        const e = edges.get(refId);
        if (e) {
          if (!e.includes(cid)) e.push(cid);
        } else {
          edges.set(refId, [cid]);
        }
      }
    }
  }
  return { nodes, edges };
}

/**
 * 从 graph 里找出 orphan 节点:
 *   - 没有 references(没人引用过)
 *   - 没有 citedBy(没人引用它)
 *   - 同时空 → 完全孤立
 */
export function findOrphans(graph: CitationGraph): string[] {
  const out: string[] = [];
  for (const [id, node] of graph.nodes) {
    if (node.references.length === 0 && node.citedBy.length === 0) {
      out.push(id);
    }
  }
  return out.sort();
}

/**
 * 检测 graph 里是否有 cycle。
 * 返回 cycle 的路径数组(每个 cycle = 一个节点 ID 数组),没有 cycle → []。
 *
 * 用经典 DFS 3-coloring:
 *   WHITE = 未访问 / GRAY = 在当前 DFS 栈 / BLACK = 已完成
 *   遇到 GRAY 邻居 → 找到 back edge → cycle
 */
export function findCycles(graph: CitationGraph): string[][] {
  type Color = 0 | 1 | 2;  // WHITE, GRAY, BLACK
  const colors = new Map<string, Color>();
  const parent = new Map<string, string | null>();
  const cycles: string[][] = [];

  for (const id of graph.nodes.keys()) colors.set(id, 0);

  function dfs(start: string): void {
    const stack: Array<{ node: string; iter: Iterator<string> }> = [];
    stack.push({ node: start, iter: graph.nodes.get(start)!.references[Symbol.iterator]() });
    colors.set(start, 1);
    parent.set(start, null);

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const next = top.iter.next();
      if (next.done) {
        colors.set(top.node, 2);
        stack.pop();
        continue;
      }
      const child = next.value;
      if (!graph.nodes.has(child)) continue;
      const c = colors.get(child);
      if (c === 0) {
        colors.set(child, 1);
        parent.set(child, top.node);
        stack.push({ node: child, iter: graph.nodes.get(child)!.references[Symbol.iterator]() });
      } else if (c === 1) {
        // 找到 cycle:从 top.node 沿 parent 走回到 child
        const path: string[] = [child];
        let cur: string | null = top.node;
        while (cur !== null && cur !== child) {
          path.push(cur);
          cur = parent.get(cur) ?? null;
        }
        path.push(child);  // 闭合
        cycles.push(path.reverse());
      }
      // c === 2 (BLACK) → cross edge,跳过
    }
  }

  for (const id of graph.nodes.keys()) {
    if (colors.get(id) === 0) dfs(id);
  }
  return cycles;
}

/**
 * 拓扑排序 —— 仅在无 cycle 时返回完整 order;有 cycle 返回 null。
 * 多个合法顺序时返回其中一个(deterministic by lexicographic)。
 *
 * 语义:「最不依赖别人的先」。A.references = [B] 表示 A 引用了 B(A depends on B),
 * 所以 A 应该排在 B 之后。
 *   inDegree(node) = len(node.references)  (how many deps this node has)
 *   入度 0 = 没有 dependencies = 应该最先
 *
 * 处理 X 时:遍历 edges.get(X)(所有引用了 X 的节点,也就是依赖 X 的节点),
 * 把它们的 inDegree 各 -1。当一个依赖者所有 deps 都被处理完,就入队。
 */
export function topologicalSort(graph: CitationGraph): string[] | null {
  const inDegree = new Map<string, number>();
  for (const [id, node] of graph.nodes) {
    inDegree.set(id, node.references.length);
  }

  const queue: string[] = [];
  for (const [id, d] of inDegree) {
    if (d === 0) queue.push(id);
  }
  queue.sort();

  const out: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    // 找到所有依赖 id 的节点,把它们的入度 -1
    const dependents = graph.edges.get(id) ?? [];
    for (const dep of dependents) {
      if (!graph.nodes.has(dep)) continue;
      const newDeg = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) {
        queue.push(dep);
        queue.sort();
      }
    }
  }

  return out.length === graph.nodes.size ? out : null;
}

/** 一些图统计 —— 给 UI dashboard 用。 */
export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  orphanCount: number;
  cycleCount: number;
  /** 入度最大(被引最多)的节点 */
  mostCited?: { arxivId: string; citedByCount: number };
}

export function computeGraphStats(graph: CitationGraph): GraphStats {
  let edgeCount = 0;
  let mostCited: GraphStats['mostCited'];
  for (const [, citingList] of graph.edges) {
    edgeCount += citingList.length;
  }
  for (const [id, node] of graph.nodes) {
    if (!mostCited || node.citedBy.length > mostCited.citedByCount) {
      mostCited = { arxivId: id, citedByCount: node.citedBy.length };
    }
  }
  return {
    nodeCount: graph.nodes.size,
    edgeCount,
    orphanCount: findOrphans(graph).length,
    cycleCount: findCycles(graph).length,
    mostCited,
  };
}