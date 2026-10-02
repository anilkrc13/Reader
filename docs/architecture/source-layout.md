# Reader source ownership

Reader shares one document interface between the local server, Mac app, and
conversation extension. Each part has one source owner inside `src/reader`.
Platform adapters add operating-system or host actions to the shared interface.

```
src/reader/
  server.py, backend.py       local server and document operations
  web/                       shared HTML, CSS, JavaScript
    assets/                  web icons and fonts
    vendor/                  browser libraries
  common/                    shared artwork and third-party notices
  macos/                     Swift launcher, metadata, and native icon assets
    scripts/                 native build, signing, and release commands
  chatgpt/                   Node adapter source and package configuration
reader.py, reader_backend.py compatible launch and import names
scripts/                     development and repository tools
tests/server/                local server and tooling checks
tests/browser/               shared UI with the local server
tests/chatgpt/               adapter protocol and simulated-host checks
build/Reader.app             ignored native output
build/chatgpt/               ignored extension output
build/web/                   ignored portable browser/server runtime
build/browser-test-results/  ignored local browser output
build/embedded-test-results/ ignored adapter browser output
build/releases/              ignored release archives and manifest
docs/                        permanent contracts and acceptance guidance
```

Before the extension was added at `af48f8e`, the local server lived in two root
Python files. `static/` mixed application code, libraries, fonts, and icons.
The extension added a separate package with its own TypeScript and tests. It
bundles the shared UI; it does not maintain a second Reader implementation.
The new layout puts application source in one place and separates its owners.

The ChatGPT adapter remains a complete Node package inside the source tree. Its
package root owns its module type, pinned dependencies, and compiler. Source
files live directly in that package. Its tests live separately in `tests/chatgpt`. Standard
Node resolution still finds its own dependencies. Nesting a package does not
require combining its dependencies with the local Python or Mac app.

The web base owns rendering, reading styles, settings, browser libraries, fonts,
and web-specific icons. `common` holds icon artwork and third-party notices consumed by both
platform builds. Native dock images and the Icon Composer recipe remain Mac
assets. The build stages common artwork with that recipe in a temporary directory;
it uses the existing compiler and leaves source artwork untouched.

Root Python wrappers preserve existing commands and import names. Importing
`reader` or `reader_backend` returns the canonical module, so functions and patch
targets keep their identity. Both `./reader.py` and `python3 reader.py` work.
APP_DIR remains the repository or bundle-resource root. Preferences and workspace
authorization keep that root. `/static/` still serves only the web directory.

The native build selects the Python package markers, server/backend modules, and
web tree. It compiles the Swift adapter and icon recipe, then adds bundle metadata.
It does not ship adapter sources, Node dependencies, or extension output. The
extension build combines the same web base with its TypeScript adapter and emits
`build/chatgpt`. That portable package keeps manifests, licenses, and branding.
A web-only launch uses the root Python command and needs no adapter build.

Root browser tests use one worker because filesystem fixtures are shared.
Embedded tests use two workers because page, storage, routes, and output are
isolated. Server discovery includes `tests/server`. Each platform's build and
checks use only its required source and keep generated output under `build`.
All test code belongs under `tests`. Adapter runner configuration lives beside
its tests. Shared Playwright defaults remain in root `playwright.config.js`. Protocol checks use
Node createRequire anchored to the adapter manifest to resolve its pinned SDK;
root Playwright dependencies serve the relocated browser suite.

Choose the source owner before adding files. Assess a cross-platform feature
against the shared base and adapter boundaries before implementation. Update
packaging, source references, and checks together. `common` must not become a
folder of unrelated helpers. Completed plans are removed after decisions are here
and outstanding acceptance checks are in [host acceptance](../embedded-acceptance.md).
Git retains the history. Create temporary plans only while work is active.

## Root ownership

The root is the project entry and tool configuration area. Application code belongs
in `src/reader`; tests belong in `tests`. Python uses only the standard library.
It runs through the existing script and needs no separate install package. The
root Node manifest supplies development tools and named platform build commands.
The adapter manifest owns its own runtime dependencies and module type.

