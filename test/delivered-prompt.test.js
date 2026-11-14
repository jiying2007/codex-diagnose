'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const { runDiagnosis } = require('../src/diagnose');

test('the production Codex adapter delivers exactly the manifest-bound prompt including omissions', async () => {
  let delivered = '', calls = 0;
  const filename = require.resolve('../src/codex');
  const isolated = new Module(filename, module);
  isolated.filename = filename;
  isolated.paths = module.paths;
  const originalRequire = isolated.require.bind(isolated);
  isolated.require = request => {
    if (request === './codex-safe-core/codex-cli') return { createCodexCli: () => ({ runStructuredCodex: async options => {
      calls++;
      delivered = options.input;
      return { parsed: { classification: 'source', confidence: .8, rootCause: 'Compilation failed', primaryEvidence: ['compile error'], relatedFailures: [], affectedFiles: [], recommendedActions: ['Inspect the first compiler error'], retryRecommended: false }, usage: { inputTokens: 100, outputTokens: 10 } };
    } }) };
    if (request === './codex-safe-core/codex-runtime-resolver') return { resolveCodexRuntime: () => ({ source: 'fixture', runtime: { provider: { mode: 'openai' } } }) };
    if (request === './codex-safe-core/model-registry-resolver') return { resolveModelRegistry: () => ({ registry: null, source: 'fixture' }) };
    return originalRequire(request);
  };
  isolated._compile(fs.readFileSync(filename, 'utf8'), filename);
  const client = {
    getPipeline: async () => ({ id: 9, sha: 'a'.repeat(40) }),
    listPipelineJobs: async () => ({ complete: true, items: [{ id: 1, name: 'compile', stage: 'build', status: 'failed' }] }),
    getTrace: async () => 'main.c:2: error: undeclared symbol',
    getArtifactText: async () => '中文'.repeat(60000),
    changedPaths: async () => Array.from({ length: 205 }, (_, i) => `src/${i}.c`)
  };
  const before = process.env.TEST_DIAG_DELIVERY_TOKEN;
  process.env.TEST_DIAG_DELIVERY_TOKEN = 'fixture';
  try {
    const result = await runDiagnosis({ project: '7', pipelineId: 9, gitlabTokenEnv: 'TEST_DIAG_DELIVERY_TOKEN', artifacts: [{ kind: 'junit', path: 'report.xml' }] }, { client, runCodexFn: isolated.exports.runCodexDiagnosis });
    assert.equal(calls, 1);
    assert.match(delivered, /Input coverage gaps: artifact_truncated:0, changed_paths_count_limit/);
    assert.equal(result.execution.inputManifest.deliveredPromptDigest, crypto.createHash('sha256').update(delivered).digest('hex'));
    assert.deepEqual(result.execution.inputManifest.coverageGaps, ['artifact_truncated:0', 'changed_paths_count_limit']);
  } finally {
    if (before === undefined) delete process.env.TEST_DIAG_DELIVERY_TOKEN; else process.env.TEST_DIAG_DELIVERY_TOKEN = before;
  }
});
