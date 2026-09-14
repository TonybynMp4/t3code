# 0003-linux-appstream-metainfo.patch

Generates an AppStream component at build time and installs it at
`/usr/share/metainfo/com.t3tools.t3code.metainfo.xml`.

Software centres read AppStream, not the Debian control fields. Without this
file GNOME Software lists T3 Code as "Unknown License", with no release details
and an unknown age rating, no matter what 0002 puts in the package metadata.

Four details are easy to get wrong:

- **`<launchable type="desktop-id">t3code.desktop</launchable>` is required.**
  `LinuxTargetHelper.getDesktopFileName()` falls back to `executableName`, so
  the installed entry is `t3code.desktop`, which does not match the component
  id. Nothing associates the two without this tag.
- **The install goes through `deb.fpm` and `rpm.fpm`, not `linux.fpm`.** `fpm`
  is declared on `LinuxTargetSpecificOptions`, which `DebOptions` and
  `RpmOptions` extend; `LinuxConfiguration` does not have it, and
  electron-builder hard-fails on unknown config keys. `FpmTarget` splices those
  args in immediately before its own `src=dest` mappings, so
  `"<abs-src>=<abs-dest>"` installs an arbitrary file.
- **The file is written to a temp directory, not into the stage.** Anything
  under the staged app directory is also packed into `app.asar`.
- **`<pkgname>` is what makes any of this visible.** Distro catalog data
  (DEP-11) gets it injected by `appstream-generator`; a metainfo file installed
  straight from a package has to declare it itself. Without it nothing
  associates the component with the installed package, and a software centre
  shows only the PackageKit view — name and icon off the `.desktop` entry,
  summary, description, homepage and version off the deb control fields, and
  none of the AppStream data. That failure is quiet: `appstreamcli dump
com.t3tools.t3code` reports the component as fully loaded, license,
  screenshot and releases included, while GNOME Software renders none of it.
  The value has to stay equal to the staged `package.json` `name`, because that
  is what electron-builder hands fpm as the package name
  (`FpmTarget.computeFpmMetaInfoOptions` passes `meta.name`, which is
  `AppInfo.linuxPackageName`, which is `name` verbatim unless it starts with
  `@`). `DESKTOP_LINUX_PACKAGE_NAME` exists so the two cannot drift: the
  staged `name` and `<pkgname>` both read it.

`renderAppStreamMetainfo` takes `releaseDate`, and `createBuildConfig` takes an
already-written `linuxMetainfoPath`, rather than either reading the clock or
touching the filesystem itself. Both stay pure, which is how the rest of that
file is written.

`<releases>` carries the build's own version and date, which is what removes
GNOME Software's "No details for this release".

`<developer id="io.github.tonybynmp4">` names the fork, which is what builds
and ships these packages; `<name>` stays `T3 Tools`, from `LICENSE`.

`<screenshots>` points at `mirror-assets/screenshot-desktop.png`, served over
`raw.githubusercontent.com` from this fork's `main`. AppStream only takes
absolute remote URLs, and only PNG or JPEG — the upstream marketing site serves
that shot as webp behind a content-hashed Astro path that dies on its next
build, so the file is converted and committed here instead of hotlinked. The
`width`/`height` attributes must keep matching the file (1728x1080); replacing
the asset means updating them.

The `<summary>` and `<description>` wording duplicates 0002's `synopsis` and
`linux.description` on purpose, so neither patch depends on the other. Change
both together.

If it stops applying, the behaviour to restore is: render the component, write
it somewhere outside the stage, and hand its absolute path to both fpm targets.

## Variants

Upstream reshuffled `createBuildConfig` / `buildDesktopArtifact` between the
tags we build, so one diff cannot apply to every tag. As with 0004, we keep one
`.patch` per shape named `0003-linux-appstream-metainfo.<variant>.patch`;
`apply-mirror-patches.sh` picks whichever applies cleanly to the tag being
built. The two differ only in context and offsets — the metainfo behaviour they
add is identical, so a change to one must be mirrored into the other.

Tell the shapes apart by the `bundlesWslRuntime` call in the stage package
json:

- `0003-linux-appstream-metainfo.patch` — the current shape, where it is
  `bundlesWslRuntime({ platform, runtimeArchivePath })` (nightly, `v0.0.41-*`).
- `0003-linux-appstream-metainfo.wslprebuild.patch` — the older shape, where it
  is `bundlesWslRuntime({ arch, prebuildPath })` (stable, `v0.0.40`).

CI checks patches against a shallow checkout, so the pre-image blobs `git apply
--3way` wants are absent and application falls back to a plain, exact match. A
variant that only merges with `--3way` in a full clone will still fail the
build; verify a new variant with a plain `git apply --check` against the tag.
