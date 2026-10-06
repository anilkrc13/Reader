import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtemp, mkdir, writeFile, symlink, realpath, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Use the adapter's pinned SDK without duplicating dependencies in the root package.
const require = createRequire(new URL('../../src/reader/chatgpt/package.json', import.meta.url));
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');

test('the bundled stdio server advertises only Markdown and serves its self-contained UI', async () => {
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../../build/chatgpt/server.mjs',import.meta.url))]});
  const client=new Client({name:'Reader integration test',version:'1'},{});
  try {
    await client.connect(transport);
    const {tools}=await client.listTools();
    assert.equal(tools.length,4);
    const fontTool=tools.find(tool=>tool.name==='reader_font_catalog');
    assert.deepEqual(fontTool._meta.ui,{visibility:['app']});
    const catalog=(await client.callTool({name:'reader_font_catalog',arguments:{}}))._meta['reader/font-catalog'];
    assert.equal(catalog.version,1);
    assert.equal(catalog.provenance,'backend-machine');
    assert.equal(catalog.rendering,'viewer-verification-required');
    assert.equal(typeof catalog.available,'boolean');
    assert.ok(Array.isArray(catalog.families));
    if (process.platform==='darwin') { assert.equal(catalog.available,true); assert.ok(catalog.families.length>0); }
    const resolver=tools.find(tool=>tool.name==='reader_resolve_local_link');
    assert.deepEqual(resolver._meta.ui,{visibility:['app']});
    assert.equal(resolver.annotations.readOnlyHint,true);
    assert.deepEqual(tools[0]._meta['openai/ui'].entrypoints,[{type:'file',extensions:['.md']}]);
    assert.equal(tools[0].annotations.readOnlyHint,true);
    const resource=await client.readResource({uri:tools[0]._meta.ui.resourceUri});
    assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');
    assert.match(resource.contents[0].text,/data-host="chatgpt"/);
    assert.match(resource.contents[0].text,/font\/woff2;base64/);
    assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains,[]);
    assert.doesNotMatch(resource.contents[0].text,/<(?:script|link)[^>]*(?:src|href)="\/static\//);
    await assert.rejects(client.readResource({uri:'file:///etc/passwd'}));
  } finally {await client.close();}
});


