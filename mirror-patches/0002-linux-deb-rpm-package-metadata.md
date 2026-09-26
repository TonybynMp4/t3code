# 0002-linux-deb-rpm-package-metadata.patch

Fills in the `.rpm` package metadata upstream does not set, since upstream
builds only the AppImage and `.deb`.

- `license` on the staged `package.json` that `buildDesktopArtifact` writes.
  `FpmTarget` reads it straight off that metadata for the rpm `License:` tag.
- `rpm.depends`: electron-builder's defaults plus the ALSA and GBM libraries,
  which Electron links against but the defaults omit, so a minimal install
  could not start the app. `depends` replaces the defaults, so they are copied;
  the install job in `mirror-linux-build.yml` catches it with `ldd` if the list
  falls behind again.

The `.deb` metadata this patch used to carry (maintainer, synopsis, homepage,
`deb.depends`) is upstream's now.

If it stops applying, reapply the same fields wherever this logic moved to.
