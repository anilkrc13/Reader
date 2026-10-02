# Independent reading-controls review

The independent reviewer judged frozen `cf48552..380c032` against the approved
outline, save-state, icon, and search requirements. Review found one Important defect:
a successful save retry could keep an old failure label when newer edits remained.

The author repaired that defect in `7d7370c`. The existing failure test now exercises
failed save, successful delayed retry, newer pending edits, conflict, and reload.
The reviewer reran an isolated reproduction using the exact committed save functions.
It changed from `retry: saved, dirty: true, label: Save failed` to
`retry: saved, dirty: true, label: Unsaved`.

Independent re-review of frozen `7d7370ce0c82cfff8928804dd51ee365ba390c31` passed with no
remaining concrete findings. Review also checked embedded keyboard guards, focus
restoration, nested controls, and same-document refresh. The reviewer inspected the
committed code and tests, supplied gate logs, and light/dark/comparison screenshots.
Actual desktop embedded behavior and native menu UI were not exercised.

The working version is ready for owner inspection. Double-click
`install/Reader.command` to rebuild, install, and open the native app. Inspect the
outline, save status, icons, Command-F in Preview and Edit, and Command-Shift-O file
search. No app installation was performed by this task. Reload Reader Markdown in
the host to test the embedded package. No PR, push, merge, or deployment occurred.

## Embedded settings parity

Independent review of frozen `7d7370c..607a88d5361ccc9e8bf963c089d5c5fc6210ed35`
passed with no concrete findings. The reviewer checked the supported-control
whitelist, validation, separate storage, host-owned theme, display-only reset,
shared Escape/focus handling, and local-only tab explanations. Native changes
are guarded by the embedded marker. The native reset and write policy stay intact.

The reviewer inspected narrow Reading, dark Code, and Files notice screenshots
and the final gate logs. Evidence shows 11 embedded browser, 34 local browser,
90 server, and seven protocol tests passing. The Mac bundle was rebuilt, signed,
and compared with source resources. Actual Codex host UI and native menu
acceptance remain unobserved.

## Scoped local links and existing branding

Independent review of frozen `cc8d1e9..1661704f50fbc625fea104e81b54053087906060`
passed with no concrete findings. The reviewer independently reran the real stdio
containment case: one pass, zero failures. Review checked SDK metadata parsing,
path-only host opening, lexical and canonical containment, regular Markdown
targets, missing-context refusal, no content reads, stale-reply guards, and
unchanged native source. The host-refusal screenshot and final logs were inspected.

Evidence shows 13 embedded browser, nine protocol/security, 34 local browser, and
90 Python checks passing. Build, signature, native resource copies, and packaged
artwork equality passed. The documented validation/open race remains outside the
prototype's guarantees. Actual host metadata, file routing, and icon display
remain unobserved. Back/Forward still lacks a complete same-thread history API.
The checkpoint is ready for owner inspection; no publication or installation occurred.

## Adaptive embedded Settings

Independent review of frozen `5d5fde8..c48b549e9ed56a137de625d86ad9835ee8d20008`
passed with no concrete findings. The reviewer independently reran the focused
resize regression: one passed. Review checked actual iframe width and height,
full-pane Back and section picker, reachable scrolling controls, focus retention,
preferences, and restoration of the reading passage. Native styles, markup,
launcher, and server behavior are unchanged. The bridge is inside embedded boot.

Evidence shows 18 embedded, 34 local browser, nine protocol, and 90 Python checks
passing. The Mac bundle was rebuilt, its signature verified, and source resources
compared. The reviewer inspected narrow/short, large-interface compact, and resized
modal screenshots. Actual Codex-host acceptance remains pending. No installation,
publication, or push occurred.
