# Testing Reader

## Server tests

```
python3 -m unittest discover -s tests -v
```

Standard-library only, about ten seconds. [`tests/test_save_security.py`](../tests/test_save_security.py) pins
the compare-and-replace behaviour of saves; [`tests/test_workspace_authorization.py`](../tests/test_workspace_authorization.py)
exercises every mutation route and symlink escape. CI runs this suite on
macOS, Linux and Windows so the server stays portable.

## Browser suite

```
npm install
npm run test:webmcp
```

Playwright starts Reader against an isolated temporary workspace, captures the
WebMCP tools the live page registers through `document.modelContext`, validates
their schemas, and invokes them directly without a model in the loop. A WebMCP
tool belongs to the open page and disappears when that page is closed, which is
what makes the suite deterministic. The regression cases the suite is built
from are listed in [`testing-regression-cases.md`](testing-regression-cases.md).

## The native app

The bundle has no automated tests. After [`./macos/build-app.sh`](../macos/build-app.sh):

1. `codesign --verify --deep --strict build/Reader.app`
2. Confirm changed resources match their copies under `Contents/Resources/`.
3. Launch it with no server running, then again with one already running, and
   once by double-clicking a `.md` file in Finder.

## Embedded Markdown prototype

Install the pinned extension dependencies with `npm ci --prefix extensions/chatgpt --ignore-scripts`.
Run `npm --prefix extensions/chatgpt run build` and `npm --prefix extensions/chatgpt test` for session and real stdio-server checks.
Run `npm run test:embedded` for the bundled UI and App SDK in a simulated iframe host. These tests are separate from the existing local-server browser suite.

The simulated host covers read-only startup, subscriptions, updates, storage denial, independent panels, missing capabilities, relative-content handling, sanitization, host theme changes, saved reading preferences, icon controls, and narrow heading layout. The session suite covers delayed reads, refresh ordering, switches, and disposal. Screenshots are written to `build/embedded-test-results/`.

Actual desktop file-link routing and live refresh need the manual check in [`extensions/chatgpt/README.md`](../extensions/chatgpt/README.md). A mock-host pass does not establish that acceptance condition. Test native changes using the installed copy updated by `install/Reader.command`; do not launch the generated build bundle directly.
