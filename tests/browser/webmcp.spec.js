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
