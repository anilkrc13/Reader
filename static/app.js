/* ===========================================================================
   Reader — front end
   Sections: settings model · api · rendering · files · watching · recents ·
             tree · modes · settings dialog · keyboard · boot
   ======================================================================== */
(() => {
"use strict";

const TOKEN = new URLSearchParams(location.search).get("t") || "";
const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const STORE = "mdview.v2";        // pre-2.0 key, kept so existing settings survive
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
  findbar: $("findbar"), findQ: $("find-q"), findCount: $("find-count"),
  findPrev: $("find-prev"), findNext: $("find-next"), findClose: $("find-close"),
  sidebar: $("sidebar"),
  fileFind: $("filefind"), fileFindQ: $("filefind-q"),
  fileFindList: $("filefind-list"), fileFindClose: $("filefind-close"),
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
  fontSize: 16.5, bodyWeight: 400, lineHeight: 1.75, measure: 65, paraGap: 1.1, listGap: .32,
  tableBorders: false,
  titleSize: 48, titleWeight: 700, titleLineHeight: 1.08,
  titleSpacing: -.035, titleCapScale: 1, headSizeScale: 1, headCapScale: 1, headWeight: null, headLineHeight: null,
  headSpacing: null, headGap: null, headGapAfter: null,
  /* code */
  codeTheme: "brand", monoFont: "system", codeScale: 0.82, codeWrap: false,
  /* editor */
  editorFont: "mono", editorSize: 13.5, tabSize: 2,
  spellcheck: false, syncScroll: true, wordCount: true,
  /* files and watching */
  recentCount: 10, autoSave: true, autoRefresh: true, watchMs: 2000, watchToast: true,
  showAllDirs: false, showAllFiles: false, showHidden: false, glass: false,
};

/* session state that is persisted but is not a "setting" (Reset keeps these) */
const SESSION_DEFAULTS = {
  mode: "preview", hidden: false, width: 288,
  rootDir: null, lastFile: null,
  recents: [], recentsOpen: true,
  pinned: null, pinnedOpen: true,   // null = not seeded yet
};

const NUMERIC = new Set(["fontSize", "bodyWeight", "lineHeight", "measure", "paraGap", "listGap",
                         "titleSize", "titleWeight", "titleLineHeight", "titleSpacing", "titleCapScale",
                         "headSizeScale", "headCapScale", "headWeight", "headLineHeight", "headSpacing",
                         "headGap", "headGapAfter", "codeScale",
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
  ["figtree", "Figtree — sans", 'Figtree,' + SANS_SYSTEM],
  ["satoshi", "Satoshi — sans", 'Satoshi,' + SANS_SYSTEM],
  ["inter", "Inter — sans", 'Inter,' + SANS_SYSTEM],
  ["poppins", "Poppins — sans", 'Poppins,' + SANS_SYSTEM],
  ["system", "System sans", SANS_SYSTEM],
];
const HEAD_FONTS = [
  ["poppins", "Poppins", 'Poppins,' + SANS_SYSTEM],
  ["figtree", "Figtree", 'Figtree,' + SANS_SYSTEM],
  ["satoshi", "Satoshi", 'Satoshi,' + SANS_SYSTEM],
  ["inter", "Inter", 'Inter,' + SANS_SYSTEM],
  ["ebgaramond", "EB Garamond", '"EB Garamond",Georgia,serif'],
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
  dirty: false, polling: null, diskSeen: null, lastFocus: null,
  documentSession: 0, documentController: null,
  imageGeneration: 0,
  imageMtimes: new Map(),
  mermaidGeneration: 0,
  /* documents visited this session, and where we are in that trail. Deliberately
     not persisted: like a browser window, closing it forgets the trail. */
  trail: [], trailAt: -1,
  /* undo history for the open document, reset when a different one is opened */
  past: [], pastAt: -1,
  /* Which half of the window the reader last acted in, so ⌘F knows whether it
     was asked to search the document or the file panel. Live focus cannot
     answer this: clicking a row redraws the tree, which removes the very
     button that had focus and leaves document.activeElement as <body>. */
  surface: "document",
  /* Headings collapsed in the open document, held by slug. Kept across
     re-renders and reloads of the same file, dropped when another opens. */
  folded: new Set(),
};

const documentIsWritable = () =>
  !!state.file && state.file.kind !== "pdf" && state.file.writable !== false;

const TRAIL_MAX = 100;

/* Undo history for the document text.

   The editor is a plain textarea and has its own native undo, but assigning
   .value in script wipes that stack -- and every quick edit from the preview
   does exactly that. Worse, the textarea cannot even be focused in preview
   mode (it is display:none), so the native stack cannot be reached from where
   quick edits are made. So the document owns its history here instead, and one
   stack covers typing, quick edits, and every mode.

   Typing is folded into one entry per pause rather than one per keystroke,
   which is what makes undo land on a word or a phrase instead of a letter. */
const HISTORY_MAX = 200;
const TYPING_PAUSE_MS = 400;

/* Record a document the user navigated to. Anything ahead of the current
   position is dropped, so opening a document after going back replaces the
   forward trail rather than branching -- the behaviour a browser has. */
function trailPush(path) {
  const here = state.trail[state.trailAt];
  if (here && here.path === path) return;               // re-opening the same doc
  state.trail.splice(state.trailAt + 1);
  state.trail.push({path, top: 0, editorTop: 0, caret: 0});
  if (state.trail.length > TRAIL_MAX) state.trail.shift();
  state.trailAt = state.trail.length - 1;
  syncTrailButtons();
}

/* Record the current position into the trail entry being left behind. Called on
   the way out of a document, while state.file still refers to it -- by the time
   trailPush runs, the incoming document has already taken its place. */
function trailMark() {
  const here = state.trail[state.trailAt];
  if (!here || !state.file || here.path !== state.file.path) return;
  here.top = el.previewpane.scrollTop;
  here.editorTop = el.editor.scrollTop;
  here.caret = el.editor.selectionStart;
}

/* --- undo history ------------------------------------------------------- */

let typingPause = null;

const historyShot = () => ({
  text: el.editor.value,
  start: el.editor.selectionStart,
  end: el.editor.selectionEnd,
});

/* A fresh document starts its own history, with the text on disk as the state
   there is nothing to undo past. */
function historyReset() {
  clearTimeout(typingPause);
  typingPause = null;
  state.past = [historyShot()];
  state.pastAt = 0;
}

function historyPush() {
  const shot = historyShot();
  const here = state.past[state.pastAt];
  /* The caret moving is not an edit, but it is worth remembering where it was. */
  if (here && here.text === shot.text) { state.past[state.pastAt] = shot; return; }
  state.past.splice(state.pastAt + 1);         // redoing past this point is gone
  state.past.push(shot);
  if (state.past.length > HISTORY_MAX) state.past.shift();
  state.pastAt = state.past.length - 1;
}

/* Typing is one entry per pause. Anything that needs the history to be current
   right now -- an undo, or an edit arriving from somewhere else -- settles the
   pending keystrokes first, or they would be skipped straight over. */
function historyNoteTyping() {
  clearTimeout(typingPause);
  typingPause = setTimeout(() => { typingPause = null; historyPush(); }, TYPING_PAUSE_MS);
}

function historySettle() {
  if (!typingPause) return;
  clearTimeout(typingPause);
  typingPause = null;
  historyPush();
}

function historyGo(delta) {
  if (!documentIsWritable()) return;
  historySettle();
  const to = state.pastAt + delta;
  if (to < 0 || to >= state.past.length) return;
  state.pastAt = to;
  const shot = state.past[to];
  el.editor.value = shot.text;
  setDirty(shot.text !== state.saved);         // undoing back to disk is clean again
  render(shot.text);
  hideFmtBar();
  try { el.editor.setSelectionRange(shot.start, shot.end); } catch (_) {}
}

function syncTrailButtons() {
  el.back.disabled = state.trailAt <= 0;
  el.fwd.disabled = state.trailAt < 0 || state.trailAt >= state.trail.length - 1;
}

async function trailGo(delta) {
  const next = state.trailAt + delta;
  if (next < 0 || next >= state.trail.length) return;
  const target = state.trail[next];
  /* openFile banks the outgoing position itself, before it replaces state.file.
     Move only if the document actually opens. A file deleted since it was
     visited, or a discard prompt the user cancels, would otherwise leave the
     position pointing somewhere the reader is not. */
  if (await openFile(target.path, {record: false, restore: target})) {
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
const contrastRatio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const INK = "#141413";
const WHITE = "#ffffff";

function mixHex(hex, other, w) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(other.slice(1), 16);
  return "#" + [16, 8, 0].map((sh) =>
    Math.round(((a >> sh) & 255) * (1 - w) + ((b >> sh) & 255) * w)
      .toString(16).padStart(2, "0")).join("");
}

/* Text on an accent surface: WCAG AA, 4.5:1. Which text colour is not decided
   per accent -- deciding it per accent is what looked broken, because "whichever
   of ink or white wins" answered white for two accents and ink for the other
   two, so four surfaces that should look like one decision looked like four.
   The rule is per THEME instead: a light theme carries white on its accents, a
   dark theme carries ink, so every accent reads the same way as the one beside
   it. The surface then moves away from that text, in 5% steps so it stays as
   close to the brand colour as the bar allows, until it clears 4.5:1.

   Dark accents already clear it against ink and come through untouched, which
   is why dark mode already looked right. */
const accentTextOn = (dark) => (dark ? INK : WHITE);

function fillFor(accent, dark) {
  const on = accentTextOn(dark);
  const pole = dark ? WHITE : "#000000";
  let fill = accent;
  for (let i = 0; i < 40 && contrastRatio(luminance(fill), luminance(on)) < 4.5; i++) {
    fill = mixHex(fill, pole, 0.05);
  }
  return fill;
}

/* The same 4.5:1 standard for the accent AS text -- links, code keywords --
   judged against the paper it actually sits on, and nudged toward whichever
   pole that paper contrasts with until it clears. Dark papers pass untouched;
   light papers deepen the accent a step or two. */
function textFor(accent, paper) {
  const pl = luminance(paper);
  const pole = contrastRatio(pl, 0) >= contrastRatio(pl, 1) ? "#000000" : WHITE;
  let text = accent;
  for (let i = 0; i < 12 && contrastRatio(luminance(text), pl) < 4.5; i++) {
    text = mixHex(text, pole, 0.12);
  }
  return text;
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
  syncPanelButtons();
  root.dataset.wordcount = S.wordCount ? "on" : "off";
  root.dataset.tableborders = S.tableBorders ? "on" : "off";
  root.dataset.glass = S.glass ? "on" : "off";
  root.dataset.recents = S.recentCount > 0 ? "on" : "off";

  const accent = (ACCENTS[S.accent] || ACCENTS.clay)[dark ? "dark" : "light"];
  st.setProperty("--accent", accent);
  st.setProperty("--accent-fill", fillFor(accent, dark));
  st.setProperty("--accent-on", accentTextOn(dark));
  invalidateSyncMaps();               // typography settings move every line
  /* the paper follows theme and paper choice in the stylesheet, so read it
     back (the data- attributes above are already set) rather than duplicate it */
  const paper = getComputedStyle(root).getPropertyValue("--paper").trim();
  st.setProperty("--accent-text",
                 textFor(accent, /^#[0-9a-f]{6}$/i.test(paper) ? paper : "#faf9f5"));

  const body = fontStack(BODY_FONTS, S.bodyFont);
  root.dataset.body = S.bodyFont;
  st.setProperty("--font-body", body);
  st.setProperty("--fw-body", String(S.bodyWeight));
  const headFontKey = S.headFont === "match" ? S.bodyFont : S.headFont;
  root.dataset.head = headFontKey;
  st.setProperty("--font-head", S.headFont === "match" ? body : fontStack(HEAD_FONTS, S.headFont));
  const mono = fontStack(MONO_FONTS, S.monoFont);
  st.setProperty("--font-mono", mono);
  st.setProperty("--font-editor", S.editorFont === "body" ? body : mono);

  st.setProperty("--fs-body", S.fontSize + "px");
  st.setProperty("--lh-body", String(S.lineHeight));
  st.setProperty("--measure", S.measure + "%");
  st.setProperty("--para-gap", S.paraGap + "em");
  st.setProperty("--list-gap", S.listGap + "em");
  st.setProperty("--title-size", S.titleSize + "px");
  st.setProperty("--title-weight", String(S.titleWeight));
  st.setProperty("--title-lh", String(S.titleLineHeight));
  st.setProperty("--title-spacing", S.titleSpacing + "em");
  /* Heading-group overrides: `null` means "use the built-in hierarchy default".
     Saved personal values replace the defaults consistently for every font. */
  st.setProperty("--head-scale", S.headSizeScale != null ? String(S.headSizeScale) : "");
  st.setProperty("--cap-scale", S.headCapScale != null ? String(S.headCapScale) : "");
  st.setProperty("--title-cap-scale", S.titleCapScale != null ? String(S.titleCapScale) : "");
  st.setProperty("--head-weight-override", S.headWeight != null ? String(S.headWeight) : "");
  st.setProperty("--head-lh-override", S.headLineHeight != null ? String(S.headLineHeight) : "");
  st.setProperty("--head-spacing-override", S.headSpacing != null ? (S.headSpacing + "em") : "");
  st.setProperty("--head-gap-override", S.headGap != null ? (S.headGap + "em") : "");
  st.setProperty("--head-gap-after-override", S.headGapAfter != null ? (S.headGapAfter + "em") : "");
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

async function api(path, {method = "GET", body = null, query = {}, signal = null} = {}) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(path + (qs ? "?" + qs : ""), {
    method,
    headers: Object.assign({"X-Reader-Token": TOKEN},
                           body ? {"Content-Type": "application/json"} : {}),
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || `request failed (${res.status})`);
  return data;
}
/* the session cookie authorises this; the token is only a fallback */
const rawURL = (p) =>
  "/api/raw?" + new URLSearchParams(TOKEN
    ? {path: p, v: state.imageGeneration, t: TOKEN}
    : {path: p, v: state.imageGeneration});

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

const BLANK_LINE_CLASS = "md-blank-lines";

function blankLineCount(raw, leading = false) {
  const newlines = (raw.match(/\n/g) || []).length;
  return leading ? newlines : Math.max(newlines - 2, 0);
}

function splitTrailingBlankLines(tok) {
  if (!tok || tok.type === "space" || typeof tok.raw !== "string") return [tok];
  const m = tok.raw.match(/\n{2,}$/);
  if (!m) return [tok];
  tok.raw = tok.raw.slice(0, -m[0].length) + "\n";
  return [tok, {type: "space", raw: m[0]}];
}

function normalizeBlankLineTokens(tokens) {
  if (!Array.isArray(tokens)) return tokens;
  const out = [];
  tokens.forEach((tok) => {
    if (Array.isArray(tok?.tokens)) tok.tokens = normalizeBlankLineTokens(tok.tokens);
    if (Array.isArray(tok?.items)) {
      tok.items.forEach((item) => {
        if (Array.isArray(item?.tokens)) item.tokens = normalizeBlankLineTokens(item.tokens);
      });
    }
    splitTrailingBlankLines(tok).forEach((part) => out.push(part));
  });
  return out;
}

function annotateBlankLineTokens(tokens) {
  if (!Array.isArray(tokens)) return tokens;
  tokens.forEach((tok, index) => {
    if (tok.type === "space") tok.blankLines = blankLineCount(tok.raw || "", index === 0);
    annotateBlankLineTokenChildren(tok);
  });
  return tokens;
}

function markdownTokens(text) {
  return annotateBlankLineTokens(normalizeBlankLineTokens(marked.lexer(text || "")));
}

function annotateBlankLineTokenChildren(tok) {
  if (!tok || typeof tok !== "object") return;
  if (Array.isArray(tok.tokens)) annotateBlankLineTokens(tok.tokens);
  if (Array.isArray(tok.items)) tok.items.forEach((item) => annotateBlankLineTokenChildren(item));
  if (Array.isArray(tok.header)) tok.header.forEach((cell) => annotateBlankLineTokenChildren(cell));
  if (Array.isArray(tok.rows)) tok.rows.flat().forEach((cell) => annotateBlankLineTokenChildren(cell));
}

marked.use({
  gfm: true,
  breaks: false,
  hooks: {
    processAllTokens(tokens) {
      return annotateBlankLineTokens(normalizeBlankLineTokens(tokens));
    },
  },
  extensions: [{
    name: "space",
    renderer(tok) {
      const lines = Number(tok.blankLines) || 0;
      return lines
        ? `<div class="${BLANK_LINE_CLASS}" aria-hidden="true" style="--blank-lines:${lines}"></div>`
        : "";
    },
  }],
});

let mermaidConfigured = false;

function configureMermaid() {
  if (mermaidConfigured) return true;
  if (!window.mermaid || typeof window.mermaid.initialize !== "function") return false;
  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    theme: "neutral",
    flowchart: {useMaxWidth: true},
  });
  mermaidConfigured = true;
  return true;
}

function mermaidError(pre) {
  if (pre.nextElementSibling?.classList.contains("mermaid-error")) return;
  const note = document.createElement("p");
  note.className = "mermaid-error";
  note.textContent = "This Mermaid diagram could not be rendered; showing its source.";
  pre.after(note);
}

async function renderMermaidBlocks(scope, generation) {
  const blocks = [...scope.querySelectorAll("pre > code.language-mermaid")];
  if (!blocks.length || !configureMermaid()) return;

  for (const [index, code] of blocks.entries()) {
    const pre = code.parentElement;
    if (!pre) continue;
    try {
      const result = await window.mermaid.render(`mermaid-diagram-${generation}-${index}`, code.textContent || "");
      if (generation !== state.mermaidGeneration || !pre.isConnected) return;
      const host = document.createElement("div");
      host.className = "mermaid-diagram";
      host.setAttribute("role", "img");
      host.setAttribute("aria-label", "Mermaid diagram");
      host.innerHTML = DOMPurify.sanitize(result.svg, {
        USE_PROFILES: {svg: true, svgFilters: true},
      });
      if (!host.querySelector("svg")) throw new Error("Mermaid returned no SVG");
      pre.replaceWith(host);
      if (typeof result.bindFunctions === "function") result.bindFunctions(host);
    } catch (_) {
      if (generation !== state.mermaidGeneration || !pre.isConnected) return;
      mermaidError(pre);
    }
  }
}

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

/* Letter proportions: browsers expose no way to retune a font's own
   cap-to-x-height ratio within one text run (font-size-adjust rescales every
   glyph uniformly), so capital runs in headings are wrapped once at render
   time and scaled around the baseline through the --cap-scale variable.
   Moving the slider therefore needs no re-render. Code spans keep their
   exact text. */
const CAP_RUN = /\p{Lu}+/gu;
function wrapCapRuns(rootEl) {
  rootEl.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
    const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.parentElement.closest("code,pre")
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    for (let n; (n = walker.nextNode()); ) {
      if (/\p{Lu}/u.test(n.data)) nodes.push(n);
    }
    nodes.forEach((n) => {
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const m of n.data.matchAll(CAP_RUN)) {
        if (m.index > last) frag.append(n.data.slice(last, m.index));
        const span = document.createElement("span");
        span.className = "cap-run";
        span.textContent = m[0];
        frag.append(span);
        last = m.index + m[0].length;
      }
      if (last < n.data.length) frag.append(n.data.slice(last));
      n.replaceWith(frag);
    });
  });
}

function render(text) {
  const mermaidGeneration = ++state.mermaidGeneration;
  state.lineAnchors = null;
  invalidateSyncMaps();
  /* Whatever this render produces, the find marks in the old document are gone
     with it, so the search is laid back over the new one. */
  queueMicrotask(findRefresh);
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
  renderMermaidBlocks(el.preview, mermaidGeneration);
  /* A document that opens with an H1 is treating it as its title. Mark it
     separately so the title can be displayed prominently without redefining
     the shared H1-H6 hierarchy used by the rest of the document. */
  const firstEl = el.preview.firstElementChild;
  if (firstEl && firstEl.tagName === "H1") firstEl.classList.add("doc-heading");
  wrapCapRuns(el.preview);

  const dir = state.file ? state.file.dir : "";
  const seen = new Set();

  el.preview.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
    h.id = slugify(h.textContent, seen);
  });
  el.preview.querySelectorAll("img[src]").forEach((img) => {
    const src = img.getAttribute("src");
    if (!src || EXTERNAL.test(src) || src.startsWith("//")) return;
    const localPath = absolutise(src, dir);
    img.dataset.localPath = localPath;
    img.src = rawURL(localPath);
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
    const item = box.parentElement;
    item.classList.add("task-list-item");
    /* marked ships task checkboxes with `disabled` set, so clearing the
       attribute is what actually makes them clickable -- simply not disabling
       them here leaves the renderer's own attribute in place. */
    box.disabled = false;
    /* marked emits "<input> text", and that leading space is added to the gap
       the stylesheet already sets. It also has nowhere sensible to sit once the
       checkbox is positioned out of the flow, so it goes. */
    const after = box.nextSibling;
    if (after && after.nodeType === 3) after.data = after.data.replace(/^\s+/, "");
    /* The item's own words are gathered into one span, stopping at any list
       nested beneath it, so a finished task can be dimmed and struck through
       without dragging its sub-items into the same treatment. */
    const own = document.createElement("span");
    own.className = "task-text";
    while (box.nextSibling && !/^(?:UL|OL)$/.test(box.nextSibling.nodeName)) {
      own.appendChild(box.nextSibling);
    }
    item.insertBefore(own, box.nextSibling);
    item.classList.toggle("done", box.checked);
    const list = item.parentElement;
    if (list) list.classList.add("contains-task-list");
  });
  el.preview.querySelectorAll("pre code:not(.language-mermaid)").forEach((block) => {
    try { hljs.highlightElement(block); } catch (_) {}
  });
  listifyCells(el.preview);
  mountFolds();
  state.lineAnchors = buildAnchors(text);
  /* images change the page's height as they arrive, so anchor positions
     measured before a load are stale the moment it finishes */
  el.preview.querySelectorAll("img").forEach((img) =>
    img.addEventListener("load", () => { state.previewTops = null; }, {once: true}));

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
    const lines = cell.innerHTML.split(/<br\s*\/?>/i)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length || !lines.some((s) => CELL_BULLET.test(s))) return;

    /* Group neighbouring lines by whether they are bulleted. A cell commonly
       introduces its list with a sentence, and that sentence has to stay a
       sentence -- requiring every line to be bulleted skipped the whole cell. */
    const runs = [];
    for (const line of lines) {
      const bullet = CELL_BULLET.test(line);
      const last = runs[runs.length - 1];
      if (last && last.bullet === bullet) last.lines.push(line);
      else runs.push({bullet, lines: [line]});
    }
    /* A bullet character is unambiguous. A lone dash is only ambiguous when it
       is the entire cell ("- 5 degrees below zero"); standing next to anything
       else -- a lead-in sentence, or other bullets -- it is a bullet like its
       neighbours, so only a cell that is nothing but one dashed line is prose. */
    const only = runs.length === 1 && runs[0].lines.length === 1 ? runs[0] : null;
    if (only && !EXPLICIT_BULLET.test(only.lines[0])) only.bullet = false;
    if (!runs.some((r) => r.bullet)) return;

    /* Re-sanitise every fragment: they were split out of sanitised HTML with a
       regex, and reassembling them should not be what reintroduces markup. */
    const out = document.createDocumentFragment();
    for (const run of runs) {
      if (!run.bullet) {
        const text = document.createElement("div");
        text.className = "cell-text";
        text.innerHTML = DOMPurify.sanitize(run.lines.join("<br>"));
        out.appendChild(text);
        continue;
      }
      const ul = document.createElement("ul");
      ul.className = "cell-list";
      for (const line of run.lines) {
        const li = document.createElement("li");
        li.innerHTML = DOMPurify.sanitize(line.replace(CELL_BULLET, ""));
        ul.appendChild(li);
      }
      out.appendChild(ul);
    }
    cell.replaceChildren(out);
  });
}

