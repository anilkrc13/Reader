# Reader project instructions

Instructions for AI coding agents working in this repository. Human
contributors should start with [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Delivery workflow

Use the build-loop workflow for software work in this repository. Match roles and
checks to the risk. Reuse helpers through repairs. Run affected checks while
editing and applicable final gates once after the source is frozen. A process
step must catch a named failure or produce needed evidence; otherwise combine
it with an existing step or remove it. Keep process lessons in Skill Repo's
central learnings inbox, with evidence, before promoting them into reusable rules.

## Keep the structure clear as work is added

Choose the owning source folder before adding code. Shared Reader code belongs
in one shared location. Platform wrappers and extension adapters own only their
platform behavior. Do not copy shared implementation into a second source tree.

Keep tests with the test area for the behavior they protect. Put generated output
and temporary investigation files outside source folders. When files move, update
imports, packaging, tests, and documentation in the same change. Check the layout
before implementation so cleanup does not become a second project.

Plans are temporary. Move lasting decisions and validation guidance into permanent
docs before deleting a completed plan. Keep an active plan only while it still
tracks unfinished work or acceptance checks.

## Focused linting

The owner approved ESLint, Ruff, and SwiftLint on October 2, 2026. Run them on
changed JavaScript/TypeScript, Python, and Swift files with rules for mistakes and
formatting. Do not lint the whole repository or add complexity limits by default.

## Required contracts

- [`context/document-integrity.md`](context/document-integrity.md) — read before changing document I/O,
  filesystem mutations, workspace authorization, or native file/folder handoff.

## macOS app build gate

[`./src/reader/macos/scripts/build-app.sh`](src/reader/macos/scripts/build-app.sh) produces `build/Reader.app`. That bundle is regenerated
build output, not committed, and not something to launch directly: it is not
the app the user runs day to day. [`install/Reader.command`](install/Reader.command) is the installer and the one-step update path;
double-clicking it quits a running Reader, always rebuilds via
`./src/reader/macos/scripts/build-app.sh`, copies the fresh `build/Reader.app` to
`~/Applications/Reader.app`, and opens that installed copy, which is the app
the user actually runs.

- After changing `src/reader/`, [`scripts/reader.py`](scripts/reader.py), [`VERSION`](VERSION), the
  macOS launcher or icon sources, licenses, or bundle metadata, run
  `./src/reader/macos/scripts/build-app.sh` before declaring the work complete.
- Do not treat manual edits inside `build/Reader.app` as a finished build. The
  script must recreate and sign the bundle.
- Verify the finished bundle with `codesign --verify --deep --strict build/Reader.app`
  and confirm changed source resources match their copies under
  `build/Reader.app/Contents/Resources/`.
- If the build or signature check cannot complete, state that the macOS app is
  not ready for testing.

## Versioning

[`VERSION`](VERSION) at the repo root is the only place the version number lives. The
server reads it at startup and the build script stamps it into [`Info.plist`](src/reader/macos/Info.plist).
Bump it and add a [`CHANGELOG.md`](CHANGELOG.md) entry in the same change as a release.

## Extension prototype and checks

- [`docs/architecture/README.md`](docs/architecture/README.md) describes the local and embedded document owners.
- [`src/reader/chatgpt/README.md`](src/reader/chatgpt/README.md) covers the read-only conversation viewer prototype, setup, and unverified host routing.
- [`docs/testing.md`](docs/testing.md) lists the checks. Temporary plans exist only while work is active. Permanent source ownership is in [`docs/architecture/source-layout.md`](docs/architecture/source-layout.md).

- Keep shared web, Mac, and ChatGPT adapter source under `src/reader/`. ChatGPT
  remains a complete Node package there. Native packaging selects Python/web
  runtime files; it must exclude adapter sources, Node dependencies, and extension
  output. Assess shared and adapter ownership before cross-platform changes.

- Put every test under the root `tests/` tree. ChatGPT tests and their runner
  configuration belong in `tests/chatgpt/`. Shared Playwright defaults remain
  in the root `playwright.config.js`. Review the actual source/test tree
  before delivery; passing behavior tests do not prove files have the right owner.
  Do not commit generated output or dependencies under `src`.

- Keep generated app, extension, browser, and release output under `build/`.
  Shared third-party notices live in `src/reader/common/licenses` and must ship
  in both bundles alongside the root project LICENSE. Keep a reason for each
  root item in the source ownership guide; do not remove unknown user state.
