# Reader: architecture review and plan for going public, Windows, and auto-update

Written 2026-09-03 against commit `1f4841e`.

## 1. What Reader is today

Three layers, cleanly separated:

| Layer | Where | Size | Notes |
|---|---|---|---|
| Server | `reader.py`, `reader_backend.py` | ~1,270 lines, stdlib only | Loopback HTTP on 8737, token cookie, Host check, CSP, write-grant store, atomic saves. 60 unit tests, all passing. |
| UI | `static/` | app.js 4,655 lines, app.css, index.html | Vanilla JS. Bundled marked, DOMPurify, highlight.js, Mermaid, eight typefaces. Talks to the server over `/api/*`. Playwright WebMCP suite. |
| macOS shell | `macos/ReaderLauncher.swift` (~500 lines), `build-app.sh`, `Info.plist` | Swift, WKWebView | Probes the port, spawns `python3 reader.py`, reads the token, folder chooser bridge, link hand-off, Finder document types. |

The security model is the strongest part of the codebase and is documented in `context/document-integrity.md`. Nothing in this plan should weaken it.

Three structural facts drive everything below:

1. **The app depends on a system `python3`.** The launcher runs `/usr/bin/env python3`. On a fresh Mac that path is an Xcode Command Line Tools stub that pops a "install developer tools" dialog. On Windows there is no Python at all. Anyone who downloads the app without being a developer hits this first.
2. **The built app is committed to git.** `install/Reader.app` is tracked, including a 3.2 MB `Assets.car` that `actool` regenerates non-deterministically. `.git` is already 140 MB with 20+ copies of that file. The signature inside is ad-hoc or self-signed, which means nothing to anyone but the machine that built it.
3. **There is no version or update channel.** `VERSION = "2.0"` in `reader.py` and `CFBundleShortVersionString` in `Info.plist` are set by hand and can drift. `/api/ping` reports the version but nothing compares it to anything.

## 2. Public-readiness audit

### Blockers (fix before flipping the switch)

| # | Finding | Evidence | Fix |
|---|---|---|---|
| B1 | **No license.** GitHub reports `licenseInfo: null`. Without one, nobody may legally use or fork the code. | `ls LICENSE*` → none | Add `LICENSE` (MIT or Apache-2.0, your call). Bundled third-party licenses in `licenses/` are already correct. |
| B2 | **Another company's brand in the product UI.** Settings copy says "Anthropic brand accents", "Poppins is the Anthropic heading face", "Brand keeps code in the Anthropic accents". `app.css` header says "Anthropic brand styling". | `static/index.html:370,472,589`, `static/app.css:2` | Rename to neutral copy ("Warm accents", "Poppins heading face", "Default palette"). README comparisons to "the Claude app" can stay if softened to "like a modern desktop app". |
| B3 | **Stale product name.** "Markdown Viewer" in file headers and the redirect page title; `mdview` storage keys. | `static/app.js:2`, `static/app.css:2`, `reader.py:347` | Rename headers and the `<title>`. Keep `mdview.v2` localStorage key and `.mdview-token` fallback for migration, with a comment saying why. |
| B4 | **Committed binary app bundle.** Unreviewable in PRs, meaningless signature for others, bloats history. | `install/Reader.app` tracked; `.git` 140 MB | Stop tracking it. Ship builds as GitHub Release assets (see Phase 1). Keep `install/Reader.command` only if it points people to Releases. |
| B5 | **History contains machine-local files and a fake author email.** `.claude/launch.json` with `/Users/anilchannappa/...` paths and nine `.playwright-cli` snapshots were committed then removed. 35 of 62 commits are authored as `anilchannappa@Anils-MacBook-Pro.local`, which leaks the hostname and will never link to your GitHub profile. | `git log --all -- .claude .playwright-cli`; `git log --format=%ae` | One-time `git filter-repo` before publishing: drop `install/Reader.app`, `.claude/`, `.playwright-cli/` from history and apply a mailmap to a GitHub noreply address. Single-author private repo, so a force-push is safe. Expected result: `.git` under 10 MB. **This is a destructive operation and needs your explicit go-ahead.** |

