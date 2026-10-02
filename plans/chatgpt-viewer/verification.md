# Verification

Focused extension checks must cover the actual bundled shared UI and SDK wiring, not merely a duplicate renderer. They must prove startup makes no local API requests; panel isolation; stale read rejection; refresh sequencing; subscription cleanup; storage fallback; missing capabilities; safe relative content; disabled editing; and sanitization.

Run `npm ci && npm run build && npm test` in `extensions/chatgpt`. Run `python3 -m unittest discover -s tests -v` and `npm run test:webmcp` at the root after shared changes. Rebuild with `./macos/build-app.sh`, verify with `codesign --verify --deep --strict build/Reader.app`, and compare changed static resources. Observe the installed Mac app separately.

The real host check records the installed version, conversation surface, transport, plugin installation, viewer selection, and result of clicking an ordinary `.md` file link. Edit the source through the assistant with the panel open and observe refresh. Mock tests are not evidence for this check. If connection requires user action, document the exact step and leave host delivery unverified.