| Root item | Owner and reason |
| --- | --- |
| `src/` | Shared application and platform adapter source, assets, metadata, notices. |
| `tests/` | All tests, adapter runner configuration, and manual test helpers. |
| `scripts/` | Project build command, shared runtime packager, and focused lint runner. |
| `install/` | The user-facing source installer and update command. |
| `docs/`, `context/` | Architecture, contributor checks, and document integrity contracts. |
| `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md` | Project instructions, entry documentation, security policy, and release history. |
| `LICENSE` | The project's required license. Both distributions copy it. |
| `VERSION` | The only product version value. Builds and server read it. |
| `reader.py`, `reader_backend.py` | Compatible Python launch and import names. The implementation lives under source. |
| `package.json`, `package-lock.json` | Pinned repo-wide development tools and build/test commands; not a second application package. |
| `requirements-dev.txt` | The pinned Python linter. Reader has no Python runtime dependency manifest. |
| `eslint.config.mjs`, `ruff.toml`, `.swiftlint.yml` | Repo-wide focused linter rules. Standard root configuration makes direct tool invocation predictable. |
| `playwright.config.js` | Shared test defaults and the local browser suite's output path. Adapter configuration lives beside its tests. |
| `.github/`, `.gitignore`, `.git/` | CI and issue templates, generated/state exclusions, and Git data. |
| `build/` | Mac app, extension package, release files, build staging, browser output, and ignored inspection/validation tools. |
| `node_modules/` | Ignored repo-wide development dependencies. The adapter's ignored dependencies stay at its package boundary. |
| `__pycache__/`, `.ruff_cache/`, `.pytest_cache/` | Ignored Python/tool caches. These are local tooling, not application source or release output. |
| `.reader-token`, `preferences.json` | Existing local authorization and preferences. Preserved without reading their contents. |
| `.agents/` | Existing local plugin catalog. Reader's source path is `./build/chatgpt`; policy and other fields were preserved. |
| `.claude/`, `.playwright-cli/`, `.DS_Store` | Existing local assistant settings, CLI diagnostics, and Finder metadata. Preserved. |
| `plans/` | Temporary only during active work; removed when decisions and checks have permanent homes. |

`macos`, `static`, root `fonts`, and `builds` are absent from the audited checkout. Shared
notices moved byte-for-byte from root `licenses` into `src/reader/common/licenses`.
Native metadata moved byte-for-byte into `src/reader/macos`. Both builds copy the
notices; the extension also writes notices for its bundled Node dependencies.
The known generated browser screenshots were moved under `build` before rerunning
the suite. Only the Markdown folder named by the owner was moved to Trash.
Other unknown files were preserved.

Use `npm run build` to build all variants on a Mac. Select one with
`npm run build -- web`, `npm run build -- macos`, or `npm run build -- chatgpt`.
The web target emits a portable server/runtime tree under `build/web`. Its Python
code needs no compilation. Mac and web builds use one runtime packager, so their
source and notice selection cannot drift. Non-Mac hosts select web or chatgpt.
Use `npm run start:web` or `python3 reader.py` to run the checkout. Native builds regenerate `build/Reader.app`. Extension
builds clear only their owned `build/chatgpt` output before regenerating it.
Release scripts write archives and the manifest to `build/releases`. The public
asset filenames and updater URL fields remain unchanged.

Eight obsolete settings/link diagnostic folders were removed from `build` after
identifying them as output of earlier checks in this task. Current suites keep
their screenshots inside their own output directories. Document scratch uses
owned temporary directories with registered teardown, including setup failures.
The owner requested moving only `tmp-markdown-8S7rWN` to Trash. Other local
files and assistant state remain preserved.

The complete repository cleanup was independently reviewed at `d9f8838` on
October 2, 2026, covering changes from `916c739`. The reviewer inspected the
actual tracked, untracked, ignored, source, test, and output trees against this
map. All 159 checks passed: 97 Python, 35 local browser, 18 embedded browser,
and nine protocol checks. Focused lint passed. The reviewer reran all four layout
checks and verified matching legal notices in all three outputs.

The single project build produced web, Mac, and ChatGPT packages. Resource and
signature checks passed. The final release ZIP matches the current signed app;
its manifest hash and size agree. The DMG passed its mounted app/link checks and
checksum verification. Runtime source and the moved notices/metadata retain their
original bytes. Test-owned document scratch was gone after each suite. Tool
caches were distinguished from fixtures and their audit roots were removed.

The Reader Local catalog still points at `./build/chatgpt` with unchanged policy.
No installation, publication, or push occurred. [Host acceptance](../embedded-acceptance.md)
retains the installed-app and real host checks. Completed cleanup plans are removed;
Git retains the history.

The seven native build, signing, and release scripts now live in
`src/reader/macos/scripts`. Their repository-root calculations, installer, CI,
project build caller, and documentation use that path. The root `macos` folder
is gone. The named Markdown folder was moved to macOS Trash, not deleted.
All 97 Python checks, Bash syntax, focused lint, and all three builds passed.
Native resources and required notices match source. The signed app, ZIP manifest,
and mounted DMG checks passed. No installer or signing export/import was run.
