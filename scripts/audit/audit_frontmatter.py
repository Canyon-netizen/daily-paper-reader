#!/usr/bin/env python3
"""
Audit frontmatter of all paper MD files under docs/papers/
"""

import os
import re
import json
import yaml
from pathlib import Path

PAPERS_DIR = Path("E:/study/daily-paper-reader/docs/papers")
EXCLUDE_DIR = "topic-seeds-game-ai-vector-skill2vector.md"

REQUIRED_FIELDS = [
    "title", "title_zh", "authors", "date", "generated_at",
    "pdf", "categories", "tags", "score", "evidence", "tldr",
    "source", "selection_source", "figures_json", "formulas_json"
]

OPTIONAL_DEEP = ["motivation", "method", "result", "conclusion", "context"]

VALID_SOURCES = {"arxiv", "openreview", "neurips", "icml", "iclr", "cvpr", "iccv", "aaai", "ijcai", "iclr", "nips"}

def parse_frontmatter(content):
    """Extract frontmatter from markdown file"""
    if not content.startswith("---"):
        return None, "No frontmatter delimiter"

    parts = content.split("---", 2)
    if len(parts) < 3:
        return None, "Incomplete frontmatter"

    fm_text = parts[1]
    try:
        data = yaml.safe_load(fm_text)
        return data, None
    except Exception as e:
        return None, f"YAML parse error: {e}"

def extract_arxiv_id_from_path(path):
    """Extract arxiv ID from file path like docs/papers/2026/07/22/2607.14777v1-xxx.md"""
    filename = path.stem
    # Match pattern like 2607.14777v1
    match = re.match(r'(\d{4}\.\d{4,5}v\d+)', filename)
    if match:
        return match.group(1)
    # Also try to find biorxiv pattern
    match = re.search(r'(10\.\d+/[^/-]+)', filename)
    if match:
        return match.group(1)
    return None

