# Source layout verification

Check root `reader` and `reader_backend` imports still expose the implementation.
Check APP_DIR, preferences, static containment, CLI startup, and generated bundle
paths after moving code. Existing server/browser/extension tests protect behavior;
update only source-path assumptions, not acceptance assertions. Native bridge and
font behavior remain covered by their existing regression.

Run focused lint on changed source, then the final server, native browser, embedded
browser, and protocol suites once. Build the extension before its protocol tests.
Regenerate the Mac app, verify signature and resource equality, and confirm both
entry wrappers and canonical source are packaged. Inspect one shared reading UI
and embedded compact Settings screenshot; this is a source move, not a redesign.
Review the exact final diff with rename detection. Preserve necessary acceptance
checks in permanent docs and verify plan links before deleting completed plans.

For the final one-tree layout, check flattened ChatGPT entrypoints and tests, the
root VERSION/licenses paths, and output under build/chatgpt. Verify the common
icon artwork matches extension output and that the staged native recipe compiles.
Compare selected native Python/web resources only. Reject adapter source or Node
dependencies in the bundle. Validate the existing Reader Local catalog and tracked example resolve to the new
package. Change only that catalog entry source path; preserve policy and state.

Implementation evidence: server 94 passed; native browser 35 passed; protocol 9
passed against build/chatgpt. Focused ESLint, Ruff, and SwiftLint passed. Native
build/signature succeeded. All 25 selected resources match source and no adapter
source/dependencies/output/caches are packaged. Root direct CLI works. Application
TypeScript and Swift files are byte-identical moves. Rendered native Reading and
compact embedded Appearance settings were inspected. Embedded browser checks also passed: 18 tests. All 156 regression checks passed
on the one-source-tree layout. Independent implementation review remains pending. Logs: /tmp/reader-one-src-*.log.
