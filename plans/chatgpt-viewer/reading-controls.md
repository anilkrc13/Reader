# Embedded reading controls

The embedded viewer follows the host’s initial theme and live theme changes. A saved theme no longer overrides Codex. The toolbar has Find, Refresh, and Settings icons with accessible labels. Settings offers text size, line spacing, content width, and reading layout. Only these four reading choices are saved.

A narrow panel previously inherited the native 65% content width, large side padding, and 48px document title. Embedded defaults now use 90% width. Embedded-only styles reduce side padding and scale document titles with the panel width. The native interface retains its controls, preferences, and defaults. The shared JavaScript changes stay inside its embedded branch.

Validation on October 2, 2026:

- All seven embedded browser tests pass. The added check covers initial and live host themes, old saved themes, icon labels, slider values, persistence, dialog keyboard behavior, and narrow heading dimensions.
- All seven extension session and stdio checks pass.
- All 90 Python tests and 30 existing browser tests pass.
- The Mac build succeeds. Its signature passes `codesign --verify --deep --strict build/Reader.app`. Its bundled `static/app.js` matches the source. The installed Mac app was not changed or launched.
- Narrow heading and Settings screenshots in both themes were inspected. The focused screenshot test passes after moving its output away from the standalone suite’s cleanup directory. Screenshots are under `build/embedded-test-results/`.

The portable extension package was rebuilt. Actual desktop plugin reload and appearance remain unobserved. The desktop UI is unavailable to this task. The CLI marketplace upgrade command applies to Git marketplaces, so it does not refresh this repo-local package. `codex plugin add reader-markdown@reader-local --json` also failed because the CLI could not find the plugin in that marketplace. Reload or reinstall Reader Markdown through the host’s plugin controls to load the rebuilt package.

The pre-existing untracked marketplace and Markdown fixture files remain untouched.
