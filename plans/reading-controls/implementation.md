# Reading and search improvements

The owner approved an optional heading outline, quiet save status, distinct reading
and comparison icons, and separate document and file search. The source change is
based on `cf48552`. Work stays in the existing checkout. No PR, push, merge, installation,
or deployment is part of this delivery.

The outline opens within each local document pane. It reuses heading IDs and the
existing navigation that reveals folds and two-page positions. Edit-only mode disables
it. Text without headings leaves it disabled. It adds no persistent sidebar.

Save status follows the current document session and the active serialized save.
Saved, Saving, Unsaved, and Read-only remain separate from Live disk watching.
Failure and conflict labels preserve the dirty draft. The server and write policy
are unchanged.

Command-F and the native Edit command search the active document, including source
text in Edit mode. A deferred editor-focus callback no longer takes focus from Find.
Search this document and Search files label the two fields. File search uses
Command-Shift-O. The existing app has no Command-P handler; the change leaves browser
Print and operating-system behavior untouched. Narrow comparison toolbars wrap within
their own pane. Percentage content width and two-page width calculations are unchanged.

The embedded revision remains intact. Its toolbar still exposes Find, Refresh, and
reading Settings. Shared native controls stay hidden in that viewer. An additional
reported embedded keyboard-focus bug is tracked separately for its own commit.

Validation before the first local checkpoint:

- `npm run test:webmcp`: 34 checks pass. The initial regression failed because Files
  focus diverted Command-F. A later check exposed a deferred editor-focus callback;
  its guard fixes the focus race. Outline navigation, both themes, comparison controls,
  and save-state screenshots were inspected under `build/reading-controls/`.
- `python3 -m unittest discover -s tests -v`: 90 checks pass with loopback-server
  permission. The sandbox initially prevented 19 server fixtures from starting.
- `npm run test:embedded -- --grep-invert 'embedded reading keys'`: the existing seven
  embedded checks pass. The new keyboard regression is excluded for this milestone
  because it reproduces a separate requested bug and is not in this checkpoint.
- `npm --prefix extensions/chatgpt test`: seven session and real stdio checks pass.
- The Mac build succeeds. Its signature passes the required check. All three changed
  static resources match their copies in the bundle. The installed app is untouched.
- `node --check static/app.js` and `git diff --check` pass.

Independent review is recorded separately against this frozen checkpoint. The existing unrelated marketplace and Markdown fixtures remain
unmodified.