def validate_file(filepath):
    """Validate a single paper MD file"""
    findings = []
    path = filepath.relative_to(PAPERS_DIR.parent)

    try:
        content = filepath.read_text(encoding="utf-8")
    except Exception as e:
        findings.append({
            "file": str(path),
            "issue": "Cannot read file",
            "severity": "high",
            "detail": f"File read error: {e}"
        })
        return findings

    data, err = parse_frontmatter(content)
    if err:
        findings.append({
            "file": str(path),
            "issue": "Frontmatter parse failure",
            "severity": "high",
            "detail": err
        })
        return findings

    if not isinstance(data, dict):
        findings.append({
            "file": str(path),
            "issue": "Frontmatter is not a dict",
            "severity": "high",
            "detail": f"Type: {type(data)}"
        })
        return findings

    # 1. Check required fields
    for field in REQUIRED_FIELDS:
        if field not in data:
            findings.append({
                "file": str(path),
                "issue": f"Missing required field: {field}",
                "severity": "high",
                "detail": f"Field '{field}' is required but not present"
            })

    # 2. Type checks (only if field exists)
    if "title" in data:
        if not isinstance(data["title"], str) or len(data["title"]) == 0:
            findings.append({
                "file": str(path),
                "issue": "Invalid title type",
                "severity": "high",
                "detail": f"title must be non-empty string, got: {type(data['title'])}"
            })

    if "date" in data:
        date_match = re.match(r'^\d{4}-\d{2}-\d{2}$', str(data["date"]))
        if not date_match:
            findings.append({
                "file": str(path),
                "issue": "Invalid date format",
                "severity": "high",
                "detail": f"date must be YYYY-MM-DD, got: {data['date']}"
            })

    if "score" in data:
        try:
            score = float(data["score"])
            if not (0.0 <= score <= 10.0):
                findings.append({
                    "file": str(path),
                    "issue": "Score out of range",
                    "severity": "high",
                    "detail": f"score must be 0.0-10.0, got: {score}"
                })
        except (TypeError, ValueError):
            findings.append({
                "file": str(path),
                "issue": "Invalid score type",
                "severity": "high",
                "detail": f"score must be float, got: {type(data['score'])}"
            })

    if "pdf" in data:
        pdf = str(data["pdf"])
        if not pdf.startswith("http"):
            findings.append({
                "file": str(path),
                "issue": "Invalid pdf URL",
                "severity": "high",
                "detail": f"pdf must be URL, got: {pdf}"
            })

        # 3. PDF URL matches filename arxiv id
        arxiv_id = extract_arxiv_id_from_path(filepath)
        if arxiv_id:
            if arxiv_id not in pdf:
                findings.append({
                    "file": str(path),
                    "issue": "PDF URL does not match filename arxiv ID",
                    "severity": "medium",
                    "detail": f"Filename has {arxiv_id} but PDF URL is {pdf}"
                })

    if "tags" in data:
        if not isinstance(data["tags"], list):
            findings.append({
                "file": str(path),
                "issue": "Invalid tags type",
                "severity": "high",
                "detail": f"tags must be list, got: {type(data['tags'])}"
            })

    if "categories" in data:
        cats = data["categories"]
        if not isinstance(cats, dict):
            findings.append({
                "file": str(path),
                "issue": "Invalid categories type",
                "severity": "high",
                "detail": f"categories must be dict with venue/task/method/type, got: {type(cats)}"
            })
        else:
            expected_keys = {"venue", "task", "method", "type"}
            actual_keys = set(cats.keys())
            if expected_keys - actual_keys:
                findings.append({
                    "file": str(path),
                    "issue": "Missing categories keys",
                    "severity": "medium",
                    "detail": f"Missing: {expected_keys - actual_keys}"
                })
            for k, v in cats.items():
                if not isinstance(v, list):
                    findings.append({
                        "file": str(path),
                        "issue": f"Invalid categories.{k} type",
                        "severity": "high",
                        "detail": f"categories.{k} must be list, got: {type(v)}"
                    })

    # 6. Evidence non-empty
    if "evidence" in data:
        if not data["evidence"] or len(str(data["evidence"]).strip()) == 0:
            findings.append({
                "file": str(path),
                "issue": "Empty evidence field",
                "severity": "high",
                "detail": "evidence must be non-empty"
            })

    # 7. TLDR non-empty (Chinese summary)
    if "tldr" in data:
        if not data["tldr"] or len(str(data["tldr"]).strip()) == 0:
            findings.append({
                "file": str(path),
                "issue": "Empty tldr field",
                "severity": "high",
                "detail": "tldr must be non-empty Chinese summary"
            })

    # 8. Source validation
    if "source" in data:
        source = str(data["source"]).lower()
        if source not in VALID_SOURCES:
            findings.append({
                "file": str(path),
                "issue": "Invalid source value",
                "severity": "medium",
                "detail": f"source must be one of {VALID_SOURCES}, got: {source}"
            })

    # Check deep-only fields (motivation, method, result, conclusion, context)
    # These should exist if the paper has been deeply analyzed
    has_deep_fields = any(f in data for f in OPTIONAL_DEEP)
    if has_deep_fields:
        for field in OPTIONAL_DEEP:
            if field not in data:
                findings.append({
                    "file": str(path),
                    "issue": f"Missing deep-analysis field: {field}",
                    "severity": "low",
                    "detail": f"Paper has some deep fields but missing {field}"
                })

    # Check figures_json is valid JSON
    if "figures_json" in data:
        try:
            json.loads(data["figures_json"])
        except (json.JSONDecodeError, TypeError):
            findings.append({
                "file": str(path),
                "issue": "Invalid figures_json JSON",
                "severity": "high",
                "detail": "figures_json must be valid JSON string"
            })

    # Check formulas_json is valid JSON
    if "formulas_json" in data:
        try:
            json.loads(data["formulas_json"])
        except (json.JSONDecodeError, TypeError):
            findings.append({
                "file": str(path),
                "issue": "Invalid formulas_json JSON",
                "severity": "high",
                "detail": "formulas_json must be valid JSON string"
            })

    return findings

def main():
    all_findings = []

    # Get all MD files
    md_files = []
    for root, dirs, files in os.walk(PAPERS_DIR):
        for f in files:
            if f.endswith(".md") and f != EXCLUDE_DIR:
                md_files.append(Path(root) / f)

    print(f"Found {len(md_files)} MD files to audit")

    for i, filepath in enumerate(md_files):
        if (i + 1) % 100 == 0:
            print(f"Processed {i + 1}/{len(md_files)} files...")

        findings = validate_file(filepath)
        all_findings.extend(findings)

    print(f"\n=== AUDIT COMPLETE ===")
    print(f"Total files: {len(md_files)}")
    print(f"Total findings: {len(all_findings)}")

    # Summary by severity
    high = [f for f in all_findings if f["severity"] == "high"]
    medium = [f for f in all_findings if f["severity"] == "medium"]
    low = [f for f in all_findings if f["severity"] == "low"]

    print(f"High severity: {len(high)}")
    print(f"Medium severity: {len(medium)}")
    print(f"Low severity: {len(low)}")

    # Summary by issue type
    issue_counts = {}
    for f in all_findings:
        issue = f["issue"]
        issue_counts[issue] = issue_counts.get(issue, 0) + 1

    print("\n=== ISSUE TYPE COUNTS ===")
    for issue, count in sorted(issue_counts.items(), key=lambda x: -x[1]):
        print(f"  {issue}: {count}")

    # Output JSON
    output_path = "E:/study/daily-paper-reader/frontmatter_audit_findings.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_findings, f, ensure_ascii=False, indent=2)
    print(f"\nJSON output written to: {output_path}")

    # Show some examples
    if high:
        print("\n=== HIGH SEVERITY EXAMPLES (first 10) ===")
        for f in high[:10]:
            print(f"  {f['file']}: {f['issue']}")

if __name__ == "__main__":
    main()
