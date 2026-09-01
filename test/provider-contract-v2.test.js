'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseArgs}=require('../src/args');
const {runtimeFromOptions}=require('../src/codex');
test('relay CLI exposes Core Provider Contract v2 controls',()=>{const v=parseArgs(['--log','build.log','--provider-mode','openai-compatible','--provider-base-url','http://192.168.2.109:3000/v1','--provider-credential-source','auth-json','--provider-allow-insecure-http']);assert.equal(v.providerCredentialSource,'auth-json');assert.equal(v.providerAllowInsecureHttp,true);const runtime=runtimeFromOptions(v);assert.equal(runtime.provider.credentialSource,'auth-json');assert.equal(runtime.provider.allowInsecureHttp,true);assert.equal(runtime.provider.baseUrl,'http://192.168.2.109:3000/v1');});
test('provider-v2 controls cannot be attached to built-in OpenAI mode',()=>{assert.throws(()=>parseArgs(['--log','build.log','--provider-credential-source','auth-json']),/require openai-compatible/);assert.throws(()=>parseArgs(['--log','build.log','--provider-allow-insecure-http']),/require openai-compatible/);});
