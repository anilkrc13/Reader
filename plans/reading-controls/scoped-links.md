# Scoped embedded local links

The owner authorized local-link navigation and existing Reader artwork after the
reviewed settings checkpoint. This work keeps the native app unchanged.

A document currently cannot open another local document. Add one app-visible server
tool that validates a relative Markdown link against the host-owned opened-file path
from `getResourcePath(extra._meta)`. The caller supplies only the link, never a base
path or a grant. The server rejects missing/malformed metadata, absolute paths,
URLs, queries, malformed encoding, and files outside the opened document's directory.
Check containment before resolving symlinks and again after `realpath`. Canonicalize
both the opened file and its containing directory. Return a regular Markdown file's
canonical path only in app-only result metadata. No document bytes are read.

The app checks `extensions.files` capability before requesting resolution and then
uses the documented host file-open method. It drops stale results after a resource
switch, teardown, or a newer link request. Same-document anchors remain shared
Reader navigation. The file-open API accepts a path only, so cross-document section
anchors are unavailable and must produce an explanation without opening the wrong
section. Local links with no trusted metadata or no host capability fail closed.

This does not turn existing project access into a broad Reader grant. The SDK's
host-owned metadata is the authority for one opened document. Actual host supply
and file-opening behavior remain acceptance checks in the prototype. The server
trusts that the host owns that metadata, as its SDK contract requires.

Copy the existing `macos/Assets/ReaderIcon.icon/Assets/ReaderIcon-1024.png` into the
built plugin's `assets/` directory. Set the documented `logo` and `composerIcon`
fields to that packaged image. Do not redesign the icon or write installed caches.

Verify containment against traversal, percent encoding, symlink escapes, malformed
metadata, directories, non-Markdown files, and allowed child files through the real
stdio server. Verify host capability, errors, stale responses, keyboard activation,
and unchanged external/anchor behavior through the bundled SDK viewer. Run protocol,
browser, and Mac build gates. Freeze a local commit for the existing independent
reviewer. No PR, push, merge, installation, deployment, or private host reload.

Back/Forward stays pending: the SDK provides no same-thread history API.

## Checkpoint evidence

- `npm run test:embedded`: 13 passed. The new cases cover host resolution,
  missing capability, resolver refusal, host refusal, keyboard activation, stale
  replies after switching away and back, newer local/external links, and teardown.
- `npm --prefix extensions/chatgpt test`: 9 passed. Real stdio calls cover
  trusted metadata, traversal, encoded traversal, symlink escapes, safe symlinks,
  regular Markdown targets, and absent app-owned base grants. Asset bytes match.
- `npm run test:webmcp`: 34 passed.
- `python3 -m unittest discover -s tests -v`: 90 passed.
- `./macos/build-app.sh`: passed.
- `codesign --verify --deep --strict build/Reader.app`: passed.
- Shared JS, CSS, and HTML match bundle resources. Packaged icon matches source.
- `node --check extensions/chatgpt/dist/server.mjs` and `git diff --check`: passed.

Logs are `/tmp/reader-links-final-{embedded,protocol,native,python,build}.log`.
The rendered host-refusal state is under `build/embedded-test-results/`; it was
inspected. The unchanged source artwork was also inspected. Actual host routing,
metadata injection, and interface icon display remain manual acceptance checks.
No native or Python source changed, and no installed application was touched.
Resolution and host opening cannot be one atomic operation with the documented
path-only API. The host owns final access policy; concurrent filesystem replacement
between validation and opening is outside this prototype's guarantees.

Independent review of frozen `cc8d1e9..1661704` passed with no concrete findings.
The reviewer independently reran the real stdio containment case: one pass, zero
failures. The checkpoint is ready for owner inspection. Actual host metadata,
file routing, and icon display remain unobserved. No PR, push, merge, deployment,
installation, cache edit, or private host reload occurred.
