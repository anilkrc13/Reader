import { App } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions, OpenAIFileEntrypointInputSchema } from "@openai/mcp-extensions/app";
import { DocumentSession } from "./session.js";

declare global {
  interface Window {
    readerEmbedded: {
      loading(name: string): void;
      show(text: string, file: {name: string; resourceUri: string}): void;
      preferences(values?: Record<string, unknown>): Record<string, unknown>;
      find(): void; error(message: string): void;
    };
    readerEmbeddedHost: {openLink(href: string): Promise<void>};
  }
}
const reader = window.readerEmbedded;
const app = new App({name: "Reader", version: __READER_VERSION__});
const extensions = new OpenAIExtensions(app);
let session: DocumentSession | undefined;
let pending: {name: string; resourceUri: string} | undefined;
let stopped = false;
let connected = false;
let currentUri: string | undefined;
app.addEventListener("toolinput", ({arguments: args}) => {
  if (stopped) return;
  const input = OpenAIFileEntrypointInputSchema.safeParse(args);
  if (!input.success || !/\.md$/i.test(input.data.file.name)) {
    pending = undefined;
    session?.clear();
    currentUri = undefined; reader.loading("Markdown file");
    reader.error("This panel supports Markdown files only."); return;
  }
  pending = input.data.file;
  if (connected && !extensions.resources) {
    reader.error("This host does not support file resources. Open the file in Reader locally.");
    return;
  }
  if (pending.resourceUri !== currentUri) reader.loading(pending.name);
  currentUri = pending.resourceUri;
  if (!session && extensions.resources) session = new DocumentSession(extensions.resources, reader.show, reader.error);
  session?.open(pending);
});
app.onteardown = async () => { stopped = true; await session?.dispose(); return {}; };
window.addEventListener("pagehide", () => { stopped = true; void session?.dispose(); });
window.readerEmbeddedHost = {
  async openLink(href) {
    if (!/^https?:\/\//i.test(href)) { reader.error("This link is unavailable in the embedded viewer."); return; }
    if (!app.getHostCapabilities()?.openLinks) { reader.error("Opening external links is unavailable on this host."); return; }
    try {
      const result = await app.openLink({url: href});
      if (result.isError) throw new Error();
    } catch { reader.error("The host could not open this link."); }
  },
};
// Independent allowlisted preferences. Storage may be denied by the iframe host.
const key = "reader.chatgpt.reading.v1";
let prefs: Record<string, unknown> = {};
try { prefs = reader.preferences(JSON.parse(localStorage.getItem(key) || "{}")); } catch { prefs = reader.preferences(); }
function change(values: Record<string, unknown>) {
  prefs = reader.preferences({...prefs, ...values});
  try { localStorage.setItem(key, JSON.stringify(prefs)); } catch { /* keep this panel's in-memory choice */ }
}
const toolbar = document.getElementById("toolbar")!;
function button(label: string, action: () => void) {
  const node = document.createElement("button");
  node.className = "mini-btn embedded-control"; node.textContent = label;
  node.setAttribute("aria-label", label); node.addEventListener("click", action); toolbar.append(node);
}
button("Find", () => reader.find());
button("Theme", () => change({theme: prefs.theme === "dark" ? "light" : "dark"}));
button("A−", () => change({fontSize: Math.max(13, Number(prefs.fontSize) - 1)}));
button("A+", () => change({fontSize: Math.min(26, Number(prefs.fontSize) + 1)}));
button("Layout", () => change({previewLayout: prefs.previewLayout === "spread" ? "single" : "spread"}));
button("Refresh", () => void session?.refresh());
try {
  await app.connect();
  connected = true;
  if (!stopped) {
    if (!extensions.resources) reader.error("This host does not support file resources. Open the file in Reader locally.");
    else {
      session ??= new DocumentSession(extensions.resources, reader.show, reader.error);
      if (pending) session.open(pending);
    }
  }
} catch { reader.error("Reader could not connect to the host."); }
