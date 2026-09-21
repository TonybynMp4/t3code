#!/usr/bin/env bash
# Runs the desktop dev app against this fork's real GitHub releases, as if
# <version> were installed, with the changelog patch applied. Both patches are
# reverted on exit. See README.md next to this script.
set -euo pipefail

from="${1:?usage: $0 <installed version, e.g. 0.0.43-nightly.20260920.2031>}"
cd "$(git rev-parse --show-toplevel)"

patches=(mirror-patches/0006-*.patch mirror-patches/dev/preview-update-changelog.patch)
git apply "${patches[@]}"
trap 'git apply -R "${patches[@]}"' EXIT
trap 'exit 130' INT TERM

T3CODE_HOME="$PWD/.t3" T3CODE_DEV_UPDATE_FROM="$from" vp run dev:desktop
