# Repository cleanup checks

Prove notice and metadata moves preserve source bytes against the previous commit.
Regenerate the native app and extension from current paths; verify native signature,
selected resources, project LICENSE and every third-party notice in both outputs.
Run affected source-layout, license/asset, document-link, real protocol and browser
checks. A changed browser-output configuration needs its suite run. Do not repeat
unrelated server suites for path-only source assets. Run focused linters.

Generate local zip/manifest and DMG in build/releases. Verify manifest hash/size,
archive Reader.app layout, unchanged public download asset names, and DMG signature
and expected Applications link through the existing release script. Do not publish.
Independently review the real root and source/test trees, including ignored and
untracked items, against the ownership table. After pass, keep results in permanent
docs and remove this temporary plan. Preserve unrelated user state.
