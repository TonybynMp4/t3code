# Linux package mirror

This fork exists to build T3 Code Linux packages that upstream CI does not produce.

Upstream `pingdotgg/t3code` ships a Linux **x64 AppImage** and nothing else for Linux. This fork adds the distro packages upstream never builds:

- `.deb` and `.rpm`
- x64 and arm64

The AppImage is left to upstream; use their releases for it. Nothing else differs, apart from a three-line patch that lets `.deb` and `.rpm` installs use the in-app updater (see below). Everything else is upstream's source at an upstream tag.

## What these builds are not

They are not official. Nobody at T3 Tools signs off on them, and bugs you hit here should be reproduced against an official build before being reported upstream.

Two behavioural differences worth knowing before you install:

**Auto-update works, and it updates from this fork.** The in-app "Update available" flow works on both formats. `.deb` and `.rpm` prompt once for your password through `pkexec`, because applying the update means running `dpkg -i` or `rpm -U` as root - the same trade Windows makes with its UAC prompt. No apt or dnf repository to add, and no waiting for a scheduled `apt upgrade`.

These builds update from **this fork's** releases, not upstream's, since that is where the arm64 and distro packages live. Moving to an official build later means downloading it from upstream once.

**No cloud sign-in or T3 Connect.** Those need `T3CODE_CLERK_PUBLISHABLE_KEY` and `T3CODE_RELAY_URL`, which upstream injects from its own production environment. This fork does not have them, so `apps/server/vite.config.ts` bakes in empty strings and the features stay off. Local and LAN use is unaffected. Setting these would point users at the maintainers' relay infrastructure, so don't, without asking them first.

## How it works

`mirror-sync.yml` runs half-hourly. It merges `upstream/main` into this fork's `main`, pushes every upstream tag here, then picks the newest stable tag and the newest nightly tag that have no release in this repo. Each picked tag is handed to `mirror-linux-build.yml` as a called workflow.

Pushing tags needs a `MIRROR_SYNC_TOKEN` repository secret: a PAT with the `workflow` scope (classic) or Contents + Workflows write (fine-grained). The built-in `GITHUB_TOKEN` may never create or update files under `.github/workflows/`, and upstream tags point at commits that carry those files, so every tag push is rejected without it. The merge into `main` still works on `GITHUB_TOKEN` alone, since `main` already holds those files at the same content; only tag mirroring needs the PAT.

Only the newest tag per channel is ever built. Upstream cuts several nightlies a day, faster than four package builds finish, and there is no value in backfilling ones nobody downloaded.

`mirror-linux-build.yml` runs a four-entry matrix (`deb`/`rpm` × `x64`/`arm64`), checks out the tag, and runs upstream's own `vp run dist:desktop:artifact`. arm64 uses GitHub's native `ubuntu-24.04-arm` runners, so there is no cross-compilation and no emulation.

You can also build a specific tag by hand: Actions → Mirror Linux build → Run workflow, with a tag like `v0.0.40`. The tag has to be mirrored here first, and the workflow says so if it isn't.

## Keeping up with upstream

The build steps are copied from the "Linux x64" matrix entry in upstream's `.github/workflows/release.yml`. When upstream adds a build dependency, this fork needs it too.

There is no drift-detection job, deliberately. Upstream's `preflightLinuxDesktopBuild` in `scripts/build-desktop-artifact.ts` already checks `LINUX_DESKTOP_BUILD_PREREQUISITES` and fails with the missing package names, so a new dependency shows up as a legible build error rather than something subtle. Read that error before assuming the workflow is at fault.

Two things this fork adds that upstream's Linux job does not need:

- `fakeroot` and `rpm`, which fpm shells out to for the two package formats.
- `USE_SYSTEM_FPM=true` plus an fpm gem install on arm64. electron-builder only publishes a prebuilt fpm for x86_64 Linux; on arm64 it has nothing to download.

Each matrix entry emits its own `latest-linux.yml` (or `latest-linux-arm64.yml`) describing only the artifact that run produced, because upstream's script builds one target per invocation. Publishing them as-is would let the last upload win and leave two formats permanently without updates, so `.github/scripts/merge-linux-update-manifests.py` unions them per architecture in the publish job. That is the same feed a single multi-target build would have written, and electron-updater picks its own format out of it.

## The auto-update patch

Everything else here is additive, but in-app updates for `.deb`/`.rpm` need one upstream file changed: `apps/desktop/src/updates/DesktopUpdates.ts` refuses to update any Linux build that is not an AppImage, so the feature is unreachable no matter what CI publishes.

The capability itself is already present and needs no new code. electron-builder writes a `package-type` resource into `deb`/`rpm`/`pacman` builds whenever a publish config exists, and electron-updater's entry point reads that file to construct a `DebUpdater` or `RpmUpdater` instead of an `AppImageUpdater`. Those install via `pkexec dpkg -i` / `pkexec rpm -U` and relaunch. The patch replaces the AppImage-only check with one that also accepts a detected `package-type`, which is the marker electron-updater itself trusts.

Upstream marks deb/rpm updates a beta feature, and it does need a working `pkexec`; a desktop without polkit falls back to `gksudo`/`kdesudo` and otherwise fails the install step. Anyone who needs a self-contained, sandbox-friendly build can use upstream's AppImage instead.

## How patches are carried

The change lives in `mirror-patches/`, not as a commit on `main`. `main` therefore contains only files upstream does not have, so merging upstream can never conflict, and the sync job never needs a human at 3am.

`mirror-linux-build.yml` applies `mirror-patches/*.patch` with `git apply --3way` onto the checked-out tag, after fetching them from `main`. Three-way means a patch keeps applying while upstream edits the code around it; it only breaks once upstream touches the same lines. The blast radius of a broken patch is one build of one tag, with the reject hunk in the log, rather than a stuck sync.

A `preflight` job checks the patches before the four build jobs start, so a stale patch costs two minutes instead of four long builds.

## When a patch goes stale

Preflight files an issue labelled `mirror-patch` naming the patch and linking the failed run, then assigns GitHub Copilot to it. Copilot opens a pull request against `main` with the patch file rewritten against the new upstream code.

**Nothing auto-merges.** A patch that applies but no longer does the right thing produces a build whose update button is silently dead, and no CI check here would catch that. Review the PR, merge it, then re-run the build for that tag from Actions → Mirror Linux build.

Assignment needs a `MIRROR_COPILOT_TOKEN` repository secret holding a PAT with issue write access; `GITHUB_TOKEN` cannot assign the Copilot agent. Without it, the issue is still filed - only the automatic PR is missing. Subsequent failures comment on the open issue instead of opening new ones, since upstream cuts nightlies faster than anyone fixes a patch.

## Upstreaming

Two things here are worth offering upstream, and both are small:

- The arm64 gap is about eight lines in their release matrix, on a free runner.
- The auto-update patch is three lines and benefits them the moment they ship any distro package. It is also arguably a bug fix: the current check asks "is this an AppImage" when what it means is "can this install be updated", and electron-updater already answers that question more precisely.

This fork is worth keeping for `.deb` and `.rpm` either way, since those carry real packaging support burden upstream has not signed up for.