### Should fix (first impressions)

| # | Finding | Fix |
|---|---|---|
| S1 | README is a 300-line macOS operations manual. A visitor cannot tell in ten seconds what Reader is or how to get it. | Rewrite top: one-line pitch, screenshot, "Download for macOS" link to Releases, "Run from source" in three lines. Move signing, permissions and Finder details to `docs/macos.md`. |
| S2 | README says "no dependencies" and "no network access". Both stop being literally true once there is an update check. | Say "standard-library Python only" and "no network access except an optional update check you can turn off". |
| S3 | No CI. Tests only run on your machine. | GitHub Actions: `python -m unittest` on macOS, Ubuntu and Windows runners; Playwright suite on macOS; a build job that produces the `.app` on tags. |
| S4 | No `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, issue templates, repo description or topics. | Add all five. `SECURITY.md` matters here because the project makes explicit security claims. |
| S5 | `plans/webmcp-in-two-pieces.md` is an internal note citing "Codex's built-in browser" and a `learn.chatgpt.com` URL. | Delete or fold the useful parts into `docs/testing.md` along with `reader-regression-test-cases.md`. |
| S6 | `AGENTS.md` and `context/` are agent-facing instructions. Fine to publish, but say so at the top so humans do not think they are the contributor guide. | One-line preface in each. |
| S7 | Version defined in two places. | Single `VERSION` file read by `reader.py`, `build-app.sh` (into `Info.plist`) and CI. |

### Already good

- Secret scan of the working tree and full history: only the token *filename* appears, never a value. `.reader-token`, `preferences.json`, `.DS_Store`, `node_modules` are ignored and untracked.
- Tests: 60 Python tests pass in 9 seconds. Bundle resources match source byte for byte and `codesign --verify --deep --strict` passes.
- No hardcoded personal paths in tracked files. No TODO or FIXME debris.
- Third-party licensing is complete and shipped with the app.

## 3. Windows portability review

Things that are macOS-only today, ranked by effort:

| Area | Current | Windows reality | Effort |
|---|---|---|---|
| Native shell | Swift + WKWebView | Needs WebView2. Either a second shell (C#/.NET) or one cross-platform shell. | Large. This is the architectural decision in Section 4. |
| Python runtime | System `python3` | Not present. Must be bundled on both platforms anyway (see fact 1). | Medium. Solved once for both. |
| Trash | `~/.Trash`, XDG fallback | Windows Recycle Bin needs `IFileOperation` via `ctypes`, or fall back to a Reader-owned `Trash` folder. | Small. `reader_backend.py:586`. |
| Open with default app | `subprocess.run(["open", path])` | `os.startfile(path)` on Windows, `xdg-open` on Linux. | Trivial. `reader.py:483`. |
| Data directory | `~/Library/Application Support/Reader` | `%APPDATA%\Reader`; `$XDG_DATA_HOME` on Linux. | Trivial. `reader.py:choose_prefs_file`. |
| Token file permissions | `os.open(..., 0o600)` | Mode bits ignored on NTFS. Use `%LOCALAPPDATA%` (per-user ACL) and accept that, or set an ACL with `icacls`. | Small. |
| Search skip lists | `Library`, `Caches`, `Containers` | Add `AppData`, `node_modules` already there. `SEARCH_NEVER_IN_HOME` should include nothing Windows-specific. | Trivial. |
| Path semantics | POSIX assumptions in tests | Case-insensitive FS, drive letters, `\\?\` prefixes, reserved names. `pathlib` handles most of it, but `resolve()` and symlink tests need a Windows CI run to prove it. | Medium, discovered by CI. |
| Keyboard labels | `⌘` hardcoded 45 times in `index.html`, 36 in `app.js` | Handlers already accept `metaKey \|\| ctrlKey`. Only the *labels* are wrong. | Small. One `modKey()` helper and a data attribute on shortcut labels. |
| Finder integration | `Info.plist` document types, `NSOpenPanel` bridge | Windows file associations live in the installer; folder chooser via WebView2 host or `IFileOpenDialog`. | Comes with the shell choice. |

Nothing here is deep. The server is already 95% portable because it is stdlib Python. The shell and the runtime are the real work.

## 4. The architectural decision: one shell or two

Auto-update, Windows, and "no system Python" all hinge on how the app is packaged. Three credible options:

| | A. Two native shells | B. Tauri v2 with Python sidecar | C. Tauri v2 with Rust backend |
|---|---|---|---|
| Shell code | Keep Swift (~500 lines). Write C#/WebView2 twin (~500 lines). | One Rust shell, ~200 lines, replaces Swift. | Same as B. |
| Server | Python, bundled per platform with PyInstaller or python-build-standalone. | Python, bundled as a Tauri sidecar via PyInstaller (one file per platform). | Port ~1,270 lines to Rust (axum or tiny_http). Port 60 tests. |
| Updater | Sparkle 2 (macOS) + Velopack (Windows). Two appcast formats, two integrations. | Tauri updater plugin: one signed `latest.json`, one flow on both platforms. | Same as B. |
| Packaging and CI | Hand-written: `build-app.sh`, `create-dmg`, WiX or Inno Setup, two signing paths. | `tauri-action` builds `.dmg`, `.msi`, `.exe`, signs, notarizes, uploads to Releases and writes `latest.json`. | Same as B. |
| Install size | ~40 MB (Python runtime dominates) | ~40 MB | ~10 MB |
| Preserves `python3 reader.py` dev mode | Yes | Yes | No (unless kept as a legacy path) |
| Preserves the macOS niceties | Yes, all of them | Icon Composer icon, Dock icon, file associations, native dialogs: yes via Tauri config and plugins. Adaptive light/dark Dock icon needs a small native snippet. | Same as B. |
| Risk | Two toolchains, two updaters, two sets of bugs for one maintainer. | PyInstaller sidecars are a known-good pattern but add ~25 MB and a startup delay (~300 ms). | Largest rewrite; loses the "stdlib Python, read it in an afternoon" property. |

**Recommendation: B, with C as an optional later step.**

Reasoning: you are one maintainer. Option A doubles every platform-specific surface forever. Option C throws away a tested, audited backend for size savings nobody asked for. Option B keeps the server and the UI exactly as they are, replaces one 500-line shell with a smaller one, and gets signing, installers, and auto-update from a single well-maintained pipeline. The frontend keeps talking HTTP to `127.0.0.1`, so the browser and PWA modes the README advertises keep working.

If B is not to your taste, A is the honest alternative: the Swift shell is good and Sparkle is the best updater on macOS. Choose A only if a second native shell is something you want to own.

## 5. Auto-update design

Applies to whichever shell option you pick. Two tiers, so value arrives early.

### Tier 1: update *check* (works today, in the browser too)

- Single source of truth: a `VERSION` file at repo root. `reader.py` reads it. `/api/ping` and `/api/state` already return it.
- Client checks `https://api.github.com/repos/<owner>/Reader/releases/latest` at most once per 24 hours, from the server side (so the CSP `connect-src 'self'` stays intact), and only if the preference `updates.check` is true.
- Default on, with an off switch in *Files & watching* and a first-run notice. This is the only network call Reader makes. No telemetry, no identifiers, no user agent beyond the version.
- If newer: a quiet banner ("Reader 2.1 is available") linking to the release page. Dismiss remembers the version so it does not nag.
- Semantic versions compared as tuples; pre-release tags ignored unless `updates.channel = "beta"`.

