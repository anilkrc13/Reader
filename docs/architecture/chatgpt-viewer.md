# Conversation viewer design

The extension is a local prototype in `extensions/chatgpt`. It bundles `static/index.html`, scripts, styles, and fonts. Its server registers only a `.md` file entrypoint and serves a UI resource. It does not read document paths or expose filesystem tools. The desktop host owns document authorization and supplies the opaque resource URI.

The shared frontend recognizes the embedded document marker before boot. It skips local preferences, tab restoration, server setup, watchers, native bridges, and automation hooks. It disables local API calls and preference writes. The page retains shared Markdown sanitization, rendering, appearance, find, and reading layout. It exposes a narrow reading interface to the extension SDK client. Unsupported controls stay hidden and editing shortcuts cannot switch modes.

Each iframe owns one DocumentSession. Reads carry a document generation and refresh number. A result applies only while both still match. Subscription changes are serialized separately from reads, so a slow read cannot prevent unsubscribe or disposal. The app receives tool input before connecting, then opens the pending file after capability discovery. It reports absent capabilities instead of falling back to local paths.

The host owns document contents. Each panel owns its loaded preview and reading position. Its independent storage key holds only validated theme, reading size, and layout. Denied storage leaves those choices in memory. A refresh failure keeps the prior preview. A switch clears the old document before reading the new one.

Relative content cannot confer access to other resources. The renderer replaces unresolved images before inserting them into the live page. Links to other files have no navigable href. External HTTP and HTTPS links go through the host. The resource CSP permits embedded assets and no network connections.

The [approved plan](../../plans/chatgpt-viewer/plan.md) stays open until actual desktop installation, ordinary file-link replacement, and assistant-edit refresh are observed. The [package README](../../extensions/chatgpt/README.md) records setup and limitations. Editing remains deferred.
