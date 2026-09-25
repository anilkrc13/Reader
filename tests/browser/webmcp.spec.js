const {test, expect} = require("@playwright/test");
const {spawn} = require("node:child_process");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const PROJECT = path.resolve(__dirname, "../..");
let runRoot;
let workspace;
let outside;
let stateDir;
let server;
let baseURL;
let token;

const alphaText = (body = "Original body", mermaidTarget = "B") => `# Alpha

${body}

![Local image](image.svg)

- [ ] Ship it

\`\`\`mermaid
graph TD
  A-->${mermaidTarget}
\`\`\`
`;

const imageSVG = (colour) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="${colour}"/></svg>`;

async function availablePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}

async function waitForFile(file, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { return await fs.readFile(file, "utf8"); }
    catch (_) { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function resetWorkspace() {
  await fs.rm(workspace, {recursive: true, force: true});
  await fs.mkdir(path.join(workspace, "deep"), {recursive: true});
  await fs.mkdir(path.join(workspace, "moved"), {recursive: true});
  await fs.writeFile(path.join(workspace, "alpha.md"), alphaText(), "utf8");
  await fs.writeFile(path.join(workspace, "image.svg"), imageSVG("#ff0000"), "utf8");
  await fs.writeFile(path.join(workspace, "deep", "known phrase beta.md"),
    "# Beta\n\nDeep result body\n", "utf8");
  await fs.writeFile(path.join(workspace, "gamma.md"), "# Gamma\n\nThird document\n", "utf8");
  await fs.symlink(outside, path.join(workspace, "escape"));
  await fs.writeFile(path.join(stateDir, "preferences.json"), "{}", "utf8");
}

async function invoke(page, name, input = {}) {
  return page.evaluate(async ({name, input}) => {
    const tool = window.__readerWebMCPTools?.[name];
    if (!tool) throw new Error(`WebMCP tool not registered: ${name}`);
    return tool.execute(input);
  }, {name, input});
}

async function state(page) {
  return invoke(page, "reader_get_state");
}

async function open(page, file, onUnsaved = "preserve") {
  return invoke(page, "reader_open_document", {path: file, onUnsaved});
}

test.beforeAll(async () => {
  runRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reader-webmcp-")));
  workspace = path.join(runRoot, "workspace");
  outside = path.join(runRoot, "outside");
  stateDir = path.join(runRoot, "state");
  await fs.mkdir(outside, {recursive: true});
  await fs.mkdir(stateDir, {recursive: true});
  await resetWorkspace();

  const port = await availablePort();
  server = spawn("python3", [path.join(PROJECT, "reader.py"), workspace,
    "--port", String(port), "--no-browser"], {
    cwd: PROJECT,
    env: {...process.env, READER_DATA_DIR: stateDir},
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  server.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  server.on("exit", (code) => {
    if (code && code !== 0) process.stderr.write(`Reader server exited ${code}: ${stderr}\n`);
  });
  token = (await waitForFile(path.join(stateDir, ".reader-token"))).trim();
  baseURL = `http://127.0.0.1:${port}/?t=${encodeURIComponent(token)}`;
});

test.afterAll(async () => {
  if (server && server.exitCode == null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  if (runRoot) await fs.rm(runRoot, {recursive: true, force: true});
});

test.beforeEach(async ({context, page}) => {
  await resetWorkspace();
  await context.addInitScript(() => {
    const tools = Object.create(null);
    Object.defineProperty(window, "__readerWebMCPTools", {value: tools});
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: async (definition) => {
          if (!definition?.name || typeof definition.execute !== "function") {
            throw new Error("invalid WebMCP tool definition");
          }
          if (tools[definition.name]) throw new Error(`duplicate WebMCP tool: ${definition.name}`);
          tools[definition.name] = definition;
        },
      },
    });
  });
  await page.goto(baseURL);
  await expect.poll(() => page.evaluate(() => Object.keys(window.__readerWebMCPTools || {}).length))
    .toBe(11);
});

test("discovers a narrow, valid semantic WebMCP contract and renders a document", async ({page}) => {
  const definitions = await page.evaluate(() => Object.values(window.__readerWebMCPTools).map((tool) => ({
    name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  })));
  expect(definitions.map((tool) => tool.name)).toEqual([
    "reader_get_state", "reader_open_document", "reader_replace_document_text",
    "reader_save_document", "reader_resolve_external_change", "reader_set_preferences",
    "reader_reset_preferences", "reader_search_documents", "reader_navigate_history",
    "reader_set_task_state", "reader_move_active_document",
  ]);
  for (const tool of definitions) {
    expect(tool.description.length).toBeGreaterThan(20);
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.additionalProperties).toBe(false);
  }
  expect(definitions.some((tool) => /delete|shell|external app/i.test(tool.name))).toBe(false);

  const result = await open(page, path.join(workspace, "alpha.md"));
  expect(result.status).toBe("opened");
  expect(result.state.activeDocument.name).toBe("alpha.md");
  expect(result.state.headings).toContainEqual({level: 1, text: "Alpha"});
  expect(result.state.renderedText).toContain("Original body");
  await expect.poll(async () => (await state(page)).mermaid.rendered).toBe(1);
});

test("edits, saves, reopens, and protects unsaved changes", async ({page}) => {
  const alpha = path.join(workspace, "alpha.md");
  const beta = path.join(workspace, "deep", "known phrase beta.md");
  await open(page, alpha);
  await invoke(page, "reader_set_preferences", {changes: {autoSave: false}});

  const savedText = "# Saved title\n\nSaved through WebMCP.\n";
  let result = await invoke(page, "reader_replace_document_text", {text: savedText});
  expect(result.state.dirty).toBe(true);
  expect(result.state.renderedText).toContain("Saved through WebMCP.");
  result = await invoke(page, "reader_save_document");
  expect(result.status).toBe("saved");
  expect(await fs.readFile(alpha, "utf8")).toBe(savedText);
  await open(page, beta);
  await open(page, alpha);
  expect((await state(page)).sourceText).toBe(savedText);

  await invoke(page, "reader_replace_document_text", {text: "# Unsaved\n\nKeep me\n"});
  result = await open(page, beta);
  expect(result.status).toBe("decision_required");
  expect(result.state.activeDocument.path).toBe(alpha);
  expect(result.state.sourceText).toContain("Keep me");
  result = await open(page, beta, "discard");
  expect(result.status).toBe("opened");
  expect(result.state.activeDocument.path).toBe(beta);
});

test("detects and resolves an external-change conflict", async ({page}) => {
  const alpha = path.join(workspace, "alpha.md");
  await open(page, alpha);
  await invoke(page, "reader_set_preferences", {
    changes: {autoSave: false, autoRefresh: true, watchMs: 1000, watchToast: false},
  });
  await invoke(page, "reader_replace_document_text", {text: "# Reader edit\n\nUnsaved\n"});
  await fs.writeFile(alpha, "# Disk edit\n\nExternal\n", "utf8");
  await expect.poll(async () => (await state(page)).externalChange).toBe(true);
  const result = await invoke(page, "reader_resolve_external_change", {action: "reload"});
  expect(result.status).toBe("reloaded");
  expect(result.state.dirty).toBe(false);
  expect(result.state.sourceText).toContain("Disk edit");
});

