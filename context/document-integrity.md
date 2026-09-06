# Document integrity and workspace mutation contract

Required reading before changing document open/save/watch behavior, filesystem
mutations, path authorization, or the native file/folder handoff.

## Invariants

- Reader is single-user. Concurrency control protects that user from overlapping
  browser, automation, watcher, and threaded-server operations; it is not an
  account, collaboration, or distributed-sync model.
- A server process owns its writable roots. Home and an explicit startup folder
  are initial grants. Browser state, the current tree root, recent files, and
  successful reads never create a write grant.
- Save, create, rename, move, and Trash must validate every mutated source and
  destination against the same server policy after canonical path resolution.
  A symlink cannot extend a grant.
- Reading may be broader than mutation. A document outside current grants may be
  displayed, but the backend reports it as read-only and all direct mutation
  routes still refuse it.
- Client open, save, and watcher results belong to the document session and text
  revision that started them. A late result must not change a newer session.
- Client saves are serialized. On the threaded server, an expected-mtime check,
  temporary-file write, atomic replace, and result stat are serialized per
  canonical target path.

## Native boundary

When Reader.app starts a new server for a Finder-opened file, that startup
folder is an initial server grant. An already-running server has no separately
authenticated launcher-to-server capability for adding a root. Such an external
Finder open is therefore read-only. The native folder picker can use folders
already covered by grants; securely adding a new external root is a separate
capability-design task, not a browser API.

## Regression evidence

[`tests/test_save_security.py`](../tests/test_save_security.py) pins simultaneous compare-and-replace behavior.
[`tests/test_workspace_authorization.py`](../tests/test_workspace_authorization.py) exercises every mutation route and
symlink escapes. [`tests/browser/webmcp.spec.js`](../tests/browser/webmcp.spec.js) delays and interleaves real page
requests to pin session, revision, watcher, save-queue, and read-only behavior.
