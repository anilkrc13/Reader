import { App } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions, OpenAIFileEntrypointInputSchema } from "@openai/mcp-extensions/app";
import { DocumentSession } from "./session.js";

declare global {
  interface Window {
    readerEmbedded: {
      loading(name: string): void;
      show(text: string, file: {name: string; resourceUri: string}): void;
      preferences(values?: Record<string, unknown>): Record<string, unknown>;
      find(): void; settings(): void; error(message: string): void;
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
// Host theme is never saved as a reading preference.
const key = "reader.chatgpt.reading.v1";
try { const {theme: _savedTheme, ...display} = JSON.parse(localStorage.getItem(key) || "{}"); reader.preferences(display); }
catch { /* keep validated defaults when storage is unavailable or malformed */ }
window.addEventListener("reader-embedded-preferences-changed", () => {
  try { localStorage.setItem(key, JSON.stringify(reader.preferences())); } catch { /* keep this panel's choices in memory */ }
});
function followHostTheme() {
  const theme = app.getHostContext()?.theme;
  if (theme === "light" || theme === "dark") reader.preferences({theme});
}
app.addEventListener("hostcontextchanged", followHostTheme);

const toolbar = document.getElementById("toolbar")!;
function iconButton(label: string, source: string, action: () => void, parent: HTMLElement = toolbar) {
  const node = document.createElement("button");
  node.type = "button"; node.className = "icon-btn embedded-control";
  node.title = label; node.setAttribute("aria-label", label);
  node.append(document.querySelector(source)!.cloneNode(true));
  node.addEventListener("click", action); parent.append(node);
  return node;
}
iconButton("Find", "#findbar > svg", () => reader.find());
iconButton("Refresh", "#btn-refresh svg", () => void session?.refresh());

// Reuse Reader's own settings tabs and controls. Local-only sections explain their limits.
const settings = document.getElementById("settings")!;
const themeRow = settings.querySelector('[data-set="theme"]')!.closest(".set-row")!;
themeRow.querySelector(".set-label span")!.textContent = "Light and dark mode follow Codex. Choose a page tone below.";
themeRow.querySelector(".set-control")!.textContent = "Follows Codex";
for (const key of ["glass", "side"]) settings.querySelector(`[data-set="${key}"]`)!.closest(".set-row")!.remove();
settings.querySelector('[data-set="uiScale"]')!.closest(".set-row")!.querySelector(".set-label span")!.textContent = "Size of Reader's toolbar and this settings panel. Document text has its own size on the Reading page.";
const notices: Record<string, string> = {
  editor: "Editing settings are unavailable here because this viewer is read only. Use the Mac app to edit documents. Code-block typography is available under Code.",
  files: "Files, disk watching, and app updates belong to local Reader. This panel has no folder browser or save access. The host supplies the document and live updates; Refresh reads it again.",
  about: `Reader ${__READER_VERSION__}. This is the read-only conversation viewer. Native installation paths and update controls belong to the Mac app.`,
};
for (const [category, notice] of Object.entries(notices)) {
  const panel = settings.querySelector(`[data-panel="${category}"]`)!;
  const group = document.createElement("div"); group.className = "group";
  const note = document.createElement("p"); note.className = "embedded-settings-note"; note.textContent = notice;
  group.append(note); panel.replaceChildren(group);
}
// Keep only the native shortcut rows that this viewer implements.
const shortcuts = settings.querySelector('[data-panel="keys"]')!;
for (const row of Array.from(shortcuts.querySelectorAll("tr"))) {
  if (!["Scroll the document", "Find in the document", "Next / previous match", "Settings"].includes(row.querySelector("td")!.textContent!)) row.remove();
}
for (const group of Array.from(shortcuts.querySelectorAll(".group"))) if (!group.querySelector("tr")) group.remove();
const layoutRow = document.createElement("div"); layoutRow.className = "set-row";
const layoutLabel = document.createElement("div"); layoutLabel.className = "set-label";
const layoutTitle = document.createElement("b"); layoutTitle.textContent = "Reading layout";
const layoutNote = document.createElement("span"); layoutNote.textContent = "Two-page layout uses one column in small panels.";
layoutLabel.append(layoutTitle, layoutNote);
const layoutControls = document.createElement("div"); layoutControls.className = "set-control";
layoutControls.append(document.getElementById("preview-layout")!);
layoutRow.append(layoutLabel, layoutControls);
settings.querySelector('[data-panel="reading"] .group')!.append(layoutRow);
const reset = document.getElementById("btn-reset")!;
settings.querySelector(".set-head")!.insertBefore(reset, document.getElementById("set-close"));
iconButton("Settings", "#btn-settings svg", () => reader.settings()).setAttribute("aria-haspopup", "dialog");
try {
  await app.connect();
  connected = true;
  followHostTheme();
  if (!stopped) {
    if (!extensions.resources) reader.error("This host does not support file resources. Open the file in Reader locally.");
    else {
      session ??= new DocumentSession(extensions.resources, reader.show, reader.error);
      if (pending) session.open(pending);
    }
  }
} catch { reader.error("Reader could not connect to the host."); }
