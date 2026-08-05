/* ===========================================================================
   Markdown Viewer — front end
   Sections: settings model · api · rendering · files · watching · recents ·
             tree · modes · settings dialog · keyboard · boot
   ======================================================================== */
(() => {
"use strict";

const TOKEN = new URLSearchParams(location.search).get("t") || "";
const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const STORE = "mdview.v2";
const OLD_STORE = "mdview.v1";

const el = {
  tree: $("tree"),
  locLabel: $("loc-label"), locName: $("loc-name"), btnUp: $("btn-up"),
  editor: $("editor"), preview: $("preview"),
  previewpane: $("previewpane"),
  docname: $("docname"), dirty: $("dirty"), toast: $("toast"),
  save: $("btn-save"), footnote: $("footnote"),
  back: $("btn-back"), fwd: $("btn-fwd"), fmtbar: $("fmtbar"),
  dragbar: $("dragbar"), diskbar: $("diskbar"), diskmsg: null,
  recents: $("recentlist"), recentsCount: $("recents-count"),
  recentsToggle: $("recents-toggle"),
  pinned: $("pinnedlist"), pinnedToggle: $("pinned-toggle"), pinnedSec: $("pinned"),
  scrim: $("scrim"), dialog: $("settings"), setTitle: $("set-title"),
  menu: $("ctxmenu"), sidebarEl: $("sidebar"),
};
el.diskmsg = el.diskbar.querySelector(".grow");

/* ==========================================================================
   1. Settings model
   ======================================================================== */

const DEFAULTS = {
  /* appearance */
  theme: "auto", accent: "clay", paper: "cream", paperDark: "ink", side: "left",
  /* reading */
  bodyFont: "lora", headFont: "poppins",
  fontSize: 16.5, lineHeight: 1.75, measure: 65, paraGap: 1.1,
  /* code */
  codeTheme: "brand", monoFont: "system", codeScale: 0.82, codeWrap: false,
  /* editor */
  editorFont: "mono", editorSize: 13.5, tabSize: 2,
  spellcheck: false, syncScroll: true, wordCount: true,
  /* files and watching */
  recentCount: 10, autoRefresh: true, watchMs: 2000, watchToast: true,
  showAllDirs: false, glass: false,
};

/* session state that is persisted but is not a "setting" (Reset keeps these) */
const SESSION_DEFAULTS = {
  mode: "preview", hidden: false, width: 288,
  rootDir: null, lastFile: null,
  recents: [], recentsOpen: true,
  pinned: null, pinnedOpen: true,   // null = not seeded yet
};

const NUMERIC = new Set(["fontSize", "lineHeight", "measure", "paraGap", "codeScale",
                         "editorSize", "tabSize", "recentCount", "watchMs", "width"]);

/* Line width is a percentage of the reading pane, so it follows the window
   instead of pinning prose to one pixel width. No readability ceiling: the
   percentage is the percentage, and how wide is the reader's call. */
const MEASURE = {min: 30, max: 100, step: 5};
const LEGACY_MEASURE = {min: 520, max: 1240};   // the pixel range used before 2.0

const ACCENTS = {
  clay:  {label: "Clay",  light: "#d97757", dark: "#e18a6b"},
  blue:  {label: "Blue",  light: "#5b8dc0", dark: "#8ab4dd"},
  green: {label: "Green", light: "#6d8152", dark: "#9db47c"},
  ink:   {label: "Ink",   light: "#141413", dark: "#e8e6dc"},
};

const SANS_SYSTEM = '-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif';
const MONO_SYSTEM = 'ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace';

const BODY_FONTS = [
  ["lora", "Lora — serif", 'Lora,Georgia,serif'],
  ["sourceserif", "Source Serif 4 — serif", '"Source Serif 4",Georgia,serif'],
  ["georgia", "Georgia — system serif", 'Georgia,"Times New Roman",serif'],
  ["inter", "Inter — sans", 'Inter,' + SANS_SYSTEM],
  ["poppins", "Poppins — sans", 'Poppins,' + SANS_SYSTEM],
  ["system", "System sans", SANS_SYSTEM],
];
const HEAD_FONTS = [
  ["poppins", "Poppins", 'Poppins,' + SANS_SYSTEM],
  ["inter", "Inter", 'Inter,' + SANS_SYSTEM],
  ["lora", "Lora", 'Lora,Georgia,serif'],
  ["sourceserif", "Source Serif 4", '"Source Serif 4",Georgia,serif'],
  ["system", "System sans", SANS_SYSTEM],
  ["match", "Match body text", null],
];
const MONO_FONTS = [
  ["system", "System monospace", MONO_SYSTEM],
  ["jetbrains", "JetBrains Mono", '"JetBrains Mono",' + MONO_SYSTEM],
];

const PRESETS = {
  compact:     {fontSize: 15,   lineHeight: 1.55, measure: 60, paraGap: 0.85},
  comfortable: {fontSize: 16.5, lineHeight: 1.75, measure: 65, paraGap: 1.1},
  focus:       {fontSize: 19,   lineHeight: 1.9,  measure: 55, paraGap: 1.35},
};

const S = Object.assign({}, DEFAULTS, SESSION_DEFAULTS);

const state = {
  root: null, file: null, saved: "",
  expanded: new Set(), children: new Map(),
  dirty: false, polling: false, diskSeen: null, lastFocus: null,
  /* documents visited this session, and where we are in that trail. Deliberately
     not persisted: like a browser window, closing it forgets the trail. */
  trail: [], trailAt: -1,
};

const TRAIL_MAX = 100;

/* Record a document the user navigated to. Anything ahead of the current
   position is dropped, so opening a document after going back replaces the
   forward trail rather than branching -- the behaviour a browser has. */
function trailPush(path) {
  if (state.trail[state.trailAt] === path) return;      // re-opening the same doc
  state.trail.splice(state.trailAt + 1);
  state.trail.push(path);
  if (state.trail.length > TRAIL_MAX) state.trail.shift();
  state.trailAt = state.trail.length - 1;
  syncTrailButtons();
}

function syncTrailButtons() {
  el.back.disabled = state.trailAt <= 0;
  el.fwd.disabled = state.trailAt < 0 || state.trailAt >= state.trail.length - 1;
}

async function trailGo(delta) {
  const next = state.trailAt + delta;
  if (next < 0 || next >= state.trail.length) return;
  /* Move only if the document actually opens. A file deleted since it was
     visited, or a discard prompt the user cancels, would otherwise leave the
     position pointing somewhere the reader is not. */
  if (await openFile(state.trail[next], {record: false})) {
    state.trailAt = next;
    syncTrailButtons();
  }
}

/* Before 2.0 the line width was a pixel value from a 520-1240 slider, so any
   stored number above 100 is one of those and is mapped onto the percentage
   range. Both load paths call this, since either can be the one that runs. */
function migrateMeasure() {
  if (!(S.measure > MEASURE.max)) return;
  const px = Math.min(Math.max(S.measure, LEGACY_MEASURE.min), LEGACY_MEASURE.max);
  const span = (MEASURE.max - MEASURE.min) / (LEGACY_MEASURE.max - LEGACY_MEASURE.min);
  const pct = MEASURE.min + (px - LEGACY_MEASURE.min) * span;
  S.measure = Math.round(pct / MEASURE.step) * MEASURE.step;
}

function loadPrefs() {
  let raw = null;
  try { raw = localStorage.getItem(STORE) || localStorage.getItem(OLD_STORE); } catch (_) {}
  if (!raw) return;
  let saved;
  try { saved = JSON.parse(raw); } catch (_) { return; }
  for (const key of Object.keys(S)) {
    if (saved[key] !== undefined && saved[key] !== null) S[key] = saved[key];
  }
  /* migrate the v1 key names */
  if (saved.file && !saved.lastFile) S.lastFile = saved.file;
  if (saved.root && !saved.rootDir) S.rootDir = saved.root;
  if (!Array.isArray(S.recents)) S.recents = [];
  migrateMeasure();
}
/* Preferences live on disk beside the app so they survive restarts even when
   the server lands on a different port (which would otherwise give the page a
   new origin and an empty localStorage). localStorage is kept as a cache, so
   the theme can be applied before the first paint. */
let prefsTimer = null;
function savePrefs() {
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (_) {}
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    api("/api/prefs", {method: "POST", body: S}).catch(() => {});
  }, 400);
}

async function loadServerPrefs() {
  let remote;
  try { remote = await api("/api/prefs"); }
  catch (_) { return; }
  if (!remote || typeof remote !== "object" || !Object.keys(remote).length) {
    savePrefs();                       // first run: seed the file
    return;
  }
  for (const key of Object.keys(S)) {
    if (remote[key] !== undefined && remote[key] !== null) S[key] = remote[key];
  }
  if (!Array.isArray(S.recents)) S.recents = [];
  migrateMeasure();
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (_) {}
}

const fontStack = (list, key) => (list.find((f) => f[0] === key) || list[0])[2];

/* Pick whichever of ink or white actually contrasts better against the accent,
   by WCAG relative luminance — not by eye and not by a guessed threshold. */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function readableOn(hex) {
  const bg = luminance(hex);
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return ratio(bg, luminance("#141413")) >= ratio(bg, luminance("#ffffff"))
    ? "#141413" : "#ffffff";
}

