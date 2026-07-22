// PR-5 Concept Backlinks — 客户端概念图谱工具。
//
// v1 最小化：fetch /wiki/concepts/_index.json；404 / 缺失 → 返回 []；
// 提供 searchConcepts() fuzzy search。

export interface ConceptMeta {
  slug: string;
  display_name: string;
  category: string;
  paper_count: number;
  novelty?: number;
  centrality?: number;
}

export async function loadConceptIndex(
  baseUrl: string = import.meta.env.BASE_URL || "/",
  fetchImpl: typeof fetch = fetch,
): Promise<ConceptMeta[]> {
  // 构建期生成 _index.json 由 src/concept_index.py rebuild() + 一个轻量脚本产出
  // （v1 暂不生成，前端拿到 404 直接空状态）。
  const url = `${baseUrl.replace(/\/$/, "")}/wiki/concepts/_index.json`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      return data as ConceptMeta[];
    }
    if (data && Array.isArray((data as any).concepts)) {
      return (data as any).concepts as ConceptMeta[];
    }
    return [];
  } catch {
    return [];
  }
}

export function searchConcepts(
  query: string,
  all: ConceptMeta[],
): ConceptMeta[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return all;
  return all.filter(
    (c) =>
      (c.display_name || "").toLowerCase().includes(q) ||
      (c.slug || "").toLowerCase().includes(q) ||
      (c.category || "").toLowerCase().includes(q),
  );
}

export function sortConceptsByHeat(
  concepts: ConceptMeta[],
): ConceptMeta[] {
  return [...concepts].sort((a, b) => {
    const pa = a.paper_count || 0;
    const pb = b.paper_count || 0;
    if (pb !== pa) return pb - pa;
    return (a.display_name || "").localeCompare(b.display_name || "");
  });
}