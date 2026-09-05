# Contributing

Reader is deliberately small: a standard-library Python server, a vanilla
JavaScript page, and a thin native launcher. Changes that keep it that way are
welcome.

## Running from source

```
python3 reader.py            # opens in your browser
python3 -m unittest discover -s tests -v
```

The browser test suite needs Node and Chrome:

```
npm install
npm run test:webmcp
```

## Before you open a pull request

- Read `context/document-integrity.md` if you touch document I/O, filesystem
  mutations, path authorisation, or the launcher-to-server handoff. Those
  invariants are what make Reader safe to point at a home folder.
- Run the unit tests. CI runs them on macOS, Linux and Windows; the server is
  meant to stay portable even though only the macOS app ships today.
- Keep the server dependency-free. No `pip install`.
- Keep the page free of inline script. The Content Security Policy forbids it.
- If you change `static/`, `reader.py`, `reader_backend.py`, `VERSION`, or
  anything under `macos/`, rebuild the app with `./macos/build-app.sh` and check
  it still launches. The built bundle is not committed; CI builds it.

## Portability

Only the macOS app ships today, but the server underneath it is meant to run
correctly on Windows and Linux too, and CI holds it to that: `python -m
unittest discover -s tests` runs on macOS, Ubuntu and Windows for every pull
request. A change to `reader.py` or `reader_backend.py` must keep the Windows
run green, not only the platform you developed on.

The seams where behavior forks by platform:

- **Opening a file in its default app** (`reader.open_with_default_app`):
  `open` on macOS, `os.startfile` on Windows, `xdg-open` elsewhere.
- **The per-user data directory** (`reader.default_data_dir`): `~/Library/
  Application Support/Reader` on macOS, `%APPDATA%\Reader` on Windows,
  `$XDG_DATA_HOME/reader` (or `~/.local/share/reader`) elsewhere.
- **Trash** (`reader_backend.DocumentStore.move_to_trash`): `~/.Trash` on
  macOS, the XDG Trash folder elsewhere, the real Recycle Bin on Windows via
  `SHFileOperationW`, and a Reader-owned Trash folder inside the platform data
  directory as the fallback when none of those are available. Every one of
  these is still a mutation destination and goes through
  `assert_mutation_allowed`, per `context/document-integrity.md`.
- **Token file permissions** (`reader._rewrite_token`): `0o600` protects the
  file on POSIX; NTFS ignores that mode, so Windows also runs `icacls` as a
  best-effort second step.
- **The keyboard modifier glyph**: labels are authored with `⌘` throughout
  `static/index.html` and `static/app.js`. `app.js` converts them to `Ctrl+`
  at boot on any non-Mac platform through one helper (`kbdLabel` /
  `applyKbdLabels`) rather than each call site guessing; it never touches key
  handling, which already accepts `metaKey || ctrlKey`.

When you add code that branches on platform, check with `sys.platform`
(`"darwin"`, `"win32"`, else) rather than `os.name`: tests mock the platform
by patching `sys.platform`, and patching `os.name` instead breaks `pathlib`'s
own choice of `WindowsPath` vs `PosixPath` on whichever machine the test runs.

## Style

Match what is around you. The Python is type-annotated and uses `pathlib`.
The JavaScript is one file, in sections, with no build step. Comments explain
why, not what.

## Releasing

Maintainers cutting a release should read `docs/releasing.md`.

## Agent instructions

`AGENTS.md` and `context/` are instructions for AI coding agents working in this
repository. They are not the contributor guide; this file is.
