#!/usr/bin/env python3
"""
Audit markdown syntax in paper MD files under docs/papers/
"""
import os
import re
import json
from pathlib import Path

PAPERS_DIR = Path("docs/papers")

def count_triple_backticks(content):
    """Count opening and closing triple backticks"""
    lines = content.split('\n')
    code_block_counts = {'open': 0, 'close': 0}
    in_code_block = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith('```'):
            if not in_code_block:
                code_block_counts['open'] += 1
                in_code_block = True
            else:
                code_block_counts['close'] += 1
                in_code_block = False

    return code_block_counts

def check_heading_hierarchy(content):
    """Check for heading hierarchy issues"""
    issues = []
    lines = content.split('\n')

    # Find first non-empty heading
    first_heading_level = None
    heading_levels = []

    for line in lines:
        match = re.match(r'^(#{1,6})\s+(.+)$', line.strip())
        if match:
            level = len(match.group(1))
            heading_levels.append(level)
            if first_heading_level is None:
                first_heading_level = level
                # First heading must be # or it's end of frontmatter
                if level != 1:
                    # Check if there's no frontmatter (would be an issue)
                    if not content.startswith('---'):
                        issues.append(f"First heading is {'#' * level}, not # (no frontmatter)")

    # Check for skipped levels (e.g., ## directly to ####)
    for i in range(1, len(heading_levels)):
        prev_level = heading_levels[i-1]
        curr_level = heading_levels[i]
        if curr_level > prev_level + 1:
            issues.append(f"Skipped heading level: {'##' * prev_level} -> {'##' * curr_level}")

    return issues

def check_empty_sections(content):
    """Check for ## headings followed by no content before next ##"""
    issues = []
    lines = content.split('\n')

    for i, line in enumerate(lines):
        match = re.match(r'^#{1,6}\s+(.+)$', line.strip())
        if match and not line.strip().startswith('```'):
            # This is a heading
            current_heading = match.group(1)
            current_level = len(match.group(1).split()[0]) if match.group(1) else 0

            # Look ahead for next heading or end
            has_content = False
            for j in range(i + 1, len(lines)):
                next_line = lines[j].strip()
                # Skip empty lines
                if not next_line:
                    continue
                # Check if it's another heading
                if re.match(r'^#{1,6}\s+', next_line):
                    break
                # If we hit non-empty non-heading content, there's content
                has_content = True
                break

            if not has_content:
                issues.append(f"Empty section: {line.strip()}")

    return issues

def check_unclosed_links(content):
    """Check for unclosed wikilinks [[ or markdown links [text without ](url"""
    issues = []

    # Check unclosed wikilinks
    wikilink_pattern = re.compile(r'\[\[([^\]]*)')
    wikilinks = wikilink_pattern.findall(content)
    # Count opening [[ and closing ]]
    open_wikilinks = content.count('[[')
    close_wikilinks = content.count(']]')
    if open_wikilinks != close_wikilinks:
        issues.append(f"Unclosed wikilinks: {open_wikilinks} open, {close_wikilinks} close")

    # Check unclosed markdown links [text without ](url
    # Pattern: [text] not followed by (url)
    link_pattern = re.compile(r'\[([^\]]+)\](?!\()')
    matches = link_pattern.findall(content)
    for match in matches:
        # Exclude image links ![...](...)
        if not match.startswith('!'):
            issues.append(f"Unclosed markdown link: [{match}]")

    return issues

def check_truncated_content(content):
    """Check if file ends with no newline or ends mid-sentence"""
    issues = []

    if not content:
        return issues

    # Check if ends with newline
    if not content.endswith('\n'):
        issues.append("File ends without newline")

    # Check if ends mid-sentence (no punctuation)
    last_line = content.rstrip()
    if last_line:
        last_char = last_line[-1]
        if last_char not in '.。!！?？)）}】"''"':
            # Could be mid-sentence
            issues.append(f"May end mid-sentence, last char: '{last_char}'")

    return issues

def check_frontmatter(content):
    """Check frontmatter delimiter balance"""
    issues = []

    if not content.startswith('---'):
        # No frontmatter - could be okay for some files
        return issues

    # Count --- delimiters
    lines = content.split('\n')
    frontmatter_delimiters = 0

    for i, line in enumerate(lines):
        if line.strip() == '---':
            frontmatter_delimiters += 1

    if frontmatter_delimiters < 2:
        issues.append(f"Frontmatter missing closing delimiter: found {frontmatter_delimiters} '---', expected at least 2")

    return issues

