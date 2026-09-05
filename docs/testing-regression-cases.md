# Reader regression test cases

Use these as deterministic Web MCP integration tests. Each test should start with a clean temporary workspace and verify both the tool result and the resulting Reader state.

1. **Open and render a document**  
   Open a Markdown document. Verify the active document, title, and rendered heading/body are correct.

2. **Edit and save**  
   Replace document text, save, then reopen it. Verify the saved text and preview match.

3. **Unsaved-change protection**  
   Edit a document without saving, then attempt to open another document. Verify Reader preserves the edit or presents the expected decision state.

4. **External-change conflict**  
   Change an open document on disk after an edit in Reader. Verify the conflict state and the selected resolution—reload or keep the Reader version.

5. **Automatic reload of external changes**  
   While a document is open, change its text on disk, replace an embedded local image, and change Mermaid source. Verify the document, image, and diagram refresh automatically without a manual page reload.

6. **Preview formatting applies and persists**  
   In Preview, change one representative setting per category: typography—body size; headings—spacing; layout/readability—line width; theme—light or dark. Verify each updates the preview immediately and persists through reload.

7. **Preference reset**  
   Reset a changed setting to its default. Verify the default is effective and remains so after reload.

8. **Search and open a result**  
   Search for a known phrase across multiple documents and open a deep result. Verify the correct document becomes active.

9. **History navigation**  
   Open two documents, navigate back, then forward. Verify the active document and navigation state are restored each time.

10. **Task toggle round trip**  
   Toggle a Markdown task, save, and reopen. Verify the source and rendered task state agree.

11. **Safe file operations**  
    Attempt an allowed save or move in the workspace and a disallowed operation outside it. Verify the allowed action succeeds and the unsafe one is rejected without changing files.

## Keep two small smoke checks outside Web MCP

- A browser UI check that a representative setting is visible and keyboard-operable.
- A packaged macOS app check that the rebuilt app launches and serves the current Reader assets.

These cases cover the main Reader lifecycle: open, render, edit, save, recover, configure, find, navigate, and protect user files. Add more only when a new feature creates a new user-critical workflow.
