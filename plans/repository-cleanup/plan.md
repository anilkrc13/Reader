# Proposed: complete Reader root audit

The owner asks for one coherent cleanup after identifying misplaced tests.
Keep application source under src/reader and tests under tests. Move the five
shared third-party notices to src/reader/common/licenses. Both shipped bundles
must retain those same notices and the root project LICENSE. Move Info.plist into
the Mac source adapter; root macos holds only existing build/sign/release commands.
Those commands remain stable for the installer and contributor scripts.

Keep root Python entry/import wrappers, VERSION, project/legal docs, standard
repo-wide lint/test configs, and Node development manifests. Python uses only the
standard library and runs directly; there is no package-install requirement to
justify adding a pyproject file. The root Node package owns development tooling
and explicit build:macos/build:chatgpt/start:web commands. The adapter package owns
its own pinned runtime dependencies and module type. Do not combine these owners.

Move known Playwright browser output from test-results into build/browser-test-results.
Use build/releases for zip, DMG, and release manifest output, preserving public
asset names and updater fields. Put native build/DMG temporary directories under
build. Preserve the conventional ignored dependency/cache directories, preferences,
token, .agents catalog, .claude settings, CLI diagnostics, and unknown tmp-markdown
files. No root static, fonts, or builds directory exists in this checkout.
Do not delete an unknown file to make the root look empty.

Inspect every root item, tracked/untracked/ignored ownership, remaining source/test
boundaries, actual bundle output, and legal copies. Write the root ownership table
into permanent source-layout docs. Keep root LICENSE. Do not introduce another
output directory or a second source/test implementation. No installed app update,
plugin installation, publication, push, PR, or Skill Repo changes.

The owner additionally authorized one project-level build command, removal of
known obsolete temporary files, and cleanup of test-owned scratch. Use one
Python build dispatcher behind npm run build with web/macos/chatgpt/all targets.
Use one shared runtime packager for web/native, rather than copying build logic.
Register fixture cleanup before setup failure and keep test images in owned
output. Remove only old generated diagnostics with task provenance, not unknown
Markdown or local state.