const mq = window.matchMedia("(prefers-color-scheme: dark)");
const resolvedTheme = () => (S.theme === "auto" ? (mq.matches ? "dark" : "light") : S.theme);

function applySettings() {
  const st = root.style;
  const dark = resolvedTheme() === "dark";

  root.dataset.themepref = S.theme;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.paper = S.paper;
  root.dataset.paperDark = S.paperDark;
  root.dataset.code = S.codeTheme;
  root.dataset.side = S.side;
  root.dataset.mode = S.mode;
  root.dataset.sidebar = S.hidden ? "hidden" : "shown";
  root.dataset.wordcount = S.wordCount ? "on" : "off";
  root.dataset.glass = S.glass ? "on" : "off";
  root.dataset.recents = S.recentCount > 0 ? "on" : "off";

  const accent = (ACCENTS[S.accent] || ACCENTS.clay)[dark ? "dark" : "light"];
  st.setProperty("--accent", accent);
  st.setProperty("--accent-on", readableOn(accent));

  const body = fontStack(BODY_FONTS, S.bodyFont);
  st.setProperty("--font-body", body);
  st.setProperty("--font-head", S.headFont === "match" ? body : fontStack(HEAD_FONTS, S.headFont));
  const mono = fontStack(MONO_FONTS, S.monoFont);
  st.setProperty("--font-mono", mono);
  st.setProperty("--font-editor", S.editorFont === "body" ? body : mono);

  st.setProperty("--fs-body", S.fontSize + "px");
  st.setProperty("--lh-body", String(S.lineHeight));
  st.setProperty("--measure", S.measure + "%");
  st.setProperty("--para-gap", S.paraGap + "em");
  st.setProperty("--fs-code", S.codeScale + "em");
  st.setProperty("--fs-editor", S.editorSize + "px");
  st.setProperty("--tab-size", String(S.tabSize));
  st.setProperty("--code-wrap", S.codeWrap ? "pre-wrap" : "pre");
  st.setProperty("--sidebar-w", S.width + "px");

  el.editor.spellcheck = !!S.spellcheck && (!state.file || state.file.kind === "md");
  restartWatch();
}
mq.addEventListener("change", () => { if (S.theme === "auto") applySettings(); });

/* ==========================================================================
   2. Server API
   ======================================================================== */

async function api(path, {method = "GET", body = null, query = {}} = {}) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(path + (qs ? "?" + qs : ""), {
    method,
    headers: Object.assign({"X-Reader-Token": TOKEN},
                           body ? {"Content-Type": "application/json"} : {}),
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || `request failed (${res.status})`);
  return data;
}
/* the session cookie authorises this; the token is only a fallback */
const rawURL = (p) =>
  "/api/raw?" + new URLSearchParams(TOKEN ? {path: p, t: TOKEN} : {path: p});

let toastTimer = null;
function toast(msg, isError = false) {
  el.toast.textContent = msg;
  el.toast.classList.toggle("err", isError);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, isError ? 4200 : 1700);
}

/* ==========================================================================
   3. Rendering
   ======================================================================== */

marked.use({gfm: true, breaks: false});

function slugify(text, seen) {
  const base = text.toLowerCase().trim()
    .replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-") || "section";
  let slug = base, n = 1;
  while (seen.has(slug)) slug = `${base}-${++n}`;
  seen.add(slug);
  return slug;
}

function absolutise(ref, dir) {
  if (ref.startsWith("/")) return ref;
  const parts = dir.split("/").filter(Boolean);
  for (const seg of decodeURI(ref).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

const MD_EXT = new Set(["md", "markdown", "mdown", "mkd", "mdx", "mdc"]);
const LANG_BY_EXT = {
  py: "python", js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", jsx: "javascript", json: "json",
  yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini", cfg: "ini", conf: "ini",
  env: "ini", sh: "bash", bash: "bash", zsh: "bash", sql: "sql",
  css: "css", scss: "scss", less: "less", html: "xml", htm: "xml", xml: "xml",
  go: "go", rs: "rust", java: "java", rb: "ruby", php: "php", swift: "swift",
  kt: "kotlin", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp",
  cs: "csharp", lua: "lua", txt: "plaintext",
};
function kindOf(path) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (path.indexOf(".") < 0) return "code";
  if (MD_EXT.has(ext)) return "md";
  if (ext === "pdf") return "pdf";
  if (ext === "csv" || ext === "tsv") return "csv";
  return "code";
}
const extOf = (path) => (path.split(".").pop() || "").toLowerCase();

function render(text) {
  const kind = state.file ? state.file.kind : "md";
  if (kind === "code") return renderCode(text);
  if (kind === "csv") return renderCSV(text);
  el.preview.className = "prose";
  const html = DOMPurify.sanitize(marked.parse(text || ""), {
    ADD_ATTR: ["target", "rel", "align", "start", "colspan", "rowspan"],
    FORBID_TAGS: ["style", "form", "iframe", "object", "embed"],
    ALLOW_DATA_ATTR: false,
  });
  el.preview.innerHTML = html;

  const dir = state.file ? state.file.dir : "";
  const seen = new Set();

  el.preview.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
    h.id = slugify(h.textContent, seen);
  });
  el.preview.querySelectorAll("img[src]").forEach((img) => {
    const src = img.getAttribute("src");
    if (!src || EXTERNAL.test(src) || src.startsWith("//")) return;
    img.src = rawURL(absolutise(src, dir));
    img.loading = "lazy";
  });
  el.preview.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    if (EXTERNAL.test(href) || href.startsWith("//")) {
      a.target = "_blank"; a.rel = "noopener noreferrer";
      return;
    }
    a.dataset.local = absolutise(href.split("#")[0], dir);
  });
  el.preview.querySelectorAll("li > input[type=checkbox]").forEach((box) => {
    box.disabled = true;
    box.parentElement.classList.add("task-list-item");
    const list = box.parentElement.parentElement;
    if (list) list.classList.add("contains-task-list");
  });
  el.preview.querySelectorAll("pre code").forEach((block) => {
    try { hljs.highlightElement(block); } catch (_) {}
  });
  listifyCells(el.preview);

  const words = (text.replace(/`{3}[\s\S]*?`{3}/g, " ").match(/\S+/g) || []).length;
  el.footnote.textContent = state.file ? `${words.toLocaleString()} words` : "";
}

/* A markdown table row is one line, so a real list cannot be written inside a
   cell. Authors fake one with <br> and a bullet character, which renders as
   plain lines: no bullet glyph for - or *, no hanging indent, and a wrapped
   line falls back under the marker instead of aligning with the text. This
   turns such a cell back into a real list so it gets all three.

   Only the display is changed. The markdown on disk is untouched, so the file
   still reads the same way in any other tool. */
const CELL_BULLET = /^(?:[•‣▪·]|[-*+](?=\s))\s*/;
const EXPLICIT_BULLET = /^[•‣▪·]/;

function listifyCells(scope) {
  scope.querySelectorAll("td,th").forEach((cell) => {
    const items = cell.innerHTML.split(/<br\s*\/?>/i)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length || !items.every((s) => CELL_BULLET.test(s))) return;
    /* A bullet character is unambiguous. A lone dash is more often prose
       ("- 5 degrees"), so a dash needs a second line before it counts. */
    if (items.length < 2 && !items.every((s) => EXPLICIT_BULLET.test(s))) return;

    const ul = document.createElement("ul");
    ul.className = "cell-list";
    for (const item of items) {
      const li = document.createElement("li");
      /* Re-sanitise: the fragments were split out of sanitised HTML by regex,
         and reassembling them should not be what reintroduces markup. */
      li.innerHTML = DOMPurify.sanitize(item.replace(CELL_BULLET, ""));
      ul.appendChild(li);
    }
    cell.replaceChildren(ul);
  });
}

function renderCode(text) {
  el.preview.className = "prose codeview";
  el.preview.innerHTML =
    '<div class="codegrid"><pre class="gutter" aria-hidden="true"></pre>' +
    '<pre class="codebody"><code></code></pre></div>';
  const lines = text.length ? text.split("\n").length : 1;
  el.preview.querySelector(".gutter").textContent =
    Array.from({length: lines}, (_, i) => i + 1).join("\n");
  const block = el.preview.querySelector("code");
  const lang = LANG_BY_EXT[extOf(state.file.path)];
  if (lang) block.className = "language-" + lang;
  block.textContent = text;
  try { hljs.highlightElement(block); } catch (_) {}
  el.footnote.textContent = `${lines.toLocaleString()} lines`;
}

/* small, correct CSV reader: quoted fields, embedded commas and newlines */
function parseDSV(text, delim) {
  const rows = [[""]];
  let field = 0, inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const row = rows[rows.length - 1];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { row[field] += '"'; i++; }
        else inQ = false;
      } else row[field] += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(""); field++; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      rows.push([""]); field = 0;
    } else row[field] += ch;
  }
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
  return rows;
}

const CSV_ROW_CAP = 2000;

