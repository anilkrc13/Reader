# Approved Reader Markdown viewer

Status: candidate v2 approved by Astra before this task. Real host verification is pending.

Reader should open Markdown conversation files in the desktop side panel with the same reading interface as its local browser and Mac app. The Python server and its document permissions stay unchanged. The extension has its own pinned TypeScript package in `extensions/chatgpt`.

The embedded page uses the shared renderer, styles, fonts, find, and reading layout. It has a separate boot path. It accepts only the opaque resource supplied by the host. Each panel owns its session and subscription. A switch or disposal invalidates old reads. Refreshes preserve reading position where possible. A transient error retains the last successful preview.

The host owns document access. The extension server serves only its bundled UI. It has no filesystem reading tool or save tool. Editing and autosave are disabled. Embedded preferences contain only allowed appearance and reading settings. They use independent browser storage if available, otherwise memory.

Relative images show placeholders. Relative file links report unavailable. Anchors remain within the document. HTTP and HTTPS links use the host open-link capability. Other schemes and native actions are unavailable. Only `.md` is registered.

Implementation order: build the minimum viewer and stdio package; check resource protocol and standalone regressions; install in the actual desktop host; observe ordinary file-link replacement and assistant edits. Stop expansion if routing fails. No public deployment is authorized. Disable or uninstall the extension to roll back. Documents and standalone preferences are untouched.

Editing requires a separate approved save design after actual routing and refresh work. That design must require writable=true and a nonempty ETag, serialize writes with ifMatch, keep autosave off, never force overwrite, preserve dirty drafts on updates or uncertain failures, and bind outcomes to the document session and text revision.
