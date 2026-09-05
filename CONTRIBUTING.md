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

## Style

Match what is around you. The Python is type-annotated and uses `pathlib`.
The JavaScript is one file, in sections, with no build step. Comments explain
why, not what.

## Releasing

Maintainers cutting a release should read `docs/releasing.md`.

## Agent instructions

`AGENTS.md` and `context/` are instructions for AI coding agents working in this
repository. They are not the contributor guide; this file is.
