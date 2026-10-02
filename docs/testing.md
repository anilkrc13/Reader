# Testing Reader

## Server tests

```
python3 -m unittest discover -s tests -v
```

Standard-library only, about ten seconds. [`tests/server/test_save_security.py`](../tests/server/test_save_security.py) pins
the compare-and-replace behaviour of saves; [`tests/server/test_workspace_authorization.py`](../tests/server/test_workspace_authorization.py)
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

The browser suite also checks document search after Files focus and in Edit mode,
file search as a separate command, native-command routing to the active comparison
pane, outline navigation through folds and two-page reading, and save status during
queued saves, stale responses, failures, conflicts, and read-only opens. Reading-control
screenshots are written under `build/browser-test-results/`.

## The native app

The bundle has no automated tests. After [`./src/reader/macos/scripts/build-app.sh`](../src/reader/macos/scripts/build-app.sh):

1. `codesign --verify --deep --strict build/Reader.app`
2. Confirm changed resources match their copies under `Contents/Resources/`.
3. Launch it with no server running, then again with one already running, and
   once by double-clicking a `.md` file in Finder.

## Embedded Markdown prototype

Install the pinned extension dependencies with `npm ci --prefix src/reader/chatgpt --ignore-scripts`.
Run `npm --prefix src/reader/chatgpt run build` and `npm run test:chatgpt` for session and real stdio-server checks in `tests/chatgpt`.
Run `npm run test:embedded` for the bundled UI and App SDK in a simulated iframe host. These tests are separate from the existing local-server browser suite.

The simulated host covers read-only startup, subscriptions, updates, storage denial, independent panels, missing capabilities, relative-content handling, sanitization, host theme changes, saved reading preferences, all light/dark paper choices, independent reset, shared Reading/Code rendering, unsupported settings explanations, icon controls, narrow heading layout, initial keyboard focus, reading keys after Find and Settings, live-refresh focus, nested scrolling, and two-page keyboard navigation. The bundled UI also checks host-mediated local opening, missing capability, host errors, cross-document anchor limits, and stale link responses. The real stdio suite verifies trusted metadata requirements, traversal and symlink containment, regular Markdown targets, and branding asset equality. The session suite covers delayed reads, refresh ordering, switches, and disposal. Pane tests use a large parent window with narrow/tall, wide/short, narrow/short, and roomy iframes. They check every category, scrolling to fine-tune controls, keyboard focus containment, live resize, large interface size, repeated open/close, saved choices, and the same reading passage after typography changes. Screenshots include initial Appearance, scrolled Reading, and resized modal/compact states. Screenshots are written to `build/embedded-test-results/`.

Actual desktop file-link routing and live refresh need the manual check in [`src/reader/chatgpt/README.md`](../src/reader/chatgpt/README.md). A mock-host pass does not establish that acceptance condition. Test native changes using the installed copy updated by `install/Reader.command`; do not launch the generated build bundle directly.

## Faster iteration without less coverage

While editing, run one regression that exercises the behavior being changed. For
example, `npm run test:embedded -- --grep 'settings resize'` builds the extension
and runs that case. If a browser control behaves unexpectedly, first reproduce it
in a plain browser page before changing Reader. Batch independent source reads
and inspections. Let long checks finish instead of repeatedly reading partial logs.

Once code is frozen, run the applicable final gates once. Keep each command's
complete log and exit status. Reuse passing evidence when later changes only
record documentation or review results. A changed source or unresolved failure
requires fresh evidence for the affected check. Build the extension before tests
that read its generated bundle. Do not run separate builds against the same output
at once. The `test:embedded` command already builds before starting Playwright.

The embedded browser suite uses two workers with fully parallel tests. Each
test has a 60-second total budget because long Linux CI interactions and
screenshots exhausted the local suite’s 30-second budget. Assertions still
have an 8-second limit, with no retries. The local suite keeps 30 seconds. Each test
has its own Playwright page and browser context. Simulated host state, routes,
local storage, and frame state stay inside that context. Workers only read the
finished bundle. Screenshots use `testInfo.outputPath`, so test outputs are separate.
The local/native browser suite remains at one worker because tests share a server
and temporary filesystem workspace.

Independent checks may overlap when their fixtures and outputs do not conflict.
For example, after one extension build finishes, the embedded browser and protocol
checks can run alongside the native browser and Python checks. Report wall time
separately from summed command durations: overlapping commands do not add that
sum to the user's wait. Keep build prerequisites in order.

