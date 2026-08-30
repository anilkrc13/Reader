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
