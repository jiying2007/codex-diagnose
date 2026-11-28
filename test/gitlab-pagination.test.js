'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {GitLabDiagnoseClient}=require('../src/gitlab');

async function fixture(t,handler,{maxPages=20}={}){
  const calls=[];
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    calls.push({method:req.method,path:url.pathname,page:url.searchParams.get('page')});
    const result=handler(url,req);
    req.resume();
    res.writeHead(result.status||200,{'content-type':'application/json',...result.headers});
    res.end(JSON.stringify(result.data));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return{client:new GitLabDiagnoseClient({baseUrl:'http://127.0.0.1:'+server.address().port,token:'fixture',maxPages}),calls};
}

test('native HTTP pagination follows contiguous offset pages and preserves caller filters',async t=>{
  const {client,calls}=await fixture(t,url=>{
    assert.equal(url.searchParams.get('per_page'),'100');
    assert.equal(url.searchParams.get('include_retried'),'false');
    const page=url.searchParams.get('page');
    return{data:[{id:Number(page)}],headers:{'x-page':page,'x-next-page':page==='1'?'2':''}};
  });
  assert.deepEqual(await client.listPipelineJobs(1,2),{items:[{id:1},{id:2}],complete:true});
  assert.deepEqual(calls.map(c=>c.page),['1','2']);
});

test('jumping, repeated or malformed pagination cursors cannot authorize note publication',async t=>{
  let cursor='3';
  const {client,calls}=await fixture(t,url=>{
    if(url.pathname.endsWith('/user'))return{data:{id:22}};
    return{data:[],headers:{'x-page':'1','x-next-page':cursor}};
  });
  for(cursor of ['3','1','0','2.0','02','2e0','not-a-page']){
    const start=calls.length;
    await assert.rejects(client.upsertDiagnosisNote(1,2,'fixture'),{code:'EGITLABPAGINATION'});
    assert.deepEqual(calls.slice(start).map(c=>c.method),['GET','GET']);
    assert.equal(calls.at(-1).page,'1');
  }
});

test('wrong response page and oversize item arrays are rejected',async t=>{
  let wrongPage=true;
  const {client}=await fixture(t,()=>wrongPage
    ?{data:[],headers:{'x-page':'2','x-next-page':''}}
    :{data:Array.from({length:101},(_,id)=>({id})),headers:{'x-page':'1','x-next-page':''}});
  await assert.rejects(client.listPipelineJobs(1,2),{code:'EGITLABPAGINATION'});
  wrongPage=false;
  await assert.rejects(client.listPipelineJobs(1,2),{code:'EGITLABPAGINATION'});
});

test('missing pagination header on a full page remains incomplete; explicit terminal or short page succeeds',async t=>{
  let mode='missing';
  const full=Array.from({length:100},(_,id)=>({id}));
  const {client}=await fixture(t,()=>mode==='short'?{data:[{id:1}]}:
    {data:full,headers:mode==='terminal'?{'x-page':'1','x-next-page':''}:{}});
  assert.deepEqual(await client.listPipelineJobs(1,2),{items:full,complete:false});
  mode='terminal';
  assert.deepEqual(await client.listPipelineJobs(1,2),{items:full,complete:true});
  mode='short';
  assert.deepEqual(await client.listPipelineJobs(1,2),{items:[{id:1}],complete:true});
});

test('page cap cannot silently authorize complete enumeration and invalid caps do not send requests',async t=>{
  const {client,calls}=await fixture(t,()=>({data:[{id:1}],headers:{'x-next-page':'2'}}),{maxPages:1});
  assert.deepEqual(await client.listPipelineJobs(1,2),{items:[{id:1}],complete:false});
  const count=calls.length;
  for(const limit of [NaN,Infinity,0,-1,1.5,'2',Number.MAX_SAFE_INTEGER+1]){
    client.maxPages=limit;
    await assert.rejects(client.listPipelineJobs(1,2),{code:'EGITLABPAGINATION'});
  }
  assert.equal(calls.length,count);
});
