# Embedded host acceptance

The local implementation and simulated host tests pass. Actual Codex desktop
installation, default viewer selection, metadata supply, file opening, icon display,
and edit-driven refresh remain unobserved. Build and setup are in the
[extension README](../extensions/chatgpt/README.md). Do not treat simulated-host
success as evidence of those desktop checks. Do not edit installed plugin caches.

## Checks to perform in the actual host

- Open an ordinary Markdown file link and confirm Reader appears in the conversation
  pane. Record host version, conversation mode, viewer choice, and default setting.
- Change the file externally and confirm its panel updates. Open another file and
  confirm each panel retains its own document, preferences, and reading position.
- Switch Codex between light and dark mode. Confirm Reader follows it without a
  Theme control. Check Find, Refresh, shared display controls, percentage width,
  and heading layout in narrow panes.
- Open Settings in a narrow or short pane. Reach every section and fine-tune control
  by scrolling. Resize to the modal and back while focused. Confirm choices, focus,
  Back/Escape behavior, and the reading passage survive repeated open/close.
- Open sibling and child-directory Markdown links through the host. Refuse parent
  traversal and escaping symlinks. The host must supply trusted opened-file metadata
  and advertise `experimental["openai/files"]`. No local link adds filesystem grants.
- Confirm existing Reader artwork appears through interface logo and composer-icon
  metadata. Record host refusal or missing-capability notices rather than guessing.

## Recorded boundaries

The host owns document contents and final file-opening policy. Relative Markdown
links require a scoped resolver that checks lexical and canonical containment and
regular Markdown targets. It reads no file contents. Resolution and host opening
are separate operations and cannot guarantee an atomic filesystem transaction.
The opaque resource URI is never parsed as a local path. Cross-document section
anchors are unavailable because the file-open API accepts a path only.

Same-thread Back and Forward remain unavailable. The SDK supplies current file
name and URI but no thread identity or document-history API. Per-iframe history
would not establish same-thread navigation, especially after iframe recreation.
No misleading history controls are added.

The viewer is read only and has no folder browser, disk save, or installed-font
API. Lora and system defaults remain available without font enumeration or new
permissions. Native installed-font selection is a separate manual check: update
through `install/Reader.command`, choose an installed body and heading family,
restart, and confirm the choices persist. Never launch generated build/Reader.app.

## Completed checkpoints

Reading/search and keyboard behavior passed review at `7d7370c`; shared settings
at `607a88d`; scoped links and branding at `1661704`; adaptive settings at `c48b549`;
faster isolated test scheduling at `7feeba1`; native fonts and focused lint at
`de2eb8a`. The font checkpoint passed 154 automated checks and independent review.
The source-layout change preserves those behaviors and their acceptance coverage.
