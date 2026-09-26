# Mirror patches

Patches applied to upstream's source at build time, in filename order, by
`.github/workflows/mirror-linux-build.yml`.

Not `patches/`: that name is already upstream's, for pnpm
`patchedDependencies`. Overwriting it breaks `vp install`.

They live here rather than as commits on `main` so that `main` stays purely
additive and syncing upstream can never conflict. A patch that stops applying
fails one build of one tag, with the reject hunk in the log, instead of
blocking every future sync.

The patches deliberately add no comments to upstream's source. Each one has a
sibling `.md` of the same name holding what the hunks would otherwise have to
explain: what the patch is for, why each piece is shaped the way it is, and what
behaviour to restore if it stops applying. That keeps the diffs as small as they
can be, and keeps the reasoning readable without applying anything.

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

| Patch                                                                           | What it does                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`0002-linux-deb-rpm-package-metadata`](0002-linux-deb-rpm-package-metadata.md) | Fills in the package metadata `.rpm` needs.                        |
| [`0003-linux-appstream-metainfo`](0003-linux-appstream-metainfo.md)             | Ships an AppStream component so software centres describe the app. |
| [`0004-linux-desktop-entry-identity`](0004-linux-desktop-entry-identity.md)     | Makes a `.deb`/`.rpm` install group under its own launcher icon.   |
| [`0005-updater-error-cause-logging`](0005-updater-error-cause-logging.md)       | Logs why an updater check, download or install failed.             |
| [`0006-mirror-release-changelog`](0006-mirror-release-changelog.md)             | Separates fork changes and dates releases in the update changelog. |

`dev/` holds patches that are never applied to builds, for previewing these
in the dev app. See [`dev/README.md`](dev/README.md).

When a patch goes stale the intent is what matters, not the exact diff — read
its `.md` first, then reapply the same behaviour wherever upstream moved the
code. `MIRROR.md` covers what the sync and build jobs do when one goes stale.