function renderCSV(text) {
  el.preview.className = "prose tableview";
  el.preview.innerHTML = "";
  const rows = parseDSV(text, extOf(state.file.path) === "tsv" ? "\t" : ",");
  const table = document.createElement("table");
  rows.slice(0, CSV_ROW_CAP).forEach((cells, i) => {
    const tr = document.createElement("tr");
    for (const cell of cells) {
      const td = document.createElement(i === 0 ? "th" : "td");
      td.textContent = cell;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  });
  el.preview.appendChild(table);
  if (rows.length > CSV_ROW_CAP) {
    const note = document.createElement("p");
    note.className = "csv-note";
    note.textContent = `Showing the first ${CSV_ROW_CAP.toLocaleString()} of ${rows.length.toLocaleString()} rows — switch to Edit to see everything.`;
    el.preview.appendChild(note);
  }
  el.footnote.textContent = `${rows.length.toLocaleString()} rows`;
}

function renderPDF() {
  el.preview.className = "prose";
  el.preview.innerHTML = "";
  const frame = document.createElement("iframe");
  frame.className = "pdfframe";
  frame.title = state.file.name;
  frame.src = "/api/doc?" + new URLSearchParams(
    TOKEN ? {path: state.file.path, v: state.file.mtime, t: TOKEN}
          : {path: state.file.path, v: state.file.mtime});
  el.previewpane.querySelector(".pdfframe")?.remove();
  el.previewpane.appendChild(frame);
  el.preview.style.display = "none";
  el.footnote.textContent = "PDF";
}
function clearPDF() {
  el.previewpane.querySelector(".pdfframe")?.remove();
  el.preview.style.display = "";
}

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => render(el.editor.value), 110);
}

/* ==========================================================================
   4. Files
   ======================================================================== */

const maxScroll = (n) => Math.max(1, n.scrollHeight - n.clientHeight);
const scrollRatio = (n) => n.scrollTop / maxScroll(n);

function setDirty(on) {
  state.dirty = on;
  el.dirty.hidden = !on;
  el.save.disabled = !on;
  document.title = (on ? "• " : "") + (state.file ? state.file.name : "Reader");
}

function hideDiskBar() {
  el.diskbar.hidden = true;
  el.diskmsg.textContent = "This file changed on disk while you were editing.";
}

/* Returns the opened path, or null if nothing was opened -- the trail relies on
   knowing the difference. `record` is false for reloads of the current document
   and for trail navigation itself, neither of which is a new visit. */
async function openFile(path, {keepScroll = false, silent = false, record = true} = {}) {
  if (!silent && state.dirty && !confirm("Discard unsaved changes?")) return null;
  const kind = kindOf(path);

  if (kind === "pdf") {
    let info;
    try { info = await api("/api/stat", {query: {path}}); }
    catch (err) { toast(err.message, true); return null; }
    state.file = {path, kind: "pdf",
                  name: path.split("/").pop(),
                  dir: path.split("/").slice(0, -1).join("/") || "/",
                  mtime: info.mtime};
    state.saved = "";
    state.diskSeen = info.mtime;
    el.editor.value = "";
    el.docname.textContent = state.file.name;
    root.dataset.empty = "no";
    root.dataset.doc = "pdf";
    setDirty(false);
    hideDiskBar();
    renderPDF();
    S.lastFile = path;
    pushRecent(state.file);
    savePrefs();
    markActive();
    restartWatch();
    if (!silent) revealInTree(path);
    if (record) trailPush(state.file.path);
    return state.file.path;
  }

  const pRatio = keepScroll ? scrollRatio(el.previewpane) : 0;
  const eRatio = keepScroll ? scrollRatio(el.editor) : 0;
  const caret = keepScroll ? el.editor.selectionStart : 0;

  let data;
  try { data = await api("/api/file", {query: {path}}); }
  catch (err) { toast(err.message, true); return null; }

  clearPDF();
  root.dataset.doc = kind;
  state.file = {path: data.path, name: data.name, dir: data.dir, mtime: data.mtime, kind};
  state.saved = data.text;
  state.diskSeen = data.mtime;
  el.editor.value = data.text;
  el.docname.textContent = data.name;
  root.dataset.empty = "no";
  setDirty(false);
  hideDiskBar();
  render(data.text);

  el.previewpane.scrollTop = keepScroll ? pRatio * maxScroll(el.previewpane) : 0;
  el.editor.scrollTop = keepScroll ? eRatio * maxScroll(el.editor) : 0;
  if (keepScroll) el.editor.setSelectionRange(caret, caret);

  S.lastFile = data.path;
  pushRecent(state.file);
  savePrefs();
  markActive();
  restartWatch();
  if (!silent) revealInTree(data.path);
  if (record) trailPush(data.path);
  return data.path;
}

async function saveFile() {
  if (!state.file || !state.dirty) return;
  try {
    const res = await api("/api/save", {
      method: "POST",
      body: {path: state.file.path, text: el.editor.value, mtime: state.file.mtime},
    });
    state.file.mtime = res.mtime;
    state.diskSeen = res.mtime;
    state.saved = el.editor.value;
    setDirty(false);
    hideDiskBar();
    toast("Saved");
  } catch (err) {
    if (/changed on disk/i.test(err.message)) {
      if (confirm("This file changed on disk since you opened it.\n\nOverwrite it with your version?")) {
        const res = await api("/api/save", {
          method: "POST", body: {path: state.file.path, text: el.editor.value},
        }).catch((e) => { toast(e.message, true); return null; });
        if (res) {
          state.file.mtime = res.mtime;
          state.diskSeen = res.mtime;
          state.saved = el.editor.value;
          setDirty(false);
          hideDiskBar();
          toast("Saved");
        }
      }
      return;
    }
    toast(err.message, true);
  }
}

async function refresh() {
  if (!state.file) { await refreshTree(); return; }
  if (state.dirty && !confirm("Reload from disk and discard unsaved changes?")) return;
  setDirty(false);
  await openFile(state.file.path, {keepScroll: true, silent: true, record: false});
  await refreshTree();
  toast("Reloaded");
}

async function refreshTree() {
  state.children.clear();
  await drawTree();
}

/* ==========================================================================
   5. Watching the open document
   ======================================================================== */

let watchTimer = null;

function restartWatch() {
  clearInterval(watchTimer);
  watchTimer = null;
  const on = !!(S.autoRefresh && state.file);
  root.dataset.watch = on ? "on" : "off";
  if (on) watchTimer = setInterval(pollOpenFile, Math.max(500, S.watchMs));
}

async function pollOpenFile() {
  if (document.hidden || state.polling || !state.file) return;
  state.polling = true;
  try {
    const info = await api("/api/stat", {query: {path: state.file.path}});
    if (info.mtime === state.file.mtime || info.mtime === state.diskSeen) return;
    if (state.file.kind === "pdf") {
      state.file.mtime = info.mtime;
      state.diskSeen = info.mtime;
      renderPDF();
      if (S.watchToast) toast("Refreshed from disk");
      return;
    }
    if (state.dirty) {
      state.diskSeen = info.mtime;
      el.diskbar.hidden = false;
      return;
    }
    await openFile(state.file.path, {keepScroll: true, silent: true, record: false});
    if (S.watchToast) toast("Refreshed from disk");
  } catch (err) {
    if (/no such/i.test(err.message)) {
      el.diskmsg.textContent = "This file is no longer on disk.";
      el.diskbar.hidden = false;
      clearInterval(watchTimer);
      watchTimer = null;
      root.dataset.watch = "off";
    }
  } finally {
    state.polling = false;
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) pollOpenFile();
});
$("disk-reload").onclick = async () => {
  setDirty(false);
  hideDiskBar();
  await openFile(state.file.path, {keepScroll: true, silent: true, record: false});
  toast("Reloaded from disk");
};
$("disk-keep").onclick = hideDiskBar;

/* ==========================================================================
   6a. Pinned folders
   ======================================================================== */

const FOLDER_SVG =
  '<svg class="fi" viewBox="0 0 16 16"><path d="M1.8 4.2A1.2 1.2 0 0 1 3 3h2.9l1.4 1.7h5.7A1.2 1.2 0 0 1 14.2 6v6a1.2 1.2 0 0 1-1.2 1.2H3A1.2 1.2 0 0 1 1.8 12z"/></svg>';
const FILE_SVG =
  '<svg class="fi" viewBox="0 0 16 16"><path d="M3.6 2.6h5.2L12.4 6v7.4H3.6z"/><path d="M8.7 2.7V6h3.5"/></svg>';
const KIND_SVG = {
  md: FILE_SVG,
  code: '<svg class="fi" viewBox="0 0 16 16"><path d="M6.2 5.2 3.4 8l2.8 2.8M9.8 5.2 12.6 8l-2.8 2.8"/></svg>',
  csv: '<svg class="fi" viewBox="0 0 16 16"><rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.2"/><path d="M2.6 6.4h10.8M6.2 6.4v6.2M9.8 6.4v6.2"/></svg>',
  pdf: '<svg class="fi" viewBox="0 0 16 16"><path d="M3.6 2.6h5.2L12.4 6v7.4H3.6z"/><path d="M8.7 2.7V6h3.5M5.6 9.4h4.8M5.6 11.4h3"/></svg>',
};
const iconFor = (path) => KIND_SVG[kindOf(path)] || FILE_SVG;
const CLOSE_SVG = '<svg viewBox="0 0 16 16"><path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2"/></svg>';

const prettyName = (p) => p.split("/").filter(Boolean).pop() || "/";
let defaultPins = [];

