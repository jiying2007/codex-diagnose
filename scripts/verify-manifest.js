'use strict';

// Keep the required CI dependency bound to real SARIF, including failed uploads.
{
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const helper = 'src/codex-safe-core/scripts/codeql-findings-gate.js';
  function job(text, name) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const start = lines.indexOf('  ' + name + ':');
    assert.ok(start >= 0, 'missing required workflow job: ' + name);
    let end = start + 1;
    while (end < lines.length && !/^  [A-Za-z0-9_-]+:/.test(lines[end])) end++;
    return lines.slice(start, end).join('\n');
  }
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/security.yml'), 'utf8');
  const analysisJob = job(workflow, 'codeql');
  assert.ok(!analysisJob.includes('continue-on-error:'), 'CodeQL failures must remain fatal');
  const steps = analysisJob.split('\n      - ').slice(1).map(block => block.split('\n').map(line => line.trim()));
  function action(name) {
    const matches = steps.filter(lines => lines.some(line => line.startsWith('uses: ' + name + '@')));
    assert.equal(matches.length, 1, 'expected exactly one ' + name + ' step');
    return matches[0];
  }
  assert.ok(action('actions/checkout').includes('submodules: recursive'), 'canonical Core must be checked out');
  assert.ok(action('actions/setup-node').includes("node-version: '24.19.0'"), 'SARIF gate must use supported Node 24.19.0');
  const analyze = action('github/codeql-action/analyze');
  assert.ok(analyze.includes('output: codeql-results'), 'analyze must produce the gated report directory');
  assert.ok(analyze.includes('upload: always'), 'GitHub code scanning upload must stay enabled');
  const findings = steps.filter(lines => lines.includes('run: node ' + helper + ' codeql-results'));
  assert.equal(findings.length, 1, 'the production Core SARIF gate must run exactly once');
  assert.ok(findings[0].includes('if: ${{ always() }}'), 'findings gate must run even when analyze/upload fails');
  assert.ok(steps.indexOf(findings[0]) > steps.indexOf(analyze), 'findings gate must inspect the actual analyze output');
  const evidence = action('actions/upload-artifact');
  assert.ok(evidence.includes('if: ${{ always() }}'), 'SARIF evidence must survive failures');
  assert.ok(evidence.includes('uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2'), 'SARIF artifact action must retain its audited exact pin');
  assert.ok(evidence.includes('name: codeql-sarif-${{ github.run_id }}-${{ github.run_attempt }}'), 'SARIF evidence must bind the run and attempt');
  assert.ok(evidence.includes('path: codeql-results/*.sarif'), 'preserve precisely the analyzed SARIF files');
  assert.ok(evidence.includes('if-no-files-found: error'), 'missing SARIF evidence must fail closed');
  assert.ok(steps.indexOf(evidence) > steps.indexOf(analyze), 'SARIF evidence must come from the current analysis');
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const caller = job(ci, 'security');
  assert.ok(caller.includes('uses: ./.github/workflows/security.yml'), 'CI must invoke the checked CodeQL workflow');
  assert.ok(!caller.includes('continue-on-error:'), 'CI must retain CodeQL failure propagation');
  for (const permission of ['actions: read', 'contents: read', 'security-events: write']) {
    assert.ok(analysisJob.includes(permission) && caller.includes(permission), 'CodeQL caller/callee permission missing: ' + permission);
  }
  const required = job(ci, 'ci-gate').split('\n').map(line => line.trim());
  const needs = required.find(line => line.startsWith('needs: [') && line.endsWith(']'));
  assert.ok(needs && needs.slice(8, -1).split(',').map(value => value.trim()).includes('security'),
    'required CI Gate must depend on the checked CodeQL workflow');
  assert.ok(required.includes('if: ${{ always() }}'), 'required CI Gate must still evaluate failed dependencies');
}


