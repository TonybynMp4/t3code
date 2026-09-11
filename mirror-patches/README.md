# Mirror patches

Patches applied to upstream's source at build time, in filename order, by
`.github/workflows/mirror-linux-build.yml`.

Not `patches/`: that name is already upstream's, for pnpm
`patchedDependencies`. Overwriting it breaks `vp install`.

They live here rather than as commits on `main` so that `main` stays purely
additive and syncing upstream can never conflict. A patch that stops applying
fails one build of one tag, with the reject hunk in the log, instead of
blocking every future sync.

Application uses `git apply --3way`, so a patch keeps working while upstream
edits the surrounding code. It only fails once upstream touches the same lines.

`--3way` needs the patch's pre-image blob (the `index abc..def` line) in the
object database to merge. The build fetches `main` at `--depth=1`, and `main`
carries the upstream files, so the blob is present as long as the patch was
generated against `main`'s current version of the file. If upstream later
changes that file and the patch is not regenerated, `main`'s tip no longer
holds the referenced blob, the depth-1 fetch cannot supply it, and `--3way`
silently degrades to a plain apply, losing the merge-around-upstream property.
So regenerate the patch against `main` (`git checkout main -- <file>`, edit,
`git diff > mirror-patches/xxxx.patch`) whenever upstream moves the file it
targets, not only when it stops applying.

## 0001-linux-deb-rpm-auto-update.patch

Lets `.deb` and `.rpm` installs use the in-app updater.

`getAutoUpdateDisabledReason` refuses to update any Linux build that is not an
AppImage, which makes the feature unreachable no matter what CI publishes. The
underlying capability already exists on both sides: electron-builder writes a
`package-type` resource into `deb`/`rpm`/`pacman` builds whenever a publish
config is present, and electron-updater reads that same file to construct a
`DebUpdater` or `RpmUpdater`, which install via `pkexec dpkg -i` / `pkexec rpm
-U` and relaunch.

The patch replaces the AppImage-only check with one that also accepts a
detected `package-type` — the marker electron-updater itself trusts.

If it stops applying, the fix is almost always to reapply the same condition
wherever that function moved to. What matters is the behaviour, not the exact
diff. See MIRROR.md for what happens when one goes stale.

## 0002-linux-deb-rpm-package-metadata.patch

Sets the project `homepage`, `author` email, and `.deb` `maintainer` that
electron-builder requires for `.deb`/`.rpm` targets but that upstream never
needs, since its own CI only builds an AppImage.

`buildDesktopArtifact` in `scripts/build-desktop-artifact.ts` writes a fresh
`package.json` into the staged app directory rather than reusing
`apps/desktop/package.json`, so the fields have to be set there, and
`createBuildConfig`'s Linux branch has to carry an explicit `maintainer` too:
`fpm` (the tool behind both package formats) checks for it independently of
the top-level `author`.

If it stops applying, reapply the same three fields (`homepage`, `author`,
`linux.maintainer`) wherever this logic moved to.
