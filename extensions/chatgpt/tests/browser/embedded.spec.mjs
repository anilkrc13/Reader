import {test, expect} from '@playwright/test';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../../dist/viewer.html', import.meta.url), 'utf8');

async function host(page, {resources = true, storage = true, links = false, theme = "light", savedPrefs = {}, documentText = null} = {}) {
  const requests = [], errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://reader.test/**', route => route.fulfill({body:'<!doctype html><html><body></body></html>',contentType:'text/html'}));
  await page.goto('http://reader.test/');
  await page.evaluate(({html, resources, storage, links, theme, savedPrefs, documentText}) => {
    if (storage) localStorage.setItem("reader.chatgpt.reading.v1", JSON.stringify(savedPrefs));
    window.host = {calls:[], frames:[], text: '# Reader\n\nA shared reading interface.\n\n- [x] Read only\n\n![Relative image](./secret.png)\n\n[Relative file](./secret.md) · [External](https://example.com) · [Section](#reader)\n\n<script>window.pwned=true</script>\n<img src="x" onerror="window.pwned=true">', fail:false};
    window.addEventListener('message', event => {
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      window.host.calls.push(message);
      const reply = result => event.source.postMessage({jsonrpc:'2.0',id:message.id,result}, '*');
      if (message.method === 'ui/initialize') reply({protocolVersion:'2026-01-26',hostInfo:{name:'test-host',version:'1'},hostCapabilities: resources ? {experimental:{'openai/resource':{}},serverResources:{},...(links?{openLinks:{}}:{})} : {},hostContext:{theme}});
      else if (message.method === 'ui/notifications/initialized') {
        event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:{file:{name:'demo.md',resourceUri:'host:demo'}}}}, '*');
      } else if (message.method === 'resources/read') {
        if (window.host.fail) event.source.postMessage({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'temporary failure'}},'*');
        else reply({contents:[{uri:message.params.uri,text:window.host.text,_meta:{'openai/resource':{writable:true,etag:'v1'}}}]});
      } else if (message.id !== undefined) reply({});
    });
    if (documentText !== null) window.host.text = documentText;
    window.host.add = () => {
      const frame = document.createElement('iframe'); frame.style='width:100%;height:700px;border:0';
      frame.sandbox=storage?'allow-scripts allow-same-origin':'allow-scripts';
      frame.srcdoc=html; document.body.append(frame); window.host.frames.push(frame);
    };
    window.host.add();
  }, {html, resources, storage, links, theme, savedPrefs, documentText});
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
  await page.evaluate(()=>window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'dark'}},'*'));
  await expect(frame.locator('html')).toHaveAttribute('data-theme','dark');
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
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await frame.getByRole('tab',{name:'Reading',exact:true}).click();
  { const bodyFineTune=frame.locator('[data-panel=reading] details').first();
  if (!(await bodyFineTune.evaluate(n=>n.open))) await bodyFineTune.locator('summary').click(); }
  await frame.getByRole('slider',{name:'Body text size'}).press('ArrowRight');
  await expect(frame.locator('html')).toHaveAttribute('style',/--fs-body: 17px/);
  await frame.getByRole('button',{name:'Close settings'}).click();
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
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await frame.getByRole('tab',{name:'Reading',exact:true}).click();
  { const bodyFineTune=frame.locator('[data-panel=reading] details').first();
  if (!(await bodyFineTune.evaluate(n=>n.open))) await bodyFineTune.locator('summary').click(); }
  await frame.getByRole('button',{name:'Two-page layout',exact:true}).click();
  await frame.getByRole('button',{name:'Close settings'}).click();
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


