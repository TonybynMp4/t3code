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
all_patches=(mirror-patches/*.patch)
if [[ "${#all_patches[@]}" -eq 0 ]]; then
  echo "No patches to apply."
  exit 0
fi

# Patches are named NNNN-name.patch, optionally with alternate variants for a
# shape upstream has restructured into: NNNN-name.<variant>.patch. Group by
# the NNNN prefix and try each variant in that group until one applies
# cleanly, so the same logical patch keeps working across upstream reshuffles
# without us knowing in advance which shape a given tag has.
prefixes=()
for patch in "${all_patches[@]}"; do
  base=$(basename "$patch")
  prefix="${base%%-*}"
  if [[ ! " ${prefixes[*]-} " == *" $prefix "* ]]; then
    prefixes+=("$prefix")
  fi
done

for prefix in "${prefixes[@]}"; do
  variants=(mirror-patches/"$prefix"-*.patch)
  chosen=""
  for variant in "${variants[@]}"; do
    if git apply --3way --check "$variant" >/dev/null 2>&1; then
      chosen="$variant"
      break
    fi
  done

  # None of the variants apply. Re-run the first one verbosely so the
  # failure (and any conflict markers left by --3way) end up in the log for
  # whoever rewrites the patch, human or Copilot.
  if [[ -z "$chosen" ]]; then
    variant="${variants[0]}"
    echo "Applying $variant"
    args=(--3way --verbose)
    if [[ "$check_only" -eq 1 ]]; then
      args+=(--check)
    fi
    git apply "${args[@]}" "$variant" || true
    if [[ "${#variants[@]}" -gt 1 ]]; then
      echo "::error file=$variant::none of the $prefix variants apply to this tag" >&2
    else
      echo "::error file=$variant::$variant does not apply to this tag" >&2
    fi
    git --no-pager diff -- . ':!mirror-patches' || true
    git checkout -- . || true
    exit 1
  fi

  echo "Applying $chosen"
  args=(--3way --verbose)
  if [[ "$check_only" -eq 1 ]]; then
    args+=(--check)
  fi
  if ! git apply "${args[@]}" "$chosen"; then
    echo "::error file=$chosen::$chosen does not apply to this tag" >&2
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
