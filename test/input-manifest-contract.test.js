'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../src/codex-safe-core');
const contract=require('../product-contract.json');

test('Diagnose current product binds Receipt v2 to the full model-visible input manifest',()=>{
  assert.equal(contract.productVersion,contract.diagnoseVersion);
  assert.equal(contract.safeCoreVersion,'4.13.1');
  assert.equal(contract.codexRuntimeVersion,3);
  assert.equal(contract.providerContractVersion,3);
  assert.equal(contract.diagnosisInputManifestVersion,1);
  assert.equal(contract.diagnosisReceiptVersion,2);
  assert.equal(core.DIAGNOSIS_INPUT_MANIFEST_VERSION,contract.diagnosisInputManifestVersion);
  assert.equal(core.DIAGNOSIS_RECEIPT_VERSION,contract.diagnosisReceiptVersion);
  const evidence=core.buildDiagnosisEvidence({log:'src/a.c:9: error: bad type',job:{projectId:7,pipelineId:9,jobId:1,commitSha:'a'.repeat(40),jobName:'build'}});
  const prior=core.classifyFailureDeterministically(evidence.log.text);
  const one=core.buildDiagnosisInputManifest({evidence,deterministic:prior,changedPaths:['src/a.c'],artifactTexts:[],model:'model-a'});
  const two=core.buildDiagnosisInputManifest({evidence,deterministic:prior,changedPaths:['src/a.c','src/b.c'],artifactTexts:[],model:'model-a'});
  assert.match(one.digest,/^[0-9a-f]{64}$/);
  assert.notEqual(one.digest,two.digest,'changed model-visible paths must change diagnosis identity');
});