### Tier 2: update *install*

- **Tauri path:** `tauri-plugin-updater` reads `latest.json` from the release, verifies the minisign signature against a public key baked into the app, downloads the platform bundle, and replaces the app on next launch (macOS) or runs the installer silently (Windows). The private signing key lives only in GitHub Actions secrets.
- **Native-shell path:** Sparkle 2 with an EdDSA-signed appcast generated by `generate_appcast` in CI; Velopack on Windows publishing to the same Release.
- Either way the Python server must exit cleanly on update. The launcher already owns the server process and sends SIGTERM on quit, so this works unchanged.
- The server never updates itself. Only the shell does. `python3 reader.py` users get the Tier 1 banner and update via `git pull`.

### Hard prerequisite: real code signing

Auto-update on macOS is impossible without notarization. Gatekeeper will quarantine a downloaded, self-signed `.app` and the right-click-Open workaround does not survive an in-place update. This means:

- Apple Developer Program: USD 99/year. Developer ID Application certificate, notarization via `notarytool` in CI. This also ends the folder-permission churn that `ensure-signing-identity.sh` exists to work around.
- Windows: SmartScreen warns on unsigned installers until enough downloads build reputation. Options: accept the warning at first, or Azure Trusted Signing (~USD 10/month, no hardware token).

