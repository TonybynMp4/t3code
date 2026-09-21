# 0006-mirror-release-changelog.patch

Makes the in-app update changelog aware of this fork's release bodies: it
shows the fork's own changes apart from upstream's, and dates each release,
e.g. `21 Sep · 3h ago`.

electron-updater hands the popover a `{ version, note }` pair per release and
nothing else, so both features read what `mirror-linux-build.yml` writes into
the body.

**Separating the fork's changes.** The workflow puts the fork's commits under a
`## Linux build changes` heading inside the upstream changelog, before
upstream's `## New Contributors`. Unpatched, the parser skips headings and
flattens every list item into one list, keeping the last eight. So the fork's
commits were unlabelled, listed first, and with eight or more of them upstream's
changes vanished from the popup entirely. The patch routes items under that
heading into a separate list, capped on its own, until the next heading. Matching
the visible heading rather than a new marker means releases published before
this patch split correctly too.

**Dating releases.** The feed carries no per-release timestamp for the
`fullChangelog` list, and `UpdateInfo.releaseDate` only covers the offered
version. So the workflow writes a visible `Published <ISO>` line in the body's
boilerplate, below the "Full Changelog" heading so it never becomes an item, and
the patch reads the first ISO timestamp after `Published`. It cannot be an HTML
comment: electron-updater reads notes from the `releases.atom` feed, whose
rendered HTML has comments stripped. Releases without the line, including
upstream's own, simply show no date.

- `packages/contracts/src/ipc.ts` adds optional `mirrorItems`,
  `mirrorTotalItems` and `publishedAt` to `DesktopUpdateReleaseNote`. Optional
  so every existing fixture and test that builds one still typechecks without
  being patched too.
- `apps/desktop/src/updates/releaseNotes.ts` does the splitting and the date
  read. A release with only fork changes still gets a group.
- `apps/web/src/components/sidebar/SidebarUpdateReleaseNotes.tsx` renders the
  fork's items first under a muted "Linux build" subheading, then upstream's
  under "Upstream" (unlabelled when there are no fork items), counts both lists
  in the "N more changes" link, and shows the date beside each group heading.
  The absolute day is inline rather than on hover because the popover is
  itself tooltip content, and the repo lint forbids native `title` tooltips.

The date label is computed when the popover renders; there is no ticking timer.

No test hunks: the build does not run the suite, and a stale hunk in a test file
would fail a release for no runtime benefit.

If it stops applying, what matters is that each changelog group lists the
`Linux build changes` items separately from upstream's, and shows when its
release was published, read from the `Published <ISO>` line in the note. If the
workflow's heading or `Published` line changes, the parser must change with it.
`mirror-patches/dev/preview-update-changelog.sh` shows the result against the
real releases in the dev app.