/* ==========================================================================
   Collapsible sections
   --------------------------------------------------------------------------
   A heading owns everything after it up to the next heading of the same or a
   higher level, and collapsing hides exactly that run. The blocks are hidden
   where they stand rather than moved into a wrapper: #preview's top-level
   children map one-to-one, in order, onto marked's top-level tokens, and both
   scroll sync (buildAnchors) and quick edit (topLevelSpan) are built on that
   invariant. Nesting still works, because a hidden parent hides its children
   whatever they think of themselves.

   What is collapsed is remembered by heading slug, so an edit that re-renders
   the document -- every keystroke in split view -- does not spring it open.
   ========================================================================== */

const HEAD_TAG = /^H([1-6])$/;
const headLevel = (node) => {
  const m = node && node.tagName && HEAD_TAG.exec(node.tagName);
  return m ? Number(m[1]) : 0;
};

/* Every heading in the preview with the blocks that belong to it. */
function foldSections() {
  const kids = [...el.preview.children];
  const out = [];
  kids.forEach((node, i) => {
    const level = headLevel(node);
    if (!level) return;
    let end = kids.length;
    for (let j = i + 1; j < kids.length; j++) {
      const next = headLevel(kids[j]);
      if (next && next <= level) { end = j; break; }
    }
    out.push({head: node, level, body: kids.slice(i + 1, end)});
  });
  return out;
}

const FOLD_CARET =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>';

/* Draws the markers and puts the remembered state back on the page. Runs at
   the end of every markdown render, and again on every toggle. */
function mountFolds() {
  const sections = foldSections();
  el.preview.querySelectorAll(".fold-hidden")
    .forEach((node) => node.classList.remove("fold-hidden"));

  for (const sec of sections) {
    const foldable = sec.body.length > 0;
    sec.head.classList.toggle("foldable", foldable);
    let btn = sec.head.querySelector(":scope > .fold-toggle");
    if (foldable && !btn) {
      btn = document.createElement("button");
      btn.className = "fold-toggle";
      btn.type = "button";
      btn.innerHTML = FOLD_CARET;
      sec.head.prepend(btn);
    } else if (!foldable && btn) {
      btn.remove();
    }
    /* A heading whose section vanished under an edit must not stay collapsed
       invisibly: without a body there is nothing to unfold it with. */
    if (!foldable) state.folded.delete(sec.head.id);

    const shut = foldable && state.folded.has(sec.head.id);
    sec.head.classList.toggle("folded", shut);
    if (btn) {
      btn.setAttribute("aria-expanded", String(!shut));
      btn.setAttribute("aria-label",
                       (shut ? "Expand section: " : "Collapse section: ") + sec.head.textContent.trim());
      btn.title = shut ? "Expand section" : "Collapse section";
    }
    if (shut) sec.body.forEach((node) => node.classList.add("fold-hidden"));
  }
  /* hidden blocks have no height, so every measured anchor position is stale */
  invalidateSyncMaps();
}

function setFold(head, shut) {
  if (!head || !head.id) return;
  if (shut) state.folded.add(head.id);
  else state.folded.delete(head.id);
  mountFolds();
}

const foldAvailable = () =>
  !!state.file && state.file.kind === "md" && root.dataset.mode !== "edit";

/* The section being read: the last heading at or above the top of the pane.
   Above the first heading, that is the first one. */
function sectionAtReadingPoint(sections) {
  const mark = el.previewpane.getBoundingClientRect().top + 4;
  let best = null;
  for (const sec of sections) {
    if (sec.head.classList.contains("fold-hidden")) continue;
    if (sec.head.getBoundingClientRect().top <= mark) best = sec;
    else if (!best) return sec;
  }
  return best;
}

function parentSection(sections, sec) {
  for (let i = sections.indexOf(sec) - 1; i >= 0; i--) {
    if (sections[i].level < sec.level) return sections[i];
  }
  return null;
}

/* Keeps the heading you acted on where you can see it: collapsing a long
   section pulls the page up under the reader otherwise. */
function keepHeadingInView(head) {
  const paneTop = el.previewpane.getBoundingClientRect().top;
  const top = head.getBoundingClientRect().top;
  if (top < paneTop + 4 || top > el.previewpane.getBoundingClientRect().bottom - 40) {
    el.previewpane.scrollTop += top - paneTop - 8;
  }
}

/* ⌥⌘[ and ⌥⌘]. Collapsing an already-collapsed section closes its parent, so
   repeating the key walks up the document; expanding an open one opens what
   is folded inside it, so repeating opens the branch. */
function foldAtReadingPoint(shut) {
  const sections = foldSections();
  let sec = sectionAtReadingPoint(sections);
  if (!sec) return;
  if (shut) {
    while (sec && (!sec.body.length || state.folded.has(sec.head.id))) {
      sec = parentSection(sections, sec);
    }
    if (!sec) return;
    setFold(sec.head, true);
    keepHeadingInView(sec.head);
    return;
  }
  if (state.folded.has(sec.head.id)) { setFold(sec.head, false); return; }
  let opened = false;
  for (const inner of sections) {
    if (sec.body.includes(inner.head) && state.folded.delete(inner.head.id)) opened = true;
  }
  if (opened) mountFolds();
}

/* ⌥⌘1-6 collapse every section at that level and open everything else; ⌥⌘0
   opens the whole document. */
function foldToLevel(level) {
  state.folded.clear();
  if (level > 0) {
    for (const sec of foldSections()) {
      if (sec.level === level && sec.body.length) state.folded.add(sec.head.id);
    }
  }
  mountFolds();
  el.previewpane.scrollTop = Math.min(el.previewpane.scrollTop, maxScroll(el.previewpane));
}

/* Anything the reader is being sent to -- a match, an anchor link -- has to be
   on screen when they get there, whatever was collapsed over it. */
function revealFolds(node) {
  if (!node || !state.folded.size) return;
  let block = node;
  while (block && block.parentElement !== el.preview) block = block.parentElement;
  if (!block) return;
  let opened = false;
  for (const sec of foldSections()) {
    if (!state.folded.has(sec.head.id)) continue;
    if (sec.head === block || sec.body.includes(block)) {
      state.folded.delete(sec.head.id);
      opened = true;
    }
  }
  if (opened) mountFolds();
}

/* Which fold key was pressed. Option rewrites ev.key into a symbol on macOS
   ( ⌥[ is "“", ⌥1 is "¡" ), so the physical key is the reliable read -- with
   both the plain and the rewritten character as fallbacks, because not every
   source of a key event fills ev.code in. */
