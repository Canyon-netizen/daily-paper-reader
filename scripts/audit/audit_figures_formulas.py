#!/usr/bin/env python3
"""
Audit figures_json and formulas_json fields in all paper MDs under docs/papers/
"""

import os
import re
import json
import glob
from pathlib import Path
import yaml
import sys

# Fix Unicode output on Windows
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def safe_print(msg):
    """Print with fallback for encoding issues."""
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode('utf-8', errors='replace').decode('utf-8', errors='replace'))

def extract_frontmatter_yaml(content):
    """Extract figures_json and formulas_json from YAML frontmatter using yaml parser."""
    figures_json = None
    formulas_json = None

    # Match frontmatter delimiter
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
    if not match:
        return figures_json, formulas_json

    frontmatter = match.group(1)

    try:
        data = yaml.safe_load(frontmatter)
        if data:
            figures_json = data.get('figures_json')
            formulas_json = data.get('formulas_json')
    except yaml.YAMLError:
        pass

    return figures_json, formulas_json

def parse_json_field(field_value):
    """Parse a field that might be a JSON string or already-parsed JSON."""
    if field_value is None:
        return None

    # If it's already a list/dict, return it
    if isinstance(field_value, (list, dict)):
        return field_value

    # If it's a string, try to parse as JSON
    if isinstance(field_value, str):
        try:
            return json.loads(field_value)
        except json.JSONDecodeError:
            # Return as-is if not valid JSON
            return field_value

    return field_value

def check_latex_issues(latex_str):
    """Check for encoding issues in latex string."""
    issues = []

    if latex_str is None:
        return issues

    latex_str = str(latex_str)

    # Check for U+FFFD replacement character
    if '\ufffd' in latex_str:
        issues.append('U+FFFD replacement character found')

    # Check for control characters (excluding whitespace)
    for i, char in enumerate(latex_str):
        if ord(char) < 32 and char not in '\n\r\t':
            issues.append(f'Control char U+{ord(char):04X} at position {i}')

    return issues

def audit_figures_json(figures, file_path):
    """Audit figures_json field."""
    findings = []

    if figures is None:
        return findings

    # Try to parse if it's a string
    figures = parse_json_field(figures)

    # Check if it's a valid list
    if not isinstance(figures, list):
        findings.append({
            'file': file_path,
            'issue': 'figures_json: not an array',
            'severity': 'high',
            'detail': f'Type is {type(figures).__name__}: {str(figures)[:100]}'
        })
        return findings

    for idx, fig in enumerate(figures):
        if not isinstance(fig, dict):
            findings.append({
                'file': file_path,
                'issue': 'figures_json: element not an object',
                'severity': 'medium',
                'detail': f'Index {idx} is {type(fig).__name__}'
            })
            continue

        # Check url
        url = fig.get('url', '')
        if not url:
            findings.append({
                'file': file_path,
                'issue': 'figures_json: empty url',
                'severity': 'medium',
                'detail': f'Figure at index {idx} has empty url'
            })

        # Check page number (page=0 is suspicious for figures from papers)
        page = fig.get('page', 0)
        if page == 0 and idx > 0:
            findings.append({
                'file': file_path,
                'issue': 'figures_json: page=0',
                'severity': 'low',
                'detail': f'Figure at index {idx} has page=0'
            })

        # Check extractor field
        extractor = fig.get('extractor', '')
        if not extractor:
            findings.append({
                'file': file_path,
                'issue': 'figures_json: missing extractor',
                'severity': 'low',
                'detail': f'Figure at index {idx} missing extractor field'
            })

    return findings

def audit_formulas_json(formulas, file_path):
    """Audit formulas_json field."""
    findings = []

    if formulas is None:
        return findings

    # Try to parse if it's a string
    formulas = parse_json_field(formulas)

    # Check if it's a valid list
    if not isinstance(formulas, list):
        findings.append({
            'file': file_path,
            'issue': 'formulas_json: not an array',
            'severity': 'high',
            'detail': f'Type is {type(formulas).__name__}: {str(formulas)[:100]}'
        })
        return findings

    for idx, formula in enumerate(formulas):
        if not isinstance(formula, dict):
            findings.append({
                'file': file_path,
                'issue': 'formulas_json: element not an object',
                'severity': 'medium',
                'detail': f'Index {idx} is {type(formula).__name__}'
            })
            continue

        # Check latex field
        latex = formula.get('latex', '')
        if not latex:
            findings.append({
                'file': file_path,
                'issue': 'formulas_json: empty latex',
                'severity': 'medium',
                'detail': f'Formula at index {idx} has empty latex'
            })
        else:
            # Check for encoding issues in latex
            latex_issues = check_latex_issues(latex)
            for issue in latex_issues:
                severity = 'high' if 'U+FFFD' in issue else 'medium'
                findings.append({
                    'file': file_path,
                    'issue': f'formulas_json: encoding issue in latex - {issue}',
                    'severity': severity,
                    'detail': f'Formula at index {idx}: latex preview = {repr(latex[:100])}'
                })

        # Check page number
        page = formula.get('page', 0)
        if page == 0:
            findings.append({
                'file': file_path,
                'issue': 'formulas_json: page=0',
                'severity': 'low',
                'detail': f'Formula at index {idx} has page=0'
            })

        # Check bbox
        bbox = formula.get('bbox')
        if bbox is None:
            findings.append({
                'file': file_path,
                'issue': 'formulas_json: missing bbox',
                'severity': 'low',
                'detail': f'Formula at index {idx} missing bbox field'
            })

    return findings