def check_required_sections(content):
    """Check for required sections: ## 摘要, ## Abstract, ## 论文详细总结"""
    issues = []

    # Check for 摘要
    has_abstract_cn = bool(re.search(r'^#{1,6}\s+摘要\s*$', content, re.MULTILINE))
    has_abstract_en = bool(re.search(r'^#{1,6}\s+Abstract\s*$', content, re.MULTILINE))

    if not has_abstract_cn:
        issues.append("Missing ## 摘要 section")
    if not has_abstract_en:
        issues.append("Missing ## Abstract section")

    # Check for 论文详细总结
    has_detailed_summary = bool(re.search(r'^#{1,6}\s+论文详细总结\s*$', content, re.MULTILINE))
    if not has_detailed_summary:
        issues.append("Missing ## 论文详细总结 section")

    # Check content not empty for 摘要 and Abstract
    if has_abstract_cn:
        # Extract content after ## 摘要
        match = re.search(r'^#{1,6}\s+摘要\s*$\n(.*?)(?=^#{1,6}\s|\Z)', content, re.MULTILINE | re.DOTALL)
        if match:
            abstract_content = match.group(1).strip()
            if len(abstract_content) < 10:
                issues.append("## 摘要 section appears empty or too short")

    if has_abstract_en:
        # Extract content after ## Abstract
        match = re.search(r'^#{1,6}\s+Abstract\s*$\n(.*?)(?=^#{1,6}\s|\Z)', content, re.MULTILINE | re.DOTALL)
        if match:
            abstract_content = match.group(1).strip()
            if len(abstract_content) < 10:
                issues.append("## Abstract section appears empty or too short")

    return issues

def check_image_references(content):
    """Check embedded image references ![](path) - paths look sane"""
    issues = []

    # Find all image references ![](path) or ![alt](path)
    img_pattern = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')
    matches = img_pattern.findall(content)

    for alt, path in matches:
        # Check for suspicious paths (too many ../)
        if path.count('../') > 3:
            issues.append(f"Image path has too many ../: {path}")

        # Check for absolute paths starting with /
        if path.startswith('/'):
            issues.append(f"Image path is absolute: {path}")

    return issues

def audit_file(filepath):
    """Audit a single markdown file"""
    issues = []

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return [{'file': str(filepath), 'issue': 'read_error', 'severity': 'high', 'detail': str(e)}]

    # Check 1: Code-block balance
    counts = count_triple_backticks(content)
    if counts['open'] != counts['close']:
        issues.append({
            'file': str(filepath),
            'issue': 'code_block_mismatch',
            'severity': 'high',
            'detail': f"Code blocks: {counts['open']} opening ```, {counts['close']} closing ```"
        })

    # Check 2: Heading hierarchy
    heading_issues = check_heading_hierarchy(content)
    for issue in heading_issues:
        issues.append({
            'file': str(filepath),
            'issue': 'heading_hierarchy',
            'severity': 'medium',
            'detail': issue
        })

    # Check 3: Empty sections
    empty_issues = check_empty_sections(content)
    for issue in empty_issues:
        issues.append({
            'file': str(filepath),
            'issue': 'empty_section',
            'severity': 'low',
            'detail': issue
        })

    # Check 4: Unclosed links
    link_issues = check_unclosed_links(content)
    for issue in link_issues:
        issues.append({
            'file': str(filepath),
            'issue': 'unclosed_link',
            'severity': 'medium',
            'detail': issue
        })

    # Check 5: Truncated content
    trunc_issues = check_truncated_content(content)
    for issue in trunc_issues:
        issues.append({
            'file': str(filepath),
            'issue': 'truncated_content',
            'severity': 'low',
            'detail': issue
        })

    # Check 6: Frontmatter
    fm_issues = check_frontmatter(content)
    for issue in fm_issues:
        issues.append({
            'file': str(filepath),
            'issue': 'frontmatter_issue',
            'severity': 'high',
            'detail': issue
        })

    # Check 7-9: Required sections
    section_issues = check_required_sections(content)
    for issue in section_issues:
        issues.append({
            'file': str(filepath),
            'issue': 'required_section',
            'severity': 'medium',
            'detail': issue
        })

    # Check 10: Image references
    img_issues = check_image_references(content)
    for issue in img_issues:
        issues.append({
            'file': str(filepath),
            'issue': 'image_path_sanity',
            'severity': 'low',
            'detail': issue
        })

    return issues

def main():
    """Walk all MD files in docs/papers and audit them"""
    all_issues = []

    # Find all .md files
    md_files = list(PAPERS_DIR.rglob("*.md"))
    print(f"Found {len(md_files)} markdown files")

    for i, filepath in enumerate(md_files):
        if (i + 1) % 100 == 0:
            print(f"Processed {i + 1}/{len(md_files)} files...")

        issues = audit_file(filepath)
        all_issues.extend(issues)

    # Output JSON
    output_file = Path("audit_results.json")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(all_issues, f, ensure_ascii=False, indent=2)

    print(f"\nAudit complete. Found {len(all_issues)} issues in {len(md_files)} files")
    print(f"Results written to {output_file}")

    # Summary by severity
    severity_counts = {'high': 0, 'medium': 0, 'low': 0}
    issue_types = {}
    for issue in all_issues:
        severity_counts[issue['severity']] += 1
        issue_types[issue['issue']] = issue_types.get(issue['issue'], 0) + 1

    print(f"\nBy severity: {severity_counts}")
    print(f"\nBy issue type:")
    for itype, count in sorted(issue_types.items(), key=lambda x: -x[1]):
        print(f"  {itype}: {count}")

if __name__ == '__main__':
    main()
