import {test, expect} from '@playwright/test';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../../../build/chatgpt/viewer.html', import.meta.url), 'utf8');

async function host(page, {resources = true, storage = true, links = false, localFiles = false, theme = "light", savedPrefs = {}, documentText = null, paneSize = null, fontCatalog = null} = {}) {
  const requests = [], errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://reader.test/**', route => route.fulfill({body:'<!doctype html><html><body></body></html>',contentType:'text/html'}));
  await page.goto('http://reader.test/');
  await page.evaluate(({html, resources, storage, links, localFiles, theme, savedPrefs, documentText, paneSize, fontCatalog}) => {
    if (storage) localStorage.setItem("reader.chatgpt.reading.v1", JSON.stringify(savedPrefs));
    window.host = {fontCatalog, calls:[], frames:[], text: '# Reader\n\nA shared reading interface.\n\n- [x] Read only\n\n![Relative image](./secret.png)\n\n[Relative file](./secret.md) · [External](https://example.com) · [Section](#reader)\n\n<script>window.pwned=true</script>\n<img src="x" onerror="window.pwned=true">', fail:false};
    window.addEventListener('message', event => {
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      window.host.calls.push(message);
      if (!message.method) return;
      const reply = result => event.source.postMessage({jsonrpc:'2.0',id:message.id,result}, '*');
      if (message.method === 'ui/initialize') reply({protocolVersion:'2026-01-26',hostInfo:{name:'test-host',version:'1'},hostCapabilities: resources ? {experimental:{'openai/resource':{}},serverResources:{},...(links?{openLinks:{}}:{}),...(localFiles?{experimental:{'openai/resource':{},'openai/files':{}}}:{})} : {},hostContext:{theme}});
      else if (message.method === 'ui/notifications/initialized') {
        event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:{file:{name:'demo.md',resourceUri:'host:demo'}}}}, '*');
      } else if (message.method === 'resources/read') {
        if (window.host.fail) event.source.postMessage({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'temporary failure'}},'*');
        else reply({contents:[{uri:message.params.uri,text:window.host.text,_meta:{'openai/resource':{writable:true,etag:'v1'}}}]});
      } else if (message.method === 'tools/call' && message.params.name === 'reader_font_catalog') {
        reply({content:[],_meta:{'reader/font-catalog':window.host.fontCatalog ?? {version:1,platform:'unsupported',provenance:'backend-machine',rendering:'viewer-verification-required',available:false,families:[]}}});
      } else if (message.method === 'tools/call') {
        const result=window.host.linkFail ? {isError:true,content:[{type:'text',text:'unavailable'}]} : {content:[],_meta:{'reader/local-link':{path:'/trusted/document/linked.md'}}};
        if (window.host.deferLinks) (window.host.pendingLinks ??= []).push({id:message.id,source:event.source,result});
        else reply(result);
      } else if (message.method === 'openai/files/open' && window.host.openFail) event.source.postMessage({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'host refused'}},'*');
      else if (message.id !== undefined) reply({});
    });
    if (documentText !== null) window.host.text = documentText;
    window.host.add = () => {
      const frame = document.createElement('iframe'); frame.style=`width:${paneSize ? paneSize.width+'px' : '100%'};height:${paneSize ? paneSize.height : 700}px;border:0`;
      frame.sandbox=storage?'allow-scripts allow-same-origin':'allow-scripts';
      frame.srcdoc=html; document.body.append(frame); window.host.frames.push(frame);
    };
    window.host.add();
  }, {html, resources, storage, links, localFiles, theme, savedPrefs, documentText, paneSize, fontCatalog});
  const frame = page.frameLocator('iframe').first();
  return {frame, requests, errors};
}

async function settingsSection(frame, name) {
  const picker=frame.getByRole('combobox',{name:'Settings section'});
  if(await picker.isVisible()) await picker.selectOption({label:name});
  else await frame.getByRole('tab',{name,exact:true}).click();
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
  expect(calls.some(call=>/write/.test(call.method||''))).toBeFalsy();
  expect(calls.filter(call=>call.method==='tools/call').every(call=>call.params.name==='reader_font_catalog')).toBeTruthy();
  expect(requests.filter(url=>url!== 'http://reader.test/')).toEqual([]);
  expect(errors).toEqual([]);
});