test("automatically refreshes document text, Mermaid source, and a local image", async ({page}) => {
  const alpha = path.join(workspace, "alpha.md");
  const image = path.join(workspace, "image.svg");
  await open(page, alpha);
  await invoke(page, "reader_set_preferences", {
    changes: {autoRefresh: true, watchMs: 1000, watchToast: false},
  });
  await expect.poll(async () => (await state(page)).mermaid.rendered).toBe(1);

  await fs.writeFile(alpha, alphaText("Changed on disk", "C"), "utf8");
  await expect.poll(async () => (await state(page)).renderedText).toContain("Changed on disk");
  await expect.poll(async () => (await state(page)).mermaid.sources[0]).toContain("A-->C");
  await expect.poll(async () => (await state(page)).mermaid.rendered).toBe(1);

  const before = await state(page);
  await fs.writeFile(image, imageSVG("#00ff00"), "utf8");
  await expect.poll(async () => (await state(page)).imageGeneration).toBeGreaterThan(before.imageGeneration);
  const refreshed = await state(page);
  expect(refreshed.images).toHaveLength(1);
  const servedImage = await page.evaluate(async (url) => (await fetch(url, {cache: "no-store"})).text(),
    refreshed.images[0].src);
  expect(servedImage).toContain("#00ff00");
});

test("renders each authored markdown blank line as its own visible spacer", async ({page}) => {
  const spaced = path.join(workspace, "spaced.md");
  await fs.writeFile(spaced,
    "# Above\n\n\n\n\n\nBelow\n> Quote top\n>\n>\n>\n>\n> Quote bottom\n",
    "utf8");

  await open(page, spaced);

  const blanks = await page.evaluate(() => [...document.querySelectorAll(".md-blank-lines")].map((node) => ({
    lines: Number.parseInt(node.style.getPropertyValue("--blank-lines"), 10),
    height: Math.round(node.getBoundingClientRect().height),
    parent: node.parentElement?.tagName || null,
  })));

  expect(blanks).toEqual([
    {lines: 4, height: blanks[0].height, parent: "ARTICLE"},
    {lines: 3, height: blanks[1].height, parent: "BLOCKQUOTE"},
  ]);
  expect(blanks[0].height).toBeGreaterThan(100);
  expect(blanks[1].height).toBeGreaterThan(80);
  await expect.poll(async () => (await state(page)).renderedText).toContain("Quote bottom");
  const renderedText = (await state(page)).renderedText;
  expect(renderedText).toContain("Above");
  expect(renderedText).toContain("Below");
  expect(renderedText).toContain("Quote top");
  expect(renderedText).toContain("Quote bottom");
});

test("a delayed open cannot replace a newer document session", async ({page}) => {
  const alpha = path.join(workspace, "alpha.md");
  const gamma = path.join(workspace, "gamma.md");
  let releaseAlpha;
  const alphaReleased = new Promise((resolve) => { releaseAlpha = resolve; });
  let sawAlpha;
  const alphaSeen = new Promise((resolve) => { sawAlpha = resolve; });

  await page.route("**/api/file?*", async (route) => {
    const requestPath = new URL(route.request().url()).searchParams.get("path");
    if (requestPath === alpha) {
      sawAlpha();
      await alphaReleased;
    }
    await route.continue();
  });

  await page.evaluate((file) => {
    window.__delayedReaderOpen = window.reader.open(file);
  }, alpha);
  await alphaSeen;
  expect((await open(page, gamma)).status).toBe("opened");
  releaseAlpha();
  await page.evaluate(() => window.__delayedReaderOpen);

  const current = await state(page);
  expect(current.activeDocument.path).toBe(gamma);
  expect(current.sourceText).toContain("Third document");
});

test("an open result cannot discard edits made after that revision started", async ({page}) => {
  const alpha = path.join(workspace, "alpha.md");
  const gamma = path.join(workspace, "gamma.md");
  await open(page, alpha);
  await invoke(page, "reader_set_preferences", {changes: {autoSave: false}});
  let releaseGamma;
  const gammaReleased = new Promise((resolve) => { releaseGamma = resolve; });
  let sawGamma;
  const gammaSeen = new Promise((resolve) => { sawGamma = resolve; });

  await page.route("**/api/file?*", async (route) => {
    const requestPath = new URL(route.request().url()).searchParams.get("path");
    if (requestPath === gamma) {
      sawGamma();
      await gammaReleased;
    }
    await route.continue();
  });

  await page.evaluate((file) => {
    window.__revisionReaderOpen = window.reader.open(file);
  }, gamma);
  await gammaSeen;
  await invoke(page, "reader_replace_document_text", {text: "# Edit made while opening\n"});
  releaseGamma();
  await page.evaluate(() => window.__revisionReaderOpen);

  const current = await state(page);
  expect(current.activeDocument.path).toBe(alpha);
  expect(current.sourceText).toBe("# Edit made while opening\n");
  expect(current.dirty).toBe(true);
});

test("an external OS-open on a reused server is explicitly read-only", async ({page}) => {
  const external = path.join(outside, "external.md");
  await fs.writeFile(external, "# External\n\nRead only here.\n", "utf8");

  await page.evaluate((file) => window.reader.openFromOS(file), external);
  const current = await state(page);
  expect(current.activeDocument.path).toBe(external);
  expect(current.activeDocument.writable).toBe(false);
  await expect(page.locator("#editor")).toHaveAttribute("readonly", "");
  await expect(invoke(page, "reader_replace_document_text", {text: "changed"}))
    .rejects.toThrow(/read-only/);
  expect(await fs.readFile(external, "utf8")).toContain("Read only here");
});

test("a stale watcher result cannot mark the newer document missing", async ({page}) => {
  const alpha = path.join(workspace, "alpha.md");
  const gamma = path.join(workspace, "gamma.md");
  await invoke(page, "reader_set_preferences", {changes: {autoRefresh: false}});
  await open(page, alpha);
  let releaseStat;
  const statReleased = new Promise((resolve) => { releaseStat = resolve; });
  let sawStat;
  const statSeen = new Promise((resolve) => { sawStat = resolve; });

  await page.route("**/api/stat?*", async (route) => {
    const requestPath = new URL(route.request().url()).searchParams.get("path");
    if (requestPath === alpha) {
      sawStat();
      await statReleased;
      await route.fulfill({status: 404, contentType: "application/json",
        body: JSON.stringify({error: "no such file or folder"})});
      return;
    }
    await route.continue();
  });

  await invoke(page, "reader_set_preferences", {
    changes: {autoRefresh: true, watchMs: 1000, watchToast: false},
  });
  await statSeen;
  expect((await open(page, gamma)).status).toBe("opened");
  releaseStat();
  await page.waitForTimeout(100);

  const current = await state(page);
  expect(current.activeDocument.path).toBe(gamma);
  expect(current.externalChange).toBe(false);
  expect(await page.locator("html").getAttribute("data-watch")).toBe("on");
});

