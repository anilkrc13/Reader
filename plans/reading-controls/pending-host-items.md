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

The owner authorized scoped local links and existing branding after settings checkpoint
`607a88d`. The [scoped-link plan](scoped-links.md) records the implementation boundary.
The resolver uses trusted opened-file metadata and checks lexical and canonical
containment. The viewer requests host-mediated opening only with its file capability.
It never parses an opaque URI as a path. No project-wide grants are added. Actual
metadata supply, host opening, and icon rendering remain unobserved.

Existing Reader artwork is packaged with supported interface logo and composer-icon
metadata. No redesign or installed-cache edit is involved. Same-thread Back/Forward
still needs a host history API.
