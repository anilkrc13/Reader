# Reader

A small, self-contained document reader for macOS: markdown, code, CSV and
PDF. Markdown and code open with editing and saving; CSV renders as tables;
PDF uses your browser's own viewer. It runs a local server on your own
machine and opens in your browser. No installation, no dependencies, no
network access.

## Start it

Double-click **`Reader.command`** in Finder.

A Terminal window opens and your browser opens the app at
**http://127.0.0.1:8737**. Keep that Terminal window open while you work;
close it, or press `Control-C` in it, to stop the server.

> The first time you double-click it, macOS may ask whether you're sure you
> want to open it. Choose **Open**. If Finder opens the file in a text editor
> instead of running it, run `chmod +x "Reader.command"` once in
> Terminal.

From the command line you can also do:

```
python3 reader.py                      # start in your home folder
python3 reader.py ~/Documents/notes    # start in a folder
python3 reader.py ~/notes/spec.md      # open a file straight away
```

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
| **Browse** | Click folders to expand them; click a `.md` file to open it. Double-click a folder to make it the top of the tree. The header above the tree works like Finder's title bar: it names the folder you are in, **↑** climbs one level, and clicking the name drops down the chain of enclosing folders. Folders that hold no readable document anywhere inside are left out of the tree — *Files & watching* has a switch to show them. |
| **Row menu** | Hover any row and press **⋯** (or right-click it). Files offer **Open**, **Rename…** and **Move to Trash…**; folders offer **Browse from here**, **Pin this folder** and **Rename…** — deliberately no delete, since too much can disappear in one click. Deleting a file always asks first and moves it to the macOS Trash, so you can put it back from Finder. Renaming without typing an extension keeps the current one, and the open document follows its own rename. |
| **Panel side** | The panel icon at the top of the file panel flips it between the left and right edge; the reveal button follows it. The `‹` icon hides the panel and `⌘\` brings it back — or just rest the pointer on that edge and the panel floats out until you leave it, like the Claude app. |
| **Modes** | **Preview**, **Split** and **Edit**. `⌘E` toggles preview and edit. In split view the two sides scroll together. |
| **Save** | `⌘S`, or the save button. The orange dot next to the filename means unsaved changes. |
| **Auto-refresh** | While you read, the open document is watched. If something else rewrites it, the app reloads it and keeps your place. If you have unsaved edits it never overwrites them — it shows a bar offering **Reload from disk** or **Keep mine**. |
| **Refresh** | `⌘R`, or the circular arrow, to reload by hand. |
| **Full screen** | The corners icon, or `⌃⌘F`. `Esc` leaves it. |
| **Find** | Your browser's own `⌘F` searches the rendered document. |
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
  default pins, auto-refresh on and off, how often to check, and whether a
  refresh is announced.
- **Shortcuts** — the full list.
- **About** — version, where the app and its preferences live.

Everything you choose is remembered between restarts, along with the folder you
were browsing, the file you were reading, the panel side and width, and the
view mode. Preferences are written to `preferences.json` beside this file, so
moving the folder takes your setup with it.

## What it renders

GitHub-flavoured markdown: tables, task lists, footnotes, fenced code with
syntax highlighting, and inline HTML. Relative image paths resolve against the
document's folder, and relative links to other markdown files open in the app.

## Notes on how it works

- The server binds to `127.0.0.1` only, on port 8737. Requests must carry a
  session cookie set from a secret stored in `.reader-token` (readable only by
  you), the `Host` header must be a loopback name, and cross-origin API calls
  are refused — so nothing on your network, and no website you happen to have
  open, can reach your files through it.
- Rendered HTML is sanitised before display, so a document containing a
  `<script>` tag cannot act on your files.
- Saving is atomic — write to a temporary file, then replace — so an
  interrupted save cannot truncate your document. If the file changed on disk
  since you opened it, you are asked before anything is overwritten.
- Deleting never unlinks anything, and only ever applies to single files —
  the server refuses to trash a folder at all, and refuses to rename or touch
  your home folder, the root of the disk, or any folder containing Markdown
  Viewer itself.
- Listed files: markdown (`.md` family), ~40 common code and config types
  (`.py .js .ts .json .yaml .sh .sql .go .rs .java` and friends), `.csv/.tsv`,
  `.txt` and `.pdf`. Hidden files and folders are skipped. PDFs are read-only
  and served straight to the browser's built-in viewer, never edited.
- Deciding whether a folder holds a document means looking inside it. That walk
  stops at six levels deep, at 4000 entries, or after 1.5 seconds for a whole
  listing — and when it is cut short the folder is shown rather than hidden, so
  a document can never become unreachable.
- Starting the launcher while the app is already running just opens the
  existing window instead of starting a second server.

## Third-party components

Bundled locally in `static/`, licences in `licenses/`:
[marked](https://marked.js.org) (markdown), [DOMPurify](https://github.com/cure53/DOMPurify)
(sanitising), [highlight.js](https://highlightjs.org) (code), and the
[Poppins](https://fonts.google.com/specimen/Poppins),
[Lora](https://fonts.google.com/specimen/Lora),
[Inter](https://fonts.google.com/specimen/Inter),
[Source Serif 4](https://fonts.google.com/specimen/Source+Serif+4) and
[JetBrains Mono](https://www.jetbrains.com/lp/mono/) typefaces
(SIL Open Font License).
