#!/usr/bin/env bash
# Called when a mirror patch stops applying to an upstream tag. Files an issue
# describing what broke, then tries to put GitHub Copilot on it.
#
# The issue is the point of this script: it is the notification and the record,
# and it is filed with whatever token is available. Assigning Copilot is a
# best-effort extra, because it needs a PAT (GITHUB_TOKEN cannot assign the
# agent) and because the fix is a judgement call either way — Copilot opens a
# pull request against main, and a human merges it. Nothing here auto-merges:
# a silently wrong reapplication would ship a build whose update button is
# quietly dead.
set -euo pipefail

: "${TAG:?}" "${RUN_URL:?}" "${GITHUB_REPOSITORY:?}"

git checkout -- . 2>/dev/null || true

# Name the patches that no longer apply, so the issue points at a file rather
# than at a log the reader has to scroll.
shopt -s nullglob
stale=()
for patch in mirror-patches/*.patch; do
  if ! git apply --3way --check "$patch" >/dev/null 2>&1; then
    stale+=("$patch")
  fi
  git checkout -- . 2>/dev/null || true
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
  echo "Update the patch file on \`main\` so it applies to \`$TAG\`, preserving what it does — \`mirror-patches/README.md\` explains the intent of each one, and the intent is what matters, not the exact diff. Upstream has moved the code the patch targets; find where it went and patch it there."
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
  echo "Open a pull request against \`main\` with the updated patch file. Do not merge it: a patch that applies but no longer does the right thing ships a build whose in-app updater is silently broken, so a human reviews this one. Once it is merged, re-run the build for this tag from Actions → Mirror Linux build."
  echo
  echo "No upstream file is edited on \`main\` — only the patch file changes."
} > /tmp/mirror-patch-issue.md

gh label create mirror-patch --repo "$GITHUB_REPOSITORY" \
  --color B60205 --description "A patch in mirror-patches/ stopped applying" >/dev/null 2>&1 || true

issue_url="$(gh issue create --repo "$GITHUB_REPOSITORY" \
  --title "$title" --label mirror-patch --body-file /tmp/mirror-patch-issue.md)"
echo "Filed $issue_url"

if [[ -z "${COPILOT_TOKEN:-}" ]]; then
  echo "MIRROR_COPILOT_TOKEN is not set, so Copilot was not assigned. Fix the patch by hand, or add the secret." >&2
  exit 0
fi

issue_number="${issue_url##*/}"
owner="${GITHUB_REPOSITORY%%/*}"
name="${GITHUB_REPOSITORY##*/}"

# Copilot is started by assigning it the issue; there is no workflow trigger
# for it. It only appears in suggestedActors when the coding agent is enabled
# for the repository and the token has the right scopes.
export GH_TOKEN="$COPILOT_TOKEN"

bot_id="$(gh api graphql -f owner="$owner" -f name="$name" \
  -f query='
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        suggestedActors(capabilities: [CAN_BE_ASSIGNED], first: 100) {
          nodes { login ... on Bot { id } ... on User { id } }
        }
      }
    }' \
  --jq '.data.repository.suggestedActors.nodes[]
        | select(.login == "copilot-swe-agent") | .id' 2>/dev/null || true)"

issue_id="$(gh api graphql -f owner="$owner" -f name="$name" -F number="$issue_number" \
  -f query='
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) { issue(number: $number) { id } }
    }' \
  --jq '.data.repository.issue.id' 2>/dev/null || true)"

if [[ -z "$bot_id" || -z "$issue_id" ]]; then
  echo "Copilot is not assignable in this repository; the issue stands on its own." >&2
  exit 0
fi

gh api graphql \
  -f assignableId="$issue_id" -f actorId="$bot_id" \
  -f query='
    mutation($assignableId: ID!, $actorId: ID!) {
      replaceActorsForAssignable(input: { assignableId: $assignableId, actorIds: [$actorId] }) {
        assignable { ... on Issue { number } }
      }
    }' >/dev/null

echo "Assigned Copilot to $issue_url"
