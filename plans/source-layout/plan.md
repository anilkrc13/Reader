# Proposed: one Reader source tree

Reader shares one web interface. Local document operations and platform adapters
have separate owners inside `src/reader`. The owner clarified that Mac and ChatGPT
source should live beside the shared code. Settle all paths together.

```
src/reader/
  server.py, backend.py         local document server and operations
  web/                         shared interface, web assets, browser libraries
  common/                      icon artwork used by Mac and ChatGPT builds
  macos/                       Swift launcher and Mac icon recipe/assets
  chatgpt/                     standalone Node adapter package and tests
macos/                         native metadata and build/release scripts
reader.py, reader_backend.py    compatible root entry/import wrappers
tests/server/, tests/browser/  local server and shared UI checks
build/Reader.app               generated native app
build/chatgpt/                 generated extension package
```

Move the complete ChatGPT package, flattening its old `src/` into its package root.
Its pinned dependencies, module type, TypeScript compiler, and tests retain one
package boundary. Keeping a Node package under `src` is supported; nesting by
itself is not a dependency-resolution problem. Generated dependencies are ignored.
Move Swift and native assets into the Mac adapter. Keep build commands and bundle
metadata in `macos/`. Shared icon artwork is copied into the existing Icon Composer
recipe during the build; do not introduce an image conversion pipeline.

Select only Python package markers, server/backend modules, and web assets for the
Mac resource tree. It must contain no Swift source, TypeScript, Node dependencies,
or extension output. The extension builds from shared web plus its adapter and
uses common artwork. Root launch commands and authorization/preferences roots
remain unchanged. Update all build references, tests, CI, docs, and example
marketplace paths together. Leave the owner's untracked marketplace catalog alone;
record that an existing installation must select the new output path explicitly.

The earlier shared-source move is retained. Revise its remaining paths in one
change. Run affected server, browser, extension, lint, and native packaging checks.
Review the frozen candidate before removing this plan. Git permits rollback;
preferences and grants need no migration. No push, installation, or publication.
