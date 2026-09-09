'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {npmInvocation}=require('../scripts/verify-package-closure');

test('package closure executes npm portably through its CLI entry',()=>{
  assert.deepEqual(npmInvocation({platform:'win32',env:{npm_execpath:'C:\\npm\\npm-cli.js'},nodeExecPath:'C:\\node.exe'}),{command:'C:\\node.exe',args:['C:\\npm\\npm-cli.js']});
  assert.deepEqual(npmInvocation({platform:'win32',env:{ComSpec:'C:\\Windows\\cmd.exe'}}),{command:'C:\\Windows\\cmd.exe',args:['/d','/s','/c','npm.cmd']});
  assert.deepEqual(npmInvocation({platform:'linux',env:{}}),{command:'npm',args:[]});
});
