# Reader project instructions

Instructions for AI coding agents working in this repository. Human
contributors should start with [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Required contracts

- [`context/document-integrity.md`](context/document-integrity.md) — read before changing document I/O,
  filesystem mutations, workspace authorization, or native file/folder handoff.

## macOS app build gate

[`./macos/build-app.sh`](macos/build-app.sh) produces `build/Reader.app`. That bundle is regenerated
build output, not committed, and not something to launch directly: it is not
the app the user runs day to day. [`install/Reader.command`](install/Reader.command) is the installer and the one-step update path;
double-clicking it quits a running Reader, always rebuilds via
`./macos/build-app.sh`, copies the fresh `build/Reader.app` to
`~/Applications/Reader.app`, and opens that installed copy, which is the app
the user actually runs.

- After changing `static/`, [`reader.py`](reader.py), [`reader_backend.py`](reader_backend.py), [`VERSION`](VERSION), the
  macOS launcher or icon sources, licenses, or bundle metadata, run
  `./macos/build-app.sh` before declaring the work complete.
- Do not treat manual edits inside `build/Reader.app` as a finished build. The
  script must recreate and sign the bundle.
- Verify the finished bundle with `codesign --verify --deep --strict build/Reader.app`
  and confirm changed source resources match their copies under
  `build/Reader.app/Contents/Resources/`.
- If the build or signature check cannot complete, state that the macOS app is
  not ready for testing.

## Versioning

[`VERSION`](VERSION) at the repo root is the only place the version number lives. The
server reads it at startup and the build script stamps it into [`Info.plist`](macos/Info.plist).
Bump it and add a [`CHANGELOG.md`](CHANGELOG.md) entry in the same change as a release.