test('host theme wins over saved theme and reading preferences improve narrow headings', async ({page},testInfo) => {
  const {frame,requests,errors}=await host(page,{theme:'dark',savedPrefs:{theme:'light',fontSize:18,measure:90}});
  await expect(frame.locator('#preview h1')).toHaveText('Reader');
  await expect(frame.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(frame.getByRole('button',{name:'Theme',exact:true})).toHaveCount(0);
  for (const label of ['Find','Refresh','Settings']) {
    const button=frame.getByRole('button',{name:label,exact:true});
    await expect(button.locator('svg')).toHaveCount(1);
    await expect(button).toHaveText('');
  }
  await page.setViewportSize({width:420,height:720});
  await page.evaluate(()=>{
    window.host.text='# Reading should feel comfortable in a narrow conversation panel\n\nContent with room to breathe.';
    window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'notifications/resources/updated',params:{uri:'host:demo'}},'*');
  });
  await expect(frame.locator('#preview h1')).toContainText('Reading should feel comfortable');
  const dimensions=await frame.locator('#preview h1').evaluate(node=>{
    const style=getComputedStyle(node), rect=node.getBoundingClientRect();
    return {width:rect.width,font:parseFloat(style.fontSize),line:parseFloat(style.lineHeight)};
  });
  expect(dimensions.width).toBeGreaterThan(300);
  expect(dimensions.font).toBeLessThanOrEqual(32);
  expect(dimensions.line / dimensions.font).toBeGreaterThan(1.15);
  await page.screenshot({path:testInfo.outputPath('embedded-heading-dark.png')});
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await frame.getByRole('tab',{name:'Reading',exact:true}).click();
  { const bodyFineTune=frame.locator('[data-panel=reading] details').first();
  if (!(await bodyFineTune.evaluate(n=>n.open))) await bodyFineTune.locator('summary').click(); }
  const dialog=frame.getByRole('dialog',{name:'Settings'});
  await expect(dialog).toBeVisible();
  await frame.getByRole('slider',{name:'Line width'}).press('End');
  await frame.getByRole('slider',{name:'Body line height'}).press('End');
  await frame.getByRole('slider',{name:'Body text size'}).press('Home');
  await expect(frame.locator('html')).toHaveAttribute('style',/--measure: 100%/);
  await expect(frame.locator('html')).toHaveAttribute('style',/--lh-body: 2.2/);
  await expect(frame.locator('html')).toHaveAttribute('style',/--fs-body: 13px/);
  await page.screenshot({path:testInfo.outputPath('embedded-settings-dark.png')});
  await frame.getByRole('button',{name:'Close settings'}).click();
  await expect(frame.getByRole('button',{name:'Settings',exact:true})).toBeFocused();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('reader.chatgpt.reading.v1')));
  expect(saved).toMatchObject({fontSize:13,lineHeight:2.2,measure:100,previewLayout:'single'});
  expect(saved).not.toHaveProperty('theme');
  expect(saved).not.toHaveProperty('autoSave');
  await page.evaluate(()=>window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'light'}},'*'));
  await expect(frame.locator('html')).toHaveAttribute('data-theme','light');
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await frame.getByRole('tab',{name:'Reading',exact:true}).click();
  { const bodyFineTune=frame.locator('[data-panel=reading] details').first();
  if (!(await bodyFineTune.evaluate(n=>n.open))) await bodyFineTune.locator('summary').click(); }
  await page.screenshot({path:testInfo.outputPath('embedded-settings-light.png')});
  await dialog.press('Escape'); await expect(dialog).not.toBeVisible();
  await page.evaluate(()=>window.host.add());
  const next=page.frameLocator('iframe').nth(1);
  await expect(next.locator('html')).toHaveAttribute('style',/--measure: 100%/);
  await expect(next.locator('html')).toHaveAttribute('data-theme','dark');
  expect(requests.filter(url=>url!=='http://reader.test/')).toEqual([]);
  expect(errors).toEqual([]);
});


