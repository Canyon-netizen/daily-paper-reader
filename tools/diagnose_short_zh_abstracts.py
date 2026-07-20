"""诊断脚本: 找出所有 ## 摘要 不合规的 .md。
等价判定:
- EQ_TLDR: zh 内容 normalize 后 == tldr(normalize 后)
- EMPTY_ZH: zh 段存在但内容为空 / 占位
- SHORT_ZH: zh CJK 字符数 < en_words * ratio (分段阈值)
- MISS_ABSTRACT / MISS_ZH: 段缺失
"""
import re, glob, sys

FILES = [f for f in glob.glob('docs/papers/**/*.md', recursive=True) if not f.endswith('README.md')]

def get_fm(t):
    m = re.match(r'^---\n(.*?)\n---\n', t, re.S); return m.group(1) if m else ''

def fmf(fm, k):
    m = re.search(r'^%s:\s*(.*)$' % re.escape(k), fm, re.M)
    if not m: return ''
    return m.group(1).strip().strip('"\'')

def sec(t, h):
    m = re.compile(r'^##\s+%s\s*\n(.*?)(?=^##\s|\Z)' % re.escape(h), re.S | re.M).search(t)
    return m.group(1).strip() if m else None

def cjk_count(s):
    return len(re.findall(r'[一-鿿]', s or ''))

def en_word_count(s):
    return len(re.findall(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?", s or ''))

def normalize(s):
    return re.sub(r'\s+', '', s or '')

eq_tldr = []
empty_zh = []
short_zh = []
ok_count = 0
miss_abstract = 0
miss_zh = 0
fm_src = {}

for f in FILES:
    try:
        t = open(f, encoding='utf-8').read()
    except Exception:
        continue
    fm = get_fm(t)
    zh = sec(t, '摘要')
    ab = sec(t, 'Abstract')
    tldr = fmf(fm, 'tldr')
    ss = fmf(fm, 'selection_source')

    fm_src[f] = ss

    if ab is None:
        miss_abstract += 1
        continue
    if zh is None:
        miss_zh += 1
        continue
    zh_n = normalize(zh)
    tldr_n = normalize(tldr)
    if not zh.strip() or zh.strip() in ('(待 LLM 摘要)', '(TODO: 中文摘要待重跑)', '<!-- TODO -->'):
        empty_zh.append({'file': f, 'selection_source': ss})
        continue
    if zh_n == tldr_n:
        eq_tldr.append({'file': f, 'tldr': tldr[:120], 'selection_source': ss})
        continue
    zh_c = cjk_count(zh)
    en_w = en_word_count(ab)
    if en_w >= 60:
        ratio = 0.55 if en_w < 150 else 0.45
        if zh_c < int(en_w * ratio):
            short_zh.append({'file': f, 'zh_cjk': zh_c, 'en_words': en_w, 'ratio': round(zh_c/en_w, 3), 'selection_source': ss})
            continue
    ok_count += 1

print(f'TOTAL files scanned: {len(FILES)}')
print(f'OK (proper translation): {ok_count}')
print(f'== TILDE_TLDR (zh==tldr): {len(eq_tldr)}')
print(f'EMPTY zh: {len(empty_zh)}')
print(f'SHORT zh: {len(short_zh)}')
print(f'MISSING ## Abstract: {miss_abstract}')
print(f'MISSING ## 摘要: {miss_zh}')
print()
print('=== eq_tldr (zh==tldr) - must fix ===')
for x in eq_tldr:
    print(f"  {x['file']}")
    print(f"    selection_source: {x['selection_source']}")
    print(f"    tldr: {x['tldr']}")
print()
print('=== short_zh - manual review ===')
for x in short_zh:
    print(f"  {x['file']}  cjk={x['zh_cjk']} en={x['en_words']} ratio={x['ratio']} ss={x['selection_source']}")
print()
print('=== empty_zh - need attention ===')
for x in empty_zh:
    print(f"  {x['file']}  ss={x['selection_source']}")