Without the Apple certificate, stop at Tier 1 and ship zips on Releases. That is still a large improvement over "clone and build".

## 6. Phased plan

Each phase ships on its own and leaves the repo in a publishable state.

### Phase 0: Public hygiene (1 to 2 days, no architecture change)

1. Choose a license, add `LICENSE`.
2. Neutralize brand copy in `index.html` and `app.css`; rename "Markdown Viewer" headers and title.
3. Rewrite README top; move macOS depth to `docs/macos.md`; fold `plans/` into `docs/testing.md`; delete the Codex note.
4. Add `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/`, repo description and topics.
5. Add `VERSION` file; make `reader.py` and `build-app.sh` read it.
6. GitHub Actions: unittest matrix (macOS, Ubuntu, Windows). Expect Windows failures; that list becomes Phase 2's backlog.
7. Stop tracking `install/Reader.app`. Add a release workflow that builds it on tag push and attaches a zip.
8. **With your approval:** `git filter-repo` to drop the bundle, `.claude/`, `.playwright-cli/` from history and fix author emails. Force-push. Then flip the repo to public.

### Phase 1: Update awareness (1 day)

1. Server-side check against GitHub Releases, 24-hour cache in `preferences.json`, opt-out preference.
2. Banner in the UI, dismissable per version.
3. README: "no network access except the update check".

### Phase 2: Portable server (2 to 3 days)

1. `os.startfile` / `xdg-open` / `open` dispatch in `open-external`.
2. Platform data directory helper.
3. Recycle Bin via `ctypes` and `SHFileOperationW` (or Reader-owned trash folder as fallback).
4. `modKey()` helper; replace hardcoded `⌘` labels.
5. Fix whatever the Windows CI run surfaced in path tests.
6. Bundle Python: PyInstaller one-file builds of `reader.py` for macOS arm64, macOS x86_64, Windows x64. Verify startup time and that `STATIC_DIR` resolves inside the bundle.

### Phase 3: Cross-platform shell (Tauri v2) (1 to 2 weeks)

1. `src-tauri/` with the Python sidecar declared in `tauri.conf.json`; shell probes the port, launches the sidecar, opens the window at the token URL. Port the Swift logic function by function: probe, own-server lifecycle, link hand-off allowlist, folder chooser, file-open events.
2. File associations and Info.plist usage strings via Tauri config. Adaptive Dock icon via a small Swift or Objective-C snippet in the Rust build (or accept the static icon).
3. Keep `macos/ReaderLauncher.swift` until the Tauri build passes the same manual smoke list, then delete it.
4. `tauri-action` in CI: build, sign, notarize (once the Apple cert exists), upload `.dmg` and `.msi`, publish `latest.json`.

### Phase 4: Auto-install (2 to 3 days after Phase 3)

1. Apple Developer ID and notarization secrets in CI.
2. `tauri-plugin-updater` with the minisign public key; the Phase 1 banner gains an "Install and relaunch" button.
3. Windows signing when budget allows.

## 7. Decisions needed from you

1. **License**: MIT (simplest) or Apache-2.0 (explicit patent grant).
2. **History rewrite**: yes or no. Without it the repo is publishable but 140 MB with a hostname in the author field.
3. **Shell direction**: B (Tauri + Python sidecar, recommended), A (Swift + C# twins), or C (full Rust port).
4. **Apple Developer Program**: willing to pay USD 99/year? This gates Phase 4 on macOS.
5. **Update check default**: on with an off switch (recommended), or off until the user enables it.