test('embedded reading keys preserve control focus and nested scrolling', async ({page}) => {
  const text='# Keyboard reading\n\n'+('A reading paragraph.\n\n'.repeat(100))+
    '<pre tabindex="0" style="height:80px;overflow:auto">'+('Nested code line\n'.repeat(100))+'</pre>';
  const {frame}=await host(page, {documentText:text});
  const pane=frame.locator('#previewpane');
  await expect(frame.locator('#preview h1')).toHaveText('Keyboard reading');
  await expect(pane).toBeFocused();
  const top=()=>pane.evaluate(n=>n.scrollTop);
  for (const [down,up] of [['ArrowDown','ArrowUp'],['PageDown','PageUp'],['Space','Shift+Space']]) {
    await page.keyboard.press(down);
    await expect.poll(top).toBeGreaterThan(0);
    await page.keyboard.press(up);
    await expect.poll(top).toBe(0);
  }
  await page.keyboard.press('End'); await expect.poll(top).toBeGreaterThan(1000);
  await page.keyboard.press('Home'); await expect.poll(top).toBe(0);
  await frame.getByRole('button',{name:'Find',exact:true}).click();
  await frame.locator('#find-q').fill('reading');
  await frame.locator('#find-q').press('Home');
  await expect(frame.locator('#find-q')).toBeFocused();
  // A refresh must not take the caret from Find.
  await page.evaluate(()=>{window.host.text+='\nUpdated ending.';window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'notifications/resources/updated',params:{uri:'host:demo'}},'*');});
  await expect(frame.locator('#preview')).toContainText('Updated ending.');
  await expect(frame.locator('#find-q')).toBeFocused();
  await frame.locator('#find-q').press('Escape');
  await expect(pane).toBeFocused();
  await page.keyboard.press('Home'); await expect.poll(top).toBe(0);
  await page.keyboard.press('PageDown'); await expect.poll(top).toBeGreaterThan(0);
  await page.keyboard.press('Home'); await expect.poll(top).toBe(0);
  const gear=frame.getByRole('button',{name:'Settings',exact:true});
  await gear.click();
  await frame.getByRole('tab',{name:'Reading',exact:true}).click();
  { const bodyFineTune=frame.locator('[data-panel=reading] details').first();
  if (!(await bodyFineTune.evaluate(n=>n.open))) await bodyFineTune.locator('summary').click(); }
  const dialog=frame.getByRole('dialog',{name:'Settings'});
  const slider=frame.getByRole('slider',{name:'Body text size'});
  await slider.press('Home');
  await expect(slider).toHaveValue('13');
  await expect.poll(top).toBe(0);
  await page.evaluate(()=>{window.host.text+='\nSettings update.';window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'notifications/resources/updated',params:{uri:'host:demo'}},'*');});
  await expect(frame.locator('#preview')).toContainText('Settings update.');
  await expect(slider).toBeFocused();
  await dialog.press('Escape'); await expect(gear).toBeFocused();
  await page.keyboard.press('PageDown'); await expect.poll(top).toBeGreaterThan(0);
  await page.keyboard.press('Home'); await expect.poll(top).toBe(0);
  // Space still activates a focused toolbar control.
  await gear.press('Space'); await expect(dialog).toBeVisible();
  await dialog.press('Escape');
  const nested=frame.locator('#preview pre');
  await nested.focus();
  const outer=await top();
  await nested.press('PageDown');
  await expect.poll(()=>nested.evaluate(n=>n.scrollTop)).toBeGreaterThan(0);
  expect(await top()).toBe(outer);
});

