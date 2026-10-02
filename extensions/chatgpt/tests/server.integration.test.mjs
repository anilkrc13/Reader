import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';

test('the bundled stdio server advertises only Markdown and serves its self-contained UI', async () => {
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../dist/server.mjs',import.meta.url))]});
  const client=new Client({name:'Reader integration test',version:'1'},{});
  try {
    await client.connect(transport);
    const {tools}=await client.listTools();
    assert.equal(tools.length,1);
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