const OPTION_DIGITS = {"º": "0", "¡": "1", "™": "2", "£": "3", "¢": "4", "∞": "5", "§": "6"};
function altChord(ev) {
  if (ev.code === "BracketLeft" || ev.key === "[" || ev.key === "\u201c") return "[";
  if (ev.code === "BracketRight" || ev.key === "]" || ev.key === "\u2018") return "]";
  const physical = /^Digit([0-6])$/.exec(ev.code || "");
  if (physical) return physical[1];
  if (/^[0-6]$/.test(ev.key)) return ev.key;
  return OPTION_DIGITS[ev.key] || "";
}

el.preview.addEventListener("click", (ev) => {
  const btn = ev.target.closest(".fold-toggle");
  if (!btn) return;
  ev.preventDefault();
  const head = btn.parentElement;
  const sections = foldSections();
  const sec = sections.find((s) => s.head === head);
  if (!sec) return;
  /* ⌥-click works on the whole level at once: fold every H2 in the document,
     or open them all again. */
  if (ev.altKey) {
    const peers = sections.filter((s) => s.level === sec.level && s.body.length);
    const shut = peers.some((s) => !state.folded.has(s.head.id));
    peers.forEach((s) => (shut ? state.folded.add(s.head.id) : state.folded.delete(s.head.id)));
    mountFolds();
    keepHeadingInView(head);
    return;
  }
  setFold(head, !head.classList.contains("folded"));
  keepHeadingInView(head);
});

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

/* Events that mean "I am scrolling this myself". */
const SCROLL_INTENT = ["wheel", "touchstart", "pointerdown", "keydown"];

/* Put a pane back to a remembered offset. Setting scrollTop once is not enough:
   images and web fonts land after the first paint, and until they do the
   document is a different height, so the offset either clamps short or gets
   nudged along by the browser's scroll anchoring. It is re-applied as the layout
   settles.
   The reader taking over cannot be detected from the position -- an anchoring
   nudge and a real scroll look identical, and treating the nudge as a takeover
   left the document 13px off the place it was asked to return to. Intent is read
   from the input events instead, so a genuine scroll stops the correction and
   the browser's own adjustments do not. */
function restoreScroll(pane, top) {
  const target = Math.max(0, top || 0);
  const apply = () => { pane.scrollTop = Math.min(target, maxScroll(pane)); };
  apply();
  if (!target) return;

  let live = true;
  const release = () => {
    if (!live) return;
    live = false;
    SCROLL_INTENT.forEach((type) => window.removeEventListener(type, release, true));
  };
  SCROLL_INTENT.forEach((type) => window.addEventListener(type, release, true));

  const again = () => { if (live) apply(); };
  requestAnimationFrame(again);
  setTimeout(again, 80);
  setTimeout(again, 320);
  setTimeout(release, 400);
}

function setDirty(on) {
  state.dirty = documentIsWritable() && on;
  el.dirty.hidden = !state.dirty;
  el.save.disabled = !state.dirty;
  document.title = (state.dirty ? "• " : "") + (state.file ? state.file.name : "Reader");
}

function beginDocumentSession(targetPath) {
  if (targetPath !== (state.file ? state.file.path : null)) state.folded.clear();
  if (state.documentController) state.documentController.abort();
  state.documentController = new AbortController();
  state.documentSession += 1;
  state.polling = null;
  clearInterval(watchTimer);
  watchTimer = null;
  root.dataset.watch = "off";
  return {
    id: state.documentSession,
    targetPath,
    sourcePath: state.file?.path || null,
    sourceRevision: el.editor.value,
    signal: state.documentController.signal,
  };
}

const sessionIsCurrent = (session, path = null) =>
  session === state.documentSession && (!path || state.file?.path === path);

function openMayApply(context) {
  return context.id === state.documentSession &&
    (state.file?.path || null) === context.sourcePath &&
    el.editor.value === context.sourceRevision;
}

function staleOrAborted(err, context) {
  return context.id !== state.documentSession || err?.name === "AbortError";
}

function hideDiskBar() {
  el.diskbar.hidden = true;
  el.diskmsg.textContent = "This file changed on disk while you were editing.";
}

/* Returns the opened path, or null if nothing was opened -- the trail relies on
   knowing the difference. `record` is false for reloads of the current document
   and for trail navigation itself, neither of which is a new visit. */
async function openFile(path, {keepScroll = false, silent = false, record = true,
                              restore = null} = {}) {
  if (!silent && state.dirty && !confirm("Discard unsaved changes?")) return null;
  /* Where the reader is in the document being left, banked before it is replaced
     so that back and forward return to the paragraph rather than to the top. */
  trailMark();
  const kind = kindOf(path);
  const context = beginDocumentSession(path);

  if (kind === "pdf") {
    let info;
    try { info = await api("/api/stat", {query: {path}, signal: context.signal}); }
    catch (err) {
      if (!staleOrAborted(err, context)) toast(err.message, true);
      if (context.id === state.documentSession) restartWatch();
      return null;
    }
    if (!openMayApply(context)) { restartWatch(); return null; }
    state.file = {path: info.path, kind: "pdf", writable: false,
                  name: info.path.split("/").pop(),
                  dir: info.path.split("/").slice(0, -1).join("/") || "/",
                  mtime: info.mtime};
    state.saved = "";
    state.diskSeen = info.mtime;
    el.editor.value = "";
    el.editor.readOnly = true;
    root.dataset.readonly = "yes";
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
  try { data = await api("/api/file", {query: {path}, signal: context.signal}); }
  catch (err) {
    if (!staleOrAborted(err, context)) toast(err.message, true);
    if (context.id === state.documentSession) restartWatch();
    return null;
  }
  if (!openMayApply(context)) { restartWatch(); return null; }

  clearPDF();
  root.dataset.doc = kind;
  state.file = {path: data.path, name: data.name, dir: data.dir, mtime: data.mtime,
                kind, writable: data.writable !== false};
  state.saved = data.text;
  state.diskSeen = data.mtime;
  /* A local image can change without its Markdown document changing. Bump the
     URL version whenever the document is loaded from disk so WebKit cannot
     reuse an image response from the previous preview. Renders caused by
     typing keep the same version and do not refetch every image. */
  state.imageGeneration += 1;
  state.imageMtimes.clear();
  el.editor.value = data.text;
  el.editor.readOnly = !state.file.writable;
  root.dataset.readonly = state.file.writable ? "no" : "yes";
  el.docname.textContent = data.name;
  root.dataset.empty = "no";
  historyReset();                 // a different document, a different history
  setDirty(false);
  hideDiskBar();
  render(data.text);
  await pollLocalImages(context.id, data.path);
  if (!sessionIsCurrent(context.id, data.path)) return null;

  if (restore) {
    /* Back and forward: an absolute offset, not a ratio, because the reader is
       returning to a specific place and the document has not changed shape. */
    restoreScroll(el.previewpane, restore.top);
    restoreScroll(el.editor, restore.editorTop);
    el.editor.setSelectionRange(restore.caret || 0, restore.caret || 0);
  } else {
    el.previewpane.scrollTop = keepScroll ? pRatio * maxScroll(el.previewpane) : 0;
    el.editor.scrollTop = keepScroll ? eRatio * maxScroll(el.editor) : 0;
    if (keepScroll) el.editor.setSelectionRange(caret, caret);
  }

  S.lastFile = data.path;
  pushRecent(state.file);
  savePrefs();
  markActive();
  restartWatch();
  if (!silent) revealInTree(data.path);
  if (!silent && !state.file.writable) {
    toast("Opened read-only; restart Reader with this file to edit it.", true);
  }
  if (record) trailPush(data.path);
  return data.path;
}

/* Automatic saving waits for a pause rather than saving per keystroke, so a
   burst of typing is one write and the file on disk is never a half-typed word.
   A save can also be asked for at any moment, and then this pending one is
   redundant -- saveFile cancels it. */
const AUTOSAVE_PAUSE_MS = 1200;
let autosaveTimer = null;

function cancelAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

function scheduleAutosave() {
  cancelAutosave();
  if (!S.autoSave || !state.file || !state.dirty) return;
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    saveFile({auto: true});
  }, AUTOSAVE_PAUSE_MS);
}

/* `auto` marks a save the reader did not ask for: it stays quiet on success and
   never raises a dialog, because an automatic save must not interrupt. */
let saveTail = Promise.resolve();

async function saveFile(options = {}) {
  if (!state.file || !state.dirty) return {status: "unchanged"};
  if (state.file.writable === false) {
    const result = {status: "read_only", path: state.file.path};
    if (options.throwOnError) throw new Error("this document is read-only");
    if (!options.quiet) toast("This document is read-only", true);
    return result;
  }
  cancelAutosave();                    // whatever was pending, this covers it
  const snapshot = {
    session: state.documentSession,
    path: state.file.path,
    text: el.editor.value,
  };
  const run = () => saveSnapshot(snapshot, options);
  const result = saveTail.then(run, run);
  saveTail = result.catch(() => {});
  return result;
}

/* The queue is the browser-side half of optimistic concurrency. Each job takes
   the mtime left by the preceding successful job, while keeping the exact text
   revision captured when this save was requested. */
