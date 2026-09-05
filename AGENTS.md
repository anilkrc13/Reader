# Reader project instructions

Instructions for AI coding agents working in this repository. Human
contributors should start with `CONTRIBUTING.md`.

## Required contracts

- `context/document-integrity.md` — read before changing document I/O,
  filesystem mutations, workspace authorization, or native file/folder handoff.

## macOS app build gate

`./macos/build-app.sh` produces `install/Reader.app`. The bundle is not
committed; CI builds it for releases. It is still the primary way the user runs
Reader locally.

- After changing `static/`, `reader.py`, `reader_backend.py`, `VERSION`, the
  macOS launcher or icon sources, licenses, or bundle metadata, run
  `./macos/build-app.sh` before declaring the work complete.
- Do not treat manual edits inside `install/Reader.app` as a finished build. The
  script must recreate and sign the bundle.
- Verify the finished bundle with `codesign --verify --deep --strict install/Reader.app`
  and confirm changed source resources match their copies under
  `install/Reader.app/Contents/Resources/`.
- If the build or signature check cannot complete, state that the macOS app is
  not ready for testing.

## Versioning

`VERSION` at the repo root is the only place the version number lives. The
server reads it at startup and the build script stamps it into `Info.plist`.
Bump it and add a `CHANGELOG.md` entry in the same change as a release.
