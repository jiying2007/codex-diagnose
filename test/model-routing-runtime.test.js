'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
test('diagnose consumes balanced reviewer Model Routing v1 without cross-provider fallback',()=>{const source=fs.readFileSync('src/codex.js','utf8');assert.match(source,/resolveModelRegistry/);assert.match(source,/resolveModelSelection/);assert.match(source,/buildModelEvidence/);assert.match(source,/role:'reviewer',mode:'balanced'/);assert.doesNotMatch(source,/crossProvider:true/);});
