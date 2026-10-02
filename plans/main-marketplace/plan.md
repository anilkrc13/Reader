# Default-branch marketplace

The owner requires a plain Reader GitHub URL to discover and install Reader.
Everything needed belongs on main. No distribution branch may be required.

The public catalog is .agents/plugins/marketplace.json. Its local source path
is ./plugins/reader-markdown. That folder contains the thirteen generated,
portable plugin files. Editable source remains under src/reader. No dependencies
or private assistant state are published. plugins/release.json records the
version, repository URL, and hashes. It has no self-referential commit hash.

The packager syncs these owned files from build/chatgpt during development.
CI rebuilds and checks exact equality. Source and package changes land together
through the normal protected PR. Tagged release automation checks the committed
package and creates archives. Dispatch only validates and archives; neither
mode pushes commits. This prevents protection bypass and recursive workflow runs.

The current 2.6.0 package bytes stay unchanged. After merge, verify a fresh
plain-URL registration and install with the supported CLI. Migrate the existing
registration only after that succeeds. Preserve unrelated settings and plugins.
The old remote branch stays untouched and unused.

Checks: allowlist/private-file and symlink failures; version/catalog/hash drift;
rebuild equality; actionlint; required CI; plain URL discovery and clean install;
installed MCP/viewer connection. Keep AGENTS.md ignored and untracked.
