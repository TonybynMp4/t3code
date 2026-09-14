# 0004-linux-desktop-entry-identity.patch

Makes a `.deb`/`.rpm` install group under its own launcher icon.

Upstream's Linux desktop identity is written for the AppImage case, where no
`.desktop` file is installed by a package manager. So the app synthesises a
hidden, icon-less handler entry named after the reverse-DNS app id
(`com.t3tools.T3Code.desktop`) and points the window identity at it via
`app.setDesktopName`. On X11 that is invisible to window matching, which keys
off `StartupWMClass` / the `--class` switch (both `t3code`). On Wayland,
however, the compositor matches a window to a launcher by its **app id**, which
`setDesktopName` sets. So a Wayland session matched the window to the hidden
entry, which has no `Icon=`, instead of the pinned launcher, spawning a
second, generic "cog" icon in the dash.

Our `.deb`/`.rpm` already ships `/usr/share/applications/t3code.desktop` with
the icon, `StartupWMClass=t3code`, and the `x-scheme-handler/t3code` MIME
registration. So for a packaged, non-AppImage install this patch:

- sets the window identity to `t3code.desktop` (app id `t3code`) so Wayland
  matches the installed launcher;
- stops writing the redundant hidden reverse-DNS entry (writing it under
  `$XDG_DATA_HOME/applications` (default `~/.local/share/applications`) would
  only give the compositor a rival, icon-less entry to match again);
- points the `xdg-mime default` scheme registration at that same installed
  `t3code.desktop`;
- aligns compositor window snapshot and shortcut matching in `DesktopSnapShot`
  with `t3code` so window captures and shortcuts route to the packaged window
  instead of looking for the reverse-DNS identity.

The AppImage path (`$APPIMAGE` set) and the unpackaged dev path are unchanged:
both still synthesise and own the handler entry, because no package-installed
`.desktop` exists for them. The gate is `app.isPackaged && !$APPIMAGE` in the
pre-ready module and `environment.isPackaged && Option.isNone(appImagePath)` in
the runtime handler and snapshot capture service, the same "is this a deb/rpm
install" test across all three consumers.

If it stops applying, reapply the same idea wherever the identity is set: for a
package-managed Linux install, adopt the installed launcher's basename
(`t3code`) as the window app id and do not write a competing entry. What matters
is that the running window's app id equals the installed `.desktop` basename
across startup identity, URL handler registration, and compositor snapshot
matching.

## Variants

Upstream has moved this logic around more than once, into shapes that are not
textually compatible with each other (same regions rewritten, not just context
drifting), so a single diff can't apply to every tag we build. When that
happens we keep one `.patch` file per shape as siblings named
`0004-linux-desktop-entry-identity.<variant>.patch`; `apply-mirror-patches.sh`
tries every variant sharing the `0004` prefix and applies whichever one applies
cleanly to the tag being built.

- `0004-linux-desktop-entry-identity.patch` — the shape above, where
  `linuxDesktopEntryName` is the reverse-DNS id (`com.t3tools.T3Code.desktop`):
  identity is set from `DesktopPreReadyPlatform.ts`, `DesktopLinuxUrlHandler.ts`
  writes the handler entry, and `DesktopSnapShot.ts` derives its own app id. All
  three must be switched to `t3code` for a `.deb`/`.rpm` install.
- `0004-linux-desktop-entry-identity.appidentity.patch` — an earlier shape where
  `linuxDesktopEntryName` is already `t3code.desktop` and `DesktopAppIdentity.ts`
  sets the window app id from it unconditionally, so identity is **already**
  `t3code` for every packaged install. Here the only remaining fix is stopping
  `DesktopLinuxUrlHandler.ts` from writing (and registering `xdg-mime` against)
  the redundant hidden `t3code-url-handler.desktop` entry.

If upstream reshuffles again and neither variant applies, add a new
`.<variant>.patch` sibling for the new shape rather than replacing an existing
one — another currently-supported tag may still need it.

Any new variant must satisfy the whole invariant above, not part of it — in
particular the window app id **must** end up as `t3code` for a packaged,
non-AppImage install (that is the fix), not only stop writing the hidden entry.
Verify the shape's identity path actually adopts `t3code` before trusting a
variant: a refactor that centralizes identity elsewhere may still be feeding it
the reverse-DNS `linuxDesktopEntryName`, which silently reintroduces the
second-icon bug. Confirm against the shape's real source, not an assumption
about where identity moved.
