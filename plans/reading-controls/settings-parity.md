# Embedded settings parity

The owner asked to use Reader’s existing settings instead of a bespoke embedded
dialog. This work starts after the independently reviewed `7d7370c` milestone.

Reuse the existing settings markup, tabs, labels, controls, presets, focus handling,
and renderer settings. Codex still controls light/dark mode. Expose the existing
four light papers (Cream, White, Sepia, Grey) and three dark surfaces (Ink, Charcoal,
Black), accent colour, and interface size. Omit file-panel positioning and glass:
the embedded viewer has no file panel.

Expose Reading typography, headings, spacing, percentage line width, table borders,
and the existing two-page reading controls. Keep narrow headings responsive while
letting the title controls work. Expose Code palette, monospace face, size, and wrapping.
Embedded reset applies display defaults directly because sandboxed hosts can block
browser confirmation dialogs. The native reset confirmation stays unchanged.
Persist only validated supported display choices in embedded storage. Host theme,
editor, file grants, native preferences, and update options are never stored there.

Audit all native sections. Editor and Files/watching explain their absent features.
Shortcuts list only supported embedded actions. About identifies the package version
and explains that native installation and update controls belong to the Mac app.
Do not show a functional control for an unsupported feature.

Verify initial and live host themes with every paper choice, control persistence and
storage denial, reset defaults, preset updates, title sizing, Code styling, percentage
width, keyboard focus, narrow layout, and read-only boundaries. Run the existing
native/browser/server gates and Mac build. Inspect both theme variants and supported
settings tabs. Freeze the new commit for independent review before delivery.

Host-mediated links and complete same-thread history remain separate capability/design
questions recorded in pending-host-items.md. Plugin branding remains pending approval.

## Implementation evidence

The embedded viewer now reuses the shared settings panel. Native changes are guarded
by the embedded marker. No backend, grant, dependency, or installed app changes were made.
The first sandbox reset test failed because the browser blocked `confirm()`. Embedded
reset now restores display choices directly; the native confirmation is unchanged.

- `npm run test:embedded`: 11 passed after the reset repair.
- `npm run test:embedded -- --grep 'shared reading and code' --output build/settings-parity-visuals`: 1 passed; added dark and local-only tab screenshots inspected.
- `npm run test:webmcp`: 34 passed on final shared JavaScript.
- `python3 -m unittest discover -s tests -v`: 90 passed.
- `npm --prefix extensions/chatgpt test`: 7 passed.
- `./macos/build-app.sh`: rebuilt and signed successfully.
- `codesign --verify --deep --strict build/Reader.app`: passed in host trust context.
- `cmp` for shared JS, CSS, and HTML against bundle resources: all matched.
- `node --check static/app.js` and `git diff --check`: passed.

Visual evidence is under `build/embedded-test-results/` and
`build/settings-parity-visuals/`. Check Appearance in light/dark, Reading at wide and
narrow widths, Code in light/dark, and the local-only notices. Actual desktop host
installation, routing, and refresh still require the prototype’s manual acceptance check.

Independent review of frozen `7d7370c..607a88d` passed with no concrete findings.
The reviewer checked validation, independent storage, host theme, display reset,
keyboard/focus handling, native guards, and rendered settings evidence.
The implementation is ready for owner inspection. Real-host prototype acceptance
remains pending; no installation, push, PR, merge, or deployment occurred.
