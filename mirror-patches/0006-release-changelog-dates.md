# 0006-release-changelog-dates.patch

Dates each release in the in-app update changelog, e.g. `21 Sep · 3h ago`.

electron-updater hands the popover a `{ version, note }` pair per release and
nothing else: the GitHub feed it reads carries no per-release timestamp for the
`fullChangelog` list, and `UpdateInfo.releaseDate` only covers the offered
version. So `mirror-linux-build.yml` stamps each release body with a hidden
`<!-- released-at: <ISO> -->` marker next to `mirror-main`, and the patch reads
it back:

- `packages/contracts/src/ipc.ts` adds an optional `publishedAt` to
  `DesktopUpdateReleaseNote`. Optional so every existing fixture and test that
  builds one still typechecks without being patched too.
- `apps/desktop/src/updates/releaseNotes.ts` pulls the marker out of the raw
  note before `stripMarkup` discards it. A missing or unparseable marker leaves
  `publishedAt` off, so releases published before the marker existed (and
  upstream's own releases) simply show no date.
- `apps/web/src/components/sidebar/SidebarUpdateReleaseNotes.tsx` renders the
  date beside each group heading. The absolute day is shown inline rather than
  on hover because the popover is itself tooltip content, and the repo lint
  forbids native `title` tooltips.

The label is computed when the popover renders; there is no ticking timer.

No test hunks: the build does not run the suite, and a stale hunk in a test file
would fail a release for no runtime benefit.

If it stops applying, what matters is that each changelog group shows when its
release was published, read from the `released-at` marker in the note.