test("client saves are serialized and preserve edits made in flight", async ({page}) => {
  const alpha = path.join(workspace, "alpha.md");
  await open(page, alpha);
  await invoke(page, "reader_set_preferences", {changes: {autoSave: false}});

  let releaseFirst;
  const firstReleased = new Promise((resolve) => { releaseFirst = resolve; });
  let sawFirst;
  const firstSeen = new Promise((resolve) => { sawFirst = resolve; });
  let saveRequests = 0;
  await page.route("**/api/save", async (route) => {
    saveRequests += 1;
    if (saveRequests === 1) {
      sawFirst();
      await firstReleased;
    }
    await route.continue();
  });

  await invoke(page, "reader_replace_document_text", {text: "# First\n"});
  await page.evaluate(() => {
    window.__firstReaderSave = window.__readerWebMCPTools.reader_save_document.execute({});
  });
  await firstSeen;
  await invoke(page, "reader_replace_document_text", {text: "# Second\n"});
  await page.evaluate(() => {
    window.__secondReaderSave = window.__readerWebMCPTools.reader_save_document.execute({});
  });
  await page.waitForTimeout(100);
  expect(saveRequests).toBe(1);

  releaseFirst();
  await page.evaluate(() => Promise.all([window.__firstReaderSave, window.__secondReaderSave]));
  expect(await fs.readFile(alpha, "utf8")).toBe("# Second\n");
  expect((await state(page)).dirty).toBe(false);
});

test("a delayed save response cannot mutate a newer document session", async ({page}) => {
  const alpha = path.join(workspace, "alpha.md");
  const gamma = path.join(workspace, "gamma.md");
  await open(page, alpha);
  await invoke(page, "reader_set_preferences", {changes: {autoSave: false}});
  let releaseSave;
  const saveReleased = new Promise((resolve) => { releaseSave = resolve; });
  let sawSave;
  const saveSeen = new Promise((resolve) => { sawSave = resolve; });

  await page.route("**/api/save", async (route) => {
    sawSave();
    await saveReleased;
    await route.continue();
  });
  await invoke(page, "reader_replace_document_text", {text: "# Saved alpha\n"});
  await page.evaluate(() => {
    window.__staleReaderSave = window.__readerWebMCPTools.reader_save_document.execute({});
  });
  await saveSeen;
  expect((await open(page, gamma, "discard")).status).toBe("opened");
  releaseSave();
  const result = await page.evaluate(() => window.__staleReaderSave);

  expect(result.status).toBe("stale");
  const current = await state(page);
  expect(current.activeDocument.path).toBe(gamma);
  expect(current.sourceText).toContain("Third document");
  expect(current.dirty).toBe(false);
});

test("applies representative preview formatting, persists it, and resets defaults", async ({page}) => {
  const alpha = path.join(workspace, "alpha.md");
  await open(page, alpha);
  let result = await invoke(page, "reader_set_preferences", {changes: {
    fontSize: 21, headGapAfter: 1.25, measure: 55, theme: "dark",
  }});
  expect(result.state.mode).toBe("preview");
  expect(result.state.previewStyle).toEqual({
    fontSize: "21px", headingGapAfter: "1.25em", measure: "55%", theme: "dark",
  });

  await page.reload();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__readerWebMCPTools || {}).length)).toBe(11);
  result = await state(page);
  expect(result.preferences).toMatchObject({
    fontSize: 21, headGapAfter: 1.25, measure: 55, theme: "dark",
  });
  expect(result.previewStyle.theme).toBe("dark");

  result = await invoke(page, "reader_reset_preferences", {
    keys: ["fontSize", "headGapAfter", "measure", "theme"],
  });
  expect(result.state.preferences).toMatchObject({
    fontSize: 16.5, headGapAfter: null, measure: 65, theme: "auto",
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__readerWebMCPTools || {}).length)).toBe(11);
  expect((await state(page)).preferences).toMatchObject({
    fontSize: 16.5, headGapAfter: null, measure: 65, theme: "auto",
  });
});

test("searches, opens a deep result, and navigates back and forward", async ({page}) => {
  const alpha = path.join(workspace, "alpha.md");
  const beta = path.join(workspace, "deep", "known phrase beta.md");
  await open(page, alpha);
  const search = await invoke(page, "reader_search_documents", {query: "known phrase"});
  expect(search.matches.map((match) => match.path)).toContain(beta);
  await open(page, beta);
  let result = await invoke(page, "reader_navigate_history", {direction: "back"});
  expect(result.state.activeDocument.path).toBe(alpha);
  expect(result.state.navigation.canForward).toBe(true);
  result = await invoke(page, "reader_navigate_history", {direction: "forward"});
  expect(result.state.activeDocument.path).toBe(beta);
  expect(result.state.renderedText).toContain("Deep result body");
  const activePath = async () => (await invoke(page, "reader_get_state", {})).activeDocument.path;
  await page.locator("#previewpane").click({position: {x: 400, y: 12}});
  await page.keyboard.press("Meta+ArrowLeft");
  await expect.poll(activePath).toBe(alpha);
  await page.keyboard.press("Meta+ArrowRight");
  await expect.poll(activePath).toBe(beta);
  // In the editor ⌘← stays start of line.
  await page.locator(".seg[data-mode=edit]").click();
  await page.locator("#editor").focus();
  await page.keyboard.press("Meta+ArrowLeft");
  expect(await activePath()).toBe(beta);
});

test("scrolls the document with the keyboard after opening it from the panel, and ⌘↑ ⌘↓ go to the ends", async ({page}) => {
  await page.setViewportSize({width: 1200, height: 700});
  const long = path.join(workspace, "long-read.md");
  await fs.writeFile(long, "# Long\n\n" + Array.from({length: 80}, (_, i) => `Paragraph ${i} with enough words to wrap.`).join("\n\n"));
  await page.reload();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__readerWebMCPTools || {}).length)).toBe(11);
  await page.locator(`#tree .row[data-path="${long}"]`).click();
  await expect(page.locator("#docname")).toHaveText("long-read.md");
  const top = () => page.locator("#previewpane").evaluate((n) => n.scrollTop);
  // Opening from the panel hands the document the keyboard.
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("previewpane");
  await page.keyboard.press("ArrowDown");
  await expect.poll(top).toBeGreaterThan(0);
  // The browser animates an arrow-key scroll; let it finish first.
  await page.waitForTimeout(500);
  await page.keyboard.press("Meta+ArrowDown");
  await expect.poll(top).toBeGreaterThan(1000);
  await page.keyboard.press("Meta+ArrowUp");
  await expect.poll(top).toBe(0);
  // With focus on a toolbar button, ↓ still scrolls the document.
  await page.locator("#btn-refresh").focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(top).toBeGreaterThan(0);
});