test('embedded reading keys navigate two-page reading and retain toolbar activation', async ({page}) => {
  await page.setViewportSize({width:1400,height:850});
  const {frame}=await host(page,{documentText:'# Paged keyboard\n\n'+('A long reading paragraph.\n\n'.repeat(150))});
  await expect(frame.locator('#preview h1')).toHaveText('Paged keyboard');
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await frame.getByRole('tab',{name:'Reading',exact:true}).click();
  { const bodyFineTune=frame.locator('[data-panel=reading] details').first();
  if (!(await bodyFineTune.evaluate(n=>n.open))) await bodyFineTune.locator('summary').click(); }
  await frame.getByRole('button',{name:'Two-page layout',exact:true}).click();
  await frame.getByRole('dialog',{name:'Settings'}).press('Escape');
  await expect(frame.locator('html')).toHaveAttribute('data-paged','yes');
  for (const [down,up] of [['ArrowDown','ArrowUp'],['PageDown','PageUp']]) {
    await page.keyboard.press(down); await expect(frame.locator('#page-label')).toContainText('Pages 3–4');
    await page.keyboard.press(up); await expect(frame.locator('#page-label')).toContainText('Pages 1–2');
  }
  await frame.locator('#previewpane').focus();
  await page.keyboard.press('Space'); await expect(frame.locator('#page-label')).toContainText('Pages 3–4');
  await page.keyboard.press('Shift+Space'); await expect(frame.locator('#page-label')).toContainText('Pages 1–2');
  await page.keyboard.press('End'); await expect(frame.locator('#page-prev')).toBeEnabled();
  await expect(frame.locator('#page-next')).toBeDisabled();
  await page.keyboard.press('Home'); await expect(frame.locator('#page-label')).toContainText('Pages 1–2');
});

// Shared settings must change the rendered document, survive reopening, and leave native preferences alone.
test('shared papers follow host mode, persist across panels, and reset independently', async ({page}, info) => {
  const {frame,errors,requests}=await host(page,{savedPrefs:{theme:'dark',paper:'invalid',fontSize:999,autoSave:true}});
  await expect(frame.locator('#preview h1')).toHaveText('Reader');
  await expect(frame.locator('html')).toHaveAttribute('data-theme','light');
  await expect(frame.locator('html')).toHaveAttribute('data-paper','cream');
  await page.evaluate(()=>localStorage.setItem('mdview.v2','native sentinel'));
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  const appearance=frame.locator('[data-panel=appearance]');
  await expect(appearance).toContainText('Follows Codex');
  await expect(appearance.locator('[data-set=theme]')).toHaveCount(0);
  const colors=[];
  for (const name of ['Cream','White','Sepia','Grey']) {
    await appearance.getByRole('button',{name,exact:true}).click();
    colors.push(await frame.locator('#main').evaluate(n=>getComputedStyle(n).backgroundColor));
  }
  expect(new Set(colors).size).toBe(4);
  await page.screenshot({path:info.outputPath('settings-appearance-light.png')});
  await page.evaluate(()=>window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'dark'}},'*'));
  await expect(frame.locator('html')).toHaveAttribute('data-theme','dark');
  const darkColors=[];
  for (const name of ['Ink','Charcoal','Black']) {
    await appearance.locator('[data-set=paperDark]').getByRole('button',{name,exact:true}).click();
    darkColors.push(await frame.locator('#main').evaluate(n=>getComputedStyle(n).backgroundColor));
  }
  expect(new Set(darkColors).size).toBe(3);
  await page.screenshot({path:info.outputPath('settings-appearance-dark.png')});
  await frame.getByRole('button',{name:'Close settings'}).click();
  await page.evaluate(()=>window.host.add());
  const second=page.frameLocator('iframe').nth(1);
  await expect(second.locator('#preview h1')).toHaveText('Reader');
  await expect(second.locator('html')).toHaveAttribute('data-paper','grey');
  await expect(second.locator('html')).toHaveAttribute('data-paper-dark','black');
  await expect(second.locator('html')).toHaveAttribute('data-theme','light');
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('reader.chatgpt.reading.v1')));
  expect(stored).not.toHaveProperty('theme'); expect(stored).not.toHaveProperty('autoSave');
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await frame.getByRole('button',{name:'Reset all to defaults'}).click();
  await expect(frame.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(frame.locator('html')).toHaveAttribute('data-paper','cream');
  expect(await page.evaluate(()=>localStorage.getItem('mdview.v2'))).toBe('native sentinel');
  expect(errors).toEqual([]); expect(requests.filter(u=>u!=='http://reader.test/')).toEqual([]);
});

