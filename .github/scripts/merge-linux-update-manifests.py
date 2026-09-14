#!/usr/bin/env python3
"""Merge the per-target electron-updater feeds into one feed per architecture.

Upstream's release job builds a single Linux target, so it never hits this.
This fork builds deb and rpm as separate matrix entries, and electron-builder
writes a `latest-linux.yml` (or `latest-linux-arm64.yml`) from each one
describing only the artifact that run produced. Publishing them as-is means the
last upload wins and one of the two formats never sees an update.

electron-updater's findFile() picks its own extension out of the feed's
`files` list and ignores the rest, so the correct feed is the union - exactly
what a single multi-target build would have emitted. Merging here keeps the
build matrix parallel without changing any upstream file.
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

# Order matters: the first present target supplies the legacy top-level
# path/sha512 that pre-6.x clients fall back to when `files` is absent.
TARGET_PRIORITY = ("deb", "rpm")


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 3):
        print(f"usage: {argv[0]} <release-assets-dir> [expected-version]", file=sys.stderr)
        return 2

    assets = Path(argv[1])
    expected_version = argv[2] if len(argv) == 3 else None
    manifest_dir = assets / "manifests"
    if not manifest_dir.is_dir():
        print(f"No manifests directory in {assets}", file=sys.stderr)
        return 1

    # "<target>-<feed>.yml" -> group by feed, which already encodes the arch.
    groups: dict[str, dict[str, Path]] = {}
    for manifest in sorted(manifest_dir.glob("*.yml")):
        target, _, feed = manifest.name.partition("-")
        if not feed:
            print(f"Unexpected manifest name {manifest.name}", file=sys.stderr)
            return 1
        groups.setdefault(feed, {})[target] = manifest

    if not groups:
        print(f"No manifests found in {manifest_dir}", file=sys.stderr)
        return 1

    for feed, by_target in sorted(groups.items()):
        ordered = [t for t in TARGET_PRIORITY if t in by_target]
        ordered += [t for t in sorted(by_target) if t not in TARGET_PRIORITY]

        merged: dict | None = None
        files: list[dict] = []
        seen: set[str] = set()
        versions: set[str] = set()

        for target in ordered:
            data = yaml.safe_load(by_target[target].read_text())
            version = data.get("version")
            if not version:
                # A feed with no version advertises an update to "None" and
                # breaks auto-update on every client that reads it.
                print(f"{feed}: {target} manifest has no version", file=sys.stderr)
                return 1
            versions.add(str(version))
            if merged is None:
                merged = dict(data)
            for entry in data.get("files") or []:
                url = entry.get("url")
                if url in seen:
                    continue
                seen.add(url)
                files.append(entry)

        assert merged is not None
        if len(versions) != 1:
            # Mismatched versions mean the matrix built different tags, and a
            # merged feed would advertise an update that does not exist.
            print(f"{feed}: conflicting versions {sorted(versions)}", file=sys.stderr)
            return 1

        # A feed that names a package this run did not build publishes an
        # update button that 404s, which no later check here would notice.
        missing = [entry["url"] for entry in files if not (assets / entry["url"]).is_file()]
        if missing:
            print(f"{feed}: no such artifact {', '.join(missing)}", file=sys.stderr)
            return 1

        version = next(iter(versions))
        if expected_version is not None and version != expected_version:
            print(f"{feed}: built {version}, expected {expected_version}", file=sys.stderr)
            return 1

        merged["files"] = files
        out = assets / feed
        out.write_text(yaml.safe_dump(merged, default_flow_style=False, sort_keys=False))
        print(f"{feed}: merged {len(files)} artifact(s) from {', '.join(ordered)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