test('storage denial falls back to memory and a second panel keeps its own document', async ({page}) => {
  const {frame,errors}=await host(page,{storage:false});
  await expect(frame.locator('#preview h1')).toHaveText('Reader');
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await settingsSection(frame,'Reading');
  { const bodyFineTune=frame.locator('[data-panel=reading] details').first();
  if (!(await bodyFineTune.evaluate(n=>n.open))) await bodyFineTune.locator('summary').click(); }
  await frame.getByRole('slider',{name:'Body text size'}).press('ArrowRight');
  await expect(frame.locator('html')).toHaveAttribute('style',/--fs-body: 17px/);
  await frame.getByRole('button',{name:/Close settings|Back to document/}).click();
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
  await settingsSection(frame,'Reading');
  { const bodyFineTune=frame.locator('[data-panel=reading] details').first();
  if (!(await bodyFineTune.evaluate(n=>n.open))) await bodyFineTune.locator('summary').click(); }
  await frame.getByRole('button',{name:'Two-page layout',exact:true}).click();
  await frame.getByRole('button',{name:/Close settings|Back to document/}).click();
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
    await expect(frame.locator('#embedded-status')).toContainText('Opening local files is unavailable on this host');
    await expect(frame.locator('#preview h1')).toHaveText('Link categories');
  }
  for (const [label,url] of [['HTTP','http://example.com/read'],['HTTPS','https://example.com/read']]) {
    await frame.getByRole('link',{name:label,exact:true}).click();
    await expect.poll(()=>page.evaluate(url=>window.host.calls.some(call=>call.method==='ui/open-link' && call.params.url===url),url)).toBeTruthy();
  }
  const calls=await page.evaluate(()=>window.host.calls);
  expect(calls.filter(call=>call.method==='ui/open-link').map(call=>call.params.url)).toEqual(['http://example.com/read','https://example.com/read']);
  expect(calls.some(call=>call.method==='tools/call' && call.params.name==='reader_resolve_local_link')).toBeFalsy();
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
  await settingsSection(frame,'Reading');
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
  await frame.getByRole('button',{name:/Close settings|Back to document/}).click();
  await expect(frame.getByRole('button',{name:'Settings',exact:true})).toBeFocused();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('reader.chatgpt.reading.v1')));
  expect(saved).toMatchObject({fontSize:13,lineHeight:2.2,measure:100,previewLayout:'single'});
  expect(saved).not.toHaveProperty('theme');
  expect(saved).not.toHaveProperty('autoSave');
  await page.evaluate(()=>window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'light'}},'*'));
  await expect(frame.locator('html')).toHaveAttribute('data-theme','light');
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await settingsSection(frame,'Reading');
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
  await settingsSection(frame,'Reading');
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
  await settingsSection(frame,'Reading');
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
  await frame.getByRole('button',{name:/Close settings|Back to document/}).click();
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
  await settingsSection(frame,'Reading');
  await expect(frame.locator('.font-source').first()).toContainText('Installed font discovery is unavailable on this backend');
  await expect(frame.locator('#sel-body option')).toHaveCount(2);
  await frame.locator('#sel-body').selectOption('system');
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
  await settingsSection(frame,'Code');
  await frame.getByRole('button',{name:'Vivid',exact:true}).click();
  await frame.locator('#sel-mono').selectOption('system');
  await frame.getByRole('slider',{name:'Code size',exact:true}).press('End');
  await frame.getByRole('switch',{name:'Wrap long lines'}).click();
  await expect(frame.locator('#preview pre')).toHaveCSS('white-space','pre-wrap');
  await expect(frame.locator('#preview code').first()).toHaveCSS('font-family',/monospace/);
  await page.screenshot({path:info.outputPath('settings-code-wide.png')});
  await page.evaluate(()=>window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'dark'}},'*'));
  await expect(frame.locator('html')).toHaveAttribute('data-theme','dark');
  await page.screenshot({path:info.outputPath('settings-code-dark.png')});
  for (const [tab,panel,explanation] of [['Editor','editor','read only'],['Files & watching','files','no folder browser'],['About','about','read-only conversation viewer']]) {
    await settingsSection(frame,tab);
    await expect(frame.locator(`[data-panel=${panel}]`)).toContainText(explanation);
    await expect(frame.locator(`[data-panel=${panel}]`).locator('input,select,button')).toHaveCount(0);
    await page.screenshot({path:info.outputPath(`settings-${panel}.png`)});
  }
  await settingsSection(frame,'Shortcuts');
  await expect(frame.locator('[data-panel=keys]')).not.toContainText('Save');
  await frame.getByRole('button',{name:/Close settings|Back to document/}).click();
  await page.evaluate(()=>window.host.add());
  const second=page.frameLocator('iframe').nth(1);
  await expect(second.locator('#preview h1')).toHaveText('Adjustable title');
  await expect(second.locator('#preview h1')).toHaveCSS('font-size','72px');
  await expect(second.locator('#preview pre')).toHaveCSS('white-space','pre-wrap');
  await expect(second.locator('html')).toHaveAttribute('data-code','vivid');
  await page.setViewportSize({width:430,height:850});
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await settingsSection(frame,'Reading');
  await page.screenshot({path:info.outputPath('settings-reading-narrow.png')});
  await frame.getByRole('button',{name:/Close settings|Back to document/}).click();
  await expect(frame.locator('#preview h1')).toHaveCSS('font-size','43.2px');
  expect(errors).toEqual([]);
});


