# WebMCP in two pieces

WebMCP lets a live web page publish named actions to an AI agent using the same
page and signed-in session. The page registers a tool; a compatible browser
discovers it and calls it.

## Inside the page

```js
if (typeof document.modelContext?.registerTool === "function") {
  await document.modelContext.registerTool({
    name: "get_page_title",
    description: "Read the current page title.",
    inputSchema: {type: "object", properties: {}, additionalProperties: false},
    annotations: {readOnlyHint: true},
    execute: async () => ({title: document.title}),
  });
}
```

## Outside caller

```js
// `tools` is the registry discovered by the browser or captured by a test harness.
const result = await tools.get_page_title.execute({});
console.log(result.title);
```

In normal use, Codex's built-in browser handles discovery and invocation. The
outside example shows the equivalent deterministic test call. Unlike an MCP
server, a WebMCP tool belongs to the open page and disappears when that page is
closed or replaced.

Source: [OpenAI WebMCP documentation](https://learn.chatgpt.com/docs/webmcp)
