# Changelog

All notable changes to Reader. Versions follow [semantic versioning](https://semver.org).

## Unreleased

- Reader is now open source under the MIT license.
- Version comes from a single `VERSION` file read by the server, the app bundle
  and the release workflow.
- The built app is no longer committed; releases are built by CI.
- Neutral wording in the settings dialog; stale "Markdown Viewer" names removed.

## 2.0

- Native macOS app with a WebKit window, Finder document types and a folder
  chooser bridge.
- Editing and saving for markdown and code, CSV tables, PDF viewing.
- Find in document, find a file, back and forward history.
- Mermaid diagrams, auto-refresh of documents and embedded images.
- WebMCP tool set and a Playwright integration suite.
