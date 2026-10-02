import {test, expect} from '@playwright/test';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../../dist/viewer.html', import.meta.url), 'utf8');

async function host(page, {resources = true, storage = true, links = false} = {}) {
  const requests = [], errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://reader.test/**', route => route.fulfill({body:'<!doctype html><html><body></body></html>',contentType:'text/html'}));
  await page.goto('http://reader.test/');
  await page.evaluate(({html, resources, storage, links}) => {
    window.host = {calls:[], frames:[], text: '# Reader\n\nA shared reading interface.\n\n- [x] Read only\n\n![Relative image](./secret.png)\n\n[Relative file](./secret.md) · [External](https://example.com) · [Section](#reader)\n\n<script>window.pwned=true</script>\n<img src="x" onerror="window.pwned=true">', fail:false};
    window.addEventListener('message', event => {
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      window.host.calls.push(message);
      const reply = result => event.source.postMessage({jsonrpc:'2.0',id:message.id,result}, '*');
      if (message.method === 'ui/initialize') reply({protocolVersion:'2026-01-26',hostInfo:{name:'test-host',version:'1'},hostCapabilities: resources ? {experimental:{'openai/resource':{}},serverResources:{},...(links?{openLinks:{}}:{})} : {},hostContext:{}});
      else if (message.method === 'ui/notifications/initialized') {
        event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:{file:{name:'demo.md',resourceUri:'host:demo'}}}}, '*');
      } else if (message.method === 'resources/read') {
        if (window.host.fail) event.source.postMessage({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'temporary failure'}},'*');
        else reply({contents:[{uri:message.params.uri,text:window.host.text,_meta:{'openai/resource':{writable:true,etag:'v1'}}}]});
      } else if (message.id !== undefined) reply({});
    });
    window.host.add = () => {
      const frame = document.createElement('iframe'); frame.style='width:100%;height:700px;border:0';
      frame.sandbox=storage?'allow-scripts allow-same-origin':'allow-scripts';
      frame.srcdoc=html; document.body.append(frame); window.host.frames.push(frame);
    };
    window.host.add();
  }, {html, resources, storage, links});
  const frame = page.frameLocator('iframe').first();
  return {frame, requests, errors};
}

test('bundled SDK viewer reads, sanitizes, refreshes and never calls local APIs or writes', async ({page}, testInfo) => {
  const {frame,requests,errors}=await host(page);
  await expect(frame.locator('#preview h1')).toHaveText('Reader');
  await expect(frame.locator('#preview input')).toBeDisabled();
  await expect(frame.locator('#preview script, #preview [onerror]')).toHaveCount(0);
  await expect(frame.getByText('Image unavailable: Relative image')).toBeVisible();
  await expect(frame.getByRole('button',{name:'Save',exact:true})).toBeHidden();
  await expect(frame.locator('#editor')).not.toBeVisible();
  await frame.getByRole('link',{name:'Relative file'}).click();
  await expect(frame.locator('#toast')).toContainText('unavailable');
  await frame.getByRole('link',{name:'External',exact:true}).click();
  await expect(frame.locator('#toast')).toContainText('unavailable on this host');
  await frame.getByRole('button',{name:'Find',exact:true}).click();
  await frame.locator('#find-q').fill('shared');
  await expect(frame.locator('#find-count')).toContainText('1');
  await frame.locator('#find-close').click();
  await page.evaluate(() => {window.host.text='# Updated\n\nChanged by the assistant.';window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'notifications/resources/updated',params:{uri:'host:demo'}},'*');});
  await expect(frame.locator('#preview h1')).toHaveText('Updated');
  await page.evaluate(() => {window.host.fail=true;window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'notifications/resources/updated',params:{uri:'host:demo'}},'*');});
  await expect(frame.locator('#toast')).toContainText('last preview');
  await expect(frame.locator('#preview h1')).toHaveText('Updated');
  await page.screenshot({path:testInfo.outputPath('embedded-light-error.png')});
  await frame.getByRole('button',{name:'Theme',exact:true}).click();
  await page.screenshot({path:testInfo.outputPath('embedded-dark.png')});
  const calls=await page.evaluate(()=>window.host.calls);
  expect(calls.some(call=>call.method==='resources/subscribe')).toBeTruthy();
  expect(calls.filter(call=>call.method==='resources/read').every(call=>call.params._meta['openai/resource'].representation==='text')).toBeTruthy();
  expect(calls.some(call=>/write|tools\/call/.test(call.method||''))).toBeFalsy();
  expect(requests.filter(url=>url!== 'http://reader.test/')).toEqual([]);
  expect(errors).toEqual([]);
});

test('storage denial falls back to memory and a second panel keeps its own document', async ({page}) => {
  const {frame,errors}=await host(page,{storage:false});
  await expect(frame.locator('#preview h1')).toHaveText('Reader');
  await frame.getByRole('button',{name:'A+',exact:true}).click();
  await expect(frame.locator('html')).toHaveAttribute('style',/--fs-body: 17.5px/);
  await page.evaluate(()=>{window.host.text='# Second'; window.host.add();});
  await expect(page.frameLocator('iframe').nth(1).locator('#preview h1')).toHaveText('Second');
  await expect(frame.locator('#preview h1')).toHaveText('Reader');
  expect(errors).toEqual([]);
});

test('missing host resource capability reports the unsupported surface', async ({page},testInfo) => {
  const {frame,errors}=await host(page,{resources:false});
  await expect(frame.locator('#toast')).toContainText('does not support file resources');
  await expect(frame.locator('#embedded-status')).toContainText('does not support file resources');
  await expect(frame.locator('#preview')).toBeEmpty();
  await page.screenshot({path:testInfo.outputPath('embedded-unsupported.png')});
  expect(errors).toEqual([]);
});