async function saveSnapshot(snapshot, {auto = false, conflict = "prompt", quiet = false,
                                       throwOnError = false} = {}) {
  if (!sessionIsCurrent(snapshot.session, snapshot.path)) return {status: "stale"};
  if (state.saved === snapshot.text) {
    setDirty(el.editor.value !== state.saved);
    return {status: "unchanged"};
  }
  try {
    const res = await api("/api/save", {
      method: "POST",
      body: {path: snapshot.path, text: snapshot.text, mtime: state.file.mtime},
    });
    if (!sessionIsCurrent(snapshot.session, snapshot.path)) return {status: "stale"};
    state.file.mtime = res.mtime;
    state.diskSeen = res.mtime;
    state.saved = snapshot.text;
    /* Keystrokes may have landed while the request was in flight; those are
       still unsaved, so compare against the text that was actually written. */
    setDirty(el.editor.value !== snapshot.text);
    if (state.dirty) scheduleAutosave();
    hideDiskBar();
    if (!auto && !quiet) toast("Saved");
    return {status: "saved", path: snapshot.path, mtime: res.mtime};
  } catch (err) {
    if (!sessionIsCurrent(snapshot.session, snapshot.path)) return {status: "stale"};
    if (/changed on disk/i.test(err.message)) {
      /* The file moved under us. An automatic save says so in the disk bar and
         leaves the choice alone -- overwriting on a timer is not its call. */
      if (auto) {
        el.diskmsg.textContent = "This file changed on disk, so your edits are not being saved automatically.";
        el.diskbar.hidden = false;
        return {status: "conflict", path: snapshot.path};
      }
      el.diskmsg.textContent = "This file changed on disk while you were editing.";
      el.diskbar.hidden = false;
      const overwrite = conflict === "overwrite" ||
        (conflict === "prompt" && confirm("This file changed on disk since you opened it.\n\nOverwrite it with your version?"));
      if (overwrite) {
        const res = await api("/api/save", {
          method: "POST", body: {path: snapshot.path, text: snapshot.text},
        }).catch((e) => {
          if (throwOnError) throw e;
          if (!quiet) toast(e.message, true);
          return null;
        });
        if (res) {
          if (!sessionIsCurrent(snapshot.session, snapshot.path)) return {status: "stale"};
          state.file.mtime = res.mtime;
          state.diskSeen = res.mtime;
          state.saved = snapshot.text;
          setDirty(el.editor.value !== snapshot.text);
          if (state.dirty) scheduleAutosave();
          hideDiskBar();
          if (!quiet) toast("Saved");
          return {status: "saved", path: snapshot.path, mtime: res.mtime,
                  overwritten: true};
        }
      }
      return {status: "conflict", path: snapshot.path};
    }
    if (throwOnError) throw err;
    if (!quiet) toast(err.message, true);
    return {status: "error", message: err.message};
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
  const session = state.documentSession;
  const path = state.file.path;
  const signal = state.documentController?.signal || null;
  state.polling = session;
  try {
    const info = await api("/api/stat", {query: {path}, signal});
    if (!sessionIsCurrent(session, path)) return;
    const documentChanged = info.mtime !== state.file.mtime && info.mtime !== state.diskSeen;
    if (documentChanged) {
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
      const opened = await openFile(path, {keepScroll: true, silent: true, record: false});
      if (opened && S.watchToast) toast("Refreshed from disk");
      return;
    }
    await pollLocalImages(session, path);
  } catch (err) {
    if (!sessionIsCurrent(session, path) || err?.name === "AbortError") return;
    if (/no such/i.test(err.message)) {
      el.diskmsg.textContent = "This file is no longer on disk.";
      el.diskbar.hidden = false;
      clearInterval(watchTimer);
      watchTimer = null;
      root.dataset.watch = "off";
    }
  } finally {
    if (state.polling === session) state.polling = null;
  }
}

/* Markdown and Mermaid changes arrive through the document watcher above. An
   embedded image is a separate file, though, so it needs its own lightweight
   stat check. Only images in the currently rendered preview are observed, and
   /api/stat applies the same path policy as every other Reader file request. */
async function pollLocalImages(session = state.documentSession, documentPath = state.file?.path) {
  if (!sessionIsCurrent(session, documentPath)) return;
  const paths = [...new Set([...el.preview.querySelectorAll("img[data-local-path]")]
    .map((img) => img.dataset.localPath).filter(Boolean))];
  if (!paths.length) {
    state.imageMtimes.clear();
    return;
  }

  const live = new Set(paths);
  for (const path of [...state.imageMtimes.keys()]) {
    if (!live.has(path)) state.imageMtimes.delete(path);
  }

  let changed = false;
  await Promise.all(paths.map(async (path) => {
    try {
      const info = await api("/api/stat", {
        query: {path}, signal: state.documentController?.signal || null,
      });
      if (!sessionIsCurrent(session, documentPath)) return;
      const prior = state.imageMtimes.get(path);
      state.imageMtimes.set(path, info.mtime);
      if (prior != null && prior !== info.mtime) changed = true;
    } catch (err) {
      if (!sessionIsCurrent(session, documentPath) || err?.name === "AbortError") return;
      state.imageMtimes.delete(path);
    }
  }));
  if (!sessionIsCurrent(session, documentPath)) return;
  if (!changed) return;

  state.imageGeneration += 1;
  el.preview.querySelectorAll("img[data-local-path]").forEach((img) => {
    img.src = rawURL(img.dataset.localPath);
  });
  state.previewTops = null;
  if (S.watchToast) toast("Refreshed image from disk");
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
const FILE_MIME = "application/x-reader-file";
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

const listQuery = (path) => {
  const q = {path};
  if (S.showAllDirs) q.all = "1";
  if (S.showAllFiles) q.files = "1";
  if (S.showHidden) q.hidden = "1";
  return q;
};

/* Files that open in the app that owns them (Word, Excel, ...). Mirrors the
   server's EXTERNAL_APP_SUFFIXES, which is the set actually enforced. */
/* Handed to the app that owns them rather than rendered here. Images are in the
   set because Reader lists none of them in the tree and renders none as a
   document, so a link to one would otherwise dead-end; Preview is where it
   belongs. Mirrors EXTERNAL_APP_SUFFIXES on the server, which enforces it. */
const EXT_APP = new Set(["doc", "docx", "xls", "xlsx", "xlsm", "ppt", "pptx",
                         "pages", "numbers", "key", "rtf", "odt", "ods",
                         "png", "jpg", "jpeg", "gif", "svg", "webp", "avif",
                         "bmp", "ico"]);

function openExternal(path) {
  api("/api/open-external", {method: "POST", body: {path}})
    .then(() => toast("Opened in its own app"))
    .catch((err) => toast(err.message, true));
}

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
  if (entry.supported === false) {
    btn.classList.add("unsupported");
    btn.dataset.sup = "0";
    btn.title = entry.path + (EXT_APP.has(extOf(entry.path))
      ? " — opens in its own app" : " — Reader cannot open this");
  }
  const isDir = entry.type === "dir";
  btn.innerHTML = (isDir ? ICONS.caret : ICONS.spacer) +
                  (isDir ? ICONS.folder : iconFor(entry.path)) + '<span class="nm"></span>';
  btn.querySelector(".nm").textContent = entry.name;
  btn.draggable = true;
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
    /* An unsupported file opens in the app that owns it, or not at all --
       the menu should promise only what a click on the row would do. */
    if (EXT_APP.has(extOf(path))) add(ICONS.file, "Open in its own app", () => openExternal(path));
    else add(ICONS.file, "Open", () => openFile(path));
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

/* --- new document ------------------------------------------------------- */

const newEls = {
  scrim: $("newdoc"), title: $("nd-title"), input: $("nd-input"), note: $("nd-note"),
  ok: $("nd-ok"), cancel: $("nd-cancel"),
  form: $("nd-form"), where: $("nd-where"), change: $("nd-change"),
  picker: $("nd-picker"), pickHere: $("nd-pick-here"), pickList: $("nd-pick-list"),
  pickUp: $("nd-up"), pickBack: $("nd-pick-back"), pickUse: $("nd-pick-use"),
};
/* The folder the document will go in, and -- while the picker is up -- the
   folder being looked through, which is not the same thing until Use is
   pressed. */
let newDocDir = null;
let pickDir = null;
const newDocOpen = () => !newEls.scrim.hidden;
const NEW_DOC_HINT = "Leave the extension off and it will be a .md file.";

/* Where a new document belongs: beside the one being read, because that is the
   folder you are working in even when the tree is showing somewhere else
   entirely -- opening a document from Recent, from a link or from the file
   search all leave the panel pointing elsewhere. With nothing open, the folder
   the panel is showing is the only answer there is.
   Either way the dialog names it, so it is never a guess. */
function newDocFolder() {
  if (state.file && state.file.dir) return state.file.dir;
  return state.root || HOME;
}

function showNewDocDir() {
  newEls.where.textContent = prettyDir(newDocDir);
  newEls.where.title = newDocDir;
}

function openNewDoc() {
  const folder = newDocFolder();
  if (!folder) return false;
  newDocDir = folder;
  showNewDocDir();
  newEls.input.value = "";
  newEls.note.textContent = NEW_DOC_HINT;
  newEls.ok.disabled = true;
  showNewDocForm();
  state.lastFocus = document.activeElement;
  newEls.scrim.hidden = false;
  newEls.input.focus();
  return true;
}

function showNewDocForm() {
  newEls.title.textContent = "New document";
  newEls.picker.hidden = true;
  newEls.form.hidden = false;
}

/* --- choosing the folder ------------------------------------------------ */

/* Two ways to choose, one contract: chooseFolder(startDir) settles with a path
   or with null for "kept what I had". The native panel is the one people know --
   sidebar, favourites, ⌘⇧G, New Folder -- and it is what the app uses. A page in
   a browser cannot open it, so the picker drawn in the dialog stays for that,
   and stays the only implementation a test can drive. */
const nativeBridge = () => (window.webkit && window.webkit.messageHandlers &&
                            window.webkit.messageHandlers.reader) || null;

function chooseFolderNatively(startDir) {
  return nativeBridge()
    .postMessage({action: "chooseFolder", current: startDir})
    .then((path) => (typeof path === "string" && path ? path : null));
}

/* Whatever was chosen still has to be somewhere Reader may write. The server is
   the only thing that knows -- the policy, the Music rule, symlinks and the
   operating system's own permission all live there -- so it is asked before the
   folder is accepted, rather than after a name has been typed. */
async function folderUsable(dir) {
  try {
    const verdict = await api("/api/can-create", {query: {path: dir}});
    return verdict.ok ? {ok: true} : {ok: false, reason: verdict.reason};
  } catch (err) {
    return {ok: false, reason: err.message};
  }
}

/* The one place a chosen folder is taken up, so the two implementations cannot
   drift on what happens afterwards. */
async function adoptFolder(dir) {
  if (!dir || dir === newDocDir) return;
  const verdict = await folderUsable(dir);
  if (!verdict.ok) {
    newEls.note.textContent = verdict.reason;
    return;
  }
  newDocDir = dir;
  showNewDocDir();
  newEls.note.textContent = NEW_DOC_HINT;   // an older complaint no longer applies
}

async function startChoosingFolder() {
  if (!nativeBridge()) { openPicker(); return; }
  newEls.change.disabled = true;
  let chosen = null;
  try { chosen = await chooseFolderNatively(newDocDir); }
  catch (err) { newEls.note.textContent = String(err && err.message || err); }
  newEls.change.disabled = false;
  await adoptFolder(chosen);
  newEls.input.focus();
}

const pickerOpen = () => !newEls.picker.hidden;

function openPicker() {
  pickDir = newDocDir;
  newEls.title.textContent = "Choose a folder";
  newEls.form.hidden = true;
  newEls.picker.hidden = false;
  drawPicker();
  newEls.pickUse.focus();
}

async function drawPicker() {
  newEls.pickHere.textContent = prettyDir(pickDir);
  newEls.pickHere.title = pickDir;
  newEls.pickUp.disabled = pickDir === "/";
  newEls.pickList.innerHTML = "";

  let info;
  try {
    /* all=1 matters here: the tree hides folders that hold no readable
       document, and an empty folder is a perfectly good place to put the first
       one. */
    const query = {path: pickDir, all: "1"};
    if (S.showHidden) query.hidden = "1";
    info = await api("/api/list", {query});
  } catch (err) {
    pickerMessage(err.message);
    return;
  }
  if (pickDir !== info.path) pickDir = info.path;

  const dirs = (info.entries || []).filter((e) => e.type === "dir");
  if (!dirs.length) {
    pickerMessage("No folders inside this one.");
    return;
  }
  dirs.forEach((entry) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.path = entry.path;
    btn.title = entry.path;
    btn.innerHTML = ICONS.folder + '<span class="nm"></span>';
    btn.querySelector(".nm").textContent = entry.name;
    li.appendChild(btn);
    newEls.pickList.appendChild(li);
  });
}

function pickerMessage(text) {
  newEls.pickList.innerHTML = "";
  const li = document.createElement("li");
  li.className = "nd-pick-msg";
  li.textContent = text;
  newEls.pickList.appendChild(li);
}

function closeNewDoc() {
  newEls.scrim.hidden = true;
  newEls.ok.disabled = false;
  if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
}

/* The document itself is written only here, by Create or by Return in the field,
   which is the same button. The one thing that can touch the disk earlier is the
   native chooser's own New Folder button, which is a deliberate separate act. */
async function doCreateNewDoc() {
  const name = newEls.input.value.trim();
  if (!name) return;
  const dir = newDocDir || newDocFolder();

  newEls.ok.disabled = true;
  let res;
  try { res = await api("/api/create", {method: "POST", body: {dir, name}}); }
  catch (err) {
    newEls.ok.disabled = false;
    newEls.note.textContent = err.message;      // stays open to be corrected
    newEls.input.focus();
    newEls.input.select();
    return;
  }
  closeNewDoc();

  /* The tree is holding a listing from before the file existed, so drop it or
     the new document will not appear in the redraw. */
  state.children.delete(dir);
  await drawTree();
  await openFile(res.path);
  toast("Created " + res.name);
}

newEls.input.addEventListener("input", () => {
  newEls.ok.disabled = !newEls.input.value.trim();
  if (newEls.note.textContent !== NEW_DOC_HINT) newEls.note.textContent = NEW_DOC_HINT;
});
newEls.input.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") { ev.preventDefault(); doCreateNewDoc(); }
});
newEls.ok.addEventListener("click", () => doCreateNewDoc());
newEls.cancel.addEventListener("click", () => closeNewDoc());
newEls.change.addEventListener("click", () => startChoosingFolder());
newEls.pickBack.addEventListener("click", () => { showNewDocForm(); newEls.input.focus(); });
newEls.pickUse.addEventListener("click", async () => {
  const chosen = pickDir;
  showNewDocForm();
  newEls.input.focus();
  await adoptFolder(chosen);
});
newEls.pickUp.addEventListener("click", () => {
  const parent = pickDir.split("/").slice(0, -1).join("/") || "/";
  pickDir = parent;
  drawPicker();
});
newEls.pickList.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-path]");
  if (!btn) return;
  pickDir = btn.dataset.path;
  drawPicker();
});
newEls.scrim.addEventListener("mousedown", (ev) => {
  if (ev.target === newEls.scrim) closeNewDoc();
});

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

/* ---------------------------------------------------------- move a file */

const parentPath = (path) => path.split("/").slice(0, -1).join("/") || "/";

async function moveFileToFolder(path, targetDir, {quiet = false, throwOnError = false} = {}) {
  if (parentPath(path) === targetDir) {
    return {path, newPath: path, name: path.split("/").pop()};
  }
  let res;
  try {
    res = await api("/api/move", {
      method: "POST", body: {path, targetDir},
    });
  } catch (err) {
    if (throwOnError) throw err;
    if (!quiet) toast(err.message, true);
    return null;
  }

  const from = res.path || path;
  const to = res.newPath;
  const moved = (p) => p === from ? to : p;
  S.recents = (S.recents || []).map((r) => {
    const np = moved(r.path);
    return np === r.path ? r
      : {path: np, name: np.split("/").pop(),
         dir: np.split("/").slice(0, -1).join("/") || "/"};
  });
  if (S.lastFile === from) S.lastFile = to;
  state.trail = state.trail.map((entry) => {
    const np = moved(entry.path);
    return np === entry.path ? entry : {...entry, path: np};
  });

  if (state.file && state.file.path === from) {
    state.file.path = to;
    state.file.dir = parentPath(to);
    state.file.name = to.split("/").pop();
    el.docname.textContent = state.file.name;
    document.title = (state.dirty ? "• " : "") + state.file.name;
  }
  syncTrailButtons();
  state.children.clear();
  savePrefs();
  drawRecents();
  await drawTree();
  markActive();
  if (!quiet) toast(`${prettyName(from)} moved to ${prettyName(targetDir)}`);
  return res;
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

/* Proportional sync (same scroll FRACTION on both sides) only lines up when
   source and rendered output have the same density profile -- a table, a code
   fence or a wrapped paragraph throws every line after it out of register.
   Sync instead pins markdown blocks to their source lines and interpolates
   between those anchors, so what is at the top of one pane is what is at the
   top of the other. Non-markdown documents keep the proportional fallback. */

function buildAnchors(text) {
  /* marked's lexer exposes no positions, but every token carries its raw
     slice, so cumulative newline counts recover each block's start line.
     Top-level tokens map to the preview's top-level children in order. */
  let line = 0;
  const blocks = [];
  for (const tok of markdownTokens(text || "")) {
    if (tok.type !== "space") blocks.push(line);
    line += (tok.raw.match(/\n/g) || []).length;
  }
  const kids = el.preview.children;
  const anchors = [];
  for (let i = 0; i < blocks.length && i < kids.length; i++) {
    anchors.push({line: blocks[i], el: kids[i]});
  }
  return anchors.length >= 2 ? anchors : null;
}

function invalidateSyncMaps() {
  state.editorTops = null;
  state.previewTops = null;
}

/* Where each source line starts vertically in the textarea. A textarea lays
   each newline-separated line out as its own wrapped block, so a mirror with
   one div per line, in the textarea's own metrics, measures the real
   positions -- soft wrap included. Rebuilt lazily after edits and resizes. */
function editorTops() {
  if (state.editorTops) return state.editorTops;
  const cs = getComputedStyle(el.editor);
  const m = document.createElement("div");
  m.style.cssText =
    "position:absolute;visibility:hidden;left:-99999px;top:0;" +
    `width:${el.editor.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px;` +
    `font-family:${cs.fontFamily};font-size:${cs.fontSize};line-height:${cs.lineHeight};` +
    `letter-spacing:${cs.letterSpacing};tab-size:${cs.tabSize};` +
    "white-space:pre-wrap;overflow-wrap:break-word;";
  for (const ln of el.editor.value.split("\n")) {
    const d = document.createElement("div");
    d.textContent = ln || "​";
    m.appendChild(d);
  }
  document.body.appendChild(m);
  const padTop = parseFloat(cs.paddingTop);
  state.editorTops = [...m.children].map((d) => padTop + d.offsetTop);
  m.remove();
  return state.editorTops;
}

function previewAnchorTops() {
  if (state.previewTops) return state.previewTops;
  const paneTop = el.previewpane.getBoundingClientRect().top;
  const base = el.previewpane.scrollTop;
  state.previewTops = state.lineAnchors.map(
    (a) => a.el.getBoundingClientRect().top - paneTop + base);
  return state.previewTops;
}

function syncTarget(from, to) {
  const mapped = state.file && state.file.kind === "md" && state.lineAnchors;
  if (!mapped) return scrollRatio(from) * maxScroll(to);

  const fromEd = from === el.editor;
  const eTops = editorTops();
  const pTops = previewAnchorTops();
  const pairs = [[0, 0]];
  state.lineAnchors.forEach((a, i) => {
    const e = eTops[Math.min(a.line, eTops.length - 1)];
    pairs.push(fromEd ? [e, pTops[i]] : [pTops[i], e]);
  });
  pairs.push(fromEd ? [maxScroll(el.editor), maxScroll(el.previewpane)]
                    : [maxScroll(el.previewpane), maxScroll(el.editor)]);

  /* keep the map monotonic: a stray measurement must not make scroll jump back */
  const mono = [];
  for (const p of pairs) {
    const last = mono[mono.length - 1];
    if (!last || (p[0] > last[0] && p[1] >= last[1])) mono.push(p);
  }

  const x = from.scrollTop;
  let y = mono[mono.length - 1][1];
  if (x <= mono[0][0]) y = mono[0][1];
  else {
    for (let i = 1; i < mono.length; i++) {
      if (x <= mono[i][0]) {
        const [x0, y0] = mono[i - 1], [x1, y1] = mono[i];
        y = y0 + ((x - x0) / (x1 - x0 || 1)) * (y1 - y0);
        break;
      }
    }
  }
  return Math.max(0, Math.min(y, maxScroll(to)));
}

/* A scroll event raised by assigning the other pane's scrollTop may arrive
   after the current event handler returns. A one-frame boolean is therefore
   too short-lived: with uneven content such as tables, the second event can
   be mistaken for a new user scroll and feed back into the first pane. Keep
   the expected target until that exact propagated event is observed instead. */
const SCROLL_SYNC_EPSILON = 1;
let syncing = null;
function linkScroll(from, to) {
  from.addEventListener("scroll", () => {
    if (!S.syncScroll || root.dataset.mode !== "split") {
      syncing = null;
      return;
    }

    /* Swallow only the scroll event caused by our own correction. If the
       value differs materially, the user moved this pane while a correction
       was pending, so let it become the new source of truth. */
    if (syncing) {
      const propagated = syncing.node === from &&
        Math.abs(from.scrollTop - syncing.top) <= SCROLL_SYNC_EPSILON;
      syncing = null;
      if (propagated) return;
    }

    const target = syncTarget(from, to);
    if (Math.abs(to.scrollTop - target) <= SCROLL_SYNC_EPSILON) return;
    syncing = {node: to, top: target};
    to.scrollTop = target;
  }, {passive: true});
}
linkScroll(el.editor, el.previewpane);
linkScroll(el.previewpane, el.editor);
new ResizeObserver(invalidateSyncMaps).observe(el.editor);
new ResizeObserver(() => { state.previewTops = null; }).observe(el.previewpane);

function setMode(mode) {
  if (state.file && state.file.kind === "pdf" && mode !== "preview") return;
  S.mode = mode;
  root.dataset.mode = mode;
  savePrefs();
  hideFmtBar();
  if (mode !== "preview") setTimeout(() => el.editor.focus(), 0);
}
/* The corner button reads differently by state: the toolbar one only ever
   reveals; the panel's own one hides when pinned, pins when only peeking. */
function syncPanelButtons() {
  const set = (id, label) => {
    $(id).title = label;
    $(id).setAttribute("aria-label", label);
  };
  set("btn-show", "Show panel (⌘\\)");
  set("btn-panel", S.hidden ? "Pin panel open" : "Hide panel (⌘\\)");
}

function toggleSidebar(force) {
  S.hidden = force !== undefined ? force : !S.hidden;
  root.dataset.sidebar = S.hidden ? "hidden" : "shown";
  root.classList.remove("peek");
  syncPanelButtons();
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
    case "bodyWeight": return String(v);
    case "lineHeight": return v.toFixed(2);
    case "measure": return v >= MEASURE.max ? "Full" : v + "%";
    case "paraGap": return v.toFixed(2) + " em";
    case "listGap": return v.toFixed(2) + " em";
    case "titleSize": return v + " px";
    case "titleWeight": return String(v);
    case "titleLineHeight": return v.toFixed(2);
    case "titleSpacing": return v.toFixed(3) + " em";
    case "headSizeScale": return Math.round(v * 100) + " %";
    case "headCapScale": return Math.round(v * 100) + " %";
    case "titleCapScale": return Math.round(v * 100) + " %";
    case "headWeight": return v == null ? "Default" : String(v);
    case "headLineHeight": return v == null ? "Default" : Number(v).toFixed(2);
    case "headSpacing": return v == null ? "Default" : Number(v).toFixed(3) + " em";
    case "headGap": return v == null ? "Default" : Number(v).toFixed(2) + " em";
    case "headGapAfter": return v == null ? "Default" : Number(v).toFixed(2) + " em";
    case "codeScale": return Math.round(v * 100) + " %";
    default: return String(v);
  }
}