test('local links require host resolution and file opening without exposing a base path', async ({page},info) => {
  const {frame,requests,errors}=await host(page,{localFiles:true,documentText:'# Local links\n\n[Related](./linked.md)\n\n[Section](./linked.md#heading)\n'});
  await expect(frame.locator('#preview h1')).toHaveText('Local links');
  await frame.getByRole('link',{name:'Related',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.host.calls.filter(c=>c.method==='openai/files/open').length)).toBe(1);
  let calls=await page.evaluate(()=>window.host.calls);
  const { _meta, ...argumentsSent }=calls.find(c=>c.method==='tools/call' && c.params.name==='reader_resolve_local_link').params;
  expect(argumentsSent).toEqual({name:'reader_resolve_local_link',arguments:{href:'./linked.md'}});
  expect(_meta).not.toHaveProperty('openai/resource'); // Only the host may add opened-file context.
  expect(calls.find(c=>c.method==='openai/files/open').params).toEqual({path:'/trusted/document/linked.md'});
  await frame.getByRole('link',{name:'Section',exact:true}).click();
  await expect(frame.locator('#embedded-status')).toContainText('cannot open a section in another document');
  expect(await page.evaluate(()=>window.host.calls.filter(c=>c.method==='tools/call' && c.params.name==='reader_resolve_local_link').length)).toBe(1);
  await page.evaluate(()=>window.host.linkFail=true);
  const link=frame.getByRole('link',{name:'Related',exact:true});
  await link.focus(); await link.press('Enter');
  await expect(frame.locator('#embedded-status')).toContainText('must supply opened-file context');
  expect(await page.evaluate(()=>window.host.calls.filter(c=>c.method==='openai/files/open').length)).toBe(1);
  await page.evaluate(()=>{window.host.linkFail=false;window.host.openFail=true;});
  await link.click();
  await expect.poll(()=>page.evaluate(()=>window.host.calls.filter(c=>c.method==='openai/files/open').length)).toBe(2);
  await expect(frame.locator('#embedded-status')).toContainText('The host could not open this related Markdown file');
  await expect(frame.locator('#preview h1')).toHaveText('Local links');
  await page.screenshot({path:info.outputPath('local-link-host-refusal.png')});
  expect(requests.filter(u=>u!=='http://reader.test/')).toEqual([]); expect(errors).toEqual([]);
});

