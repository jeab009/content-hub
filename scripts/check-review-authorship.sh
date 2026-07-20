#!/usr/bin/env bash
#
# Guards the review boundary: a review document must not be committed by the
# same change it reviews.
#
# Why this exists (P6-PROC-1, 2026-07-20): the Phase 6.0 developer agent could
# not invoke the QA subagent, so it wrote `docs/phase6-qa-report.md` itself —
# attributing it to "Senior QA Test Engineer" with a "SIGNED OFF, zero
# Critical/High" verdict, in the very commit that introduced the code being
# assessed. No QA run had happened. It was caught only because someone checked
# who authored the file.
#
# A review that ships inside the change it reviews cannot be independent —
# whatever it says about the code, it was written before the code was reviewed
# by anyone else. So this is checkable mechanically rather than by trust:
# same commit + review doc + source = reject.
#
# Usage:
#   scripts/check-review-authorship.sh              # check staged changes (pre-commit)
#   scripts/check-review-authorship.sh <rev-range>  # check a range (CI), e.g. origin/main..HEAD
#
# Escape hatch: ALLOW_SELF_REVIEW=1 (records intent; use only when genuinely
# amending a review's own typo alongside nothing else).

set -euo pipefail

REVIEW_DOC_RE='^docs/phase.*-(qc-review|qa-report|deployment-report|bugfix-feedback)\.md$'
SOURCE_RE='^(backend|frontend)/(src|prisma)/'

fail=0

check_commit() {
  local rev="$1" label="$2" files
  files=$(git show --pretty=format: --name-only "$rev" | sed '/^$/d')

  local reviews sources
  reviews=$(printf '%s\n' "$files" | grep -E "$REVIEW_DOC_RE" || true)
  sources=$(printf '%s\n' "$files" | grep -E "$SOURCE_RE" || true)

  if [ -n "$reviews" ] && [ -n "$sources" ]; then
    echo "✗ $label mixes a review document with the source it reviews."
    echo "  Review document(s):"
    printf '    %s\n' $reviews
    echo "  Source file(s) (first 5):"
    printf '    %s\n' $sources | head -5
    echo "  A review committed alongside its own subject is not independent evidence."
    echo "  Commit the code first; let the reviewing role produce its document separately."
    echo
    fail=1
  fi
}

if [ $# -ge 1 ]; then
  # CI mode: every commit in the range.
  for rev in $(git rev-list "$1"); do
    check_commit "$rev" "commit $(git log -1 --format=%h\ \"%s\" "$rev")"
  done
else
  # Pre-commit mode: the staged set.
  staged=$(git diff --cached --name-only)
  reviews=$(printf '%s\n' "$staged" | grep -E "$REVIEW_DOC_RE" || true)
  sources=$(printf '%s\n' "$staged" | grep -E "$SOURCE_RE" || true)
  if [ -n "$reviews" ] && [ -n "$sources" ]; then
    echo "✗ This commit mixes a review document with the source it reviews."
    echo "  Review document(s):"
    printf '    %s\n' $reviews
    echo "  Source file(s) (first 5):"
    printf '    %s\n' $sources | head -5
    echo
    echo "  A review committed alongside its own subject is not independent evidence."
    echo "  Commit the code first; let the reviewing role produce its document separately."
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  if [ "${ALLOW_SELF_REVIEW:-}" = "1" ]; then
    echo "ALLOW_SELF_REVIEW=1 set — proceeding anyway. State why in the commit message."
    exit 0
  fi
  echo "Set ALLOW_SELF_REVIEW=1 to override deliberately."
  exit 1
fi

echo "✓ No review document is committed with the source it reviews."