function drawPinned() {
  const items = S.pinned || [];
  el.pinned.hidden = !S.pinnedOpen;
  el.pinnedToggle.setAttribute("aria-expanded", String(!!S.pinnedOpen));
  el.pinnedToggle.querySelector(".caret").classList.toggle("open", !!S.pinnedOpen);
  el.pinned.innerHTML = "";
  if (!items.length) {
    el.pinned.innerHTML =
      '<li class="sec-empty">Browse to a folder, then press + to keep it here.</li>';
    return;
  }
  items.forEach((p, i) => {
    const li = document.createElement("li");
    li.dataset.index = String(i);
    const b = document.createElement("button");
    b.className = "row" + (state.root === p.path ? " current" : "");
    b.dataset.path = p.path;
    b.dataset.type = "dir";
    b.draggable = true;
    b.title = p.path + " — drag to reorder";
    b.innerHTML = FOLDER_SVG + '<span class="nm"></span>';
    b.querySelector(".nm").textContent = p.name;
    const x = document.createElement("button");
    x.className = "rowact";
    x.dataset.unpin = p.path;
    x.title = "Unpin " + p.name;
    x.setAttribute("aria-label", "Unpin " + p.name);
    x.innerHTML = CLOSE_SVG;
    li.append(b, x);
    el.pinned.appendChild(li);
  });
}

/* ---- drag: reorder pins, or drop a folder from the tree to pin it ------- */

const DIR_MIME = "application/x-reader-dir";
let dragPinFrom = null;

el.pinned.addEventListener("dragstart", (ev) => {
  const row = ev.target.closest(".row[data-path]");
  if (!row) return;
  dragPinFrom = Number(row.closest("li").dataset.index);
  ev.dataTransfer.effectAllowed = "move";
  ev.dataTransfer.setData("text/plain", row.dataset.path);
  row.classList.add("dragging");
});
el.pinned.addEventListener("dragend", () => {
  dragPinFrom = null;
  clearPinDropMarks();
  el.pinnedSec.classList.remove("droptarget");
});

function clearPinDropMarks() {
  el.pinned.querySelectorAll(".drop-above,.drop-below").forEach((n) =>
    n.classList.remove("drop-above", "drop-below"));
  el.pinned.querySelectorAll(".dragging").forEach((n) => n.classList.remove("dragging"));
}

function pinDropIndex(ev) {
  const li = ev.target.closest("#pinnedlist li[data-index]");
  if (!li) return (S.pinned || []).length;
  const r = li.getBoundingClientRect();
  const idx = Number(li.dataset.index);
  return ev.clientY < r.top + r.height / 2 ? idx : idx + 1;
}

el.pinnedSec.addEventListener("dragover", (ev) => {
  const external = [...ev.dataTransfer.types].includes(DIR_MIME);
  if (dragPinFrom === null && !external) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = dragPinFrom !== null ? "move" : "copy";
  clearPinDropMarks();
  if (dragPinFrom !== null) {
    const row = el.pinned.querySelector(`li[data-index="${dragPinFrom}"] .row`);
    if (row) row.classList.add("dragging");
  }
  const idx = pinDropIndex(ev);
  const lis = el.pinned.querySelectorAll("li[data-index]");
  if (!lis.length) { el.pinnedSec.classList.add("droptarget"); return; }
  if (idx >= lis.length) lis[lis.length - 1].classList.add("drop-below");
  else lis[idx].classList.add("drop-above");
});
el.pinnedSec.addEventListener("dragleave", (ev) => {
  if (!el.pinnedSec.contains(ev.relatedTarget)) {
    clearPinDropMarks();
    el.pinnedSec.classList.remove("droptarget");
  }
});
el.pinnedSec.addEventListener("drop", (ev) => {
  const external = ev.dataTransfer.getData(DIR_MIME);
  if (dragPinFrom === null && !external) return;
  ev.preventDefault();
  let idx = pinDropIndex(ev);
  const list = (S.pinned || []).slice();
  if (dragPinFrom !== null) {
    const [moved] = list.splice(dragPinFrom, 1);
    if (idx > dragPinFrom) idx -= 1;
    list.splice(Math.max(0, Math.min(idx, list.length)), 0, moved);
    S.pinned = list;
  } else {
    const path = external;
    if (list.some((q) => q.path === path)) { toast("Already pinned"); }
    else {
      list.splice(Math.max(0, Math.min(idx, list.length)), 0,
                  {name: prettyName(path), path});
      S.pinned = list;
      toast("Pinned " + prettyName(path));
    }
  }
  dragPinFrom = null;
  clearPinDropMarks();
  el.pinnedSec.classList.remove("droptarget");
  savePrefs();
  drawPinned();
});

function pinFolder(path, name) {
  const list = S.pinned || [];
  if (list.some((p) => p.path === path)) { toast("Already pinned"); return; }
  list.push({name: name || prettyName(path), path});
  S.pinned = list;
  savePrefs();
  drawPinned();
  toast("Pinned " + (name || prettyName(path)));
}

el.pinned.addEventListener("click", (ev) => {
  const x = ev.target.closest("[data-unpin]");
  if (x) {
    S.pinned = (S.pinned || []).filter((p) => p.path !== x.dataset.unpin);
    savePrefs();
    drawPinned();
    return;
  }
  const b = ev.target.closest(".row");
  if (b) setRoot(b.dataset.path);
});
el.pinnedToggle.onclick = () => { S.pinnedOpen = !S.pinnedOpen; savePrefs(); drawPinned(); };
$("btn-pin").onclick = () => {
  if (!state.root) return;
  if ((S.pinned || []).some((q) => q.path === state.root)) {
    toast(prettyName(state.root) + " is already pinned — drag any folder here, or use a folder's ⋯ menu");
    return;
  }
  pinFolder(state.root, prettyName(state.root));
};

/* ==========================================================================
   6. Recently opened
   ======================================================================== */

function pushRecent(file) {
  const list = (S.recents || []).filter((r) => r.path !== file.path);
  list.unshift({path: file.path, name: file.name, dir: file.dir});
  S.recents = list.slice(0, 50);
  drawRecents();
}

function drawRecents() {
  const limit = S.recentCount || 0;
  const items = (S.recents || []).slice(0, limit);
  el.recentsCount.textContent = items.length ? String(items.length) : "";
  el.recents.hidden = !S.recentsOpen;
  el.recentsToggle.setAttribute("aria-expanded", String(!!S.recentsOpen));
  el.recentsToggle.querySelector(".caret").classList.toggle("open", !!S.recentsOpen);
  el.recents.innerHTML = "";
  if (!items.length) {
    el.recents.innerHTML = '<li class="sec-empty">Nothing opened yet</li>';
    return;
  }
  for (const r of items) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "row";
    b.dataset.path = r.path;
    b.title = r.path;
    b.innerHTML = iconFor(r.path) + '<span class="nm"></span><span class="sub"></span>';
    b.querySelector(".nm").textContent = r.name;
    b.querySelector(".sub").textContent = prettyName(r.dir);
    li.appendChild(b);
    el.recents.appendChild(li);
  }
  markActive();
}

el.recents.addEventListener("click", (ev) => {
  const b = ev.target.closest(".row");
  if (b) openFile(b.dataset.path);
});
el.recentsToggle.onclick = () => { S.recentsOpen = !S.recentsOpen; savePrefs(); drawRecents(); };

/* ==========================================================================
   7. File tree
   ======================================================================== */

const ICONS = {
  caret: '<svg class="caret" viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
  spacer: '<span class="caret"></span>',
  folder: '<svg class="fi" viewBox="0 0 16 16"><path d="M1.8 4.2A1.2 1.2 0 0 1 3 3h2.9l1.4 1.7h5.7A1.2 1.2 0 0 1 14.2 6v6a1.2 1.2 0 0 1-1.2 1.2H3A1.2 1.2 0 0 1 1.8 12z"/></svg>',
  file: '<svg class="fi" viewBox="0 0 16 16"><path d="M3.6 2.6h5.2L12.4 6v7.4H3.6z"/><path d="M8.7 2.7V6h3.5"/></svg>',
  trash: '<svg viewBox="0 0 16 16"><path d="M2.8 4.3h10.4M6.4 4.3V3.2a.7.7 0 0 1 .7-.7h1.8a.7.7 0 0 1 .7.7v1.1"/><path d="M4.1 4.3l.6 8.2a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.6-8.2"/></svg>',
  kebab: '<svg viewBox="0 0 16 16"><circle cx="8" cy="3.4" r="1.15" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none"/><circle cx="8" cy="12.6" r="1.15" fill="currentColor" stroke="none"/></svg>',
  pencil: '<svg viewBox="0 0 16 16"><path d="M10.7 2.7 13.3 5.3 5.8 12.8H3.2v-2.6z"/><path d="M9.3 4.1 11.9 6.7"/></svg>',
};

const listQuery = (path) => (S.showAllDirs ? {path, all: "1"} : {path});

async function childrenOf(path) {
  if (state.children.has(path)) return state.children.get(path);
  const data = await api("/api/list", {query: listQuery(path)});
  state.children.set(path, data.entries);
  return data.entries;
}

