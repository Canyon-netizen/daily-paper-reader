// astro-src/lib/writing/tags.ts
//
// R7 WP.6: writing tag/keyword extraction.
//
// 从文本中提取关键词.

/** 默认停用词列表(英文为主) */
const DEFAULT_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
  'she', 'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where',
  'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here',
  'there', 'then', 'once', 'if', 'because', 'until', 'while', 'although',
  'though', 'after', 'before', 'above', 'below', 'between', 'into',
  'through', 'during', 'about', 'against', 'among', 'throughout', 'over',
  'under', 'again', 'further', 'however', 'therefore', 'thus', 'hence',
  'show', 'shows', 'shown', 'use', 'using', 'used', 'based', 'approach',
  'method', 'methods', 'paper', 'work', 'works', 'result', 'results',
  'problem', 'problems', 'model', 'models', 'data', 'algorithm', 'systems',
]);

export interface ExtractKeywordsOpts {
  /** 返回前 N 个关键词(默认 10) */
  topN?: number;
  /** 最小词长(默认 2) */
  minLength?: number;
  /** 是否区分大小写(默认 false) */
  caseSensitive?: boolean;
  /** 停用词集合(默认英文停用词) */
  stopwords?: Set<string>;
}

/** 从文本中提取关键词.
 *
 * 算法:
 * 1. 分词(按空白字符和标点)
 * 2. 过滤停用词和短词
 * 3. 统计词频
 * 4. 返回 top-N
 */
export function extractKeywords(
  text: string,
  opts: ExtractKeywordsOpts = {},
): string[] {
  const {
    topN = 10,
    minLength = 2,
    caseSensitive = false,
    stopwords = DEFAULT_STOPWORDS,
  } = opts;

  if (!text || typeof text !== 'string') {
    return [];
  }

  // 分词: 提取字母数字组合
  const words = text.split(/[\s\p{P}]+/u).filter((word) => word.length > 0);

  // 统计词频
  const freq = new Map<string, number>();

  for (const word of words) {
    // 预处理
    const processed = caseSensitive ? word : word.toLowerCase();

    // 过滤: 长度和停用词
    if (processed.length < minLength) continue;
    if (stopwords.has(processed)) continue;

    // 统计
    freq.set(processed, (freq.get(processed) || 0) + 1);
  }

  // 排序: 按频率降序
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);

  // 返回 top-N
  return sorted.slice(0, topN).map(([word]) => word);
}

/** 从多个文本中提取共同关键词. */
export function extractCommonKeywords(
  texts: string[],
  opts: ExtractKeywordsOpts = {},
): string[] {
  if (texts.length === 0) return [];
  if (texts.length === 1) return extractKeywords(texts[0], opts);

  // 提取每篇的关键词集合
  const keywordSets = texts.map((t) => new Set(extractKeywords(t, opts)));

  // 找交集
  const [first, ...rest] = keywordSets;
  const intersection = new Set<string>(first);

  for (const set of rest) {
    for (const key of intersection) {
      if (!set.has(key)) {
        intersection.delete(key);
      }
    }
  }

  // 按频率排序
  const allText = texts.join(' ');
  const keywords = extractKeywords(allText, opts);

  return keywords.filter((k) => intersection.has(k));
}
