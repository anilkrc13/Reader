# Reader on macOS

Everything specific to the native app: building it, signing it, folder
permissions, Finder integration, and the browser-app alternative.

## Building the app

You need the Xcode Command Line Tools (`xcode-select --install`) and, for the
adaptive Tahoe icon, a full Xcode 26 install so `actool` is available.

```
./macos/build-app.sh
open install/Reader.app
```

The app is built for Apple silicon by default. For a universal build:

```
ARCHS="arm64 x86_64" ./macos/build-app.sh
```

The bundle includes the server, the static UI, the licences, and the icon. It
requires `python3` on the Mac that runs it. If port 8737 already has a Reader
server, the app reuses it and leaves it running when the app quits. If another
service owns that port, the app reports the conflict and does not stop or
replace it.

`install/Reader.command` opens the sibling bundle, building it first if it is
missing. Starting the launcher while the app is already running just opens the
existing window instead of starting a second server.

The built bundle is not committed. Releases are built by CI from a tag.

## Why macOS keeps asking for folder permissions

An ad-hoc signature is derived from the bundle's own bytes, so its designated
requirement is a bare content hash:

```
designated => cdhash H"26e68e53a7b3ce765be0c532a456a83f1f441ef2"
```

macOS keys folder-access consent to that requirement, and the hash changes on
every build, even a rebuild from unchanged sources. Every build is therefore a
new app as far as the privacy database is concerned, and every permission you
had granted is thrown away.

The fix is to sign with a certificate, which pins the requirement to the
certificate instead of to the bundle. Reader can make its own, once per user:

```
./macos/ensure-signing-identity.sh
```

That creates a self-signed code-signing certificate in a keychain of Reader's
own, beside Reader's preferences. No Apple developer account is involved and
your login keychain is left alone. macOS asks for your login password once, to
trust the certificate for code signing, because `codesign` refuses an untrusted
identity outright. Afterwards `build-app.sh` finds and reuses it automatically,
so folder permissions you grant now outlive every later build.

`build-app.sh` creates the identity on first use when you run it from a
terminal. Run non-interactively it will not raise a password dialog on its own;
it signs ad-hoc and says so. `READER_SIGNING=create` forces creation from a
script.

If you have an Apple certificate, it takes precedence:

```
CODE_SIGN_IDENTITY="Apple Development: you@example.com (TEAMID)" ./macos/build-app.sh
```

Either way the app stays unnotarised. Because of that, an app downloaded with a
browser carries a quarantine flag and macOS shows a first-launch warning. On
macOS 14 and earlier, Control-click the app, choose **Open**, and confirm. On
macOS 15 and later, open System Settings → Privacy & Security, scroll down, and
choose **Open Anyway**. An app you built yourself is not quarantined and opens
normally.

To undo Reader's identity completely:

```
security delete-keychain ~/Library/Application\ Support/Reader/signing/reader-signing.keychain-db
security remove-trusted-cert ~/Library/Application\ Support/Reader/signing/certificate.pem
rm -rf ~/Library/Application\ Support/Reader/signing
```

## Opening files from Finder

Reader declares the document types it renders, so it can be the app a document
opens with. Select a file in Finder, press **⌘I**, and set *Open with*, or
Control-click → *Open With*. Double-clicking then hands the file to Reader: if
Reader is not running it starts and opens straight into that document, and if
it is already running the open window switches to it, moving the file tree to
the document's folder when the document sits outside the folder you were
browsing.

An outside document handed to a newly started server is editable because its
folder becomes an initial server grant. The same handoff to an already-running
server opens read-only unless that folder was already granted; Reader never
lets the page grant itself a new write root.

All six markdown extensions Reader treats as markdown (`.md .markdown .mdown
.mkd .mdx .mdc`) are covered, along with every other type Reader reads that
macOS has a declared type for: `.txt`, `.csv/.tsv`, `.pdf`, `.py`, `.json`,
`.yaml`, `.html`, `.sh`, `.swift`, `.java`, `.c/.cpp`, `.sql` and the rest of
the source family. Reader offers itself as an alternate handler for those, so
it never displaces Preview or Numbers unless you choose it.

A few extensions macOS has no declared type for at all (`.go .rs .kt .cs .lua
.jsx .cjs .scss .less .conf .env`) cannot appear in *Open With* without Reader
claiming those file kinds system-wide, which it deliberately does not do. Open
those from inside Reader's own file tree.

## Turning it into a browser app

The address never changes, so you can install it:

- **Chrome / Edge / Brave**: open http://127.0.0.1:8737, then ⋮ menu → *Cast,
  save and share* → **Install page as app**.
- **Safari**: File → **Add to Dock**.

Start the launcher first so the server is running, then click the installed
app any time. The browser stays authorised, so the app opens straight into your
last document. A browser-owned launcher cannot use Reader.app's adaptive Dock
icon or the native folder chooser; use the app for those.

## How the app and the page talk

The app and the page share one named WebKit message channel, used so far only
to open the folder chooser. It answers the main frame of Reader's own page and
nothing else. Links in a document to the web (`http`, `https`, `mailto`,
`tel`) are handed to your default browser; Reader's own window never navigates
away from its local server, so a link cannot replace the app with a web page.

The launcher-to-server contract is small and is what a launcher for another
platform would need to reproduce:

1. Probe `GET http://127.0.0.1:8737/api/ping` and expect `{"app": "Reader"}`.
2. If nothing answers, start `python3 reader.py --port 8737 --no-browser
   [PATH]` with `READER_DATA_DIR` pointing at the platform's per-user data
   folder, and stop that process on quit.
3. Read the session token from `.reader-token` in that data folder and load
   `http://127.0.0.1:8737/?t=TOKEN`.
4. To open a document the OS handed over after the page has loaded, call
   `window.reader.openFromOS(path)` in the page.