test("offers two modes, Preview and Edit, with the preview beside the editor as a toggle Edit remembers", async ({page}) => {
  await open(page, path.join(workspace, "alpha.md"));
  const mode = () => page.locator("html").getAttribute("data-mode");
  await expect(page.locator("#toolbar .seg")).toHaveText(["Preview", "Edit"]);
  await expect(page.locator("#btn-edit-preview")).toBeHidden();
  // Edit opens with the preview beside it by default.
  await page.locator(".seg[data-mode=edit]").click();
  expect(await mode()).toBe("split");
  await expect(page.locator(".seg[data-mode=edit]")).toHaveCSS("box-shadow", /rgba/);
  await expect(page.locator("#btn-edit-preview")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#previewpane")).toBeVisible();
  // Hidden, the editor has the tab to itself.
  await page.locator("#btn-edit-preview").click();
  expect(await mode()).toBe("edit");
  await expect(page.locator("#btn-edit-preview")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#previewpane")).toBeHidden();
  // ⌘E goes back to Preview and returns to Edit the way it was left.
  await page.keyboard.press("ControlOrMeta+e");
  await expect.poll(mode).toBe("preview");
  await page.keyboard.press("ControlOrMeta+e");
  await expect.poll(mode).toBe("edit");
  await page.locator("#btn-edit-preview").click();
  await page.locator(".seg[data-mode=preview]").click();
  await page.locator(".seg[data-mode=edit]").click();
  expect(await mode()).toBe("split");
});

test("splits a tab into two documents: the panel opens into the active pane, never one document twice", async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  const alpha = path.join(workspace, "alpha.md");
  const gamma = path.join(workspace, "gamma.md");
  const linker = path.join(workspace, "linker.md");
  await fs.writeFile(linker, "# Linker\n\n[Gamma](gamma.md)\n");
  // The panel listed the folder before linker.md existed.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__readerWebMCPTools || {}).length)).toBe(11);
  await open(page, alpha);
  const side = page.frameLocator("#side-pane iframe");
  const sidePath = () => page.evaluate(() => window.reader.currentPath && document.querySelector("#side-pane iframe")?.contentWindow?.reader?.currentPath());
  const mainPath = async () => (await invoke(page, "reader_get_state", {})).activeDocument?.path ?? null;
  const row = (file) => page.locator(`#tree .row[data-path="${file}"]`);

  // Split: the current document stays left, the right starts empty and active.
  await page.locator("#btn-split").click();
  await expect(page.locator("html")).toHaveAttribute("data-split", "on");
  await expect(side.locator("#empty")).toContainText("Choose a file in the panel");
  await expect(side.locator("#toolbar")).toHaveClass(/pane-active/);
  await expect(page.locator("#preview-layout")).toBeHidden();

  // The panel opens into the active pane.
  await row(gamma).click();
  await expect.poll(sidePath).toBe(gamma);
  expect(await mainPath()).toBe(alpha);
  await page.locator("#preview").click();
  await expect(page.locator("#toolbar")).toHaveClass(/pane-active/);
  await row(linker).click();
  await expect.poll(mainPath).toBe(linker);
  // Asking for the other pane's document goes to that pane instead.
  await row(gamma).click();
  await expect(side.locator("#toolbar")).toHaveClass(/pane-active/);
  expect(await mainPath()).toBe(linker);

  // ⌥-click opens a link to the side: into the other pane.
  await page.locator("#preview").click();
  await row(alpha).click();
  await expect.poll(mainPath).toBe(alpha);
  await open(page, linker);
  await page.getByRole("link", {name: "Gamma"}).click({modifiers: ["Alt"]});
  await expect(side.locator("#toolbar")).toHaveClass(/pane-active/);
  await expect.poll(sidePath).toBe(gamma);

  // Appearance is shared, and the second pane follows at once.
  await invoke(page, "reader_set_preferences", {changes: {theme: "dark"}});
  await expect(side.locator("html")).toHaveAttribute("data-theme", "dark", {timeout: 1000});
  await invoke(page, "reader_set_preferences", {changes: {theme: "auto"}});

  // Each pane has its own mode, and in a split Edit is the editor alone.
  await side.locator(".seg[data-mode=edit]").click();
  await expect(side.locator("html")).toHaveAttribute("data-mode", "edit");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "preview");
  await expect(side.locator("#edit-preview")).toBeHidden();

  // The divider snaps to the middle, keeps each pane usable, and resets on double-click.
  const divider = page.locator("#split-divider");
  const box = await divider.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, box.y + 200, {steps: 5});
  await page.mouse.up();
  const ratio = () => page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue("--split")));
  expect(await ratio()).toBeLessThan(0.45);
  await divider.dblclick();
  expect(await ratio()).toBe(0.5);

  // A reload brings the split back with the second document.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__readerWebMCPTools || {}).length)).toBe(11);
  await expect(page.locator("html")).toHaveAttribute("data-split", "on");
  await expect.poll(sidePath).toBe(gamma);

  /* A Finder drop, as the macOS app relays it: the path and the pointer. The
     pane under the pointer is highlighted, then opens the file. */
  const at = async (selector) => {
    const r = await page.locator(selector).boundingBox();
    return [r.x + r.width / 2, r.y + r.height / 2];
  };
  const [sx, sy] = await at("#side-pane");
  await page.evaluate(([x, y]) => window.reader.fileDropHover(x, y), [sx, sy]);
  await expect(side.locator("html")).toHaveClass(/drop-open/);
  await page.evaluate(([x, y]) => window.reader.fileDropHover(null, null), [sx, sy]);
  await expect(side.locator("html")).not.toHaveClass(/drop-open/);
  await page.evaluate(([p, x, y]) => window.reader.dropFile(p, x, y), [alpha, sx, sy]);
  await expect.poll(sidePath).toBe(alpha);
  const [mx, my] = await at("#panes");
  await page.evaluate(([p, x, y]) => window.reader.dropFile(p, x, y), [gamma, mx, my]);
  await expect.poll(mainPath).toBe(gamma);
  // Dropped on the file panel, it goes to the active pane; never one document twice.
  const [px, py] = await at("#sidebar");
  await page.evaluate(([p, x, y]) => window.reader.dropFile(p, x, y), [alpha, px, py]);
  await expect(side.locator("#toolbar")).toHaveClass(/pane-active/);
  expect(await mainPath()).toBe(gamma);

  // Reload in the second pane re-reads the file panel on screen, the host's.
  await fs.mkdir(path.join(workspace, "made-later"));
  await fs.writeFile(path.join(workspace, "made-later", "note.md"), "# Note\n");
  await side.locator("#btn-refresh").click();
  await expect(row(path.join(workspace, "made-later"))).toBeVisible();

  // Coming back to Reader picks up a folder made elsewhere, without Reload.
  await fs.mkdir(path.join(workspace, "made-while-away"));
  await fs.writeFile(path.join(workspace, "made-while-away", "note.md"), "# Note\n");
  await page.waitForTimeout(1600);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(row(path.join(workspace, "made-while-away"))).toBeVisible();

  /* The file panel's menu offers a link menu's ways to open, in its order;
     tabs and windows only in the app. Copy Path is a file's Copy Link. */
  await row(gamma).click({button: "right"});
  const items = page.locator("#ctxmenu .menu-item");
  await expect(items).toHaveText(["Open", "Open to the Side", "Copy Path", "Rename…", "Move to Trash…"]);
  // One highlight, moved by the pointer and the arrow keys; none on opening.
  const current = () => page.evaluate(() => document.querySelector("#ctxmenu .menu-item.is-current")?.textContent ?? null);
  expect(await current()).toBeNull();
  await items.nth(2).hover();
  expect(await current()).toBe("Copy Path");
  await page.keyboard.press("ArrowDown");
  expect(await current()).toBe("Rename…");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  expect(await current()).toBe("Open to the Side");
  // The pointer takes the highlight back from the keys, and only one item has it.
  await items.nth(3).hover();
  expect(await current()).toBe("Rename…");
  await expect(page.locator("#ctxmenu .menu-item.is-current")).toHaveCount(1);
  // And it is visible: the current item is filled, the others are not.
  const fills = () => items.evaluateAll((n) => n.map((x) => getComputedStyle(x).backgroundColor));
  // The fill fades in, so wait for it to settle.
  await expect.poll(async () => (await fills()).map((c) => c !== "rgba(0, 0, 0, 0)"))
    .toEqual([false, false, false, true, false]);
  await page.keyboard.press("Escape");

  // The side pane's ✕ returns the tab to one document.
  await side.locator("#btn-close-pane").click();
  await expect(page.locator("html")).toHaveAttribute("data-split", "off");
  await expect(page.locator("#side-pane")).toHaveCount(0);
  await expect(page.locator("#preview-layout")).toBeVisible();
});

