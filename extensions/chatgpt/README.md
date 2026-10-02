# Reader Markdown viewer prototype

This package opens host-provided Markdown in the shared Reader interface. It is read only. It has no document save, local Reader server connection, native menu, or folder browser. A scoped server tool validates relative Markdown links for host-mediated opening. The theme follows Codex, including changes while the panel is open. Find and Refresh use icon buttons. The Settings gear opens Reader’s shared settings panel. Appearance includes four light papers and three dark surfaces; Codex controls light/dark mode. Reading includes typography, headings, spacing, percentage content width, table borders, presets, and reading layout. Code includes highlighting, typeface, size, and wrapping. These display choices use a separate storage key with an in-memory fallback. Reset affects only supported embedded display preferences. Editor, Files & watching, and About explain features that belong to the Mac app. Shortcuts lists supported embedded commands. Narrow panels use wider content and smaller document titles. The Python browser and Mac app keep their existing boot path.

The local build and protocol tests work. Desktop installation, default viewer selection, ordinary file-link routing, and assistant-edit refresh have not been observed in the real host. Do not call this integration delivered until those checks pass. Editing needs a separate approved save design.

## Build and check

From the Reader root, with Node 22 or newer:

```sh
npm ci
npm ci --prefix extensions/chatgpt --ignore-scripts
npm --prefix extensions/chatgpt run build
npm --prefix extensions/chatgpt test
npm run test:embedded
```

The build reads the version from the root `VERSION`. `dist/` contains a portable plugin manifest, stdio MCP configuration, a bundled server, and the HTML resource. Scripts, styles, and fonts are embedded. The server serves the UI and validates related Markdown link paths. It never reads document contents. The host handles the opaque document resource. The package copies existing Reader artwork into its supported logo and composer-icon fields. No listener or public filesystem service is started.

The stdio command can be checked independently:

```sh
node extensions/chatgpt/dist/server.mjs
```

It waits for MCP messages on stdin. It does not print a web URL. The integration test connects a real MCP client to this exact bundle and verifies its Markdown entrypoint and UI resource. The browser tests use the real App SDK with a simulated host. They prove protocol wiring and rendering, not desktop routing.

## Desktop installation to test

OpenAI documents a [repo-local marketplace installation route](https://developers.openai.com/plugins/build/plugins). This route has not been proven for this Reader package or this account. The actual desktop application is `/Applications/ChatGPT.app`, version `26.928.40906`, read from its installed Info.plist on October 2, 2026. The active conversation surface is Codex desktop. The computer-use tool refuses access to `com.openai.codex`, so this task cannot inspect its Plugins Directory or click a conversation file link.

1. Build the package with the commands above.
2. Add the entry from `marketplace.example.json` to the repo's `.agents/plugins/marketplace.json`. If no catalog exists, copy the example there. The source path is relative to the Reader root. It points to `./extensions/chatgpt/dist`. Keep any existing catalog entries. This task has not created or enabled that catalog.
3. Restart the desktop app. In its Plugins Directory, select **Reader Local**, then install **Reader Markdown**. Start a new local Codex conversation with the plugin enabled. The plugin configuration runs `node ./server.mjs` from the installed package root. Node must be on the host's executable path. Record any connection error or requested setting.
4. Ask the assistant to create a short Markdown file and return an ordinary clickable file link. Click the link. Record whether Reader appears in the conversation side panel. If the host offers a viewer chooser, choose Reader and record the default setting. A browser or native Reader window is not a passing result.
5. With that panel open, ask the assistant to change the file's heading. Confirm the panel updates without reopening it. Open a second Markdown file and confirm the panels stay independent. Record the application version, conversation mode, selected viewer, and results.
6. If routing or precedence fails, stop feature expansion and report that result. Disable or uninstall Reader Markdown to roll back. Standalone documents and preferences are untouched.

If that desktop surface cannot load the local stdio plugin, the documented fallback is [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) in developer mode. This task has not created a tunnel, obtained credentials, or proven account access. A tunnel requires a tunnel ID, runtime key, appropriate Platform tunnel permissions, and developer-mode access in the target workspace. Use the official setup UI to connect the same stdio command. Do not expose Reader's Python filesystem service or use public forwarding as a substitute.

## Boundaries

Each panel reads and subscribes only to the URI supplied by the host. Switching files rejects late reads and serializes subscription changes. Closing a panel removes its notification handler and unsubscribes. Transient read failures preserve the last successful preview. A document switch clears the prior content while the new read is pending.

Same-document anchors work. Images without embedded supported raster data show an unavailable placeholder. Relative Markdown file links use a scoped resolver and the host file-open capability. The resolver requires the host-owned opened-file path, checks lexical containment, then checks canonical paths after resolving symlinks. Targets must remain regular Markdown files within that document’s directory. No base path or grant comes from the app. Absolute filesystem paths, system schemes, queries, and cross-document section anchors report unavailable. HTTP and HTTPS links use the host open-link capability. If it is absent, the viewer reports that limitation. Markdown HTML remains sanitized. Checkboxes stay disabled even when the host advertises a writable document.

The prototype exposes Find, Refresh, and shared display preferences under Settings. Native app features do not carry over automatically. No preference synchronization is promised.

## Link diagnosis and Layout controls

The user reports that the custom Reader viewer opens. The reported failing link's URL and type have not been supplied. A permitted simulated-host check confirms that same-document anchors scroll to a distant heading in both reading layouts. HTTP and HTTPS links issue a host open-link request when that capability is available. Relative Markdown paths can now request host-mediated opening after scoped server validation. Absolute filesystem paths and `file://` links remain unavailable. These checks do not establish that the actual host honors its link-opening request.

The native and local browser interface has two icon buttons under Preview layout: **Single column** (`single`) and **Two-page layout** (`spread`). The embedded Settings gear offers those same choices under **Reading layout**. Two-page layout falls back to one column when the panel is too narrow or short.

## Scoped local-link acceptance

In the real host, open a Markdown file that links to a sibling and a Markdown file
in a child directory. Confirm that clicking each opens it through the host. Confirm
that `../outside.md` and a symlink to a file outside the opened directory are refused.
If the host does not advertise file opening or supply opened-file metadata, Reader
reports the limitation and makes no file-open request. A linked file never adds a
Reader filesystem grant. The host still owns final access and opening policy.
Resolution and host opening are separate operations, so Reader cannot bind them to
one atomic filesystem operation. This prototype does not defend against concurrent
filesystem replacement between those operations.

The SDK documents the `getResourcePath(extra._meta)` scope pattern and
`extensions.files.open(path)` in its pinned package README. Branding uses the
[documented interface fields](https://developers.openai.com/plugins/build/plugins).
Actual host metadata, routing, and icon display remain unobserved. Same-thread
Back/Forward remains pending because the SDK exposes no complete history API.
