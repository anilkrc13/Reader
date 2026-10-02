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
  chatgpt/                   Node adapter package and its tests
reader.py, reader_backend.py compatible launch and import names
macos/                       native metadata and build/release scripts
scripts/                     development and repository tools
tests/server/                local server and tooling checks
tests/browser/               shared UI with the local server
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
package root owns its module type, pinned dependencies, compiler, and protocol
and simulated-host tests. Source files live directly in that package. Standard
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

Choose the source owner before adding files. Assess a cross-platform feature
against the shared base and adapter boundaries before implementation. Update
packaging, source references, and checks together. `common` must not become a
folder of unrelated helpers. Completed plans are removed after decisions are here
and outstanding acceptance checks are in [host acceptance](../embedded-acceptance.md).
Git retains the history. Create temporary plans only while work is active.