test("tabs keep their own place: a new tab opens its folder empty, a restored tab reopens its document, a reload keeps both", async ({context, page}) => {
  const alpha = path.join(workspace, "alpha.md");
  const beta = path.join(workspace, "deep", "known phrase beta.md");
  // The last-used document, as every earlier window would have left it.
  await open(page, alpha);
  const activePath = async (tab) => (await invoke(tab, "reader_get_state", {})).activeDocument?.path ?? null;
  /* What the macOS app does for a tab: an intent before the page runs, and a
     message channel that records what the page reports. */
  async function nativeTab(intent) {
    const tab = await context.newPage();
    await tab.addInitScript((intent) => {
      window.__readerTab = intent;
      window.__readerChrome = true;
      window.__posted = [];
      window.webkit = {messageHandlers: {reader: {postMessage: (message) => {
        window.__posted.push(message);
        return Promise.resolve(true);
      }}}};
    }, intent);
    await tab.goto(baseURL);
    await ready(tab);
    return tab;
  }
  const ready = (tab) => expect.poll(() => tab.evaluate(() => Object.keys(window.__readerWebMCPTools || {}).length)).toBe(11);
  const deep = path.join(workspace, "deep");
  // The last-used state includes a split; a new tab must not inherit it.
  await page.locator("#btn-split").click();
  await expect(page.locator("html")).toHaveAttribute("data-split", "on");
  const fresh = await nativeTab({fresh: true, root: deep});
  await expect(fresh.locator("html")).toHaveAttribute("data-split", "off");
  await expect.poll(() => fresh.evaluate(() => document.documentElement.dataset.empty)).toBe("yes");
  expect(await activePath(fresh)).toBeNull();
  await expect(fresh.locator("#tree")).toContainText("known phrase beta");

  const restored = await nativeTab({restore: {rootDir: deep, lastFile: beta, mode: "edit"}});
  await expect.poll(() => activePath(restored)).toBe(beta);
  await expect(restored.locator("html")).toHaveAttribute("data-mode", "edit");
  // Each tab reports its own place, which is what the app saves for a restart.
  await expect.poll(() => restored.evaluate(() => window.__posted.filter((m) => m.action === "tabState").pop()?.state))
    .toMatchObject({rootDir: deep, lastFile: beta, mode: "edit"});

  // The page layout and Edit's preview belong to the tab: changing them in one
  // leaves the other alone, even after the shared settings sync (every 2s).
  await restored.locator(".seg[data-mode=preview]").click();
  await restored.getByRole("button", {name: "Two-page layout", exact: true}).click();
  await expect(restored.locator("#preview-layout [data-layout=spread]")).toHaveAttribute("aria-pressed", "true");
  await fresh.waitForTimeout(2600);
  await expect(fresh.locator("#preview-layout [data-layout=single]")).toHaveAttribute("aria-pressed", "true");
  await restored.getByRole("button", {name: "Single column", exact: true}).click();
  await restored.locator(".seg[data-mode=edit]").click();

  // The app colours this tab's title and tab bar from Reader's theme.
  const chrome = () => restored.evaluate(() => window.__posted.filter((m) => m.action === "chrome").pop());
  await invoke(restored, "reader_set_preferences", {changes: {theme: "dark"}});
  await expect.poll(chrome).toMatchObject({theme: "dark"});
  await invoke(restored, "reader_set_preferences", {changes: {theme: "auto"}});

  /* The title bar carries panel, back, forward, theme and settings: the page
     hides its copies, and shows them again when the app says so (full screen). */
  for (const id of ["#btn-panel", "#btn-back", "#btn-theme", "#btn-settings", "#btn-full"]) {
    await expect(restored.locator(id)).toBeHidden();
  }
  await restored.evaluate(() => window.reader.setNativeChrome(false));
  for (const id of ["#btn-panel", "#btn-theme", "#btn-settings"]) await expect(restored.locator(id)).toBeVisible();
  await restored.evaluate(() => window.reader.setNativeChrome(true));
  await expect(restored.locator("#btn-settings")).toBeHidden();
  // Its buttons act on the page and follow its state.
  await restored.evaluate(() => window.reader.chrome("panel"));
  await expect.poll(chrome).toMatchObject({panelShown: false});
  // Resting on the title bar's panel button floats the hidden panel out.
  await restored.evaluate(() => window.reader.peek(true));
  await expect(restored.locator("html")).toHaveClass(/peek/);
  await restored.evaluate(() => window.reader.peek(false));
  await expect(restored.locator("html")).not.toHaveClass(/peek/);
  await restored.evaluate(() => window.reader.chrome("panel"));
  await expect.poll(chrome).toMatchObject({panelShown: true});
  await restored.evaluate(() => window.reader.chrome("settings"));
  await expect(restored.locator("#scrim")).toBeVisible();
  await restored.keyboard.press("Escape");

  // A reload keeps the tab's own document, not the intent's or the shared one's.
  await open(fresh, beta);
  await fresh.reload();
  await ready(fresh);
  await expect.poll(() => activePath(fresh)).toBe(beta);
  await restored.locator(".seg[data-mode=preview]").click();
  await restored.reload();
  await ready(restored);
  await expect.poll(() => activePath(restored)).toBe(beta);
  await expect(restored.locator("html")).toHaveAttribute("data-mode", "preview");

  // In the app the file panel's menu adds New Tab and New Window.
  await restored.locator(`#tree .row[data-path="${beta}"]`).click({button: "right"});
  await expect(restored.locator("#ctxmenu .menu-item")).toHaveText(
    ["Open", "Open to the Side", "Open in New Tab", "Open in New Window", "Copy Path", "Rename…", "Move to Trash…"]);
  await restored.locator("#ctxmenu .menu-item", {hasText: "Open in New Window"}).click();
  await expect.poll(() => restored.evaluate(() => window.__posted.filter((m) => m.action === "openInNewWindow")))
    .toEqual([{action: "openInNewWindow", path: beta}]);

  // ⌘-click on a local link asks the app for a new tab instead of opening in place.
  const linker = path.join(deep, "linker.md");
  await fs.writeFile(linker, "[Beta](known%20phrase%20beta.md)\n");
  await open(restored, linker);
  await restored.getByRole("link", {name: "Beta"}).click({modifiers: ["Meta"]});
  await expect.poll(() => restored.evaluate(() => window.__posted.filter((m) => m.action === "openInNewTab")))
    .toEqual([{action: "openInNewTab", path: beta}]);
  expect(await activePath(restored)).toBe(linker);
  await fresh.close();
  await restored.close();
});

