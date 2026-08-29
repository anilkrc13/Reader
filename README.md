# Reader

A small, self-contained document reader for macOS: markdown, code, CSV and
PDF. Markdown and code open with editing and saving; CSV renders as tables;
PDF uses your browser's own viewer. It runs a local server on your own
machine and opens in your browser. No installation, no dependencies, no
network access.

## Start it

Double-click **`install/Reader.command`** in Finder.

It opens its sibling native app at **`install/Reader.app`**. If that bundle is
missing, the command builds it first. Reader then manages its own local server
and window; quitting the app stops only the server it started.

> The first time you double-click it, macOS may ask whether you're sure you
> want to open it. Choose **Open**. If Finder opens the file in a text editor
> instead of running it, run `chmod +x "install/Reader.command"` once in
> Terminal.

From the command line you can also do:

```
python3 reader.py                      # start in your home folder
python3 reader.py ~/Documents/notes    # start in a folder
python3 reader.py ~/notes/spec.md      # open a file straight away
```

### Native macOS app

The repository includes a small native macOS launcher. It opens the existing
Reader interface in a WebKit window, starts the bundled server only when no
compatible Reader server is already listening, and stops only a server it
started itself.

Build it with the macOS Command Line Tools installed:

```
./macos/build-app.sh
open install/Reader.app
```

The app is built for Apple silicon by default and includes the server, static
UI, licenses, and the original Reader app icon. To build a universal app on a
Mac with the required SDK support, use:

```
ARCHS="arm64 x86_64" ./macos/build-app.sh
```

The app requires `python3` on the Mac that runs it. If port 8737 already has a
Reader server, the app reuses it and leaves it running when the app quits. If
another service owns that port, the app reports the conflict and does not
stop or replace it. `install/Reader.command` opens this exact same bundle; it does not
start a second server or use separate icon assets. A saved Edge/PWA launcher
remains browser-owned and cannot use Reader.app's adaptive Dock icon; use
`install/Reader.command` or `install/Reader.app` for the native path. Because
this is a local unsigned build, macOS may show a
first-launch warning; Control-click the app, choose **Open**, and confirm.

### Why macOS keeps asking for folder permissions

Because an ad-hoc signature is derived from the bundle's own bytes. Its
designated requirement is a bare content hash:

```
designated => cdhash H"26e68e53a7b3ce765be0c532a456a83f1f441ef2"
```

macOS keys folder-access consent to that requirement, and the hash changes on
every build — even a rebuild from unchanged sources. Every build was therefore a
new app as far as the privacy database was concerned, and every permission you
had granted was thrown away.

The fix is to sign with a certificate, which pins the requirement to the
certificate instead of to the bundle. Reader can make its own, once per user:

```
./macos/ensure-signing-identity.sh
```

That creates a self-signed code-signing certificate in a keychain of Reader's
own, beside Reader's preferences — no Apple developer account, and your login
keychain is left alone. macOS asks for your login password one time, to trust the
certificate for code signing, because `codesign` refuses an untrusted identity
outright. Afterwards `build-app.sh` finds and reuses it automatically, so folder
permissions you grant now outlive every later build.

`build-app.sh` creates the identity on first use when you run it from a terminal.
Run non-interactively it will not raise a password dialog on its own — it signs
ad-hoc and says so. `READER_SIGNING=create` forces creation from a script.

If you do have an Apple certificate, it takes precedence:

```
CODE_SIGN_IDENTITY="Apple Development: you@example.com (TEAMID)" ./macos/build-app.sh
```

Either way the app stays unnotarised, so the first-launch warning above is
unchanged. To undo Reader's identity completely:

```
security delete-keychain ~/Library/Application\ Support/Reader/signing/reader-signing.keychain-db
security remove-trusted-cert ~/Library/Application\ Support/Reader/signing/certificate.pem
rm -rf ~/Library/Application\ Support/Reader/signing
```

### Opening files from Finder

Reader declares the document types it renders, so it can be the app a document
opens with. Select a file in Finder, press **⌘I**, and set *Open with* — or
Control-click → *Open With*. Double-clicking then hands the file to Reader:
if Reader is not running it starts and opens straight into that document, and if
it is already running the open window switches to it, moving the file tree to the
document's folder when the document sits outside the folder you were browsing.

All six markdown extensions Reader treats as markdown (`.md .markdown .mdown
.mkd .mdx .mdc`) are covered, along with every other type Reader reads that macOS
has a declared type for — `.txt`, `.csv/.tsv`, `.pdf`, `.py`, `.json`, `.yaml`,
`.html`, `.sh`, `.swift`, `.java`, `.c/.cpp`, `.sql` and the rest of the source
family. Reader offers itself as an alternate handler for those, so it never
displaces Preview or Numbers unless you choose it.

A few extensions macOS has no declared type for at all — `.go .rs .kt .cs .lua
.jsx .cjs .scss .less .conf .env` — cannot appear in *Open With* without Reader
claiming those file kinds system-wide, which it deliberately does not do. Open
those from inside Reader's own file tree.

