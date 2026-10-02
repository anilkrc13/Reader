import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DocumentSession} from '../../../../build/chatgpt/session.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const reads = [], calls = [], shown = [], errors = [];
  let handler;
  const resources = {
    addUpdateHandler(fn) { handler = fn; return () => {handler = undefined;}; },
    read(params) { return new Promise((resolve, reject) => reads.push({params, resolve, reject})); },
    async subscribe({uri}) {calls.push(['subscribe', uri]);},
    async unsubscribe({uri}) {calls.push(['unsubscribe', uri]);},
  };
  const session = new DocumentSession(resources, (text, file) => shown.push([text, file.name]), message => errors.push(message));
  const answer = (index, text) => reads[index].resolve({contents: [{uri: reads[index].params.uri, text}]});
  return {session, reads, calls, shown, errors, answer, update: uri => handler?.({params: {uri}})};
}
test('a switch rejects old reads and unsubscribes the old resource', async () => {
  const f = fixture();
  f.session.open({name:'one.md', resourceUri:'host:one'});
  await tick();
  f.answer(1,'first'); await tick();
  f.session.open({name:'two.md',resourceUri:'host:two'});
  await tick(); f.answer(0,'late one'); f.answer(2,'older two'); f.answer(3,'current two'); await tick();
  assert.deepEqual(f.shown,[['first','one.md'],['current two','two.md']]);
  assert.deepEqual(f.calls,[['subscribe','host:one'],['unsubscribe','host:one'],['subscribe','host:two']]);
  await f.session.dispose();
  assert.deepEqual(f.calls.at(-1),['unsubscribe','host:two']);
  assert.equal(f.update('host:two'),undefined);
});
test('updates reject older refreshes and a read failure retains the preview', async () => {
  const f = fixture(); f.session.open({name:'one.md',resourceUri:'host:one'}); await tick();
  f.answer(1,'initial'); await tick();
  f.update('host:one'); f.update('host:one');
  f.answer(3,'newest'); f.answer(2,'older'); await tick();
  assert.equal(f.shown.at(-1)[0],'newest');
  f.update('host:one'); f.reads[4].reject(new Error('host disconnected')); await tick();
  assert.equal(f.shown.at(-1)[0],'newest'); assert.equal(f.errors.length,1);
  await f.session.dispose(); f.answer(0,'after disposal'); await tick();
  assert.equal(f.shown.length,2);
});
test('panel contents and subscriptions are independent', async () => {
  const a=fixture(), b=fixture();
  a.session.open({name:'a.md',resourceUri:'host:a'}); b.session.open({name:'b.md',resourceUri:'host:b'}); await tick();
  a.answer(1,'A'); b.answer(1,'B'); await tick();
  assert.deepEqual(a.shown,[['A','a.md']]); assert.deepEqual(b.shown,[['B','b.md']]);
  await a.session.dispose(); assert.equal(b.calls.length,1); await b.session.dispose();
});
test('a pending subscription is cleaned up when disposed', async () => {
  let subscribeDone, removed=false; const calls=[];
  const session=new DocumentSession({
    addUpdateHandler(){return ()=>{removed=true;};}, read:async()=>({contents:[{uri:'host:a',text:'A'}]}),
    subscribe:()=>new Promise(resolve=>{subscribeDone=resolve;}), unsubscribe:async({uri})=>{calls.push(uri);},
  },()=>{},()=>{});
  session.open({name:'a.md',resourceUri:'host:a'}); await tick();
  const done=session.dispose(); subscribeDone({}); await done;
  assert.equal(removed,true); assert.deepEqual(calls,['host:a']);
});
test('a blocked read never blocks switching subscriptions or disposal', async () => {
  const f=fixture();
  f.session.open({name:'a.md',resourceUri:'host:a'}); await tick();
  f.session.open({name:'b.md',resourceUri:'host:b'}); await tick();
  assert.deepEqual(f.calls,[['subscribe','host:a'],['unsubscribe','host:a'],['subscribe','host:b']]);
  await f.session.dispose(); assert.deepEqual(f.calls.at(-1),['unsubscribe','host:b']);
});
test('clearing invalid input rejects its late read and can reopen the same URI safely', async () => {
  const f=fixture(); f.session.open({name:'a.md',resourceUri:'host:a'}); await tick();
  f.session.clear(); f.session.open({name:'a.md',resourceUri:'host:a'}); await tick();
  f.answer(0,'old'); f.answer(1,'old subscribed'); f.answer(3,'new'); await tick();
  assert.deepEqual(f.shown,[['new','a.md']]);
  assert.deepEqual(f.calls,[['subscribe','host:a'],['unsubscribe','host:a'],['subscribe','host:a']]);
  await f.session.dispose();
});
