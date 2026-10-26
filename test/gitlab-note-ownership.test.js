'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {GitLabDiagnoseClient}=require('../src/gitlab');
const marker='<!-- codex-diagnose-safe:summary -->';
function fixture(notes,{actor=22,complete=true}={}){
 const calls=[];
 const client=new GitLabDiagnoseClient({baseUrl:'https://gitlab.example',token:'synthetic'});
 client.listMergeRequestNotes=async()=>({items:notes,complete});
 client.request=async(method,route,options)=>{
   calls.push({method,route,options});
   if(route==='/user')return{data:actor?{id:actor}:{}};
   return{data:{id:55,body:options?.body?.body}};
 };
 return{client,calls};
}
test('only current authenticated actor can reuse a diagnosis note marker',async()=>{
 const {client,calls}=fixture([{id:11,body:marker,author:{id:17}},{id:12,body:marker,author:{id:22}}]);
 await client.upsertDiagnosisNote(1,3,'analysis');
 assert.deepEqual(calls.map(v=>v.method),['GET','PUT']);
 assert.match(calls[1].route,/\/notes\/12$/);
});
test('foreign marker is never overwritten, even when it is the first note',async()=>{
 const {client,calls}=fixture([{id:11,body:marker,author:{id:17}}]);
 await client.upsertDiagnosisNote(1,3,'analysis');
 assert.deepEqual(calls.map(v=>v.method),['GET','POST']);
 assert.match(calls[1].route,/\/notes$/);
});
test('unknown actor and ambiguous owned notes fail closed before publication',async()=>{
 const missing=fixture([{id:11,body:marker,author:{id:22}}],{actor:null});
 await assert.rejects(()=>missing.client.upsertDiagnosisNote(1,3,'analysis'),/actor identity/);
 assert.deepEqual(missing.calls.map(v=>v.method),['GET']);
 const duplicate=fixture([{id:11,body:marker,author:{id:22}},{id:12,body:marker,author:{id:22}}]);
 await assert.rejects(()=>duplicate.client.upsertDiagnosisNote(1,3,'analysis'),/Multiple bot-owned/);
 assert.deepEqual(duplicate.calls.map(v=>v.method),['GET']);
});
