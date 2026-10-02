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
  common/                    artwork used by Mac and ChatGPT builds
  macos/                     Swift launcher and native icon recipe/assets
  chatgpt/                   Node adapter source and package configuration
reader.py, reader_backend.py compatible launch and import names
macos/                       native metadata and build/release scripts
scripts/                     development and repository tools
tests/server/                local server and tooling checks
tests/browser/               shared UI with the local server
tests/chatgpt/               adapter protocol and simulated-host checks
build/Reader.app             ignored native output
build/chatgpt/               ignored extension output
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
and web-specific icons. `common` holds only the icon artwork consumed by both
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
All test code and runner configurations belong under `tests`. Protocol checks use
Node createRequire anchored to the adapter manifest to resolve its pinned SDK;
root Playwright dependencies serve the relocated browser suite.

Choose the source owner before adding files. Assess a cross-platform feature
against the shared base and adapter boundaries before implementation. Update
packaging, source references, and checks together. `common` must not become a
folder of unrelated helpers. Completed plans are removed after decisions are here
and outstanding acceptance checks are in [host acceptance](../embedded-acceptance.md).
Git retains the history. Create temporary plans only while work is active.

The final implementation was independently reviewed at `90b1970` on October 2,
2026, covering changes from `1d0cda5`. All 156 checks passed on the final source
layout: 94 server/tooling, 35 local browser, 18 embedded browser, and 9 protocol
checks. Focused ESLint, Ruff, and SwiftLint passed. The native build and signature
passed. Its 25 selected runtime resources match source, and no adapter source,
Node dependencies, caches, or extension output are shipped. The exact CI bundle
verification and two source-layout compatibility tests also passed independently.

Reader Local's existing repo catalog and its tracked example point at
`./build/chatgpt`. The local catalog migration changed only the Reader source
path. Installation policy and other fields were preserved. This does not install
or update a host plugin. Actual installed-app and host acceptance are still
tracked in the linked acceptance page. The completed source-layout plan is removed.