test('a delayed local link cannot open after switching away and back, a newer link, or teardown', async ({page}) => {
  const {frame,errors}=await host(page,{localFiles:true,links:true,documentText:'# Stale links\n\n[Related](./linked.md)\n\n[External](https://example.com)\n'});
  await expect(frame.locator('#preview h1')).toHaveText('Stale links');
  await page.evaluate(()=>window.host.deferLinks=true);
  await frame.getByRole('link',{name:'Related',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.host.pendingLinks?.length)).toBe(1);
  for (const [name,resourceUri] of [['other.md','host:other'],['demo.md','host:demo']]) {
    await page.evaluate(file=>window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:{file}}},'*'),{name,resourceUri});
    await expect(frame.locator('#docname')).toHaveText(name);
    await expect(frame.locator('#preview h1')).toHaveText('Stale links');
  }
  await page.evaluate(()=>{const r=window.host.pendingLinks.shift();r.source.postMessage({jsonrpc:'2.0',id:r.id,result:r.result},'*');});
  await frame.getByRole('link',{name:'Related',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.host.pendingLinks.length)).toBe(1);
  expect(await page.evaluate(()=>window.host.calls.filter(c=>c.method==='openai/files/open').length)).toBe(0);
  await frame.getByRole('link',{name:'Related',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.host.pendingLinks.length)).toBe(2);
  await page.evaluate(()=>{const r=window.host.pendingLinks.pop();r.source.postMessage({jsonrpc:'2.0',id:r.id,result:r.result},'*');});
  await expect.poll(()=>page.evaluate(()=>window.host.calls.filter(c=>c.method==='openai/files/open').length)).toBe(1);
  await page.evaluate(()=>{const r=window.host.pendingLinks.shift();r.source.postMessage({jsonrpc:'2.0',id:r.id,result:r.result},'*');});
  await frame.getByRole('button',{name:'Find',exact:true}).click(); // Process the older reply before reading the call log.
  expect(await page.evaluate(()=>window.host.calls.filter(c=>c.method==='openai/files/open').length)).toBe(1);
  await frame.locator('#find-close').click();
  await frame.getByRole('link',{name:'Related',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.host.pendingLinks.length)).toBe(1);
  await frame.getByRole('link',{name:'External',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.host.calls.some(c=>c.method==='ui/open-link'))).toBeTruthy();
  await page.evaluate(()=>{const r=window.host.pendingLinks.shift();r.source.postMessage({jsonrpc:'2.0',id:r.id,result:r.result},'*');});
  await frame.getByRole('button',{name:'Find',exact:true}).click();
  expect(await page.evaluate(()=>window.host.calls.filter(c=>c.method==='openai/files/open').length)).toBe(1);
  await frame.locator('#find-close').click();
  await frame.getByRole('link',{name:'Related',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.host.pendingLinks.length)).toBe(1);
  await page.evaluate(()=>window.host.frames[0].contentWindow.postMessage({jsonrpc:'2.0',id:'teardown',method:'ui/resource-teardown',params:{}},'*'));
  await expect.poll(()=>page.evaluate(()=>window.host.calls.some(c=>c.id==='teardown' && c.result))).toBeTruthy();
  await page.evaluate(()=>{const r=window.host.pendingLinks.shift();r.source.postMessage({jsonrpc:'2.0',id:r.id,result:r.result},'*');});
  await frame.getByRole('button',{name:'Find',exact:true}).click();
  expect(await page.evaluate(()=>window.host.calls.filter(c=>c.method==='openai/files/open').length)).toBe(1);
  expect(errors).toEqual([]);
});