test('real server confines local links to the host-opened directory and returns no contents', async (t) => {
  const root=await mkdtemp(join(tmpdir(),'reader-link-security-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const base=join(root,'opened'), outside=join(root,'opened-other');
  await mkdir(base); await mkdir(outside); await mkdir(join(base,'child')); await mkdir(join(base,'directory.md'));
  const opened=join(base,'index.md'), allowed=join(base,'linked file.md'), child=join(base,'child','nested.MD');
  await writeFile(opened,'# Opened'); await writeFile(allowed,'private document bytes'); await writeFile(child,'# Child');
  await writeFile(join(outside,'secret.md'),'outside secret'); await writeFile(join(base,'secret.txt'),'not markdown');
  await symlink(join(outside,'secret.md'),join(base,'escape.md'));
  await symlink(outside,join(base,'escape-dir'));
  await symlink(join(base,'secret.txt'),join(base,'alias.md'));
  await symlink(allowed,join(base,'safe.md'));
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../../build/chatgpt/server.mjs',import.meta.url))]});
  const client=new Client({name:'Reader local-link security test',version:'1'},{});
  const meta={'openai/resource':{path:opened}};
  const call=(href,_meta=meta,args={})=>client.callTool({name:'reader_resolve_local_link',arguments:{href,...args},_meta});
  try {
    await client.connect(transport);
    for (const [href,target] of [['./linked%20file.md',allowed],['child/nested.MD',child],['safe.md',allowed]]) {
      const result=await call(href);
      assert.equal(result.isError,undefined,href);
      assert.deepEqual(result.content,[]);
      assert.equal(result._meta['reader/local-link'].path,await realpath(target));
      assert.doesNotMatch(JSON.stringify(result),/private document bytes/);
    }
    for (const href of ['../opened-other/secret.md','%2e%2e/ opened-other/secret.md','%2e%2e/opened-other/secret.md','escape.md','escape-dir/secret.md','alias.md','directory.md','missing.md','secret.txt',allowed,'file://'+allowed,'https://example.com/file.md','//server/file.md','C:\\outside\\file.md','%2fetc/passwd.md','%ZZ.md','%00.md','linked%20file.md#heading','linked%20file.md?download=1']) {
      const result=await call(href);
      assert.equal(result.isError,true,href); assert.equal(result._meta,undefined);
      assert.doesNotMatch(JSON.stringify(result),new RegExp(root));
    }
    for (const bad of [{}, {'openai/resource':{}}, {'openai/resource':{path:23}}, {'openai/resource':{path:'index.md'}}, {'openai/resource':{path:join(base,'missing.md')}}, {'openai/resource':{path:join(base,'escape.md')}}]) {
      const result=await call('./linked%20file.md',bad);
      assert.equal(result.isError,true,JSON.stringify(bad));
    }
    const untrusted=await client.callTool({name:'reader_resolve_local_link',arguments:{href:'safe.md',basePath:opened,file:{path:opened}}});
    assert.equal(untrusted.isError,true);
    assert.equal(await readFile(allowed,'utf8'),'private document bytes');
  } finally {await client.close();}
});

test('packaged branding uses existing Reader artwork and both manifest assets exist', async () => {
  const plugin=JSON.parse(await readFile(new URL('../../build/chatgpt/plugin.json',import.meta.url),'utf8'));
  const ui=plugin.extensions['com.openai'].interface;
  assert.equal(ui.logo,'./assets/reader.png'); assert.equal(ui.composerIcon,ui.logo);
  const icon=await readFile(new URL('../../build/chatgpt/'+ui.logo,import.meta.url));
  const original=await readFile(new URL('../../src/reader/common/ReaderIcon-1024.png',import.meta.url));
  assert.deepEqual(icon,original);
});


test('image tool reads scoped SVG and raster bytes but rejects untrusted context and escapes', async (t) => {
  const root=await mkdtemp(join(tmpdir(),'reader-image-security-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const base=join(root,'docs'); await mkdir(base); await mkdir(join(base,'images'));
  const opened=join(base,'index.md'); await writeFile(opened,'# Diagram');
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20"/></svg>';
  await writeFile(join(base,'images','flow.svg'),svg);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=','base64');
  await writeFile(join(base,'plot.png'),png);
  await writeFile(join(root,'outside.svg'),svg);
  await writeFile(join(base,'secret.txt'),'private data');
  await writeFile(join(base,'large.png'),Buffer.alloc(8*1024*1024+1));
  await symlink(join(root,'outside.svg'),join(base,'escape.svg'));
  await symlink(join(base,'secret.txt'),join(base,'alias.svg'));
  const client=new Client({name:'Reader image test',version:'1'},{});
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../../build/chatgpt/server.mjs',import.meta.url))]});
  const meta={'openai/resource':{path:opened}};
  const call=(href,_meta=meta)=>client.callTool({name:'reader_read_local_image',arguments:{href},_meta});
  try {
    await client.connect(transport);
    const tool=(await client.listTools()).tools.find(t=>t.name==='reader_read_local_image');
    assert.deepEqual(tool._meta.ui,{visibility:['app']});
    assert.equal(tool.annotations.readOnlyHint,true);
    for (const [href,mime,bytes] of [['images/flow.svg','image/svg+xml',Buffer.from(svg)],['plot.png','image/png',png]]) {
      const result=await call(href); assert.equal(result.isError,undefined);
      assert.deepEqual(result.content,[]);
      assert.equal(result._meta['reader/local-image'].dataUrl,`data:${mime};base64,${bytes.toString('base64')}`);
      assert.doesNotMatch(JSON.stringify(result),new RegExp(root));
    }
    for (const href of ['../outside.svg','%2e%2e/outside.svg','escape.svg','alias.svg','secret.txt','large.png','missing.svg','images/flow.svg?x','images/flow.svg#x','file://'+opened,'https://example.com/flow.svg',join(base,'plot.png')]) {
      const result=await call(href); assert.equal(result.isError,true,href);
      assert.equal(result._meta,undefined); assert.doesNotMatch(JSON.stringify(result),new RegExp(root));
    }
    for (const context of [{},{'openai/resource':{path:'index.md'}},{'openai/resource':{path:join(base,'missing.md')}}]) {
      assert.equal((await call('plot.png',context)).isError,true);
    }
  } finally {await client.close();}
});
