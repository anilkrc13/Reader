import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { OpenAIExtensions, type OpenAIUiToolMetadata } from "@openai/mcp-extensions/server";
import { z } from "zod";
import { resolveLocalLink } from "./local-links.js";

const uri = "ui://reader/markdown";
const html = await readFile(new URL("./viewer.html", import.meta.url), "utf8");
const server = new McpServer({name: "Reader Markdown viewer", version: __READER_VERSION__});
new OpenAIExtensions(server);
registerAppResource(server, "Reader", uri, {}, async () => ({contents: [{
  uri, mimeType: RESOURCE_MIME_TYPE, text: html,
  _meta: {ui: {csp: {connectDomains: [], resourceDomains: ["data:"]}}},
}]}));
registerAppTool(server, "reader_view_markdown", {
  title: "Read Markdown in Reader", description: "Read a host-provided Markdown file in the conversation side panel.",
  inputSchema: {file: z.object({name: z.string().min(1), resourceUri: z.string().trim().min(1)})},
  annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
  _meta: {
    ui: {resourceUri: uri, visibility: ["app"]},
    "openai/ui": {entrypoints: [{type: "file", extensions: [".md"]}]} satisfies OpenAIUiToolMetadata,
  },
}, async () => ({content: []}));
registerAppTool(server, "reader_resolve_local_link", {
  title: "Resolve a related Markdown link",
  description: "Validate a relative Markdown link inside the host-opened document's directory. Returns only app metadata for host-mediated opening; never reads or writes document contents.",
  inputSchema: {href: z.string().min(1).max(4096)},
  annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
  _meta: {ui: {visibility: ["app"]}},
}, async ({href}, extra) => {
  try {
    const path = await resolveLocalLink(href, extra._meta);
    return {content: [], _meta: {"reader/local-link": {path}}};
  } catch {
    // Do not disclose filesystem paths or distinguish existence outside the scope.
    return {isError: true, content: [{type: "text", text: "This local link is unavailable. It needs host-owned opened-file context and a Markdown target inside that document's directory."}]};
  }
});
await server.connect(new StdioServerTransport());
