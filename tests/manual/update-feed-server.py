#!/usr/bin/env python3
"""Serve a release manifest and a zip, so the macOS updater can be exercised.

This is a manual test aid, not a unit test. It is under `tests/manual/` and has
no `test_` prefix, so `python3 -m unittest discover -s tests` never collects it.

The launcher's update check normally asks GitHub for the latest release and
reads the `manifest.json` asset attached to it. Setting READER_UPDATE_FEED
replaces that lookup with a direct URL to a manifest, which is what this script
serves, together with the zip the manifest points at.

End-to-end run, from a clean checkout:

    # 1. Install the current version where the updater is allowed to work.
    ./macos/build-app.sh
    ditto install/Reader.app ~/Applications/Reader.app

    # 2. Build the "newer" release from a bumped VERSION.
    echo 2.1.0 > VERSION
    ./macos/build-app.sh
    mkdir -p /tmp/reader-feed
    ditto -c -k --keepParent install/Reader.app /tmp/reader-feed/Reader-2.1.0.zip
    git checkout VERSION            # put the committed version back

    # 3. Write the manifest and serve it.
    python3 tests/manual/update-feed-server.py /tmp/reader-feed \
        --version 2.1.0 --zip Reader-2.1.0.zip --port 8901

    # 4. Launch the installed copy pointed at the local feed.
    READER_UPDATE_FEED=http://127.0.0.1:8901/manifest.json \
        ~/Applications/Reader.app/Contents/MacOS/ReaderLauncher

Then choose "Check for Updates…" in the Reader menu rather than waiting the
twenty seconds the automatic check waits, and watch the terminal: this script
logs each request, so a missing manifest or zip fetch is obvious.

The manifest is written for you from the zip on disk, so the size and SHA-256
always match what is served. Pass --sha256 or --size to serve deliberately wrong
values and confirm the launcher refuses the download.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_manifest(directory: Path, args: argparse.Namespace, base: str) -> Path:
    archive = directory / args.zip
    if not archive.exists():
        sys.exit(f"No such archive: {archive}")
    manifest = {
        "version": args.version,
        "url": f"{base}/{args.zip}",
        "sha256": args.sha256 or sha256_of(archive),
        "size": args.size if args.size is not None else archive.stat().st_size,
        "minimum_macos": args.minimum_macos,
        "published_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "signing_identity": args.signing_identity,
    }
    path = directory / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("directory", type=Path, help="folder holding the zip")
    parser.add_argument("--version", required=True, help="version the manifest offers")
    parser.add_argument("--zip", required=True, help="zip filename inside the folder")
    parser.add_argument("--port", type=int, default=8901)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--minimum-macos", default="13.0.0")
    parser.add_argument("--signing-identity", default="Reader Local Signing")
    parser.add_argument("--sha256", help="serve this digest instead of the real one")
    parser.add_argument("--size", type=int, help="serve this size instead of the real one")
    args = parser.parse_args()

    directory = args.directory.expanduser().resolve()
    if not directory.is_dir():
        sys.exit(f"No such folder: {directory}")

    base = f"http://{args.host}:{args.port}"
    manifest = write_manifest(directory, args, base)
    print(f"Serving {directory} on {base}")
    print(f"  manifest: {manifest}")
    print(f"  READER_UPDATE_FEED={base}/manifest.json")

    handler = partial(SimpleHTTPRequestHandler, directory=str(directory))
    ThreadingHTTPServer((args.host, args.port), handler).serve_forever()


if __name__ == "__main__":
    main()
