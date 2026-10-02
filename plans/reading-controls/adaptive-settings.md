# Embedded settings sized to the pane

The owner reports that the modal does not work in the small side pane and describes
that pane as a mobile app. No supplied screenshot pixels were available to this task.
The diagnosis uses the existing CSS and independently rendered iframe sizes.

Reader currently borrows the desktop settings shell. Width media queries switch its
rail to horizontal tabs, but it remains a padded modal. Its minimum sizes and fixed
header/tab space can leave little usable room in a short pane.

Use the actual iframe viewport. At 1000px wide or less, or 600px high or less, present
the existing settings as a full-pane screen. Keep Back to document above a compact section picker built from the shared
category labels. The picker activates the existing category buttons; the shared
tabs remain in roomy mode. Stack each row's label and controls. Give the content all
remaining height with its own scroll area. Back and the section picker remain fixed in the pane. Roomy panes keep the centered modal. Keep shared controls, handlers, preferences,
focus containment, and native markup. Only embedded CSS and small embedded shell
behavior change. Do not change native styles or preferences.

Update the reused Close button to Back in compact mode and restore Close in roomy
mode. Keep tablist orientation vertical in roomy mode. The compact picker provides
standard native keyboard navigation. Reuse existing header/control nodes and move
the header only in the embedded shell so visual and keyboard order agree. Resize changes presentation without
remounting controls or resetting choices. Keep focus on its existing control during
resize. On compact open, focus Back; Escape and Back reuse shared close and return
focus to the opener. Capture Reader's shared character anchor when Settings opens. Restore it when Settings closes if the document path is still current. Retain the initial pixel inset within that character for unchanged typography. These bridge methods exist only in embedded boot; native behavior is unchanged.

Validate width and height independently: narrow/tall, wide/short, narrow/short, and
roomy panes. Check all categories and fine-tune controls reachable by scrolling,
Back/Close reachable, no horizontal content overflow, large interface size, keyboard
focus and tab wrap, repeated open/close, resize while focused, preference persistence,
and reading position on return. Render screenshots from those independent test panes.
Run embedded and native regression gates and freeze a local commit for the existing
reviewer. No screenshot-specific claims, installation, PR, push, merge, or host UI use.

## Evidence

The previous shell failed the 360×280 full-pane bounds check. Four pane-size checks
passed after the layout change. A resize check then found a one-paragraph shift
following typography and pane-size changes. Reusing the shared character anchor
fixed that check. Full regression and independent review results follow below.

Headless Chrome did not change a plain native select with arrow keys, even outside
Reader. The keyboard test uses native type-ahead, which worked in that control.
Reader adds no custom picker keyboard handler.

## Final checks

- `npm run test:embedded`: 18 browser cases, including the actual-pane matrix and live resize.
- `npm run test:webmcp`: 34 local/native browser cases.
- `npm --prefix extensions/chatgpt test`: nine protocol/security cases.
- `python3 -m unittest discover -s tests -v`: 90 server cases.
- `./macos/build-app.sh`: regenerated the signed app bundle.
- `codesign --verify --deep --strict build/Reader.app`: signature check passed.
- `cmp` checks: `static/app.js`, `static/app.css`, and `static/index.html` match bundled resources.

Logs are `/tmp/reader-adaptive-final-{embedded,native,protocol,python,build}.log`.
Rendered evidence is under `build/embedded-test-results/`, including the four
pane-size cases, light/dark settings, and live-resize screenshots. The generated
bundle was not installed or launched. Real host acceptance remains pending.

## Independent review

Frozen `5d5fde8..c48b549e9ed56a137de625d86ad9835ee8d20008` passed with no
concrete findings. The existing reviewer independently reran the resize regression:
one passed. Review checked iframe width/height switching, compact navigation,
scrolling controls, resize focus, retained choices, passage restoration, and the
embedded-only bridge. Narrow/short, large-interface, and resized modal screenshots
were inspected. The change is ready for user inspection. Real host acceptance
remains pending.
