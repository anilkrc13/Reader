# Changelog

All notable changes to Reader. Versions follow [semantic versioning](https://semver.org).

## Unreleased

- Reload in a split's right-hand pane now re-reads the file panel, so new
  files and folders appear. It used to refresh only that pane's document.
- Coming back to Reader re-reads the folders the file panel shows, so files
  made elsewhere appear without Reload. The panel redraws only if something
  changed, and keeps its scroll position.
- In the macOS app, a file dragged in from Finder opens in the pane under the
  pointer, and any further files in new tabs. It opens as a Finder open does,
  read-only outside the folders Reader may edit.

## 2.5.0

- The macOS app has tabs. `⌘T`, the tab bar's `+`, `⌘`-click on a link and
  right-click **Open Link in New Tab** open one, and `⌘W` closes it. A new
  tab starts in the folder you were browsing. New Window now opens a window of
  the same app rather than a second copy, so tabs can move between windows.
  Reopening Reader restores every window with its tabs, each at its own
  document. Tab titles are set in the ordinary text colour with an icon for
  the kind of document, so inactive tabs stay readable.
- A tab can show two documents side by side. Split with the split button or
  `⌥⌘\`; the current document stays left and the right starts empty. The
  file panel opens into whichever pane was clicked last, a file can be dragged
  onto either pane, and `⌥`-click or right-click **Open to the Side** opens a
  link in the other pane. Each pane has its own Preview or Edit, its own
  history and its own half of the toolbar; the inactive pane's header dims.
  The divider drags, snaps to the middle, resets on double-click and draws the
  same soft spine as two pages. The split is restored with the tab.
- Preview, Split and Edit become two modes, **Preview** and **Edit**. Edit has
  a toggle that shows or hides the preview beside the editor, which is what
  Split was, and reopens the way it was left. `⌘E` switches the two.
- In the macOS app, the title bar row holds the panel, back and forward
  buttons beside the window buttons, and split, theme and settings at the
  other end, so Reader's toolbar is only about the document. The page shows
  its own copies again in full screen, where macOS hides the title bar. The
  full screen button is gone from the app; the green window button and `⌃⌘F`
  do it. The title and tab bars follow Reader's theme.
- The single or two-page layout and Edit's preview now belong to a tab, so
  changing them in one tab no longer changes every other tab.
- The two-page layout no longer reserves a strip at each edge for its arrows.
  The previous and next buttons sit beside the page count, and a click in
  either outer margin turns the spread, with a chevron shown on hover.
- The spread is laid out like an open book. Narrowing the reading width now
  splits the freed space so the gutter matches an outer margin, instead of
  pushing the pages apart. Light papers draw a soft spine into the fold; dark
  papers draw a hairline. Stray divider lines at the window edges are gone.
- Right-click **Open Link** and **Open Link in New Window** on a link to
  another local document now open it; they used to show "not found". A tab or
  window opened from a link never gains write access to where it points.
- `⌘←` / `⌘→` go back and forward while reading, as in Safari, and keep
  their start and end of line meaning while typing.
- The Charcoal dark surface is lighter, so it reads clearly apart from Ink.
- The document toolbar is 8px shorter; its buttons keep their size.

## 2.4.0

- Markdown Preview now offers a two-page layout from the visible page icons beside the view modes.
  Reading width applies separately to each page with balanced margins.
  Arrow keys and wheel gestures turn spreads, and narrow windows return to a
  single column. Spread arrows sit at the outer reading edges. The toolbar groups document, view, and app controls.

- Mermaid diagrams are drawn in Reader's own palette and interface face, so
  they follow the theme, the paper tint and the accent instead of arriving as
  a white picture on a dark page, and they redraw when any of those change.
  Boxes have rounded corners and room around their labels, subgraph titles are
  the same small uppercase captions the rest of the app uses and sit clear of
  the frame, and edge labels rest on a solid backing so the line no longer
  runs through the words. A diagram wider than the text column spreads towards
  the pane's edges before it is scaled, since the reading measure is set for
  lines of prose; it is never scaled below 80%, past which it keeps its size
  and the frame scrolls sideways so labels stay the size of the page's own
  text. A scaled or scrolling diagram shows "Click to enlarge" on hover and
  opens at full size in a sheet over the page; Esc, the close button or the
  backdrop dismiss it. When a diagram fails to parse, the note beneath it now
  quotes Mermaid's own reason, such as the line the parser stopped on.
## 2.3.0

- YAML front matter at the top of a Markdown file now renders as a compact
  metadata card instead of one enormous heading. The closing `---` used to be
  read as a heading underline, so a skill's `name:` and `description:` lines
  came out as a 40-word H2. Scroll sync between the editor and the preview
  still lines up: the card owns the front-matter lines.
- Files with no extension now open in Reader. A script named `bulk_read`, a
  `Makefile`, a `LICENSE` or a dotfile such as `.zshrc` is listed like any
  other document and opened on click; the content decides what it is. A shebang
  line picks the code highlighting, front matter or a leading heading opens it as
  Markdown, and anything else reads as plain text. A binary with no extension
  is refused on click with a message saying so. The check happens when you open
  the file, never while listing a folder, so a `bin` directory full of compiled
  tools costs nothing to browse.
- Reader's interface now sets in Inter instead of Poppins: the toolbar, the file
  panel, the menus and the settings dialog. Poppins is still available as a
  document heading face. Inside settings, the rail's "Settings" label and each
  section title are small uppercase captions, so the pane heading is the one
  title and row labels are the primary text in every card; the active rail item
  is a quiet neutral tint rather than an accent fill; row descriptions use the
  mid text tone so they clear 4.5:1 on every surface; the reset action sits at
  item size in the rail footer; and section titles are real headings for
  assistive technology. Settings text is also a step larger throughout: row
  labels and rail entries at 17px, descriptions and controls at 15px.
- The whole interface is one notch larger by default. The root size behind
  Reader's chrome moved from 16px to 17px at Medium, so the toolbar, the file
  panel, the menus and the settings dialog all match the size of comparable
  desktop apps. Small and Large scale from the new base; document text is
  unaffected.

- The settings dialog now sizes itself proportionally to the window on large displays instead of stopping at a fixed rem cap, so it no longer reads as a small box on a big screen.
- `install/Reader.command` now closes its own Terminal window once it has launched Reader successfully, instead of leaving it open forever; a failed run still pauses so you can read what went wrong.
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