function makeRow(entry, depth) {
  const li = document.createElement("li");
  li.setAttribute("role", "treeitem");
  const line = document.createElement("div");
  line.className = "rowline";
  const btn = document.createElement("button");
  btn.className = "row";
  btn.dataset.path = entry.path;
  btn.dataset.type = entry.type;
  btn.title = entry.path;
  const isDir = entry.type === "dir";
  btn.innerHTML = (isDir ? ICONS.caret : ICONS.spacer) +
                  (isDir ? ICONS.folder : iconFor(entry.path)) + '<span class="nm"></span>';
  btn.querySelector(".nm").textContent = entry.name;
  if (isDir) btn.draggable = true;
  const more = document.createElement("button");
  more.className = "rowact";
  more.dataset.menu = entry.path;
  more.dataset.kind = entry.type;
  more.title = "Actions for " + entry.name;
  more.setAttribute("aria-label", more.title);
  more.setAttribute("aria-haspopup", "menu");
  more.innerHTML = ICONS.kebab;
  line.append(btn, more);
  li.appendChild(line);
  if (isDir) {
    const kids = document.createElement("ul");
    kids.setAttribute("role", "group");
    kids.hidden = true;
    li.appendChild(kids);
    if (state.expanded.has(entry.path)) expand(li, entry.path, depth);
  }
  return li;
}

async function expand(li, path, depth) {
  li.querySelector(".caret").classList.add("open");
  const kids = li.querySelector("ul");
  kids.hidden = false;
  if (kids.dataset.loaded) return;
  kids.innerHTML = '<li class="msg">Loading…</li>';
  try {
    const entries = await childrenOf(path);
    kids.innerHTML = "";
    if (!entries.length) kids.innerHTML = '<li class="msg">Empty</li>';
    for (const e of entries) kids.appendChild(makeRow(e, depth + 1));
    kids.dataset.loaded = "1";
    markActive();
  } catch (err) {
    kids.innerHTML = '<li class="msg"></li>';
    kids.firstChild.textContent = err.message;
  }
}

/* ------------------------------------------------------- row action menu */

function closeMenu() {
  el.menu.hidden = true;
  el.menu.innerHTML = "";
}

function openRowMenu(anchor, path, kind) {
  const isDir = kind === "dir";
  el.menu.innerHTML = "";

  const add = (icon, label, act, danger = false) => {
    const b = document.createElement("button");
    b.className = "menu-item" + (danger ? " danger" : "");
    b.setAttribute("role", "menuitem");
    b.innerHTML = icon + "<span></span>";
    b.querySelector("span").textContent = label;
    b.onclick = () => { closeMenu(); act(); };
    el.menu.appendChild(b);
  };
  const sep = () => {
    const d = document.createElement("div");
    d.className = "menu-sep";
    el.menu.appendChild(d);
  };

  if (isDir) {
    add(ICONS.folder, "Browse from here", () => setRoot(path));
    add('<svg viewBox="0 0 16 16"><path d="M8 3.2v9.6M3.2 8h9.6"/></svg>', "Pin this folder",
        () => pinFolder(path, prettyName(path)));
    sep();
    add(ICONS.pencil, "Rename…", () => openRenamer(path, kind));
    /* no delete for folders — too much can disappear in one click */
  } else {
    add(ICONS.file, "Open", () => openFile(path));
    sep();
    add(ICONS.pencil, "Rename…", () => openRenamer(path, kind));
    sep();
    add(ICONS.trash, "Move to Trash…", () => askDelete(path), true);
  }

  el.menu.hidden = false;
  const rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
  let x = rect ? rect.right - el.menu.offsetWidth : anchor.x;
  let y = rect ? rect.bottom + 5 : anchor.y;
  x = Math.max(8, Math.min(x, window.innerWidth - el.menu.offsetWidth - 8));
  if (y + el.menu.offsetHeight > window.innerHeight - 8) {
    y = (rect ? rect.top : anchor.y) - el.menu.offsetHeight - 5;
  }
  el.menu.style.left = x + "px";
  el.menu.style.top = y + "px";
  const first = el.menu.querySelector(".menu-item");
  if (first) first.focus();
}

window.addEventListener("mousedown", (ev) => {
  if (!el.menu.hidden && !el.menu.contains(ev.target)) closeMenu();
});
window.addEventListener("blur", closeMenu);
el.tree.addEventListener("scroll", closeMenu, {passive: true});

/* ------------------------------------------------------------------ rename */

const renEls = {
  scrim: $("renamer"), body: $("rn-body"), input: $("rn-input"),
  ok: $("rn-ok"), cancel: $("rn-cancel"),
};
let pendingRename = null;
const renamerOpen = () => !renEls.scrim.hidden;

function openRenamer(path, kind) {
  const name = path.split("/").filter(Boolean).pop() || path;
  pendingRename = {path, kind, name};
  renEls.body.innerHTML = "";
  const strong = document.createElement("b");
  strong.textContent = name;
  renEls.body.append("Give ", strong, " a new name.");
  renEls.input.value = name;
  state.lastFocus = document.activeElement;
  renEls.scrim.hidden = false;
  renEls.input.focus();
  const stem = kind === "dir" ? name.length : name.lastIndexOf(".");
  renEls.input.setSelectionRange(0, stem > 0 ? stem : name.length);
}

function closeRenamer() {
  renEls.scrim.hidden = true;
  pendingRename = null;
  if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
}

async function doRename() {
  if (!pendingRename) return;
  const {path, name} = pendingRename;
  const wanted = renEls.input.value.trim();
  if (!wanted || wanted === name) { closeRenamer(); return; }

  renEls.ok.disabled = true;
  let res;
  try { res = await api("/api/rename", {method: "POST", body: {path, name: wanted}}); }
  catch (err) {
    renEls.ok.disabled = false;
    toast(err.message, true);
    renEls.input.focus();
    renEls.input.select();
    return;
  }
  renEls.ok.disabled = false;
  closeRenamer();

  const from = res.path, to = res.newPath;
  const moved = (p) => (p === from ? to : p.startsWith(from + "/") ? to + p.slice(from.length) : p);

  S.recents = (S.recents || []).map((r) => {
    const np = moved(r.path);
    return np === r.path ? r
      : {path: np, name: np.split("/").pop(), dir: np.split("/").slice(0, -1).join("/") || "/"};
  });
  S.pinned = (S.pinned || []).map((pin) =>
    moved(pin.path) === pin.path ? pin : {name: prettyName(moved(pin.path)), path: moved(pin.path)});
  state.expanded = new Set([...state.expanded].map(moved));

  if (state.root && moved(state.root) !== state.root) {
    state.root = moved(state.root);
    S.rootDir = state.root;
    drawLoc();
  }
  if (state.file && moved(state.file.path) !== state.file.path) {
    state.file.path = moved(state.file.path);
    state.file.dir = state.file.path.split("/").slice(0, -1).join("/") || "/";
    state.file.name = state.file.path.split("/").pop();
    el.docname.textContent = state.file.name;
    document.title = (state.dirty ? "• " : "") + state.file.name;
    S.lastFile = state.file.path;
  }
  savePrefs();
  drawPinned();
  drawRecents();
  await refreshTree();
  markActive();
  toast("Renamed to " + res.name);
}

renEls.cancel.onclick = closeRenamer;
renEls.ok.onclick = doRename;
renEls.input.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") { ev.preventDefault(); doRename(); }
});
renEls.scrim.addEventListener("mousedown", (ev) => {
  if (ev.target === renEls.scrim) closeRenamer();
});

/* ---------------------------------------------------- delete to the Trash */

const confirmEls = {
  scrim: $("confirm"), title: $("cf-title"), body: $("cf-body"),
  path: $("cf-path"), note: $("cf-note"), ok: $("cf-ok"), cancel: $("cf-cancel"),
};
let pendingDelete = null;

function askDelete(path) {
  const name = path.split("/").filter(Boolean).pop() || path;
  confirmEls.title.textContent = "Move this file to the Trash?";
  confirmEls.body.innerHTML = "";
  const strong = document.createElement("b");
  strong.textContent = name;
  confirmEls.body.append(strong, " will be removed from this folder.");
  confirmEls.path.textContent = path;
  pendingDelete = {path, name};
  state.lastFocus = document.activeElement;
  confirmEls.scrim.hidden = false;
  confirmEls.cancel.focus();
}

function closeConfirm() {
  confirmEls.scrim.hidden = true;
  pendingDelete = null;
  if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
}

async function doDelete() {
  if (!pendingDelete) return;
  const {path, name} = pendingDelete;
  confirmEls.ok.disabled = true;
  try {
    await api("/api/delete", {method: "POST", body: {path}});
  } catch (err) {
    confirmEls.ok.disabled = false;
    closeConfirm();
    toast(err.message, true);
    return;
  }
  confirmEls.ok.disabled = false;
  closeConfirm();

  const under = (p) => p === path || p.startsWith(path + "/");
  S.recents = (S.recents || []).filter((r) => !under(r.path));
  S.pinned = (S.pinned || []).filter((p) => !under(p.path));
  state.expanded = new Set([...state.expanded].filter((p) => !under(p)));

  if (state.file && under(state.file.path)) {
    state.file = null;
    state.saved = "";
    el.editor.value = "";
    clearPDF();
    root.dataset.doc = "md";
    el.preview.innerHTML = "";
    el.docname.textContent = "No document open";
    el.footnote.textContent = "";
    root.dataset.empty = "yes";
    setDirty(false);
    hideDiskBar();
    S.lastFile = null;
    restartWatch();
  }
  savePrefs();
  drawPinned();
  drawRecents();

  if (under(state.root)) await setRoot(state.root.split("/").slice(0, -1).join("/") || "/");
  else await refreshTree();
  toast(`${name} moved to the Trash`);
}