test('supported external links use the host and refresh preserves the reading offset at narrow widths', async ({page},testInfo) => {
  const {frame,requests,errors}=await host(page,{links:true});
  await expect(frame.locator('#preview h1')).toHaveText('Reader');
  await frame.getByRole('link',{name:'External',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.host.calls.some(call=>call.method==='ui/open-link' && call.params.url==='https://example.com'))).toBeTruthy();
  await page.setViewportSize({width:420,height:720});
  await page.evaluate(()=>{window.host.text='# Long document\n\n'+('A paragraph for checking the reading position.\n\n'.repeat(100));window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'notifications/resources/updated',params:{uri:'host:demo'}},'*');});
  await expect(frame.locator('#preview h1')).toHaveText('Long document');
  await frame.locator('#previewpane').evaluate(node=>{node.scrollTop=1100;});
  await expect.poll(()=>frame.locator('#previewpane').evaluate(node=>node.scrollTop)).toBeGreaterThan(1000);
  await page.evaluate(()=>{window.host.text+='New ending.\n';window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'notifications/resources/updated',params:{uri:'host:demo'}},'*');});
  await expect(frame.locator('#preview')).toContainText('New ending.');
  await expect.poll(()=>frame.locator('#previewpane').evaluate(node=>node.scrollTop)).toBeGreaterThan(1000);
  await page.screenshot({path:testInfo.outputPath('embedded-narrow.png')});
  expect(requests.filter(url=>url!=='http://reader.test/')).toEqual([]);
  expect(errors).toEqual([]);
});

test('same-document anchors reveal a distant heading in single-column and two-page layouts', async ({page}) => {
  const {frame, requests, errors}=await host(page,{links:true});
  await expect(frame.locator('#preview h1')).toHaveText('Reader');
  await page.evaluate(()=>{
    window.host.text='# Anchor check\n\n[Go to destination](#destination)\n\n'+('Filler paragraph with enough words to require scrolling.\n\n'.repeat(100))+'## Destination\n\n[Return to top](#anchor-check)\n';
    window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'notifications/resources/updated',params:{uri:'host:demo'}},'*');
  });
  await expect(frame.locator('#preview h1')).toHaveText('Anchor check');
  const destination=frame.locator('#destination');
  const visibleInPane=()=>destination.evaluate(node=>{
    const target=node.getBoundingClientRect(), pane=document.getElementById('previewpane').getBoundingClientRect();
    return target.top>=pane.top-2 && target.bottom<=pane.bottom+2 && target.left>=pane.left-2 && target.right<=pane.right+2;
  });
  expect(await visibleInPane()).toBeFalsy();
  await frame.getByRole('link',{name:'Go to destination'}).click();
  await expect.poll(visibleInPane).toBeTruthy();
  await expect.poll(()=>frame.locator('#previewpane').evaluate(node=>node.scrollTop)).toBeGreaterThan(1000);
  await frame.getByRole('link',{name:'Return to top'}).click();
  await expect.poll(()=>frame.locator('#previewpane').evaluate(node=>node.scrollTop)).toBeLessThan(200);
  await frame.getByRole('button',{name:'Layout',exact:true}).click();
  await expect(frame.locator('html')).toHaveAttribute('data-paged','yes');
  await frame.getByRole('link',{name:'Go to destination'}).click();
  await expect.poll(visibleInPane).toBeTruthy();
  const calls=await page.evaluate(()=>window.host.calls);
  expect(calls.some(call=>call.method==='ui/open-link')).toBeFalsy();
  expect(requests.filter(url=>url!=='http://reader.test/')).toEqual([]);
  expect(errors).toEqual([]);
});

test('HTTP and HTTPS use host opening while filesystem document links stay unavailable', async ({page}) => {
  const {frame,requests,errors}=await host(page,{links:true});
  await expect(frame.locator('#preview h1')).toHaveText('Reader');
  await page.evaluate(()=>{
    window.host.text='# Link categories\n\n[Relative](./linked.md)\n\n[Absolute](/Users/example/linked.md)\n\n[File URI](file:///Users/example/linked.md)\n\n[HTTP](http://example.com/read)\n\n[HTTPS](https://example.com/read)\n';
    window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'notifications/resources/updated',params:{uri:'host:demo'}},'*');
  });
  await expect(frame.locator('#preview h1')).toHaveText('Link categories');
  for (const label of ['Relative','Absolute','File URI']) {
    await frame.getByText(label,{exact:true}).click();
    await expect(frame.locator('#embedded-status')).toContainText('unavailable in the embedded viewer');
    await expect(frame.locator('#preview h1')).toHaveText('Link categories');
  }
  for (const [label,url] of [['HTTP','http://example.com/read'],['HTTPS','https://example.com/read']]) {
    await frame.getByRole('link',{name:label,exact:true}).click();
    await expect.poll(()=>page.evaluate(url=>window.host.calls.some(call=>call.method==='ui/open-link' && call.params.url===url),url)).toBeTruthy();
  }
  const calls=await page.evaluate(()=>window.host.calls);
  expect(calls.filter(call=>call.method==='ui/open-link').map(call=>call.params.url)).toEqual(['http://example.com/read','https://example.com/read']);
  expect(calls.some(call=>call.method==='tools/call')).toBeFalsy();
  expect(requests.filter(url=>url!=='http://reader.test/')).toEqual([]);
  expect(errors).toEqual([]);
});
