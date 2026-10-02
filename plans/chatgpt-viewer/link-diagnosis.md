# Embedded link diagnosis

The user reports that the custom Reader opens but document links do not navigate. The failing URL or link type is not yet known. No real-host UI access was attempted for this diagnosis.

Two focused checks exercise the current bundled viewer with the real App SDK in the existing permitted simulated-host harness. They pass:

- Same-document anchors reveal a heading placed after 100 paragraphs. The check verifies scrolling in Single column and visibility of the destination in Two-page layout. The return anchor also returns to the top. Neither action issues a host open-link request.
- HTTP and HTTPS links each issue the expected `ui/open-link` request. Relative Markdown links, absolute filesystem links, and `file://` links report unavailable. They retain the current document and make no filesystem-tool request or iframe navigation.

No in-scope supported-link bug was reproduced. No production code changed. Relative-file access remains deferred. A host receiving the correct web-link request can still fail to open it; that boundary is not proven by this harness.

The native/local **Single column** and **Two-page layout** icon buttons map to `single` and `spread`. At the time of this diagnosis, the embedded **Layout** text button toggled those same choices. The later [reading controls update](reading-controls.md) moves them into Settings. Small panels use the single-column fallback.

Focused command: `npm run test:embedded -- --grep 'same-document anchors|filesystem document links'` — two tests passed.

Full embedded command: `npm run test:embedded` — all six tests passed. `git diff --check` passed. Shared static, Python, and native code are unchanged, so no native rebuild or standalone suite rerun was needed. The pre-existing untracked marketplace and Markdown fixture files were preserved. This diagnosis does not stamp those unrelated additions as reviewed.