confirmEls.cancel.onclick = closeConfirm;
confirmEls.ok.onclick = doDelete;
confirmEls.scrim.addEventListener("mousedown", (ev) => {
  if (ev.target === confirmEls.scrim) closeConfirm();
});
const confirmOpen = () => !confirmEls.scrim.hidden;

function collapse(li, path) {
  li.querySelector(".caret").classList.remove("open");
  li.querySelector("ul").hidden = true;
  state.expanded.delete(path);
}

async function drawTree() {
  el.tree.innerHTML = '<li class="msg">Loading…</li>';
  let entries;
  try { entries = await childrenOf(state.root); }
  catch (err) {
    el.tree.innerHTML = '<li class="msg"></li>';
    el.tree.firstChild.textContent = err.message;
    return;
  }
  el.tree.innerHTML = "";
  if (!entries.length) el.tree.innerHTML = '<li class="msg">Nothing to read in this folder</li>';
  for (const e of entries) el.tree.appendChild(makeRow(e, 0));
  markActive();
}

function markActive() {
  const p = state.file && state.file.path;
  document.querySelectorAll("#tree .row, #recentlist .row").forEach((r) => {
    r.classList.toggle("active", !!p && r.dataset.path === p && r.dataset.type !== "dir");
  });
}

async function revealInTree(filePath) {
  if (!state.root || !filePath.startsWith(state.root + "/")) return;
  const rest = filePath.slice(state.root.length + 1).split("/");
  rest.pop();
  let acc = state.root;
  for (const seg of rest) { acc += "/" + seg; state.expanded.add(acc); }
  if (rest.length) await drawTree();
  const node = el.tree.querySelector(`.row[data-path="${CSS.escape(filePath)}"]`);
  if (node) node.scrollIntoView({block: "nearest"});
  markActive();
}

async function setRoot(path, {redraw = true} = {}) {
  let info;
  try { info = await api("/api/list", {query: listQuery(path)}); }
  catch (err) { toast(err.message, true); return; }
  state.root = info.path;
  state.children.set(info.path, info.entries);
  S.rootDir = info.path;
  savePrefs();
  drawLoc();
  drawPinned();
  if (redraw) await drawTree();
}

let HOME = "/";
function friendlyName(path) {
  if (path === HOME) return "Home";
  if (path === "/") return "This Mac";
  return path.split("/").filter(Boolean).pop() || path;
}

function drawLoc() {
  el.locLabel.textContent = friendlyName(state.root);
  el.locName.title = "Enclosing folders";
  el.btnUp.disabled = state.root === "/";
  el.btnUp.dataset.parent = state.root === "/" ? ""
    : state.root.split("/").slice(0, -1).join("/") || "/";
}

/* Finder's title menu: the current folder, then everything enclosing it */
function openLocMenu() {
  el.menu.innerHTML = "";
  const chain = [];
  let p = state.root;
  while (true) {
    chain.push(p);
    if (p === "/") break;
    p = p.split("/").slice(0, -1).join("/") || "/";
  }
  chain.forEach((path, i) => {
    const b = document.createElement("button");
    b.className = "menu-item";
    b.setAttribute("role", "menuitem");
    b.innerHTML = ICONS.folder.replace('class="fi"', "") + "<span></span>";
    b.querySelector("span").textContent = friendlyName(path);
    if (i === 0) {
      const here = document.createElement("span");
      here.className = "mi-here";
      here.textContent = "current";
      b.appendChild(here);
    }
    b.onclick = () => { closeMenu(); if (i > 0) setRoot(path); };
    el.menu.appendChild(b);
  });
  el.menu.hidden = false;
  const rect = el.locName.getBoundingClientRect();
  let x = Math.max(8, Math.min(rect.left, window.innerWidth - el.menu.offsetWidth - 8));
  let y = rect.bottom + 5;
  if (y + el.menu.offsetHeight > window.innerHeight - 8) y = rect.top - el.menu.offsetHeight - 5;
  el.menu.style.left = x + "px";
  el.menu.style.top = y + "px";
  const first = el.menu.querySelector(".menu-item");
  if (first) first.focus();
}

/* ==========================================================================
   8. Scroll sync and view modes
   ======================================================================== */

let syncing = null;
function linkScroll(from, to) {
  from.addEventListener("scroll", () => {
    if (!S.syncScroll || root.dataset.mode !== "split" || syncing === to) return;
    syncing = from;
    to.scrollTop = scrollRatio(from) * maxScroll(to);
    requestAnimationFrame(() => { syncing = null; });
  }, {passive: true});
}
linkScroll(el.editor, el.previewpane);
linkScroll(el.previewpane, el.editor);

function setMode(mode) {
  if (state.file && state.file.kind === "pdf" && mode !== "preview") return;
  S.mode = mode;
  root.dataset.mode = mode;
  savePrefs();
  hideFmtBar();
  if (mode !== "preview") setTimeout(() => el.editor.focus(), 0);
}
function toggleSidebar(force) {
  S.hidden = force !== undefined ? force : !S.hidden;
  root.dataset.sidebar = S.hidden ? "hidden" : "shown";
  root.classList.remove("peek");
  savePrefs();
}
function cycleTheme() {
  const order = ["auto", "light", "dark"];
  S.theme = order[(order.indexOf(S.theme) + 1) % 3];
  applySettings();
  savePrefs();
  syncDialog();
  $("btn-theme").title = "Appearance: " + (S.theme === "auto" ? "match system" : S.theme);
  toast(S.theme === "auto" ? "Appearance: match system" : "Appearance: " + S.theme);
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else root.requestFullscreen().catch((e) => toast(e.message, true));
}
document.addEventListener("fullscreenchange", () => {
  root.dataset.full = document.fullscreenElement ? "on" : "off";
});

/* ==========================================================================
   9. Settings dialog
   ======================================================================== */

const CAT_TITLES = {
  appearance: "Appearance", reading: "Reading", code: "Code", editor: "Editor",
  files: "Files & watching", keys: "Keyboard shortcuts", about: "About",
};

function fillSelect(node, list, extra) {
  node.innerHTML = "";
  for (const [value, label] of (extra || list)) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    node.appendChild(o);
  }
}
fillSelect($("sel-body"), BODY_FONTS);
fillSelect($("sel-head"), HEAD_FONTS);
fillSelect($("sel-mono"), MONO_FONTS);

/* accent swatches */
(() => {
  const wrap = $("accent-swatches");
  for (const [key, def] of Object.entries(ACCENTS)) {
    const b = document.createElement("button");
    b.className = "swatch";
    b.dataset.value = key;
    b.title = def.label;
    b.setAttribute("aria-label", "Accent: " + def.label);
    b.setAttribute("aria-pressed", "false");
    b.style.background = def.light;
    wrap.appendChild(b);
  }
})();

function labelFor(key, v) {
  switch (key) {
    case "fontSize": case "editorSize": return v + " px";
    case "lineHeight": return v.toFixed(2);
    case "measure": return v >= MEASURE.max ? "Full" : v + "%";
    case "paraGap": return v.toFixed(2) + " em";
    case "codeScale": return Math.round(v * 100) + " %";
    default: return String(v);
  }
}

function setValue(key, value) {
  S[key] = NUMERIC.has(key) ? Number(value) : value;
  applySettings();
  savePrefs();
  syncDialog();
  if (key === "recentCount") drawRecents();
  if (key === "watchMs" || key === "autoRefresh") restartWatch();
  if (key === "showAllDirs") refreshTree();
}

/* reflect current settings into every control in the dialog */
function syncDialog() {
  document.querySelectorAll(".pills[data-set]").forEach((group) => {
    const key = group.dataset.set;
    group.querySelectorAll(".pill").forEach((p) => {
      p.setAttribute("aria-pressed", String(String(S[key]) === p.dataset.value));
    });
  });
  const darkNow = resolvedTheme() === "dark";
  document.querySelectorAll(".swatches[data-set]").forEach((group) => {
    const key = group.dataset.set;
    group.querySelectorAll(".swatch").forEach((p) => {
      p.setAttribute("aria-pressed", String(S[key] === p.dataset.value));
      /* show the colour you will actually get in the current scheme */
      const def = ACCENTS[p.dataset.value];
      if (def) p.style.background = darkNow ? def.dark : def.light;
    });
  });
  document.querySelectorAll("select[data-set]").forEach((sel) => {
    sel.value = String(S[sel.dataset.set]);
  });
  document.querySelectorAll('input[type=range][data-set]').forEach((r) => {
    const key = r.dataset.set;
    r.value = String(S[key]);
    const out = document.querySelector(`.val[data-val="${key}"]`);
    if (out) out.textContent = labelFor(key, Number(S[key]));
  });
  document.querySelectorAll(".switch[data-set]").forEach((sw) => {
    sw.setAttribute("aria-checked", String(!!S[sw.dataset.set]));
  });
  const presets = document.querySelector("[data-preset]");
  if (presets) {
    presets.querySelectorAll(".pill").forEach((p) => {
      const preset = PRESETS[p.dataset.value];
      const match = Object.keys(preset).every((k) => Number(S[k]) === preset[k]);
      p.setAttribute("aria-pressed", String(match));
    });
  }
  $("btn-theme").title = "Appearance: " + (S.theme === "auto" ? "match system" : S.theme);
}

