'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {platformCommand}=require('../scripts/verify-package-closure');

test('package closure selects the platform npm executable',()=>{
  assert.equal(platformCommand('npm','win32'),'npm.cmd');
  assert.equal(platformCommand('npm','linux'),'npm');
  assert.equal(platformCommand('tar','win32'),'tar');
});
