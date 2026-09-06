# Changelog

All notable changes to Reader. Versions follow [semantic versioning](https://semver.org).

## Unreleased

- The settings dialog now sizes itself proportionally to the window on large displays instead of stopping at a fixed rem cap, so it no longer reads as a small box on a big screen.
- Settings has an **Interface size** control in Appearance: Small, Medium or
  Large. It scales Reader's own chrome, meaning the settings dialog, the file
  panel, the toolbar and the menus, and it is separate from the document's
  reading size, so a large interface can still hold compact reading text.
  ⌘+ and ⌘− still change the document text and nothing else. One root scale
  drives it: chrome measurements are written in rem and the root font size is
  the only thing the setting moves.
- The settings dialog is roomier and now follows the window. It sizes itself
  against the viewport instead of sitting at one fixed 1020×680 box, labels and
  headings are a step larger, rows have more air between them, and each section
  is a titled card so groups read as separate things rather than one continuous
  run of rows. Below 620px wide a row stacks its control under its label instead
  of crushing it.
- Settings → **About** was reshaped around Reader's icon: the app mark, the name,
  the version quietly beneath it, and one sentence about what Reader does. The
  update status and its button are now an ordinary settings row like every other
  control, and the credits and install path are small muted text at the bottom.
  The install path abbreviates your home folder to `~` instead of wrapping a long
  absolute path across two lines.

- File references in the docs are now clickable links, checked by a new `tests/` regression test.
- [`install/Reader.command`](install/Reader.command) is now a one-step update action: double-clicking it
- Settings → **About** now describes Reader to the person using it: what it
  opens and edits, that documents stay as ordinary files in their own folders,
  and that it works offline. It used to explain the loopback address, the
  request token and atomic saves, which is design documentation; those facts
  still live in the README under "Notes on how it works" and in
  `docs/macos.md`. The version and the folder Reader runs from are still there.
- About has a **Check for updates** button and a status line, so updating no
  longer means finding the menu bar. It says "Checking for updates…", then
  whether this is the newest release, which newer version exists, or why the
  check failed. Everything about the update itself stays in the launcher: the
  page can ask only for the check it already runs, and the download, digest,
  signature and designated-requirement checks are untouched. Switching
  **Check for updates** off in Files & watching still stops the daily check;
  pressing the button is an explicit request and still answers.
- In a browser, where there is no Reader.app to ask, About says updates are
  handled by the Reader app instead of showing a button that cannot work.
- `install/Reader.command` is now a one-step update action: double-clicking it
  quits a running Reader (a graceful quit targeted at Reader's bundle
  identifier, so the local server it owns shuts down and no other app is
  touched), always rebuilds from source, installs the fresh build over
  `~/Applications/Reader.app` only once the build succeeds, and reopens it.
  Previously a stale build could be silently reinstalled, or an already-running
  Reader could keep serving old code because `open` just refocused it instead
  of launching the new binary.
- The macOS build output moved from `install/Reader.app` to `build/Reader.app`.
  A directory called `install/` holding a double-clickable app bundle read as
  "the installed app lives here", when it was really just regenerated build
  output; nothing changes for how Reader is installed or run.
  `install/Reader.command` still lives in `install/` and is still the
  installer: it now copies from `../build/Reader.app` instead.

## 2.2.0

- The macOS bundle identifier changed from the placeholder `com.reader.local`
  to `ai.trancend.reader`, and the exported markdown type moved with it, from
  `com.reader.markdown-variant` to `ai.trancend.reader.markdown-variant`. The
  identifier is part of the app's code-signing designated requirement, so this
  is a one-time break in the in-app updater: a copy of Reader installed before
  this release cannot update itself across the change, no matter how it is
  signed, and must be reinstalled once from the disk image. After that,
  updates resume working normally.

## 2.1.0

- Releases now also include a signed `Reader-<version>.dmg`, for a first-time
  install by dragging Reader into Applications; the in-app updater keeps using
  the zip and `manifest.json` exactly as before.
- The macOS app updates itself from GitHub Releases: a once-a-day check, a
  checksum and code-signature verification of the download, and an install that
  keeps the previous bundle until the new one launches. Turn it off with
  **Check for updates** in *Files & watching*.
- Reader is now open source under the MIT license.
- Version comes from a single [`VERSION`](VERSION) file read by the server, the app bundle
  and the release workflow.
- The built app is no longer committed; releases are built by CI.
- Neutral wording in the settings dialog; stale "Markdown Viewer" names removed.
- macOS is stated plainly as the only supported platform; the Linux and Windows
  CI jobs exist so the server does not acquire macOS-only assumptions.
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