Changes to `src/reader/`, `scripts/reader.py`,
`VERSION`, launcher or icon sources, licenses, or bundle
metadata require `./src/reader/macos/scripts/build-app.sh`, signature verification, and resource-copy
checks. An extension-only runner or documentation change does not trigger that
build requirement. Running native integration checks alone does not trigger it.
All mandated gates still apply when their listed sources change. Native testing
uses the installed app updated by `install/Reader.command`; never launch the
generated bundle directly.

### Measured runner change

On October 2, 2026, the same 18 embedded tests took 202.068 seconds with one worker
and 108.960 seconds with two workers, a 46% reduction. The two-worker command,
`npm run test:embedded -- --reporter=line,json`, took 110.349 seconds including
its build. It exited zero with 18 passed, zero skipped, zero unexpected failures,
and zero flaky results. Tests, timeouts, retries, and the native runner were unchanged.
The earlier run overlapped other gates; the two-worker benchmark ran alone.
This is one observed comparison, not a controlled repeated benchmark.

The earlier turn's diagnostic recorded 21.3 minutes of wall latency and 7.68 minutes
of summed command time. Those command durations included overlap. Eight focused
runs and repeated inspections also contributed to the turn. Review took 51.6 seconds.
Use these measures separately when judging the user's total wait.

Benchmark log: `/tmp/reader-runner-two-workers.log`. Exact Playwright counts and
runtime: `/tmp/reader-runner-two-workers-report.json`. Full-command wall time and
exit status: `/tmp/reader-runner-two-workers-receipt.json`.

## Focused linting

The owner approved changed-file linting. Install pinned Node tools with `npm ci`.
For Python, run `python3 -m venv build/lint-venv`, then
`build/lint-venv/bin/python -m pip install -r requirements-dev.txt`.
On macOS install SwiftLint with `brew install swiftlint`; validation used 0.65.1.
Run `npm run lint:changed` before committing. After committing, use
`npm run lint:changed -- --base <previous-commit>` to check that same change.
The three linter configurations live in `config/`. The runner supplies their
paths explicitly. For direct invocation, pass `--config config/eslint.config.mjs`
to ESLint, `--config config/ruff.toml` to Ruff, or
`--config config/.swiftlint.yml` to SwiftLint.
The runner uses Git's changed and untracked source paths. It skips generated
outputs and minified vendors. ESLint checks JavaScript and TypeScript mistakes;
TypeScript compilation still checks names and types. Ruff checks Python mistakes
and import order. SwiftLint checks duplicate imports, forced try, and trailing
whitespace with its cache disabled. No size or complexity rules apply.

The installed-font browser regression checks native bridge names, legacy choices,
CSS escaping, persisted choices, missing families, restored families, errors, and
comparison panes. Its bridge is simulated; real AppKit enumeration and native
compilation are checked separately. Actual installed-app font selection remains
a manual acceptance check through `install/Reader.command`.

Server/tooling tests live in `tests/server/`; discovery from `tests` recurses into
that package. Canonical-server and isolated-resource-tree tests protect data paths and
direct launch after source moves. The native bundle must contain identical Python package markers, server/backend
modules, the web tree, and the `scripts/reader.py` launcher. Compare those selected resources
after the mandated build. Verify that Mac/ChatGPT adapter source, Node dependencies,
and extension output are absent. The extension output lives in `build/chatgpt`.

All ChatGPT test code lives in `tests/chatgpt`. Its Playwright configuration
selects `tests/chatgpt/browser` and retains two isolated workers. Protocol tests
resolve the adapter's pinned SDK through Node createRequire anchored to its
manifest. CI builds that package and runs both suites. The source-layout guard
rejects committed tests or generated output under `src`; ignored package-local
Node dependencies remain build tooling.

Local browser output is under `build/browser-test-results`; adapter browser output
is under `build/embedded-test-results`. Shared notices come from
`src/reader/common/licenses` and must match both distributions. Both bundles also
include the root project LICENSE. CI reuses its extension build for browser tests.

The project build entry is `npm run build -- <web|macos|chatgpt>`; plain
`npm run build` builds all variants on a Mac. Web and native resource packaging
share `scripts/package_runtime.py`. Python fixture cleanup is registered before
setup can fail. The failure regression proves real scratch directories are gone.
The protocol fixture registers cleanup immediately after mkdtemp. Local browser
teardown removes owned scratch in finally, and screenshots use test output paths.

For CLI/import probes inside a signed bundle, use an owned temporary
`READER_DATA_DIR` outside the bundle and set `PYTHONDONTWRITEBYTECODE=1`. The
native launcher already sets both. A bare Python probe can create state or
bytecode inside the sealed resources and invalidate the signature. Regenerate
the app after such a probe; do not repair signed resources by hand.
