import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { OpenAIExtensions, type OpenAIUiToolMetadata } from "@openai/mcp-extensions/server";
import { z } from "zod";

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
await server.connect(new StdioServerTransport());