function setValue(key, value) {
  /* null clears an optional override (the "Default" position of null-min
     sliders); Number(null) would silently turn that into 0. */
  S[key] = value == null ? null : NUMERIC.has(key) ? Number(value) : value;
  applySettings();
  savePrefs();
  syncDialog();
  if (key === "recentCount") drawRecents();
  if (key === "watchMs" || key === "autoRefresh") restartWatch();
  if (key === "showAllDirs" || key === "showAllFiles" || key === "showHidden") refreshTree();
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
    /* "null-min" sliders use their minimum value to mean the built-in default.
       This gives optional heading overrides a natural reset position. */
    const nullMin = r.closest(".slider")?.dataset.nullmin === key;
    if (nullMin && S[key] == null) r.value = r.min;
    else r.value = String(S[key]);
    const out = document.querySelector(`.val[data-val="${key}"]`);
    if (out) {
      if (nullMin && S[key] == null && Number(r.value) === Number(r.min)) {
        out.textContent = "Default";
      } else out.textContent = labelFor(key, Number(r.value));
    }
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
  if (r) {
    const key = r.dataset.set;
    const nullMin = r.closest(".slider")?.dataset.nullmin === key;
    /* Sliding off the minimum clears an override and returns to built-in defaults. */
    setValue(key, nullMin && Number(r.value) <= Number(r.min) ? null : r.value);
    return;
  }
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
  if (type === "file") {
    if (btn.dataset.sup === "0") {
      if (EXT_APP.has(extOf(path))) openExternal(path);
      else toast("Reader cannot open this kind of file", true);
      return;
    }
    openFile(path);
    return;
  }
  const li = btn.closest("li");
  if (state.expanded.has(path)) collapse(li, path);
  else { state.expanded.add(path); await expand(li, path, 0); }
});
el.tree.addEventListener("dblclick", (ev) => {
  const btn = ev.target.closest('.row[data-type="dir"]');
  if (btn) setRoot(btn.dataset.path);
});
el.tree.addEventListener("dragstart", (ev) => {
  const btn = ev.target.closest(".row[data-path]");
  if (!btn) return;
  const mime = btn.dataset.type === "dir" ? DIR_MIME : FILE_MIME;
  ev.dataTransfer.setData(mime, btn.dataset.path);
  ev.dataTransfer.setData("text/plain", btn.dataset.path);
  ev.dataTransfer.effectAllowed = btn.dataset.type === "dir" ? "copy" : "move";
});
function clearTreeDropMarks() {
  el.tree.querySelectorAll(".drop-target").forEach((n) => n.classList.remove("drop-target"));
}
/* A file drop belongs to the folder showing it. If the row under the cursor
   is itself a folder, that folder is the target; otherwise the nearest
   visible, loaded parent folder accepts the drop, so users do not have to
   thread the pointer onto the narrow folder heading. */
function treeDropFolder(row) {
  if (!row) return null;
  if (row.dataset.type === "dir") return row.dataset.path;
  const parentLi = row.closest("li")?.parentElement?.closest("li");
  if (!parentLi) return null;
  const parentRow = parentLi.querySelector(":scope > .rowline > .row[data-type='dir']");
  const kids = parentLi.querySelector(":scope > ul");
  if (!parentRow || !kids || kids.hidden) return null;
  return parentRow.dataset.path;
}
el.tree.addEventListener("dragover", (ev) => {
  if (![...ev.dataTransfer.types].includes(FILE_MIME)) {
    clearTreeDropMarks();
    return;
  }
  const folderPath = treeDropFolder(ev.target.closest(".row[data-path]"));
  if (!folderPath) {
    clearTreeDropMarks();
    return;
  }
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "move";
  clearTreeDropMarks();
  el.tree.querySelector(`.row[data-path="${CSS.escape(folderPath)}"]`)
    .classList.add("drop-target");
});
el.tree.addEventListener("dragleave", (ev) => {
  const row = ev.target.closest(".row[data-path]");
  if (row && !row.contains(ev.relatedTarget)) row.classList.remove("drop-target");
});
el.tree.addEventListener("drop", (ev) => {
  const path = ev.dataTransfer.getData(FILE_MIME);
  const folderPath = treeDropFolder(ev.target.closest(".row[data-path]"));
  if (!path || !folderPath) return;
  ev.preventDefault();
  clearTreeDropMarks();
  moveFileToFolder(path, folderPath);
});
el.tree.addEventListener("dragend", clearTreeDropMarks);
el.tree.addEventListener("contextmenu", (ev) => {
  const btn = ev.target.closest("#tree .row");
  if (!btn) return;
  ev.preventDefault();
  openRowMenu({x: ev.clientX, y: ev.clientY}, btn.dataset.path, btn.dataset.type);
});

el.preview.addEventListener("change", (ev) => {
  const box = ev.target;
  if (!(box instanceof HTMLInputElement) || box.type !== "checkbox") return;
  if (!box.parentElement || !box.parentElement.classList.contains("task-list-item")) return;
  if (toggleTask(box)) return;
  box.checked = !box.checked;
  toast("That task could not be matched to a line in the file.", true);
});

el.preview.addEventListener("click", (ev) => {
  const a = ev.target.closest("a");
  if (!a) return;
  const href = a.getAttribute("href") || "";
  if (href.startsWith("#")) {
    ev.preventDefault();
    const target = el.preview.querySelector("#" + CSS.escape(href.slice(1)));
    if (target) {
      revealFolds(target);
      target.scrollIntoView({behavior: "smooth", block: "start"});
    }
    return;
  }
  if (a.dataset.local) {
    ev.preventDefault();
    /* A link to a Word or Excel document opens in the app that owns it;
       everything Reader renders itself opens in place as before. */
    if (EXT_APP.has(extOf(a.dataset.local))) openExternal(a.dataset.local);
    else openFile(a.dataset.local);
  }
});

el.editor.addEventListener("input", () => {
  const dirty = el.editor.value !== state.saved;
  setDirty(dirty);
  scheduleRender();
  historyNoteTyping();
  if (dirty) scheduleAutosave();
});
/* These commands belong to the textarea and to the platform, not to Reader's
   document-wide shortcut layer. Undo/redo stay out of this list because
   Reader deliberately owns that history across preview quick-edits and the
   editor. */
const NATIVE_TEXT_COMMANDS = new Set(["a", "c", "v", "x"]);
function isNativeTextCommand(ev) {
  return (ev.metaKey || ev.ctrlKey) && !ev.altKey &&
         NATIVE_TEXT_COMMANDS.has(ev.key.toLowerCase());
}

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

/* Copy the whole document, keeping its formatting. The clipboard carries two
   flavours at once: rich targets (Word, Docs, Slack, mail) take the rendered
   HTML, plain targets take the source exactly as written. Code files have no
   rendered form worth copying, so they go over as plain text only. */
async function copyDocument() {
  if (!state.file) return;
  const plain = el.editor.value;
  try {
    const rich = state.file.kind !== "code" &&
                 navigator.clipboard.write && window.ClipboardItem;
    if (rich) {
      /* strip the session token that image URLs carry inside the app --
         it has no business travelling along on a clipboard */
      const copy = el.preview.cloneNode(true);
      copy.querySelectorAll("img[src]").forEach((img) =>
        img.setAttribute("src", img.src.split("?")[0]));
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob(['<meta charset="utf-8">' + copy.innerHTML],
                              {type: "text/html"}),
        "text/plain": new Blob([plain], {type: "text/plain"}),
      })]);
      toast("Copied with formatting");
    } else {
      await navigator.clipboard.writeText(plain);
      toast("Copied");
    }
  } catch (err) {
    toast("Copy failed: " + (err.message || err), true);
  }
}
$("btn-copy").onclick = copyDocument;
$("btn-refresh").onclick = refresh;
$("btn-theme").onclick = cycleTheme;
$("btn-full").onclick = toggleFullscreen;
/* One control in two homes, and both toggle. A peek shows the panel without
   clearing S.hidden, so toggleSidebar's own read of the pinned state is the
   right one -- clicking the panel's corner button mid-peek pins, it does not
   hide; clicking it while pinned puts the panel away. */
$("btn-show").onclick = () => toggleSidebar();
$("btn-panel").onclick = () => toggleSidebar();

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
  return !el.menu.hidden || renamerOpen() || confirmOpen() || settingsOpen()
         || newDocOpen();
}

/* ⌘+ and ⌘- resize whatever text the main pane is showing. For markdown that
   is the body size: headings, inline code and fences are all sized in em, so
   the whole page scales together. Code documents and the editor share the
   monospace size instead. ⌘0 returns to the default. The sliders in Settings
   move live, since this drives the same setting. */
const SIZE_STEP = 1;
const SIZE_RANGE = {fontSize: {min: 13, max: 26}, editorSize: {min: 11, max: 22}};

function sizeTarget() {
  if (!state.file || state.file.kind === "pdf") return null;
  const codeDoc = el.preview.classList.contains("codeview");
  return codeDoc || root.dataset.mode === "edit" ? "editorSize" : "fontSize";
}

function adjustTextSize(delta) {
  const key = sizeTarget();
  if (!key) return;
  const {min, max} = SIZE_RANGE[key];
  const value = delta == null ? DEFAULTS[key]
                              : Math.min(max, Math.max(min, S[key] + delta));
  setValue(key, value);
  toast((key === "fontSize" ? "Text size " : "Code size ") + value + " px");
}

/* --------------------------------------------------------------------------
   Global shortcuts. One listener, in claim order:
     1. Escape        -- closes the topmost open surface, nothing else
     2. Find          -- ⌘F / ⌘G, claimed even while the find field has focus
     3. Native text   -- standard editing commands pass through untouched
     4. Navigation    -- arrows and ⌘[ ⌘] move through the document trail
     5. Formatting    -- ⌘B/I/U on a selection, in preview or editor
     6. History       -- ⌘Z / ⇧⌘Z / ⌘Y on our own undo stack
     7. App chords    -- everything else ⌘-something, one else-if chain
   -------------------------------------------------------------------------- */

