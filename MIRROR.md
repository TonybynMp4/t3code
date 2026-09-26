# Linux package mirror

This fork exists to build T3 Code Linux packages that upstream CI does not produce.

Upstream `pingdotgg/t3code` ships Linux only as an **AppImage** (x64 and arm64), plus the AUR packages that repackage it. This fork adds the distro packages upstream never builds:

- `.deb` and `.rpm`
- x64 and arm64

The AppImage is left to upstream; use their releases for it. The source is upstream's at an upstream tag, plus the small patches in `mirror-patches/` that make `.deb` and `.rpm` installs updatable and properly described (see below).

## What these builds are not

They are not official. Nobody at T3 Tools signs off on them, and bugs you hit here should be reproduced against an official build before being reported upstream.

Two things worth knowing before you install:

**This fork is retiring.** Upstream now ships an official `.deb` that updates itself, so these builds point the in-app updater at upstream's releases. A `.deb` install updates once more from here, then takes every later update from `pingdotgg/t3code`, which replaces this package in place (both are named `t3code`). Nothing to do by hand.

Upstream ships no `.rpm`. `.rpm` builds from here report automatic updates as unavailable; switch to upstream's AppImage or `.deb`.

**Cloud sign-in and T3 Connect work, against upstream's service.** The build bakes in the same public Clerk and relay config upstream's own release builds carry (`T3CODE_CLERK_*`, `T3CODE_RELAY_URL` in `mirror-linux-build.yml`), so these builds use the maintainers' relay infrastructure exactly like an official install. If upstream rotates any of those values, update them there.

## How it works

`mirror-sync.yml` runs half-hourly. It merges `upstream/main` into this fork's `main`, pushes every upstream tag here, then picks the newest stable tag and the newest nightly tag that have no release in this repo. Each picked tag is handed to `mirror-linux-build.yml` as a called workflow.

Pushing tags needs a `MIRROR_SYNC_TOKEN` repository secret: a PAT with the `workflow` scope (classic) or Contents + Workflows write (fine-grained). The built-in `GITHUB_TOKEN` may never create or update files under `.github/workflows/`, and upstream tags point at commits that carry those files, so every tag push is rejected without it. The merge into `main` still works on `GITHUB_TOKEN` alone, since `main` already holds those files at the same content; only tag mirroring needs the PAT.

Only the newest tag per channel is ever built. Upstream cuts several nightlies a day, faster than four package builds finish, and there is no value in backfilling ones nobody downloaded.

`mirror-linux-build.yml` runs a four-entry matrix (`deb`/`rpm` × `x64`/`arm64`), checks out the tag, and runs upstream's own `vp run dist:desktop:artifact`. arm64 uses GitHub's native `ubuntu-24.04-arm` runners, so there is no cross-compilation and no emulation.

You can also build a specific tag by hand: Actions → Mirror Linux build → Run workflow, with a tag like `v0.0.40`. The tag has to be mirrored here first, and the workflow says so if it isn't.

## Release stats

Each release body ends with a hidden, one-line `<!-- mirror-stats: {...} -->` comment: `tag`, `channel`, `publishedAt`, `upstreamPublishedAt` and `delaySeconds` (how long after upstream this build was published; `null` when upstream has no release for the tag). `version` is the format version, bumped only if a field changes meaning. A dashboard can read them all from the releases API:

```bash
gh api --paginate repos/TonybynMp4/t3code/releases \
  --jq '.[] | .body | capture("<!-- mirror-stats: (?<s>\\{.*\\}) -->").s | fromjson'
```

Releases published before the marker existed have none and are skipped by that query.

## Keeping up with upstream

The build steps are copied from the "Linux x64" and "Linux arm64" matrix entries in upstream's `.github/workflows/release.yml`. When upstream adds a build dependency, this fork needs it too.

There is no drift-detection job, deliberately. Upstream's `preflightLinuxDesktopBuild` in `scripts/build-desktop-artifact.ts` already checks `LINUX_DESKTOP_BUILD_PREREQUISITES` and fails with the missing package names, so a new dependency shows up as a legible build error rather than something subtle. Read that error before assuming the workflow is at fault.

Two things this fork adds that upstream's Linux job does not need:

- `fakeroot` and `rpm`, which fpm shells out to for the two package formats.
- `USE_SYSTEM_FPM=true` plus an fpm gem install on arm64. electron-builder only publishes a prebuilt fpm for x86_64 Linux; on arm64 it has nothing to download.

Each matrix entry emits its own `latest-linux.yml` (or `latest-linux-arm64.yml`) describing only the artifact that run produced, because upstream's script builds one target per invocation. Publishing them as-is would let the last upload win and leave two formats permanently without updates, so `.github/scripts/merge-linux-update-manifests.py` unions them per architecture in the publish job. That is the same feed a single multi-target build would have written, and electron-updater picks its own format out of it.

## The update feed

`T3CODE_DESKTOP_UPDATE_REPOSITORY` in `mirror-linux-build.yml` is `pingdotgg/t3code`, so electron-builder bakes upstream's releases into `app-update.yml`. Upstream's `DesktopUpdates.ts` enables updates for a `.deb` (electron-builder writes a `package-type` resource into it, and electron-updater installs through `pkexec dpkg -i`), and upstream's `nightly-linux.yml` / `latest-linux.yml` list its `.deb`. The `.rpm` has no upstream counterpart, and upstream's check keeps its updater off.

## How patches are carried

The change lives in `mirror-patches/`, not as a commit on `main`. `main` therefore contains only files upstream does not have, so merging upstream can never conflict, and the sync job never needs a human at 3am.

`mirror-linux-build.yml` applies `mirror-patches/*.patch` with `git apply --3way` onto the checked-out tag, after fetching them from `main`. Three-way means a patch keeps applying while upstream edits the code around it; it only breaks once upstream touches the same lines. The blast radius of a broken patch is one build of one tag, with the reject hunk in the log, rather than a stuck sync.

A `preflight` job checks the patches before the four build jobs start, so a stale patch costs two minutes instead of four long builds.

After the builds, an `install` job installs each package into a clean `debian:13` or `fedora:43` container and fails the release if the package's dependencies leave any of the app's libraries unresolved, or if the updater marker (`resources/package-type`) is missing.

## When a patch goes stale

Preflight files an issue labelled `mirror-patch` naming the patch and linking the failed run, then assigns GitHub Copilot to it. Copilot opens a pull request against `main` with the patch file rewritten against the new upstream code.

**Nothing auto-merges.** A patch that applies but no longer does the right thing produces a build whose update button is silently dead, and no CI check here would catch that. Review the PR, merge it, then re-run the build for that tag from Actions → Mirror Linux build.

Assignment needs a `MIRROR_COPILOT_TOKEN` repository secret holding a PAT with issue write access; `GITHUB_TOKEN` cannot assign the Copilot agent. Without it, the issue is still filed - only the automatic PR is missing. Subsequent failures comment on the open issue instead of opening new ones, since upstream cuts nightlies faster than anyone fixes a patch.

## Retiring

Once a release built with the upstream feed is out on each channel users are on, disable `mirror-sync.yml` (Actions → Mirror upstream → Disable workflow). A stable-channel install only moves over after this fork publishes a stable release with that feed, so leave the sync running until the next upstream stable tag has built here.
