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
    assert.equal(tools.length,2);
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


test('real server confines local links to the host-opened directory and returns no contents', async () => {
  const root=await mkdtemp(join(tmpdir(),'reader-link-security-'));
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
  } finally {await client.close();await rm(root,{recursive:true,force:true});}
});

test('packaged branding uses existing Reader artwork and both manifest assets exist', async () => {
  const plugin=JSON.parse(await readFile(new URL('../../build/chatgpt/plugin.json',import.meta.url),'utf8'));
  const ui=plugin.extensions['com.openai'].interface;
  assert.equal(ui.logo,'./assets/reader.png'); assert.equal(ui.composerIcon,ui.logo);
  const icon=await readFile(new URL('../../build/chatgpt/'+ui.logo,import.meta.url));
  const original=await readFile(new URL('../../src/reader/common/ReaderIcon-1024.png',import.meta.url));
  assert.deepEqual(icon,original);
});