document.addEventListener("keydown", (ev) => {
  /* 1. Escape closes the topmost open surface. */
  if (ev.key === "Escape") {
    if (fileFind.open) { ev.preventDefault(); fileFindCloseBar(); return; }
    if (find.open) { ev.preventDefault(); findCloseBar(); return; }
    if (!el.fmtbar.hidden) { ev.preventDefault(); hideFmtBar(); return; }
    if (!el.menu.hidden) { ev.preventDefault(); closeMenu(); return; }
    if (newDocOpen() && pickerOpen()) {
      ev.preventDefault(); showNewDocForm(); newEls.input.focus(); return;
    }
    if (newDocOpen()) { ev.preventDefault(); closeNewDoc(); return; }
    if (renamerOpen()) { ev.preventDefault(); closeRenamer(); return; }
    if (confirmOpen()) { ev.preventDefault(); closeConfirm(); return; }
    if (settingsOpen()) { ev.preventDefault(); closeSettings(); return; }
  }
  const meta = ev.metaKey || ev.ctrlKey;

  /* 2. Find. Claimed before the native-text bail below so it still works while
     the caret is sitting in the find field. ⌃⌘F is full screen and stays so. */
  if (meta && !ev.ctrlKey && ev.key.toLowerCase() === "f" && !ev.altKey && !overlayOpen()) {
    /* Which search you get depends on what you were working in. Focus inside
       the file panel -- including its own search field -- means "find a file";
       anywhere else means "find in this document". */
    if (state.surface === "panel" || fileFind.open) {
      ev.preventDefault(); fileFindOpen(); return;
    }
    if (findOpen()) { ev.preventDefault(); return; }
  }
  if (meta && ev.key.toLowerCase() === "g" && find.open) {
    ev.preventDefault(); findStep(ev.shiftKey ? -1 : 1); return;
  }

  /* 3. Let the browser/WebKit own standard text commands completely. In
     particular, paste's native default action must survive the event path;
     stopping propagation at the textarea prevents it in WKWebView. */
  if (meta && editingText() && isNativeTextCommand(ev)) return;

  /* 4. Back and forward. Bare arrows while reading; they are left alone when
     the caret owns them or a dialog is up. ⌘[ and ⌘] work everywhere, incl.
     the editor -- unlike ⌘←/⌘→, which macOS uses for start and end of line. */
  const arrow = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0;
  if (arrow && !meta && !ev.altKey && !ev.shiftKey && !editingText() && !overlayOpen()) {
    ev.preventDefault(); trailGo(arrow); return;
  }
  if (meta && !ev.altKey && (ev.key === "[" || ev.key === "]") && !overlayOpen()) {
    ev.preventDefault(); trailGo(ev.key === "[" ? -1 : 1); return;
  }

  if (!meta) return;

  /* 4b. Collapsing sections. ⌥⌘[ and ⌥⌘] fold and unfold the section being
     read, ⌥⌘1-6 fold the document to a heading level and ⌥⌘0 opens it all. */
  if (ev.altKey && !overlayOpen() && foldAvailable()) {
    const chord = altChord(ev);
    if (chord === "[" || chord === "]") {
      ev.preventDefault(); foldAtReadingPoint(chord === "["); return;
    }
    if (chord) { ev.preventDefault(); foldToLevel(Number(chord)); return; }
  }

  const k = ev.key.toLowerCase();

  /* 5. ⌘B/I/U format a preview or editor selection. Only claimed when there
     is one to format, so the browser keeps these keys the rest of the time. */
  if ("biu".includes(k) && quickEditable() && previewSelection()) {
    ev.preventDefault();
    applyInline(k === "b" ? "bold" : k === "i" ? "italic" : "underline");
    return;
  }
  if ("biu".includes(k) && editorActive() && editorSelection()) {
    ev.preventDefault();
    applyInlineInEditor(k === "b" ? "bold" : k === "i" ? "italic" : "underline");
    return;
  }

  /* 6. Undo and redo, in any mode -- a quick edit made in the preview is
     undone by the same key as a keystroke in the editor. Left alone while a
     rename box or a settings field has the caret, where undo is the field's. */
  const ownField = editingText() && document.activeElement !== el.editor;
  if ((k === "z" || k === "y") && !ownField && !overlayOpen()) {
    ev.preventDefault();         // our stack owns undo; the native one is stale
    historyGo(k === "y" || ev.shiftKey ? 1 : -1);
    return;
  }

  /* 7. App chords. */
  /* file */
  if (k === "s") { ev.preventDefault(); saveFile(); }
  else if (k === "r" && !ev.shiftKey) { ev.preventDefault(); refresh(); }
  /* view */
  else if (k === "e") { ev.preventDefault(); setMode(root.dataset.mode === "edit" ? "preview" : "edit"); }
  else if (k === "\\") { ev.preventDefault(); toggleSidebar(); }
  else if (k === "f" && ev.ctrlKey && ev.metaKey) { ev.preventDefault(); toggleFullscreen(); }
  /* text size: ⌘= is the physical ⌘+ key, and both ⌘⇧= and the keypad send
     "+"; ⌘- reads "_" with shift held. ⌘0 goes back to the default size. */
  else if (k === "=" || k === "+") { ev.preventDefault(); adjustTextSize(SIZE_STEP); }
  else if (k === "-" || k === "_") { ev.preventDefault(); adjustTextSize(-SIZE_STEP); }
  else if (k === "0") { ev.preventDefault(); adjustTextSize(null); }
  /* app */
  else if (k === ",") { ev.preventDefault(); settingsOpen() ? closeSettings() : openSettings(); }
  else if (k === "n" && !ev.shiftKey && !ev.altKey) { ev.preventDefault(); openNewDoc(); }
  /* ⌘⇧. mirrors Finder's shortcut for hidden files. Shift turns "." into ">"
     on most layouts, so match the physical key as well as both characters. */
  else if (ev.shiftKey && (k === "." || k === ">" || ev.code === "Period")) {
    ev.preventDefault();
    setValue("showHidden", !S.showHidden);
    toast(S.showHidden ? "Hidden files shown" : "Hidden files hidden");
  }
});

/* ==========================================================================
   Find a file -- the panel's own search
   --------------------------------------------------------------------------
   Names are matched by the server, because the answer has to include files in
   folders that were never expanded. The walk there is bounded; a truncated
   result says so rather than quietly pretending to be the whole answer.
   ========================================================================== */

function noteSurface(ev) {
  const node = ev.target;
  if (!(node instanceof Node)) return;
  state.surface = el.sidebar.contains(node) ? "panel" : "document";
}
document.addEventListener("pointerdown", noteSurface, true);
document.addEventListener("focusin", noteSurface, true);

const fileFind = {open: false, results: [], at: -1, seq: 0};
let fileFindTimer = null;

function fileFindOpen() {
  fileFind.open = true;
  el.fileFind.hidden = false;
  el.fileFindQ.focus();
  el.fileFindQ.select();
  if (el.fileFindQ.value.trim()) fileFindRun();
  else fileFindShowTree();
}

function fileFindShowTree() {
  el.fileFindList.hidden = true;
  el.fileFindList.innerHTML = "";
  el.tree.hidden = false;
  el.fileFindQ.setAttribute("aria-expanded", "false");
  fileFind.results = [];
  fileFind.at = -1;
}

function fileFindCloseBar() {
  fileFind.open = false;
  el.fileFind.hidden = true;
  el.fileFindQ.value = "";
  fileFindShowTree();
}

async function fileFindRun() {
  const q = el.fileFindQ.value.trim();
  if (!q) { fileFindShowTree(); return; }
  const mine = ++fileFind.seq;         // a slower earlier reply must not land
  let data;
  try {
    data = await api("/api/search", {query: fileFindQuery(q)});
  } catch (err) {
    if (mine !== fileFind.seq) return;
    fileFindMessage(err.message);
    return;
  }
  if (mine !== fileFind.seq) return;
  fileFind.results = data.matches || [];
  fileFind.at = fileFind.results.length ? 0 : -1;
  fileFindDraw(data.truncated);
}

function fileFindQuery(q) {
  const query = {path: state.root || HOME, q};
  if (S.showAllFiles) query.files = "1";
  if (S.showHidden) query.hidden = "1";
  return query;
}

function fileFindMessage(text) {
  el.tree.hidden = true;
  el.fileFindList.hidden = false;
  el.fileFindList.innerHTML = "";
  const li = document.createElement("li");
  li.className = "msg";
  li.textContent = text;
  el.fileFindList.appendChild(li);
}

function fileFindDraw(truncated) {
  el.tree.hidden = true;
  el.fileFindList.hidden = false;
  el.fileFindQ.setAttribute("aria-expanded", "true");
  el.fileFindList.innerHTML = "";

  if (!fileFind.results.length) {
    fileFindMessage("No file matches that name.");
    return;
  }

  fileFind.results.forEach((entry, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    const btn = document.createElement("button");
    btn.className = "row" + (entry.supported === false ? " unsupported" : "");
    btn.dataset.path = entry.path;
    btn.dataset.hit = String(i);
    btn.title = entry.path;
    btn.setAttribute("aria-selected", i === fileFind.at ? "true" : "false");
    btn.innerHTML = ICONS.spacer + iconFor(entry.path) +
                    '<span class="grow"><span class="nm"></span>' +
                    '<span class="where"></span></span>';
    btn.querySelector(".nm").textContent = entry.name;
    btn.querySelector(".where").textContent = prettyDir(entry.dir);
    li.appendChild(btn);
    el.fileFindList.appendChild(li);
  });

  if (truncated) {
    const li = document.createElement("li");
    li.className = "msg";
    li.textContent = "Showing the first matches — narrow the name for more.";
    el.fileFindList.appendChild(li);
  }
  fileFindScrollTo();
}

/* The folder a match lives in, kept short enough to read. Trimmed from the
   left, because the end of a path is what tells two same-named files apart --
   done here rather than with direction:rtl, which reorders the leading "~/" to
   the far end and makes the path read as nonsense. */
const DIR_BUDGET = 44;
function prettyDir(dir) {
  if (!dir) return "";
  let shown = dir;
  if (HOME && dir === HOME) return "Home";
  if (HOME && dir.startsWith(HOME + "/")) shown = "~/" + dir.slice(HOME.length + 1);
  if (shown.length <= DIR_BUDGET) return shown;
  const tail = shown.slice(shown.length - DIR_BUDGET);
  const cut = tail.indexOf("/");                 // start at a folder boundary
  return "…/" + (cut >= 0 ? tail.slice(cut + 1) : tail);
}

function fileFindPaint() {
  el.fileFindList.querySelectorAll(".row").forEach((row) => {
    row.setAttribute("aria-selected", Number(row.dataset.hit) === fileFind.at ? "true" : "false");
  });
  fileFindScrollTo();
}

function fileFindScrollTo() {
  const row = el.fileFindList.querySelector('.row[aria-selected=true]');
  if (row) row.scrollIntoView({block: "nearest"});
}

function fileFindStep(delta) {
  if (!fileFind.results.length) return;
  fileFind.at = (fileFind.at + delta + fileFind.results.length) % fileFind.results.length;
  fileFindPaint();
}

/* Opening a match also moves the tree to the folder that holds it, so the panel
   is showing where you have just arrived rather than where you started. */
async function fileFindPick(index) {
  const entry = fileFind.results[index];
  if (!entry) return;
  if (entry.supported === false) {
    if (EXT_APP.has(extOf(entry.path))) openExternal(entry.path);
    else toast("Reader cannot open that file.", true);
    return;
  }
  const dir = entry.dir || entry.path.split("/").slice(0, -1).join("/");
  fileFindCloseBar();
  if (dir && dir !== state.root) {
    await setRoot(dir, {redraw: false});
    await drawTree();
  }
  await openFile(entry.path);
}

el.fileFindQ.addEventListener("input", () => {
  clearTimeout(fileFindTimer);
  fileFindTimer = setTimeout(fileFindRun, 160);
});
el.fileFindQ.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown") { ev.preventDefault(); fileFindStep(1); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); fileFindStep(-1); }
  else if (ev.key === "Enter") { ev.preventDefault(); fileFindPick(fileFind.at); }
  else if (ev.key === "Escape") { ev.preventDefault(); fileFindCloseBar(); }
});
el.fileFindClose.addEventListener("click", () => fileFindCloseBar());
el.fileFindList.addEventListener("click", (ev) => {
  const row = ev.target.closest(".row");
  if (row) fileFindPick(Number(row.dataset.hit));
});

/* ==========================================================================
   Find in document
   --------------------------------------------------------------------------
   Matches are wrapped in <mark> after the document is rendered. The Custom
   Highlight API would avoid touching the DOM at all, but it only arrived in
   Safari 17.2 and Reader supports macOS 13, so wrapping is what works
   everywhere. Every wrap is undone before a re-render, so nothing downstream
   ever meets these nodes.
   ========================================================================== */

const find = {open: false, hits: [], at: -1};
let findTimer = null;

/* Undo every wrap and stitch the split text nodes back together, so repeated
   searches cannot leave the document a shrapnel of fragments. */
function findClear() {
  const marks = el.preview.querySelectorAll("mark.find-hit");
  const parents = new Set();
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parents.add(parent);
  });
  parents.forEach((parent) => parent.normalize());
  find.hits = [];
  find.at = -1;
}

/* Flatten the preview's text so a match can span inline mark-up -- "**one** two"
   is two text nodes, and searching for "one two" should still find it. */
function findWrap(needle) {
  const nodes = [];
  let flat = "";
  const walker = document.createTreeWalker(el.preview, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement && node.parentElement.closest(".gutter")
        ? NodeFilter.FILTER_REJECT      // code view line numbers are not content
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({node, from: flat.length});
    flat += node.nodeValue;
  }

  const hay = flat.toLowerCase();
  const cuts = [];
  let at = 0, index = 0, cursor = 0;
  for (;;) {
    const start = hay.indexOf(needle, at);
    if (start < 0) break;
    const stop = start + needle.length;
    /* Matches arrive in order, so the node cursor only ever moves forward --
       this stays linear over the document instead of rescanning every node. */
    while (cursor < nodes.length &&
           nodes[cursor].from + nodes[cursor].node.nodeValue.length <= start) cursor++;
    for (let i = cursor; i < nodes.length && nodes[i].from < stop; i++) {
      const {node, from} = nodes[i];
      cuts.push({
        node, index,
        start: Math.max(start - from, 0),
        end: Math.min(stop - from, node.nodeValue.length),
      });
    }
    index++;
    at = stop;                          // matches never overlap
  }

  /* Applied back to front within each node: splitting the tail first leaves
     every earlier offset in that node still valid. */
  const perNode = new Map();
  cuts.forEach((cut) => {
    if (!perNode.has(cut.node)) perNode.set(cut.node, []);
    perNode.get(cut.node).push(cut);
  });
  const made = new Map();
  perNode.forEach((list, node) => {
    list.sort((a, b) => b.start - a.start);
    list.forEach((cut) => {
      const tail = node.splitText(cut.start);
      if (cut.end - cut.start < tail.nodeValue.length) tail.splitText(cut.end - cut.start);
      const mark = document.createElement("mark");
      mark.className = "find-hit";
      tail.parentNode.insertBefore(mark, tail);
      mark.appendChild(tail);
      if (!made.has(cut.index)) made.set(cut.index, []);
      made.get(cut.index).push(mark);
    });
  });

  return [...made.keys()].sort((a, b) => a - b).map((key) => made.get(key));
}

function findPaint() {
  el.preview.querySelectorAll("mark.find-hit.is-current")
    .forEach((mark) => mark.classList.remove("is-current"));
  if (find.at >= 0 && find.hits[find.at]) {
    find.hits[find.at].forEach((mark) => mark.classList.add("is-current"));
  }
  const typed = el.findQ.value.trim();
  el.findCount.textContent = find.hits.length
    ? `${find.at + 1} of ${find.hits.length}`
    : (typed ? "No matches" : "");
  el.findPrev.disabled = el.findNext.disabled = find.hits.length < 2;
}

function findRun({keepPlace = false} = {}) {
  const was = keepPlace ? find.at : -1;
  findClear();
  const needle = el.findQ.value.trim().toLowerCase();
  if (needle) find.hits = findWrap(needle);
  find.at = find.hits.length ? Math.min(Math.max(was, 0), find.hits.length - 1) : -1;
  findPaint();
  if (!keepPlace && find.hits.length) findReveal();
}

function findReveal() {
  const mark = find.hits[find.at] && find.hits[find.at][0];
  if (!mark) return;
  /* a match under a collapsed heading opens it: being told there are matches
     and shown none of them is worse than losing the fold */
  revealFolds(mark);
  mark.scrollIntoView({block: "center", behavior: "smooth"});
}

function findStep(delta) {
  if (!find.hits.length) return;
  find.at = (find.at + delta + find.hits.length) % find.hits.length;
  findPaint();
  findReveal();
}

/* Only meaningful where there is a rendered document to search: in Edit mode
   the preview is not on screen, so the key is left to the browser. */
function findAvailable() {
  return !!state.file && state.file.kind !== "pdf" &&
         root.dataset.mode !== "edit" && root.dataset.empty !== "yes";
}

function findOpen() {
  if (!findAvailable()) return false;
  find.open = true;
  el.findbar.hidden = false;
  el.findQ.focus();
  el.findQ.select();
  if (el.findQ.value.trim()) findRun();
  else findPaint();
  return true;
}

function findCloseBar() {
  find.open = false;
  el.findbar.hidden = true;
  findClear();
  findPaint();
}

/* A re-render replaces the preview wholesale, taking the marks with it. */
function findRefresh() {
  if (!find.open) return;
  if (!findAvailable()) { findCloseBar(); return; }
  findRun({keepPlace: true});
}

el.findQ.addEventListener("input", () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => findRun(), 110);
});
el.findQ.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") { ev.preventDefault(); findStep(ev.shiftKey ? -1 : 1); }
  else if (ev.key === "Escape") { ev.preventDefault(); findCloseBar(); }
});
el.findNext.addEventListener("click", () => findStep(1));
el.findPrev.addEventListener("click", () => findStep(-1));
el.findClose.addEventListener("click", () => findCloseBar());

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
  documentIsWritable() && state.file.kind === "md" &&
  root.dataset.mode !== "edit";

function editorSelection() {
  const start = el.editor.selectionStart;
  const end = el.editor.selectionEnd;
  if (start === end) return null;
  const text = el.editor.value.slice(start, end);
  if (!text.trim()) return null;
  return {text, start, end};
}

function previewSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.preview.contains(range.commonAncestorContainer)) return null;
  /* Range.toString() reads the text nodes directly, which matches how the
     occurrence counts below read el.preview.textContent; Selection.toString()
     reads the painted selection and can disagree with both. */
  const text = range.toString();
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
  historySettle();                // fold pending keystrokes in before this lands
  el.editor.value = next;
  setDirty(true);
  render(next);
  historyPush();
  hideFmtBar();
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
}

/* Task lists are live in Preview. The nth checkbox in the rendered document is
   the nth task line in the source, so a click can flip one character in place.
   "[ ]" and "[x]" are the same width, which is the whole reason this is cheap:
   every byte offset after it is unchanged, so the scroll anchors stay valid and
   nothing has to be re-rendered. */
const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/* Source lines that marked will have turned into a checkbox. Fenced code is
   skipped: a "- [ ]" inside a fence is text and renders no checkbox, so
   counting it would misalign every toggle after it. */
function taskLines(text) {
  const out = [];
  let fence = "";
  text.split("\n").forEach((line, i) => {
    const edge = line.match(/^\s*(`{3,}|~{3,})/);
    if (edge) {
      if (!fence) fence = edge[1][0];
      else if (edge[1][0] === fence) fence = "";
      return;
    }
    if (!fence && TASK_LINE.test(line)) out.push(i);
  });
  return out;
}

/* Returns false when the click could not be mapped to a source line, so the
   caller can put the checkbox back rather than show a state the file does
   not have. */
function toggleTask(box) {
  if (!documentIsWritable() || state.file.kind !== "md") return false;
  const boxes = [...el.preview.querySelectorAll(".task-list-item > input[type=checkbox]")];
  const nth = boxes.indexOf(box);
  if (nth < 0) return false;
  const text = el.editor.value;
  const at = taskLines(text)[nth];
  if (at === undefined) return false;

  const lines = text.split("\n");
  lines[at] = lines[at].replace(TASK_LINE,
    (_, open, _mark, close) => open + (box.checked ? "x" : " ") + close);

  historySettle();                  // fold pending keystrokes in before this lands
  el.editor.value = lines.join("\n");
  setDirty(el.editor.value !== state.saved);
  historyPush();
  if (state.dirty) scheduleAutosave();
  box.parentElement.classList.toggle("done", box.checked);
  return true;
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

/* Apply formatting to a direct editor selection. Much simpler than preview
   mode: we're editing the source directly, so no matching ambiguity. */
function applyInlineInEditor(kind) {
  const spec = INLINE_FMT[kind];
  const info = editorSelection();
  if (!spec || !info) return;

  const {text, start, end} = info;
  const before = el.editor.value.slice(0, start);
  const after = el.editor.value.slice(end);
  const {open, close} = spec;

  /* Already wrapped? Then remove it. */
  const wrapped = before.slice(-open.length) === open && after.slice(0, close.length) === close;
  const next = wrapped
    ? before.slice(0, -open.length) + text + after.slice(close.length)
    : before + open + text + close + after;

  historySettle();
  el.editor.value = next;
  setDirty(true);
  render(next);
  historyPush();
  hideFmtBar();

  /* Restore selection around the formatted text. */
  const newStart = wrapped ? start - open.length : start + open.length;
  const newEnd = newStart + text.length;
  el.editor.setSelectionRange(newStart, newEnd);
  el.editor.focus();
}

function applyBlockInEditor(level) {
  const info = editorSelection();
  if (!info) return;

  const {text, start, end} = info;
  const before = el.editor.value.slice(0, start);
  const after = el.editor.value.slice(end);

  const lines = text.split("\n");
  const formatted = lines.map((line, i) => {
    const indent = (line.match(/^(\s*)/) || ["", ""])[1];
    const bare = line.replace(/^(\s*)#*\s*/, "").trim();
    if (!level) return bare ? line.replace(/^(\s*)#*\s*/, "$1") : line;
    return indent + "#".repeat(level) + " " + bare;
  }).join("\n");

  const next = before + formatted + after;
  historySettle();
  el.editor.value = next;
  setDirty(true);
  render(next);
  historyPush();
  hideFmtBar();

  el.editor.setSelectionRange(start, start + formatted.length);
  el.editor.focus();
}

function applyBlockquoteInEditor() {
  const info = editorSelection();
  if (!info) return;

  const {text, start, end} = info;
  const before = el.editor.value.slice(0, start);
  const after = el.editor.value.slice(end);

  const lines = text.split("\n");
  const isBlockquote = lines[0].match(/^(\s*)>/);
  const formatted = lines.map((line) => {
    if (isBlockquote) return line.replace(BLOCKQUOTE_LINE, "$1");
    const indent = (line.match(/^(\s*)/) || ["", ""])[1];
    return indent + "> " + line.slice(indent.length);
  }).join("\n");

  const next = before + formatted + after;
  historySettle();
  el.editor.value = next;
  setDirty(true);
  render(next);
  historyPush();
  hideFmtBar();

  el.editor.setSelectionRange(start, start + formatted.length);
  el.editor.focus();
}

/* Precise source span for a TOP-LEVEL preview block (a direct child of
   #preview), found via marked's own lexer rather than by matching plain text
   against a single source line. This is what lets a paragraph that wraps
   across several source lines, or that carries inline markup (**bold**,
   `code`, links), still be turned into a heading or a blockquote: the raw
   slice marked already parsed out is used verbatim, so nothing needs to be
   reconstructed from rendered text.

   Top-level (non-space) tokens map 1:1 to #preview's top-level children, in
   order -- the same invariant buildAnchors() above relies on for scroll sync. */
function topLevelSpan(block) {
  if (!block || block.parentElement !== el.preview) return null;
  const idx = [...el.preview.children].indexOf(block);
  if (idx < 0) return null;
  const text = el.editor.value;
  let offset = 0, i = 0;
  for (const tok of markdownTokens(text)) {
    if (tok.type !== "space") {
      if (i === idx) return {token: tok, offset, length: tok.raw.length, text};
      i++;
    }
    offset += tok.raw.length;
  }
  return null;
}

/* Splices a transformed copy of a top-level span back into the source. The
   transform sees the block's raw text with any single trailing newline
   (the gap before the next block) already set aside, so it never has to
   worry about swallowing or duplicating it. */
function commitTopLevelBlock(span, transform) {
  const {offset, length, text} = span;
  let raw = text.slice(offset, offset + length);
  const trailingNL = raw.endsWith("\n") ? "\n" : "";
  if (trailingNL) raw = raw.slice(0, -1);
  const next = transform(raw);
  commitQuickEdit(text.slice(0, offset) + next + trailingNL + text.slice(offset + length));
}

/* Headings are a property of the whole line, so this rewrites the line's prefix
   rather than wrapping the selection. level 0 clears the heading. Converting
   to a heading always collapses the block to one line, since a heading
   cannot span more than one -- but clearing one back to body text leaves a
   plain paragraph untouched rather than reflowing it. */
function applyBlock(level) {
  const info = previewSelection();
  if (!info) return;
  const block = blockOf(info.range);
  if (!block) return;

  const span = topLevelSpan(block);
  if (span && (span.token.type === "paragraph" || span.token.type === "heading")) {
    const isHeading = span.token.type === "heading";
    return commitTopLevelBlock(span, (raw) => {
      const indent = (raw.match(/^(\s*)/) || ["", ""])[1];
      if (!level) return isHeading ? raw.replace(HEADING_MARK, (m, ind) => ind) : raw;
      let bare = isHeading ? raw.replace(HEADING_MARK, "") : raw;
      bare = bare.replace(/\s*\n\s*/g, " ").trim();
      return indent + "#".repeat(level) + " " + bare;
    });
  }

  /* Fallback for blocks marked's lexer does not map cleanly to one preview
     child (a list item, a table cell): the older whole-line match, which
     only copes with a block sitting on exactly one unmarked-up source line. */
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

/* Blockquote toggles a > prefix on every source line of the block. */
const BLOCKQUOTE_MARK = /^(\s*)>\s+/;
const BLOCKQUOTE_LINE = /^(\s*)>[ \t]?/;

/* A selection inside an already-quoted paragraph resolves to that inner <p>,
   which is not itself a top-level child of #preview -- its <blockquote> is.
   Toggling quoting off has to act on the whole blockquote regardless, so this
   walks up to it when the block itself is not already top-level. */
function blockquoteTarget(block) {
  if (!block) return null;
  if (block.parentElement === el.preview) return block;
  const bq = block.closest("blockquote");
  return bq && bq.parentElement === el.preview ? bq : null;
}

function applyBlockquote() {
  const info = previewSelection();
  if (!info) return;
  const block = blockOf(info.range);
  if (!block) return;

  const span = topLevelSpan(blockquoteTarget(block));
  if (span && (span.token.type === "paragraph" || span.token.type === "blockquote")) {
    const already = span.token.type === "blockquote";
    return commitTopLevelBlock(span, (raw) => raw.split("\n").map((line) => {
      if (already) return line.replace(BLOCKQUOTE_LINE, "$1");
      const indent = (line.match(/^(\s*)/) || ["", ""])[1];
      return indent + "> " + line.slice(indent.length);
    }).join("\n"));
  }

  /* Fallback for blocks marked's lexer does not map cleanly to one preview
     child (a list item, a table cell): the older whole-line match, which
     only copes with a block sitting on exactly one unmarked-up source line. */
  const want = block.textContent.trim();
  const lines = el.editor.value.split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    if (line.replace(BLOCKQUOTE_MARK, "").replace(HEADING_MARK, "").trim() === want) hits.push(i);
  });

  if (!hits.length) {
    return toast("That block does not sit on one line of the source." + USE_EDIT_MODE, true);
  }
  if (hits.length > 1) {
    return toast("More than one line in the source matches that block." + USE_EDIT_MODE, true);
  }

  const i = hits[0];
  const line = lines[i];
  const isBlockquote = BLOCKQUOTE_MARK.test(line);
  if (isBlockquote) {
    lines[i] = line.replace(BLOCKQUOTE_MARK, "$1");
  } else {
    const indent = (line.match(/^(\s*)/) || ["", ""])[1];
    const bare = line.replace(/^\s*/, "");
    lines[i] = indent + "> " + bare;
  }
  commitQuickEdit(lines.join("\n"));
}

/* Indent and outdent act on the list item's whole source line. The item is
   located by its own text (children stripped, so a parent with sub-bullets
   still matches its single line) under the same uniqueness rules as headings. */
const LIST_MARK = /^(\s*)(?:[-*+]|\d+[.)])\s+/;

function listLineOf(li) {
  const own = li.cloneNode(true);
  own.querySelectorAll("ul,ol").forEach((n) => n.remove());
  const want = own.textContent.trim();
  if (!want) return {err: "none"};
  const lines = el.editor.value.split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    const m = line.match(LIST_MARK);
    if (m && line.slice(m[0].length).trim() === want) hits.push(i);
  });
  if (hits.length !== 1) return {err: hits.length ? "many" : "none"};
  return {i: hits[0], lines};
}

const selectedListItem = () => {
  const info = previewSelection();
  const block = info && blockOf(info.range);
  return block ? block.closest("li") : null;
};

function applyIndent(delta) {
  const li = selectedListItem();
  if (!li) return;
  const found = listLineOf(li);
  if (found.err) {
    return toast(found.err === "many"
      ? "More than one source line matches that list item." + USE_EDIT_MODE
      : "Could not find that list item in the source." + USE_EDIT_MODE, true);
  }
  const {i, lines} = found;
  if (delta > 0) lines[i] = "  " + lines[i];
  else if (/^(\t| {1,2})/.test(lines[i])) lines[i] = lines[i].replace(/^(\t| {1,2})/, "");
  else return;                        // already top level; button is disabled anyway
  commitQuickEdit(lines.join("\n"));
}

function hideFmtBar() { el.fmtbar.hidden = true; }

/* The editor pane is on screen in both Edit and Split modes; the selection
   lives in the textarea whenever it has focus. */
const editorActive = () =>
  documentIsWritable() && state.file.kind === "md" &&
  root.dataset.mode !== "preview" && document.activeElement === el.editor;

/* Viewport position of a character in the textarea. A textarea exposes no
   ranges, so the text up to that point is laid out in a hidden mirror with
   the textarea's own metrics and a marker span reads back the coordinates --
   the same trick editorTops() uses for scroll sync. */
function editorCaretPoint(pos) {
  const cs = getComputedStyle(el.editor);
  const m = document.createElement("div");
  m.style.cssText =
    "position:absolute;visibility:hidden;left:-99999px;top:0;" +
    `width:${el.editor.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px;` +
    `font-family:${cs.fontFamily};font-size:${cs.fontSize};line-height:${cs.lineHeight};` +
    `letter-spacing:${cs.letterSpacing};tab-size:${cs.tabSize};` +
    "white-space:pre-wrap;overflow-wrap:break-word;";
  m.textContent = el.editor.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = "​";
  m.appendChild(marker);
  document.body.appendChild(m);
  const x = marker.offsetLeft, y = marker.offsetTop;
  m.remove();
  const r = el.editor.getBoundingClientRect();
  return {
    left: r.left + parseFloat(cs.paddingLeft) + x - el.editor.scrollLeft,
    top: r.top + parseFloat(cs.paddingTop) + y - el.editor.scrollTop,
    lineHeight: parseFloat(cs.lineHeight) || 20,
  };
}

function showFmtBar() {
  /* A selection in the editor textarea (Edit or Split mode) gets the bar too. */
  if (editorActive()) {
    const info = editorSelection();
    if (!info) return hideFmtBar();
    const caret = editorCaretPoint(info.start);
    el.fmtbar.dataset.target = "editor";
    el.fmtbar.classList.toggle("in-list", false);
    el.fmtbar.hidden = false;                     // measure only once visible
    const bar = el.fmtbar.getBoundingClientRect();
    const pad = 8;
    const edRect = el.editor.getBoundingClientRect();
    const left = Math.max(pad, Math.min(caret.left - bar.width / 2,
                                        window.innerWidth - bar.width - pad));
    let top = caret.top - bar.height - pad;
    if (top < Math.max(pad, edRect.top)) top = caret.top + caret.lineHeight + pad;
    el.fmtbar.style.left = left + "px";
    el.fmtbar.style.top = top + "px";
    return;
  }

  if (!quickEditable()) return hideFmtBar();
  const info = previewSelection();
  if (!info) return hideFmtBar();
  const r = info.range.getBoundingClientRect();
  if (!r.width && !r.height) return hideFmtBar();

  el.fmtbar.dataset.target = "preview";
  /* the indent pair appears only inside a list item, and outdent only lights
     up when that item's source line actually carries indentation */
  const li = blockOf(info.range) ? blockOf(info.range).closest("li") : null;
  el.fmtbar.classList.toggle("in-list", !!li);
  if (li) {
    const found = listLineOf(li);
    el.fmtbar.querySelector('[data-fmt="outdent"]').disabled =
      !!found.err || !/^(\t| )/.test(found.lines[found.i]);
  }

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

/* Also watch for selection changes in the editor textarea. */
["mouseup", "keyup", "keydown"].forEach((event) => {
  el.editor.addEventListener(event, () => {
    clearTimeout(fmtTimer);
    fmtTimer = setTimeout(showFmtBar, 90);
  });
});

/* Keep the selection alive: focusing a button would collapse it. */
el.fmtbar.addEventListener("mousedown", (ev) => ev.preventDefault());
el.fmtbar.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-fmt]");
  if (!b) return;
  const v = b.dataset.fmt;

  if (el.fmtbar.dataset.target === "editor") {
    if (v === "body") applyBlockInEditor(0);
    else if (/^h[1-6]$/.test(v)) applyBlockInEditor(Number(v.slice(1)));
    else if (v === "blockquote") applyBlockquoteInEditor();
    else if (v === "indent" || v === "outdent") return;  // not in editor
    else applyInlineInEditor(v);
  } else {
    if (v === "body") applyBlock(0);
    else if (/^h[1-6]$/.test(v)) applyBlock(Number(v.slice(1)));
    else if (v === "blockquote") applyBlockquote();
    else if (v === "indent") applyIndent(1);
    else if (v === "outdent") applyIndent(-1);
    else applyInline(v);
  }
});

/* A scrolling pane moves the text its bar is anchored to, so that bar goes.
   In split mode scroll sync scrolls the preview on the editor's behalf, so
   each pane only dismisses its own bar. */
el.previewpane.addEventListener("scroll", () => {
  if (el.fmtbar.dataset.target !== "editor") hideFmtBar();
}, {passive: true});
el.editor.addEventListener("scroll", () => {
  if (el.fmtbar.dataset.target === "editor") hideFmtBar();
}, {passive: true});
window.addEventListener("resize", hideFmtBar);

/* Resting on the reveal button floats the hidden panel out for a look, and the
   pointer leaving puts it away again. Only that button peeks -- resting on the
   window edge does nothing, so the panel cannot appear unasked. A peek is a
   look, not a state: clicking is what pins the panel open (see btn-show above),
   and once pinned these handlers stand down. Moving onto the panel itself keeps
   a peek alive, so a peek can be used without pinning it first. */
(() => {
  let hideTimer = null;
  const show = () => {
    if (!S.hidden) return;                // pinned open: nothing to peek
    clearTimeout(hideTimer);
    root.classList.add("peek");
  };
  const scheduleHide = () => {
    if (!S.hidden) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => root.classList.remove("peek"), 250);
  };
  $("btn-show").addEventListener("mouseenter", show);
  $("btn-show").addEventListener("mouseleave", scheduleHide);
  el.sidebarEl.addEventListener("mouseenter", show);
  el.sidebarEl.addEventListener("mouseleave", scheduleHide);
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
   11. WebMCP
   ======================================================================== */

/* Reader exposes the same document operations the UI uses, expressed as a
   narrow semantic contract. The browser owns document.modelContext; ordinary
   browsers simply skip this registration. Paths are limited to the folder
   currently being browsed, and no delete, arbitrary OS launch, or shell tool
   is exposed. */
const WEBMCP_PREF_RULES = {
  fontSize: (v) => typeof v === "number" && v >= 13 && v <= 26,
  headGapAfter: (v) => v === null || (typeof v === "number" && v >= 0 && v <= 3),
  measure: (v) => Number.isInteger(v) && v >= 30 && v <= 100 && v % 5 === 0,
  theme: (v) => ["auto", "light", "dark"].includes(v),
  autoSave: (v) => typeof v === "boolean",
  autoRefresh: (v) => typeof v === "boolean",
  watchMs: (v) => [1000, 2000, 5000, 15000].includes(v),
  watchToast: (v) => typeof v === "boolean",
};
const WEBMCP_PREF_KEYS = Object.keys(WEBMCP_PREF_RULES);

function pathInWorkspace(path) {
  return typeof path === "string" && path.startsWith("/") && !!state.root &&
    (path === state.root || path.startsWith(state.root.replace(/\/$/, "") + "/"));
}

async function requireWorkspacePath(path, label = "path") {
  if (!pathInWorkspace(path)) {
    throw new Error(`${label} must be inside Reader's current workspace`);
  }
  const info = await api("/api/stat", {query: {path}});
  if (!pathInWorkspace(info.path)) {
    throw new Error(`${label} resolves outside Reader's current workspace`);
  }
  return info.path;
}

function readerState() {
  const style = getComputedStyle(root);
  const headings = [...el.preview.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .map((node) => ({level: Number(node.tagName.slice(1)), text: node.textContent.trim()}));
  const images = [...el.preview.querySelectorAll("img[data-local-path]")]
    .map((img) => ({path: img.dataset.localPath, src: img.src,
                   complete: img.complete, naturalWidth: img.naturalWidth}));
  const tasks = [...el.preview.querySelectorAll(".task-list-item > input[type=checkbox]")]
    .map((box, index) => ({index, checked: box.checked,
                          text: box.parentElement?.querySelector(".task-text")?.textContent?.trim() || ""}));
  const mermaidSources = [...el.editor.value.matchAll(/```mermaid\s*\n([\s\S]*?)```/gi)]
    .map((match) => match[1].trim());
  return {
    contractVersion: 1,
    workspace: state.root,
    activeDocument: state.file ? {...state.file} : null,
    sourceText: state.file?.kind === "pdf" ? null : el.editor.value,
    renderedText: el.preview.textContent.trim(),
    headings,
    tasks,
    images,
    mermaid: {
      sources: mermaidSources,
      rendered: el.preview.querySelectorAll(".mermaid-diagram svg").length,
      errors: el.preview.querySelectorAll(".mermaid-error").length,
      generation: state.mermaidGeneration,
    },
    dirty: state.dirty,
    externalChange: !el.diskbar.hidden,
    externalChangeMessage: el.diskmsg.textContent,
    mode: root.dataset.mode,
    preferences: Object.fromEntries(WEBMCP_PREF_KEYS.map((key) => [key, S[key]])),
    previewStyle: {
      fontSize: style.getPropertyValue("--fs-body").trim(),
      headingGapAfter: style.getPropertyValue("--head-gap-after-override").trim(),
      measure: style.getPropertyValue("--measure").trim(),
      theme: root.dataset.theme,
    },
    navigation: {
      canBack: state.trailAt > 0,
      canForward: state.trailAt >= 0 && state.trailAt < state.trail.length - 1,
      position: state.trailAt,
      length: state.trail.length,
    },
    imageGeneration: state.imageGeneration,
  };
}

function replaceDocumentText(text) {
  if (!state.file || state.file.kind === "pdf") throw new Error("no editable document is open");
  if (!documentIsWritable()) throw new Error("the open document is read-only");
  if (new TextEncoder().encode(text).length > 8 * 1024 * 1024) {
    throw new Error("document text is too large");
  }
  historySettle();
  el.editor.value = text;
  setDirty(text !== state.saved);
  render(text);
  historyPush();
  if (state.dirty) scheduleAutosave();
  return readerState();
}

async function persistPreferencesNow() {
  clearTimeout(prefsTimer);
  prefsTimer = null;
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (_) {}
  await api("/api/prefs", {method: "POST", body: S});
}

async function setWebMCPPreferences(changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) {
    throw new Error("changes must contain at least one supported preference");
  }
  for (const [key, value] of Object.entries(changes)) {
    const valid = WEBMCP_PREF_RULES[key];
    if (!valid || !valid(value)) throw new Error(`invalid Reader preference: ${key}`);
  }
  Object.assign(S, changes);
  applySettings();
  syncDialog();
  await persistPreferencesNow();
  return readerState();
}

const noInputSchema = {type: "object", properties: {}, additionalProperties: false};
let webMCPRegistered = false;

async function registerReaderTools() {
  if (webMCPRegistered || typeof document.modelContext?.registerTool !== "function") return;
  webMCPRegistered = true;
  const register = (definition) => document.modelContext.registerTool(definition);
  const tools = [
    {
      name: "reader_get_state",
      description: "Inspect the open Reader document, rendered preview, preferences, conflict state, and navigation state.",
      inputSchema: noInputSchema,
      annotations: {readOnlyHint: true},
      execute: async () => readerState(),
    },
    {
      name: "reader_open_document",
      description: "Open a supported document inside Reader's current workspace. Unsaved edits are preserved unless discard is explicitly requested.",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["path"],
        properties: {
          path: {type: "string", maxLength: 4096,
                 description: "Absolute path inside the current Reader workspace."},
          onUnsaved: {type: "string", enum: ["preserve", "discard"], default: "preserve"},
        },
      },
      annotations: {destructiveHint: true},
      execute: async ({path, onUnsaved = "preserve"}) => {
        path = await requireWorkspacePath(path);
        if (state.dirty && onUnsaved !== "discard") {
          return {status: "decision_required", reason: "unsaved_changes", state: readerState()};
        }
        const opened = await openFile(path, {silent: onUnsaved === "discard"});
        if (!opened) return {status: "not_opened", state: readerState()};
        return {status: "opened", path: opened, state: readerState()};
      },
    },
    {
      name: "reader_replace_document_text",
      description: "Replace the open editable document's source text and immediately render the resulting preview.",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["text"],
        properties: {text: {type: "string", maxLength: 8388608}},
      },
      annotations: {destructiveHint: true},
      execute: async ({text}) => ({status: "edited", state: replaceDocumentText(text)}),
    },
    {
      name: "reader_save_document",
      description: "Save the open document. A disk conflict is preserved unless overwrite is explicitly requested.",
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: {onConflict: {type: "string", enum: ["preserve", "overwrite"], default: "preserve"}},
      },
      annotations: {destructiveHint: true},
      execute: async ({onConflict = "preserve"} = {}) => ({
        ...(await saveFile({conflict: onConflict, quiet: true, throwOnError: true})),
        state: readerState(),
      }),
    },
    {
      name: "reader_resolve_external_change",
      description: "Resolve Reader's external-change notice by reloading disk content or keeping the current Reader edit.",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["action"],
        properties: {action: {type: "string", enum: ["reload", "keep"]}},
      },
      annotations: {destructiveHint: true},
      execute: async ({action}) => {
        if (!state.file) throw new Error("no document is open");
        if (action === "reload") {
          setDirty(false);
          hideDiskBar();
          await openFile(state.file.path, {keepScroll: true, silent: true, record: false});
        } else hideDiskBar();
        return {status: action === "reload" ? "reloaded" : "kept", state: readerState()};
      },
    },
    {
      name: "reader_set_preferences",
      description: "Apply supported Reader preview and watch preferences and persist them.",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["changes"],
        properties: {changes: {
          type: "object", minProperties: 1, additionalProperties: false,
          properties: {
            fontSize: {type: "number", minimum: 13, maximum: 26},
            headGapAfter: {anyOf: [
              {type: "number", minimum: 0, maximum: 3}, {type: "null"},
            ]},
            measure: {type: "integer", minimum: 30, maximum: 100, multipleOf: 5},
            theme: {type: "string", enum: ["auto", "light", "dark"]},
            autoSave: {type: "boolean"}, autoRefresh: {type: "boolean"},
            watchMs: {type: "integer", enum: [1000, 2000, 5000, 15000]},
            watchToast: {type: "boolean"},
          },
        }},
      },
      annotations: {destructiveHint: false},
      execute: async ({changes}) => ({status: "updated", state: await setWebMCPPreferences(changes)}),
    },
    {
      name: "reader_reset_preferences",
      description: "Reset selected supported Reader preferences to their defaults and persist them.",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["keys"],
        properties: {keys: {type: "array", minItems: 1, uniqueItems: true,
          items: {type: "string", enum: WEBMCP_PREF_KEYS}}},
      },
      annotations: {destructiveHint: false},
      execute: async ({keys}) => {
        const changes = Object.fromEntries(keys.map((key) => [key, DEFAULTS[key]]));
        return {status: "reset", state: await setWebMCPPreferences(changes)};
      },
    },
    {
      name: "reader_search_documents",
      description: "Search document names inside Reader's current workspace.",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["query"],
        properties: {query: {type: "string", minLength: 1, maxLength: 200}},
      },
      annotations: {readOnlyHint: true},
      execute: async ({query}) => {
        const data = await api("/api/search", {query: fileFindQuery(query.trim())});
        return {query: data.query, matches: data.matches || [], truncated: !!data.truncated};
      },
    },
    {
      name: "reader_navigate_history",
      description: "Move backward or forward through Reader's in-session document history.",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["direction"],
        properties: {direction: {type: "string", enum: ["back", "forward"]}},
      },
      annotations: {destructiveHint: false},
      execute: async ({direction}) => {
        await trailGo(direction === "back" ? -1 : 1);
        return {status: "navigated", state: readerState()};
      },
    },
    {
      name: "reader_set_task_state",
      description: "Set one rendered Markdown task to checked or unchecked using Reader's preview task editing behavior.",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["index", "checked"],
        properties: {index: {type: "integer", minimum: 0}, checked: {type: "boolean"}},
      },
      annotations: {destructiveHint: true},
      execute: async ({index, checked}) => {
        const boxes = [...el.preview.querySelectorAll(".task-list-item > input[type=checkbox]")];
        const box = boxes[index];
        if (!box) throw new Error("task index is out of range");
        if (box.checked !== checked) {
          box.checked = checked;
          if (!toggleTask(box)) throw new Error("task could not be mapped to the document source");
        }
        return {status: "updated", state: readerState()};
      },
    },
    {
      name: "reader_move_active_document",
      description: "Move the active file to an existing folder inside Reader's current workspace. Existing files are never replaced.",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["targetDirectory"],
        properties: {targetDirectory: {type: "string", maxLength: 4096,
          description: "Absolute folder path inside the current workspace."}},
      },
      annotations: {destructiveHint: true},
      execute: async ({targetDirectory}) => {
        if (!state.file) throw new Error("no document is open");
        await requireWorkspacePath(state.file.path, "active document");
        targetDirectory = await requireWorkspacePath(targetDirectory, "targetDirectory");
        const moved = await moveFileToFolder(state.file.path, targetDirectory,
          {quiet: true, throwOnError: true});
        return {status: "moved", result: moved, state: readerState()};
      },
    },
  ];
  for (const tool of tools) await register(tool);
}

