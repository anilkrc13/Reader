# Embedded keyboard focus and save-status review repair

The embedded regression was reproduced with the real SDK harness. Arrow Down after
loading a long document left scrollTop at zero. The embedded page never gave the
reading pane initial keyboard focus, and its early keyboard handler bypassed reading
navigation. Native reading focus already worked.

A new embedded document now gets reading focus unless an input or Settings is active.
A refresh of the same document never takes focus. Closing Find returns focus to the
reading pane. Settings retains its normal return focus to the gear. Reading keys from
toolbar controls move the document, while Space still activates a focused button.
Inputs, open dialogs, and nested scrolling blocks keep their keys. Two-page reading
uses the existing page navigation. Native keyboard behavior is unchanged.

Independent review of `380c032` found that a successful save retry could retain the
previous Save failed label when newer edits were still pending. A new serialized
attempt now clears that previous error. The existing failure test exercises a failed
save followed by a successful delayed retry with newer edits. It checks Unsaved,
then still verifies disk-conflict protection and successful reload.

Checks on the repair candidate:

- `npm run test:webmcp`: 34 checks pass, including all save-state and search cases.
- `npm run test:embedded`: nine checks pass. Both new keyboard checks exercise Arrow,
  Page, Space, Home and End keys. They check post-Find and post-Settings behavior,
  control activation, nested scrolling, two-page reading, and live-refresh focus.
- `npm --prefix extensions/chatgpt test`: seven session and stdio checks pass.
- The 90 Python checks passed for the preceding milestone. No Python or server code
  changed in this repair.
- The Mac build succeeds. Signature and changed-resource comparisons pass. The
  installed app is untouched.
- `node --check static/app.js` and `git diff --check` pass.

The root browser checks reproduced and fixed the reviewer’s save-state finding.
Independent re-review is recorded after freezing this repair. Existing light, dark,
comparison and save-state screenshots remain under `build/reading-controls/`.
Actual embedded keyboard behavior in the desktop host remains unobserved.