for (const [label,width,height,compact] of [['narrow tall',360,720,true],['wide short',1100,320,true],['narrow short',360,280,true],['roomy',1100,800,false]]) {
  test(`settings fit the actual ${label} iframe pane`, async ({page},info) => {
    await page.setViewportSize({width:1600,height:1050});
    const {frame,errors}=await host(page,{paneSize:{width,height},documentText:'# Pane settings\n\n'+('Reading paragraph.\n\n'.repeat(100))});
    await expect(frame.locator('#preview h1')).toHaveText('Pane settings');
    const pane=frame.locator('#previewpane');
    await pane.evaluate(n=>n.scrollTop=900);
    const position=await pane.evaluate(n=>n.scrollTop);
    const gear=frame.getByRole('button',{name:'Settings',exact:true});
    await gear.click();
    const dialog=frame.getByRole('dialog',{name:'Settings'});
    await page.locator('iframe').first().screenshot({path:info.outputPath('settings-appearance-'+label.replace(' ','-')+'.png')});
    const bounds=await dialog.evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
    if(compact) expect(bounds).toEqual({x:0,y:0,width,height});
    else {expect(bounds.x).toBeGreaterThan(0);expect(bounds.y).toBeGreaterThan(0);expect(bounds.width).toBeLessThan(width);}
    const back=frame.getByRole('button',{name:compact?'Back to document':'Close settings',exact:true});
    await expect(back).toBeVisible();
    if(compact) await expect(back).toBeFocused();
    for(const [category,tab] of [['appearance','Appearance'],['reading','Reading'],['code','Code'],['editor','Editor'],['files','Files & watching'],['keys','Shortcuts'],['about','About']]) {
      if(compact) await frame.getByRole('combobox',{name:'Settings section'}).selectOption(category);
      else await settingsSection(frame,tab);
      await expect(frame.locator(`[data-panel=${category}]`)).toBeVisible();
      const overflow=await frame.locator('.set-scroll').evaluate(n=>n.scrollWidth-n.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      expect(await frame.locator('.set-scroll').evaluate(n=>n.clientHeight)).toBeGreaterThan(height*.5);
    }
    if(compact) await frame.getByRole('combobox',{name:'Settings section'}).selectOption('reading');
    else await settingsSection(frame,'Reading');
    await frame.locator('[data-panel=reading] details').nth(1).locator('summary').click();
    await frame.getByRole('slider',{name:'Heading bottom margin override'}).focus();
    await frame.getByRole('slider',{name:'Heading bottom margin override'}).press('ArrowRight');
    await frame.getByRole('switch',{name:'Column borders'}).click();
    await page.locator('iframe').first().screenshot({path:info.outputPath('settings-'+label.replace(' ','-')+'.png')});
    await back.click(); await expect(gear).toBeFocused();
    await expect.poll(()=>pane.evaluate(n=>n.scrollTop)).toBeCloseTo(position,0);
    await gear.click(); await expect(frame.getByRole('switch',{name:'Column borders'})).toHaveAttribute('aria-checked','true');
    await dialog.press('Escape'); await expect(gear).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test('settings resize without losing choices, focused controls, or the reading passage', async ({page},info) => {
  await page.setViewportSize({width:1600,height:1050});
  const documentText='# Resize settings\n\n'+Array.from({length:100},(_,i)=>`Paragraph ${i}. A distinctive passage with enough words to wrap in a small pane.\n\n`).join('');
  const {frame,errors}=await host(page,{paneSize:{width:360,height:400},documentText});
  await expect(frame.locator('#preview h1')).toHaveText('Resize settings');
  await frame.locator('#preview p').nth(40).evaluate(n=>n.scrollIntoView({block:'start'}));
  const passage=()=>frame.locator('#previewpane').evaluate(pane=>{
    const top=pane.getBoundingClientRect().top;
    const first=[...pane.querySelectorAll('#preview p')].find(p=>p.getBoundingClientRect().bottom>top+1);
    return Number(first.textContent.match(/Paragraph (\d+)/)[1]);
  });
  const started=await passage();
  const gear=frame.getByRole('button',{name:'Settings',exact:true});
  const back=frame.getByRole('button',{name:'Back to document',exact:true});
  const picker=frame.getByRole('combobox',{name:'Settings section'});
  await gear.click(); await expect(back).toBeFocused();
  await back.press('Tab'); await page.keyboard.press('Tab'); await expect(picker).toBeFocused();
  // Native type-ahead works in headless Chrome; its arrow-driven menu is not opened there.
  await picker.press('r'); await expect(frame.locator('[data-panel=reading]')).toBeVisible();
  await picker.press('Tab'); await picker.focus(); await page.keyboard.type('Appearance');
  await expect(frame.locator('[data-panel=appearance]')).toBeVisible();
  await frame.getByRole('button',{name:'Large',exact:true}).click();
  await picker.selectOption('reading');
  await frame.locator('[data-panel=reading] details').first().locator('summary').click();
  const font=frame.getByRole('slider',{name:'Body text size',exact:true});
  await font.focus(); await font.press('ArrowRight'); await expect(font).toHaveValue('17');
  await page.evaluate(()=>{const f=window.host.frames[0];f.style.width='1100px';f.style.height='800px';});
  await expect(frame.locator('#scrim')).toHaveAttribute('data-settings-layout','modal');
  await expect(font).toBeFocused(); await expect(font).toHaveValue('17');
  await expect(frame.getByRole('button',{name:'Close settings'})).toBeVisible();
  await page.locator('iframe').first().screenshot({path:info.outputPath('settings-resized-modal.png')});
  await frame.getByRole('tab',{name:'Code',exact:true}).focus();
  await page.evaluate(()=>{const f=window.host.frames[0];f.style.width='360px';f.style.height='280px';});
  await expect(frame.locator('#scrim')).toHaveAttribute('data-settings-layout','compact');
  await expect(picker).toBeFocused(); await expect(picker).toHaveValue('reading');
  await picker.selectOption('code');
  const wrap=frame.getByRole('switch',{name:'Wrap long lines'});
  await wrap.click(); await wrap.press('Tab'); await expect(back).toBeFocused();
  await back.press('Shift+Tab'); await expect(wrap).toBeFocused();
  await page.locator('iframe').first().screenshot({path:info.outputPath('settings-resized-compact-large.png')});
  await back.click(); await expect(gear).toBeFocused();
  await expect.poll(passage).toBeCloseTo(started,0);
  for(let i=0;i<3;i++) {
    await gear.click(); await expect(back).toBeFocused();
    await expect(wrap).toHaveAttribute('aria-checked','true');
    await back.press('Escape'); await expect(gear).toBeFocused();
    await expect.poll(passage).toBeCloseTo(started,0);
  }
  await gear.click(); await picker.selectOption('reading');
  await expect(font).toHaveValue('17');
  await expect(frame.locator('html')).toHaveAttribute('data-uiscale','large');
  expect(errors).toEqual([]);
});


test('backend catalog offers only fonts rendered in the iframe and recovers saved missing choices', async ({page}, info) => {
  const catalog={version:1,platform:'darwin',provenance:'backend-machine',rendering:'viewer-verification-required',available:true,families:['Georgia','Reader Missing Font 987654']};
  const {frame,errors}=await host(page,{fontCatalog:catalog,savedPrefs:{bodyFont:'font:Georgia',headFont:'font:Georgia'}});
  await expect(frame.locator('#preview h1')).toHaveText('Reader');
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await settingsSection(frame,'Reading');
  await expect(frame.locator('#sel-body option[value="font:Georgia"]')).toHaveCount(1);
  await expect(frame.locator('#sel-body option[value="font:Reader Missing Font 987654"]')).toHaveCount(0);
  await expect(frame.locator('#sel-body')).toHaveValue('font:Georgia');
  await expect(frame.locator('.font-source').first()).toContainText('usable in this viewer');
  await page.screenshot({path:info.outputPath('embedded-backend-fonts.png')});
  await frame.getByRole('button',{name:/Close settings|Back to document/}).click();
  await page.evaluate(()=>window.host.fontCatalog.families=['Reader Missing Font 987654']);
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await settingsSection(frame,'Reading');
  await expect(frame.locator('#sel-body option:checked')).toHaveText(/Georgia.*unavailable/);
  await expect(frame.locator('.font-source').first()).toContainText('cannot be verified');
  expect(await frame.locator('html').evaluate(n=>n.style.getPropertyValue('--font-head'))).toBe('Lora,serif');
  await page.screenshot({path:info.outputPath('embedded-unavailable-fonts.png')});
  await frame.getByRole('button',{name:/Close settings|Back to document/}).click();
  await page.evaluate(()=>window.host.fontCatalog.families=['Georgia']);
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(frame.locator('#sel-body option:checked')).toHaveText('Georgia');
  await frame.getByRole('button',{name:/Close settings|Back to document/}).click();
  await frame.locator('html').evaluate(()=> { CanvasRenderingContext2D.prototype.measureText = () => { throw new Error('Host privacy restriction'); }; });
  await frame.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(frame.locator('#sel-body option:checked')).toHaveText(/Georgia.*unavailable/);
  await expect(frame.locator('.font-source').first()).toContainText('cannot be verified');
  expect(errors).toEqual([]);
});
