# Reader on macOS

Everything specific to the native app: building it, signing it, folder
permissions, Finder integration, and the browser-app alternative.

## Building the app

You need the Xcode Command Line Tools (`xcode-select --install`) and, for the
adaptive Tahoe icon, a full Xcode 26 install so `actool` is available.

```
./macos/build-app.sh
open build/Reader.app
```

`build/Reader.app` is regenerated build output, not the app to keep using day
to day: don't launch it directly as a habit. Run `install/Reader.command`
instead (see below), which is the installed copy in `~/Applications` that the
in-app updater keeps current.

This build-and-run path is for running unreleased code straight from a git
checkout. An ordinary user does not need Xcode or a checkout at all: they
download the release disk image (see [the README](../README.md#get-it)) and
drag Reader into Applications.

The app is built for Apple silicon by default. For a universal build:

```
ARCHS="arm64 x86_64" ./macos/build-app.sh
```

The bundle includes the server, the static UI, the licences, and the icon. It
requires `python3` on the Mac that runs it. If port 8737 already has a Reader
server, the app reuses it and leaves it running when the app quits. If another
service owns that port, the app reports the conflict and does not stop or
replace it.

`install/Reader.command` is the one-step way to pick up newly merged source:
double-clicking it quits a running Reader (a normal quit, targeted at Reader's
bundle identifier, so its local server shuts down and no other app is
touched), rebuilds from whatever is checked out, installs the fresh build to
`~/Applications/Reader.app`, and reopens it. It always rebuilds, on the
assumption that if you are running it you want the current source, not
whatever happened to be built last. If Reader will not quit within about ten
seconds, the script stops without touching the installed app and tells you to
quit it yourself and try again; if the build fails, the previously installed
app is likewise left untouched. This installed copy in `~/Applications` is
the app you actually run; `build/Reader.app` is only the intermediate build
output `install/Reader.command` copies from. On success it also closes the
Terminal window it ran in, so repeated updates do not leave a pile of dead
windows behind; a failed run leaves its window open so you can read the error.

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

## Updates

Reader keeps itself current. Twenty seconds after launch, and then at most once
every 24 hours, the app asks GitHub for the latest release, reads the
`manifest.json` attached to it, and compares that version with its own. This is
the only network request Reader makes. Nothing is sent but the request itself:
`Accept: application/vnd.github+json` and a user agent of `Reader/<version>`.
There is no identifier, no telemetry and no report of what you were reading.

A check that fails, or a repository with no release yet, is treated as "no
update" and says nothing. **Check for Updates…** in the Reader menu runs the
same check immediately and does say something, including "You're up to date"
when there is nothing newer.

Settings → **About** runs that same check from a **Check for updates** button,
and reports the outcome on the line beside it rather than in an alert: whether
this is the newest release, which newer version exists, or why the check could
not finish. Only the reporting differs. The request the page sends carries
nothing but the word `checkForUpdates`, so it can never name a version or a URL
of its own, and an update worth installing goes through the same download,
digest, signature and designated-requirement checks described below, offered by
the same alert. In a browser there is no launcher to ask, so About says so
instead of showing the button.

Versions are compared as numbers: `2.1.0` is newer than `2.0.3`. A version with
a pre-release suffix such as `2.1.0-beta` is never offered.

### When Reader can install an update itself

Only when the running bundle sits directly in `/Applications` or
`~/Applications` and is writable. A copy running from a git checkout, a disk
image or a Downloads folder shows the same notice with a **View Release**
button that opens the release page in your browser, and says why it is not
installing. That rule exists so an update never quietly replaces a build you
made yourself and were in the middle of testing.

### What is checked before anything is installed

In order, and any failure stops the update with an explanation:

1. The downloaded zip's size and SHA-256 must match the manifest. The archive
   is not opened until they do.
2. It is unpacked with `ditto -x -k` and must contain exactly one application.
3. The new bundle must pass `SecStaticCodeCheckValidity` with all architectures,
   strict validation and nested code checked.
4. The new bundle must satisfy the **designated requirement of the app that is
   running**. For a certificate-signed build that requirement names the
   certificate, so only another build signed with the same identity can replace
   it. This is never skipped.

Step 4 is why releases are signed with one shared identity. If your copy of
Reader is ad-hoc signed, its designated requirement is a hash of its own bytes,
which no other build can ever match; Reader refuses the update and says that
updating in place needs the shared signing identity. Build once with
`./macos/ensure-signing-identity.sh` in place, or download a release, and the
problem goes away.

Only then does Reader ask, with **Install and Relaunch**, **Later** and **Skip
This Version**. Skipping is remembered by the app itself, not in `preferences.json`, and that
release is never offered again unless you ask from the menu.

The designated requirement checked in step 4 names both the signing
certificate and the bundle identifier, so changing the identifier is a
breaking change for anyone already running Reader: their installed copy's
requirement names the old identifier, and no build with the new one will ever
satisfy it. That is a one-time cost, paid once by reinstalling from the disk
image, not an ongoing one; every update after that reinstall works normally
again.

Installing stops Reader's own server the same way quitting does, moves the
current bundle to `Reader.app.previous` beside itself, moves the new one into
place, and reopens Reader. If the second move fails the previous bundle is put
back. `Reader.app.previous` is deleted the next time the new version launches,
so there is always one working copy on disk.

### Turning it off

Settings → **Files & watching** → **Check for updates**. The switch writes
`updates.check` to `preferences.json` in
`~/Library/Application Support/Reader`, which is where the launcher reads it.
Off means Reader never asks on its own: no daily check and no request Reader
started. Asking for one by hand, from the menu item or from the button in
About, still checks, because that is somebody pressing a control rather than
Reader deciding to.

### Testing the flow against a local server

`READER_UPDATE_FEED` replaces the GitHub lookup with a direct URL to a manifest:

```
READER_UPDATE_FEED=http://127.0.0.1:8901/manifest.json ~/Applications/Reader.app/Contents/MacOS/ReaderLauncher
```

`tests/manual/update-feed-server.py` serves such a manifest and the zip beside
it, computing the size and digest from the archive on disk, with flags for
serving deliberately wrong ones. Its docstring has the full recipe.

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

The app and the page share one named WebKit message channel, carrying two
requests: open the folder chooser, and run the update check. It answers the
main frame of Reader's own page and nothing else. Links in a document to the web (`http`, `https`, `mailto`,
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
