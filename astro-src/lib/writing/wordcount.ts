// astro-src/lib/writing/wordcount.ts
//
// R7 WP.5: word count estimator.
//
// 估算文本字数,区分中文(CJK)和英文/其他字符.

export interface WordCountResult {
  chinese: number;
  english: number;
  total: number;
}

/** CJK 字符正则: 中文、日文、韩文等 */
const CJK_RE = /[一-鿿㐀-䶿　-〿＀-￯぀-ゟ゠-ヿ가-힯]/g;

/** 估算文本字数.
 * - 中文按字符数计算
 * - 英文按空格分隔的词数计算
 * - 混合文本分别统计
 */
export function estimateWords(text: string): WordCountResult {
  if (!text || typeof text !== 'string') {
    return { chinese: 0, english: 0, total: 0 };
  }

  // 统计中文字符数
  const chineseMatches = text.match(CJK_RE);
  const chinese = chineseMatches ? chineseMatches.length : 0;

  // 统计英文词数 (按空白字符分隔)
  // 移除中文后再统计英文
  const textWithoutChinese = text.replace(CJK_RE, ' ');
  const englishWords = textWithoutChinese
    .split(/\s+/)
    .filter((word) => word.length > 0 && /[a-zA-Z]/.test(word));
  const english = englishWords.length;

  return {
    chinese,
    english,
    total: chinese + english,
  };
}

/** 估算纯中文文本的字数(字符数). */
export function estimateChineseChars(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  const matches = text.match(CJK_RE);
  return matches ? matches.length : 0;
}

/** 估算纯英文文本的词数. */
export function estimateEnglishWords(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  const words = text.split(/\s+/).filter((word) => word.length > 0 && /[a-zA-Z]/.test(word));
  return words.length;
}
