# 0005-updater-error-cause-logging.patch

Logs why an updater action failed, not just that it did.

`ElectronUpdaterCheckForUpdatesError`, `ElectronUpdaterDownloadUpdateError` and
`ElectronUpdaterQuitAndInstallError` each capture the thrown electron-updater
value in a `cause` field, but every handler in `DesktopUpdates.ts` logs only
`error.message`, `_tag` and `channel`. Those messages are templates — "Electron
updater failed to download the update on channel nightly." is the same string
for a 404, a sha512 mismatch, a disk-full write and a `pkexec` the user
dismissed. The one field that distinguishes them is dropped.

This matters more on this fork than upstream. A mirror release whose feed names
a package the build did not upload looks exactly like a network failure from
inside the app, and `.deb`/`.rpm` installs add `pkexec` failure modes the
AppImage never has.

The patch passes each `cause` through `describeReadinessCause` from
`@t3tools/shared/httpReadiness`, aliased at the import. Despite the name it is
generic: it normalizes an arbitrary thrown value into a plain structured record,
preserving `_tag`/`name`, `message` and nested `cause`/`reason` chains, which is
exactly what a log annotation needs. Reusing it keeps the patch to one import
and three lines; a raw `Error` in an annotation would serialize to `{}`.

If it stops applying, the fix is to add the same `cause` annotation wherever
those three handlers moved to. What matters is that an updater failure records
the underlying error, not the exact diff or the helper used to format it.
