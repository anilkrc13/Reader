# Pending embedded host capabilities

These items do not hold up the completed local reading controls.

The [keyboard regression and its repair](keyboard.md) are part of the completed
reading-controls milestone.

Same-thread Back and Forward remain blocked on host capabilities. The installed
extension SDK exposes the current file’s name and opaque resource URI. Its app API
has no thread identifier or document-history API. History recorded in one iframe
could contain only handles supplied to that iframe, and could disappear when it is
recreated. That would not establish same-thread document history. No misleading
navigation controls have been added.

For local links, the installed SDK exposes `extensions.files.open(path)` only when
the host advertises `experimental["openai/files"]`. That method sends
`openai/files/open`. Actual host support has not been observed because this task
cannot inspect the desktop UI. Relative links have no directory in the iframe’s
file entry input. The opaque URI must never be treated as a filesystem path.

The installed SDK README’s Filesystem Access example documents a narrower related-file
design. A server tool receives the host-owned opened-file path through
`getResourcePath(extra._meta)`. It checks that a requested relative path stays inside
the opened file’s directory before and after resolving symlinks. The local server
metadata schema confirms `openai/resource.path`. This project’s extension server
has no such tool. Real host metadata supply is unverified. Adding related-file reads
needs an approved design; it does not inherit broad project access or create grants.

Reader Markdown also lacks plugin icon metadata. Existing Reader artwork can serve
that purpose without a redesign. The pending metadata task is to bundle the existing
artwork under plugin assets and set the documented interface logo and composer icon
fields. No branding change is included without owner approval.
