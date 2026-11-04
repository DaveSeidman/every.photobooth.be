import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAnalyticsStore } from '../utils/analytics.js';

function fixture(t) { const directory=fs.mkdtempSync(path.join(os.tmpdir(),'booth-analytics-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory; }
const event=(id,environment='live')=>({id,name:'share_complete',site:'takeaway',environment});
test('analytics retries count once and persist across restarts, with local traffic separate',t=>{
  const directory=fixture(t);const store=createAnalyticsStore(directory);
  assert.equal(store.record([event('event-0001'),event('event-0002','test')]),true);
  store.record([event('event-0001')]);
  const restored=createAnalyticsStore(directory);restored.record([event('event-0001')]);
  assert.equal(restored.snapshot().counts.live.share_complete,1);
  assert.equal(restored.snapshot().counts.test.share_complete,1);
  assert.equal(restored.snapshot().recent.length,2);
});
test('analytics rejects malformed batches atomically and discards unapproved metadata',t=>{
  const store=createAnalyticsStore(fixture(t));
  for(const invalid of [null,{},[event('event-0001'),{...event('event-0002'),name:'pull'}],[{...event('event-0001'),id:undefined}],Array(31).fill(event('event-0001'))]) assert.equal(store.record(invalid),false);
  assert.deepEqual(store.snapshot().counts.live,{});
  store.record([{...event('event-0003'),photo:'secret-image',url:'photo-id',durationMs:-50,style:'emperor-cyan',mode:'local'}]);
  const clean=store.snapshot().recent[0];assert.equal(clean.photo,undefined);assert.equal(clean.url,undefined);assert.equal(clean.durationMs,0);assert.equal(clean.style,'emperor-cyan');assert.equal(clean.mode,'local');
});
