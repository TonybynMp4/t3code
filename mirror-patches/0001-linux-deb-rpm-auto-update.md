# 0001-linux-deb-rpm-auto-update.patch

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
diff.
