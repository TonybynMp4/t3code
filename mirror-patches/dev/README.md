# Dev-only patches

Not applied to builds: the build globs `mirror-patches/*.patch`, which does not
reach this directory. These exist to preview mirror patches in the dev app.

## Previewing the update changelog

```bash
mirror-patches/dev/preview-update-changelog.sh 0.0.43-nightly.20260920.2031
```

Starts `vp run dev:desktop` with `0006-mirror-release-changelog` and
`preview-update-changelog.patch` applied, then reverts both when it exits. Dev state goes to the checkout's gitignored
`.t3`, never the shared `~/.t3`. The
update pill appears after the usual startup delay and shows the popover
exactly as an install of that version would: the real electron-updater reads
the real `releases.atom` feed and the patched parser renders it. Pick a
version a few releases back to see several groups.

The dev patch, active only in development and only when
`T3CODE_DEV_UPDATE_FROM` is set:

- enables the updater despite the unpackaged build, sets
  `forceDevUpdateConfig`, and points the feed at
  `T3CODE_DESKTOP_UPDATE_REPOSITORY` (default `TonybynMp4/t3code`);
- overrides `app.getVersion()` with the given version before electron-updater
  first reads it (in dev it is `0.0`, which electron-updater rejects);
- follows the channel of that version instead of the dev settings' channel,
  since the popover only renders for nightly.

Checking works; downloading does not, since a dev build has no `package-type`
and electron-updater looks for an AppImage. Do not press download.

Do not edit the patched files while it runs: the reverse apply on exit would
fail and leave them patched. `git checkout` those files to recover.