test("gives local links a Reader address the native menu can open, and opens them as a click does", async ({page}) => {
  const beta = path.join(workspace, "deep", "known phrase beta.md");
  const linker = path.join(workspace, "linker.md");
  await fs.writeFile(linker, "[Beta](deep/known%20phrase%20beta.md#part)\n");
  await open(page, linker);
  const link = page.getByRole("link", {name: "Beta"});
  await expect(link).toHaveAttribute("href", "/open?path=" + encodeURIComponent(beta) + "#part");
  await expect(link).toHaveAttribute("data-local", beta);
  const activePath = async () => (await invoke(page, "reader_get_state", {})).activeDocument.path;
  await link.click();
  await expect.poll(activePath).toBe(beta);
  await expect(page).toHaveURL(/\/$/);
  // What the macOS app calls for the context menu's Open Link.
  await open(page, linker);
  await page.evaluate((p) => window.reader.openLink(p), beta);
  await expect.poll(activePath).toBe(beta);
  expect(await page.evaluate(() => window.reader.openLink("relative.md"))).toBeNull();
});

test("round-trips a task and constrains file moves to the temporary workspace", async ({page}) => {
  const alpha = path.join(workspace, "alpha.md");
  const moved = path.join(workspace, "moved", "alpha.md");
  await open(page, alpha);
  await invoke(page, "reader_set_preferences", {changes: {autoSave: false}});
  let result = await invoke(page, "reader_set_task_state", {index: 0, checked: true});
  expect(result.state.tasks[0].checked).toBe(true);
  expect(result.state.sourceText).toContain("- [x] Ship it");
  await invoke(page, "reader_save_document");
  await open(page, path.join(workspace, "gamma.md"));
  await open(page, alpha);
  expect((await state(page)).tasks[0].checked).toBe(true);

  result = await invoke(page, "reader_move_active_document", {
    targetDirectory: path.join(workspace, "moved"),
  });
  expect(result.status).toBe("moved");
  expect(result.state.activeDocument.path).toBe(moved);
  expect(await fs.readFile(moved, "utf8")).toContain("- [x] Ship it");
  await expect(fs.stat(alpha)).rejects.toThrow();

  await expect(invoke(page, "reader_move_active_document", {targetDirectory: outside}))
    .rejects.toThrow(/current workspace/);
  await expect(invoke(page, "reader_move_active_document", {
    targetDirectory: path.join(workspace, "escape"),
  })).rejects.toThrow(/resolves outside/);
  expect((await state(page)).activeDocument.path).toBe(moved);
  expect(await fs.readFile(moved, "utf8")).toContain("Ship it");
});

