# Changelog

All notable changes to Reader. Versions follow [semantic versioning](https://semver.org).

## Unreleased

- The macOS app updates itself from GitHub Releases: a once-a-day check, a
  checksum and code-signature verification of the download, and an install that
  keeps the previous bundle until the new one launches. Turn it off with
  **Check for updates** in *Files & watching*.
- Reader is now open source under the MIT license.
- Version comes from a single `VERSION` file read by the server, the app bundle
  and the release workflow.
- The built app is no longer committed; releases are built by CI.
- Neutral wording in the settings dialog; stale "Markdown Viewer" names removed.
- A tagged push now builds a signed `Reader.app`, zips it, and publishes it as
  a GitHub Release with a `manifest.json` an in-app updater can read.
- The server now runs correctly on Windows and Linux, not only macOS: opening a
  file in its default app, the per-user data directory, Trash (Recycle Bin on
  Windows, with a Reader-owned fallback), token file permissions, and search
  skip lists all dispatch on platform. Keyboard shortcut labels in the page
  show `Ctrl+` off macOS instead of a hardcoded `⌘`. CI already runs the unit
  tests on macOS, Ubuntu and Windows; this is what makes the Windows run pass.

## 2.0

- Native macOS app with a WebKit window, Finder document types and a folder
  chooser bridge.
- Editing and saving for markdown and code, CSV tables, PDF viewing.
- Find in document, find a file, back and forward history.
- Mermaid diagrams, auto-refresh of documents and embedded images.
- WebMCP tool set and a Playwright integration suite.
