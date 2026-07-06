#!/usr/bin/env bash
# scripts/migrate-lfs.sh — backfill the existing 80 docs/**/*.txt
# files into Git LFS storage.
#
# WHY THIS SCRIPT EXISTS
# ---------------------
# .gitattributes (PR #E) routes NEW docs/**/*.txt commits through
# Git LFS. The ~80 .txt files committed before that rule
# however are still regular git blobs. The repo size on clone
# is dominated by these historical files. This script rewrites
# history so they all become LFS pointers, dropping clone size
# by ~5 MB and matching the rule going forward.
#
# WHY THIS SCRIPT DOES NOT AUTO-RUN
# --------------------------------
# History rewrite is structurally a destructive event:
#
#   - Every commit hash changes (every blob oid changes).
#   - Every open PR needs to rebase.
#   - Every fork clone is invalidated; contributors must
#     `git fetch origin && git reset --hard origin/main`.
#   - The push must be force-with-lease (not regular push),
#     so a concurrent push to main can be detected.
#
# The maintainer must announce this in README news / Discussions
# BEFORE running it, ideally during a low-traffic window.
#
# USAGE
# -----
#   # 1. Make sure the working tree is clean
#   git status
#
#   # 2. Confirm git-lfs is installed
#   git lfs version
#
#   # 3. Make sure you are on a fresh branch off main
#   git checkout main
#   git pull --rebase
#   git checkout -b lfs-migrate-docs-txt
#
#   # 4. Run the migration (this rewrites every commit)
#   scripts/migrate-lfs.sh
#
#   # 5. Sanity-check
#   git lfs ls-files | wc -l        # should be ~80
#   git log --oneline | wc -l       # same commit count
#   git push --force-with-lease=refs/heads/lfs-migrate-docs-txt:main
#
#   # 6. Open a PR titled "lfs: migrate docs/**/*.txt history",
#   #    linking to a Discussions thread that announces the
#   #    rewrite.
#
# The script is idempotent: running it twice produces the
# same final state (because git-lfs-migrate detects no work
# to do the second time).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v git-lfs >/dev/null 2>&1; then
  echo "[migrate-lfs] ERROR: git-lfs not installed. Install from" >&2
  echo "https://git-lfs.github.com/ before running this." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "[migrate-lfs] ERROR: working tree is dirty. Commit/stash first." >&2
  git status --short >&2
  exit 1
fi

# Pre-flight: confirm the .gitattributes rule we want to apply
# is already in place. Otherwise the migration will copy blobs
# through git itself, defeating the purpose.
if ! grep -q "docs/\*\*/\*.txt filter=lfs" .gitattributes; then
  echo "[migrate-lfs] ERROR: .gitattributes is missing the" >&2
  echo "  docs/**/*.txt filter=lfs" >&2
  echo "rule. PR #E should have added it; restore it first." >&2
  exit 1
fi

# Pre-flight: count how many docs/**/*.txt are currently
# tracked as ordinary git blobs.
TRACKED=$(git ls-files 'docs/**/*.txt' | wc -l)
LFS_ALREADY=$(git lfs ls-files | wc -l)
echo "[migrate-lfs] docs/**/*.txt tracked: $TRACKED"
echo "[migrate-lfs] docs/**/*.txt already in LFS: $LFS_ALREADY"

if [ "$LFS_ALREADY" -ge "$TRACKED" ]; then
  echo "[migrate-lfs] Nothing to do — all files already in LFS." >&2
  exit 0
fi

echo "[migrate-lfs] Running 'git lfs migrate import'."
echo "  This will rewrite every commit hash in the repo's history."
echo "  Push the result with --force-with-lease only after announcing"
echo "  the rewrite to all contributors."

# --everything rewrites the entire history. We do NOT use
# --no-rewrite because the maintainer does want every commit
# to point at the LFS-moved blob.
git lfs migrate import \
  --include='docs/**/*.txt' \
  --include-ref=refs/heads/main \
  --exclude='docs/**/*.txt.swp' \
  --yes

echo
echo "[migrate-lfs] Done. Verify with:"
echo "  git lfs ls-files | wc -l     # should be ~80 now"
echo "  git ls-files 'docs/**/*.txt' | wc -l   # same number, but as LFS pointers"
echo
echo "  If the count looks right, run:"
echo "  git push --force-with-lease=refs/heads/<your-branch>:main"
echo
echo "  See the file header for the full safe-push procedure."
