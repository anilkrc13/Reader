# Reader source ownership

Reader shares one document interface between the local server, Mac app, and
conversation extension. Application code has one owner. Platform adapters supply
operating-system or host actions rather than copying the shared interface.

```
src/reader/
  server.py, backend.py       local server and document operations
  web/
    index.html, app.js, app.css, prepaint.js
    assets/                  fonts and icons
    vendor/                  browser libraries
reader.py, reader_backend.py compatible launch and import names
macos/                       native wrapper, assets, metadata, build tools
extensions/chatgpt/           standalone host adapter package
scripts/                     development and repository tools
tests/server/                local server and tooling checks
tests/browser/               shared UI with the local server
extensions/chatgpt/tests/    protocol and simulated-host checks
build/                       ignored build and inspection output
docs/                        permanent contracts and acceptance guidance
```

Before the extension was added at `af48f8e`, the local server lived in two root
Python files and `static/` mixed application code, libraries, fonts, and icons.
The extension added a separate package with its own TypeScript and tests. It
bundles the same shared UI; it does not maintain a second Reader implementation.
The new layout separates shared implementation, assets, and vendor code without
forcing the extension's module type or dependencies into the Python/native app.

The root Python files are entry and import wrappers. Importing `reader` or
`reader_backend` returns the canonical module, so callers and tests keep the same
functions and patch targets. `python3 reader.py` remains the local launch command.
The canonical server keeps APP_DIR at the repository or bundle-resource root.
Preferences and workspace authorization still use that root. The public static
route remains `/static/`, serving only the shared web directory; asset and vendor
URLs use their named subdirectories.

The native build copies the wrappers and the same `src/` tree into its resources.
The extension build reads `src/reader/web/`, embeds styles, fonts, and scripts,
and keeps its existing standalone package and output path. Root browser tests use
one worker because their filesystem fixtures are shared. Embedded tests use two
workers because page, storage, route, and output state is isolated.

Create new source inside its owner. Put a genuinely shared behavior in the shared
implementation. Add platform actions to their adapter. Update packaging, source
references, and checks in the same change. Keep generated output out of source.
Completed plans are removed once their decisions are here and unresolved acceptance
checks are in [host acceptance](../embedded-acceptance.md). Git preserves the work's
history. New temporary plans belong under `plans/` only while they are active.
