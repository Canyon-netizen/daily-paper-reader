// astro-src/lib/title.ts
//
// Paper titles arrive from arXiv/LLM metadata and may contain inline TeX
// (for example `$\\max$@$k$`).  Keep the source string for rich rendering,
// but use this helper wherever a plain DOM/text value is required.

const LATEX_SYMBOLS: Record<string, string> = {
  alpha: 'alpha',
  beta: 'beta',
  gamma: 'gamma',
  delta: 'delta',
  epsilon: 'epsilon',
  varepsilon: 'epsilon',
  theta: 'theta',
  lambda: 'lambda',
  mu: 'mu',
  pi: 'pi',
  sigma: 'sigma',
  phi: 'phi',
  varphi: 'phi',
  omega: 'omega',
  neq: '≠',
  ne: '≠',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  pm: '±',
  times: '×',
  cdot: '·',
  rightarrow: '→',
  to: '→',
  infty: '∞',
  partial: '∂',
  sum: '∑',
  prod: '∏',
  max: 'max',
  min: 'min',
};

const COMMAND_RE = /\\([A-Za-z]+)/g;
const MATH_DELIMITER_RE = /\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$|\\\(([^\n]*?)\\\)|\\\[([\s\S]*?)\\\]/g;

function stripLatexExpression(expr: string): string {
  let text = String(expr || '')
    .replace(/\\[,;:!> ]/g, ' ')
    .replace(/~/g, ' ');
  text = text.replace(COMMAND_RE, (_match, name: string) => LATEX_SYMBOLS[name] || name);
  text = text.replace(/[{}^_]/g, '');
  text = text.replace(/\\([^A-Za-z])/g, '$1');
  return text;
}

/** Convert a rich TeX title to a readable plain-text label. */
export function stripTitleMarkup(value: unknown): string {
  let text = String(value || '').replace(/\r\n?/g, '\n');
  text = text.replace(MATH_DELIMITER_RE, (_match, display, inline, paren, bracket) => {
    return stripLatexExpression(display ?? inline ?? paren ?? bracket ?? '');
  });
  return text.replace(/\$/g, '').replace(/\s+/g, ' ').trim();
}

export function paperPlainTitle(
  title: string | undefined,
  titlePlain: string | undefined,
): string {
  return (titlePlain || stripTitleMarkup(title || '')).trim();
}
