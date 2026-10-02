# Installed font checks

A targeted browser regression supplies a native bridge family list and verifies
body/head selection, CSS quoting, saved choices, reload, missing-family fallback,
restoration after reinstall, enumeration errors, and comparison-pane sharing.
A real AppKit probe confirms the API returns families on this Mac. Build the native
launcher to verify the actual API and guarded message handler compile.

The final gates run once after source freezes: native browser, embedded browser,
Python, and protocol suites. Build the extension before its protocol checks.
Regenerate the Mac app, verify its signature, and compare changed resource copies.
Inspect rendered Settings and document typography. Confirm only Lora font files
and font-face declarations remain. Freeze a local commit for the existing reviewer.
No app install, generated-bundle launch, push, or publication.
