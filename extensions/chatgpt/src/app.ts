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
// Host theme is never saved as a reading preference.
const key = "reader.chatgpt.reading.v1";
const readingKeys = ["fontSize", "lineHeight", "measure", "previewLayout"];
const readingOnly = (values: Record<string, unknown>) => Object.fromEntries(readingKeys.map(key => [key, values[key]]));
let prefs: Record<string, unknown> = {};
try { prefs = readingOnly(reader.preferences(readingOnly(JSON.parse(localStorage.getItem(key) || "{}")))); }
catch { prefs = readingOnly(reader.preferences()); }
function change(values: Record<string, unknown>) {
  prefs = readingOnly(reader.preferences({...prefs, ...values}));
  try { localStorage.setItem(key, JSON.stringify(prefs)); } catch { /* keep this panel's in-memory choice */ }
}
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

const settings = document.createElement("dialog");
settings.id = "embedded-reading-settings";
settings.setAttribute("aria-labelledby", "embedded-reading-title");
const header = document.createElement("div"); header.className = "embedded-settings-header";
const title = document.createElement("h2"); title.id = "embedded-reading-title"; title.textContent = "Reading preferences";
header.append(title);
iconButton("Close reading preferences", "#find-close svg", () => settings.close(), header);
settings.append(header);
const controls: Array<() => void> = [];
function range(label: string, key: string, min: number, max: number, step: number, unit: string) {
  const row = document.createElement("label"); row.className = "embedded-setting";
  const name = document.createElement("span"); name.textContent = label;
  const output = document.createElement("output");
  const input = document.createElement("input");
  input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step);
  input.setAttribute("aria-label", label);
  const sync = () => { input.value = String(prefs[key]); output.textContent = input.value + unit; };
  input.addEventListener("input", () => {change({[key]: Number(input.value)}); sync();});
  row.append(name, output, input); settings.append(row); controls.push(sync);
}
range("Text size", "fontSize", 13, 26, .5, " px");
range("Line spacing", "lineHeight", 1.2, 2.2, .05, "×");
range("Content width", "measure", 50, 100, 1, "%");
const layoutLabel = document.createElement("label"); layoutLabel.className = "embedded-setting"; layoutLabel.textContent = "Reading layout";
const layout = document.createElement("select"); layout.setAttribute("aria-label", "Reading layout");
for (const [value, label] of [["single", "Single column"], ["spread", "Two-page layout"]]) {
  const option = document.createElement("option"); option.value = value; option.textContent = label; layout.append(option);
}
layout.addEventListener("change", () => change({previewLayout: layout.value}));
controls.push(() => {layout.value = String(prefs.previewLayout);});
layoutLabel.append(layout); settings.append(layoutLabel);
const note = document.createElement("p"); note.className = "embedded-settings-note";
note.textContent = "Theme follows Codex. Two-page layout uses one column in small panels.";
settings.append(note); document.body.append(settings);
const settingsButton = iconButton("Reading preferences", "#btn-settings svg", () => {
  controls.forEach(sync => sync()); settings.showModal();
});
settingsButton.setAttribute("aria-haspopup", "dialog");
settings.addEventListener("click", event => {if (event.target === settings) {
  const rect = settings.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) settings.close();
}});
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
