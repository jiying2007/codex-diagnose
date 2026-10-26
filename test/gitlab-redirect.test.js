'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {GitLabDiagnoseClient}=require('../src/gitlab');

async function server(handler,t){
  const value=http.createServer(handler);
  await new Promise(resolve=>value.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{value.closeAllConnections();value.close(resolve);}));
  return `http://127.0.0.1:${value.address().port}`;
}
test('artifact redirects reach the CDN without credentials, including a redirect back',async t=>{
  const seen=[];let origin;
  const cdn=await server((req,res)=>{seen.push(['cdn',req.headers['private-token']]);res.writeHead(302,{location:origin+'/return'});res.end();},t);
  origin=await server((req,res)=>{seen.push(['origin',req.headers['private-token']]);if(req.url==='/return')res.end('artifact');else{res.writeHead(302,{location:cdn+'/signed?key=synthetic'});res.end();}},t);
  const client=new GitLabDiagnoseClient({baseUrl:origin,token:'synthetic-token'});
  assert.equal(await client.getArtifactText('project',1,'report.txt'),'artifact');
  assert.deepEqual(seen,[['origin','synthetic-token'],['cdn',undefined],['origin',undefined]]);
});
test('same-origin read redirects retain GitLab authentication',async t=>{
  const seen=[];const origin=await server((req,res)=>{seen.push(req.headers['private-token']);if(req.url.endsWith('/trace')){res.writeHead(307,{location:'/trace-final'});res.end();}else res.end('trace');},t);
  assert.equal(await new GitLabDiagnoseClient({baseUrl:origin,token:'synthetic-token'}).getTrace('p',1),'trace');
  assert.deepEqual(seen,['synthetic-token','synthetic-token']);
});
test('API cross-origin redirects and all write redirects fail before contacting the target',async t=>{
  let reached=0;const target=await server((_req,res)=>{reached++;res.end('{}');},t);
  const origin=await server((req,res)=>{
    if(req.url==='/forbidden-write-target'){reached++;res.end('{}');return;}
    res.writeHead(303,{location:req.method==='POST'?'/forbidden-write-target':target+'/target'});res.end();
  },t);
  const client=new GitLabDiagnoseClient({baseUrl:origin,token:'synthetic-token'});
  await assert.rejects(client.getJob('p',1),{code:'EGITLABREDIRECT'});
  await assert.rejects(client.request('POST','/notes',{body:{body:'note'}}),{code:'EGITLABREDIRECT'});
  await assert.rejects(client.request('PUT','/notes',{body:{body:'note'}}),{code:'EGITLABREDIRECT'});
  assert.equal(reached,0);
});
test('redirect loops are bounded across the entire artifact download',async t=>{
  let requests=0;const origin=await server((_req,res)=>{requests++;res.writeHead(302,{location:'/loop'});res.end();},t);
  await assert.rejects(new GitLabDiagnoseClient({baseUrl:origin,token:'synthetic-token'}).getArtifactText('p',1,'a'),{code:'EGITLABREDIRECT'});
  assert.equal(requests,6);
});
test('HTTPS downgrade, URL credentials and non-HTTP protocols are rejected',async()=>{
  for(const location of ['http://cdn.invalid/file','https://user:pass@cdn.invalid/file','file:///tmp/file','https://cdn.invalid/file#fragment']){
    let requests=0;const original=global.fetch;
    global.fetch=async(_url,options)=>{requests++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{location}});};
    try{await assert.rejects(new GitLabDiagnoseClient({baseUrl:'https://gitlab.invalid',token:'synthetic-token'}).getArtifactText('p',1,'a'),{code:'EGITLABREDIRECT'});assert.equal(requests,1);}
    finally{global.fetch=original;}
  }
});
