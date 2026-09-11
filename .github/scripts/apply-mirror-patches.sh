#!/usr/bin/env bash
# Applies mirror-patches/*.patch onto the upstream tag checked out in the current
# repository. Run from the repository root, after the workflow has brought
# mirror-patches/ in from this fork's ref.
#
# Pass --check to validate without leaving the patches applied.
#
# The patches live in a directory on main rather than as commits on it, so
# syncing upstream stays conflict-free; the cost is applying them here.
# `git apply --3way` needs each patch's pre-image blob in the object database,
# which the fetch that brought mirror-patches/ in also provides, and it lets a patch
# keep applying while upstream edits the code around it.
set -euo pipefail

check_only=0
if [[ "${1:-}" == "--check" ]]; then
  check_only=1
fi

shopt -s nullglob
patches=(mirror-patches/*.patch)
if [[ "${#patches[@]}" -eq 0 ]]; then
  echo "No patches to apply."
  exit 0
fi

for patch in "${patches[@]}"; do
  echo "Applying $patch"
  args=(--3way --verbose)
  if [[ "$check_only" -eq 1 ]]; then
    args+=(--check)
  fi
  if ! git apply "${args[@]}" "$patch"; then
    # A failed --3way leaves conflict markers behind. Print them: the
    # surrounding upstream code is exactly what whoever rewrites the patch,
    # human or Copilot, needs to see.
    echo "::error file=$patch::$patch does not apply to this tag" >&2
    git --no-pager diff -- . ':!mirror-patches' || true
    git checkout -- . || true
    exit 1
  fi
done

if [[ "$check_only" -eq 0 ]]; then
  # Leave the tree as the upstream tag plus the patched files. `git checkout`
  # staged mirror-patches/ when it fetched it; drop it from index and disk.
  # (Note the name: upstream's own patches/ holds pnpm patchedDependencies
  # and must not be touched.)
  git rm -r --cached --quiet mirror-patches
  rm -rf mirror-patches
fi
