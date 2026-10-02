# Organize Reader by source owner

Before the extension, root `reader.py` and `reader_backend.py` held the local server
and `static/` held application code, fonts, icons, and vendored libraries together.
The extension added a standalone Node package that bundles the shared UI. It does
not have a second implementation of that UI. Native and Python checks live under
root tests; protocol and simulated-host tests belong to the extension package.
The main confusion is mixed shared source/assets and accumulated plans, not a
need to combine independent package dependencies.

Use this structure:

```
src/reader/server.py           local HTTP and server lifecycle
src/reader/backend.py          document access and mutations
src/reader/web/                shared HTML, CSS, JavaScript
src/reader/web/assets/         fonts and icons
src/reader/web/vendor/         vendored browser libraries
reader.py, reader_backend.py   small compatible entry/import wrappers
macos/                        native wrapper, metadata, assets, build tools
extensions/chatgpt/           standalone adapter package and its tests
scripts/                      repository checks and development tools
tests/server/                 local server and tooling regressions
tests/browser/                shared UI against the local server
docs/                         permanent architecture, checks, acceptance
```

Keep the extension's `src/` inside its package. Its module type, pinned SDKs,
standalone build, and install output remain intact. Moving that source outside its
package would change dependency resolution for no product benefit. The shared
Reader implementation remains in exactly one location.

Root launch/import names remain compatible. Source and app bundle use the same
`src/reader` layout. APP_DIR still identifies the repository or bundle resource
root, so workspace authorization and preference locations are unchanged. Assets
remain served through `/static/`; internal vendor and asset paths gain their
explicit subdirectories. The extension builds from the new shared source owner.
Update build scripts, imports, tests, documentation, and required build gate paths
in the same change. Keep root CLI and installer commands unchanged.

Move lasting completed-plan decisions into architecture/testing docs and one host
acceptance page. Remove closed reading-control, font, and viewer implementation
plans after their decisions and remaining checks are preserved. An acceptance
check can live permanently in docs instead of keeping a finished implementation
plan open. Keep this plan only until its own source moves pass review and checks.

The owner requested repository organization and removal of unnecessary plans.
The owner also approved focused linting and using the build loop efficiently.
Do not install, push, publish, alter host cache, or touch unrelated untracked files.
