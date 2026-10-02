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
