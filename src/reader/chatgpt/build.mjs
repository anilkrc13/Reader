import { build } from 'esbuild';
import { readFile, mkdir, writeFile, cp, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../web');
const output = resolve(here, '../../../build/chatgpt');
const version = (await readFile(resolve(here, '../../../VERSION'), 'utf8')).trim();
const define = {__READER_VERSION__: JSON.stringify(version)};
await mkdir(output, {recursive: true});
const app = await build({entryPoints: [resolve(here, 'app.ts')], bundle: true, metafile: true, define, format: 'esm', target: 'es2022', write: false});
const server = await build({entryPoints: [resolve(here, 'server.ts')], bundle: true, metafile: true, platform: 'node', format: 'esm', define, banner: {js: "import {createRequire} from 'node:module'; const require = createRequire(import.meta.url);"}, outfile: resolve(output, 'server.mjs')});
await build({entryPoints: [resolve(here, 'session.ts')], bundle: true, platform: 'node', format: 'esm', outfile: resolve(output, 'session.mjs')});
let css = await readFile(resolve(source, 'app.css'), 'utf8');
for (const match of [...css.matchAll(/url\(\/static\/([^)]*)\)/g)]) {
  const data = await readFile(resolve(source, match[1]));
  const mime = match[1].endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
  css = css.replace(match[0], `url(data:${mime};base64,${data.toString('base64')})`);
}
css += '\n' + await readFile(resolve(here, 'embedded.css'), 'utf8');
let html = await readFile(resolve(source, 'index.html'), 'utf8');
html = html.replace('<html ', '<html data-host="chatgpt" ')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<link\b[^>]*>/g, '')
  .replace(/<img\b[^>]*src="\/static\/[^"]*"[^>]*>/g, '')
  .replace('</head>', () => `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>${css}</style></head>`);
const safeScript = text => text.replace(/<\/script/gi, '<\\/script');
let scripts = '';
for (const name of ['vendor/marked.min.js', 'vendor/purify.min.js', 'vendor/highlight.min.js', 'vendor/mermaid.min.js', 'app.js']) {
  scripts += `<script>${safeScript(await readFile(resolve(source, name), 'utf8'))}</script>`;
}
scripts += `<script type="module">${safeScript(app.outputFiles[0].text)}</script>`;
html = html.replace('</body>', () => `${scripts}</body>`);
await writeFile(resolve(output, 'viewer.html'), html);

await mkdir(resolve(output, 'assets'), {recursive: true});
await cp(resolve(here, '../common/ReaderIcon-1024.png'), resolve(output, 'assets/reader.png'));
await writeFile(resolve(output, 'plugin.json'), JSON.stringify({
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
  name: 'reader-markdown', version, description: 'Read Markdown files in Reader in the desktop conversation panel.',
  'extensions': {'com.openai': {interface: {displayName: 'Reader Markdown', shortDescription: 'Read-only Markdown viewer', logo: './assets/reader.png', composerIcon: './assets/reader.png'}}}
}, null, 2) + '\n');
await writeFile(resolve(output, 'mcp.json'), JSON.stringify({
  $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
  mcpServers: {'reader-markdown': {type: 'stdio', command: 'node', args: ['./server.mjs'], cwd: './'}}
}, null, 2) + '\n');

// Retain the licenses of the shared assets and each npm package used by the bundles.
await cp(resolve(here, '../../../licenses'), resolve(output, 'licenses'), {recursive: true});
await cp(resolve(here, '../../../LICENSE'), resolve(output, 'LICENSE'));
const packages = new Set();
for (const input of [...Object.keys(app.metafile.inputs), ...Object.keys(server.metafile.inputs)]) {
  const absolute = resolve(input);
  const match = absolute.match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  if (match) packages.add(match[1]);
}
let notices = '';
for (const directory of [...packages].sort()) {
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  notices += `\n${pkg.name} ${pkg.version}\n`;
  for (const filename of await readdir(directory)) {
    if (/^(?:licen[sc]e|copying|notice)(?:$|\.)/i.test(filename)) {
      notices += `\n${await readFile(resolve(directory, filename), 'utf8')}\n`;
    }
  }
}
await writeFile(resolve(output, 'licenses/npm-notices.txt'), notices);