def main():
    # Find all MD files under docs/papers/
    docs_papers = Path('E:/study/daily-paper-reader/docs/papers')
    md_files = list(docs_papers.rglob('*.md'))

    print(f"Found {len(md_files)} MD files")

    all_findings = []
    files_with_figures = 0
    files_with_formulas = 0

    for md_file in md_files:
        try:
            content = md_file.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            all_findings.append({
                'file': str(md_file),
                'issue': 'file: cannot read as UTF-8',
                'severity': 'high',
                'detail': 'File encoding is not UTF-8'
            })
            continue

        rel_path = str(md_file.relative_to(docs_papers.parent))

        figures, formulas = extract_frontmatter_yaml(content)

        # Audit figures_json
        if figures is not None:
            files_with_figures += 1
            findings = audit_figures_json(figures, rel_path)
            all_findings.extend(findings)

        # Audit formulas_json
        if formulas is not None:
            files_with_formulas += 1
            findings = audit_formulas_json(formulas, rel_path)
            all_findings.extend(findings)

    # Print summary
    print(f"\n=== AUDIT SUMMARY ===")
    print(f"Total MD files: {len(md_files)}")
    print(f"Files with figures_json: {files_with_figures}")
    print(f"Files with formulas_json: {files_with_formulas}")
    print(f"Total findings: {len(all_findings)}")

    # Count by severity
    high = sum(1 for f in all_findings if f['severity'] == 'high')
    medium = sum(1 for f in all_findings if f['severity'] == 'medium')
    low = sum(1 for f in all_findings if f['severity'] == 'low')

    print(f"High severity: {high}")
    print(f"Medium severity: {medium}")
    print(f"Low severity: {low}")

    # Count by issue type
    issue_types = {}
    for f in all_findings:
        issue_type = f['issue'].split(':')[0]
        issue_types[issue_type] = issue_types.get(issue_type, 0) + 1

    print(f"\n=== ISSUES BY TYPE ===")
    for it, count in sorted(issue_types.items(), key=lambda x: -x[1]):
        print(f"  {it}: {count}")

    # Print high severity findings (sample)
    print(f"\n=== HIGH SEVERITY FINDINGS (first 20) ===")
    high_findings = [f for f in all_findings if f['severity'] == 'high']
    for f in high_findings[:20]:
        print(f"\n{f['file']}")
        print(f"  {f['issue']}")
        detail_preview = f['detail'][:150] if len(f['detail']) > 150 else f['detail']
        print(f"  {detail_preview}")

    # Print specific U+FFFD findings
    print(f"\n=== U+FFFD (REPLACEMENT CHAR) FINDINGS ===")
    ufffd_findings = [f for f in all_findings if 'U+FFFD' in f['issue']]
    print(f"Total: {len(ufffd_findings)}")
    for f in ufffd_findings[:20]:
        print(f"\n{f['file']}")
        print(f"  {f['detail'][:200]}")

    # Print medium severity - encoding issues
    print(f"\n=== MEDIUM SEVERITY: ENCODING ISSUES (first 20) ===")
    encoding_findings = [f for f in all_findings if 'encoding issue' in f['issue'].lower() and f['severity'] == 'medium']
    for f in encoding_findings[:20]:
        print(f"\n{f['file']}")
        print(f"  {f['issue']}")
        print(f"  {f['detail'][:150]}")

    # Print other medium severity findings (sample)
    print(f"\n=== OTHER MEDIUM SEVERITY FINDINGS (first 20) ===")
    other_medium = [f for f in all_findings if f['severity'] == 'medium' and 'encoding' not in f['issue'].lower()]
    for f in other_medium[:20]:
        print(f"\n{f['file']}")
        print(f"  {f['issue']}")

    # Write findings to JSON
    output_path = 'E:/study/daily-paper-reader/audit_findings.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(all_findings, f, indent=2, ensure_ascii=False)

    print(f"\nFindings written to: {output_path}")

if __name__ == '__main__':
    main()