/* control wiring (delegated, so it survives re-renders) */
el.dialog.addEventListener("click", (ev) => {
  const pill = ev.target.closest(".pill");
  if (pill) {
    const preset = pill.closest("[data-preset]");
    if (preset) {
      Object.assign(S, PRESETS[pill.dataset.value]);
      applySettings(); savePrefs(); syncDialog();
      return;
    }
    setValue(pill.closest(".pills").dataset.set, pill.dataset.value);
    return;
  }
  const swatch = ev.target.closest(".swatch");
  if (swatch) { setValue(swatch.closest(".swatches").dataset.set, swatch.dataset.value); return; }

  const sw = ev.target.closest(".switch[data-set]");
  if (sw) { setValue(sw.dataset.set, !S[sw.dataset.set]); return; }

  const cat = ev.target.closest(".cat");
  if (cat) { showCategory(cat.dataset.cat); return; }
});
el.dialog.addEventListener("input", (ev) => {
  const r = ev.target.closest("input[type=range][data-set]");
  if (r) { setValue(r.dataset.set, r.value); return; }
  const sel = ev.target.closest("select[data-set]");
  if (sel) setValue(sel.dataset.set, sel.value);
});

function showCategory(name) {
  el.dialog.querySelectorAll(".cat").forEach((c) => {
    c.setAttribute("aria-selected", String(c.dataset.cat === name));
  });
  el.dialog.querySelectorAll(".panel").forEach((p) => {
    p.hidden = p.dataset.panel !== name;
  });
  el.setTitle.textContent = CAT_TITLES[name] || "Settings";
  el.dialog.querySelector(".set-scroll").scrollTop = 0;
}

function openSettings() {
  state.lastFocus = document.activeElement;
  syncDialog();
  el.scrim.hidden = false;
  const first = el.dialog.querySelector('.cat[aria-selected="true"]') || el.dialog.querySelector(".cat");
  if (first) first.focus();
}
function closeSettings() {
  el.scrim.hidden = true;
  if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
}
const settingsOpen = () => !el.scrim.hidden;

$("btn-settings").onclick = openSettings;
$("set-close").onclick = closeSettings;
el.scrim.addEventListener("mousedown", (ev) => { if (ev.target === el.scrim) closeSettings(); });
$("btn-reset-pins").onclick = () => {
  S.pinned = defaultPins.slice(0, 3);
  savePrefs();
  drawPinned();
  toast("Pinned folders restored");
};
$("btn-clear-recents").onclick = () => {
  S.recents = [];
  savePrefs();
  drawRecents();
  toast("Recent files cleared");
};
$("btn-reset").onclick = () => {
  if (!confirm("Reset every setting to its default?\n\nYour recent files and the folder you are browsing are kept.")) return;
  Object.assign(S, DEFAULTS);
  applySettings();
  savePrefs();
  syncDialog();
  drawRecents();
  toast("Settings reset");
};

/* keep focus inside the dialog while it is open */
el.dialog.addEventListener("keydown", (ev) => {
  if (ev.key !== "Tab") return;
  const items = [...el.dialog.querySelectorAll(
    'button, select, input, [tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
});

/* ==========================================================================
   10. Wiring
   ======================================================================== */

el.tree.addEventListener("click", async (ev) => {
  const more = ev.target.closest("[data-menu]");
  if (more) { openRowMenu(more, more.dataset.menu, more.dataset.kind); return; }
  const btn = ev.target.closest(".row");
  if (!btn) return;
  const {path, type} = btn.dataset;
  if (type === "file") { openFile(path); return; }
  const li = btn.closest("li");
  if (state.expanded.has(path)) collapse(li, path);
  else { state.expanded.add(path); await expand(li, path, 0); }
});
el.tree.addEventListener("dblclick", (ev) => {
  const btn = ev.target.closest('.row[data-type="dir"]');
  if (btn) setRoot(btn.dataset.path);
});
el.tree.addEventListener("dragstart", (ev) => {
  const btn = ev.target.closest('.row[data-type="dir"]');
  if (!btn) return;
  ev.dataTransfer.setData(DIR_MIME, btn.dataset.path);
  ev.dataTransfer.setData("text/plain", btn.dataset.path);
  ev.dataTransfer.effectAllowed = "copy";
});
el.tree.addEventListener("contextmenu", (ev) => {
  const btn = ev.target.closest("#tree .row");
  if (!btn) return;
  ev.preventDefault();
  openRowMenu({x: ev.clientX, y: ev.clientY}, btn.dataset.path, btn.dataset.type);
});

el.preview.addEventListener("click", (ev) => {
  const a = ev.target.closest("a");
  if (!a) return;
  const href = a.getAttribute("href") || "";
  if (href.startsWith("#")) {
    ev.preventDefault();
    const target = el.preview.querySelector("#" + CSS.escape(href.slice(1)));
    if (target) target.scrollIntoView({behavior: "smooth", block: "start"});
    return;
  }
  if (a.dataset.local) { ev.preventDefault(); openFile(a.dataset.local); }
});

el.editor.addEventListener("input", () => {
  setDirty(el.editor.value !== state.saved);
  scheduleRender();
});
el.editor.addEventListener("keydown", (ev) => {
  if (ev.key !== "Tab" || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  ev.preventDefault();
  const {selectionStart: s, selectionEnd: e} = el.editor;
  el.editor.setRangeText(" ".repeat(S.tabSize), s, e, "end");
  el.editor.dispatchEvent(new Event("input"));
});

el.locName.onclick = () => (el.menu.hidden ? openLocMenu() : closeMenu());
el.btnUp.onclick = () => { if (el.btnUp.dataset.parent) setRoot(el.btnUp.dataset.parent); };

document.querySelectorAll("#toolbar .seg").forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
$("btn-save").onclick = saveFile;
$("btn-refresh").onclick = refresh;
$("btn-theme").onclick = cycleTheme;
$("btn-full").onclick = toggleFullscreen;
$("btn-hide").onclick = () => toggleSidebar(true);
$("btn-show").onclick = () => toggleSidebar(false);

el.back.addEventListener("click", () => trailGo(-1));
el.fwd.addEventListener("click", () => trailGo(1));

/* Is the user typing, or working inside a dialog? Bare arrow keys belong to the
   caret and to native controls in those cases, so the trail must not claim them. */
function editingText() {
  const a = document.activeElement;
  if (!a || a === document.body) return false;
  return a.isContentEditable || /^(input|textarea|select)$/i.test(a.tagName);
}

function overlayOpen() {
  return !el.menu.hidden || renamerOpen() || confirmOpen() || settingsOpen();
}

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !el.fmtbar.hidden) { ev.preventDefault(); hideFmtBar(); return; }
  if (ev.key === "Escape" && !el.menu.hidden) { ev.preventDefault(); closeMenu(); return; }
  if (ev.key === "Escape" && renamerOpen()) { ev.preventDefault(); closeRenamer(); return; }
  if (ev.key === "Escape" && confirmOpen()) { ev.preventDefault(); closeConfirm(); return; }
  if (ev.key === "Escape" && settingsOpen()) { ev.preventDefault(); closeSettings(); return; }
  const meta = ev.metaKey || ev.ctrlKey;

  /* Back and forward. Bare arrows while reading; they are left alone when the
     caret owns them or a dialog is up. ⌘[ and ⌘] work everywhere, including in
     the editor -- unlike ⌘←/⌘→, which macOS uses for start and end of line. */
  const arrow = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0;
  if (arrow && !meta && !ev.altKey && !ev.shiftKey && !editingText() && !overlayOpen()) {
    ev.preventDefault(); trailGo(arrow); return;
  }
  if (meta && (ev.key === "[" || ev.key === "]") && !overlayOpen()) {
    ev.preventDefault(); trailGo(ev.key === "[" ? -1 : 1); return;
  }

  if (!meta) return;
  const k = ev.key.toLowerCase();

  /* ⌘B/I/U format a preview selection. Only claimed when there is one to
     format, so the browser keeps these keys the rest of the time. */
  if ("biu".includes(k) && quickEditable() && previewSelection()) {
    ev.preventDefault();
    applyInline(k === "b" ? "bold" : k === "i" ? "italic" : "underline");
    return;
  }

  if (k === ",") { ev.preventDefault(); settingsOpen() ? closeSettings() : openSettings(); }
  else if (k === "s") { ev.preventDefault(); saveFile(); }
  else if (k === "r" && !ev.shiftKey) { ev.preventDefault(); refresh(); }
  else if (k === "e") { ev.preventDefault(); setMode(root.dataset.mode === "edit" ? "preview" : "edit"); }
  else if (k === "\\") { ev.preventDefault(); toggleSidebar(); }
  else if (k === "f" && ev.ctrlKey && ev.metaKey) { ev.preventDefault(); toggleFullscreen(); }
});