test("keeps one representative formatting control keyboard-operable", async ({page}) => {
  await page.getByRole("button", {name: "Settings"}).click();
  const dark = page.getByRole("button", {name: "Dark"});
  await expect(dark).toBeVisible();
  await dark.focus();
  await expect(dark).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

/* Real rendering catches column overflow, lost passages, and navigation
   interception that DOM-only tests cannot exercise. */
test.describe("two-page Preview", () => {
  async function openLongDocument(page) {
    await page.setViewportSize({width: 1440, height: 900});
    const text = '# Reading test\n\n[Jump to destination](#destination)\n\n' +
      Array.from({length: 60}, (_, i) => `## Section ${i}\n\nPassage ${i}. ${'Readable text fills this page with enough lines to exercise pagination. '.repeat(9)}\n\n`).join('') +
      '## Destination\n\nUNIQUE DESTINATION\n\n';
    await fs.writeFile(path.join(workspace, "long.md"), text);
    await open(page, path.join(workspace, "long.md"));
  }
  async function spread(page) {
    await page.getByRole('button', {name: 'Two-page layout', exact: true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-paged', 'yes');
  }
  async function visibleText(page) {
    return page.locator('#preview').evaluate(article => {
      const pane = article.parentElement.getBoundingClientRect();
      // Outside the text area the spread is clipped; the edge zones span exactly that margin.
      const margin = article.parentElement.querySelector('.page-edge').getBoundingClientRect().width || 36;
      return [...article.querySelectorAll('h1,h2,p')].filter(n => [...n.getClientRects()].some(r =>
        r.right > pane.left + margin && r.left < pane.right - margin && r.bottom > pane.top + 28 && r.top < pane.bottom - 24)).map(n => n.textContent).join('\n');
    });
  }
  test('splits the width a narrower measure frees like a book spread, gutter matching an outer margin, and preserves search through typography changes', async ({page}) => {
    await openLongDocument(page);
    await invoke(page, 'reader_set_preferences', {changes: {measure: 100}});
    await spread(page);
    const textBox = () => page.locator('#preview > p').first().evaluate(node => {
      const r = node.getClientRects()[0];
      const preview = document.querySelector('#preview');
      const gap = parseFloat(getComputedStyle(preview).columnGap);
      return {left: r.left, width: r.width, gap, outer: r.left - document.querySelector('#previewpane').getBoundingClientRect().left};
    });
    const full = await textBox();
    expect(full.gap).toBe(56);
    for (const measure of [100, 65, 50]) {
      await invoke(page, 'reader_set_preferences', {changes: {measure}});
      await expect.poll(async () => Math.abs((await textBox()).width / full.width - measure / 100)).toBeLessThan(.002);
      const box = await textBox();
      expect(Math.abs(box.gap - Math.max(56, box.outer))).toBeLessThan(1);
      expect(Math.abs(2 * box.outer + box.gap - (2 * full.outer + full.gap) - 2 * full.width * (1 - measure / 100))).toBeLessThan(1);
      await page.screenshot({path: `.playwright-cli/two-page/width-${measure}.png`, animations: 'disabled'});
    }
    await page.locator('#previewpane').click({position: {x: 400, y: 12}});
    await page.keyboard.press('ControlOrMeta+f');
    await page.locator('#find-q').fill('Passage 20.');
    await expect.poll(() => visibleText(page)).toContain('Passage 20.');
    await page.keyboard.press('Escape');
    const originalSize = await page.locator('#preview').evaluate(n => parseFloat(getComputedStyle(n).fontSize));
    await page.keyboard.press('ControlOrMeta+=');
    await expect.poll(() => page.locator('#preview').evaluate(n => parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThan(originalSize);
    await expect.poll(() => visibleText(page)).toContain('Passage 20.');
    await page.keyboard.press('ControlOrMeta+-');
    await expect.poll(() => page.locator('#preview').evaluate(n => parseFloat(getComputedStyle(n).fontSize))).toBe(originalSize);
    await expect.poll(() => visibleText(page)).toContain('Passage 20.');
    for (const measure of [65, 100, 50]) {
      await invoke(page, 'reader_set_preferences', {changes: {measure}});
      await expect.poll(() => visibleText(page)).toContain('Passage 20.');
    }
    await page.getByRole('button', {name:'Single column', exact:true}).click();
    const single50 = await page.locator('#preview').evaluate(n => n.getBoundingClientRect().width);
    await invoke(page, 'reader_set_preferences', {changes:{measure:100}});
    await expect.poll(() => page.locator('#preview').evaluate(n => n.getBoundingClientRect().width)).toBe(single50 * 2);
  });
  test('shows keyboard-operable layout icons only in Preview and turns pages from the footer and outer margins', async ({page}) => {
    await openLongDocument(page);
    const single = page.getByRole('button', {name: 'Single column', exact: true});
    const two = page.getByRole('button', {name: 'Two-page layout', exact: true});
    await expect(single).toHaveAttribute('aria-pressed', 'true');
    await two.focus();
    await page.keyboard.press('Enter');
    await expect(two).toHaveAttribute('aria-pressed', 'true');
    await expect(single).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#page-prev')).toBeDisabled();
    await page.locator('#page-next').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#page-label')).toContainText('Pages 3–4');
    const geometry = await page.evaluate(() => {
      const pane = document.querySelector('#previewpane').getBoundingClientRect();
      const nav = document.querySelector('#page-nav').getBoundingClientRect();
      const panes = document.querySelector('#panes').getBoundingClientRect();
      // Text begins after the pane padding and the text-width inset; #preview
      // itself is translated to the current spread, so measure its styles.
      const style = n => getComputedStyle(document.querySelector(n));
      const margin = parseFloat(style('#previewpane').paddingLeft) + parseFloat(style('#preview').marginLeft);
      const [left, right] = [...document.querySelectorAll('.page-edge')].map(n => n.getBoundingClientRect());
      const inNav = id => { const r = document.getElementById(id).getBoundingClientRect(); return r.top >= nav.top && r.bottom <= nav.bottom; };
      return {buttonsInNav: inNav('page-prev') && inNav('page-next'), fullWidth: pane.width === panes.width,
        edgesClearText: left.left === pane.left && Math.abs(left.width - margin) < 1 && right.right === pane.right && Math.abs(right.width - margin) < 1};
    });
    expect(geometry).toEqual({buttonsInNav: true, fullWidth: true, edgesClearText: true});
    await page.locator('.page-edge[data-dir="1"]').click();
    await expect(page.locator('#page-label')).toContainText('Pages 5–6');
    await page.locator('.page-edge[data-dir="-1"]').click();
    await expect(page.locator('#page-label')).toContainText('Pages 3–4');
    await page.evaluate(() => getSelection().selectAllChildren(document.querySelector('#preview p')));
    await page.locator('.page-edge[data-dir="1"]').click();
    await expect(page.locator('#page-label')).toContainText('Pages 3–4');
    await page.screenshot({path: '.playwright-cli/two-page/ui-refinement-light.png', animations: 'disabled'});
    await invoke(page, 'reader_set_preferences', {changes: {theme: 'dark'}});
    await page.screenshot({path: '.playwright-cli/two-page/ui-refinement-dark.png', animations: 'disabled'});
    await page.locator('.seg[data-mode=edit]').click();
    for (const mode of ['split', 'edit']) {
      if (await page.locator('html').getAttribute('data-mode') !== mode) await page.locator('#btn-edit-preview').click();
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
      await expect(page.locator('#preview-layout')).toBeHidden();
      await expect(page.locator('#page-next')).toBeHidden();
    }
    await page.locator('.seg[data-mode=preview]').click();
    await expect(two).toHaveAttribute('aria-pressed', 'true');
    await single.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('html')).toHaveAttribute('data-paged', 'no');
    await expect(single).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#page-next')).toBeHidden();
    await two.click();
    await page.setViewportSize({width: 900, height: 900});
    await expect(page.locator('html')).toHaveAttribute('data-paged', 'no');
    await expect(two).toBeVisible();
    await expect(page.locator('#page-prev')).toBeHidden();
    expect(await page.locator('#btn-settings').evaluate(button =>
      button.getBoundingClientRect().right <= document.querySelector('#toolbar').getBoundingClientRect().right)).toBe(true);
    await page.screenshot({path: '.playwright-cli/two-page/ui-refinement-narrow.png', animations: 'disabled'});
  });
  test('draws the spine on every paper, light and dark, and drops it for a lone last page', async ({page}) => {
    await openLongDocument(page);
    await spread(page);
    const papers = [['light', 'paper', 'cream'], ['light', 'paper', 'white'], ['light', 'paper', 'sepia'], ['light', 'paper', 'grey'],
      ['dark', 'paperDark', 'ink'], ['dark', 'paperDark', 'charcoal'], ['dark', 'paperDark', 'black']];
    for (const [theme, key, paper] of papers) {
      // Paper is not an automation preference; the stylesheet keys off the attribute.
      await invoke(page, 'reader_set_preferences', {changes: {theme}});
      await page.evaluate(([key, paper]) => { document.documentElement.dataset[key] = paper; }, [key, paper]);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const spine = await page.locator('#previewpane').evaluate(pane => {
        const tone = getComputedStyle(pane, '::before');
        const rect = pane.getBoundingClientRect();
        return {image: tone.backgroundImage, width: parseFloat(tone.width), centre: rect.left + rect.width / 2,
          crease: getComputedStyle(pane, '::after').backgroundImage};
      });
      expect(spine.image).toContain('gradient');
      expect(spine.crease).toContain('gradient');
      expect(spine.width).toBeGreaterThanOrEqual(56);
      const box = await page.locator('#previewpane').boundingBox();
      await page.screenshot({path: `.playwright-cli/two-page/spine-${theme}-${paper}.png`, animations: 'disabled',
        clip: {x: spine.centre - 300, y: box.y, width: 600, height: 360}});
    }
    const count = await page.evaluate(() => Number(document.querySelector('#page-label').textContent.match(/of (\d+)/)[1]));
    if (count % 2) {
      await page.evaluate(() => { for (let i = 0; i < 100; i++) document.querySelector('#page-next').click(); });
      expect(await page.locator('#previewpane').evaluate(pane => getComputedStyle(pane, '::before').content)).toBe('none');
    }
  });
  test('turns one spread per wheel gesture, preserves passage across modes and narrow fallback', async ({page}) => {
    await openLongDocument(page);
    await expect(page.locator('html')).not.toHaveAttribute('data-paged', 'yes');
    await spread(page);
    const first = await visibleText(page);
    await page.locator('#previewpane').click({position: {x: 400, y: 12}});
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#page-label')).toContainText('Pages 3–4');
    expect(await visibleText(page)).not.toEqual(first);
    await page.locator('#previewpane').dispatchEvent('wheel', {deltaY: 120});
    for (let i = 0; i < 12; i++) await page.locator('#previewpane').dispatchEvent('wheel', {deltaY: 60 - i});
    await expect(page.locator('#page-label')).toContainText('Pages 5–6');
    const passage = (await visibleText(page)).match(/Passage \d+/)[0];
    await page.locator('.seg[data-mode=edit]').click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'split');
    await expect(page.locator('html')).toHaveAttribute('data-paged', 'no');
    await page.locator('.seg[data-mode=preview]').click();
    await expect(page.locator('#page-label')).toContainText('Pages 5–6');
    await page.setViewportSize({width: 900, height: 900});
    await expect(page.locator('html')).toHaveAttribute('data-paged', 'no');
    await page.setViewportSize({width: 1440, height: 900});
    await expect(page.locator('html')).toHaveAttribute('data-paged', 'yes');
    expect(await visibleText(page)).toContain(passage);
    await page.screenshot({path: '.playwright-cli/two-page/spread-light.png'});
    await invoke(page, 'reader_set_preferences', {changes: {theme: 'dark'}});
    await page.screenshot({path: '.playwright-cli/two-page/spread-dark.png', animations: 'disabled'});
  });
  test('reveals heading and search targets, restores history and refresh, and keeps font reflow near the passage', async ({page}) => {
    await openLongDocument(page);
    await spread(page);
    await page.getByRole('link', {name: 'Jump to destination'}).click();
    await expect.poll(() => visibleText(page)).toContain('UNIQUE DESTINATION');
    const label = await page.locator('#page-label').textContent();
    await open(page, path.join(workspace, 'gamma.md'));
    await invoke(page, 'reader_navigate_history', {direction: 'back'});
    await expect(page.locator('#page-label')).toHaveText(label);
    await page.locator('#btn-refresh').click();
    await expect.poll(() => visibleText(page)).toContain('UNIQUE DESTINATION');
    await page.keyboard.press('ControlOrMeta+f');
    await page.locator('#find-q').fill('Passage 20.');
    await expect.poll(() => visibleText(page)).toContain('Passage 20.');
    await page.keyboard.press('Escape');
    await invoke(page, 'reader_set_preferences', {changes: {fontSize: 20}});
    await expect.poll(() => visibleText(page)).toContain('Passage 20.');
  });
  test('keeps oversized blocks native, reflows delayed images, and excludes code documents', async ({page}) => {
    await openLongDocument(page);
    await spread(page);
    const rich = '# Oversized content\n\n```text\n' + 'a wide code line '.repeat(30) + '\n' + 'a tall code block\n'.repeat(70) + 'LOW_CODE_TARGET\n' +
      '```\n\n| Column | Value |\n| --- | --- |\n' + '| cell | value |\n'.repeat(80) + '| LOW_TABLE_TARGET | final row |\n' +
      '\n```mermaid\ngraph LR\n A[Beginning]-->B[Middle]-->C[End]\n```\n';
    await fs.writeFile(path.join(workspace, 'rich.md'), rich);
    await open(page, path.join(workspace, 'rich.md'));
    await expect(page.locator('#preview pre')).toHaveAttribute('tabindex', '0');
    await page.locator('#preview pre').focus();
    const label = await page.locator('#page-label').textContent();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#page-label')).toHaveText(label);
    await expect.poll(() => page.locator('#preview pre').evaluate(n => n.scrollTop)).toBeGreaterThan(0);
    await page.locator('#preview pre').dispatchEvent('wheel', {deltaY: 120});
    await expect(page.locator('#page-label')).toHaveText(label);
    await page.locator('#preview table').focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.locator('#preview table').evaluate(n => n.scrollTop)).toBeGreaterThan(0);
    await expect(page.locator('.mermaid-diagram svg')).toHaveCount(1);
    await expect(page.locator('.mermaid-diagram')).toHaveAttribute('tabindex', '0');
    await page.locator('.mermaid-diagram').focus();
    await expect(page.locator('#page-label')).toContainText('Pages 3–4');
    await page.screenshot({path: '.playwright-cli/two-page/oversized-content.png'});

    await page.locator('#previewpane').click({position: {x: 400, y: 12}});
    await page.keyboard.press('ControlOrMeta+f');
    for (const text of ['LOW_CODE_TARGET', 'LOW_TABLE_TARGET']) {
      await page.locator('#find-q').fill(text);
      await expect.poll(() => page.locator('mark.find-hit.is-current').first().evaluate(mark => {
        const r = mark.getBoundingClientRect();
        const frame = mark.closest('pre,table').getBoundingClientRect();
        const pane = document.querySelector('#previewpane').getBoundingClientRect();
        return r.top >= frame.top && r.bottom <= frame.bottom && r.left >= pane.left && r.right <= pane.right;
      })).toBe(true);
    }
    await page.keyboard.press('Escape');

    let imageRequested = false;
    let releaseImage;
    const imageReleased = new Promise(resolve => { releaseImage = resolve; });
    await page.route('**/api/raw?**', async route => {
      if (new URL(route.request().url()).searchParams.get('path')?.endsWith('/late.svg')) {
        imageRequested = true;
        await imageReleased;
        await route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="tan"/></svg>'});
      } else await route.continue();
    });
    await fs.writeFile(path.join(workspace, 'late.svg'), imageSVG('tan'));
    const long = await fs.readFile(path.join(workspace, 'long.md'), 'utf8');
    await fs.writeFile(path.join(workspace, 'long.md'), '![Delayed image](late.svg)\n\n' + long);
    await open(page, path.join(workspace, 'long.md'));
    await page.locator('#previewpane').click({position: {x: 400, y: 12}});
    await page.keyboard.press('ControlOrMeta+f');
    await page.locator('#find-q').fill('Passage 20.');
    await expect.poll(() => visibleText(page)).toContain('Passage 20.');
    expect(imageRequested).toBe(true);
    releaseImage();
    await expect.poll(() => page.locator('#preview img').evaluate(n => n.complete)).toBe(true);
    await expect.poll(() => visibleText(page)).toContain('Passage 20.');
    await page.keyboard.press('Escape');
    await fs.writeFile(path.join(workspace, 'sample.py'), 'print("code view")\n');
    await open(page, path.join(workspace, 'sample.py'));
    await expect(page.locator('html')).toHaveAttribute('data-paged', 'no');
    await expect(page.locator('#preview-layout')).toBeHidden();
    await open(page, path.join(workspace, 'long.md'));
    await expect(page.locator('html')).toHaveAttribute('data-paged', 'yes');
  });

});