const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json'),lock=require('../package-lock.json'),contract=require('../product-contract.json'),core=require('../src/codex-safe-core');
require('../src/codex-safe-core/scripts/verify-consumer-product-contract').verify(root,contract.safeCoreCommit,'codex-diagnose');
assert.equal(contract.productVersion,contract.diagnoseVersion);
assert.equal(pkg.version,contract.productVersion);
assert.equal(lock.version,contract.productVersion);
assert.equal(lock.packages[''].version,contract.productVersion);
assert.equal(contract.codexRuntimeVersion,3);
assert.equal(contract.providerContractVersion,3);
assert.equal(contract.modelRoutingContractVersion,1);
assert.equal(pkg.engines.node,`>=${contract.minimumNodeVersion} <23 || >=${contract.canonicalNodeVersion} <25`);
assert.deepEqual(contract.supportedNodeMajors,[22,24]);
assert.equal(core.SAFE_CORE_VERSION,contract.safeCoreMajorVersion);
assert.equal(core.SAFE_CONTRACT_VERSION,contract.safeContractVersion);
assert.equal(core.MODEL_ROUTING_CONTRACT_VERSION,contract.modelRoutingContractVersion);
assert.equal(core.CORE_CONTRACT.diagnosePromptContractVersion,contract.diagnosePromptContractVersion);
assert.equal(core.CORE_CONTRACT.diagnosisContractVersion,contract.diagnosisContractVersion);
assert.equal(core.CORE_CONTRACT.diagnosisReceiptVersion,contract.diagnosisReceiptVersion);
assert.equal(typeof core.resolveCodexRuntime,'function');
assert.equal(typeof core.resolveModelRegistry,'function');
assert.equal(typeof core.resolveModelSelection,'function');
assert.equal(typeof core.buildModelEvidence,'function');
const staged=execFileSync('git',['ls-files','--stage','src/codex-safe-core'],{cwd:root,encoding:'utf8'}).trim();assert.match(staged,new RegExp(`^160000 ${contract.safeCoreCommit} 0\\tsrc/codex-safe-core$`));
const expected=['README.md','README.zh-CN.md','LICENSE','SECURITY.md','ARCHITECTURE.md','VERIFY_RELEASE.md','product-contract.json','src/*.js','src/codex-safe-core/*.js','src/codex-safe-core/quality/profile-packs.json','src/codex-safe-core/core-contract.json','src/codex-safe-core/family-non-goals.json','src/codex-safe-core/family-error-taxonomy.json','src/codex-safe-core/scripts/family-diagnostics.js'];assert.deepEqual(pkg.files,expected);
assert.equal(Object.hasOwn(pkg,'dependencies'),false,'Diagnose must have zero runtime dependencies');
const gitlab=fs.readFileSync(path.join(root,'src/gitlab.js'),'utf8'),args=fs.readFileSync(path.join(root,'src/args.js'),'utf8'),codex=fs.readFileSync(path.join(root,'src/codex.js'),'utf8'),notify=fs.readFileSync(path.join(root,'src/notify.js'),'utf8'),diagnose=fs.readFileSync(path.join(root,'src/diagnose.js'),'utf8');
assert.doesNotMatch(gitlab,/\/retry\b|pipeline\/trigger|jobs\/\$\{[^}]+\}\/play/,'Diagnose must never retry/play/trigger CI jobs');
assert.match(args,/providerMode:'auto'/);assert.match(args,/modelSelectionStrategy:'auto'/);assert.match(args,/publish:false/);assert.match(args,/notifyWebhookEnv:''/);assert.match(codex,/codex-runtime-resolver/);assert.match(codex,/resolveCodexRuntime/);assert.match(codex,/resolveModelRegistry/);assert.match(codex,/resolveModelSelection/);assert.match(codex,/buildModelEvidence/);assert.doesNotMatch(codex,/crossProvider:true/);assert.ok(notify.includes("'open.feishu.cn'"));assert.ok(notify.includes("'qyapi.weixin.qq.com'"));assert.match(diagnose,/MAX_FAILED_JOBS=12/);assert.match(diagnose,/MAX_LOCAL_LOG_BYTES=32\*1024\*1024/);
const readme=fs.readFileSync(path.join(root,'README.md'),'utf8'),readmeZh=fs.readFileSync(path.join(root,'README.zh-CN.md'),'utf8');assert.match(readme,/not a .*PR\/MR description generator/i);assert.match(readmeZh,/不是 .*PR\/MR 描述生成器/i);assert.match(readme,/Runtime Contract v3/);assert.match(readmeZh,/Runtime Contract v3/);
console.log(`Codex Diagnose Safe ${contract.productVersion}: Safe Core ${contract.safeCoreCommit}, Runtime/Provider Contract v3, Model Routing Contract v${contract.modelRoutingContractVersion}, Diagnosis Receipt v${contract.diagnosisReceiptVersion}, zero-authority CI diagnosis boundary verified.`);
