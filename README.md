# Reader

Reader is a small, self-contained reader and editor for markdown, code, CSV
and PDF. Markdown and code open with editing and saving; CSV renders as
tables; PDF uses your browser's own viewer. It runs a local server on your
own machine and opens in a native macOS window or your browser.
Standard-library Python only, no network access except the once-a-day update
check, which you can turn off in *Files & watching*.

**macOS only, for now.** The app, its installer and its updater are macOS.
The server underneath is plain portable Python and its tests run on Linux and
Windows in CI, so a Windows version stays a realistic thing to build later, but
no such version exists and nothing here is supported on Windows today.

## Get it

### macOS app

Download the latest `Reader.dmg` from the
[GitHub Releases page](https://github.com/anilkrc13/Reader/releases), open
it, and drag Reader into Applications. Reader has to live in `/Applications`
or `~/Applications` for it to update itself later; running it from anywhere
else (a Downloads folder, the mounted disk image itself) still works, but
Reader will only point you at the release page for the next update instead of
installing it. It needs `python3` on the Mac that runs it, which comes with
the Xcode Command Line Tools. An app downloaded with a browser carries a
quarantine flag, so macOS shows a first-launch warning the first time you
open it; see [docs/macos.md](docs/macos.md) for how to get past it.

### From source

```
python3 reader.py                      # start in your home folder
python3 reader.py ~/Documents/notes    # start in a folder
python3 reader.py ~/notes/spec.md      # open a file straight away
```

See [docs/macos.md](docs/macos.md) for building the app yourself, signing it
so folder permissions survive rebuilds, opening files from Finder, and
turning Reader into a browser app.

## Using it

| | |
|---|---|
| **Pinned** | Any folders you want one click away. Pin from a folder's **⋯** menu, drag a folder from the tree into the section, or press **+** to pin the folder you are browsing. Drag pinned rows to reorder them; hover one and press **×** to remove it. Home, Desktop and Documents are there to begin with. |
| **What it opens** | Markdown (rendered, editable), a curated set of code files (highlighted like an editor, with line numbers, editable), CSV/TSV (as tables), and PDF (the browser's native viewer, read-only). |
| **Recent** | The documents you opened most recently, newest first. Length is configurable, and you can clear the list. |
| **Browse** | Click folders to expand them; click a `.md` file to open it. Drag a file onto another folder to move it there. Double-click a folder to make it the top of the tree. The header above the tree works like Finder's title bar: it names the folder you are in, **↑** climbs one level, and clicking the name drops down the chain of enclosing folders. Folders that hold no readable document anywhere inside are left out of the tree — *Files & watching* has a switch to show them. |
| **Row menu** | Hover any row and press **⋯** (or right-click it). Files offer **Open**, **Rename…** and **Move to Trash…**; folders offer **Browse from here**, **Pin this folder** and **Rename…** — deliberately no delete, since too much can disappear in one click. Deleting a file always asks first and moves it to the macOS Trash, so you can put it back from Finder. Renaming without typing an extension keeps the current one, and the open document follows its own rename. |
| **Panel side** | The panel icon at the top of the file panel flips it between the left and right edge; the reveal button follows it. The `‹` icon hides the panel and `⌘\` brings it back — or just rest the pointer on that edge and the panel floats out until you leave it, like a modern desktop app. |
| **Hidden files** | Names beginning with a dot are left out of the tree. `⇧⌘.` shows them and hides them again, the same as in Finder, and *Files & watching* has the same switch. |
| **Modes** | **Preview**, **Split** and **Edit**. `⌘E` toggles preview and edit. In split view the two sides scroll together. |
| **Save** | `⌘S`, or the save button. The orange dot next to the filename means unsaved changes. |
| **Copy** | The copy icon puts the whole document on the clipboard in two flavours at once: formatted, for rich editors (Word, Docs, mail), and the raw markdown for plain-text targets. Code files copy as plain text. |
| **Auto-refresh** | While you read, the open document and its embedded local images are watched. If something else rewrites them, the app refreshes the relevant preview content and keeps your place. If you have unsaved edits it never overwrites them — it shows a bar offering **Reload from disk** or **Keep mine**. |
| **Refresh** | `⌘R`, or the circular arrow, to reload by hand. |
| **Full screen** | The corners icon, or `⌃⌘F`. `Esc` leaves it. |
| **New document** | `⌘N` asks for a name and creates an empty markdown file next to the document you are reading — or, with nothing open, in the folder you are browsing. Either way the dialog shows the folder and offers **Change** to pick another one. In the app that opens Finder's own folder chooser, with your sidebar, favourites, `⌘⇧G` and **New Folder**; in a browser, which cannot open a Mac panel, a small folder list appears in the dialog instead. A folder Reader may not write to is refused the moment you choose it, saying why, rather than failing later. Nothing is written until you press **Create**. Leave the extension off and it is a `.md`. Only markdown can be created, an existing file is never overwritten, and the new document opens ready to edit. |
| **Back and forward** | The `‹` and `›` arrows, `⌘[` / `⌘]`, or bare `←` / `→` while reading. Each document in the trail remembers where you were in it, so going back returns you to the paragraph you left rather than to the top — and going forward again returns you to where you were reading there. In Edit mode the editor's scroll and caret come back with it. |
| **Find** | `⌘F` opens a find bar above the document. It highlights every match, counts them, and `⌘G` / `⇧⌘G` — or `↵` / `⇧↵` — step between them; `Esc` closes it. A match is found even where it spans styling, so searching `one two` finds **one** two. There is no toolbar button: the shortcut is the whole interface. |
| **Find a file** | `⌘F` while the file panel has focus searches names instead, anywhere below the folder you are browsing — including folders you never expanded. Each hit shows the folder holding it, `↑`/`↓` move, `↵` opens it and takes the tree with it. |
| **Settings** | `⌘,` or the gear. See below. |

## Settings

Seven sections, in a dialog laid out like a modern desktop app:

- **Appearance** — colour scheme (match system / light / dark), accent colour,
  light-mode paper (cream, white, sepia, grey), dark-mode surface
  (ink, charcoal, black), interface size (small, medium, large), a translucent
  frosted-glass panel option, and which side the file panel sits on.
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
view mode. Preferences are stored in `~/Library/Application Support/Reader`
when Reader runs as the app, or in `preferences.json` beside [`reader.py`](reader.py) when
run from source.

## Development

```
python3 -m unittest discover -s tests -v
```

runs the focused server-side save and path-policy tests. Reader also
registers a small semantic WebMCP tool set when the page is opened in a
browser that provides `document.modelContext`. The tools reuse Reader's
normal document operations and remain limited to the folder currently being
browsed; they do not expose deletion, shell commands, or arbitrary OS actions.

```
npm install
npm run test:webmcp
```

installs the browser-test dependency and runs the deterministic WebMCP
integration suite and its representative UI smoke check. CI runs the server
tests on macOS, Linux and Windows. Only macOS is a supported platform; the
other two run so the server does not quietly acquire macOS-only assumptions
before anyone ports it. See [docs/releasing.md](docs/releasing.md)
for how a tagged push turns into a signed release.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contributor guide and
[SECURITY.md](SECURITY.md) for the security policy. The macOS app bundle is
built by [`./macos/build-app.sh`](macos/build-app.sh) and is not committed.

## What it renders

GitHub-flavoured markdown: tables, task lists, footnotes, fenced code with
syntax highlighting, Mermaid diagrams in `mermaid` fences, and inline HTML.
Relative image paths resolve against the document's folder. Mermaid diagrams
are rendered locally; malformed diagrams stay visible as source with a brief
error note.

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

- The page carries a Content Security Policy that refuses inline script and any
  script from elsewhere. Reader already sanitises every document it renders; the
  policy is the second, independent lock, so that a flaw in the sanitiser is not
  by itself enough to run code inside Reader. Documents may still reference
  pictures on the web and carry their own inline styling, both of which have
  always worked.
- The app and the page talk over one named channel, used so far only to open the
  folder chooser. It answers the main frame of Reader's own page and nothing
  else.
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
  since you opened it, you are asked before anything is overwritten. Browser
  saves are queued, and each document path serializes its mtime check with its
  atomic replace, so overlapping operations cannot both pass one precondition.
- The server owns the write grants used by save, create, rename, move and Trash.
  The page may browse and read other folders, but it cannot promote one into a
  writable workspace; symlinks are resolved before the grant check.
- Deleting never unlinks anything, and only ever applies to single files —
  the server refuses to trash a folder at all, and refuses to rename or touch
  your home folder, the root of the disk, or any folder containing Reader
  itself.
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
- The macOS app makes one network request, at most once a day: it asks GitHub
  for the latest release and compares the version with its own. No identifier
  and nothing about your documents goes with it. Turn it off with **Check for
  updates** in *Files & watching*. An update it offers to install is checked
  against the checksum in the release and must satisfy the running app's own
  code-signing requirement before it can replace it; see
  [docs/macos.md](docs/macos.md).

## Third-party components

Bundled locally in `static/`, licences in `licenses/`:
[marked](https://marked.js.org) (markdown), [DOMPurify](https://github.com/cure53/DOMPurify)
(sanitising), [highlight.js](https://highlightjs.org) (code), [Mermaid](https://mermaid.js.org)
(diagrams), and the
[Poppins](https://fonts.google.com/specimen/Poppins),
[EB Garamond](https://fonts.google.com/specimen/EB+Garamond),
[Figtree](https://fonts.google.com/specimen/Figtree),
[Satoshi](https://www.fontshare.com/fonts/satoshi) (ITF Free Font License),
[Lora](https://fonts.google.com/specimen/Lora),
[Inter](https://fonts.google.com/specimen/Inter),
[Source Serif 4](https://fonts.google.com/specimen/Source+Serif+4) and
[JetBrains Mono](https://www.jetbrains.com/lp/mono/) typefaces
(SIL Open Font License).

## License

MIT, see [LICENSE](LICENSE).
