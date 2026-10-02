# Local prototype evidence

The read-only prototype is implemented. Actual desktop installation and file-link routing remain unverified. The computer-use tool refused Codex UI access. No attempt was made to bypass that refusal. No plugin was installed or enabled, no tunnel was created, and nothing was published.

The application at `/Applications/ChatGPT.app` reports version `26.928.40906` in Info.plist. The active surface is Codex desktop. The package README contains the documented local-marketplace installation procedure and the separate real-host test. Package manifests pass the current Agent Plugins JSON schemas. That does not prove the host loads them.

Observed local checks:

- `npm --prefix extensions/chatgpt run build`: TypeScript and bundled UI/server build pass. Runtime dependencies, styles, fonts, and notices are included in the generated package. The UI is about 8.1 MB; real-host resource-size acceptance is unverified.
- `npm --prefix extensions/chatgpt test`: seven session and real stdio-server checks pass. They cover late reads, overlapping refreshes, independent panels, subscription cleanup, blocked reads during switching, invalid input, Markdown metadata, and refusal of arbitrary server resources.
- `npm run test:embedded`: four browser checks pass using the actual SDK and bundled UI with a simulated host. They cover startup without local requests, sanitization, disabled editing, find, update notifications, retained previews on errors, storage denial, panel isolation, missing capabilities, host external links, narrow layout, and retained reading offset.
- `python3 -m unittest discover -s tests -v`: all 90 Python tests pass.
- `npm run test:webmcp`: all 30 existing browser regression tests pass.
- `./macos/build-app.sh`: pass. `codesign --verify --deep --strict build/Reader.app`: pass. `cmp static/app.js build/Reader.app/Contents/Resources/static/app.js`: pass.
- `node --check static/app.js` and `git diff --check`: pass.

Browser, Python socket, asset compiler, and signature checks needed execution outside sandbox restrictions. Their initial sandbox attempts were unavailable; the checks listed above were observed in the permitted local execution environment.

Rendered light/error, dark/error, unsupported-host, and narrow states were inspected. Screenshots are in `build/chatgpt-evidence/`, which is generated local output. No independent implementation review is claimed.

The installed copy at `~/Applications/Reader.app` still differs from the new frontend. It was not replaced or launched for this change. The new bundle is signed and ready for installation, but an installed-app regression check remains pending. Update through `install/Reader.command`, then check launch with a fresh server, reuse of a running server, and opening a Markdown file from Finder. Do not launch `build/Reader.app` directly.

Remaining desktop acceptance: install Reader Markdown through the documented local marketplace; start a supported desktop conversation with it enabled; click an ordinary Markdown file link; record Reader replacing the default side-panel viewer and any chooser/default setting; edit the file through the assistant and observe live refresh. A separate browser or native window does not satisfy this check. If local stdio installation is unsupported, account access is needed for the official Secure MCP Tunnel fallback. Stop feature expansion if routing fails.

Coordination records: implementation chat `01a0fd56-c179-7f53-abf6-987023079289`; original Reader request `01a0fd43-2306-7dc1-854c-533a8c4f0983`; dot coordination delegate `01a0fd53-91de-709d-9c67-6980c38c10fe`; dot source chat `01a0f381-fbad-75d4-b6aa-73ee53ec7017`.

Changed files across the approved-plan and implementation commits:

```text
AGENTS.md
CHANGELOG.md
context/.freshness
docs/architecture/README.md
docs/architecture/chatgpt-viewer.md
docs/testing.md
extensions/chatgpt/.gitignore
extensions/chatgpt/README.md
extensions/chatgpt/build.mjs
extensions/chatgpt/marketplace.example.json
extensions/chatgpt/package-lock.json
extensions/chatgpt/package.json
extensions/chatgpt/playwright.config.cjs
extensions/chatgpt/src/app.ts
extensions/chatgpt/src/env.d.ts
extensions/chatgpt/src/server.ts
extensions/chatgpt/src/session.ts
extensions/chatgpt/tests/browser/embedded.spec.mjs
extensions/chatgpt/tests/server.integration.test.mjs
extensions/chatgpt/tests/session.test.mjs
extensions/chatgpt/tsconfig.json
package.json
plans/README.md
plans/chatgpt-viewer/evidence.md
plans/chatgpt-viewer/plan.md
plans/chatgpt-viewer/verification.md
static/app.js
```
