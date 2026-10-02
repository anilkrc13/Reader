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