/* ==========================================================================
   Quick edit -- format a selection in the preview
   ==========================================================================

   The preview is rendered output, and marked gives us no map back to the
   markdown that produced it. So a selection is located in the source by its
   plain text and its occurrence number within the preview.

   That is only trustworthy when the text occurs the same number of times in
   the preview and in the source. It will not when the source spells it with
   markup the preview has consumed (**word**), or repeats it somewhere the
   preview does not show (a link target, a code fence). In those cases the
   edit is refused and the reader is pointed at Edit mode: quietly formatting
   the wrong copy would corrupt the document, and it would corrupt it
   somewhere the reader is not looking. */

const INLINE_FMT = {
  bold:      {open: "**",  close: "**"},
  italic:    {open: "*",   close: "*"},
  code:      {open: "`",   close: "`"},
  strike:    {open: "~~",  close: "~~"},
  underline: {open: "<u>", close: "</u>"},
};

const BLOCK_TAGS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th";
const HEADING_MARK = /^(\s{0,3})#{1,6}[ \t]+/;

/* Non-overlapping occurrence count, matching how the nth match is found below. */
function countOf(haystack, needle) {
  if (!needle) return 0;
  let n = 0, from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return n;
    n++;
    from = at + needle.length;
  }
}

function nthIndexOf(haystack, needle, n) {
  let at = -1, from = 0;
  for (let i = 0; i <= n; i++) {
    at = haystack.indexOf(needle, from);
    if (at < 0) return -1;
    from = at + needle.length;
  }
  return at;
}

/* Quick edit only makes sense on markdown being previewed: code and CSV are
   rendered from something that is not markdown, and Edit mode has a real caret. */
const quickEditable = () =>
  !!state.file && state.file.kind === "md" && root.dataset.mode !== "edit";

function previewSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.preview.contains(range.commonAncestorContainer)) return null;
  const text = sel.toString();
  if (!text.trim()) return null;
  /* How many identical strings sit before this one, so the same string later in
     the document is not the one we rewrite. */
  const before = document.createRange();
  before.setStart(el.preview, 0);
  before.setEnd(range.startContainer, range.startOffset);
  return {text, range, nth: countOf(before.toString(), text)};
}

function blockOf(range) {
  let node = range.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  return node && node.closest ? node.closest(BLOCK_TAGS) : null;
}

function commitQuickEdit(next) {
  el.editor.value = next;
  setDirty(true);
  render(next);
  hideFmtBar();
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
}

const USE_EDIT_MODE = " Use Edit mode for this one.";

function applyInline(kind) {
  const spec = INLINE_FMT[kind];
  const info = previewSelection();
  if (!spec || !info) return;

  const src = el.editor.value;
  const inSource = countOf(src, info.text);
  if (!inSource) {
    return toast("That text is not in the source as written — the markdown behind it differs." + USE_EDIT_MODE, true);
  }
  if (inSource !== countOf(el.preview.textContent, info.text)) {
    return toast("That text appears a different number of times in the source, so the right copy is ambiguous." + USE_EDIT_MODE, true);
  }
  const at = nthIndexOf(src, info.text, info.nth);
  if (at < 0) {
    return toast("Could not place that selection in the source." + USE_EDIT_MODE, true);
  }

  const end = at + info.text.length;
  const {open, close} = spec;
  /* Already wrapped in exactly this markup? Then the button removes it. */
  const wrapped = src.slice(at - open.length, at) === open &&
                  src.slice(end, end + close.length) === close;
  const next = wrapped
    ? src.slice(0, at - open.length) + info.text + src.slice(end + close.length)
    : src.slice(0, at) + open + info.text + close + src.slice(end);
  commitQuickEdit(next);
}

/* Headings are a property of the whole line, so this rewrites the line's prefix
   rather than wrapping the selection. level 0 clears the heading. */
function applyBlock(level) {
  const info = previewSelection();
  if (!info) return;
  const block = blockOf(info.range);
  if (!block) return;

  const want = block.textContent.trim();
  const lines = el.editor.value.split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    if (line.replace(HEADING_MARK, "").trim() === want) hits.push(i);
  });

  if (!hits.length) {
    return toast("That block does not sit on one line of the source." + USE_EDIT_MODE, true);
  }
  if (hits.length > 1) {
    return toast("More than one line in the source matches that block." + USE_EDIT_MODE, true);
  }

  const i = hits[0];
  const indent = (lines[i].match(HEADING_MARK) || ["", ""])[1];
  const bare = lines[i].replace(HEADING_MARK, "");
  lines[i] = level ? indent + "#".repeat(level) + " " + bare : indent + bare;
  commitQuickEdit(lines.join("\n"));
}

function hideFmtBar() { el.fmtbar.hidden = true; }

function showFmtBar() {
  if (!quickEditable()) return hideFmtBar();
  const info = previewSelection();
  if (!info) return hideFmtBar();
  const r = info.range.getBoundingClientRect();
  if (!r.width && !r.height) return hideFmtBar();

  el.fmtbar.hidden = false;                       // measure only once visible
  const bar = el.fmtbar.getBoundingClientRect();
  const pad = 8;
  const left = Math.max(pad, Math.min(r.left + r.width / 2 - bar.width / 2,
                                      window.innerWidth - bar.width - pad));
  const above = r.top - bar.height - pad;
  el.fmtbar.style.left = left + "px";
  el.fmtbar.style.top = (above < pad ? r.bottom + pad : above) + "px";
}

let fmtTimer = null;
document.addEventListener("selectionchange", () => {
  clearTimeout(fmtTimer);
  fmtTimer = setTimeout(showFmtBar, 90);          // wait for the drag to settle
});

/* Keep the selection alive: focusing a button would collapse it. */
el.fmtbar.addEventListener("mousedown", (ev) => ev.preventDefault());
el.fmtbar.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-fmt]");
  if (!b) return;
  const v = b.dataset.fmt;
  if (v === "body") applyBlock(0);
  else if (/^h[1-6]$/.test(v)) applyBlock(Number(v.slice(1)));
  else applyInline(v);
});

el.previewpane.addEventListener("scroll", hideFmtBar, {passive: true});
window.addEventListener("resize", hideFmtBar);

/* like the Claude app: with the panel hidden, resting on that edge (or the
   reveal button) floats it back over the page until the pointer leaves */
(() => {
  const zone = $("peekzone");
  let hideTimer = null;
  const show = () => {
    if (!S.hidden) return;
    clearTimeout(hideTimer);
    root.classList.add("peek");
  };
  const scheduleHide = (ev) => {
    if (!S.hidden) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => root.classList.remove("peek"), 250);
  };
  zone.addEventListener("mouseenter", show);
  $("btn-show").addEventListener("mouseenter", show);
  el.sidebarEl.addEventListener("mouseenter", show);
  el.sidebarEl.addEventListener("mouseleave", scheduleHide);
  zone.addEventListener("mouseleave", scheduleHide);
  $("btn-show").addEventListener("mouseleave", scheduleHide);
})();

window.addEventListener("beforeunload", (ev) => {
  if (state.dirty) { ev.preventDefault(); ev.returnValue = ""; }
});

/* sidebar resize */
(() => {
  let dragging = false;
  el.dragbar.addEventListener("mousedown", (ev) => {
    dragging = true;
    el.dragbar.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    ev.preventDefault();
  });
  window.addEventListener("mousemove", (ev) => {
    if (!dragging) return;
    const w = S.side === "left" ? ev.clientX : window.innerWidth - ev.clientX;
    S.width = Math.max(190, Math.min(560, w));
    root.style.setProperty("--sidebar-w", S.width + "px");
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    el.dragbar.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    savePrefs();
  });
})();

/* ==========================================================================
   11. Boot
   ======================================================================== */

async function boot() {
  loadPrefs();
  applySettings();
  syncDialog();
  drawRecents();
  root.dataset.empty = "yes";
  root.dataset.full = "off";
  root.dataset.doc = "md";
  showCategory("appearance");
  drawPinned();

  let cfg;
  try { cfg = await api("/api/config"); }
  catch (err) { toast("Cannot reach the app server: " + err.message, true); return; }

  /* on-disk preferences win: they outlive a change of port */
  await loadServerPrefs();
  applySettings();
  syncDialog();
  drawRecents();

  $("about-where").innerHTML =
    `Version ${cfg.version} · running from <code></code>`;
  $("about-where").querySelector("code").textContent = cfg.appDir;

  HOME = cfg.home;

  /* first run: seed the pinned list with the usual suspects */
  defaultPins = cfg.roots.map((r) => ({name: r.name, path: r.path}));
  if (!Array.isArray(S.pinned)) { S.pinned = defaultPins.slice(0, 3); savePrefs(); }
  drawPinned();

  await setRoot(cfg.startFile ? cfg.start : (S.rootDir || cfg.start), {redraw: false});
  if (!state.root) await setRoot(cfg.home, {redraw: false});
  await drawTree();

  const first = cfg.startFile || S.lastFile;
  if (first) { try { await openFile(first); } catch (_) {} }
}

/* small automation hook (same-origin pages only) — used by the test suite */
window.reader = {goto: (p) => setRoot(p), open: (p) => openFile(p)};
window.mdview = window.reader;        // pre-2.0 name; drop once tests are updated

boot();
})();
