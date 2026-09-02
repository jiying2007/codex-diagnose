'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {parseArgs}=require('../src/args');
const {runtimeFromOptions,inspectRuntimeFromOptions}=require('../src/codex');

test('explicit compatible relay remains available as an advanced override',()=>{const v=parseArgs(['--log','build.log','--provider-mode','openai-compatible','--provider-base-url','http://192.168.2.109:3000/v1','--provider-credential-source','auth-json','--provider-allow-insecure-http']);assert.equal(v.providerCredentialSource,'auth-json');assert.equal(v.providerAllowInsecureHttp,true);const runtime=runtimeFromOptions(v);assert.equal(runtime.provider.credentialSource,'auth-json');assert.equal(runtime.provider.allowInsecureHttp,true);assert.equal(runtime.provider.baseUrl,'http://192.168.2.109:3000/v1');});

test('default auto mode inherits machine Codex provider without duplicate Diagnose flags',()=>{const home=fs.mkdtempSync(path.join(os.tmpdir(),'codex-diagnose-runtime-'));const oldHome=process.env.CODEX_HOME;try{process.env.CODEX_HOME=home;fs.writeFileSync(path.join(home,'config.toml'),'model_provider = "relay"\n\n[model_providers.relay]\nbase_url = "http://192.168.10.20:8317/v1"\nenv_key = "RELAY_KEY"\nwire_api = "responses"\n');const v=parseArgs(['--log','build.log']);const inspected=inspectRuntimeFromOptions(v);assert.equal(inspected.source,'codex-config');assert.equal(inspected.providerId,'relay');assert.equal(inspected.runtime.provider.mode,'openai-compatible');assert.equal(inspected.runtime.provider.baseUrl,'http://192.168.10.20:8317/v1');assert.equal(inspected.runtime.provider.allowInsecureHttp,true);}finally{if(oldHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=oldHome;fs.rmSync(home,{recursive:true,force:true});}});

test('auto mode does not accept per-command credential or insecure-http controls',()=>{assert.throws(()=>parseArgs(['--log','build.log','--provider-credential-source','auth-json']),/explicit openai-compatible/);assert.throws(()=>parseArgs(['--log','build.log','--provider-allow-insecure-http']),/explicit openai-compatible/);});
