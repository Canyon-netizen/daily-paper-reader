#!/usr/bin/env python3
"""
Audit paper MD files for link and figure integrity.
"""
import os
import re
import json
import random
from pathlib import Path
from typing import Dict, List, Any

PAPERS_DIR = Path("E:/study/daily-paper-reader/docs/papers")
PROJECT_ROOT = Path("E:/study/daily-paper-reader")
DIST_ASSETS = PROJECT_ROOT / "dist" / "assets"

def extract_figure_urls(content: str) -> List[str]:
    """Extract figure URLs from frontmatter using regex."""
    urls = re.findall(r'"url":\s*"([^"]+\.webp)"', content)
    return urls

def extract_pdf_url(content: str) -> str:
    """Extract and clean PDF URL from frontmatter."""
    fm = content.split('---', 2)[1] if content.startswith('---') else ''
    pdf_match = re.search(r'^pdf:\s*(.+)$', fm, re.MULTILINE)
    if not pdf_match:
        return None
    pdf = pdf_match.group(1).strip()
    pdf = pdf.strip('"\'')
    return pdf

def validate_pdf_url(url: str) -> Dict[str, Any]:
    """Validate PDF URL format."""
    if not url:
        return {"valid": False, "reason": "No PDF URL", "url": url}

    arxiv_pattern = r'^https://arxiv\.org/pdf/(\d{4}\.\d{4,5}(?:v\d+)?)$'
    match = re.match(arxiv_pattern, url)
    if match:
        return {"valid": True, "source": "arxiv", "arxiv_id": match.group(1)}

    if 'biorxiv.org' in url:
        return {"valid": True, "source": "biorxiv", "url": url}

    if 'openreview.net' in url:
        return {"valid": True, "source": "openreview", "url": url}

    return {"valid": False, "reason": "Unknown PDF source", "url": url}

def find_figure_on_disk(fig_url: str) -> bool:
    """Check if figure exists in dist/assets."""
    if fig_url.startswith("assets/"):
        fig_path = DIST_ASSETS / fig_url.replace("assets/", "", 1)
    else:
        fig_path = DIST_ASSETS / fig_url
    return fig_path.exists()

def extract_body_images(content: str) -> List[Dict[str, str]]:
    """Extract markdown image references from body."""
    pattern = r'!\[([^\]]*)\]\(([^)]+)\)'
    matches = re.findall(pattern, content)
    return [{"alt": m[0], "path": m[1]} for m in matches]

def extract_internal_links(content: str, md_files: List[Path]) -> List[Dict[str, Any]]:
    """Extract internal links (wikilinks and relative links)."""
    links = []

    if content.startswith("---"):
        parts = content.split("---", 2)
        body = parts[2] if len(parts) >= 3 else content
    else:
        body = content

    wikilinks = re.findall(r'\[\[([^\]]+)\]\]', body)
    for w in wikilinks:
        found = False
        search_term = w.lower().replace(' ', '-')
        for paper_file in md_files:
            if search_term in paper_file.name.lower():
                found = True
                break
        links.append({"type": "wikilink", "target": w, "found": found})

    rel_links = re.findall(r'\[([^\]]+)\]\(([^)]+\.md)\)', body)
    for r in rel_links:
        links.append({"type": "relative", "target": r[1], "text": r[0]})

    return links