### Turning it into a browser app

The address never changes, so you can install it:

- **Chrome / Edge / Brave** — open http://127.0.0.1:8737, then
  ⋮ menu → *Cast, save and share* → **Install page as app**.
- **Safari** — File → **Add to Dock**.

Start the launcher first so the server is running, then click the installed
app any time. The browser stays authorised, so the app opens straight into
your last document.

## Using it

| | |
|---|---|
| **Pinned** | Any folders you want one click away. Pin from a folder's **⋯** menu, drag a folder from the tree into the section, or press **+** to pin the folder you are browsing. Drag pinned rows to reorder them; hover one and press **×** to remove it. Home, Desktop and Documents are there to begin with. |
| **What it opens** | Markdown (rendered, editable), a curated set of code files (highlighted like an editor, with line numbers, editable), CSV/TSV (as tables), and PDF (the browser's native viewer, read-only). |
| **Recent** | The documents you opened most recently, newest first. Length is configurable, and you can clear the list. |
| **Browse** | Click folders to expand them; click a `.md` file to open it. Drag a file onto another folder to move it there. Double-click a folder to make it the top of the tree. The header above the tree works like Finder's title bar: it names the folder you are in, **↑** climbs one level, and clicking the name drops down the chain of enclosing folders. Folders that hold no readable document anywhere inside are left out of the tree — *Files & watching* has a switch to show them. |
| **Row menu** | Hover any row and press **⋯** (or right-click it). Files offer **Open**, **Rename…** and **Move to Trash…**; folders offer **Browse from here**, **Pin this folder** and **Rename…** — deliberately no delete, since too much can disappear in one click. Deleting a file always asks first and moves it to the macOS Trash, so you can put it back from Finder. Renaming without typing an extension keeps the current one, and the open document follows its own rename. |
| **Panel side** | The panel icon at the top of the file panel flips it between the left and right edge; the reveal button follows it. The `‹` icon hides the panel and `⌘\` brings it back — or just rest the pointer on that edge and the panel floats out until you leave it, like the Claude app. |
| **Hidden files** | Names beginning with a dot are left out of the tree. `⇧⌘.` shows them and hides them again, the same as in Finder, and *Files & watching* has the same switch. |
| **Modes** | **Preview**, **Split** and **Edit**. `⌘E` toggles preview and edit. In split view the two sides scroll together. |
| **Save** | `⌘S`, or the save button. The orange dot next to the filename means unsaved changes. |
| **Copy** | The copy icon puts the whole document on the clipboard in two flavours at once: formatted, for rich editors (Word, Docs, mail), and the raw markdown for plain-text targets. Code files copy as plain text. |
| **Auto-refresh** | While you read, the open document is watched. If something else rewrites it, the app reloads it and keeps your place. If you have unsaved edits it never overwrites them — it shows a bar offering **Reload from disk** or **Keep mine**. |
| **Refresh** | `⌘R`, or the circular arrow, to reload by hand. |
| **Full screen** | The corners icon, or `⌃⌘F`. `Esc` leaves it. |
| **Back and forward** | The `‹` and `›` arrows, `⌘[` / `⌘]`, or bare `←` / `→` while reading. Each document in the trail remembers where you were in it, so going back returns you to the paragraph you left rather than to the top — and going forward again returns you to where you were reading there. In Edit mode the editor's scroll and caret come back with it. |
| **Find** | `⌘F` opens a find bar above the document. It highlights every match, counts them, and `⌘G` / `⇧⌘G` — or `↵` / `⇧↵` — step between them; `Esc` closes it. A match is found even where it spans styling, so searching `one two` finds **one** two. There is no toolbar button: the shortcut is the whole interface. |
| **Find a file** | `⌘F` while the file panel has focus searches names instead, anywhere below the folder you are browsing — including folders you never expanded. Each hit shows the folder holding it, `↑`/`↓` move, `↵` opens it and takes the tree with it. |
| **Settings** | `⌘,` or the gear. See below. |

## Settings

Seven sections, in a dialog laid out like the Claude desktop app:

- **Appearance** — colour scheme (match system / light / dark), accent colour,
  light-mode paper (cream, white, sepia, grey), dark-mode surface
  (ink, charcoal, black), a translucent frosted-glass panel option, and which
  side the file panel sits on.
- **Reading** — three presets (Compact, Comfortable, Focus) plus individual
  control of body and heading typeface, text size, line height, line width and
  paragraph spacing. A live specimen shows the effect as you drag.
- **Code** — highlight palette (brand, muted, vivid), monospace face, code size,
  and whether long lines wrap.
- **Editor** — editor typeface and size, tab width, spell check, split-view
  scroll syncing, word count.
- **Files & watching** — length of the recent list, clearing it, restoring the
  default pins, showing unsupported files, showing hidden files and folders,
  auto-refresh on and off, how often to check, and whether a refresh is
  announced.
- **Shortcuts** — the full list.
- **About** — version, where the app and its preferences live.

Everything you choose is remembered between restarts, along with the folder you
were browsing, the file you were reading, the panel side and width, and the
view mode. Preferences are written to `preferences.json` beside this file, so
moving the folder takes your setup with it.

### Verification

Run the focused server-side save and path-policy tests with:

```
python3 -m unittest discover -s tests -v
```

## What it renders

GitHub-flavoured markdown: tables, task lists, footnotes, fenced code with
syntax highlighting, and inline HTML. Relative image paths resolve against the
document's folder.

A link follows the same rules as clicking the file in the panel, so where it
leads does not depend on how you got there. Markdown, code and CSV open in
place; a PDF opens in the built-in viewer; Word, Excel, Keynote, Pages and
images are handed to the app that owns them. A link to something Reader neither
renders nor hands on says so rather than failing silently, and a link to a file
that has since moved reports that instead.

A link to the web — a Google Doc, a ticket, anything `http` or `https` — opens in
your default browser, along with `mailto:` and `tel:`. That is deliberate rather
than a shortcut: your browser is where you are already signed in, Google refuses
to accept a sign-in from inside an embedded web view at all, and it keeps
arbitrary web pages out of the process holding Reader's folder permissions. Only
these four schemes are handed on; a document cannot start a program merely by
linking to it. Reader's own window never navigates away from its local server,
so a link cannot replace the app with a web page and leave you with no way back.

Links live in the rendered document, so they are clickable in Preview and on the
preview side of Split. The editor shows the source, where a link is just text.

## Notes on how it works

- The server binds to `127.0.0.1` only, on port 8737. Requests must carry a
  session cookie set from a secret stored in `.reader-token` (readable only by
  you), the `Host` header must be a loopback name, and cross-origin API calls
  are refused — so nothing on your network, and no website you happen to have
  open, can reach your files through it.
- Rendered HTML is sanitised before display, so a document containing a
  `<script>` tag cannot act on your files.
- Saving is atomic — write to a temporary file, then replace — so an
  interrupted save cannot truncate your document. Saves are limited to
  supported text documents in the active workspace; Reader's own project files
  and paths outside that workspace are protected. If the file changed on disk
  since you opened it, you are asked before anything is overwritten.
- Deleting never unlinks anything, and only ever applies to single files —
  the server refuses to trash a folder at all, and refuses to rename or touch
  your home folder, the root of the disk, or any folder containing Markdown
  Viewer itself.
- Listed files: markdown (`.md` family), ~40 common code and config types
  (`.py .js .ts .json .yaml .sh .sql .go .rs .java` and friends), `.csv/.tsv`,
  `.txt` and `.pdf`. Hidden files and folders are skipped unless you ask for
  them, with the switch in *Files & watching* or `⇧⌘.` from anywhere — Finder's
  own shortcut. PDFs are read-only and served straight to the browser's
  built-in viewer, never edited.
- Deciding whether a folder holds a document means looking inside it. That walk
  stops at six levels deep, at 4000 entries, or after 1.5 seconds for a whole
  listing — and when it is cut short the folder is shown rather than hidden, so
  a document can never become unreachable.
- Searching for a file by name walks the same way and is bounded the same way:
  eight levels, 120000 entries, three seconds, 200 results. It goes
  breadth-first, so when a bound is reached what survives is the matches nearest
  the folder you are in, and the panel says the list was cut short rather than
  implying it is complete.
- That search skips build output, dependency and tool caches, version-control
  internals, and the parts of `~/Library` that hold application state — a
  Home-wide search otherwise spent its whole allowance in `go/pkg/mod` and
  `Library/Caches` and reported three matches where there were fifty-six. Cloud
  folders are deliberately not skipped: Google Drive, OneDrive and iCloud Drive
  live under `~/Library` and hold real documents.
- Unlike the tree, which never probes Desktop, Documents or Downloads on its own
  initiative, a search you typed does look inside them — you asked. macOS may
  raise its folder-consent prompt the first time. `~/Music` is never searched;
  the access policy refuses that path outright.
- Starting the launcher while the app is already running just opens the
  existing window instead of starting a second server.

## Third-party components

Bundled locally in `static/`, licences in `licenses/`:
[marked](https://marked.js.org) (markdown), [DOMPurify](https://github.com/cure53/DOMPurify)
(sanitising), [highlight.js](https://highlightjs.org) (code), and the
[Poppins](https://fonts.google.com/specimen/Poppins),
[EB Garamond](https://fonts.google.com/specimen/EB+Garamond),
[Figtree](https://fonts.google.com/specimen/Figtree),
[Satoshi](https://www.fontshare.com/fonts/satoshi) (ITF Free Font License),
[Lora](https://fonts.google.com/specimen/Lora),
[Inter](https://fonts.google.com/specimen/Inter),
[Source Serif 4](https://fonts.google.com/specimen/Source+Serif+4) and
[JetBrains Mono](https://www.jetbrains.com/lp/mono/) typefaces
(SIL Open Font License).
