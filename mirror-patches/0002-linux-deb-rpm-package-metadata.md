# 0002-linux-deb-rpm-package-metadata.patch

Fills in the package metadata that `.deb`/`.rpm` targets need and upstream never
does, since its own CI only builds an AppImage.

`buildDesktopArtifact` in `scripts/build-desktop-artifact.ts` writes a fresh
`package.json` into the staged app directory rather than reusing
`apps/desktop/package.json`, so `author`, `homepage` and `license` have to be set
there. `FpmTarget` reads `license` straight off that staged metadata for the rpm
`License:` tag. `createBuildConfig`'s Linux branch carries the rest:

- `maintainer`, which fpm checks independently of the top-level `author`.
- `synopsis` and `description`. Upstream's staged `description` is the
  build-internal string `"T3 Code desktop build"`, and
  `LinuxTargetHelper.getDescription` feeds it to the deb `Description:` field,
  the rpm `%description`, and the `.desktop` `Comment` — so it surfaced verbatim
  in `apt show` and as both title and subtitle in GNOME Software.
- `desktop.entry` additions (`GenericName`, `Keywords`). `Keywords` is a
  desktop-entry string list, so it keeps its trailing `;` — dropping it makes
  the whole value invalid. `Comment` is deliberately not set there:
  `LinuxTargetHelper.writeDesktopEntry` merges `desktop.entry` first and then
  overwrites `Comment` from `description`, so an entry value would be silently
  dropped.
- `deb.recommends` and `deb.packageCategory`. `recommends` includes
  `policykit-1 | pkexec` because electron-updater installs a downloaded `.deb`
  through `pkexec`. It also repeats electron-builder's own default
  (`libappindicator3-1`): in 26.15.6 `FpmTarget` *replaces* the defaults when
  `recommends` is set rather than extending them, and there is no `"default"`
  sentinel. If a future electron-builder gains one, prefer it over the copy.

If it stops applying, reapply the same fields wherever this logic moved to.