def main():
    md_files = list(PAPERS_DIR.rglob("*.md"))
    print(f"Found {len(md_files)} MD files")

    findings = []

    sample_size = min(30, len(md_files))
    sample_files = random.sample(md_files, sample_size)
    print(f"Sampling {sample_size} files for figure audit")

    all_figure_refs = []
    all_pdf_refs = []

    for md_file in md_files:
        try:
            content = md_file.read_text(encoding='utf-8')
        except Exception as e:
            findings.append({
                "file": str(md_file.relative_to(PROJECT_ROOT)),
                "issue": "read_error",
                "severity": "high",
                "detail": f"Failed to read file: {e}"
            })
            continue

        pdf_url = extract_pdf_url(content)
        if pdf_url:
            all_pdf_refs.append((md_file, pdf_url))

        fig_urls = extract_figure_urls(content)
        for url in fig_urls:
            all_figure_refs.append((md_file, url))

    # Check PDF URLs
    print(f"Checking {len(all_pdf_refs)} PDF URLs...")
    pdf_issues = []
    pdf_biorxiv = 0
    for md_file, pdf_url in all_pdf_refs:
        result = validate_pdf_url(pdf_url)
        if not result["valid"]:
            pdf_issues.append((md_file, pdf_url, result["reason"]))
        elif result.get("source") == "biorxiv":
            pdf_biorxiv += 1

    print(f"  - arxiv: {len(all_pdf_refs) - pdf_biorxiv - len(pdf_issues)}")
    print(f"  - biorxiv: {pdf_biorxiv}")
    print(f"  - issues: {len(pdf_issues)}")

    for md_file, pdf_url, reason in pdf_issues:
        findings.append({
            "file": str(md_file.relative_to(PROJECT_ROOT)),
            "issue": "malformed_pdf_url",
            "severity": "medium",
            "detail": f"{reason}: {pdf_url}"
        })

    # Check figure webp existence - REPORT ALL
    print(f"Checking {len(all_figure_refs)} figure webp files...")
    missing_figures = []
    found_figures = 0
    for md_file, fig_url in all_figure_refs:
        if find_figure_on_disk(fig_url):
            found_figures += 1
        else:
            missing_figures.append((md_file, fig_url))

    print(f"  - found: {found_figures}")
    print(f"  - missing: {len(missing_figures)}")

    # Report ALL missing figures
    for md_file, fig_url in missing_figures:
        findings.append({
            "file": str(md_file.relative_to(PROJECT_ROOT)),
            "issue": "missing_figure",
            "severity": "high",
            "detail": f"Figure webp not found: {fig_url}"
        })

    # Check body images and internal links (sample)
    print(f"Checking body images and internal links in {sample_size} samples...")

    for md_file in sample_files:
        try:
            content = md_file.read_text(encoding='utf-8')
        except:
            continue

        body_images = extract_body_images(content)
        for img in body_images:
            img_path = img['path']
            if img_path.startswith('http://') or img_path.startswith('https://'):
                continue
            full_path = md_file.parent / img_path
            if not full_path.exists():
                findings.append({
                    "file": str(md_file.relative_to(PROJECT_ROOT)),
                    "issue": "missing_body_image",
                    "severity": "high",
                    "detail": f"Body image not found: {img_path}"
                })

        internal_links = extract_internal_links(content, md_files)
        for link in internal_links:
            if link["type"] == "wikilink" and not link["found"]:
                findings.append({
                    "file": str(md_file.relative_to(PROJECT_ROOT)),
                    "issue": "broken_wikilink",
                    "severity": "medium",
                    "detail": f"Wikilink target not found: {link['target']}"
                })

    # Check all wikilinks
    print("Checking all wikilinks in all files...")
    all_wikilinks = {}
    for md_file in md_files:
        try:
            content = md_file.read_text(encoding='utf-8')
        except:
            continue
        internal_links = extract_internal_links(content, md_files)
        for link in internal_links:
            if link["type"] == "wikilink" and not link["found"]:
                key = (str(md_file.relative_to(PROJECT_ROOT)), link['target'])
                all_wikilinks[key] = True

    print(f"  - broken wikilinks: {len(all_wikilinks)}")

    for (filepath, target), _ in all_wikilinks.items():
        findings.append({
            "file": filepath,
            "issue": "broken_wikilink",
            "severity": "medium",
            "detail": f"Wikilink target not found: {target}"
        })

    print("\n=== SUMMARY ===")
    print(f"Total MD files: {len(md_files)}")
    print(f"PDF URLs: {len(all_pdf_refs)} (valid: {len(all_pdf_refs) - len(pdf_issues)}, issues: {len(pdf_issues)})")
    print(f"Figure refs: {len(all_figure_refs)} (found: {found_figures}, missing: {len(missing_figures)})")
    print(f"Wikilinks: broken: {len(all_wikilinks)}")
    print(f"Total findings: {len(findings)}")

    output_file = PROJECT_ROOT / "scripts" / "audit_findings.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(findings, f, indent=2, ensure_ascii=False)
    print(f"Findings written to: {output_file}")

    issue_types = {}
    for f in findings:
        t = f['issue']
        issue_types[t] = issue_types.get(t, 0) + 1
    print("\nIssue types:")
    for t, count in sorted(issue_types.items(), key=lambda x: -x[1]):
        print(f"  {t}: {count}")

if __name__ == "__main__":
    main()
