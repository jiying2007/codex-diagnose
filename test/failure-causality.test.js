'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const{signatureForTrace,rankFailedJobEvidence,formatRankedFailureBlocks}=require('../src/failure-causality');

test('causal ranking keeps earliest unique roots before duplicate cascade failures',()=>{const entries=[
  {job:{id:30,name:'package',stage:'package',started_at:'2026-01-01T00:03:00Z'},trace:'src/a.c:42: error: unknown type name Widget\nERROR 999'},
  {job:{id:10,name:'compile',stage:'build',started_at:'2026-01-01T00:01:00Z'},trace:'src/a.c:17: error: unknown type name Widget\nERROR 123'},
  {job:{id:20,name:'test',stage:'test',started_at:'2026-01-01T00:02:00Z'},trace:'AssertionError: expected ready got failed'}
],ranked=rankFailedJobEvidence(entries);assert.deepEqual(ranked.map(x=>x.job.id),[10,20,30]);assert.equal(ranked[0].cascade,false);assert.equal(ranked[2].cascade,true);assert.equal(ranked[2].duplicateOf,10);assert.equal(ranked[0].signature,ranked[2].signature);assert.notEqual(ranked[0].signature,ranked[1].signature);const text=formatRankedFailureBlocks(ranked);assert.match(text,/causal_rank=1/);assert.match(text,/duplicate_of=10/);});
test('error signatures normalize volatile addresses and large numeric ids',()=>{assert.equal(signatureForTrace('fatal: pointer 0x1234 failed request 987654'),signatureForTrace('fatal: pointer 0xdeadbeef failed request 123456'));});