test('shared reading and code controls affect rendering and unsupported tabs explain their limits', async ({page}, info) => {
  await page.setViewportSize({width:1400,height:850});
  const {frame,errors}=await host(page,{documentText:'# Adjustable title\n\nBody text.\n\n## Heading\n\n```js\nconst longLine = "'+('long '.repeat(60))+'";\n```\n\n| A | B |\n|---|---|\n| One | Two |'});
  await expect(frame.locator('#preview h1')).toHaveText('Adjustable title');
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await frame.getByRole('tab',{name:'Reading',exact:true}).click();
  await frame.locator('#sel-body').selectOption('inter');
  await frame.getByRole('button',{name:'Focus',exact:true}).click();
  const details=frame.locator('[data-panel=reading] details');
  await details.nth(1).locator('summary').click();
  await frame.getByRole('slider',{name:'Title size',exact:true}).press('End');
  await expect(frame.locator('#preview h1')).toHaveCSS('font-size','72px');
  const width=frame.getByRole('slider',{name:'Line width',exact:true});
  await width.press('Home'); for(let i=0;i<4;i++) await width.press('ArrowRight');
  const half=await frame.locator('#preview').evaluate(n=>n.getBoundingClientRect().width);
  await width.press('End');
  const full=await frame.locator('#preview').evaluate(n=>n.getBoundingClientRect().width);
  expect(full/half).toBeCloseTo(2,1); expect(full).toBeGreaterThan(1000);
  await frame.getByRole('switch',{name:'Column borders'}).click();
  await page.screenshot({path:info.outputPath('settings-reading-wide.png')});
  await frame.getByRole('tab',{name:'Code',exact:true}).click();
  await frame.getByRole('button',{name:'Vivid',exact:true}).click();
  await frame.locator('#sel-mono').selectOption('jetbrains');
  await frame.getByRole('slider',{name:'Code size',exact:true}).press('End');
  await frame.getByRole('switch',{name:'Wrap long lines'}).click();
  await expect(frame.locator('#preview pre')).toHaveCSS('white-space','pre-wrap');
  await expect(frame.locator('#preview code').first()).toHaveCSS('font-family',/JetBrains/);
  await page.screenshot({path:info.outputPath('settings-code-wide.png')});
  await page.evaluate(()=>window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'dark'}},'*'));
  await expect(frame.locator('html')).toHaveAttribute('data-theme','dark');
  await page.screenshot({path:info.outputPath('settings-code-dark.png')});
  for (const [tab,panel,explanation] of [['Editor','editor','read only'],['Files & watching','files','no folder browser'],['About','about','read-only conversation viewer']]) {
    await frame.getByRole('tab',{name:tab,exact:true}).click();
    await expect(frame.locator(`[data-panel=${panel}]`)).toContainText(explanation);
    await expect(frame.locator(`[data-panel=${panel}]`).locator('input,select,button')).toHaveCount(0);
    await page.screenshot({path:info.outputPath(`settings-${panel}.png`)});
  }
  await frame.getByRole('tab',{name:'Shortcuts',exact:true}).click();
  await expect(frame.locator('[data-panel=keys]')).not.toContainText('Save');
  await frame.getByRole('button',{name:'Close settings'}).click();
  await page.evaluate(()=>window.host.add());
  const second=page.frameLocator('iframe').nth(1);
  await expect(second.locator('#preview h1')).toHaveText('Adjustable title');
  await expect(second.locator('#preview h1')).toHaveCSS('font-size','72px');
  await expect(second.locator('#preview pre')).toHaveCSS('white-space','pre-wrap');
  await expect(second.locator('html')).toHaveAttribute('data-code','vivid');
  await page.setViewportSize({width:430,height:850});
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await frame.getByRole('tab',{name:'Reading',exact:true}).click();
  await page.screenshot({path:info.outputPath('settings-reading-narrow.png')});
  await frame.getByRole('button',{name:'Close settings'}).click();
  await expect(frame.locator('#preview h1')).toHaveCSS('font-size','43.2px');
  expect(errors).toEqual([]);
});
