#!/usr/bin/env bash
# Called when a mirror patch stops applying to an upstream tag. Files an issue
# describing what broke and mentions the repository owner. The issue is both the
# notification and the record. Nothing here tries to fix the patch: a silently
# wrong reapplication would ship a build whose update button is quietly dead.
set -euo pipefail

: "${TAG:?}" "${RUN_URL:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_REPOSITORY_OWNER:?}"

git checkout -- . 2>/dev/null || true

# Name the patches that no longer apply, so the issue points at a file rather
# than at a log the reader has to scroll. Variants of one NNNN prefix are
# alternatives (see apply-mirror-patches.sh), so a group is stale only when none
# of its variants apply; the unused variants of a working group are not.
shopt -s nullglob
stale=()
checked=()
for patch in mirror-patches/*.patch; do
  base=$(basename "$patch")
  prefix="${base%%-*}"
  if [[ " ${checked[*]-} " == *" $prefix "* ]]; then
    continue
  fi
  checked+=("$prefix")
  variants=(mirror-patches/"$prefix"-*.patch)
  applies=0
  for variant in "${variants[@]}"; do
    if git apply --3way --check "$variant" >/dev/null 2>&1; then
      applies=1
    fi
    git checkout -- . 2>/dev/null || true
  done
  if [[ "$applies" -eq 0 ]]; then
    stale+=("${variants[@]}")
  fi
done
if [[ "${#stale[@]}" -eq 0 ]]; then
  stale=(mirror-patches/*.patch)
fi

title="Mirror patch no longer applies to $TAG"

# At most one open mirror-patch issue at a time, matched by label alone.
# Upstream cuts nightlies all day; without this every failing run would open
# another copy. A second distinct patch going stale therefore comments on the
# existing issue rather than filing its own - acceptable while a human fixes
# them one at a time, but revisit if the patch set grows.
existing="$(gh issue list --repo "$GITHUB_REPOSITORY" --state open \
  --label mirror-patch --json number --jq '.[0].number // empty' 2>/dev/null || true)"
if [[ -n "$existing" ]]; then
  gh issue comment "$existing" --repo "$GITHUB_REPOSITORY" \
    --body "Still failing on \`$TAG\`. [Run]($RUN_URL)."
  echo "Commented on existing issue #$existing."
  exit 0
fi

{
  echo "@$GITHUB_REPOSITORY_OWNER"
  echo
  echo "Building upstream \`$TAG\` stopped because a patch in \`mirror-patches/\` no longer applies."
  echo
  echo "Stale:"
  for patch in "${stale[@]}"; do
    echo "- \`$patch\`"
  done
  echo
  echo "The reject hunks and the surrounding upstream code are in the [failed run]($RUN_URL)."
  echo
  echo "## What to do"
  echo
  echo "Update the patch file on \`main\` so it applies to \`$TAG\`, preserving what it does — each patch has a sibling \`.md\` in \`mirror-patches/\` explaining its intent, and the intent is what matters, not the exact diff. Upstream has moved the code the patch targets; find where it went and patch it there."
  echo
  echo "Reproduce with:"
  echo
  echo '```bash'
  echo "git checkout $TAG"
  echo "git checkout main -- mirror-patches"
  for patch in "${stale[@]}"; do
    echo "git apply --3way $patch"
  done
  echo '```'
  echo
  echo "Check the result carefully: a patch that applies but no longer does the right thing ships a build whose in-app updater is silently broken. Once the fix is on \`main\`, re-run the build for this tag from Actions → Mirror Linux build."
  echo
  echo "No upstream file is edited on \`main\` — only the patch file changes."
} > /tmp/mirror-patch-issue.md

gh label create mirror-patch --repo "$GITHUB_REPOSITORY" \
  --color B60205 --description "A patch in mirror-patches/ stopped applying" >/dev/null 2>&1 || true

issue_url="$(gh issue create --repo "$GITHUB_REPOSITORY" \
  --title "$title" --label mirror-patch --body-file /tmp/mirror-patch-issue.md)"
echo "Filed $issue_url"