/* ==========================================================================
   12. Boot
   ======================================================================== */

/* Resolved once boot() has settled, so a document handed to the page by the
   native launcher opens after the restored session rather than under it. */
let bootDone;
const bootReady = new Promise((resolve) => { bootDone = resolve; });

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

/* A document the OS asked for — a Reader.app double-click, or `open -a Reader`.
   Unlike open(), it moves the tree to the file's folder when the file sits
   outside the folder being browsed, because revealInTree can only reach paths
   below the current root.
   Named for what it does, not "openExternal": that name already belonged to
   handing a file to the app that owns it, and declaring a second function of
   the same name silently replaced the first one for every caller. Word and
   Excel then tried to open as text, in links and in the row menu alike. */
async function openFromOS(path) {
  await bootReady;
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const dir = path.slice(0, path.lastIndexOf("/")) || "/";
  if (!(state.root === dir || dir.startsWith(state.root + "/"))) {
    await setRoot(dir, {redraw: false});
    await drawTree();
  }
  try { return await openFile(path); }
  catch (err) { toast(err.message, true); return null; }
}

/* small automation hook (same-origin pages only) — used by the test suite */
window.reader = {goto: (p) => setRoot(p), open: (p) => openFile(p), openFromOS};
window.mdview = window.reader;        // pre-2.0 name; drop once tests are updated

boot().finally(() => {
  bootDone();
  registerReaderTools().catch((err) => {
    webMCPRegistered = false;
    console.warn("Reader WebMCP registration failed", err);
  });
});
})();
